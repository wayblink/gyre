import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  parseCapitalizationWorkbook,
  parseCapitalizationSummarySheet,
  summaryCapitalizationToWorkbookBuffer,
} from '../summary/capitalizationWorkbook.js';
import { fileStorage } from '../storage.js';
import { parseJson } from '../utils/json.js';
import {
  buildCapitalizationSource,
  getMonth,
  getOrCreateMonth,
  getProductFileOrThrow,
  saveProductWorkbook,
  toProductFile,
} from './support.js';
import { MONTHLY_WORKFLOW_CODE } from '../monthlyRun/store.js';
import type { RouteContext } from './context.js';
import type { SummarySnapshot } from '../../shared/types.js';

/**
 * Month registry, the Cap Table summary page (snapshot, capitalization source, notes) and the
 * capitalization summary workbook upload used to seed a month.
 */

export const updatePlanSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  remark: z.string().optional().default(''),
});

export function registerMonthRoutes(app: FastifyInstance, ctx: RouteContext) {
  const { db } = ctx;

  app.get('/api/months', async () => {
    const rows = await db.query(
      `
      select m.month_key as month,
             m.eom_date as "eomDate",
             m.status,
             (exists (select 1 from calculation_snapshots cs where cs.month_id = m.id and cs.status = 'current')
               or m.capitalization_source_file_id is not null) as "hasCapTableData",
             exists (
               select 1
                 from workflow_run_artifacts artifact
                 join workflow_runs run on run.id = artifact.run_id
                where run.workflow_code = $1
                  and run.status in ('completed', 'completed_with_warnings')
                  and artifact.task_id = 'invoke_plan_summary_sync'
                  and artifact.artifact_type = 'file'
                  and artifact.file_id is not null
                  and run.runtime_parameters_json->>'month' = m.month_key
             ) as "hasPlanSummaryData",
             exists (
               select 1
                 from workflow_run_artifacts artifact
                 join workflow_runs run on run.id = artifact.run_id
                 join product_files file on file.id = artifact.file_id
                where run.workflow_code in ('esop-exercise-record-sync', $1)
                  and run.status in ('completed', 'completed_with_warnings')
                  /* The exercise page has two views (Futu / Shareworks); either one counts as data. */
                  and artifact.task_id in (
                    'persist_exercise_record_file',
                    'persist_exercise_record_shareworks_file'
                  )
                  and artifact.artifact_type = 'file'
                  and artifact.file_id is not null
                  and file.workbook_row_count > 0
                  and run.runtime_parameters_json->>'month' = m.month_key
             ) as "hasExerciseData",
             exists (
               select 1
                 from workflow_run_artifacts artifact
                 join workflow_runs run on run.id = artifact.run_id
                 join product_files file on file.id = artifact.file_id
                where run.workflow_code in ('esop-sold-shares-sync', $1)
                  and run.status in ('completed', 'completed_with_warnings')
                  and artifact.task_id = 'persist_sold_shares_file'
                  and artifact.artifact_type = 'file'
                  and artifact.file_id is not null
                  and file.workbook_row_count > 0
                  and run.runtime_parameters_json->>'month' = m.month_key
             ) as "hasSoldSharesData",
             exists (
               select 1
                 from workflow_run_artifacts artifact
                 join workflow_runs run on run.id = artifact.run_id
                 join product_files file on file.id = artifact.file_id
                where run.workflow_code in ('esop-cancellation-record-sync', $1)
                  and run.status in ('completed', 'completed_with_warnings')
                  and artifact.task_id = 'persist_cancellation_records_file'
                  and artifact.artifact_type = 'file'
                  and artifact.file_id is not null
                  and file.workbook_row_count > 0
                  and run.runtime_parameters_json->>'month' = m.month_key
             ) as "hasCancellationData",
             exists (
               select 1
                 from workflow_run_artifacts artifact
                 join workflow_runs run on run.id = artifact.run_id
                 join product_files file on file.id = artifact.file_id
                where run.workflow_code in ('esop-grant-record-sync', $1)
                  and run.status in ('completed', 'completed_with_warnings')
                  /* The grant page has two views (Futu / Shareworks); either one counts as data. */
                  and artifact.task_id in (
                    'persist_grant_record_futu_file',
                    'persist_grant_record_shareworks_file'
                  )
                  and artifact.artifact_type = 'file'
                  and artifact.file_id is not null
                  and file.workbook_row_count > 0
                  and run.runtime_parameters_json->>'month' = m.month_key
             ) as "hasGrantData"
        from months m
       order by m.month_key desc
    `,
      [MONTHLY_WORKFLOW_CODE],
    );
    return { months: rows };
  });

  app.get('/api/months/:month/summary', async (request, reply) => {
    const { month } = request.params as { month: string };
    const monthRow = await getMonth(db, month);
    if (!monthRow) return reply.code(404).send({ error: `Month ${month} not found` });

    const snapshot = await db.queryOne<{ summary_json: unknown; formula_trace_json: unknown }>(
      'select summary_json, formula_trace_json from calculation_snapshots where month_id = $1 and status = $2',
      [monthRow.id, 'current'],
    );
    const notes = await db.query<{ id: number; time: string; content: string }>(
      'select id, created_at as time, content from notes where month_id = $1 order by id desc',
      [monthRow.id],
    );
    const summary = parseJson<Record<string, unknown>>(snapshot?.summary_json, {});
    let sourceFile: Record<string, unknown> | undefined;
    let capitalizationOverride: Partial<
      Pick<SummarySnapshot, 'capitalization' | 'totalFullyDiluted' | 'reconciliation'>
    > | null = null;

    if (monthRow.capitalization_source_file_id) {
      sourceFile = await db.queryOne<Record<string, unknown>>('select * from product_files where id = $1', [
        monthRow.capitalization_source_file_id,
      ]);
      if (sourceFile) {
        const buffer = await fileStorage.read(String(sourceFile.file_path));
        const parsed = parseCapitalizationWorkbook(buffer, monthRow.capitalization_source_sheet_name);
        capitalizationOverride = {
          capitalization: parsed.capitalization,
          totalFullyDiluted: parsed.totalFullyDiluted,
          ...(parsed.reconciliation ? { reconciliation: parsed.reconciliation } : {}),
        };

        if (
          !monthRow.capitalization_source_sheet_name ||
          monthRow.capitalization_source_sheet_name !== parsed.resolvedSheetName
        ) {
          await db.execute(
            'update months set capitalization_source_sheet_name = $2, updated_at = current_timestamp where id = $1',
            [monthRow.id, parsed.resolvedSheetName],
          );
          monthRow.capitalization_source_sheet_name = parsed.resolvedSheetName;
        }
      }
    }

    const fallbackSummary: SummarySnapshot = {
      month,
      eomDate: monthRow.eom_date,
      reconciliation: {
        item: 'No snapshot data',
        lastMonth: 0,
        newShares: 0,
        eomBalance: 0,
      },
      capitalization: [],
      totalFullyDiluted: 0,
      formulaTrace: {},
      notes: [],
    };

    const responseSummary: SummarySnapshot = {
      ...fallbackSummary,
      ...summary,
      month,
      eomDate: String(summary.eomDate ?? monthRow.eom_date),
      ...(capitalizationOverride ?? {}),
      formulaTrace: parseJson(snapshot?.formula_trace_json, {}),
      notes,
      capitalizationSource: buildCapitalizationSource(monthRow, sourceFile),
    };

    return responseSummary;
  });

  app.put('/api/months/:month/capitalization-source', async (request, reply) => {
    const { month } = request.params as { month: string };
    const monthRow = await getMonth(db, month);
    if (!monthRow) return reply.code(404).send({ error: `Month ${month} not found` });

    const body = z
      .object({
        fileId: z.number().int().positive().nullable(),
        sheetName: z.string().trim().max(255).nullable().optional(),
      })
      .parse(request.body);

    let sourceFile: Record<string, unknown> | undefined;
    let resolvedSheetName: string | null = body.sheetName?.trim() || null;

    if (body.fileId !== null) {
      sourceFile = await getProductFileOrThrow(db, body.fileId);
      const buffer = await fileStorage.read(String(sourceFile.file_path));
      const parsed = parseCapitalizationSummarySheet(buffer, resolvedSheetName);
      resolvedSheetName = parsed.resolvedSheetName;
    }

    await db.execute(
      `update months
       set capitalization_source_file_id = $2,
           capitalization_source_sheet_name = $3,
           updated_at = current_timestamp
       where id = $1`,
      [monthRow.id, body.fileId, resolvedSheetName],
    );

    return {
      source: buildCapitalizationSource(
        {
          capitalization_source_file_id: body.fileId,
          capitalization_source_sheet_name: resolvedSheetName,
        },
        sourceFile,
      ),
    };
  });

  app.post('/api/months/:month/capitalization-summary-file', async (request, reply) => {
    const { month } = request.params as { month: string };
    const monthRow = await getMonth(db, month);
    if (!monthRow) return reply.code(404).send({ error: `Month ${month} not found` });

    const snapshot = await db.queryOne<{ summary_json: unknown }>(
      'select summary_json from calculation_snapshots where month_id = $1 and status = $2',
      [monthRow.id, 'current'],
    );
    if (!snapshot) return reply.code(404).send({ error: `No summary snapshot for ${month}` });

    const summary = parseJson<SummarySnapshot>(snapshot.summary_json, {
      month,
      eomDate: monthRow.eom_date,
      reconciliation: {
        item: '',
        lastMonth: 0,
        newShares: 0,
        eomBalance: 0,
      },
      capitalization: [],
      totalFullyDiluted: 0,
      formulaTrace: {},
      notes: [],
    });

    const normalizedSummary: SummarySnapshot = {
      ...summary,
      month,
      eomDate: summary.eomDate || monthRow.eom_date,
      notes: Array.isArray(summary.notes) ? summary.notes : [],
      capitalization: Array.isArray(summary.capitalization) ? summary.capitalization : [],
    };

    const buffer = summaryCapitalizationToWorkbookBuffer(normalizedSummary);
    const saved = await saveProductWorkbook(db, {
      originalName: `Capitalization_Table_Summary_View_${month}.xlsx`,
      buffer,
      uploadedBy: 'Summary Export',
    });

    return reply.code(201).send({
      file: toProductFile(saved.file),
      sheets: saved.summary.sheets,
    });
  });

  app.post('/api/months/:month/notes', async (request, reply) => {
    const { month } = request.params as { month: string };
    const body = z.object({ content: z.string().min(1) }).parse(request.body);
    const monthId = await getOrCreateMonth(db, month);
    const note = await db.queryOne(
      'insert into notes (month_id, content) values ($1, $2) returning id, created_at as time, content',
      [monthId, body.content],
    );
    return reply.code(201).send(note);
  });

  app.delete('/api/notes/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    await db.execute('delete from notes where id = $1', [Number(id)]);
    return reply.code(204).send();
  });
}

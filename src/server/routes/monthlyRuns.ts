import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { isRecord } from '../utils/json.js';
import {
  attachWorkflowRunToMonthlyHistory,
  createMonthlyRunHistory,
  deleteMonthlyRunHistory,
  getMonthlyRun,
  listMonthlyRuns,
  MonthlyRunHistoryDeleteConflictError,
  MONTHLY_WORKFLOW_CODE,
} from '../monthlyRun/store.js';
import {
  deleteMonthlyRunPlan,
  ensureMonthlyRunInstance,
  getLatestMonthlyRunOutput,
  getMonthlyRunInstance,
  getMonthlyRunOutputForMonth,
  listMonthlyRunInstances,
  monthlyRunInstanceToRuntimeParameters,
  upsertMonthlyRunInstance,
  updateMonthlyRunInstanceExecutionState,
} from '../monthlyRun/instanceStore.js';
import {
  monthlyWorkflowSelectionLabel,
  monthlyWorkflowVersionMismatch,
  resolveMonthlyWorkflowDefinition,
} from '../monthlyRun/workflowSelection.js';
import {
  getOrCreateMonth,
  monthlyRunInputSourceLabels,
  monthlySourceDescriptors,
  notFound,
  parseIdParam,
  previousMonthKey,
} from './support.js';
import { resolveWorkflowRunPlan } from '../workflow/startWorkflowRun.js';
import { findFileRefProblems, formatFileRefProblems } from '../workflow/fileRefPreflight.js';
import { workflowOperatorDefinitions } from '../workflow/operators/registry.js';
import { badRequest, conflict, getProductFileOrThrow } from './support.js';
import { workflowRunToExecutionResult } from '../workflow/runResult.js';
import { fileStorage } from '../storage.js';
import { monthlySourcesFromSchema } from '../monthlyRun/sourceSchema.js';
import { workflowApprovalBodySchema } from './workflows.js';
import { updatePlanSchema } from './months.js';
import type {
  LatestMonthlyRunOutput,
  MonthlyRunInstanceRecord,
  MonthlyRunInstanceUpsertRequest,
  MonthlyRunSourceConfigResponse,
  WorkflowRuntimeParameters,
} from '../../shared/types.js';
import type { RouteContext } from './context.js';

/**
 * Monthly Update: the month's input/constant instance, its run history, and the run trigger itself.
 *
 * The trigger pins the workflow definition version the UI was built against (MONTHLY_WORKFLOW_VERSION
 * in src/client/monthlyRunPage.ts) and refuses to run when the DB definition moved on.
 */

async function removeStoredFilesAfterCommit(
  filePaths: string[],
  logger: { error: (obj: unknown, msg?: string) => void },
) {
  for (const filePath of [...new Set(filePaths)]) {
    try {
      await fileStorage.remove(filePath);
    } catch (error) {
      logger.error({ error, filePath }, 'Post-commit file cleanup failed');
    }
  }
}

const monthlyRunListQuerySchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

const monthlyRunInstanceQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
});

const monthlyRunInstanceUpsertSchema = z.object({
  operator: z.string().trim().min(1).optional(),
  sources: z
    .record(
      z.string(),
      z
        .object({
          fileId: z.number().int().positive(),
          logicalPath: z.string().trim().min(1).max(1024).nullable().optional(),
          fileKey: z.string().trim().min(1).max(1024).nullable().optional(),
          sheetName: z.string().trim().min(1).max(255).nullable().optional(),
        })
        .nullable(),
    )
    .optional(),
  fixedValues: z.record(z.string(), z.number()).optional(),
});

const monthlyRunTriggerBodySchema = z.object({
  workflowId: z.number().int().positive().optional(),
  workflowCode: z.string().trim().min(1).optional(),
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
  operator: z.string().trim().min(1).optional().default('Administrator'),
  // Sent by the Monthly Update page (the workflow definition version its UI was built against).
  expectedWorkflowVersion: z.number().int().positive().optional(),
});

/**
 * Point an internally-maintained source at last month's merged base workbook.
 *
 * Both the cancel/restore report and the Futu exercises base are *outputs* of a previous monthly
 * run: the merge sub-workflows persist `<folder>/<Base name>_<yyyy_MM>.xlsx` so the next month can
 * chain off them. Resolving them here keeps the sources out of the UI, and — more importantly —
 * stops the definition's hardcoded default from being used, because those defaults are written once
 * when the workflow is authored and go stale the moment a new month starts.
 */
async function injectPreviousMonthBase(
  db: RouteContext['db'],
  runtimeParameters: WorkflowRuntimeParameters,
  monthKey: string,
  sourceKey: string,
  basePath: string,
  sheet: string,
): Promise<void> {
  const fileRefs = runtimeParameters.fileRefs;
  if (!fileRefs || typeof fileRefs !== 'object' || Array.isArray(fileRefs)) return;
  // An explicit binding always wins: the operator picked that file on purpose.
  const existing = (fileRefs as Record<string, unknown>)[sourceKey];
  if (isRecord(existing) && String(existing.key ?? '').trim()) return;
  const previousBase = await db.queryOne<{ logical_path: string }>(
    'select logical_path from product_files where logical_path = $1 order by id desc limit 1',
    [basePath],
  );
  if (!previousBase?.logical_path) return;
  (fileRefs as Record<string, unknown>)[sourceKey] = {
    provider: 'product-files',
    key: previousBase.logical_path,
    sheet,
  };
}

/**
 * Operators whose `fileRef` param is declared optional: an empty reference means "not supplied",
 * which is a documented state, not a broken input.
 */
const optionalFileRefOperators = new Set(
  workflowOperatorDefinitions
    .filter((definition) => definition.paramsSchema?.fileRef?.required === false)
    .map((definition) => definition.code),
);

function requiredMonthlySourceKeys(sources: Awaited<ReturnType<typeof monthlySourceDescriptors>>): Set<string> {
  return new Set(sources.filter((source) => source.required).map((source) => source.sourceKey));
}

async function assertMonthlyRunInstanceReady(
  db: RouteContext['db'],
  instance: MonthlyRunInstanceRecord,
): Promise<void> {
  const sources = await monthlySourceDescriptors(db);
  for (const source of sources) {
    const binding = instance.sources[source.sourceKey];
    const fileId = binding?.fileId ?? null;
    if (!fileId) {
      // A missing required binding is operator input, not a server fault: report it as a 400 so the
      // Monthly Update page can show it instead of logging a stack trace as a 500.
      if (source.required) throw badRequest(`Missing source binding: ${source.sourceKey}`);
      continue;
    }
    // A sheet is only mandatory when there is nothing to fall back to. Every source's consuming task
    // carries its own `$default.sheet`, so demanding one here refused runs that would have used that
    // default — and bindings saved before the source declared `allowSheetNameOverride` have none.
    if (!binding?.sheetName?.trim() && !source.defaultSheetName?.trim()) {
      throw badRequest(`Missing source sheet name: ${source.sourceKey}`);
    }
    await getProductFileOrThrow(db, fileId);
  }
}

export function registerMonthlyRunRoutes(app: FastifyInstance, ctx: RouteContext) {
  const { db, workflowRunStore, workflowRunExecutor } = ctx;

  app.get('/api/monthly-runs', async (request) => {
    const query = monthlyRunListQuerySchema.parse(request.query);
    return { items: await listMonthlyRuns(db, { ...query, sourceLabels: await monthlyRunInputSourceLabels(db) }) };
  });

  app.get('/api/monthly-runs/instances', async (request): Promise<{ items: MonthlyRunInstanceRecord[] }> => {
    const query = monthlyRunListQuerySchema.parse(request.query);
    return { items: await listMonthlyRunInstances(db, { month: query.month }) };
  });

  app.post('/api/monthly-runs/instances', async (request, reply): Promise<{ instance: MonthlyRunInstanceRecord }> => {
    const body = updatePlanSchema.parse(request.body ?? {});
    await getOrCreateMonth(db, body.month);
    const instance = await ensureMonthlyRunInstance(db, body.month);
    return reply.code(201).send({ instance });
  });

  app.delete('/api/monthly-runs/instances/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const operation = await db.transaction((tx) => deleteMonthlyRunPlan(tx, Number(id)));
      if (!operation) throw notFound('Monthly run instance not found');
      const { deletedFilePaths, ...deleted } = operation;
      await removeStoredFilesAfterCommit(deletedFilePaths, app.log);
      return reply.send({ deleted });
    } catch (error) {
      if (error instanceof MonthlyRunHistoryDeleteConflictError) {
        return reply.code(409).send({ error: error.message });
      }
      throw error;
    }
  });

  app.get('/api/monthly-runs/instance', async (request): Promise<{ instance: MonthlyRunInstanceRecord }> => {
    const query = monthlyRunInstanceQuerySchema.parse(request.query);
    await getOrCreateMonth(db, query.month);
    const instance = await ensureMonthlyRunInstance(db, query.month);
    return { instance };
  });

  app.put('/api/monthly-runs/instance', async (request): Promise<{ instance: MonthlyRunInstanceRecord }> => {
    const query = monthlyRunInstanceQuerySchema.parse(request.query);
    const body = monthlyRunInstanceUpsertSchema.parse(request.body ?? {}) as MonthlyRunInstanceUpsertRequest;
    await getOrCreateMonth(db, query.month);
    const instance = await upsertMonthlyRunInstance(db, query.month, body);
    return { instance };
  });

  app.get('/api/monthly-runs/source-config', async (): Promise<MonthlyRunSourceConfigResponse> => {
    const row = await db.queryOne<Record<string, unknown>>(
      "select name, version, runtime_params_schema_json from workflow_definitions where code = $1 and status = 'active' limit 1",
      [MONTHLY_WORKFLOW_CODE],
    );
    return {
      workflowCode: MONTHLY_WORKFLOW_CODE,
      workflowName: row?.name ? String(row.name) : MONTHLY_WORKFLOW_CODE,
      workflowVersion: Number(row?.version ?? 0),
      sources: monthlySourcesFromSchema(row?.runtime_params_schema_json),
      fixedValues: [],
    };
  });

  app.get('/api/monthly-runs/latest-output', async (): Promise<{ output: LatestMonthlyRunOutput | null }> => ({
    output: await getLatestMonthlyRunOutput(db),
  }));

  app.get('/api/monthly-runs/:id', async (request) => {
    const runId = parseIdParam((request.params as { id: string }).id, 'monthly run id');
    const history = await getMonthlyRun(db, runId, { sourceLabels: await monthlyRunInputSourceLabels(db) });
    if (!history) throw notFound('Monthly run not found');
    return history;
  });

  app.post('/api/monthly-runs', async (request, reply) => {
    const body = monthlyRunTriggerBodySchema.parse(request.body ?? {});
    if (!body.month) throw new Error('month is required');
    await getOrCreateMonth(db, body.month);
    const monthlyRunInstance =
      (await getMonthlyRunInstance(db, body.month)) ?? (await ensureMonthlyRunInstance(db, body.month));

    await assertMonthlyRunInstanceReady(db, monthlyRunInstance);
    // fixedValues are now per-month, sourced from the instance (monthlyRunInstanceToRuntimeParameters
    // already carries all 6). New months inherit the prior month's values; the very first month was
    // seeded from global_parameters. We no longer overwrite them from the global table here.
    const resolvedRuntimeParameters: WorkflowRuntimeParameters =
      monthlyRunInstanceToRuntimeParameters(monthlyRunInstance);

    // Previous Capitalization Summary 由业务自动引入：若上一个月的月度执行已产出汇总表，则用它作为
    // 本源（用于校验本月 EQ Control Book 的 Last Month）；无则置空、跳过对账校验。该源在 UI 隐藏。
    const prevFileRefs = resolvedRuntimeParameters.fileRefs as Record<string, unknown> | undefined;
    if (prevFileRefs && !prevFileRefs.previous_capitalization_summary) {
      const previousOutput = await getMonthlyRunOutputForMonth(db, previousMonthKey(monthlyRunInstance.monthKey));
      if (previousOutput?.logicalPath) {
        prevFileRefs.previous_capitalization_summary = { provider: 'product-files', key: previousOutput.logicalPath };
      }
    }

    // The cancel/restore base is maintained internally: when last month's merged
    // workbook exists, feed it into this run automatically instead of requiring a
    // user-visible source binding.
    const previousMonthUnderscore = previousMonthKey(monthlyRunInstance.monthKey).replace('-', '_');
    await injectPreviousMonthBase(
      db,
      resolvedRuntimeParameters,
      monthlyRunInstance.monthKey,
      'base_cancel_restore_report',
      `cancel_restore/Gyre_Therapeutics_Cancel_Restore_Base_${previousMonthUnderscore}.xlsx`,
      '取消与恢复明细',
    );
    await injectPreviousMonthBase(
      db,
      resolvedRuntimeParameters,
      monthlyRunInstance.monthKey,
      'base_futu_exercises',
      `futu_exercises/Futu_Exercises_Base_${previousMonthUnderscore}.xlsx`,
      'Futu BCI Exercises',
    );

    const monthKey = String(resolvedRuntimeParameters.month);
    const monthId = await getOrCreateMonth(db, monthKey);
    const workflowRow = await resolveMonthlyWorkflowDefinition(db, {
      workflowId: body.workflowId,
      workflowCode: body.workflowCode,
    });
    if (!workflowRow) throw notFound(`Workflow ${monthlyWorkflowSelectionLabel(body)} not found`);

    // The Monthly Update UI pins the workflow definition version it renders inputs for. A DB
    // definition edited without a matching UI change would otherwise run against inputs the page
    // never showed (or silently skip inputs it now requires), so reject the mismatch up front.
    const versionMismatch = monthlyWorkflowVersionMismatch(workflowRow, body.expectedWorkflowVersion);
    if (versionMismatch) {
      throw conflict(
        `Monthly workflow version mismatch: the UI expects workflow definition v${versionMismatch.expected}, but the database holds v${versionMismatch.actual}. Update the workflow definition (or the UI) so both versions match before running Monthly Update.`,
      );
    }

    // Same resolution the other workflow entry points use (normalized tasks + runtime parameters
    // merged over the definition defaults), resolved here because the history row snapshots them
    // before the run exists.
    const runtimeConfiguration = await resolveWorkflowRunPlan({
      db,
      workflow: workflowRow,
      runtimeParameters: resolvedRuntimeParameters,
    });

    // Monthly Update merges the instance's saved sources over the definition's defaults, so a
    // default that is not a real product file (or an unbound optional source whose default is an
    // empty object) would otherwise reach a `sheet.range.extract` task and fail several steps into
    // the run — after earlier steps already wrote files. Refuse to start instead, listing every
    // unusable input at once.
    const fileRefProblems = await findFileRefProblems({
      db,
      tasks: runtimeConfiguration.tasks,
      runtimeFileRefs: runtimeConfiguration.runtimeParameters.fileRefs as Record<string, unknown> | undefined,
      requiredSourceKeys: requiredMonthlySourceKeys(await monthlySourceDescriptors(db)),
      optionalFileRefOperators,
    });
    if (fileRefProblems) {
      throw badRequest(`月度运行输入文件不可用：${formatFileRefProblems(fileRefProblems)}`);
    }

    const runtimeFileRefs = runtimeConfiguration.runtimeParameters.fileRefs;
    const primarySourceFileId =
      runtimeFileRefs && typeof runtimeFileRefs === 'object' && !Array.isArray(runtimeFileRefs)
        ? Number(
            ((runtimeFileRefs as Record<string, unknown>).control_book as Record<string, unknown> | undefined)?.id ??
              (Object.values(runtimeFileRefs)[0] as Record<string, unknown> | undefined)?.id ??
              null,
          )
        : null;
    const history = await createMonthlyRunHistory(db, {
      monthId,
      monthKey,
      updatePlanId: null,
      workflowId: Number(workflowRow.id),
      sourceFileId: primarySourceFileId && Number.isInteger(primarySourceFileId) ? primarySourceFileId : null,
      operator: monthlyRunInstance.operator ?? body.operator,
      runtimeParameters: runtimeConfiguration.runtimeParameters,
    });
    const workflowRun = await workflowRunStore.createRun({
      workflow: workflowRow,
      tasks: runtimeConfiguration.tasks,
      runtimeParameters: runtimeConfiguration.runtimeParameters,
    });
    const attachedHistory = await attachWorkflowRunToMonthlyHistory(db, {
      historyId: history.id,
      workflowRunId: workflowRun.id,
    });

    await updateMonthlyRunInstanceExecutionState(db, {
      monthKey,
      status: 'running',
      latestWorkflowRunId: workflowRun.id,
      latestOutputFileId: null,
      latestErrorMessage: null,
      lastTriggeredAt: history.triggeredAt,
    });

    workflowRunExecutor.startAsync(workflowRun.id);
    return reply.code(201).send({
      history: attachedHistory,
      executionResult: workflowRunToExecutionResult(await workflowRunStore.getRun(workflowRun.id)),
    });
  });

  app.post('/api/monthly-runs/:id/approvals', async (request) => {
    const historyId = parseIdParam((request.params as { id: string }).id, 'monthly run id');
    const history = await getMonthlyRun(db, historyId, { sourceLabels: await monthlyRunInputSourceLabels(db) });
    if (!history) throw notFound('Monthly run not found');
    if (!history.workflowRunId) throw new Error('Monthly run has no workflow run attached');
    const body = workflowApprovalBodySchema.parse(request.body ?? {});
    const taskIds = body.taskIds?.length ? body.taskIds : body.taskId ? [body.taskId] : [];
    if (!taskIds.length) {
      throw new Error('At least one approval task id is required');
    }
    const run = await workflowRunExecutor.continueAfterApproval(history.workflowRunId, taskIds, body.decision);
    return workflowRunToExecutionResult(run);
  });

  app.delete('/api/monthly-runs/:id', async (request, reply) => {
    const historyId = parseIdParam((request.params as { id: string }).id, 'monthly run id');
    try {
      // A history parked in `waiting_approval` is paused mid-execution waiting for a human decision,
      // and the only ways to end it from the run panel are 继续/跳过 — both advance the workflow and
      // write its output. An operator asking to delete such a row means "throw this away", so end the
      // run here instead. `cancelRun` finalises it as `skipped`, which the delete guard accepts, so
      // nothing is left orphaned. Runs that are genuinely executing are still refused below.
      const parked = await db.queryOne<{ workflow_run_id: number | null }>(
        `select workflow_run_id from monthly_run_history
          where id = $1 and status = 'waiting_approval'`,
        [historyId],
      );
      const parkedRunId =
        parked?.workflow_run_id === null || parked?.workflow_run_id === undefined
          ? null
          : Number(parked.workflow_run_id);
      if (parkedRunId && Number.isInteger(parkedRunId) && parkedRunId > 0) {
        await workflowRunExecutor.cancelRun(parkedRunId);
      }
      const operation = await db.transaction((tx) => deleteMonthlyRunHistory(tx, historyId));
      if (!operation) throw notFound('Monthly run not found');
      const { deletedOutputFilePath, ...deleted } = operation;
      if (deletedOutputFilePath) await removeStoredFilesAfterCommit([deletedOutputFilePath], app.log);
      return reply.send({ deleted });
    } catch (error) {
      if (error instanceof MonthlyRunHistoryDeleteConflictError) {
        return reply.code(409).send({ error: error.message });
      }
      throw error;
    }
  });
}

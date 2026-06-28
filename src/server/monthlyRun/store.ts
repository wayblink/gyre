import type {
  MonthlyRunHistoryRecord,
  MonthlyRunStatus,
  WorkflowRunArtifactRecord,
  WorkflowRunRecord,
  WorkflowRuntimeParameters,
} from '../../shared/types.js';
import type { QueryResultRow } from 'pg';

export const MONTHLY_WORKFLOW_CODE = 'gyre-captable-summary-draft';
export const MONTHLY_PERSIST_TASK_ID = 'persist_capitalization_summary';

export type MonthlyRunDb = {
  query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<T[]>;
  queryOne<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<T | undefined>;
  execute(text: string, params?: unknown[]): Promise<void>;
};

function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'object') return value as T;
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return fallback;
  }
}

function toIsoTimestamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
  }
  return new Date(String(value)).toISOString();
}

function toNullableIsoTimestamp(value: unknown): string | null {
  return value === null || value === undefined ? null : toIsoTimestamp(value);
}

export function toMonthlyRunHistoryRecord(row: Record<string, unknown>): MonthlyRunHistoryRecord {
  return {
    id: Number(row.id),
    monthId: Number(row.month_id),
    monthKey: String(row.month_key),
    workflowId: Number(row.workflow_id),
    workflowRunId: row.workflow_run_id === null || row.workflow_run_id === undefined ? null : Number(row.workflow_run_id),
    sourceFileId: row.source_file_id === null || row.source_file_id === undefined ? null : Number(row.source_file_id),
    sourceFileName: row.source_file_name ? String(row.source_file_name) : null,
    producedFileId: row.produced_file_id === null || row.produced_file_id === undefined ? null : Number(row.produced_file_id),
    producedFileName: row.produced_file_name ? String(row.produced_file_name) : null,
    producedSheetName: row.produced_sheet_name ? String(row.produced_sheet_name) : null,
    operator: String(row.operator ?? 'Administrator'),
    status: String(row.status ?? 'running') as MonthlyRunStatus,
    errorMessage: row.error_message ? String(row.error_message) : null,
    triggeredAt: toIsoTimestamp(row.triggered_at),
    finishedAt: toNullableIsoTimestamp(row.finished_at),
    runtimeParameters: parseJson<WorkflowRuntimeParameters>(row.runtime_parameters_json, {}),
  };
}

export async function listMonthlyRuns(
  db: MonthlyRunDb,
  params: { month?: string; limit?: number } = {},
): Promise<MonthlyRunHistoryRecord[]> {
  const limit = Math.max(1, Math.min(params.limit ?? 20, 100));
  const rows = params.month
    ? await db.query<Record<string, unknown>>(
        `select h.*,
                source.original_name as source_file_name,
                produced.original_name as produced_file_name
           from monthly_run_history h
           left join product_files source on source.id = h.source_file_id
           left join product_files produced on produced.id = h.produced_file_id
          where h.month_key = $1
          order by h.triggered_at desc, h.id desc
          limit $2`,
        [params.month, limit],
      )
    : await db.query<Record<string, unknown>>(
        `select h.*,
                source.original_name as source_file_name,
                produced.original_name as produced_file_name
           from monthly_run_history h
           left join product_files source on source.id = h.source_file_id
           left join product_files produced on produced.id = h.produced_file_id
          order by h.triggered_at desc, h.id desc
          limit $1`,
        [limit],
      );
  return rows.map(toMonthlyRunHistoryRecord);
}

export async function getMonthlyRun(db: MonthlyRunDb, id: number): Promise<MonthlyRunHistoryRecord | null> {
  const row = await db.queryOne<Record<string, unknown>>(
    `select h.*,
            source.original_name as source_file_name,
            produced.original_name as produced_file_name
       from monthly_run_history h
       left join product_files source on source.id = h.source_file_id
       left join product_files produced on produced.id = h.produced_file_id
      where h.id = $1`,
    [id],
  );
  return row ? toMonthlyRunHistoryRecord(row) : null;
}

export async function createMonthlyRunHistory(
  db: MonthlyRunDb,
  params: {
    monthId: number;
    monthKey: string;
    workflowId: number;
    sourceFileId: number | null;
    operator: string;
    runtimeParameters: WorkflowRuntimeParameters;
  },
): Promise<MonthlyRunHistoryRecord> {
  const row = await db.queryOne<Record<string, unknown>>(
    `insert into monthly_run_history (
       month_id, month_key, workflow_id, source_file_id, operator, status, runtime_parameters_json
     )
     values ($1, $2, $3, $4, $5, 'running', $6::jsonb)
     returning *`,
    [
      params.monthId,
      params.monthKey,
      params.workflowId,
      params.sourceFileId,
      params.operator,
      JSON.stringify(params.runtimeParameters),
    ],
  );
  if (!row) throw new Error('Failed to create monthly run history');
  return toMonthlyRunHistoryRecord(row);
}

export async function attachWorkflowRunToMonthlyHistory(
  db: MonthlyRunDb,
  params: { historyId: number; workflowRunId: number },
): Promise<MonthlyRunHistoryRecord> {
  const row = await db.queryOne<Record<string, unknown>>(
    `update monthly_run_history
        set workflow_run_id = $1
      where id = $2
      returning *`,
    [params.workflowRunId, params.historyId],
  );
  if (!row) throw new Error('Failed to attach workflow run to monthly history');
  return toMonthlyRunHistoryRecord(row);
}

function isSuccessfulStatus(status: WorkflowRunRecord['status']): boolean {
  return status === 'completed' || status === 'completed_with_warnings';
}

function findProducedSummaryArtifact(run: WorkflowRunRecord): WorkflowRunArtifactRecord | null {
  return (
    run.artifacts.find(
      (artifact) =>
        artifact.taskId === MONTHLY_PERSIST_TASK_ID &&
        artifact.artifactType === 'file' &&
        typeof artifact.fileId === 'number',
    ) ?? null
  );
}

function getArtifactSheetName(artifact: WorkflowRunArtifactRecord | null): string | null {
  const range = artifact?.metadata?.range;
  if (!range || typeof range !== 'object' || Array.isArray(range)) return null;
  const sheetName = (range as Record<string, unknown>).sheetName;
  return typeof sheetName === 'string' && sheetName.trim() ? sheetName.trim() : null;
}

export async function applyMonthlyRunPostProcessing(db: MonthlyRunDb, run: WorkflowRunRecord): Promise<void> {
  if (run.status === 'waiting_approval' || run.status === 'running' || run.status === 'pending') return;

  const history = await db.queryOne<Record<string, unknown>>(
    'select * from monthly_run_history where workflow_run_id = $1',
    [run.id],
  );
  if (!history) return;

  let producedFileId: number | null = null;
  let producedSheetName: string | null = null;
  if (isSuccessfulStatus(run.status)) {
    const artifact = findProducedSummaryArtifact(run);
    producedFileId = artifact?.fileId ?? null;
    producedSheetName = getArtifactSheetName(artifact);
    if (producedFileId) {
      await db.execute(
        `update months
            set capitalization_source_file_id = $1,
                capitalization_source_sheet_name = $2
          where id = $3`,
        [producedFileId, producedSheetName, Number(history.month_id)],
      );
    }
  }

  await db.execute(
    `update monthly_run_history
        set status = $1,
            error_message = $2,
            finished_at = $3,
            produced_file_id = $4,
            produced_sheet_name = $5
      where id = $6`,
    [
      run.status,
      run.errorMessage,
      run.finishedAt ?? new Date().toISOString(),
      producedFileId,
      producedSheetName,
      Number(history.id),
    ],
  );
}

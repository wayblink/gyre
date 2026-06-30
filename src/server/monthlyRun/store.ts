import type {
  MonthlyRunHistoryRecord,
  MonthlyRunStatus,
  PlanStatus,
  WorkflowRunArtifactRecord,
  WorkflowRunRecord,
  WorkflowRunStatus,
  WorkflowRuntimeParameters,
} from '../../shared/types.js';
import type { QueryResultRow } from 'pg';

export const MONTHLY_WORKFLOW_CODE = 'gyre-captable-summary-draft';
export const MONTHLY_PERSIST_TASK_ID = 'persist_capitalization_summary';
const MONTHLY_RUN_INPUT_LABELS: Record<string, string> = {
  control_book: 'EQ Control Book',
  futu_exercises: 'Futu BCI Exercises',
  option_plans: 'Option Plans Summary',
};

export type MonthlyRunDb = {
  query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<T[]>;
  queryOne<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<T | undefined>;
  execute(text: string, params?: unknown[]): Promise<void>;
};

export function planStatusForWorkflowRunStatus(status: WorkflowRunStatus): PlanStatus {
  if (status === 'completed' || status === 'completed_with_warnings') return '已完成';
  if (status === 'waiting_approval') return '待复核';
  if (status === 'failed') return '失败';
  if (status === 'skipped') return '已取消';
  return '进行中';
}

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

function fileIdFromRuntimeFileValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.provider !== 'product-files') return null;
  const fileId = Number(record.id);
  return Number.isInteger(fileId) && fileId > 0 ? fileId : null;
}

function runtimeFileEntries(runtimeParameters: WorkflowRuntimeParameters): Array<[string, unknown]> {
  const runtimeFileRefs = runtimeParameters.fileRefs;
  if (runtimeFileRefs && typeof runtimeFileRefs === 'object' && !Array.isArray(runtimeFileRefs)) {
    return Object.entries(runtimeFileRefs as Record<string, unknown>);
  }
  const runtimeFileIds = runtimeParameters.fileIds;
  if (runtimeFileIds && typeof runtimeFileIds === 'object' && !Array.isArray(runtimeFileIds)) {
    return Object.entries(runtimeFileIds as Record<string, unknown>);
  }
  return [];
}

export function toMonthlyRunHistoryRecord(row: Record<string, unknown>): MonthlyRunHistoryRecord {
  const runtimeParameters = parseJson<WorkflowRuntimeParameters>(row.runtime_parameters_json, {});
  const inputFiles = parseJson<MonthlyRunHistoryRecord['inputFiles']>(row.input_files_json, []);
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
    runtimeParameters,
    inputFiles,
  };
}

async function attachInputFiles(
  db: MonthlyRunDb,
  rows: Array<Record<string, unknown>>,
): Promise<Array<Record<string, unknown>>> {
  if (!rows.length) return rows;
  const fileIds = new Set<number>();
  rows.forEach((row) => {
    const runtimeParameters = parseJson<WorkflowRuntimeParameters>(row.runtime_parameters_json, {});
    runtimeFileEntries(runtimeParameters).forEach(([, value]) => {
      const fileId = fileIdFromRuntimeFileValue(value);
      if (fileId) fileIds.add(fileId);
    });
  });

  const fileNameById = new Map<number, string>();
  if (fileIds.size > 0) {
    const files = await db.query<{ id: number; original_name: string }>(
      'select id, original_name from product_files where id = any($1::int[])',
      [Array.from(fileIds)],
    );
    files.forEach((file) => fileNameById.set(Number(file.id), String(file.original_name)));
  }

  return rows.map((row) => {
    const runtimeParameters = parseJson<WorkflowRuntimeParameters>(row.runtime_parameters_json, {});
    const inputFiles = runtimeFileEntries(runtimeParameters).map(([sourceKey, value]) => {
      const fileId = fileIdFromRuntimeFileValue(value);
      return {
        sourceKey,
        label: MONTHLY_RUN_INPUT_LABELS[sourceKey] ?? sourceKey,
        fileId,
        fileName: fileId ? (fileNameById.get(fileId) ?? null) : null,
      };
    });
    return { ...row, input_files_json: JSON.stringify(inputFiles) };
  });
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
  await reconcileMonthlyRunStatuses(db, rows);
  return (await attachInputFiles(db, rows)).map(toMonthlyRunHistoryRecord);
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
  if (!row) return null;
  await reconcileMonthlyRunStatuses(db, [row]);
  const [enriched] = await attachInputFiles(db, [row]);
  return enriched ? toMonthlyRunHistoryRecord(enriched) : null;
}

export async function createMonthlyRunHistory(
  db: MonthlyRunDb,
  params: {
    monthId: number;
    monthKey: string;
    updatePlanId?: number | null;
    workflowId: number;
    sourceFileId: number | null;
    operator: string;
    runtimeParameters: WorkflowRuntimeParameters;
  },
): Promise<MonthlyRunHistoryRecord> {
  const row = await db.queryOne<Record<string, unknown>>(
    `insert into monthly_run_history (
       update_plan_id, month_id, month_key, workflow_id, source_file_id, operator, status, runtime_parameters_json
     )
     values ($1, $2, $3, $4, $5, $6, 'running', $7::jsonb)
     returning *`,
    [
      params.updatePlanId ?? null,
      params.monthId,
      params.monthKey,
      params.workflowId,
      params.sourceFileId,
      params.operator,
      JSON.stringify(params.runtimeParameters),
    ],
  );
  if (!row) throw new Error('Failed to create monthly run history');
  if (params.updatePlanId) {
    await updateMonthlyUpdatePlanStatus(db, params.updatePlanId, '进行中');
  }
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

export async function updateMonthlyUpdatePlanStatus(
  db: MonthlyRunDb,
  updatePlanId: number | null | undefined,
  status: PlanStatus,
): Promise<void> {
  if (!updatePlanId) return;
  await db.execute(
    `update update_plans
        set status = $1,
            operation_time = $2,
            updated_at = current_timestamp
      where id = $3`,
    [status, new Date().toLocaleDateString('zh-CN'), updatePlanId],
  );
}

async function reconcileMonthlyRunStatuses(
  db: MonthlyRunDb,
  rows: Array<Record<string, unknown>>,
): Promise<void> {
  const runIds = rows
    .map((row) => (row.workflow_run_id === null || row.workflow_run_id === undefined ? null : Number(row.workflow_run_id)))
    .filter((runId): runId is number => runId !== null && Number.isInteger(runId) && runId > 0);
  if (!runIds.length) return;

  const workflowRuns = await db.query<Record<string, unknown>>(
    'select id, status, error_message, finished_at from workflow_runs where id = any($1::int[])',
    [runIds],
  );
  const workflowRunById = new Map(workflowRuns.map((run) => [Number(run.id), run]));

  for (const row of rows) {
    const workflowRunId = row.workflow_run_id === null || row.workflow_run_id === undefined ? null : Number(row.workflow_run_id);
    if (!workflowRunId) continue;
    const workflowRun = workflowRunById.get(workflowRunId);
    if (!workflowRun) continue;

    const nextStatus = String(workflowRun.status) as WorkflowRunStatus;
    if (String(row.status) !== nextStatus) {
      await db.execute(
        `update monthly_run_history
            set status = $1,
                error_message = $2,
                finished_at = case when $3::timestamptz is null then finished_at else $3::timestamptz end
          where id = $4`,
        [nextStatus, workflowRun.error_message ?? null, workflowRun.finished_at ?? null, Number(row.id)],
      );
      row.status = nextStatus;
      row.error_message = workflowRun.error_message ?? null;
      if (workflowRun.finished_at) row.finished_at = workflowRun.finished_at;
    }

    const updatePlanId = row.update_plan_id === null || row.update_plan_id === undefined ? null : Number(row.update_plan_id);
    if (updatePlanId) {
      await updateMonthlyUpdatePlanStatus(db, updatePlanId, planStatusForWorkflowRunStatus(nextStatus));
    }
  }
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
  const updatePlanId = history.update_plan_id === null || history.update_plan_id === undefined ? null : Number(history.update_plan_id);

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
  await updateMonthlyUpdatePlanStatus(db, updatePlanId, planStatusForWorkflowRunStatus(run.status));
}

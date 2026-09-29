import type {
  LatestMonthlyRunOutput,
  MonthlyRunInstanceRecord,
  MonthlyRunInstanceSourceValue,
  MonthlyRunPlanDeleteResult,
  MonthlyRunSourceBinding,
  WorkflowRuntimeParameters,
} from '../../shared/types.js';
import type { QueryResultRow } from 'pg';
import {
  MONTHLY_WORKFLOW_CODE,
  MonthlyRunHistoryDeleteConflictError,
  deleteMonthlyRunHistory,
  type MonthlyRunDb,
} from './store.js';
import { productFileRef } from '../workflow/fileSources.js';

// Cullgen options fixed-value fallbacks for the two instance columns. The real values flow from
// Global Parameters via loadMonthlyRunRuntimeFixedValues at trigger time; these defaults only seed
// a new instance row. Kept local so instanceStore has no dependency on a code-side workflow
// definition (workflow definitions are DB-owned; see CLAUDE.md).
const DEFAULT_OPTIONS_OUTSTANDING_CULLGEN = 4_156_815;
const DEFAULT_OPTIONS_AVAILABLE_CULLGEN = 10_994;
const DEFAULT_WARRANTS_CONVERTIBLE_PREFERRED = 540_666;
const DEFAULT_SERIES_B_PREFERRED_STOCK = 18_486_180;
const DEFAULT_CULLGEN_COMMON_STOCK = 14_450_527;
const DEFAULT_GYRE_2023_CHINA_SUBPLAN_TOTAL = 7_815_396;

type MonthlyRunInstanceRow = Record<string, unknown>;

function toIsoTimestamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}

function toNullableIsoTimestamp(value: unknown): string | null {
  return value === null || value === undefined ? null : toIsoTimestamp(value);
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function toNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function fileKeyFromBinding(binding: MonthlyRunSourceBinding | null | undefined): string {
  return String(binding?.logicalPath ?? binding?.fileKey ?? '').trim();
}

async function resolveMonthlyRunSourceFileId(
  db: MonthlyRunDb,
  binding: MonthlyRunSourceBinding | null | undefined,
): Promise<number | null> {
  if (!binding) return null;
  const fileKey = fileKeyFromBinding(binding);
  if (fileKey) {
    const byKey = await db.queryOne<{ id: number }>(
      `select id
         from product_files
        where logical_path = $1
           or original_name = $1
        order by id desc
        limit 1`,
      [fileKey],
    );
    if (byKey?.id) return Number(byKey.id);
  }
  return binding.fileId ?? null;
}

// Load per-instance input sources (source_key -> value) from the generic child table,
// joining product_files for display name / logical path.
async function loadInstanceSources(
  db: MonthlyRunDb,
  instanceIds: number[],
): Promise<Map<number, Record<string, MonthlyRunInstanceSourceValue>>> {
  const byInstance = new Map<number, Record<string, MonthlyRunInstanceSourceValue>>();
  if (!instanceIds.length) return byInstance;
  const rows = await db.query<Record<string, unknown>>(
    `select s.instance_id, s.source_key, s.file_id, s.sheet_name,
            f.original_name as file_name, f.logical_path
       from monthly_run_instance_sources s
       left join product_files f on f.id = s.file_id
      where s.instance_id = any($1::int[])`,
    [instanceIds],
  );
  for (const row of rows) {
    const instanceId = Number(row.instance_id);
    const map = byInstance.get(instanceId) ?? {};
    map[String(row.source_key)] = {
      fileId: toNullableNumber(row.file_id),
      fileName: row.file_name ? String(row.file_name) : null,
      logicalPath: row.logical_path ? String(row.logical_path) : null,
      sheetName: row.sheet_name ? String(row.sheet_name) : null,
    };
    byInstance.set(instanceId, map);
  }
  return byInstance;
}

function monthlyRunInstanceToRecord(
  row: MonthlyRunInstanceRow,
  sources: Record<string, MonthlyRunInstanceSourceValue>,
): MonthlyRunInstanceRecord {
  return {
    id: Number(row.id),
    monthId: Number(row.month_id),
    monthKey: String(row.month_key),
    workflowCode: String(row.workflow_code ?? MONTHLY_WORKFLOW_CODE),
    operator: String(row.operator ?? 'Administrator'),
    status: String(row.status ?? 'draft'),
    sources,
    fixedValues: {
      optionsOutstandingCullgen: toNumber(row.options_outstanding_cullgen, DEFAULT_OPTIONS_OUTSTANDING_CULLGEN),
      optionsAvailableCullgen: toNumber(row.options_available_cullgen, DEFAULT_OPTIONS_AVAILABLE_CULLGEN),
      warrantsConvertiblePreferred: toNumber(row.warrants_convertible_preferred, DEFAULT_WARRANTS_CONVERTIBLE_PREFERRED),
      seriesBPreferredStock: toNumber(row.series_b_preferred_stock, DEFAULT_SERIES_B_PREFERRED_STOCK),
      cullgenCommonStock: toNumber(row.cullgen_common_stock, DEFAULT_CULLGEN_COMMON_STOCK),
      gyre2023ChinaSubplanTotal: toNumber(row.gyre_2023_china_subplan_total, DEFAULT_GYRE_2023_CHINA_SUBPLAN_TOTAL),
    },
    latestWorkflowRunId: toNullableNumber(row.latest_workflow_run_id),
    latestOutputFileId: toNullableNumber(row.latest_output_file_id),
    latestOutputFileName: row.latest_output_file_name ? String(row.latest_output_file_name) : null,
    latestErrorMessage: row.latest_error_message ? String(row.latest_error_message) : null,
    lastTriggeredAt: toNullableIsoTimestamp(row.last_triggered_at),
    lastFinishedAt: toNullableIsoTimestamp(row.last_finished_at),
    createdAt: toIsoTimestamp(row.created_at),
    updatedAt: toIsoTimestamp(row.updated_at),
  };
}

async function getMonthRow(db: MonthlyRunDb, monthKey: string): Promise<{ id: number; month_key: string } | null> {
  const row = await db.queryOne<{ id: number; month_key: string }>(
    'select id, month_key from months where month_key = $1',
    [monthKey],
  );
  return row ?? null;
}

const INSTANCE_SELECT = `select i.*, output_file.original_name as latest_output_file_name
       from monthly_run_instances i
       left join product_files output_file on output_file.id = i.latest_output_file_id`;

export async function getMonthlyRunInstance(db: MonthlyRunDb, monthKey: string): Promise<MonthlyRunInstanceRecord | null> {
  const row = await db.queryOne<MonthlyRunInstanceRow>(`${INSTANCE_SELECT} where i.month_key = $1`, [monthKey]);
  if (!row) return null;
  const sources = (await loadInstanceSources(db, [Number(row.id)])).get(Number(row.id)) ?? {};
  return monthlyRunInstanceToRecord(row, sources);
}

export async function listMonthlyRunInstances(
  db: MonthlyRunDb,
  params: { month?: string } = {},
): Promise<MonthlyRunInstanceRecord[]> {
  const rows = await db.query<MonthlyRunInstanceRow>(
    `${INSTANCE_SELECT}
      ${params.month ? 'where i.month_key = $1' : ''}
      order by i.month_key desc, i.id desc`,
    params.month ? [params.month] : [],
  );
  const sourcesByInstance = await loadInstanceSources(db, rows.map((row) => Number(row.id)));
  return rows.map((row) => monthlyRunInstanceToRecord(row, sourcesByInstance.get(Number(row.id)) ?? {}));
}

export async function getLatestMonthlyRunOutput(db: MonthlyRunDb): Promise<LatestMonthlyRunOutput | null> {
  const row = await db.queryOne<{
    month_key: string;
    latest_output_file_id: number;
    latest_output_file_name: string;
    last_finished_at: unknown;
  }>(
    `select i.month_key,
            i.latest_output_file_id,
            output_file.original_name as latest_output_file_name,
            i.last_finished_at
       from monthly_run_instances i
       join product_files output_file on output_file.id = i.latest_output_file_id
      where i.status in ('completed', 'completed_with_warnings')
        and i.latest_output_file_id is not null
      order by i.last_finished_at desc nulls last, i.updated_at desc, i.id desc
      limit 1`,
  );
  if (!row) return null;
  return {
    monthKey: String(row.month_key),
    fileId: Number(row.latest_output_file_id),
    fileName: String(row.latest_output_file_name),
    finishedAt: toIsoTimestamp(row.last_finished_at),
  };
}

export async function getMonthlyRunOutputForMonth(
  db: MonthlyRunDb,
  monthKey: string,
): Promise<{ fileId: number; logicalPath: string } | null> {
  const row = await db.queryOne<{ latest_output_file_id: number; logical_path: string }>(
    `select i.latest_output_file_id, f.logical_path
       from monthly_run_instances i
       join product_files f on f.id = i.latest_output_file_id
      where i.month_key = $1
        and i.status in ('completed', 'completed_with_warnings')
        and i.latest_output_file_id is not null
      limit 1`,
    [monthKey],
  );
  if (!row?.latest_output_file_id) return null;
  return { fileId: Number(row.latest_output_file_id), logicalPath: String(row.logical_path) };
}

// Monthly fixed values are now per-instance (no longer a single global set). When a new month's
// instance is created, inherit the 5 fixed values from the most recent prior month; the very
// first month (no prior instance) falls back to the code defaults (which mirror the historical
// global_parameters values).
async function inheritMonthlyFixedValues(
  db: MonthlyRunDb,
  monthKey: string,
): Promise<{
  optionsOutstandingCullgen: number;
  optionsAvailableCullgen: number;
  warrantsConvertiblePreferred: number;
  seriesBPreferredStock: number;
  cullgenCommonStock: number;
  gyre2023ChinaSubplanTotal: number;
}> {
  const prior = await db.queryOne<{
    options_outstanding_cullgen: number | null;
    options_available_cullgen: number | null;
    warrants_convertible_preferred: number | null;
    series_b_preferred_stock: number | null;
    cullgen_common_stock: number | null;
    gyre_2023_china_subplan_total: number | null;
  }>(
    `select options_outstanding_cullgen, options_available_cullgen, warrants_convertible_preferred,
            series_b_preferred_stock, cullgen_common_stock, gyre_2023_china_subplan_total
       from monthly_run_instances
      where month_key < $1
      order by month_key desc
      limit 1`,
    [monthKey],
  );
  return {
    optionsOutstandingCullgen: prior ? toNumber(prior.options_outstanding_cullgen, DEFAULT_OPTIONS_OUTSTANDING_CULLGEN) : DEFAULT_OPTIONS_OUTSTANDING_CULLGEN,
    optionsAvailableCullgen: prior ? toNumber(prior.options_available_cullgen, DEFAULT_OPTIONS_AVAILABLE_CULLGEN) : DEFAULT_OPTIONS_AVAILABLE_CULLGEN,
    warrantsConvertiblePreferred: prior ? toNumber(prior.warrants_convertible_preferred, DEFAULT_WARRANTS_CONVERTIBLE_PREFERRED) : DEFAULT_WARRANTS_CONVERTIBLE_PREFERRED,
    seriesBPreferredStock: prior ? toNumber(prior.series_b_preferred_stock, DEFAULT_SERIES_B_PREFERRED_STOCK) : DEFAULT_SERIES_B_PREFERRED_STOCK,
    cullgenCommonStock: prior ? toNumber(prior.cullgen_common_stock, DEFAULT_CULLGEN_COMMON_STOCK) : DEFAULT_CULLGEN_COMMON_STOCK,
    gyre2023ChinaSubplanTotal: prior ? toNumber(prior.gyre_2023_china_subplan_total, DEFAULT_GYRE_2023_CHINA_SUBPLAN_TOTAL) : DEFAULT_GYRE_2023_CHINA_SUBPLAN_TOTAL,
  };
}

export async function ensureMonthlyRunInstance(db: MonthlyRunDb, monthKey: string): Promise<MonthlyRunInstanceRecord> {
  const existing = await getMonthlyRunInstance(db, monthKey);
  if (existing) return existing;
  const month = await getMonthRow(db, monthKey);
  if (!month) throw new Error(`Month ${monthKey} not found`);

  // Inherit fixed values from the prior month (or defaults for the very first month).
  const fixed = await inheritMonthlyFixedValues(db, monthKey);

  await db.execute(
    `insert into monthly_run_instances (
       month_id, month_key, workflow_code, operator, status,
       options_outstanding_cullgen, options_available_cullgen,
       warrants_convertible_preferred, series_b_preferred_stock, cullgen_common_stock, gyre_2023_china_subplan_total
     )
     values ($1, $2, $3, 'Administrator', 'draft', $4, $5, $6, $7, $8, $9)
     on conflict (month_key) do update set updated_at = current_timestamp`,
    [
      month.id, month.month_key, MONTHLY_WORKFLOW_CODE,
      fixed.optionsOutstandingCullgen, fixed.optionsAvailableCullgen,
      fixed.warrantsConvertiblePreferred, fixed.seriesBPreferredStock, fixed.cullgenCommonStock, fixed.gyre2023ChinaSubplanTotal,
    ],
  );
  const created = await getMonthlyRunInstance(db, monthKey);
  if (!created) throw new Error(`Failed to create monthly run instance for ${monthKey}`);
  return created;
}

export async function upsertMonthlyRunInstance(
  db: MonthlyRunDb,
  monthKey: string,
  params: {
    operator?: string;
    sources?: Record<string, MonthlyRunSourceBinding | null>;
    fixedValues?: Record<string, number>;
  },
): Promise<MonthlyRunInstanceRecord> {
  const existing = await ensureMonthlyRunInstance(db, monthKey);

  const nextFixedValues = {
    optionsOutstandingCullgen:
      params.fixedValues?.optionsOutstandingCullgen ??
      existing.fixedValues.optionsOutstandingCullgen ??
      DEFAULT_OPTIONS_OUTSTANDING_CULLGEN,
    optionsAvailableCullgen:
      params.fixedValues?.optionsAvailableCullgen ??
      existing.fixedValues.optionsAvailableCullgen ??
      DEFAULT_OPTIONS_AVAILABLE_CULLGEN,
    warrantsConvertiblePreferred:
      params.fixedValues?.warrantsConvertiblePreferred ??
      existing.fixedValues.warrantsConvertiblePreferred ??
      DEFAULT_WARRANTS_CONVERTIBLE_PREFERRED,
    seriesBPreferredStock:
      params.fixedValues?.seriesBPreferredStock ??
      existing.fixedValues.seriesBPreferredStock ??
      DEFAULT_SERIES_B_PREFERRED_STOCK,
    cullgenCommonStock:
      params.fixedValues?.cullgenCommonStock ??
      existing.fixedValues.cullgenCommonStock ??
      DEFAULT_CULLGEN_COMMON_STOCK,
    gyre2023ChinaSubplanTotal:
      params.fixedValues?.gyre2023ChinaSubplanTotal ??
      existing.fixedValues.gyre2023ChinaSubplanTotal ??
      DEFAULT_GYRE_2023_CHINA_SUBPLAN_TOTAL,
  };
  await db.execute(
    `update monthly_run_instances
        set operator = $2,
            options_outstanding_cullgen = $3,
            options_available_cullgen = $4,
            warrants_convertible_preferred = $5,
            series_b_preferred_stock = $6,
            cullgen_common_stock = $7,
            gyre_2023_china_subplan_total = $8,
            updated_at = current_timestamp
      where month_key = $1`,
    [
      monthKey, params.operator ?? existing.operator,
      nextFixedValues.optionsOutstandingCullgen, nextFixedValues.optionsAvailableCullgen,
      nextFixedValues.warrantsConvertiblePreferred, nextFixedValues.seriesBPreferredStock, nextFixedValues.cullgenCommonStock, nextFixedValues.gyre2023ChinaSubplanTotal,
    ],
  );

  // Input sources are written to the generic child table (source_key -> file/sheet). Only the keys
  // present in params.sources are touched; a null binding (or an empty one) clears that source.
  if (params.sources) {
    for (const [sourceKey, binding] of Object.entries(params.sources)) {
      const fileId = binding ? await resolveMonthlyRunSourceFileId(db, binding) : null;
      const sheetName = binding?.sheetName?.trim() || null;
      if (fileId === null && !sheetName) {
        await db.execute(
          'delete from monthly_run_instance_sources where instance_id = $1 and source_key = $2',
          [existing.id, sourceKey],
        );
        continue;
      }
      await db.execute(
        `insert into monthly_run_instance_sources (instance_id, source_key, file_id, sheet_name)
         values ($1, $2, $3, $4)
         on conflict (instance_id, source_key)
           do update set file_id = excluded.file_id, sheet_name = excluded.sheet_name`,
        [existing.id, sourceKey, fileId, sheetName],
      );
    }
  }

  return (await getMonthlyRunInstance(db, monthKey)) ?? existing;
}

export function monthlyRunInstanceToRuntimeParameters(instance: MonthlyRunInstanceRecord): WorkflowRuntimeParameters {
  const fileRefs: Record<string, unknown> = {};
  for (const [sourceKey, value] of Object.entries(instance.sources)) {
    const fileKey = value.logicalPath?.trim() ?? '';
    if (!fileKey) continue;
    const fileRef = productFileRef(fileKey) as Record<string, unknown>;
    const sheet = value.sheetName?.trim();
    if (sheet) fileRef.sheet = sheet;
    fileRefs[sourceKey] = fileRef;
  }
  // Migrate instances created before the cancel/restore source split. The old
  // source is treated as the current incremental input; the merge workflow's
  // base input still comes from its configured default/previous output.
  if (fileRefs.cancel_restore_report !== undefined) {
    if (fileRefs.incremental_cancel_restore_report === undefined) {
      fileRefs.incremental_cancel_restore_report = fileRefs.cancel_restore_report;
    }
    delete fileRefs.cancel_restore_report;
  }
  return {
    month: instance.monthKey,
    monthUnderscore: instance.monthKey.replace(/-/g, '_'),
    fileRefs,
    // Series B is derived by the Read SERIES B child workflow and is kept out of
    // the runtime payload so legacy monthly instance rows cannot reintroduce the
    // removed fixedValues.seriesBPreferredStock parameter.
    fixedValues: {
      optionsOutstandingCullgen: instance.fixedValues.optionsOutstandingCullgen,
      optionsAvailableCullgen: instance.fixedValues.optionsAvailableCullgen,
      warrantsConvertiblePreferred: instance.fixedValues.warrantsConvertiblePreferred,
      cullgenCommonStock: instance.fixedValues.cullgenCommonStock,
      gyre2023ChinaSubplanTotal: instance.fixedValues.gyre2023ChinaSubplanTotal,
    },
  };
}

const MONTHLY_RUNTIME_FIXED_VALUE_KEYS = {
  optionsOutstandingCullgen: 'options_outstanding_cullgen',
  optionsAvailableCullgen: 'options_available_cullgen',
  warrantsConvertiblePreferred: 'warrants_convertible_preferred',
  cullgenCommonStock: 'cullgen_common_stock',
  gyre2023ChinaSubplanTotal: 'gyre_2023_china_subplan_total',
} as const;

export async function loadMonthlyRunRuntimeFixedValues(db: MonthlyRunDb): Promise<Record<string, number>> {
  const rows = await db.query<Record<string, unknown>>(
    `select distinct on (key) *
      from global_parameters
     where key = any($1::text[])
      order by key, updated_at desc, id desc`,
    [Object.values(MONTHLY_RUNTIME_FIXED_VALUE_KEYS)],
  );
  const byKey = new Map(rows.map((row) => [String(row.key), Number(row.value)]));
  const missingKeys = Object.values(MONTHLY_RUNTIME_FIXED_VALUE_KEYS).filter((key) => !Number.isFinite(byKey.get(key)));
  if (missingKeys.length) {
    throw new Error(`Missing monthly runtime fixed values: ${missingKeys.join(', ')}`);
  }
  return {
    optionsOutstandingCullgen: Number(byKey.get(MONTHLY_RUNTIME_FIXED_VALUE_KEYS.optionsOutstandingCullgen)),
    optionsAvailableCullgen: Number(byKey.get(MONTHLY_RUNTIME_FIXED_VALUE_KEYS.optionsAvailableCullgen)),
    warrantsConvertiblePreferred: Number(byKey.get(MONTHLY_RUNTIME_FIXED_VALUE_KEYS.warrantsConvertiblePreferred)),
    cullgenCommonStock: Number(byKey.get(MONTHLY_RUNTIME_FIXED_VALUE_KEYS.cullgenCommonStock)),
    gyre2023ChinaSubplanTotal: Number(byKey.get(MONTHLY_RUNTIME_FIXED_VALUE_KEYS.gyre2023ChinaSubplanTotal)),
  };
}

export async function updateMonthlyRunInstanceExecutionState(
  db: MonthlyRunDb,
  params: {
    monthKey: string;
    status?: string;
    latestWorkflowRunId?: number | null;
    latestOutputFileId?: number | null;
    latestErrorMessage?: string | null;
    lastTriggeredAt?: string | null;
    lastFinishedAt?: string | null;
  },
): Promise<void> {
  const current = await ensureMonthlyRunInstance(db, params.monthKey);
  await db.execute(
    `update monthly_run_instances
        set status = $2,
            latest_workflow_run_id = $3,
            latest_output_file_id = $4,
            latest_error_message = $5,
            last_triggered_at = $6,
            last_finished_at = $7,
            updated_at = current_timestamp
      where id = $1`,
    [
      current.id,
      params.status ?? current.status,
      params.latestWorkflowRunId === undefined ? current.latestWorkflowRunId : params.latestWorkflowRunId,
      params.latestOutputFileId === undefined ? current.latestOutputFileId : params.latestOutputFileId,
      params.latestErrorMessage === undefined ? current.latestErrorMessage : params.latestErrorMessage,
      params.lastTriggeredAt === undefined ? current.lastTriggeredAt : params.lastTriggeredAt,
      params.lastFinishedAt === undefined ? current.lastFinishedAt : params.lastFinishedAt,
    ],
  );
}

export async function deleteMonthlyRunInstance(db: MonthlyRunDb, id: number): Promise<void> {
  await db.execute('delete from monthly_run_instances where id = $1', [id]);
}

/**
 * Delete a Monthly Update Plan together with everything the month owns: its run history (and each
 * run's produced output file, via {@link deleteMonthlyRunHistory}) and every file under
 * `input/<monthKey>/`. Files under `control_book/` are left untouched on purpose — month M's merged
 * base is consumed as month M+1's Control Book Summary input, so it belongs to the cross-month
 * chain rather than to this plan.
 *
 * Every conflict check runs before or during the history loop and throws
 * {@link MonthlyRunHistoryDeleteConflictError}, so the caller's transaction rolls the whole cascade
 * back. Returns null when the instance does not exist.
 */
export async function deleteMonthlyRunPlan(
  db: MonthlyRunDb,
  id: number,
): Promise<(MonthlyRunPlanDeleteResult & { deletedFilePaths: string[] }) | null> {
  const instance = await db.queryOne<Record<string, unknown>>(
    `select i.id, i.month_id, i.month_key
       from monthly_run_instances i
      where i.id = $1
      for update`,
    [id],
  );
  if (!instance) return null;

  const monthId = Number(instance.month_id);
  const monthKey = String(instance.month_key);

  // Histories are keyed on month_id: update_plan_id is always null for instance-driven runs.
  const historyRows = await db.query<{ id: number }>(
    `select h.id
       from monthly_run_history h
      where h.month_id = $1
      order by h.id asc`,
    [monthId],
  );

  const deletedOutputFileIds: number[] = [];
  const deletedFilePaths: string[] = [];
  for (const row of historyRows) {
    const deleted = await deleteMonthlyRunHistory(db, Number(row.id));
    if (deleted?.deletedOutputFileId != null) deletedOutputFileIds.push(deleted.deletedOutputFileId);
    if (deleted?.deletedOutputFilePath) deletedFilePaths.push(deleted.deletedOutputFilePath);
  }

  // The trailing slash scopes this to the month's own folder, so it never matches a sibling month
  // like input/2026-06-adjusted/ nor a stray file sitting directly under input/.
  const inputFiles = await db.query<Record<string, unknown>>(
    `select f.id, f.file_path, f.logical_path
       from product_files f
      where f.logical_path like 'input/' || $1 || '/%'`,
    [monthKey],
  );

  if (inputFiles.length) {
    const inputFileIds = inputFiles.map((file) => Number(file.id));
    // Refuse rather than let the file_id foreign key silently blank another live plan's binding.
    const boundElsewhere = await db.query<{ file_id: number }>(
      `select distinct s.file_id
         from monthly_run_instance_sources s
        where s.file_id = any($1::int[])
          and s.instance_id <> $2`,
      [inputFileIds, id],
    );
    if (boundElsewhere.length) {
      const blocked = boundElsewhere.map((row) => `#${Number(row.file_id)}`).join(', ');
      throw new MonthlyRunHistoryDeleteConflictError(`输入文件仍被其他月度计划引用，无法删除：${blocked}`);
    }

    await db.execute('delete from product_files where id = any($1::int[])', [inputFileIds]);
    for (const file of inputFiles) {
      deletedFilePaths.push(String(file.file_path));
    }
  }

  await deleteMonthlyRunInstance(db, id);

  return {
    instanceId: Number(instance.id),
    monthKey,
    deletedHistoryCount: historyRows.length,
    deletedInputFileCount: inputFiles.length,
    deletedOutputFileIds,
    deletedFilePaths,
  };
}

export async function getProductFilesByIds<T extends QueryResultRow = QueryResultRow>(
  db: MonthlyRunDb,
  fileIds: number[],
): Promise<T[]> {
  if (!fileIds.length) return [];
  return db.query<T>('select * from product_files where id = any($1::int[])', [fileIds]);
}

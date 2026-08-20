import type {
  LatestMonthlyRunOutput,
  MonthlyRunInstanceRecord,
  MonthlyRunSourceBinding,
  WorkflowRuntimeParameters,
} from '../../shared/types.js';
import type { QueryResultRow } from 'pg';
import {
  buildMonthlyRuntimeParameters,
  MONTHLY_RUN_FIXED_VALUE_DEFINITIONS,
  MONTHLY_RUN_SOURCE_DEFINITIONS,
  MONTHLY_RUNTIME_OPTIONS_AVAILABLE_CULLGEN,
  MONTHLY_RUNTIME_OPTIONS_OUTSTANDING_CULLGEN,
} from './workflowDefinition.js';
import { MONTHLY_WORKFLOW_CODE, type MonthlyRunDb } from './store.js';
import { productFileRef } from '../workflow/fileSources.js';

type MonthlyRunInstanceRow = Record<string, unknown>;

const SOURCE_COLUMN_BY_KEY: Record<string, string> = {
  base_control_book: 'control_book_file_id',
  incremental_control_book: 'incremental_control_book_file_id',
  options_os_detail_by_plan: 'summary_source_file_id',
  previous_capitalization_summary: 'previous_capitalization_summary_file_id',
  futu_exercises: 'futu_exercises_file_id',
  option_plans_summary: 'option_plans_file_id',
  bc_subplan_transfer: 'bc_subplan_transfer_file_id',
};

const SOURCE_SHEET_COLUMN_BY_KEY: Record<string, string> = {
  option_plans_summary: 'option_plans_sheet_name',
  bc_subplan_transfer: 'bc_subplan_transfer_sheet_name',
};

const FIXED_VALUE_COLUMN_BY_KEY: Record<string, string> = {
  optionsOutstandingCullgen: 'options_outstanding_cullgen',
  optionsAvailableCullgen: 'options_available_cullgen',
};

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

export function monthlyRunInstanceToRecord(row: MonthlyRunInstanceRow): MonthlyRunInstanceRecord {
  const sourceFileNameByKey = {
    base_control_book: row.base_control_book_file_name ? String(row.base_control_book_file_name) : null,
    incremental_control_book: row.incremental_control_book_file_name ? String(row.incremental_control_book_file_name) : null,
    options_os_detail_by_plan: row.options_os_detail_by_plan_file_name ? String(row.options_os_detail_by_plan_file_name) : null,
    previous_capitalization_summary: row.previous_capitalization_summary_file_name
      ? String(row.previous_capitalization_summary_file_name)
      : null,
    futu_exercises: row.futu_exercises_file_name ? String(row.futu_exercises_file_name) : null,
    option_plans_summary: row.option_plans_file_name ? String(row.option_plans_file_name) : null,
    bc_subplan_transfer: row.bc_subplan_transfer_file_name ? String(row.bc_subplan_transfer_file_name) : null,
  };
  const sourceLogicalPathByKey = {
    base_control_book: row.base_control_book_logical_path ? String(row.base_control_book_logical_path) : null,
    incremental_control_book: row.incremental_control_book_logical_path ? String(row.incremental_control_book_logical_path) : null,
    options_os_detail_by_plan: row.options_os_detail_by_plan_logical_path ? String(row.options_os_detail_by_plan_logical_path) : null,
    previous_capitalization_summary: row.previous_capitalization_summary_logical_path ? String(row.previous_capitalization_summary_logical_path) : null,
    futu_exercises: row.futu_exercises_logical_path ? String(row.futu_exercises_logical_path) : null,
    option_plans_summary: row.option_plans_logical_path ? String(row.option_plans_logical_path) : null,
    bc_subplan_transfer: row.bc_subplan_transfer_logical_path ? String(row.bc_subplan_transfer_logical_path) : null,
  };
  return {
    id: Number(row.id),
    monthId: Number(row.month_id),
    monthKey: String(row.month_key),
    workflowCode: String(row.workflow_code ?? MONTHLY_WORKFLOW_CODE),
    operator: String(row.operator ?? 'Administrator'),
    status: String(row.status ?? 'draft'),
    sources: Object.fromEntries(
      MONTHLY_RUN_SOURCE_DEFINITIONS.map((source) => [
        source.sourceKey,
        {
          fileId: toNullableNumber(row[SOURCE_COLUMN_BY_KEY[source.sourceKey]]),
          fileName: sourceFileNameByKey[source.sourceKey as keyof typeof sourceFileNameByKey],
          logicalPath: sourceLogicalPathByKey[source.sourceKey as keyof typeof sourceLogicalPathByKey],
          sheetName: SOURCE_SHEET_COLUMN_BY_KEY[source.sourceKey]
            ? String(row[SOURCE_SHEET_COLUMN_BY_KEY[source.sourceKey]] ?? source.defaultSheetName ?? '').trim() || null
            : source.defaultSheetName ?? null,
        },
      ]),
    ),
    fixedValues: {
      optionsOutstandingCullgen: toNumber(row.options_outstanding_cullgen, MONTHLY_RUNTIME_OPTIONS_OUTSTANDING_CULLGEN),
      optionsAvailableCullgen: toNumber(row.options_available_cullgen, MONTHLY_RUNTIME_OPTIONS_AVAILABLE_CULLGEN),
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
  const row = await db.queryOne<{ id: number; month_key: string }>('select id, month_key from months where month_key = $1', [monthKey]);
  return row ?? null;
}

export async function getMonthlyRunInstance(db: MonthlyRunDb, monthKey: string): Promise<MonthlyRunInstanceRecord | null> {
  const row = await db.queryOne<MonthlyRunInstanceRow>(
    `select i.*,
            base_control_book.original_name as base_control_book_file_name,
            base_control_book.logical_path as base_control_book_logical_path,
            incremental_control_book.original_name as incremental_control_book_file_name,
            incremental_control_book.logical_path as incremental_control_book_logical_path,
            options_os_detail_by_plan.original_name as options_os_detail_by_plan_file_name,
            options_os_detail_by_plan.logical_path as options_os_detail_by_plan_logical_path,
            previous_capitalization_summary.original_name as previous_capitalization_summary_file_name,
            previous_capitalization_summary.logical_path as previous_capitalization_summary_logical_path,
            futu_exercises.original_name as futu_exercises_file_name,
            futu_exercises.logical_path as futu_exercises_logical_path,
            option_plans.original_name as option_plans_file_name,
            option_plans.logical_path as option_plans_logical_path,
            bc_subplan_transfer.original_name as bc_subplan_transfer_file_name,
            bc_subplan_transfer.logical_path as bc_subplan_transfer_logical_path,
            output_file.original_name as latest_output_file_name
       from monthly_run_instances i
       left join product_files base_control_book on base_control_book.id = i.control_book_file_id
       left join product_files incremental_control_book on incremental_control_book.id = i.incremental_control_book_file_id
       left join product_files options_os_detail_by_plan on options_os_detail_by_plan.id = i.summary_source_file_id
       left join product_files previous_capitalization_summary on previous_capitalization_summary.id = i.previous_capitalization_summary_file_id
       left join product_files futu_exercises on futu_exercises.id = i.futu_exercises_file_id
       left join product_files option_plans on option_plans.id = i.option_plans_file_id
       left join product_files bc_subplan_transfer on bc_subplan_transfer.id = i.bc_subplan_transfer_file_id
       left join product_files output_file on output_file.id = i.latest_output_file_id
      where i.month_key = $1`,
    [monthKey],
  );
  return row ? monthlyRunInstanceToRecord(row) : null;
}

export async function listMonthlyRunInstances(
  db: MonthlyRunDb,
  params: { month?: string } = {},
): Promise<MonthlyRunInstanceRecord[]> {
  const rows = await db.query<MonthlyRunInstanceRow>(
    `select i.*,
            base_control_book.original_name as base_control_book_file_name,
            base_control_book.logical_path as base_control_book_logical_path,
            incremental_control_book.original_name as incremental_control_book_file_name,
            incremental_control_book.logical_path as incremental_control_book_logical_path,
            options_os_detail_by_plan.original_name as options_os_detail_by_plan_file_name,
            options_os_detail_by_plan.logical_path as options_os_detail_by_plan_logical_path,
            previous_capitalization_summary.original_name as previous_capitalization_summary_file_name,
            previous_capitalization_summary.logical_path as previous_capitalization_summary_logical_path,
            futu_exercises.original_name as futu_exercises_file_name,
            futu_exercises.logical_path as futu_exercises_logical_path,
            option_plans.original_name as option_plans_file_name,
            option_plans.logical_path as option_plans_logical_path,
            bc_subplan_transfer.original_name as bc_subplan_transfer_file_name,
            bc_subplan_transfer.logical_path as bc_subplan_transfer_logical_path,
            output_file.original_name as latest_output_file_name
       from monthly_run_instances i
       left join product_files base_control_book on base_control_book.id = i.control_book_file_id
       left join product_files incremental_control_book on incremental_control_book.id = i.incremental_control_book_file_id
       left join product_files options_os_detail_by_plan on options_os_detail_by_plan.id = i.summary_source_file_id
       left join product_files previous_capitalization_summary on previous_capitalization_summary.id = i.previous_capitalization_summary_file_id
       left join product_files futu_exercises on futu_exercises.id = i.futu_exercises_file_id
       left join product_files option_plans on option_plans.id = i.option_plans_file_id
       left join product_files bc_subplan_transfer on bc_subplan_transfer.id = i.bc_subplan_transfer_file_id
       left join product_files output_file on output_file.id = i.latest_output_file_id
      ${params.month ? 'where i.month_key = $1' : ''}
      order by i.month_key desc, i.id desc`,
    params.month ? [params.month] : [],
  );
  return rows.map(monthlyRunInstanceToRecord);
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

export async function ensureMonthlyRunInstance(db: MonthlyRunDb, monthKey: string): Promise<MonthlyRunInstanceRecord> {
  const existing = await getMonthlyRunInstance(db, monthKey);
  if (existing) return existing;
  const month = await getMonthRow(db, monthKey);
  if (!month) throw new Error(`Month ${monthKey} not found`);

  const row = await db.queryOne<MonthlyRunInstanceRow>(
    `insert into monthly_run_instances (
       month_id, month_key, workflow_code, operator, status,
       options_outstanding_cullgen, options_available_cullgen
     )
     values ($1, $2, $3, 'Administrator', 'draft', $4, $5)
     on conflict (month_key) do update set updated_at = current_timestamp
     returning *`,
    [
      month.id,
      month.month_key,
      MONTHLY_WORKFLOW_CODE,
      MONTHLY_RUNTIME_OPTIONS_OUTSTANDING_CULLGEN,
      MONTHLY_RUNTIME_OPTIONS_AVAILABLE_CULLGEN,
    ],
  );
  if (!row) throw new Error(`Failed to create monthly run instance for ${monthKey}`);
  return (await getMonthlyRunInstance(db, monthKey)) ?? monthlyRunInstanceToRecord(row);
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

  const nextSourceBindings = Object.fromEntries(
    await Promise.all(MONTHLY_RUN_SOURCE_DEFINITIONS.map(async (source) => {
      const provided = params.sources?.[source.sourceKey];
      const existingBinding = existing.sources[source.sourceKey];
      return [
        source.sourceKey,
        provided === undefined
          ? {
              fileId: existingBinding?.fileId ?? null,
              sheetName: existingBinding?.sheetName ?? source.defaultSheetName ?? null,
            }
          : {
              fileId: await resolveMonthlyRunSourceFileId(db, provided),
              sheetName: provided?.sheetName?.trim() || source.defaultSheetName || null,
            },
      ];
    })),
  ) as Record<string, { fileId: number | null; sheetName: string | null }>;
  const nextFixedValues = {
    optionsOutstandingCullgen:
      params.fixedValues?.optionsOutstandingCullgen ??
      existing.fixedValues.optionsOutstandingCullgen ??
      MONTHLY_RUNTIME_OPTIONS_OUTSTANDING_CULLGEN,
    optionsAvailableCullgen:
      params.fixedValues?.optionsAvailableCullgen ??
      existing.fixedValues.optionsAvailableCullgen ??
      MONTHLY_RUNTIME_OPTIONS_AVAILABLE_CULLGEN,
  };
  const row = await db.queryOne<MonthlyRunInstanceRow>(
    `update monthly_run_instances
        set operator = $2,
            control_book_file_id = $3,
            incremental_control_book_file_id = $13,
            summary_source_file_id = $4,
            previous_capitalization_summary_file_id = $5,
            futu_exercises_file_id = $6,
            option_plans_file_id = $7,
            option_plans_sheet_name = $8,
            bc_subplan_transfer_file_id = $9,
            bc_subplan_transfer_sheet_name = $10,
            options_outstanding_cullgen = $11,
            options_available_cullgen = $12,
            updated_at = current_timestamp
      where month_key = $1
      returning *`,
    [
      monthKey,
      params.operator ?? existing.operator,
      nextSourceBindings.base_control_book.fileId,
      nextSourceBindings.options_os_detail_by_plan.fileId,
      nextSourceBindings.previous_capitalization_summary.fileId,
      nextSourceBindings.futu_exercises.fileId,
      nextSourceBindings.option_plans_summary.fileId,
      nextSourceBindings.option_plans_summary.sheetName,
      nextSourceBindings.bc_subplan_transfer.fileId,
      nextSourceBindings.bc_subplan_transfer.sheetName,
      nextFixedValues.optionsOutstandingCullgen,
      nextFixedValues.optionsAvailableCullgen,
      nextSourceBindings.incremental_control_book.fileId,
    ],
  );
  if (!row) throw new Error(`Failed to update monthly run instance for ${monthKey}`);
  return (await getMonthlyRunInstance(db, monthKey)) ?? monthlyRunInstanceToRecord(row);
}

export function monthlyRunInstanceToRuntimeParameters(instance: MonthlyRunInstanceRecord): WorkflowRuntimeParameters {
  return buildMonthlyRuntimeParameters({
    month: instance.monthKey,
    fileRefs: Object.fromEntries(
      MONTHLY_RUN_SOURCE_DEFINITIONS.flatMap((source) => {
        const fileKey = instance.sources[source.sourceKey]?.logicalPath?.trim() ?? '';
        if (!fileKey) return [];
        const fileRef = productFileRef(fileKey) as Record<string, unknown>;
        if (source.allowSheetNameOverride) {
          fileRef.sheet = instance.sources[source.sourceKey]?.sheetName ?? source.defaultSheetName ?? '';
        }
        return [[source.sourceKey, fileRef] as const];
      }),
    ),
    fixedValues: instance.fixedValues,
  });
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
      params.latestWorkflowRunId ?? current.latestWorkflowRunId,
      params.latestOutputFileId ?? current.latestOutputFileId,
      params.latestErrorMessage === undefined ? current.latestErrorMessage : params.latestErrorMessage,
      params.lastTriggeredAt === undefined ? current.lastTriggeredAt : params.lastTriggeredAt,
      params.lastFinishedAt === undefined ? current.lastFinishedAt : params.lastFinishedAt,
    ],
  );
}

export async function deleteMonthlyRunInstance(db: MonthlyRunDb, id: number): Promise<void> {
  await db.execute('delete from monthly_run_instances where id = $1', [id]);
}

export async function getProductFilesByIds<T extends QueryResultRow = QueryResultRow>(
  db: MonthlyRunDb,
  fileIds: number[],
): Promise<T[]> {
  if (!fileIds.length) return [];
  return db.query<T>('select * from product_files where id = any($1::int[])', [fileIds]);
}

export const MONTHLY_RUN_INSTANCE_SOURCE_COLUMNS = SOURCE_COLUMN_BY_KEY;
export const MONTHLY_RUN_INSTANCE_FIXED_VALUE_COLUMNS = FIXED_VALUE_COLUMN_BY_KEY;
export const MONTHLY_RUN_INSTANCE_FIXED_VALUE_DEFAULTS = Object.fromEntries(
  MONTHLY_RUN_FIXED_VALUE_DEFINITIONS.map((item) => [item.key, item.defaultValue]),
);

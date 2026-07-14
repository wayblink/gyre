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
import type { MonthlyRunDb } from './store.js';
import { productFileRef } from '../workflow/fileSources.js';

type MonthlyRunInstanceRow = Record<string, unknown>;

const SOURCE_COLUMN_BY_KEY: Record<string, string> = {
  control_book: 'control_book_file_id',
  summary_source: 'summary_source_file_id',
  futu_exercises: 'futu_exercises_file_id',
  option_plans: 'option_plans_file_id',
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

export function monthlyRunInstanceToRecord(row: MonthlyRunInstanceRow): MonthlyRunInstanceRecord {
  const sourceFileNameByKey = {
    control_book: row.control_book_file_name ? String(row.control_book_file_name) : null,
    summary_source: row.summary_source_file_name ? String(row.summary_source_file_name) : null,
    futu_exercises: row.futu_exercises_file_name ? String(row.futu_exercises_file_name) : null,
    option_plans: row.option_plans_file_name ? String(row.option_plans_file_name) : null,
  };
  return {
    id: Number(row.id),
    monthId: Number(row.month_id),
    monthKey: String(row.month_key),
    workflowCode: String(row.workflow_code ?? 'gyre-captable-summary'),
    operator: String(row.operator ?? 'Administrator'),
    status: String(row.status ?? 'draft'),
    sources: Object.fromEntries(
      MONTHLY_RUN_SOURCE_DEFINITIONS.map((source) => [
        source.sourceKey,
        {
          fileId: toNullableNumber(row[SOURCE_COLUMN_BY_KEY[source.sourceKey]]),
          fileName: sourceFileNameByKey[source.sourceKey as keyof typeof sourceFileNameByKey],
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
            control_book.original_name as control_book_file_name,
            summary_source.original_name as summary_source_file_name,
            futu_exercises.original_name as futu_exercises_file_name,
            option_plans.original_name as option_plans_file_name,
            output_file.original_name as latest_output_file_name
       from monthly_run_instances i
       left join product_files control_book on control_book.id = i.control_book_file_id
       left join product_files summary_source on summary_source.id = i.summary_source_file_id
       left join product_files futu_exercises on futu_exercises.id = i.futu_exercises_file_id
       left join product_files option_plans on option_plans.id = i.option_plans_file_id
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
            control_book.original_name as control_book_file_name,
            summary_source.original_name as summary_source_file_name,
            futu_exercises.original_name as futu_exercises_file_name,
            option_plans.original_name as option_plans_file_name,
            output_file.original_name as latest_output_file_name
       from monthly_run_instances i
       left join product_files control_book on control_book.id = i.control_book_file_id
       left join product_files summary_source on summary_source.id = i.summary_source_file_id
       left join product_files futu_exercises on futu_exercises.id = i.futu_exercises_file_id
       left join product_files option_plans on option_plans.id = i.option_plans_file_id
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
     values ($1, $2, 'gyre-captable-summary', 'Administrator', 'draft', $3, $4)
     on conflict (month_key) do update set updated_at = current_timestamp
     returning *`,
    [
      month.id,
      month.month_key,
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

  const nextSourceFileIds = Object.fromEntries(
    MONTHLY_RUN_SOURCE_DEFINITIONS.map((source) => [
      source.sourceKey,
      params.sources?.[source.sourceKey] === undefined
        ? existing.sources[source.sourceKey]?.fileId ?? null
        : (params.sources[source.sourceKey]?.fileId ?? null),
    ]),
  );
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
            summary_source_file_id = $4,
            futu_exercises_file_id = $5,
            option_plans_file_id = $6,
            options_outstanding_cullgen = $7,
            options_available_cullgen = $8,
            updated_at = current_timestamp
      where month_key = $1
      returning *`,
    [
      monthKey,
      params.operator ?? existing.operator,
      nextSourceFileIds.control_book,
      nextSourceFileIds.summary_source,
      nextSourceFileIds.futu_exercises,
      nextSourceFileIds.option_plans,
      nextFixedValues.optionsOutstandingCullgen,
      nextFixedValues.optionsAvailableCullgen,
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
        const fileId = instance.sources[source.sourceKey]?.fileId ?? null;
        return fileId ? [[source.sourceKey, productFileRef(fileId)] as const] : [];
      }),
    ),
    fixedValues: instance.fixedValues,
  });
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

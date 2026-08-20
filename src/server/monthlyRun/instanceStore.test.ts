import assert from 'node:assert/strict';
import test from 'node:test';
import type { QueryResultRow } from 'pg';
import type { MonthlyRunInstanceRecord } from '../../shared/types.js';
import type { MonthlyRunDb } from './store.js';
import {
  getLatestMonthlyRunOutput,
  loadMonthlyRunRuntimeFixedValues,
  monthlyRunInstanceToRuntimeParameters,
  upsertMonthlyRunInstance,
} from './instanceStore.js';

function monthlyRunRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const timestamp = new Date('2026-07-13T12:00:00.000Z');
  return {
    id: 2,
    month_id: 2,
    month_key: '2026-06',
    workflow_code: 'gyre-captable-summary-v2',
    operator: 'Administrator',
    status: 'draft',
    options_outstanding_cullgen: 4_156_815,
    options_available_cullgen: 10_994,
    latest_workflow_run_id: null,
    latest_output_file_id: null,
    latest_output_file_name: null,
    latest_error_message: null,
    last_triggered_at: null,
    last_finished_at: null,
    created_at: timestamp,
    updated_at: timestamp,
    ...overrides,
  };
}

function instanceRecord(sources: MonthlyRunInstanceRecord['sources']): MonthlyRunInstanceRecord {
  return {
    id: 2,
    monthId: 2,
    monthKey: '2026-06',
    workflowCode: 'gyre-captable-summary-v2',
    operator: 'Administrator',
    status: 'draft',
    sources,
    fixedValues: { optionsOutstandingCullgen: 4_156_815, optionsAvailableCullgen: 10_994 },
    latestWorkflowRunId: null,
    latestOutputFileId: null,
    latestOutputFileName: null,
    latestErrorMessage: null,
    lastTriggeredAt: null,
    lastFinishedAt: null,
    createdAt: '2026-07-13T12:00:00.000Z',
    updatedAt: '2026-07-13T12:00:00.000Z',
  };
}

test('runtime parameters build fileRefs from instance sources, adding sheet only when set and skipping unconfigured sources', () => {
  const instance = instanceRecord({
    base_control_book: { fileId: 1, fileName: 'control.xlsx', logicalPath: 'input/2026-06/control.xlsx', sheetName: 'EQ Control Book' },
    futu_exercises: { fileId: 3, fileName: 'futu.xlsx', logicalPath: 'input/2026-06/futu.xlsx', sheetName: null },
    option_plans_summary: { fileId: 4, fileName: 'options.xlsx', logicalPath: 'input/2026-06/options.xlsx', sheetName: 'Custom Sheet' },
    previous_capitalization_summary: { fileId: null, fileName: null, logicalPath: null, sheetName: null },
  });

  const runtime = monthlyRunInstanceToRuntimeParameters(instance);

  assert.equal(runtime.month, '2026-06');
  assert.deepEqual(runtime.fileRefs, {
    base_control_book: { provider: 'product-files', key: 'input/2026-06/control.xlsx', sheet: 'EQ Control Book' },
    futu_exercises: { provider: 'product-files', key: 'input/2026-06/futu.xlsx' },
    option_plans_summary: { provider: 'product-files', key: 'input/2026-06/options.xlsx', sheet: 'Custom Sheet' },
  });
  assert.deepEqual(runtime.fixedValues, { optionsOutstandingCullgen: 4_156_815, optionsAvailableCullgen: 10_994 });
});

test('latest monthly output selects the newest successful execution with an existing result file', async () => {
  const calls: Array<{ text: string; params?: unknown[] }> = [];
  const db: MonthlyRunDb = {
    async query() {
      return [];
    },
    async queryOne<T>(text: string, params?: unknown[]): Promise<T | undefined> {
      calls.push({ text, params });
      return {
        month_key: '2026-06',
        latest_output_file_id: 6,
        latest_output_file_name: '2026-06-Capitalization_Table_Summary_View.xlsx',
        last_finished_at: new Date('2026-07-13T09:30:00.000Z'),
      } as T;
    },
    async execute() {},
  };

  const output = await getLatestMonthlyRunOutput(db);

  assert.deepEqual(output, {
    monthKey: '2026-06',
    fileId: 6,
    fileName: '2026-06-Capitalization_Table_Summary_View.xlsx',
    finishedAt: '2026-07-13T09:30:00.000Z',
  });
  const normalizedSql = calls[0]?.text.replace(/\s+/g, ' ').trim() ?? '';
  assert.match(normalizedSql, /join product_files output_file on output_file\.id = i\.latest_output_file_id/);
  assert.match(normalizedSql, /i\.status in \('completed', 'completed_with_warnings'\)/);
  assert.match(normalizedSql, /i\.latest_output_file_id is not null/);
  assert.match(normalizedSql, /order by i\.last_finished_at desc nulls last, i\.updated_at desc, i\.id desc/);
  assert.match(normalizedSql, /limit 1$/);
});

test('monthly runtime fixed values are loaded from latest global parameters', async () => {
  const calls: Array<{ text: string; params?: unknown[] }> = [];
  const db: MonthlyRunDb = {
    async query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]) {
      calls.push({ text, params });
      return [
        { key: 'options_outstanding_cullgen', value: 123 },
        { key: 'options_available_cullgen', value: 456 },
        { key: 'warrants_convertible_preferred', value: 789 },
        { key: 'cullgen_common_stock', value: 111 },
        { key: 'gyre_2023_china_subplan_total', value: 222 },
      ] as unknown as T[];
    },
    async queryOne() {
      return undefined;
    },
    async execute() {},
  };

  const fixedValues = await loadMonthlyRunRuntimeFixedValues(db);

  assert.deepEqual(fixedValues, {
    optionsOutstandingCullgen: 123,
    optionsAvailableCullgen: 456,
    warrantsConvertiblePreferred: 789,
    cullgenCommonStock: 111,
    gyre2023ChinaSubplanTotal: 222,
  });
  const normalizedSql = calls[0]?.text.replace(/\s+/g, ' ').trim() ?? '';
  assert.match(normalizedSql, /from global_parameters/);
  assert.match(normalizedSql, /order by key, updated_at desc, id desc/);
});

test('upserting a monthly source binding resolves logical path and writes the generic sources child table', async () => {
  const executeCalls: Array<{ text: string; params?: unknown[] }> = [];
  const db: MonthlyRunDb = {
    async query() {
      return [];
    },
    async queryOne<T>(text: string): Promise<T | undefined> {
      const sql = text.replace(/\s+/g, ' ').trim();
      if (sql.includes('where i.month_key = $1')) return monthlyRunRow() as T;
      if (sql.includes('from product_files')) return { id: 82 } as T;
      return undefined;
    },
    async execute(text: string, params?: unknown[]) {
      executeCalls.push({ text, params });
    },
  };

  await upsertMonthlyRunInstance(db, '2026-06', {
    sources: {
      base_control_book: {
        fileId: 79,
        logicalPath: 'input/2026-06/Control_Books_Detail_Data.xlsx',
      },
    },
  });

  const childInsert = executeCalls.find((call) => call.text.includes('insert into monthly_run_instance_sources'));
  assert.ok(childInsert, 'expected an insert into the sources child table');
  // instance id 2, source key, file id resolved by logical path (82), no sheet override
  assert.deepEqual(childInsert?.params, [2, 'base_control_book', 82, null]);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import type { QueryResultRow } from 'pg';
import type { MonthlyRunDb } from './store.js';
import {
  getLatestMonthlyRunOutput,
  loadMonthlyRunRuntimeFixedValues,
  monthlyRunInstanceToRecord,
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
    control_book_file_id: null,
    base_control_book_file_name: null,
    base_control_book_logical_path: null,
    incremental_control_book_file_id: null,
    incremental_control_book_file_name: null,
    incremental_control_book_logical_path: null,
    summary_source_file_id: null,
    options_os_detail_by_plan_file_name: null,
    options_os_detail_by_plan_logical_path: null,
    previous_capitalization_summary_file_id: null,
    previous_capitalization_summary_file_name: null,
    previous_capitalization_summary_logical_path: null,
    futu_exercises_file_id: null,
    futu_exercises_file_name: null,
    futu_exercises_logical_path: null,
    option_plans_file_id: null,
    option_plans_file_name: null,
    option_plans_logical_path: null,
    option_plans_sheet_name: null,
    bc_subplan_transfer_file_id: null,
    bc_subplan_transfer_file_name: null,
    bc_subplan_transfer_logical_path: null,
    bc_subplan_transfer_sheet_name: null,
    options_outstanding_cullgen: 4_156_815,
    options_available_cullgen: 10_994,
    created_at: timestamp,
    updated_at: timestamp,
    ...overrides,
  };
}

test('monthly run instance persists one-to-one source bindings including optional options os detail by plan source', () => {
  const timestamp = new Date('2026-07-13T12:00:00.000Z');
  const instance = monthlyRunInstanceToRecord({
    id: 2,
    month_id: 2,
    month_key: '2026-06',
    workflow_code: 'gyre-captable-summary-v2',
    operator: 'Administrator',
    status: 'draft',
    control_book_file_id: 1,
    base_control_book_file_name: 'control.xlsx',
    base_control_book_logical_path: 'input/2026-06/control.xlsx',
    incremental_control_book_file_id: 7,
    incremental_control_book_file_name: 'control-detail.xlsx',
    incremental_control_book_logical_path: 'input/2026-06/control-detail.xlsx',
    summary_source_file_id: 2,
    options_os_detail_by_plan_file_name: 'options-os-detail.xlsx',
    options_os_detail_by_plan_logical_path: 'input/2026-06/options-os-detail.xlsx',
    previous_capitalization_summary_file_id: 5,
    previous_capitalization_summary_file_name: 'previous-summary.xlsx',
    previous_capitalization_summary_logical_path: 'input/2026-06/previous-summary.xlsx',
    futu_exercises_file_id: 3,
    futu_exercises_file_name: 'futu.xlsx',
    futu_exercises_logical_path: 'input/2026-06/futu.xlsx',
    option_plans_file_id: 4,
    option_plans_file_name: 'options.xlsx',
    option_plans_logical_path: 'input/2026-06/options.xlsx',
    option_plans_sheet_name: 'Option Plans Custom Sheet',
    bc_subplan_transfer_file_id: 6,
    bc_subplan_transfer_file_name: 'bc-subplan.xlsx',
    bc_subplan_transfer_logical_path: 'input/2026-06/bc-subplan.xlsx',
    bc_subplan_transfer_sheet_name: 'Vesting Schedule',
    options_outstanding_cullgen: 4_156_815,
    options_available_cullgen: 10_994,
    created_at: timestamp,
    updated_at: timestamp,
  });

  assert.deepEqual(instance.sources, {
    base_control_book: { fileId: 1, fileName: 'control.xlsx', logicalPath: 'input/2026-06/control.xlsx', sheetName: 'EQ Control Book' },
    incremental_control_book: { fileId: 7, fileName: 'control-detail.xlsx', logicalPath: 'input/2026-06/control-detail.xlsx', sheetName: '27591' },
    options_os_detail_by_plan: { fileId: 2, fileName: 'options-os-detail.xlsx', logicalPath: 'input/2026-06/options-os-detail.xlsx', sheetName: 'Options OS Detail' },
    previous_capitalization_summary: { fileId: 5, fileName: 'previous-summary.xlsx', logicalPath: 'input/2026-06/previous-summary.xlsx', sheetName: 'Capitalization Summary' },
    futu_exercises: { fileId: 3, fileName: 'futu.xlsx', logicalPath: 'input/2026-06/futu.xlsx', sheetName: 'Futu BCI Exercises to Date' },
    option_plans_summary: { fileId: 4, fileName: 'options.xlsx', logicalPath: 'input/2026-06/options.xlsx', sheetName: 'Option Plans Custom Sheet' },
    bc_subplan_transfer: { fileId: 6, fileName: 'bc-subplan.xlsx', logicalPath: 'input/2026-06/bc-subplan.xlsx', sheetName: 'Vesting Schedule' },
  });
  assert.deepEqual(monthlyRunInstanceToRuntimeParameters(instance).fileRefs, {
    base_control_book: { provider: 'product-files', key: 'input/2026-06/control.xlsx', sheet: 'EQ Control Book' },
    incremental_control_book: { provider: 'product-files', key: 'input/2026-06/control-detail.xlsx', sheet: '27591' },
    options_os_detail_by_plan: { provider: 'product-files', key: 'input/2026-06/options-os-detail.xlsx' },
    previous_capitalization_summary: { provider: 'product-files', key: 'input/2026-06/previous-summary.xlsx' },
    futu_exercises: { provider: 'product-files', key: 'input/2026-06/futu.xlsx' },
    option_plans_summary: { provider: 'product-files', key: 'input/2026-06/options.xlsx', sheet: 'Option Plans Custom Sheet' },
    bc_subplan_transfer: { provider: 'product-files', key: 'input/2026-06/bc-subplan.xlsx', sheet: 'Vesting Schedule' },
  });
  assert.equal(monthlyRunInstanceToRuntimeParameters(instance).sheetNames, undefined);
  assert.equal(monthlyRunInstanceToRuntimeParameters(instance).transferDecision, undefined);
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
  });
  const normalizedSql = calls[0]?.text.replace(/\s+/g, ' ').trim() ?? '';
  assert.match(normalizedSql, /from global_parameters/);
  assert.match(normalizedSql, /order by key, updated_at desc, id desc/);
  assert.deepEqual(calls[0]?.params, [['options_outstanding_cullgen', 'options_available_cullgen', 'warrants_convertible_preferred']]);
});

test('upserting monthly source bindings resolves overwritten files by logical path before persisting ids', async () => {
  const queryOneCalls: Array<{ text: string; params?: unknown[] }> = [];
  const updatedRow = monthlyRunRow({
    control_book_file_id: 82,
    base_control_book_file_name: 'Control_Books_Detail_Data.xlsx',
    base_control_book_logical_path: 'input/2026-06/Control_Books_Detail_Data.xlsx',
  });
  const db: MonthlyRunDb = {
    async query() {
      return [];
    },
    async queryOne<T>(text: string, params?: unknown[]): Promise<T | undefined> {
      queryOneCalls.push({ text, params });
      const normalizedSql = text.replace(/\s+/g, ' ').trim();
      if (normalizedSql.includes('where i.month_key = $1')) {
        return (queryOneCalls.filter((call) => call.text.includes('where i.month_key = $1')).length === 1
          ? monthlyRunRow()
          : updatedRow) as T;
      }
      if (normalizedSql.includes('from product_files')) {
        return { id: 82 } as T;
      }
      if (normalizedSql.startsWith('update monthly_run_instances')) {
        assert.equal(params?.[2], 82);
        return updatedRow as T;
      }
      return undefined;
    },
    async execute() {},
  };

  const instance = await upsertMonthlyRunInstance(db, '2026-06', {
    sources: {
      base_control_book: {
        fileId: 79,
        logicalPath: 'input/2026-06/Control_Books_Detail_Data.xlsx',
      },
    },
  });

  assert.equal(instance.sources.base_control_book.fileId, 82);
  assert.equal(instance.sources.base_control_book.logicalPath, 'input/2026-06/Control_Books_Detail_Data.xlsx');
  assert.ok(queryOneCalls.some((call) => call.text.includes('where logical_path = $1')));
});

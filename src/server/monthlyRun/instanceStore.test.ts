import assert from 'node:assert/strict';
import test from 'node:test';
import type { QueryResultRow } from 'pg';
import type { MonthlyRunDb } from './store.js';
import {
  getLatestMonthlyRunOutput,
  loadMonthlyRunRuntimeFixedValues,
  monthlyRunInstanceToRecord,
  monthlyRunInstanceToRuntimeParameters,
} from './instanceStore.js';

test('monthly run instance persists one-to-one source bindings including optional previous summary source', () => {
  const timestamp = new Date('2026-07-13T12:00:00.000Z');
  const instance = monthlyRunInstanceToRecord({
    id: 2,
    month_id: 2,
    month_key: '2026-06',
    workflow_code: 'gyre-captable-summary',
    operator: 'Administrator',
    status: 'draft',
    control_book_file_id: 1,
    control_book_file_name: 'control.xlsx',
    summary_source_file_id: 2,
    summary_source_file_name: 'summary.xlsx',
    previous_capitalization_summary_file_id: 5,
    previous_capitalization_summary_file_name: 'previous-summary.xlsx',
    futu_exercises_file_id: 3,
    futu_exercises_file_name: 'futu.xlsx',
    option_plans_file_id: 4,
    option_plans_file_name: 'options.xlsx',
    options_outstanding_cullgen: 4_156_815,
    options_available_cullgen: 10_994,
    created_at: timestamp,
    updated_at: timestamp,
  });

  assert.deepEqual(instance.sources, {
    control_book: { fileId: 1, fileName: 'control.xlsx' },
    summary_source: { fileId: 2, fileName: 'summary.xlsx' },
    previous_capitalization_summary: { fileId: 5, fileName: 'previous-summary.xlsx' },
    futu_exercises: { fileId: 3, fileName: 'futu.xlsx' },
    option_plans: { fileId: 4, fileName: 'options.xlsx' },
  });
  assert.deepEqual(monthlyRunInstanceToRuntimeParameters(instance).fileRefs, {
    control_book: { provider: 'product-files', id: 1 },
    summary_source: { provider: 'product-files', id: 2 },
    previous_capitalization_summary: { provider: 'product-files', id: 5 },
    futu_exercises: { provider: 'product-files', id: 3 },
    option_plans: { provider: 'product-files', id: 4 },
  });
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
  });
  const normalizedSql = calls[0]?.text.replace(/\s+/g, ' ').trim() ?? '';
  assert.match(normalizedSql, /from global_parameters/);
  assert.match(normalizedSql, /order by key, updated_at desc, id desc/);
});

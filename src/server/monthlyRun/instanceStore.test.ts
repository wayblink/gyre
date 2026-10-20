import assert from 'node:assert/strict';
import test from 'node:test';
import type { QueryResultRow } from 'pg';
import type { MonthlyRunInstanceRecord } from '../../shared/types.js';
import type { MonthlyRunDb } from './store.js';
import {
  deleteMonthlyRunPlan,
  getLatestMonthlyRunOutput,
  loadMonthlyRunRuntimeFixedValues,
  monthlyRunInstanceToRuntimeParameters,
  upsertMonthlyRunInstance,
  updateMonthlyRunInstanceExecutionState,
} from './instanceStore.js';

test('execution state update preserves undefined fields but clears explicit null ids', async () => {
  const executeCalls: Array<{ text: string; params?: unknown[] }> = [];
  const db: MonthlyRunDb = {
    async query() {
      return [];
    },
    async queryOne<T>(): Promise<T | undefined> {
      return monthlyRunRow({ latest_workflow_run_id: 45, latest_output_file_id: 99 }) as T;
    },
    async execute(text: string, params?: unknown[]) {
      executeCalls.push({ text, params });
    },
  };

  await updateMonthlyRunInstanceExecutionState(db, {
    monthKey: '2026-06',
    status: 'running',
    latestWorkflowRunId: null,
    latestOutputFileId: null,
  });

  assert.equal(executeCalls[0]?.params?.[2], null);
  assert.equal(executeCalls[0]?.params?.[3], null);
});

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
    series_b_preferred_stock: 18_486_180,
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
    fixedValues: {
      optionsOutstandingCullgen: 4_156_815,
      optionsAvailableCullgen: 10_994,
      seriesBPreferredStock: 18_486_180,
    },
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
    base_control_book: {
      fileId: 1,
      fileName: 'control.xlsx',
      logicalPath: 'input/2026-06/control.xlsx',
      sheetName: 'EQ Control Book',
    },
    futu_exercises: { fileId: 3, fileName: 'futu.xlsx', logicalPath: 'input/2026-06/futu.xlsx', sheetName: null },
    option_plans_summary: {
      fileId: 4,
      fileName: 'options.xlsx',
      logicalPath: 'input/2026-06/options.xlsx',
      sheetName: 'Custom Sheet',
    },
    cancel_restore_report: {
      fileId: 6,
      fileName: 'cancel.xlsx',
      logicalPath: 'input/2026-06/cancel.xlsx',
      sheetName: '取消与恢复明细',
    },
    previous_capitalization_summary: { fileId: null, fileName: null, logicalPath: null, sheetName: null },
  });
  const runtime = monthlyRunInstanceToRuntimeParameters(instance);

  assert.equal(runtime.month, '2026-06');
  assert.equal(runtime.monthUnderscore, '2026_06');
  assert.deepEqual(runtime.fileRefs, {
    base_control_book: { provider: 'product-files', key: 'input/2026-06/control.xlsx', sheet: 'EQ Control Book' },
    option_plans_summary: { provider: 'product-files', key: 'input/2026-06/options.xlsx', sheet: 'Custom Sheet' },
    incremental_cancel_restore_report: {
      provider: 'product-files',
      key: 'input/2026-06/cancel.xlsx',
      sheet: '取消与恢复明细',
    },
  });
  assert.deepEqual(runtime.fixedValues, {
    optionsOutstandingCullgen: 4_156_815,
    optionsAvailableCullgen: 10_994,
    warrantsConvertiblePreferred: undefined,
    cullgenCommonStock: undefined,
    gyre2023ChinaSubplanTotal: undefined,
  });
});

test('runtime parameters drop the legacy single Futu source so a stale binding cannot fail validation', () => {
  const instance = instanceRecord({
    futu_exercises: {
      fileId: 3,
      fileName: '!!Gyre Cap Table 01.31.26.xlsx',
      logicalPath: 'input/2026-01/!!Gyre Cap Table 01.31.26.xlsx',
      sheetName: 'Futu BCI Exercises to Date',
    },
    base_futu_exercises: {
      fileId: 9,
      fileName: 'Futu_Exercises_Base_2026_05.xlsx',
      logicalPath: 'futu_exercises/Futu_Exercises_Base_2026_05.xlsx',
      sheetName: 'Futu BCI Exercises',
    },
  });

  const runtime = monthlyRunInstanceToRuntimeParameters(instance);

  assert.deepEqual(Object.keys(runtime.fileRefs as Record<string, unknown>), ['base_futu_exercises']);
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

function completedHistoryRow(historyId: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: historyId,
    month_id: 11,
    month_key: '2026-06',
    workflow_run_id: 200 + historyId,
    status: 'completed',
    produced_file_id: 500 + historyId,
    produced_file_path: `product/output/captable/2026-06-run-${historyId}.xlsx`,
    produced_file_name: `2026-06-run-${historyId}.xlsx`,
    ...overrides,
  };
}

/**
 * deleteMonthlyRunPlan reuses the real deleteMonthlyRunHistory, so the stub has to answer that
 * helper's three queries too. Unexpected SQL throws on purpose: a new statement must be wired here
 * deliberately rather than silently returning nothing.
 */
function planDeleteStub(
  config: {
    instance?: Record<string, unknown> | null;
    historyIds?: number[];
    historyRow?: (historyId: number) => Record<string, unknown>;
    sharedOutput?: (historyId: number) => { id: number } | undefined;
    inputFiles?: Array<Record<string, unknown>>;
    boundElsewhere?: Array<{ file_id: number }>;
    failOnWrite?: boolean;
  } = {},
) {
  const executed: Array<{ sql: string; params: unknown[] }> = [];
  const queried: Array<{ sql: string; params: unknown[] }> = [];
  const removedPaths: string[] = [];
  const instance = config.instance === undefined ? { id: 5, month_id: 11, month_key: '2026-06' } : config.instance;
  const historyIds = config.historyIds ?? [];

  const db: MonthlyRunDb = {
    async query<T extends QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
      queried.push({ sql, params });
      if (/from monthly_run_history/i.test(sql) && /order by h\.id asc/i.test(sql)) {
        return historyIds.map((id) => ({ id })) as unknown as T[];
      }
      if (/from product_files/i.test(sql) && /logical_path like/i.test(sql)) {
        return (config.inputFiles ?? []) as unknown as T[];
      }
      if (/from monthly_run_instance_sources/i.test(sql)) {
        return (config.boundElsewhere ?? []) as unknown as T[];
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    async queryOne<T extends QueryResultRow>(sql: string, params: unknown[] = []): Promise<T | undefined> {
      queried.push({ sql, params });
      if (/from monthly_run_instances i/i.test(sql) && /for update/i.test(sql)) {
        return (instance ?? undefined) as T | undefined;
      }
      if (/where h\.id = \$1/i.test(sql) && /for update of h/i.test(sql)) {
        const historyId = Number(params[0]);
        return (config.historyRow?.(historyId) ?? completedHistoryRow(historyId)) as T;
      }
      if (/h\.id <> \$2/i.test(sql) && /produced_file_id is not null/i.test(sql)) {
        return undefined;
      }
      if (/select h\.id from monthly_run_history/i.test(sql)) {
        return config.sharedOutput?.(Number(params[1])) as T | undefined;
      }
      throw new Error(`Unexpected queryOne: ${sql}`);
    },
    async execute(sql: string, params: unknown[] = []): Promise<void> {
      if (config.failOnWrite) assert.fail(`nothing must be written, got: ${sql}`);
      executed.push({ sql, params });
    },
  };

  const removeStoredFile = async (filePath: string) => {
    if (config.failOnWrite) assert.fail(`no stored file must be removed, got: ${filePath}`);
    removedPaths.push(filePath);
  };

  return { db, executed, queried, removedPaths, removeStoredFile };
}

test('deleteMonthlyRunPlan returns null when the instance does not exist', async () => {
  const stub = planDeleteStub({ instance: null, failOnWrite: true });
  assert.equal(await deleteMonthlyRunPlan(stub.db, 5), null);
  assert.deepEqual(stub.removedPaths, []);
});

test('deleteMonthlyRunPlan returns physical paths for cleanup only after the transaction commits', async () => {
  const stub = planDeleteStub({
    historyIds: [7, 9],
    inputFiles: [
      { id: 88, file_path: 'product/input/2026-06/detail.xlsx', logical_path: 'input/2026-06/detail.xlsx' },
      { id: 89, file_path: 'product/input/2026-06/unbound.xlsx', logical_path: 'input/2026-06/unbound.xlsx' },
    ],
  });

  assert.deepEqual(await deleteMonthlyRunPlan(stub.db, 5), {
    instanceId: 5,
    monthKey: '2026-06',
    deletedHistoryCount: 2,
    deletedInputFileCount: 2,
    deletedOutputFileIds: [507, 509],
    deletedFilePaths: [
      'product/output/captable/2026-06-run-7.xlsx',
      'product/output/captable/2026-06-run-9.xlsx',
      'product/input/2026-06/detail.xlsx',
      'product/input/2026-06/unbound.xlsx',
    ],
  });

  for (const historyId of [7, 9]) {
    assert.ok(
      stub.executed.some((call) => /delete from monthly_run_history/i.test(call.sql) && call.params[0] === historyId),
    );
  }
  assert.ok(
    stub.executed.some(
      (call) =>
        /delete from product_files where id = any/i.test(call.sql) &&
        Array.isArray(call.params[0]) &&
        (call.params[0] as number[]).join() === '88,89',
    ),
  );

  // Physical removal uses file_path, never logical_path.
  assert.deepEqual(stub.removedPaths, []);

  // The instance row goes last, so the source bindings stay readable for the ownership guard.
  const deletes = stub.executed.filter((call) => /delete from/i.test(call.sql));
  assert.match(deletes[deletes.length - 1].sql, /delete from monthly_run_instances/i);
});

test('deleteMonthlyRunPlan aborts when a history is running and mutates nothing', async () => {
  const stub = planDeleteStub({
    historyIds: [8],
    historyRow: (historyId) =>
      completedHistoryRow(historyId, { status: 'running', produced_file_id: null, produced_file_path: null }),
    failOnWrite: true,
  });

  await assert.rejects(() => deleteMonthlyRunPlan(stub.db, 5), /仍在执行中，不能删除/);
});

test('deleteMonthlyRunPlan refuses when a month-scoped input file is bound by another instance', async () => {
  const stub = planDeleteStub({
    historyIds: [],
    inputFiles: [{ id: 88, file_path: 'product/input/2026-06/shared.xlsx', logical_path: 'input/2026-06/shared.xlsx' }],
    boundElsewhere: [{ file_id: 88 }],
    failOnWrite: true,
  });

  await assert.rejects(() => deleteMonthlyRunPlan(stub.db, 5), /其他月度计划引用/);
});

test('deleteMonthlyRunPlan handles a plan with zero histories and zero input files', async () => {
  const stub = planDeleteStub({ historyIds: [], inputFiles: [] });

  assert.deepEqual(await deleteMonthlyRunPlan(stub.db, 5), {
    instanceId: 5,
    monthKey: '2026-06',
    deletedHistoryCount: 0,
    deletedInputFileCount: 0,
    deletedOutputFileIds: [],
    deletedFilePaths: [],
  });
  assert.deepEqual(stub.removedPaths, []);
  const deletes = stub.executed.filter((call) => /delete from/i.test(call.sql));
  assert.equal(deletes.length, 1);
  assert.match(deletes[0].sql, /delete from monthly_run_instances/i);
  assert.equal(deletes[0].params[0], 5);
});

test('deleteMonthlyRunPlan does not match sibling-month or root-level input files', async () => {
  const stub = planDeleteStub({ historyIds: [], inputFiles: [] });
  await deleteMonthlyRunPlan(stub.db, 5);

  const inputSelect = stub.queried.find((call) => /logical_path like/i.test(call.sql));
  assert.ok(inputSelect, 'input files must be selected by logical_path');
  // The trailing slash keeps input/2026-06-x/... and root-level input/*.xlsx out of scope.
  assert.match(inputSelect.sql.replace(/\s+/g, ' '), /logical_path like 'input\/' \|\| \$1 \|\| '\/%'/);
  assert.deepEqual(inputSelect.params, ['2026-06']);
});

test('deleteMonthlyRunPlan surfaces the shared-output conflict from the first history', async () => {
  // Two histories pointing at one produced file: the existing guard in deleteMonthlyRunHistory
  // refuses, so the whole cascade fails atomically rather than deleting a still-referenced file.
  const stub = planDeleteStub({
    historyIds: [7, 9],
    historyRow: (historyId) =>
      completedHistoryRow(historyId, {
        produced_file_id: 88,
        produced_file_path: 'product/output/captable/shared.xlsx',
      }),
    sharedOutput: (historyId) => (historyId === 7 ? { id: 9 } : undefined),
  });

  await assert.rejects(() => deleteMonthlyRunPlan(stub.db, 5), /仍被其他月度历史引用/);
  assert.ok(!stub.executed.some((call) => /delete from monthly_run_instances/i.test(call.sql)));
});

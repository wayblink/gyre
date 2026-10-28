import assert from 'node:assert/strict';
import test from 'node:test';
import type { QueryResultRow } from 'pg';
import type { MonthlyRunInstanceRecord } from '../../shared/types.js';
import type { MonthlyRunDb } from './store.js';
import {
  deleteMonthlyRunPlan,
  ensureMonthlyRunInstance,
  getLatestMonthlyRunOutput,
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

/**
 * 0 is a legitimate monthly constant: Cullgen common stock is 0 for every month before the 2026-05 merger,
 * and the SubPlan total is 0 before 2024-07. The workflow derives those values from the Control Book with
 * the same As-of cut-off, so a 0 constant reconciles against a 0 derived value. Only a negative value —
 * which no real share count can be — is refused, and an inherited 0 must survive as 0 rather than quietly
 * reverting to the default (that would hand a pre-merger month the merger shares).
 */
test('saving a monthly constant of 0 is accepted and stored as 0', async () => {
  const executeCalls: Array<{ text: string; params?: unknown[] }> = [];
  const db: MonthlyRunDb = {
    async query() {
      return [];
    },
    async queryOne<T>(text: string): Promise<T | undefined> {
      const sql = text.replace(/\s+/g, ' ').trim();
      if (sql.includes('where i.month_key = $1')) return monthlyRunRow() as T;
      return undefined;
    },
    async execute(text: string, params?: unknown[]) {
      executeCalls.push({ text, params });
    },
  };

  await upsertMonthlyRunInstance(db, '2026-06', { fixedValues: { cullgenCommonStock: 0 } });

  const update = executeCalls.find((call) => call.text.includes('update monthly_run_instances'));
  assert.ok(update, 'expected the instance update');
  // (month_key, operator, options_outstanding, options_available, warrants, series_b, cullgen, subplan)
  assert.equal(update?.params?.[6], 0);
});

test('saving one monthly constant leaves the other five columns untouched', async () => {
  // A partial save (the page sends one key per row) must not reset the rest: zeroing the Cullgen option
  // constants here would silently drop 4.1M shares out of Total Fully Diluted on the next run.
  const executeCalls: Array<{ text: string; params?: unknown[] }> = [];
  const db: MonthlyRunDb = {
    async query() {
      return [];
    },
    async queryOne<T>(text: string): Promise<T | undefined> {
      const sql = text.replace(/\s+/g, ' ').trim();
      if (sql.includes('where i.month_key = $1')) {
        return monthlyRunRow({
          options_outstanding_cullgen: 4_156_815,
          options_available_cullgen: 10_994,
          warrants_convertible_preferred: 540_666,
          series_b_preferred_stock: 18_486_180,
          cullgen_common_stock: 14_450_527,
          gyre_2023_china_subplan_total: 7_815_396,
        }) as T;
      }
      return undefined;
    },
    async execute(text: string, params?: unknown[]) {
      executeCalls.push({ text, params });
    },
  };

  await upsertMonthlyRunInstance(db, '2026-06', { fixedValues: { cullgenCommonStock: 0 } });

  const update = executeCalls.find((call) => call.text.includes('update monthly_run_instances'));
  assert.ok(update, 'expected the instance update');
  const params = update?.params ?? [];
  // 0 month_key, 1 operator, 2 options_outstanding, 3 options_available, 4 warrants, 5 series_b,
  // 6 cullgen_common_stock, 7 gyre_2023_china_subplan_total
  assert.equal(params[2], 4_156_815);
  assert.equal(params[3], 10_994);
  assert.equal(params[4], 540_666);
  assert.equal(params[5], 18_486_180);
  assert.equal(params[6], 0, 'the edited constant is the one that changes');
  assert.equal(params[7], 7_815_396);
});

test('saving a negative monthly constant is rejected', async () => {
  const db: MonthlyRunDb = {
    async query() {
      return [];
    },
    async queryOne<T>(text: string): Promise<T | undefined> {
      const sql = text.replace(/\s+/g, ' ').trim();
      if (sql.includes('where i.month_key = $1')) return monthlyRunRow() as T;
      return undefined;
    },
    async execute() {},
  };

  await assert.rejects(
    () => upsertMonthlyRunInstance(db, '2026-06', { fixedValues: { cullgenCommonStock: -1 } }),
    /cullgen_common_stock.*zero or a positive number/i,
  );
});

test('a month inherits a 0 baseline as 0, and only a missing value falls back to the default', async () => {
  // 2026-01..04 legitimately carry 0 Cullgen common stock; inheriting the default would block those months.
  const zero = await inheritFromPriorMonth(monthlyRunRow({ month_key: '2026-06', cullgen_common_stock: 0 }));
  assert.equal(zero.cullgenCommonStock, 0);

  const set = await inheritFromPriorMonth(monthlyRunRow({ month_key: '2026-06', cullgen_common_stock: 12_345_678 }));
  assert.equal(set.cullgenCommonStock, 12_345_678);

  const missing = await inheritFromPriorMonth(monthlyRunRow({ month_key: '2026-06', cullgen_common_stock: null }));
  assert.equal(missing.cullgenCommonStock, 14_450_527);

  const negative = await inheritFromPriorMonth(monthlyRunRow({ month_key: '2026-06', cullgen_common_stock: -5 }));
  assert.equal(negative.cullgenCommonStock, 14_450_527);
});

/**
 * Creates 2026-07 with no instance of its own and returns the fixed values it inherited. The insert's
 * parameter order is the column order of `monthly_run_instances`, so the captured values are read back by
 * that position rather than by re-implementing the inheritance rule here.
 */
async function inheritFromPriorMonth(
  priorRow: Record<string, unknown>,
): Promise<MonthlyRunInstanceRecord['fixedValues']> {
  let insertParams: unknown[] = [];
  const db: MonthlyRunDb = {
    async query() {
      return [];
    },
    async queryOne<T>(text: string): Promise<T | undefined> {
      const sql = text.replace(/\s+/g, ' ').trim();
      if (sql.includes('from monthly_run_instances') && sql.includes('where month_key < $1')) return priorRow as T;
      if (sql.includes('where i.month_key = $1')) {
        // The instance is created by the insert below; mirror it back so ensureMonthlyRunInstance's
        // read-after-write succeeds and the captured parameters are the value under test.
        if (!insertParams.length) return undefined as unknown as T;
        return monthlyRunRow({
          month_key: '2026-07',
          options_outstanding_cullgen: insertParams[3],
          options_available_cullgen: insertParams[4],
          warrants_convertible_preferred: insertParams[5],
          series_b_preferred_stock: insertParams[6],
          cullgen_common_stock: insertParams[7],
          gyre_2023_china_subplan_total: insertParams[8],
        }) as T;
      }
      if (sql.includes('from months')) return { id: 3, month_key: '2026-07' } as T;
      return undefined;
    },
    async execute(text: string, params?: unknown[]) {
      if (text.includes('insert into monthly_run_instances')) insertParams = params ?? [];
    },
  };

  const instance = await ensureMonthlyRunInstance(db, '2026-07');
  assert.ok(insertParams.length > 0, 'expected the instance insert to run');
  // (month_id, month_key, workflow_code, options_outstanding, options_available, warrants, series_b,
  //  cullgen_common_stock, gyre_2023_china_subplan_total)
  assert.equal(insertParams[1], '2026-07');
  return instance.fixedValues;
}

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

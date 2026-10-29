import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import type { WorkflowDataFrame, WorkflowTask } from '../../shared/types.js';
import { rowsToDataFrame } from '../excel.js';
import { dataframeEnsureColumnsOperator } from './operators/dataframeEnsureColumns.js';
import { evaluateShapeAssertion } from './operators/dataframeShapeAssert.js';
import { executeSqlDataFrameQuery } from './operators/sqlUtils.js';
import type { WorkflowOperatorExecutionContext, WorkflowOperatorRuntime } from './operators/types.js';

/**
 * The monthly Futu exercise chain must be fed by the 行权汇总数据 sheet, not 行权明细数据.
 *
 * Futu's "员工行权记录" export carries two sheets of the same exercises: a per-order detail sheet (59 columns,
 * with 行权订单编号 and cancelled orders) and the aggregate sheet 行权汇总数据 (13 columns, one row per
 * employee + grant + exercise date, closed by a 合计 row). The detail sheet is a screen export — its column
 * set and page window are whatever the operator happened to have open — so keying the to-date base on
 * 行权订单编号 makes the monthly numbers depend on the export's shape: a re-export with different headers makes
 * the increment guard fail outright (production hit exactly that: "缺少幂等键或行权日期列: missing=[全部 14 列]"),
 * and a page-limited export silently drops orders the base never had.
 *
 * The summary sheet is the business aggregate: same exercised quantity (verified against the 2026-06 and
 * 2026-08 exports: 320,738 / 82,509), no cancelled-order rows, and a stable grain the record page already
 * merges on (esop-exercise-record-sync). So the monthly base keys on Employee No. + Grant No. + Exercise Date.
 */

const seedPath = path.join(process.cwd(), 'database', 'workflows', 'futu-exercises-incremental-merge.json');

type Row = Record<string, unknown>;

type SeedTask = {
  id: string;
  operatorCode: string;
  params: Record<string, unknown> & { sql?: string; emptyColumns?: string };
  inputs?: Record<string, { guards?: Array<{ params: Record<string, unknown> }> }>;
};

function seedTask(taskId: string): SeedTask {
  const seed = JSON.parse(readFileSync(seedPath, 'utf8')) as { tasks: SeedTask[] };
  const task = seed.tasks.find((item) => item.id === taskId);
  assert.ok(task, `the Futu merge workflow must still carry ${taskId}`);
  return task;
}

function serial(iso: string): number {
  return Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86_400_000);
}

const runtime = {
  rowsToDataFrame: (rows: Array<Record<string, unknown>>) => ({
    columns: Object.keys(rows[0] ?? {}),
    rows,
    index: rows.map((_, index) => index + 1),
    matrix: [],
    range: { sheetName: 'result', a1Range: '', startRow: 1, endRow: rows.length, startCol: 1, endCol: 1 },
  }),
} as unknown as WorkflowOperatorRuntime;

function frame(rows: Row[], columns: string[]): WorkflowDataFrame {
  return {
    columns,
    rows,
    index: rows.map((_, index) => index + 1),
    matrix: [],
    range: {
      sheetName: 'frame',
      a1Range: '',
      startRow: 1,
      endRow: rows.length + 1,
      startCol: 1,
      endCol: columns.length,
    },
  };
}

const RECORD_SEED = path.join(process.cwd(), 'database', 'workflows', 'esop-exercise-record-sync.json');

function recordTask(taskId: string): SeedTask {
  const seed = JSON.parse(readFileSync(RECORD_SEED, 'utf8')) as { tasks: SeedTask[] };
  const task = seed.tasks.find((item) => item.id === taskId);
  assert.ok(task, `the record sync workflow must still carry ${taskId}`);
  return task;
}

async function runTaskFrom(
  task: SeedTask,
  slots: Record<string, WorkflowDataFrame>,
  workflowMonth = '2026-08',
): Promise<Row[]> {
  const params = { ...task.params } as Record<string, unknown>;
  if (params.constants) params.constants = { workflowMonth };
  const bound = {
    id: task.id,
    name: task.id,
    operatorCode: task.operatorCode,
    operatorVersion: '1.0.0',
    description: '',
    x: 0,
    y: 0,
    params,
    inputs: Object.fromEntries(Object.keys(slots).map((slot) => [slot, { from: slot, slot: 'dataframe' }])),
    dependsOn: [],
  } as unknown as WorkflowTask;
  const { dataFrame } = await executeSqlDataFrameQuery(bound, runtime, async (slotName: string) => {
    const frameForSlot = slots[slotName];
    assert.ok(frameForSlot, `unexpected slot ${slotName}`);
    return frameForSlot;
  });
  return dataFrame.rows;
}

async function runTask(
  taskId: string,
  slots: Record<string, WorkflowDataFrame>,
  workflowMonth = '2026-08',
): Promise<Row[]> {
  return runTaskFrom(seedTask(taskId), slots, workflowMonth);
}

const SUMMARY_COLUMNS = [
  '姓名',
  '工号',
  '牛牛号',
  '用户ID',
  '授予编号',
  '授予日期',
  '授予价(USD)',
  '行权日期',
  '行权下单数量',
  '行权成功数量',
  '行权成本(USD)',
  '扣除/卖出数量',
  '成交数量',
];

const BASE_COLUMNS = [
  'Exercise Order No.',
  'Name',
  'Employee No.',
  'Futubull ID',
  'User ID',
  'Grant No.',
  'Grant Date',
  'Grant Price(USD)',
  'Exercise Date',
  'Ordered Qty',
  'Exercised Qty',
  'Exercise Cost(USD)',
  'Deduction/Selling Qty.',
  'Dealt Qty.',
];

function summaryRow(overrides: Row = {}): Row {
  return {
    姓名: '叶卫国',
    工号: 'K00252',
    牛牛号: '26823650',
    用户ID: '12942000007',
    授予编号: 'K00252',
    授予日期: '2023-10-31',
    '授予价(USD)': '0.75000',
    行权日期: '2026-08-27',
    行权下单数量: 5500,
    行权成功数量: 3770,
    '行权成本(USD)': 2827.5,
    '扣除/卖出数量': 3770,
    成交数量: 3770,
    ...overrides,
  };
}

function baseRow(overrides: Row = {}): Row {
  return {
    'Exercise Order No.': 'XQDD20260827000001',
    Name: '叶卫国',
    'Employee No.': 'K00252',
    'Futubull ID': '26823650',
    'User ID': '12942000007',
    'Grant No.': 'K00252',
    'Grant Date': '2023-10-31',
    'Grant Price(USD)': '0.75000',
    'Exercise Date': '2026-08-27',
    'Ordered Qty': 5500,
    'Exercised Qty': 3770,
    'Exercise Cost(USD)': 2827.5,
    'Deduction/Selling Qty.': 3770,
    'Dealt Qty.': 3770,
    ...overrides,
  };
}

test('the increment extracts 行权汇总数据 (13 columns), not 行权明细数据', () => {
  const task = seedTask('extract_increment_futu_exercises');
  const params = task.params as Record<string, unknown>;
  const sheetName = params.sheetName as { $default?: string };
  const fileRef = params.fileRef as { $default?: { sheet?: string } };
  assert.equal(sheetName.$default, '行权汇总数据');
  assert.equal(fileRef.$default?.sheet, '行权汇总数据');
  assert.equal(params.range, 'A1:M');
  const emptyColumns = String(params.emptyColumns ?? '');
  for (const column of SUMMARY_COLUMNS) assert.ok(emptyColumns.includes(column), `缺少列 ${column}`);
  assert.ok(!emptyColumns.includes('行权订单编号'), '明细列 行权订单编号 不该再出现在增量契约里');

  // The guard is a column-count contract now: the increment may be the Chinese summary or the cap table's
  // English to-date sheet, so "which header language" is decided by the projection, not by the guard.
  const projection = seedTask('project_futu_exercises_increment');
  const guards = (projection.inputs?.increment?.guards ?? []) as Array<{ type: string; params: Record<string, unknown> }>;
  const shape = guards.find((guard) => guard.type === 'dataframe.shape.assert');
  assert.ok(shape, 'the increment must be guarded by a column-shape assertion');
  assert.equal(shape.params.expectedColumns, 13);
  assert.equal(shape.params.columnOperator, '=');
  assert.equal(shape.params.rowOperator, 'any', '未提供文件时是 0 行，行数不能成为拦截条件');
});

test('the 合计 row and rows after the run month never reach the base', async () => {
  const projected = await runTask('project_futu_exercises_increment', {
    increment: frame(
      [
        summaryRow(),
        summaryRow({ 姓名: '合计', 工号: '', 行权日期: '', 行权下单数量: 86144, 行权成功数量: 82509 }),
        summaryRow({ 工号: 'K00266', 行权日期: '2026-09-02', 行权成功数量: 999 }),
      ],
      SUMMARY_COLUMNS,
    ),
  });
  assert.equal(projected.length, 1, `expected only the in-month employee row, got ${projected.length}`);
  assert.equal(projected[0]?.['Employee No.'], 'K00252');
  assert.equal(projected[0]?.['Exercised Qty'], 3770);
});

test('a summary re-statement replaces the base grain even when the base row carries an order number', async () => {
  const projected = await runTask('project_futu_exercises_increment', {
    increment: frame([summaryRow()], SUMMARY_COLUMNS),
  });
  const retained = await runTask('retain_base_futu_exercises', {
    base: frame([baseRow()], BASE_COLUMNS),
    increment: frame(projected, BASE_COLUMNS),
  });
  assert.equal(retained.length, 0, 'the same employee+grant+day is re-stated by the summary, so the base copy must go');

  const merged = await runTask('merge_futu_exercises', {
    base: frame(retained, BASE_COLUMNS),
    increment: frame(projected, BASE_COLUMNS),
  });
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.['Exercised Qty'], 3770);
});

test('merging the same summary twice is still idempotent', async () => {
  const projected = await runTask('project_futu_exercises_increment', {
    increment: frame([summaryRow()], SUMMARY_COLUMNS),
  });
  const first = await runTask('merge_futu_exercises', {
    base: frame([], BASE_COLUMNS),
    increment: frame(projected, BASE_COLUMNS),
  });
  const second = await runTask('merge_futu_exercises', {
    base: frame(first, BASE_COLUMNS),
    increment: frame(projected, BASE_COLUMNS),
  });
  assert.equal(second.length, 1);
  assert.equal(second[0]?.['Exercised Qty'], 3770);
});

test('history rows the increment does not mention survive, and their order numbers are kept', async () => {
  const merged = await runTask('merge_futu_exercises', {
    base: frame(
      [baseRow({ 'Exercise Order No.': '', 'Exercise Date': '2024-08-26', 'Exercised Qty': 2000, 'Employee No.': 'K00381' })],
      BASE_COLUMNS,
    ),
    increment: frame([], BASE_COLUMNS),
  });
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.['Exercised Qty'], 2000);
});

test('a base the increment fully re-states keeps its 14-column contract (April 2026: to-date sheet as increment)', async () => {
  // `retain_base_futu_exercises` drops every base row whose grain the increment re-states. Feed it the cap
  // table's full to-date sheet and that is every row, so the SQL result is empty — and `sql.compute` returns a
  // frame with no columns for an empty result. Production hit exactly that: the merge guard then failed with
  // "Retained Futu base is missing a merge key column: missing=[Exercise Order No., Grant No., Exercise Date,
  // Exercised Qty]". The workflow must restore the column contract before the merge guard reads it.
  const projected = await runTask('project_futu_exercises_increment', {
    increment: frame([summaryRow()], SUMMARY_COLUMNS),
  });
  const retained = await runTask('retain_base_futu_exercises', {
    base: frame([baseRow()], BASE_COLUMNS),
    increment: frame(projected, BASE_COLUMNS),
  });
  assert.equal(retained.length, 0, 'every base row is re-stated by the increment');

  const ensured = (await dataframeEnsureColumnsOperator.execute({
    task: seedTask('ensure_retained_futu_base_columns') as unknown as WorkflowTask,
    runtime: { rowsToDataFrame } as unknown as WorkflowOperatorRuntime,
    runtimeParameters: {},
    executed: new Map(),
    taskMap: new Map(),
    async executeTask() {
      throw new Error('not used');
    },
    async resolveInputDataFrame() {
      return frame(retained, []);
    },
  } as unknown as WorkflowOperatorExecutionContext)) as unknown as WorkflowDataFrame;
  assert.equal(ensured.columns.length, BASE_COLUMNS.length);

  const merged = await runTask('merge_futu_exercises', { base: ensured, increment: frame(projected, BASE_COLUMNS) });
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.['Exercised Qty'], 3770);

  const mergeTask = seedTask('merge_futu_exercises');
  assert.equal(
    (mergeTask.inputs?.base as { from?: string } | undefined)?.from,
    'ensure_retained_futu_base_columns',
    'the merge must read the column-restored retained base',
  );
});

test('the base date column may be an Excel serial while the summary carries text', async () => {
  const projected = await runTask('project_futu_exercises_increment', {
    increment: frame([summaryRow({ 行权日期: '2026-08-27' })], SUMMARY_COLUMNS),
  });
  const retained = await runTask('retain_base_futu_exercises', {
    base: frame([baseRow({ 'Exercise Date': serial('2026-08-27') })], BASE_COLUMNS),
    increment: frame(projected, BASE_COLUMNS),
  });
  assert.equal(retained.length, 0, 'the same calendar day must compare equal across cell types');
});

/* ---------------------------------------------------------------------------------------------------
 * The cap table workbooks (`!!Gyre Cap Table MM.DD.YY.xlsx`) carry the same table as the monthly
 * export's 行权汇总数据 sheet, only with English headers: Name, Employee No., Futubull ID, User ID,
 * Grant No., Grant Date, Grant Price(USD), Exercise Date, Ordered Qty, Exercised Qty,
 * Exercise Cost(USD), Deduction/Selling Qty., Dealt Qty. — 13 columns, same order, same grain, and the
 * same numbers (the 05.31.26 workbook's own 合计 row says 2,938,523 exercised to 2026-05, which is
 * exactly what our base sums to through May). What differs is only the sheet name and the language of
 * the headers, so one projection must read both.
 * -------------------------------------------------------------------------------------------------- */

const ENGLISH_COLUMNS = [
  'Name',
  'Employee No.',
  'Futubull ID',
  'User ID',
  'Grant No.',
  'Grant Date',
  'Grant Price(USD)',
  'Exercise Date',
  'Ordered Qty',
  'Exercised Qty',
  'Exercise Cost(USD)',
  'Deduction/Selling Qty.',
  'Dealt Qty.',
];

function englishRow(overrides: Row = {}): Row {
  return {
    Name: '叶卫国',
    'Employee No.': 'K00252',
    'Futubull ID': '26823650',
    'User ID': '12942000007',
    'Grant No.': 'K00252',
    'Grant Date': '2023-10-31',
    'Grant Price(USD)': '0.75000',
    'Exercise Date': '2026-08-27',
    'Ordered Qty': 5500,
    'Exercised Qty': 3770,
    'Exercise Cost(USD)': 2827.5,
    'Deduction/Selling Qty.': 3770,
    'Dealt Qty.': 3770,
    ...overrides,
  };
}

test("the cap table's English to-date sheet projects to the same base contract", async () => {
  const projected = await runTask('project_futu_exercises_increment', {
    increment: frame(
      [
        englishRow(),
        englishRow({ Name: 'in Total', 'Employee No.': '', 'Exercise Date': '', 'Exercised Qty': 2938523 }),
      ],
      ENGLISH_COLUMNS,
    ),
  });
  assert.equal(projected.length, 1, `expected only the employee row, got ${projected.length}`);
  assert.equal(projected[0]?.['Employee No.'], 'K00252');
  assert.equal(projected[0]?.['Exercised Qty'], 3770);
  assert.equal(projected[0]?.['Exercise Date'], '2026-08-27');
});

test("the cap table's to-date sheet is cut at the run month like the Chinese summary", async () => {
  const projected = await runTask(
    'project_futu_exercises_increment',
    { increment: frame([englishRow(), englishRow({ 'Exercise Date': '2026-09-03', 'Exercised Qty': 10 })], ENGLISH_COLUMNS) },
    '2026-08',
  );
  assert.equal(projected.length, 1);
  assert.equal(projected[0]?.['Exercise Date'], '2026-08-27');
});

function projectionGuard(type: string) {
  const task = seedTask('project_futu_exercises_increment');
  const guards = (task.inputs?.increment?.guards ?? []) as Array<{ type: string; params: Record<string, unknown> }>;
  const guard = guards.find((item) => item.type === type);
  assert.ok(guard, `the increment guard ${type} is missing`);
  return { taskId: task.id, operatorCode: type, params: guard.params } as unknown as WorkflowTask;
}

test('a 13-column sheet passes the column-shape guard, the 59-column detail sheet does not', () => {
  const guardTask = projectionGuard('dataframe.shape.assert');
  const thirteen = evaluateShapeAssertion(guardTask, frame([englishRow()], ENGLISH_COLUMNS));
  assert.equal(thirteen.passed, true, JSON.stringify(thirteen));

  const fiftyNine = evaluateShapeAssertion(
    guardTask,
    frame([englishRow()], [...ENGLISH_COLUMNS, ...Array.from({ length: 46 }, (_, index) => `extra_${index}`)]),
  );
  assert.equal(fiftyNine.passed, false, '行权明细数据 has 59 columns and must be rejected as the increment');
});

test('a 13-column base (cap table to-date sheet) still satisfies the 14-column base guard', async () => {
  const ensureTask = seedTask('ensure_base_futu_exercises_columns') as unknown as WorkflowTask;
  const dataFrame = (await dataframeEnsureColumnsOperator.execute({
    task: ensureTask,
    runtime: { rowsToDataFrame } as unknown as WorkflowOperatorRuntime,
    runtimeParameters: {},
    executed: new Map(),
    taskMap: new Map(),
    async executeTask() {
      throw new Error('not used');
    },
    async resolveInputDataFrame() {
      return frame([englishRow()], ENGLISH_COLUMNS);
    },
  } as unknown as WorkflowOperatorExecutionContext)) as unknown as WorkflowDataFrame;
  assert.ok(dataFrame.columns.includes('Exercise Order No.'), `columns: ${dataFrame.columns.join(', ')}`);
  assert.equal(dataFrame.columns.length, ENGLISH_COLUMNS.length + 1);

  const merged = await runTask('merge_futu_exercises', {
    base: dataFrame,
    increment: frame([], BASE_COLUMNS),
  });
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.['Exercised Qty'], 3770);
});

/**
 * The same input feeds the record page's Futu view through `esop-exercise-record-sync`, so the cap table
 * workbook has to work there too: its extract must take the sheet the operator picked (instead of a
 * hard-coded 行权汇总数据) and its projection must read either header language.
 */
test('the record page sync takes the chosen sheet and reads both header flavours', async () => {
  const extract = recordTask('extract_exercises');
  const sheetName = extract.params.sheetName as { $default?: string; $fromRuntime?: string };
  assert.equal(typeof sheetName, 'object', 'the sheet must come from the runtime file reference, not be hard-coded');
  assert.equal(sheetName.$default, '行权汇总数据');
  assert.equal(sheetName.$fromRuntime, 'fileRefs.futu_exercises.sheet');

  const projected = await runTaskFrom(recordTask('project_futu_exercise_summary'), {
    input1: frame(
      [englishRow(), englishRow({ Name: 'in Total', 'Employee No.': '', 'Exercise Date': '', 'Exercised Qty': 2938523 })],
      ENGLISH_COLUMNS,
    ),
  });
  assert.equal(projected.length, 1, `expected only the employee row, got ${projected.length}`);
  assert.equal(projected[0]?.['Employee No.'], 'K00252');
  assert.equal(projected[0]?.['Exercised Qty'], 3770);

  const chinese = await runTaskFrom(recordTask('project_futu_exercise_summary'), {
    input1: frame([summaryRow()], SUMMARY_COLUMNS),
  });
  assert.equal(chinese.length, 1);
  assert.equal(chinese[0]?.['Exercised Qty'], 3770);
});

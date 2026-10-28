import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import type { WorkflowDataFrame, WorkflowTask } from '../../shared/types.js';
import { normalizeInputGuards } from './inputGuards.js';
import { compareAssertValues } from './operators/assertUtils.js';
import { executeSqlDataFrameQuery } from './operators/sqlUtils.js';
import type { WorkflowOperatorRuntime } from './operators/types.js';

/**
 * Futu exercised quantity must be truncated at the run month.
 *
 * `BCI Shares Held by Futu = China Subplan total − Futu Exercised Qty`, and every Control Book metric is
 * truncated with `wf_month_key([As of Date]) <= workflowMonth` so one workbook can re-compute any historical
 * month. The Futu side was not: it summed whatever the bound base file happened to contain. Base files are
 * "to date" merges (a file named `Futu_Exercises_Base_2026_01.xlsx` legitimately contains 2026-05 rows), so
 * back-computing 2026-01 summed exercises through 2026-05 — 2,938,523 instead of the 2,796,246 the business
 * expects, understating BCI by 142,277 and overstating Common Shares OS by the same amount.
 *
 * The operator's numbers are the fixture: 2,796,246 of exercises up to 2025-12, BCI 5,019,150.
 */

const seedPath = path.join(process.cwd(), 'database', 'workflows', 'gyre-captable-summary-v2.json');

type SeedTask = {
  id: string;
  operatorCode: string;
  params: Record<string, unknown> & { sql?: string };
  inputs?: Record<string, { guards?: unknown[] }>;
};

type Guard = { id: string; name: string; enabled?: boolean; params: Record<string, unknown> };

const runtime = {
  rowsToDataFrame: (rows: Array<Record<string, unknown>>) => ({
    columns: Object.keys(rows[0] ?? {}),
    rows,
    index: rows.map((_, index) => index + 1),
    matrix: [],
    range: { sheetName: 'result', a1Range: '', startRow: 1, endRow: rows.length, startCol: 1, endCol: 1 },
  }),
} as unknown as WorkflowOperatorRuntime;

function seedTask(taskId: string): SeedTask {
  const seed = JSON.parse(readFileSync(seedPath, 'utf8')) as { tasks: SeedTask[] };
  const task = seed.tasks.find((item) => item.id === taskId);
  assert.ok(task, `the monthly seed must still carry ${taskId}`);
  return task;
}

function futuWarnGuard(): Guard {
  const task = seedTask('calc_futu_metrics');
  const guards = normalizeInputGuards(task.inputs?.futu?.guards ?? []) as Guard[];
  const guard = guards.find((item) => item.params.failureStrategy === 'warning');
  assert.ok(guard, 'calc_futu_metrics must warn when the file carries exercises dated after the run month');
  return guard;
}

function frame(rows: Array<Record<string, unknown>>, columns: string[]): WorkflowDataFrame {
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

const FUTU_COLUMNS = ['Exercise Order No.', 'Employee No.', 'Exercise Date', 'Exercised Qty'];

/** Real month-end totals from the Futu base files (see the incident notes in the file header). */
function futuRows(): Array<Record<string, unknown>> {
  const monthly = [
    ['2025-11', 179_213],
    ['2025-12', 244_413],
    ['2026-03', 23_114],
    ['2026-04', 501],
    ['2026-05', 118_662],
  ] as const;
  const rows: Array<Record<string, unknown>> = [];
  let order = 1;
  for (const [month, qty] of monthly) {
    rows.push({
      'Exercise Order No.': `EX-${order++}`,
      'Employee No.': `E${order}`,
      'Exercise Date': new Date(`${month}-15T00:00:00Z`),
      'Exercised Qty': qty,
    });
  }
  return rows;
}

const SUBPLAN_TOTAL = 7_815_396;

function controlMetricsFrame(): WorkflowDataFrame {
  return frame([{ gyre_2023_china_subplan_total: SUBPLAN_TOTAL }], ['gyre_2023_china_subplan_total']);
}

async function calcFutuMetrics(
  futu: WorkflowDataFrame,
  workflowMonth: string,
): Promise<{ exercised: number; bci: number }> {
  const task = seedTask('calc_futu_metrics');
  const bound = {
    id: task.id,
    name: 'Calc Futu Exercise Metrics',
    operatorCode: task.operatorCode,
    operatorVersion: '1.0.0',
    description: '',
    x: 0,
    y: 0,
    params: { ...task.params, constants: { workflowMonth } },
    inputs: {
      futu: { from: 'invoke_futu_exercises_merge', slot: 'dataframe' },
      control_metrics: { from: 'calc_control_book_metrics', slot: 'dataframe' },
    },
    dependsOn: [],
  } as unknown as WorkflowTask;
  const frames: Record<string, WorkflowDataFrame> = { futu, control_metrics: controlMetricsFrame() };
  const { dataFrame } = await executeSqlDataFrameQuery(bound, runtime, async (inputSlot: string) => {
    assert.ok(frames[inputSlot], `unexpected input ${inputSlot}`);
    return frames[inputSlot];
  });
  return {
    exercised: Number(dataFrame.rows[0]?.futu_exercised_qty),
    bci: Number(dataFrame.rows[0]?.bci_shares_held_by_futu),
  };
}

async function evaluateWarnGuard(futu: WorkflowDataFrame, workflowMonth: string) {
  const guard = futuWarnGuard();
  const bound = {
    id: guard.id,
    name: guard.name,
    operatorCode: 'dataframe.sql.assert',
    operatorVersion: '1.0.0',
    description: '',
    x: 0,
    y: 0,
    params: {
      ...guard.params,
      constants: { workflowMonth },
      tableBindings: [{ inputSlot: 'futu', tableName: 'futu' }],
    },
    inputs: { futu: { from: 'invoke_futu_exercises_merge', slot: 'dataframe' } },
    dependsOn: [],
  } as unknown as WorkflowTask;
  const { dataFrame } = await executeSqlDataFrameQuery(bound, runtime, async () => futu);
  const actual = dataFrame.rows[0]?.[dataFrame.columns[0] ?? ''];
  const isOneCell = dataFrame.rows.length === 1 && dataFrame.columns.length === 1;
  const passed = compareAssertValues(actual, guard.params.expectedValue, (guard.params.operator ?? '=') as '=');
  return { passed: isOneCell && passed, message: String(actual ?? '') };
}

test('January exercises are truncated at the run month, reproducing the business number', async () => {
  const result = await calcFutuMetrics(frame(futuRows(), FUTU_COLUMNS), '2026-01');
  // 2025-11 179,213 + 2025-12 244,413; the 2026-03/04/05 rows must not count.
  assert.equal(result.exercised, 423_626);
  assert.equal(result.bci, SUBPLAN_TOTAL - 423_626);
});

test('a month that covers all dated rows keeps summing everything', async () => {
  const allDated = 179_213 + 244_413 + 23_114 + 501 + 118_662;
  const result = await calcFutuMetrics(frame(futuRows(), FUTU_COLUMNS), '2026-05');
  assert.equal(result.exercised, allDated);
  assert.equal(result.bci, SUBPLAN_TOTAL - allDated);
});

test('the operator fixture: 2,796,246 of exercises up to 2025-12 gives BCI 5,019,150', async () => {
  const rows = [
    ...Array.from({ length: 1 }, () => ({
      'Exercise Order No.': 'EX-A',
      'Employee No.': 'E1',
      'Exercise Date': new Date('2025-12-20T00:00:00Z'),
      'Exercised Qty': 2_796_246,
    })),
    {
      'Exercise Order No.': 'EX-B',
      'Employee No.': 'E2',
      'Exercise Date': new Date('2026-03-10T00:00:00Z'),
      'Exercised Qty': 142_277,
    },
  ];
  const january = await calcFutuMetrics(frame(rows, FUTU_COLUMNS), '2026-01');
  assert.equal(january.exercised, 2_796_246);
  assert.equal(january.bci, 5_019_150);

  const march = await calcFutuMetrics(frame(rows, FUTU_COLUMNS), '2026-03');
  assert.equal(march.exercised, 2_796_246 + 142_277);
});

test('blank employee numbers and the header row are still excluded, and undated rows still count', async () => {
  const rows = [
    {
      'Exercise Order No.': 'EX-1',
      'Employee No.': '员工编号',
      'Exercise Date': new Date('2025-12-01T00:00:00Z'),
      'Exercised Qty': 999,
    },
    {
      'Exercise Order No.': 'EX-2',
      'Employee No.': '',
      'Exercise Date': new Date('2025-12-01T00:00:00Z'),
      'Exercised Qty': 888,
    },
    { 'Exercise Order No.': 'EX-3', 'Employee No.': 'E1', 'Exercise Date': null, 'Exercised Qty': 100 },
    {
      'Exercise Order No.': 'EX-4',
      'Employee No.': 'E2',
      'Exercise Date': new Date('2025-12-31T00:00:00Z'),
      'Exercised Qty': 200,
    },
  ];
  const result = await calcFutuMetrics(frame(rows, FUTU_COLUMNS), '2026-01');
  // Undated rows count (same convention as the BC Subplan transfer sum): only rows that are dated *after*
  // the run month are excluded, so a formatting quirk cannot silently drop a row.
  assert.equal(result.exercised, 300);
});

test('the run warns when the file carries exercises dated after the run month', async () => {
  const january = await evaluateWarnGuard(frame(futuRows(), FUTU_COLUMNS), '2026-01');
  assert.equal(january.passed, false, 'the excluded future rows must be visible on the run page');
  assert.match(january.message, /2026-0[345]/);
  assert.match(january.message, /142,277|142277/);

  const may = await evaluateWarnGuard(frame(futuRows(), FUTU_COLUMNS), '2026-05');
  assert.equal(may.passed, true, 'nothing is excluded once the run month covers the file');
});

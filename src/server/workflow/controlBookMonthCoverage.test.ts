import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import type { WorkflowDataFrame, WorkflowTask } from '../../shared/types.js';
import { compareAssertValues } from './operators/assertUtils.js';
import { executeSqlDataFrameQuery } from './operators/sqlUtils.js';
import type { WorkflowOperatorRuntime } from './operators/types.js';

/**
 * A month with no Control Book activity still has to run.
 *
 * The Control Book records transactions, so a quiet month adds no row: February's workbook is January's, with
 * the balance carried forward. The old guard demanded a row inside the run month and blocked that run
 * outright ("no Issued & Outstanding row found in the workflow month"), even though carrying the balance
 * forward is the correct answer.
 *
 * The guard still exists for the case it was written for — running a month against a workbook that stopped
 * weeks earlier — so it accepts the run month or the month before it, and blocks anything staler.
 */

const seedPath = path.join(process.cwd(), 'database', 'workflows', 'gyre-captable-summary-v2.json');

type Row = Record<string, unknown>;

const runtime = {
  rowsToDataFrame: (rows: Array<Record<string, unknown>>) => ({
    columns: Object.keys(rows[0] ?? {}),
    rows,
    index: rows.map((_, index) => index + 1),
    matrix: [],
    range: { sheetName: 'result', a1Range: '', startRow: 1, endRow: rows.length, startCol: 1, endCol: 1 },
  }),
} as unknown as WorkflowOperatorRuntime;

function guardTask(): WorkflowTask {
  const seed = JSON.parse(readFileSync(seedPath, 'utf8')) as {
    tasks: Array<{
      id: string;
      operatorCode: string;
      params: Record<string, unknown>;
      inputs?: WorkflowTask['inputs'];
    }>;
  };
  const task = seed.tasks.find((item) => item.id === 'assert_control_book_workflow_month');
  assert.ok(task, 'the monthly seed must still carry assert_control_book_workflow_month');
  return {
    ...task,
    operatorVersion: '1.0.0',
    description: '',
    x: 0,
    y: 0,
    dependsOn: [],
  } as unknown as WorkflowTask;
}

function metricsFrame(lastMonth: string | null): WorkflowDataFrame {
  const row: Row = { last_control_book_month: lastMonth, eom_eq_balance_os: 96_963_611 };
  return {
    columns: Object.keys(row),
    rows: [row],
    index: [1],
    matrix: [],
    range: { sheetName: 'control_metrics', a1Range: '', startRow: 1, endRow: 2, startCol: 1, endCol: 2 },
  };
}

async function evaluate(
  lastMonth: string | null,
  workflowMonth: string,
): Promise<{ passed: boolean; actual: unknown }> {
  const task = guardTask();
  const bound = {
    ...task,
    params: { ...task.params, constants: { workflowMonth } },
  } as unknown as WorkflowTask;
  const { dataFrame } = await executeSqlDataFrameQuery(bound, runtime, async () => metricsFrame(lastMonth));
  const firstColumn = dataFrame.columns[0];
  const actual = firstColumn ? dataFrame.rows[0]?.[firstColumn] : undefined;
  const isOneCell = dataFrame.rows.length === 1 && dataFrame.columns.length === 1;
  const passed = compareAssertValues(actual, task.params.expectedValue, (task.params.operator ?? '=') as '=');
  return { passed: isOneCell && passed, actual };
}

test('a month with its own Control Book rows passes', async () => {
  assert.equal((await evaluate('2026-01', '2026-01')).passed, true);
});

test('a quiet month carries the previous month forward instead of blocking', async () => {
  // February had no Control Book update: its workbook is January's, so the last row stays in January.
  const february = await evaluate('2026-01', '2026-02');
  assert.equal(february.passed, true, 'no activity in the month is a valid state, not an input error');

  // A year boundary as well, where naive string comparisons would break.
  assert.equal((await evaluate('2025-12', '2026-01')).passed, true);
});

test('a workbook that stopped earlier still blocks', async () => {
  assert.equal((await evaluate('2026-01', '2026-03')).passed, false);
  assert.equal((await evaluate('2025-11', '2026-02')).passed, false);
});

test('a workbook with no Issued & Outstanding row at all still blocks', async () => {
  assert.equal((await evaluate(null, '2026-02')).passed, false);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import type { WorkflowDataFrame, WorkflowTask } from '../../shared/types.js';
import { executeSqlDataFrameQuery } from './operators/sqlUtils.js';
import type { WorkflowOperatorRuntime } from './operators/types.js';

/**
 * The option total has two inputs: the workbook's `Shares Remaining For Issuance` rows (available) and
 * the recalculated plan metrics (`outstanding`). The latter is not the workbook's Awards Outstanding —
 * once Plan Summary overrides a plan's cancelled from the ledger, only `granted + exercised + cancelled`
 * keeps the row consistent, and the capital structure's option total has to use that same number.
 */

const seedPath = path.join(process.cwd(), 'database', 'workflows', 'gyre-captable-summary-v2.json');

type SeedTask = {
  id: string;
  operatorCode: string;
  params: Record<string, unknown>;
  inputs?: Record<string, { from: string }>;
};

function seedTask(taskId: string): SeedTask {
  const seed = JSON.parse(readFileSync(seedPath, 'utf8')) as { tasks: SeedTask[] };
  const task = seed.tasks.find((item) => item.id === taskId);
  assert.ok(task, `the monthly seed must still carry ${taskId}`);
  return task;
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

function frame(rows: Array<Record<string, unknown>>): WorkflowDataFrame {
  const columns = Object.keys(rows[0] ?? {});
  return {
    columns,
    rows,
    index: rows.map((_, index) => index + 1),
    matrix: [],
    range: {
      sheetName: 'result',
      a1Range: '',
      startRow: 1,
      endRow: rows.length + 1,
      startCol: 1,
      endCol: columns.length,
    },
  };
}

test('option totals use the recalculated outstanding and the workbook available shares', async () => {
  const task = seedTask('calc_option_metrics');
  const bound = {
    id: task.id,
    name: 'Calc Option Plan Metrics',
    operatorCode: task.operatorCode,
    operatorVersion: '1.0.0',
    description: '',
    x: 0,
    y: 0,
    params: task.params,
    inputs: {
      plans: { from: 'invoke_option_plans_summary', slot: 'dataframe' },
      summary: { from: 'invoke_plan_summary_metrics', slot: 'dataframe' },
    },
    dependsOn: [],
  } as unknown as WorkflowTask;

  const { dataFrame: out } = await executeSqlDataFrameQuery(bound, runtime, async (slot: string) => {
    if (slot === 'plans') {
      return frame([
        {
          category_for_grouping: 'Gyre',
          plan_name: 'GYRE 2023 Plan',
          key: 'Shares Remaining For Issuance',
          value: 3_667_401,
        },
        // Still present in the raw plan rows, but must NOT drive the total any more.
        { category_for_grouping: 'Gyre', plan_name: 'GYRE 2023 Plan', key: 'Awards Outstanding', value: 13_690_892 },
      ]);
    }
    return frame([
      { plan_name: 'GYRE 2023 Plan', outstanding: 13_690_892 },
      { plan_name: 'GYRE 2025 BC Subplan', outstanding: 2_032_384 },
    ]);
  });

  const metrics = out.rows[0] ?? {};
  assert.equal(metrics.total_options_outstanding, 15_723_276);
  assert.equal(metrics.total_options_available, 3_667_401);
  assert.equal(metrics.total_options_outstanding_plus_available, 19_390_677);
  assert.equal(
    'bc_subplan_cancelled_adjustment' in metrics,
    false,
    'the transfer-driven adjustment column must be gone, not just zero',
  );
});

test('calc_option_metrics reads the recalculated plan metrics instead of the workbook outstanding', () => {
  const task = seedTask('calc_option_metrics');
  assert.equal(task.inputs?.summary?.from, 'invoke_plan_summary_metrics');
  const sql = String(task.params.sql ?? '');
  assert.match(sql, /sum\(s\.outstanding\)/);
  assert.match(sql, /Shares Remaining For Issuance/);
  assert.doesNotMatch(sql, /'Awards Outstanding'/);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import type { WorkflowDataFrame, WorkflowTask } from '../../shared/types.js';
import { executeSqlDataFrameQuery } from './operators/sqlUtils.js';
import type { WorkflowOperatorRuntime } from './operators/types.js';

/**
 * Option metrics used to borrow `2025 BC Subplan Transfer` to repair a GYRE 2025 BC Subplan
 * "Cancelled = 0" reading. That input file was retired (2026-11-10), so the adjustment is gone and
 * the numbers are exactly what the Option Plans Summary says — this pins that the task still runs,
 * that it no longer needs a second input, and that it no longer publishes the adjustment column.
 */

const seedPath = path.join(process.cwd(), 'database', 'workflows', 'gyre-captable-summary-v2.json');

type SeedTask = { id: string; operatorCode: string; params: Record<string, unknown> };

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

function plansFrame(rows: Array<Record<string, unknown>>): WorkflowDataFrame {
  return {
    columns: Object.keys(rows[0] ?? {}),
    rows,
    index: rows.map((_, index) => index + 1),
    matrix: [],
    range: { sheetName: 'plans', a1Range: '', startRow: 1, endRow: rows.length + 1, startCol: 1, endCol: 5 },
  };
}

test('option metrics are computed from the Option Plans Summary alone', async () => {
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
    inputs: { plans: { from: 'invoke_option_plans_summary', slot: 'dataframe' } },
    dependsOn: [],
  } as unknown as WorkflowTask;

  const { dataFrame: out } = await executeSqlDataFrameQuery(bound, runtime, async () =>
    plansFrame([
      { category_for_grouping: 'Gyre', plan_name: 'GYRE 2023 Plan', key: 'Awards Outstanding', value: 13_690_892 },
      { category_for_grouping: 'Gyre', plan_name: 'GYRE 2023 Plan', key: 'Shares Remaining For Issuance', value: 3_667_401 },
      {
        category_for_grouping: 'Gyre',
        plan_name: 'GYRE 2023 Plan',
        key: 'Awards Outstanding + Shares Remaining for Issuance',
        value: 17_358_293,
      },
      // GYRE 2025 BC Subplan reports no cancellations: used to be repaired from the transfer file.
      { category_for_grouping: 'BC', plan_name: 'GYRE 2025 BC Subplan', key: 'Awards Outstanding', value: 0 },
      { category_for_grouping: 'BC', plan_name: 'GYRE 2025 BC Subplan', key: 'Cancelled', value: 0 },
    ]),
  );

  const metrics = out.rows[0] ?? {};
  assert.equal(metrics.total_options_outstanding, 13_690_892);
  assert.equal(metrics.total_options_available, 3_667_401);
  assert.equal(metrics.total_options_outstanding_plus_available, 17_358_293);
  assert.equal(
    'bc_subplan_cancelled_adjustment' in metrics,
    false,
    'the transfer-driven adjustment column must be gone, not just zero',
  );
});

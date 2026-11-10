import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import type { WorkflowDataFrame, WorkflowTask } from '../../shared/types.js';
import { executeSqlDataFrameQuery } from './operators/sqlUtils.js';
import type { WorkflowOperatorRuntime } from './operators/types.js';

/**
 * Plan Summary's `cancelled` column used to be the source workbook's own `Cancelled` row, except for
 * one hard-coded plan ('GYRE 2025 BC Subplan') that was overwritten with the Cancel & Restore report
 * total. The ledger is the system of record for cancellations, and it names the plan it belongs to
 * (`所属计划` = `2023 OMNIBUS INCENTIVE PLAN`), so the number has to be computed per plan from the
 * report — otherwise every plan's cancellations land on whichever plan the definition happens to
 * hard-code.
 *
 * A plan the report never mentions keeps the workbook value: legacy plans (CBIO 2015/2018, Cullgen)
 * have no ledger rows at all, and zeroing their cancellations would silently invent data.
 */

const seedPath = path.join(process.cwd(), 'database', 'workflows', 'plan-summary-sync.json');
const WORKFLOW_MONTH = '2026-08';

type SeedTask = {
  id: string;
  operatorCode: string;
  params: Record<string, unknown>;
  inputs?: Record<string, { from: string }>;
};

function seed(): { tasks: SeedTask[] } {
  return JSON.parse(readFileSync(seedPath, 'utf8')) as { tasks: SeedTask[] };
}

function seedTask(taskId: string): SeedTask {
  const task = seed().tasks.find((item) => item.id === taskId);
  assert.ok(task, `the plan-summary seed must still carry ${taskId}`);
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

function frame(sheetName: string, columns: string[], rows: Array<Record<string, unknown>>): WorkflowDataFrame {
  return {
    columns,
    rows,
    index: rows.map((_, index) => index + 1),
    matrix: [],
    range: {
      sheetName,
      a1Range: '',
      startRow: 1,
      endRow: rows.length + 1,
      startCol: 1,
      endCol: columns.length,
    },
  };
}

/** The Option Plans Summary child's output: one row per (plan, key). */
function planRows(): Array<Record<string, unknown>> {
  const row = (plan_name: string, key: string, value: number) => ({
    category_for_grouping: 'gyre',
    plan_name,
    key,
    value,
  });
  return [
    row('GYRE 2023 Omnibus Incentive Plan', 'Granted', 4_158_418),
    row('GYRE 2023 Omnibus Incentive Plan', 'Exercised', -250_049),
    row('GYRE 2023 Omnibus Incentive Plan', 'Cancelled', -435_000),
    row('GYRE 2023 Omnibus Incentive Plan', 'Awards Outstanding', 3_473_369),
    row('GYRE 2025 BC Subplan', 'Granted', 2_100_000),
    row('GYRE 2025 BC Subplan', 'Cancelled', -67_616),
    row('GYRE 2025 BC Subplan', 'Awards Outstanding', 2_063_380),
    row('CBIO 2015 Stock Incentive Plan', 'Granted', 359_686),
    row('CBIO 2015 Stock Incentive Plan', 'Cancelled', -193_894),
    row('CBIO 2015 Stock Incentive Plan', 'Awards Outstanding', 152_528),
  ];
}

/** Cancel & Restore ledger rows; plan names come from the Futu export, hence the different casing. */
function cancelRestoreRows(): Array<Record<string, unknown>> {
  const row = (changeDate: string, type: string, qty: number, plan = '2023 OMNIBUS INCENTIVE PLAN') => ({
    所属计划: plan,
    变更日期: changeDate,
    变更类型: type,
    数量: qty,
  });
  return [
    row('2026-01-20', '待归属取消', -96),
    row('2026-03-20', '待归属取消', -95),
    row('2026-06-20', '待归属取消', -1_000),
    row('2026-07-01', '待归属取消恢复', 120),
    // a different plan name that no summary plan carries: must not be attributed to anything
    row('2026-07-02', '待归属取消', -500, 'SOME OTHER PLAN'),
    // excluded by type and by month
    row('2026-07-03', '已归属到期失效', -9_999),
    row('2026-12-31', '待归属取消', -500),
  ];
}

async function runTask(
  taskId: string,
  inputs: Record<string, WorkflowDataFrame>,
): Promise<Array<Record<string, unknown>>> {
  const task = seedTask(taskId);
  const bound = {
    id: task.id,
    name: task.id,
    operatorCode: task.operatorCode,
    operatorVersion: '1.0.0',
    description: '',
    x: 0,
    y: 0,
    params: { ...task.params, constants: { workflowMonth: WORKFLOW_MONTH } },
    inputs: Object.fromEntries(Object.keys(task.inputs ?? {}).map((slot) => [slot, { from: 'seed', slot: 'dataframe' }])),
    dependsOn: [],
  } as unknown as WorkflowTask;
  const slots = Object.keys(task.inputs ?? {});
  const queue = slots.map((slot) => inputs[slot] ?? inputs.input1);
  const { dataFrame } = await executeSqlDataFrameQuery(bound, runtime, async () => {
    const next = queue.shift();
    assert.ok(next, `missing input frame for ${taskId}`);
    return next;
  });
  return dataFrame.rows;
}

async function planSummary(): Promise<Array<Record<string, unknown>>> {
  const plans = frame('plans', Object.keys(planRows()[0]), planRows());
  const cancelRestore = frame('cancel_restore', Object.keys(cancelRestoreRows()[0]), cancelRestoreRows());
  const cancelled = await runTask('calculate_cancel_restore_cancelled', { input1: cancelRestore, plans });
  const union = frame('union', Object.keys(plans.rows[0]), [
    ...plans.rows,
    ...cancelled.map((row) => ({ ...row })),
  ]);
  return runTask('aggregate_plan_summary', { input1: union });
}

test('cancelled is computed per plan from the Cancel & Restore ledger', async () => {
  const rows = await planSummary();
  const byPlan = new Map(rows.map((row) => [String(row.plan_name), row]));

  // -96 -95 -1000 +120 = -1,071 as of 2026-08 (the December cancellation and 已归属到期失效 stay out).
  assert.equal(byPlan.get('GYRE 2023 Omnibus Incentive Plan')?.cancelled, -1_071);
});

test('plans without ledger rows keep the workbook cancellation value', async () => {
  const rows = await planSummary();
  const byPlan = new Map(rows.map((row) => [String(row.plan_name), row]));

  assert.equal(byPlan.get('GYRE 2025 BC Subplan')?.cancelled, -67_616);
  assert.equal(byPlan.get('CBIO 2015 Stock Incentive Plan')?.cancelled, -193_894);
});

test('the ledger total is no longer attributed to a hard-coded plan', async () => {
  const rows = await planSummary();
  const byPlan = new Map(rows.map((row) => [String(row.plan_name), row]));

  assert.notEqual(byPlan.get('GYRE 2025 BC Subplan')?.cancelled, -1_071);
});

test('the definition derives the plan column instead of hard-coding one plan name', () => {
  const task = seedTask('calculate_cancel_restore_cancelled');
  const sql = String(task.params.sql ?? '');
  assert.match(sql, /所属计划/, 'the ledger column names the plan');
  assert.doesNotMatch(sql, /'GYRE 2025 BC Subplan' as plan_name/, 'no single plan may be pinned in the SQL');
  assert.ok(task.inputs?.plans, 'the task needs the plan name list to map ledger rows onto summary plans');
});

test('cancellations dated after the run month stay out of the total', async () => {
  const later = {
    ...cancelRestoreRows()[0],
    变更日期: '2026-12-31',
    数量: -12_345,
  };
  const plans = frame('plans', Object.keys(planRows()[0]), planRows());
  const cancelRestore = frame('cancel_restore', Object.keys(cancelRestoreRows()[0]), [...cancelRestoreRows(), later]);
  const cancelled = await runTask('calculate_cancel_restore_cancelled', { input1: cancelRestore, plans });
  const omnibus = cancelled.find((row) => String(row.plan_name) === 'GYRE 2023 Omnibus Incentive Plan');
  assert.equal(omnibus?.value, -1_071);
});

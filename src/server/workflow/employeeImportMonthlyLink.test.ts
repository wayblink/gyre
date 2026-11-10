import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import type { WorkflowDataFrame, WorkflowTask } from '../../shared/types.js';
import { executeSqlDataFrameQuery } from './operators/sqlUtils.js';
import type { WorkflowOperatorRuntime } from './operators/types.js';

/**
 * Employee management is refreshed by the monthly run, not only by its own Update button: the master
 * list has to follow the grants the month actually carries, otherwise the employee page keeps names
 * from whenever somebody last clicked Update.
 *
 * Two things have to hold for that wiring to be safe:
 *
 * 1. Employee Import must tolerate a month with only one of the two grant exports. `workflow.invoke`
 *    skips a child only when *every* listed source is empty, so a Futu-only month still calls the
 *    child — which used to fail because both extracts were mandatory.
 * 2. The monthly definition has to actually invoke it, passing the same two grant workbooks (and
 *    their chosen sheets) it already feeds the grant-record sync.
 */

const employeeSeed = JSON.parse(
  readFileSync(path.join(process.cwd(), 'database/workflows/employee-import.json'), 'utf8'),
) as { tasks: Array<{ id: string; operatorCode: string; params: Record<string, unknown> }> };
const monthlySeed = JSON.parse(
  readFileSync(path.join(process.cwd(), 'database/workflows/gyre-captable-summary-v2.json'), 'utf8'),
) as { tasks: Array<{ id: string; operatorCode: string; params: Record<string, unknown> }> };

function employeeTask(taskId: string) {
  const task = employeeSeed.tasks.find((candidate) => candidate.id === taskId);
  assert.ok(task, `employee-import must still carry ${taskId}`);
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

function frame(columns: string[], rows: Array<Record<string, unknown>>): WorkflowDataFrame {
  return {
    columns,
    rows,
    index: rows.map((_, index) => index + 1),
    matrix: [],
    range: { sheetName: 'input', a1Range: '', startRow: 1, endRow: rows.length + 1, startCol: 1, endCol: columns.length },
  };
}

test('both grant extracts tolerate an unbound source and declare the columns their SQL reads', () => {
  const expectations: Array<{ taskId: string; columns: string[] }> = [
    { taskId: 'extract_futu_grants', columns: ['工号', '姓名'] },
    {
      taskId: 'extract_shareworks',
      columns: ['Employee Number', 'Last Name', 'First Name', 'Middle Name', 'Plan Name', 'Grant Name'],
    },
  ];

  for (const { taskId, columns } of expectations) {
    const task = employeeTask(taskId);
    // `workflow.invoke` skips a child only when every listed source is empty, so a Futu-only month
    // still runs Employee Import: the extracts must degrade to an empty frame instead of throwing.
    assert.equal(
      task.operatorCode,
      'sheet.optional-range.extract',
      `${taskId} must not fail the month when its workbook is absent`,
    );
    const declared = String(task.params.emptyColumns ?? '')
      .split(',')
      .map((column) => column.trim());
    for (const column of columns) {
      assert.ok(declared.includes(column), `${taskId} emptyColumns is missing ${column}`);
    }
  }
});

test('an absent Futu workbook yields no Futu employees instead of breaking the run', async () => {
  const task = employeeTask('normalize_futu_employees');
  const bound = {
    id: task.id,
    name: task.id,
    operatorCode: task.operatorCode,
    operatorVersion: '1.0.0',
    description: '',
    x: 0,
    y: 0,
    params: task.params,
    inputs: { input1: { from: 'extract_futu_grants', slot: 'dataframe' } },
    dependsOn: [],
  } as unknown as WorkflowTask;

  const { dataFrame } = await executeSqlDataFrameQuery(bound, runtime, async () =>
    frame(['工号', '姓名'], []),
  );
  assert.equal(dataFrame.rows.length, 0);
});

test('the monthly run refreshes the employee master list from the two grant workbooks', () => {
  const invoke = monthlySeed.tasks.find(
    (task) => task.operatorCode === 'workflow.invoke' && task.params.workflowCode === 'employee-import',
  );
  assert.ok(invoke, 'the monthly workflow must invoke employee-import, otherwise the page never follows the month');

  const params = invoke.params as {
    outputTaskId?: string;
    skipWhenEmpty?: string[];
    runtimeParameters?: { fileRefs?: Record<string, { $fromRuntime?: string }> };
  };
  assert.equal(params.outputTaskId, 'upsert_employees');
  assert.deepEqual(
    params.skipWhenEmpty,
    ['fileRefs.futu_grants', 'fileRefs.shareworks_grants'],
    'a month with neither grant export must skip the import rather than fail the run',
  );
  assert.equal(params.runtimeParameters?.fileRefs?.futu_grants?.$fromRuntime, 'fileRefs.futu_grants');
  assert.equal(params.runtimeParameters?.fileRefs?.shareworks_grants?.$fromRuntime, 'fileRefs.shareworks_grants');
});

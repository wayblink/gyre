import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkflowDataFrame, WorkflowTask } from '../../../shared/types.js';
import type { WorkflowOperatorRuntime } from './types.js';
import { planSummaryPersistOperator } from './planSummaryPersist.js';

const dataframe: WorkflowDataFrame = {
  columns: ['plan_name', 'granted'],
  rows: [{ plan_name: 'GYRE 2023 Omnibus Incentive Plan', granted: 100 }],
  index: [0], matrix: [['GYRE 2023 Omnibus Incentive Plan', 100]],
  range: { sheetName: 'Summary', a1Range: 'A1:B2', startRow: 1, endRow: 2, startCol: 1, endCol: 2 },
};

test('plan-summary.persist delegates rows and source lineage to the host', async () => {
  const calls: unknown[] = [];
  const task: WorkflowTask = {
    id: 'persist_plan_summary', name: 'Persist', operatorCode: 'plan-summary.persist', operatorVersion: '1.0.0',
    description: '', x: 0, y: 0,
    params: { sourceFileId: 4 }, inputs: { input1: { from: 'aggregate', slot: 'dataframe' } }, dependsOn: [],
  };
  const runtime = {
    rowsToDataFrame(rows: Array<Record<string, unknown>>) { return { ...dataframe, columns: Object.keys(rows[0] ?? {}), rows }; },
    async persistPlanSummary(input: unknown) { calls.push(input); return { rowsWritten: 1 }; },
  } as unknown as WorkflowOperatorRuntime;
  const result = await planSummaryPersistOperator.execute({
    task, runtime, executed: new Map(), taskMap: new Map(),
    executeTask: async () => dataframe, resolveInputDataFrame: async () => dataframe,
  });
  assert.deepEqual(calls, [{ dataframe, sourceFileId: 4 }]);
  assert.equal('rows' in result ? result.rows[0]?.rowsWritten : null, 1);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkflowDataFrame, WorkflowTask } from '../../../shared/types.js';
import type { WorkflowOperatorRuntime } from './types.js';
import { esopPagePersistOperator } from './esopPagePersist.js';

const dataframe: WorkflowDataFrame = {
  columns: ['Employee No.'],
  rows: [{ 'Employee No.': 'K00001' }],
  index: [0],
  matrix: [['K00001']],
  range: { sheetName: 'Input', a1Range: 'A1:A2', startRow: 1, endRow: 2, startCol: 1, endCol: 1 },
};

test('esop.page.persist delegates the resolved dataframe and source file lineage to the host', async () => {
  const calls: unknown[] = [];
  const task: WorkflowTask = {
    id: 'persist_exercises',
    name: 'Persist exercises',
    operatorCode: 'esop.page.persist',
    operatorVersion: '1.0.0',
    description: '',
    x: 0,
    y: 0,
    params: { pageKey: 'exercise-record', sourceFileIds: { futu_exercises: 17 } },
    inputs: { input1: { from: 'extract', slot: 'dataframe' } },
    dependsOn: [],
  };
  const runtime = {
    rowsToDataFrame(rows: Array<Record<string, unknown>>) {
      return { ...dataframe, columns: Object.keys(rows[0] ?? {}), rows };
    },
    async persistEsopPage(input: unknown) {
      calls.push(input);
      return { pageKey: 'exercise-record', rowsWritten: 1 };
    },
  } as unknown as WorkflowOperatorRuntime;

  const result = await esopPagePersistOperator.execute({
    task,
    runtime,
    executed: new Map(),
    taskMap: new Map(),
    executeTask: async () => dataframe,
    resolveInputDataFrame: async () => dataframe,
  });

  assert.deepEqual(calls, [
    { pageKey: 'exercise-record', input1: dataframe, input2: null, sourceFileIds: { futu_exercises: 17 } },
  ]);
  assert.equal('rows' in result ? result.rows[0]?.rowsWritten : null, 1);
});


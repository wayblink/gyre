import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkflowDataFrame, WorkflowTask } from '../../../shared/types.js';
import type { WorkflowOperatorRuntime } from './types.js';
import { fivePercentHoldersPersistOperator } from './fivePercentHoldersPersist.js';

const dataframe: WorkflowDataFrame = {
  columns: ["Data from EDGAR SC13's @", '05.31.26'],
  rows: [],
  index: [],
  matrix: [
    ["Data from EDGAR SC13's @", '05.31.26', null],
    [' 133,527,448 ', ' Fully Diluted cap table @ ', null],
    [' 105,916,812 ', ' Common Stock OS @ ', null],
    ['Shareholder’s Name', ' Common Stock * ', ' Total CSEs ** '],
    ['>5% Holders', null, null],
    [' GNI Group Ltd. **', ' 72,773,219 ', ' 86,323,015 '],
  ],
  range: { sheetName: '5% Holders', a1Range: 'A1:C6', startRow: 1, endRow: 6, startCol: 1, endCol: 3 },
};

test('five-percent-holders.persist delegates sheet grid and source lineage to the host', async () => {
  const calls: unknown[] = [];
  const task: WorkflowTask = {
    id: 'persist_five_percent_holders',
    name: 'Persist',
    operatorCode: 'five-percent-holders.persist',
    operatorVersion: '1.0.0',
    description: '',
    x: 0,
    y: 0,
    params: { sourceFileId: 5 },
    inputs: { input1: { from: 'extract', slot: 'dataframe' } },
    dependsOn: [],
  };
  const runtime = {
    rowsToDataFrame(rows: Array<Record<string, unknown>>) { return { ...dataframe, columns: Object.keys(rows[0] ?? {}), rows }; },
    async persistFivePercentHolders(input: unknown) { calls.push(input); return { rowsWritten: 1 }; },
  } as unknown as WorkflowOperatorRuntime;

  const result = await fivePercentHoldersPersistOperator.execute({
    task,
    runtime,
    executed: new Map(),
    taskMap: new Map(),
    executeTask: async () => dataframe,
    resolveInputDataFrame: async () => dataframe,
  });

  assert.deepEqual(calls, [{ dataframe, sourceFileId: 5 }]);
  assert.equal('rows' in result ? result.rows[0]?.rowsWritten : null, 1);
});

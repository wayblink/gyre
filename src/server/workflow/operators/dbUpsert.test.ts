import assert from 'node:assert/strict';
import test from 'node:test';
import { rowsToDataFrame } from '../../excel.js';
import type { WorkflowDataFrame } from '../../../shared/types.js';
import type { WorkflowOperatorExecutionContext, WorkflowOperatorRuntime } from './types.js';
import { dbUpsertOperator } from './dbUpsert.js';

type UpsertCall = {
  table: string;
  columns: string[];
  rows: Array<Record<string, unknown>>;
  conflictColumns: string[];
  updateColumns: string[];
};

function createContext(
  frame: WorkflowDataFrame,
  params: Record<string, unknown>,
  calls: UpsertCall[],
): WorkflowOperatorExecutionContext {
  const runtime = {
    rowsToDataFrame: (rows: Array<Record<string, unknown>>, options: { sheetName: string; a1Range: string }) =>
      rowsToDataFrame(rows, options),
    async upsertTableRows(callParams: UpsertCall) {
      calls.push(callParams);
      return { inserted: callParams.rows.length, updated: 0 };
    },
  } as unknown as WorkflowOperatorRuntime;
  const task = {
    id: 'upsert',
    name: 'Upsert',
    operatorCode: 'db.upsert',
    operatorVersion: '1.0.0',
    description: '',
    x: 0,
    y: 0,
    params,
    inputs: { input1: { from: 'source', slot: 'dataframe' } },
  };
  return {
    task,
    runtime,
    resolveInputDataFrame: async () => frame,
    executed: new Map(),
    taskMap: new Map(),
    executeTask: async () => {
      throw new Error('not used');
    },
  } as unknown as WorkflowOperatorExecutionContext;
}

test('db.upsert passes dataframe columns and conflict/update keys to the runtime', async () => {
  const frame = rowsToDataFrame([
    { employee_id: '100015', source: 'shareworks', employee_name: 'Han Lin' },
  ]);
  const calls: UpsertCall[] = [];
  const context = createContext(
    frame,
    { table: 'employees', conflictColumns: ['employee_id'], updateColumns: ['employee_name'] },
    calls,
  );
  const result = (await dbUpsertOperator.execute(context)) as WorkflowDataFrame;

  assert.equal(calls.length, 1);
  assert.equal(calls[0].table, 'employees');
  assert.deepEqual(calls[0].columns, ['employee_id', 'source', 'employee_name']);
  assert.deepEqual(calls[0].conflictColumns, ['employee_id']);
  assert.deepEqual(calls[0].updateColumns, ['employee_name']);
  assert.equal(result.rows[0].inserted, 1);
  assert.equal(result.rows[0].total, 1);
});

test('db.upsert honours an explicit columns subset', async () => {
  const frame = rowsToDataFrame([{ employee_id: 'K1', source: 'futu', extra: 'ignore' }]);
  const calls: UpsertCall[] = [];
  const context = createContext(
    frame,
    { table: 'employees', columns: ['employee_id', 'source'], conflictColumns: ['employee_id'] },
    calls,
  );
  await dbUpsertOperator.execute(context);
  assert.deepEqual(calls[0].columns, ['employee_id', 'source']);
});

test('db.upsert preview does not write to the database', async () => {
  const frame = rowsToDataFrame([{ employee_id: 'a' }, { employee_id: 'b' }]);
  const calls: UpsertCall[] = [];
  const context = createContext(
    frame,
    { table: 'employees', conflictColumns: ['employee_id'], updateColumns: [] },
    calls,
  );
  const preview = await dbUpsertOperator.preview!(context);
  assert.equal(calls.length, 0, 'preview must not call upsertTableRows');
  assert.equal(preview.kind, 'dataframe');
  if (preview.kind === 'dataframe') {
    assert.equal(preview.dataFrame.rows[0].rowsToWrite, 2);
    assert.equal(preview.dataFrame.rows[0].onConflict, 'do nothing');
  }
});

test('db.upsert fails when the runtime has no DB write capability', async () => {
  const frame = rowsToDataFrame([{ employee_id: 'a' }]);
  const context = createContext(frame, { table: 'employees', conflictColumns: ['employee_id'] }, []);
  (context.runtime as { upsertTableRows?: unknown }).upsertTableRows = undefined;
  await assert.rejects(() => dbUpsertOperator.execute(context), /DB write is not available/);
});

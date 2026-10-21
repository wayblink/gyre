import assert from 'node:assert/strict';
import test from 'node:test';
import { rowsToDataFrame } from '../../excel.js';
import { dataframeEnsureColumnsOperator } from './dataframeEnsureColumns.js';
import type { WorkflowOperatorExecutionContext, WorkflowOperatorRuntime } from './types.js';

/**
 * Upstream exports drift: the 2026-08 Shareworks grant report dropped `Middle Name`, and the
 * downstream SQL then failed with "Column does not exist". Filling only the declared column keeps
 * the definition tolerant of that change while a genuinely broken export still trips the schema
 * guard on the next task.
 */

function buildContext(params: Record<string, unknown>, rows: Array<Record<string, unknown>>) {
  const dataframe = rowsToDataFrame(rows, { sheetName: 'Personnel', a1Range: 'A1:C2' });
  const runtime = { rowsToDataFrame } as unknown as WorkflowOperatorRuntime;
  const context = {
    task: {
      id: 'ensure',
      name: 'Ensure Columns',
      operatorCode: 'dataframe.ensure.columns',
      operatorVersion: '1.0.0',
      description: '',
      x: 0,
      y: 0,
      params,
      inputs: { input1: { from: 'extract', slot: 'dataframe' } },
    },
    runtime,
    runtimeParameters: {},
    executed: new Map(),
    taskMap: new Map(),
    async executeTask() {
      throw new Error('not used');
    },
    async resolveInputDataFrame() {
      return dataframe;
    },
  } as unknown as WorkflowOperatorExecutionContext;
  return { context, dataframe };
}

test('a declared column missing upstream is added with empty values', async () => {
  const { context } = buildContext({ columns: 'Middle Name' }, [
    { 'Last Name': 'Kirkby', 'First Name': 'Maxwell' },
    { 'Last Name': 'Weston', 'First Name': 'Claire' },
  ]);

  const result = (await dataframeEnsureColumnsOperator.execute(context)) as { columns: string[]; rows: unknown[] };

  assert.deepEqual(result.columns, ['Last Name', 'First Name', 'Middle Name']);
  assert.deepEqual(result.rows, [
    { 'Last Name': 'Kirkby', 'First Name': 'Maxwell', 'Middle Name': null },
    { 'Last Name': 'Weston', 'First Name': 'Claire', 'Middle Name': null },
  ]);
});

test('an input that already has the column is returned untouched', async () => {
  const { context, dataframe } = buildContext({ columns: 'Middle Name' }, [
    { 'Last Name': 'Kirkby', 'Middle Name': 'Q' },
  ]);

  const result = await dataframeEnsureColumnsOperator.execute(context);

  // Same object: nothing to do means no reshaping of an already valid dataframe.
  assert.equal(result, dataframe);
});

test('columns that are not declared are still reported, not silently filled', async () => {
  const { context } = buildContext({ columns: 'Middle Name' }, [{ 'Last Name': 'Kirkby' }]);

  const result = (await dataframeEnsureColumnsOperator.execute(context)) as { columns: string[] };

  assert.deepEqual(result.columns, ['Last Name', 'Middle Name']);
  assert.ok(!result.columns.includes('Shares Outstanding'));
});

test('an empty column list is a configuration error', async () => {
  const { context } = buildContext({ columns: '   ' }, [{ 'Last Name': 'Kirkby' }]);

  await assert.rejects(() => dataframeEnsureColumnsOperator.execute(context), /at least one column to ensure/);
});

test('normalizeTask accepts a newline separated list and stores it comma separated', () => {
  const task = {
    id: 'ensure',
    name: 'Ensure Columns',
    operatorCode: 'dataframe.ensure.columns',
    operatorVersion: '1.0.0',
    description: '',
    x: 0,
    y: 0,
    params: { columns: 'Middle Name\nCost Center' },
    inputs: {},
    dependsOn: [],
  } as never;

  dataframeEnsureColumnsOperator.normalizeTask?.(task);

  assert.equal((task as { params: Record<string, unknown> }).params.columns, 'Middle Name, Cost Center');
});

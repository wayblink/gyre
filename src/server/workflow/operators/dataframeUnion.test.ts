import assert from 'node:assert/strict';
import test from 'node:test';
import { rowsToDataFrame } from '../../excel.js';
import type { WorkflowDataFrame } from '../../../shared/types.js';
import type { WorkflowOperatorExecutionContext, WorkflowOperatorRuntime } from './types.js';
import { dataframeUnionOperator } from './dataframeUnion.js';

const runtime = {
  rowsToDataFrame: (rows: Array<Record<string, unknown>>, options: { sheetName: string; a1Range: string }) =>
    rowsToDataFrame(rows, options),
} as unknown as WorkflowOperatorRuntime;

function runUnion(frames: Record<string, WorkflowDataFrame>, params: Record<string, unknown> = {}) {
  const task = {
    id: 'union',
    name: 'Union',
    operatorCode: 'dataframe.union',
    operatorVersion: '1.0.0',
    description: '',
    x: 0,
    y: 0,
    params,
    inputs: Object.fromEntries(Object.keys(frames).map((slot) => [slot, { from: `up-${slot}`, slot: 'dataframe' }])),
  };
  const context = {
    task,
    runtime,
    resolveInputDataFrame: async (slot: string) => frames[slot],
    executed: new Map(),
    taskMap: new Map(),
    executeTask: async () => {
      throw new Error('not used');
    },
  } as unknown as WorkflowOperatorExecutionContext;
  return dataframeUnionOperator.execute(context) as Promise<WorkflowDataFrame>;
}

test('union concatenates rows from all inputs preserving order', async () => {
  const a = rowsToDataFrame([{ name: '韩林', empNo: 'K1' }]);
  const b = rowsToDataFrame([{ name: 'Han Lin', empNo: '100015' }]);
  const out = await runUnion({ input1: a, input2: b });
  assert.deepEqual(out.rows.map((row) => row.name), ['韩林', 'Han Lin']);
  assert.deepEqual(out.columns, ['name', 'empNo']);
});

test('union aligns heterogeneous columns by name and fills gaps with null', async () => {
  const futu = rowsToDataFrame([{ name: '韩林', 工号: 'K1' }]);
  const shareworks = rowsToDataFrame([{ name: 'Han Lin', grantNumber: '3028' }]);
  const out = await runUnion({ input1: futu, input2: shareworks });
  assert.deepEqual(out.columns, ['name', '工号', 'grantNumber']);
  assert.equal(out.rows[0].grantNumber, null);
  assert.equal(out.rows[1]['工号'], null);
  assert.equal(out.rows[1].grantNumber, '3028');
});

test('union with distinct removes fully-identical rows', async () => {
  const a = rowsToDataFrame([{ name: '张三', empNo: 'K9' }, { name: '李四', empNo: 'K8' }]);
  const b = rowsToDataFrame([{ name: '张三', empNo: 'K9' }]);
  const out = await runUnion({ input1: a, input2: b }, { distinct: true });
  assert.equal(out.rows.length, 2);
  assert.deepEqual(out.rows.map((row) => row.name), ['张三', '李四']);
});

test('union without distinct keeps duplicate rows (UNION ALL semantics)', async () => {
  const a = rowsToDataFrame([{ name: '张三', empNo: 'K9' }]);
  const b = rowsToDataFrame([{ name: '张三', empNo: 'K9' }]);
  const out = await runUnion({ input1: a, input2: b });
  assert.equal(out.rows.length, 2);
});

test('union orders slots numerically (input2 before input10)', async () => {
  const s2 = rowsToDataFrame([{ tag: 'two' }]);
  const s10 = rowsToDataFrame([{ tag: 'ten' }]);
  const out = await runUnion({ input10: s10, input2: s2 });
  assert.deepEqual(out.rows.map((row) => row.tag), ['two', 'ten']);
});

test('union throws when no input slot is bound', async () => {
  const task = {
    id: 'union',
    name: 'Union',
    operatorCode: 'dataframe.union',
    operatorVersion: '1.0.0',
    description: '',
    x: 0,
    y: 0,
    params: {},
    inputs: { input1: { from: '', slot: 'dataframe' } },
  };
  const context = {
    task,
    runtime,
    resolveInputDataFrame: async () => rowsToDataFrame([]),
    executed: new Map(),
    taskMap: new Map(),
    executeTask: async () => {
      throw new Error('not used');
    },
  } as unknown as WorkflowOperatorExecutionContext;
  await assert.rejects(() => dataframeUnionOperator.execute(context), /requires at least one dataframe input/);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { rowsToDataFrame } from '../../excel.js';
import type { WorkflowDataFrame } from '../../../shared/types.js';
import type { WorkflowOperatorExecutionContext, WorkflowOperatorRuntime } from './types.js';
import { sheetOptionalRangeExtractOperator } from './sheetOptionalRangeExtract.js';

const runtime = {
  rowsToDataFrame: (
    rows: Array<Record<string, unknown>>,
    options: { sheetName: string; a1Range: string; columns?: string[] },
  ) => rowsToDataFrame(rows, options),
} as unknown as WorkflowOperatorRuntime;

const INCREMENT_COLUMNS =
  '行权订单编号, 姓名, 工号, 牛牛号, 用户ID, 授予编号, 授予日期, 授予价(USD), 行权日期, 行权下单数量, 行权成功数量, 行权成本(USD), 扣除/卖出数量, 成交数量';

function runExtract(params: Record<string, unknown>) {
  const task = {
    id: 'extract_increment',
    name: 'Extract Increment',
    operatorCode: 'sheet.optional-range.extract',
    operatorVersion: '1.0.0',
    description: '',
    x: 0,
    y: 0,
    params,
    inputs: {},
  };
  const context = {
    task,
    runtime,
    resolveInputDataFrame: async () => {
      throw new Error('not used');
    },
    executed: new Map(),
    taskMap: new Map(),
    executeTask: async () => {
      throw new Error('not used');
    },
  } as unknown as WorkflowOperatorExecutionContext;
  return sheetOptionalRangeExtractOperator.execute(context) as Promise<WorkflowDataFrame>;
}

test('unbound optional source yields an empty dataframe carrying its declared column contract', async () => {
  const out = await runExtract({
    fileRef: {},
    sheetName: '行权明细数据',
    range: 'A1:BG',
    emptyColumns: INCREMENT_COLUMNS,
  });

  assert.deepEqual(out.rows, []);
  assert.deepEqual(out.columns, INCREMENT_COLUMNS.split(', '));
});

test('unbound optional source without emptyColumns keeps the old zero-column behaviour', async () => {
  const out = await runExtract({ fileRef: {}, sheetName: 'Sheet', range: 'A1:E20' });
  assert.deepEqual(out.rows, []);
  assert.deepEqual(out.columns, []);
});

test('normalizeTask parses emptyColumns into a canonical comma list', () => {
  const task = {
    id: 'extract_increment',
    name: 'Extract Increment',
    operatorCode: 'sheet.optional-range.extract',
    operatorVersion: '1.0.0',
    description: '',
    x: 0,
    y: 0,
    params: { sheetName: '行权明细数据', range: 'A1:BG', emptyColumns: 'a\n b ,, c ' },
    inputs: {},
  };
  sheetOptionalRangeExtractOperator.normalizeTask?.(task);
  assert.equal(task.params.emptyColumns, 'a, b, c');
});

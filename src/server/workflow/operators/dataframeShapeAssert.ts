import type { WorkflowAssertOperator, WorkflowDataFrame, WorkflowTask } from '../../../shared/types.js';
import {
  buildAssertionResult,
  compareAssertValues,
  isAssertOperator,
  normalizeAssertBaseParams,
} from './assertUtils.js';
import { defineWorkflowOperator, normalizeWorkflowTaskDependencies, requireInputDataFrame } from './types.js';

type ShapeOperator = WorkflowAssertOperator | 'any';

function normalizeShapeOperator(value: unknown): ShapeOperator {
  return value === 'any' || isAssertOperator(value) ? value : '>=';
}

function normalizeExpectedCount(value: unknown, fallback: number) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? Math.trunc(numeric) : fallback;
}

function compareShapeCount(actual: number, operator: ShapeOperator, expected: number) {
  if (operator === 'any') return true;
  return compareAssertValues(actual, expected, operator);
}

export function normalizeShapeAssertTask(task: WorkflowTask) {
  if (task.operatorCode !== 'dataframe.shape.assert') return;
  task.params.rowOperator = normalizeShapeOperator(task.params.rowOperator);
  task.params.expectedRows = normalizeExpectedCount(task.params.expectedRows, 1);
  task.params.columnOperator = normalizeShapeOperator(task.params.columnOperator);
  task.params.expectedColumns = normalizeExpectedCount(task.params.expectedColumns, 1);
  normalizeAssertBaseParams(task);
  task.inputs = {
    input1: {
      from: String(task.inputs?.input1?.from ?? '').trim(),
      slot: 'dataframe',
    },
  };
  normalizeWorkflowTaskDependencies(task);
}

export function evaluateShapeAssertion(task: WorkflowTask, dataframe: WorkflowDataFrame) {
  normalizeShapeAssertTask(task);
  const rowOperator = normalizeShapeOperator(task.params.rowOperator);
  const columnOperator = normalizeShapeOperator(task.params.columnOperator);
  const expectedRows = normalizeExpectedCount(task.params.expectedRows, 1);
  const expectedColumns = normalizeExpectedCount(task.params.expectedColumns, 1);
  const actualRows = dataframe.rows.length;
  const actualColumns = dataframe.columns.length;
  const rowsPassed = compareShapeCount(actualRows, rowOperator, expectedRows);
  const columnsPassed = compareShapeCount(actualColumns, columnOperator, expectedColumns);
  const passed = rowsPassed && columnsPassed;
  const failureMessage = String(task.params.failureMessage ?? 'Assertion failed').trim() || 'Assertion failed';

  return buildAssertionResult({
    task,
    passed,
    actualValue: `${actualRows}x${actualColumns}`,
    expectedValue: `rows ${rowOperator} ${expectedRows}, columns ${columnOperator} ${expectedColumns}`,
    actualLabel: `rows=${actualRows}, columns=${actualColumns}`,
    expectedLabel: `rows ${rowOperator} ${expectedRows}; columns ${columnOperator} ${expectedColumns}`,
    failureMessage: `${failureMessage}: actual rows=${actualRows}, columns=${actualColumns}; expected rows ${rowOperator} ${expectedRows}, columns ${columnOperator} ${expectedColumns}`,
  });
}

export const dataframeShapeAssertOperator = defineWorkflowOperator({
  code: 'dataframe.shape.assert',
  name: 'Assert DataFrame Shape',
  version: '1.0.0',
  category: 'Validation',
  description: '校验 dataframe 的行数和列数，适合检查提取范围、过滤结果或汇总结果的规模。',
  inputSlots: [{ slot: 'input1', type: 'table', contentType: 'application/json', label: 'DataFrame', required: true }],
  outputSlots: [{ slot: 'dataframe', type: 'table', contentType: 'application/json', label: 'DataFrame' }],
  paramsSchema: {
    rowOperator: { type: 'string', label: '行数比较符', required: true, enum: ['any', '>', '>=', '<', '<=', '=', '!='], default: '>=' },
    expectedRows: { type: 'number', label: '预期行数', required: true, default: 1 },
    columnOperator: { type: 'string', label: '列数比较符', required: true, enum: ['any', '>', '>=', '<', '<=', '=', '!='], default: '>=' },
    expectedColumns: { type: 'number', label: '预期列数', required: true, default: 1 },
    failureStrategy: {
      type: 'string',
      label: '失败策略',
      required: false,
      enum: ['block', 'warning', 'pass-through'],
      default: 'block',
    },
    failureMessage: { type: 'string', label: '失败提示', required: false, placeholder: 'Assertion failed', default: 'Assertion failed' },
  },
  normalizeTask: normalizeShapeAssertTask,
  async execute(context) {
    const dataframe = await requireInputDataFrame(context, 'input1');
    const assertion = evaluateShapeAssertion(context.task, dataframe);
    return {
      kind: 'assert',
      assertion,
      dataFrame: dataframe,
    };
  },
  async preview(context) {
    const dataframe = await requireInputDataFrame(context, 'input1');
    const assertion = evaluateShapeAssertion(context.task, dataframe);
    return {
      kind: 'assert',
      assertion,
      dataFrame: dataframe,
    };
  },
});

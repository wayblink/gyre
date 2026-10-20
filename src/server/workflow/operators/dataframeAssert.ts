import type {
  WorkflowAssertionResult,
  WorkflowAssertOperator,
  WorkflowDataFrame,
  WorkflowTask,
} from '../../../shared/types.js';
import { defineWorkflowOperator, normalizeWorkflowTaskDependencies, requireInputDataFrame } from './types.js';
import {
  buildAssertionResult,
  compareAssertValues,
  formatAssertionFailureTail,
  isAssertOperator,
  normalizeAssertBaseParams,
} from './assertUtils.js';

export function normalizeAssertTask(task: WorkflowTask) {
  if (task.operatorCode !== 'dataframe.assert') return;
  task.params.operator = isAssertOperator(task.params.operator) ? task.params.operator : '=';
  if (!Object.prototype.hasOwnProperty.call(task.params, 'expectedValue')) {
    task.params.expectedValue = 0;
  }
  normalizeAssertBaseParams(task);
  task.inputs = {
    input1: {
      from: String(task.inputs?.input1?.from ?? '').trim(),
      slot: 'dataframe',
      guards: task.inputs?.input1?.guards,
    },
  };
  normalizeWorkflowTaskDependencies(task);
}

export function evaluateDataFrameAssertion(task: WorkflowTask, dataframe: WorkflowDataFrame): WorkflowAssertionResult {
  normalizeAssertTask(task);

  const operator = task.params.operator as WorkflowAssertOperator;
  const expectedValue = task.params.expectedValue;
  const failureMessage = String(task.params.failureMessage ?? 'Assertion failed').trim() || 'Assertion failed';
  const firstColumn = dataframe.columns[0];
  const actualValue = firstColumn ? dataframe.rows[0]?.[firstColumn] : undefined;

  let passed = false;
  if (dataframe.rows.length === 1 && dataframe.columns.length === 1) {
    passed = compareAssertValues(actualValue, expectedValue, operator);
  }

  const fallbackFailureMessage =
    dataframe.rows.length !== 1 || dataframe.columns.length !== 1
      ? `${failureMessage}: expected a 1x1 dataframe, got ${dataframe.rows.length}x${dataframe.columns.length}`
      : formatAssertionFailureTail(failureMessage, actualValue, expectedValue, operator);

  return buildAssertionResult({
    task,
    passed,
    operator,
    actualValue,
    expectedValue,
    failureMessage: passed ? failureMessage : fallbackFailureMessage,
  });
}

export const dataframeAssertOperator = defineWorkflowOperator({
  code: 'dataframe.assert',
  name: 'Assert DataFrame Value',
  version: '1.0.0',
  category: 'Validation',
  description: '针对 dataframe 做断言，当前先支持 1 行 1 列场景的值比较，可配置失败是否阻断执行。',
  documentation: {
    usage: '对输入 dataframe 的 1 行 1 列结果做比较断言。适合放在 SQL 汇总节点之后，检查某个指标是否等于预期。',
    steps: [
      '上游通常连接一个只返回 1 行 1 列的 sql.compute 节点。',
      '配置 operator 和 expectedValue。',
      'failureStrategy 选择 block 阻断执行，或 warning 进入人工复核。',
    ],
    example: `{
  "operator": "=",
  "expectedValue": 111488849,
  "failureStrategy": "warning",
  "failureMessage": "EOM outstanding shares does not match expected control total"
}`,
  },
  inputSlots: [{ slot: 'input1', type: 'table', contentType: 'application/json', label: 'DataFrame', required: true }],
  outputSlots: [{ slot: 'dataframe', type: 'table', contentType: 'application/json', label: 'DataFrame' }],
  paramsSchema: {
    operator: {
      type: 'string',
      label: '比较符',
      required: true,
      enum: ['>', '>=', '<', '<=', '=', '!='],
      default: '=',
    },
    expectedValue: { type: 'string', label: '预期值', required: true, placeholder: '0', default: 0 },
    failureStrategy: {
      type: 'string',
      label: '失败策略',
      required: false,
      enum: ['block', 'warning', 'pass-through'],
      default: 'block',
    },
    failureMessage: {
      type: 'string',
      label: '失败提示',
      required: false,
      placeholder: 'Assertion failed',
      default: 'Assertion failed',
    },
  },
  normalizeTask: normalizeAssertTask,
  async execute(context) {
    const dataframe = await requireInputDataFrame(context, 'input1');
    const assertion = evaluateDataFrameAssertion(context.task, dataframe);
    return {
      kind: 'assert',
      assertion,
      dataFrame: dataframe,
    };
  },
  async preview(context) {
    const dataframe = await requireInputDataFrame(context, 'input1');
    const assertion = evaluateDataFrameAssertion(context.task, dataframe);
    return {
      kind: 'assert',
      assertion,
      dataFrame: dataframe,
    };
  },
});

import type { WorkflowAssertOperator, WorkflowTask } from '../../../shared/types.js';
import {
  buildAssertionResult,
  compareAssertValues,
  isAssertOperator,
  normalizeAssertBaseParams,
} from './assertUtils.js';
import { executeSqlDataFrameQuery } from './sqlUtils.js';
import { defineWorkflowOperator, normalizeSqlTableBindings, normalizeWorkflowTaskDependencies } from './types.js';

export function normalizeSqlAssertTask(task: WorkflowTask) {
  if (task.operatorCode !== 'dataframe.sql.assert') return;
  const rawInputs = task.inputs ?? {};
  const nextInputs: WorkflowTask['inputs'] = {};
  for (const [slot, binding] of Object.entries(rawInputs)) {
    const slotName = slot.trim();
    if (!slotName) continue;
    nextInputs[slotName] = {
      from: String(binding?.from ?? '').trim(),
      slot: String(binding?.slot ?? 'dataframe').trim() || 'dataframe',
    };
  }
  task.inputs = Object.keys(nextInputs).length ? nextInputs : { input1: { from: '', slot: 'dataframe' } };
  task.params.sql = typeof task.params.sql === 'string' && task.params.sql.trim() ? task.params.sql : 'select count(*) as actual from {source}';
  task.params.tableBindings = normalizeSqlTableBindings(task.params.tableBindings);
  if (!Array.isArray(task.params.tableBindings) || !task.params.tableBindings.length) {
    task.params.tableBindings = [{ tableName: 'source', inputSlot: 'input1' }];
  }
  task.params.operator = isAssertOperator(task.params.operator) ? task.params.operator : '=';
  if (!Object.prototype.hasOwnProperty.call(task.params, 'expectedValue')) {
    task.params.expectedValue = 0;
  }
  normalizeAssertBaseParams(task);
  normalizeWorkflowTaskDependencies(task);
}

async function evaluateSqlAssertion(
  task: WorkflowTask,
  runtime: Parameters<typeof executeSqlDataFrameQuery>[1],
  resolveInputDataFrame: Parameters<typeof executeSqlDataFrameQuery>[2],
) {
  normalizeSqlAssertTask(task);
  const { dataFrame: sqlResult, firstInputDataFrame } = await executeSqlDataFrameQuery(task, runtime, resolveInputDataFrame);
  const operator = task.params.operator as WorkflowAssertOperator;
  const expectedValue = task.params.expectedValue;
  const failureMessage = String(task.params.failureMessage ?? 'Assertion failed').trim() || 'Assertion failed';
  const firstColumn = sqlResult.columns[0];
  const actualValue = firstColumn ? sqlResult.rows[0]?.[firstColumn] : undefined;
  const isOneCell = sqlResult.rows.length === 1 && sqlResult.columns.length === 1;
  const passed = isOneCell ? compareAssertValues(actualValue, expectedValue, operator) : false;
  const message = !isOneCell
    ? `${failureMessage}: SQL assertion must return a 1x1 dataframe, got ${sqlResult.rows.length}x${sqlResult.columns.length}`
    : `${failureMessage}: actual=${String(actualValue)} ${operator} expected=${String(expectedValue)} was false`;

  return {
    assertion: buildAssertionResult({
      task,
      passed,
      operator,
      actualValue,
      expectedValue,
      failureMessage: message,
    }),
    outputDataFrame: firstInputDataFrame ?? sqlResult,
  };
}

export const dataframeSqlAssertOperator = defineWorkflowOperator({
  code: 'dataframe.sql.assert',
  name: 'Assert SQL Result',
  version: '1.0.0',
  category: 'Validation',
  description: '对一个或多个输入 dataframe 执行 SQL，要求 SQL 返回 1 行 1 列，并对结果做值比较断言。',
  inputSlots: [{ slot: 'input1', type: 'table', contentType: 'application/json', label: 'Input 1', required: false }],
  outputSlots: [{ slot: 'dataframe', type: 'table', contentType: 'application/json', label: 'DataFrame' }],
  paramsSchema: {
    sql: {
      type: 'string',
      label: 'SQL',
      required: true,
      placeholder: 'select count(*) as actual from {source}',
      default: 'select count(*) as actual from {source}',
    },
    tableBindings: {
      type: 'array',
      label: '表名映射',
      required: false,
      description: '将 SQL 中的 {source} 这类占位符映射到 input1/input2 等输入槽位。',
      default: [{ tableName: 'source', inputSlot: 'input1' }],
    },
    operator: { type: 'string', label: '比较符', required: true, enum: ['>', '>=', '<', '<=', '=', '!='], default: '=' },
    expectedValue: { type: 'string', label: '预期值', required: true, placeholder: '0', default: 0 },
    failureStrategy: {
      type: 'string',
      label: '失败策略',
      required: false,
      enum: ['block', 'warning', 'pass-through'],
      default: 'block',
    },
    failureMessage: { type: 'string', label: '失败提示', required: false, placeholder: 'Assertion failed', default: 'Assertion failed' },
  },
  normalizeTask: normalizeSqlAssertTask,
  async execute({ task, runtime, resolveInputDataFrame }) {
    const { assertion, outputDataFrame } = await evaluateSqlAssertion(task, runtime, resolveInputDataFrame);
    return {
      kind: 'assert',
      assertion,
      dataFrame: outputDataFrame,
    };
  },
  async preview({ task, runtime, resolveInputDataFrame }) {
    const { assertion, outputDataFrame } = await evaluateSqlAssertion(task, runtime, resolveInputDataFrame);
    return {
      kind: 'assert',
      assertion,
      dataFrame: outputDataFrame,
    };
  },
});

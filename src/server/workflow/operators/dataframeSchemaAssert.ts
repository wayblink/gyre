import type { WorkflowTask } from '../../../shared/types.js';
import { buildAssertionResult, normalizeAssertBaseParams } from './assertUtils.js';
import { defineWorkflowOperator, normalizeWorkflowTaskDependencies, requireInputDataFrame } from './types.js';

type SchemaAssertMode = 'contains' | 'exact';

function parseExpectedColumns(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((item) => String(item ?? '').trim()).filter(Boolean);
  }
  return String(raw ?? '')
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeSchemaMode(value: unknown): SchemaAssertMode {
  return value === 'exact' ? 'exact' : 'contains';
}

export function normalizeSchemaAssertTask(task: WorkflowTask) {
  if (task.operatorCode !== 'dataframe.schema.assert') return;
  task.params.mode = normalizeSchemaMode(task.params.mode);
  task.params.expectedColumns = parseExpectedColumns(task.params.expectedColumns).join(', ');
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

export function evaluateSchemaAssertion(task: WorkflowTask, columns: string[]) {
  normalizeSchemaAssertTask(task);
  const mode = normalizeSchemaMode(task.params.mode);
  const expectedColumns = parseExpectedColumns(task.params.expectedColumns);
  const failureMessage = String(task.params.failureMessage ?? 'Assertion failed').trim() || 'Assertion failed';

  const missing = expectedColumns.filter((column) => !columns.includes(column));
  const unexpected = columns.filter((column) => !expectedColumns.includes(column));
  const orderMatches = expectedColumns.every((column, index) => columns[index] === column);
  const passed =
    expectedColumns.length > 0 &&
    missing.length === 0 &&
    (mode === 'contains' || (unexpected.length === 0 && columns.length === expectedColumns.length && orderMatches));

  const details = [
    missing.length ? `missing=[${missing.join(', ')}]` : '',
    mode === 'exact' && unexpected.length ? `unexpected=[${unexpected.join(', ')}]` : '',
    mode === 'exact' && !orderMatches ? 'order mismatch' : '',
  ]
    .filter(Boolean)
    .join('; ');

  return buildAssertionResult({
    task,
    passed,
    actualValue: columns.join(', '),
    expectedValue: expectedColumns.join(', '),
    actualLabel: columns.join(', '),
    expectedLabel: `${mode}: ${expectedColumns.join(', ') || '(empty)'}`,
    failureMessage: `${failureMessage}: ${details || 'expected columns cannot be empty'}`,
  });
}

export const dataframeSchemaAssertOperator = defineWorkflowOperator({
  code: 'dataframe.schema.assert',
  name: 'Assert DataFrame Schema',
  version: '1.0.0',
  category: 'Validation',
  description: '校验 dataframe 的列名结构，支持包含指定列或完全匹配列顺序。',
  inputSlots: [{ slot: 'input1', type: 'table', contentType: 'application/json', label: 'DataFrame', required: true }],
  outputSlots: [{ slot: 'dataframe', type: 'table', contentType: 'application/json', label: 'DataFrame' }],
  paramsSchema: {
    mode: { type: 'string', label: '匹配模式', required: true, enum: ['contains', 'exact'], default: 'contains' },
    expectedColumns: { type: 'string', label: '列名', required: true, placeholder: 'col_a, col_b', default: '' },
    failureStrategy: {
      type: 'string',
      label: '失败策略',
      required: false,
      enum: ['block', 'warning', 'pass-through'],
      default: 'block',
    },
    failureMessage: { type: 'string', label: '失败提示', required: false, placeholder: 'Assertion failed', default: 'Assertion failed' },
  },
  normalizeTask: normalizeSchemaAssertTask,
  async execute(context) {
    const dataframe = await requireInputDataFrame(context, 'input1');
    const assertion = evaluateSchemaAssertion(context.task, dataframe.columns);
    return {
      kind: 'assert',
      assertion,
      dataFrame: dataframe,
    };
  },
  async preview(context) {
    const dataframe = await requireInputDataFrame(context, 'input1');
    const assertion = evaluateSchemaAssertion(context.task, dataframe.columns);
    return {
      kind: 'assert',
      assertion,
      dataFrame: dataframe,
    };
  },
});

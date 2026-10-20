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
  task.params.skipWhenEmpty = task.params.skipWhenEmpty === true;
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

  // An optional input that was not supplied produces a dataframe with no columns. That is a
  // documented state (see `sheet.optional-range.extract`), not a broken schema, so `skipWhenEmpty`
  // lets the guard pass instead of demanding a schema from a file nobody handed over.
  if (task.params.skipWhenEmpty === true && columns.length === 0) {
    return buildAssertionResult({
      task,
      passed: true,
      actualValue: '(not supplied)',
      expectedValue: expectedColumns.join(', '),
      actualLabel: '(not supplied)',
      expectedLabel: `${mode}: ${expectedColumns.join(', ') || '(empty)'}`,
      failureMessage,
    });
  }

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
  documentation: {
    usage: '校验输入 dataframe 是否具备预期列结构。适合在提取或 SQL 转换之后确认字段没有缺失、改名或顺序异常。',
    steps: [
      '连接需要校验结构的 dataframe 输入。',
      'mode 选择 contains 只要求包含指定列，或 exact 要求列集合和顺序完全一致。',
      '在 expectedColumns 中填写逗号或换行分隔的列名，并配置失败策略。',
      '可选输入把 skipWhenEmpty 设为 true，未提供文件时不报错。',
    ],
    example: `{
  "mode": "contains",
  "expectedColumns": "Shareholder, Security Type, Shares",
  "failureStrategy": "block",
  "failureMessage": "Capitalization summary schema changed"
}`,
  },
  inputSlots: [{ slot: 'input1', type: 'table', contentType: 'application/json', label: 'DataFrame', required: true }],
  outputSlots: [{ slot: 'dataframe', type: 'table', contentType: 'application/json', label: 'DataFrame' }],
  paramsSchema: {
    mode: { type: 'string', label: '匹配模式', required: true, enum: ['contains', 'exact'], default: 'contains' },
    expectedColumns: { type: 'string', label: '列名', required: true, placeholder: 'col_a, col_b', default: '' },
    skipWhenEmpty: {
      type: 'boolean',
      label: '输入为空时跳过',
      required: false,
      default: false,
      description: '可选输入未提供时（dataframe 无列）直接通过，不把「没给文件」当成「结构坏了」。',
    },
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

import type { WorkflowDataFrame } from '../../../shared/types.js';
import { defineWorkflowOperator, normalizeWorkflowTaskDependencies } from './types.js';

/**
 * Comma or newline separated column list, the same convention `sheet.optional-range.extract` uses
 * for `emptyColumns`.
 */
function parseColumns(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item ?? '').trim()).filter(Boolean);
  return String(value ?? '')
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export const dataframeEnsureColumnsOperator = defineWorkflowOperator({
  code: 'dataframe.ensure.columns',
  name: 'Ensure Columns / 补齐可选列',
  version: '1.0.0',
  category: 'Transform',
  description: '通用算子：输入 dataframe 缺少声明列时补上（值为空），已有列原样保留。',
  documentation: {
    usage:
      '上游导出偶尔会少一列（例如同一张报表在年中改版去掉了 Middle Name）。下游 SQL 引用不存在的列会直接报错，用本算子在中间补上可选列，可以让同一定义同时吃下两种格式；未声明的列缺失仍然会由下游的 schema 校验拦下。',
    steps: [
      '把 input1 连接到上游 dataframe。',
      '在 columns 里只声明「允许缺失」的列；不要把所有列都写进来，否则真正的格式变更会被悄悄补空。',
      '补出来的列值为空，null 语义与导出里没有该列一致。',
    ],
    example: `{
  "columns": "Middle Name"
}`,
  },
  inputSlots: [{ slot: 'input1', type: 'table', contentType: 'application/json', label: 'DataFrame', required: true }],
  outputSlots: [{ slot: 'dataframe', type: 'table', contentType: 'application/json', label: 'DataFrame' }],
  paramsSchema: {
    columns: {
      type: 'string',
      label: '可选列',
      required: true,
      placeholder: 'Middle Name',
      description: '逗号或换行分隔。只列出允许缺失的列。',
      default: '',
    },
  },
  normalizeTask(task) {
    task.inputs = {
      input1: {
        from: String(task.inputs?.input1?.from ?? '').trim(),
        slot: 'dataframe',
        guards: task.inputs?.input1?.guards,
      },
    };
    task.params.columns = parseColumns(task.params.columns).join(', ');
    normalizeWorkflowTaskDependencies(task);
  },
  async execute({ task, runtime, resolveInputDataFrame }) {
    const declared = parseColumns(task.params.columns);
    if (!declared.length) {
      throw new Error(`Task ${task.name} requires at least one column to ensure`);
    }
    const dataframe: WorkflowDataFrame = await resolveInputDataFrame('input1');
    const existing = new Set(dataframe.columns);
    const missing = declared.filter((column) => !existing.has(column));
    // Nothing to do: return the frame untouched so row/column identity is preserved.
    if (!missing.length) return dataframe;
    // `rowsToDataFrame` normalises every row over the full column list and fills the gaps with null,
    // so appending the missing names is enough — no row rewriting needed.
    return runtime.rowsToDataFrame(dataframe.rows, {
      sheetName: dataframe.range.sheetName,
      a1Range: dataframe.range.a1Range,
      columns: [...dataframe.columns, ...missing],
    });
  },
});

import type { WorkflowDataFrame } from '../../../shared/types.js';
import { defineWorkflowOperator, normalizeWorkflowTaskDependencies } from './types.js';

/**
 * Order input slots deterministically: input1, input2, ... input10 (numeric-aware),
 * so the unioned row order does not depend on object-key insertion quirks.
 */
function orderedBoundSlots(inputs: Record<string, { from?: string } | undefined>): string[] {
  return Object.entries(inputs ?? {})
    .filter(([, binding]) => String(binding?.from ?? '').trim())
    .map(([slot]) => slot)
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}

function dedupeRows(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const seen = new Set<string>();
  const result: Array<Record<string, unknown>> = [];
  for (const row of rows) {
    const key = JSON.stringify(columns.map((column) => row[column] ?? null));
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(row);
  }
  return result;
}

export const dataframeUnionOperator = defineWorkflowOperator({
  code: 'dataframe.union',
  name: 'Union / 合并行',
  version: '1.0.0',
  category: 'Transform',
  description: '通用 Union 算子：把多个上游 dataframe 按列名对齐后纵向合并成一个 dataframe。',
  documentation: {
    usage:
      '把 input1/input2/... 连接到多个上游 dataframe，按列名自动对齐（缺失列补空）后纵向堆叠。适合把多份来源表（如 Futu、Shareworks）合并成一张统一表，再交给 SQL 算子做清洗/去重/归集。',
    steps: [
      '把 input1、input2（可继续加 input3...）连接到要合并的上游 dataframe。',
      '不同来源的列名会自动取并集对齐，某来源没有的列在其行里填空。',
      '需要去掉完全相同的重复行时，把 distinct 设为 true。',
    ],
    example: `{
  "distinct": false
}`,
  },
  inputSlots: [
    { slot: 'input1', type: 'table', contentType: 'application/json', label: 'Input 1', required: true },
    { slot: 'input2', type: 'table', contentType: 'application/json', label: 'Input 2', required: false },
  ],
  outputSlots: [{ slot: 'dataframe', type: 'table', contentType: 'application/json', label: 'DataFrame' }],
  paramsSchema: {
    distinct: {
      type: 'boolean',
      label: '去重（DISTINCT）',
      required: false,
      description: '开启后，合并结果中完全相同的行只保留一条（相当于 UNION 而非 UNION ALL）。',
      default: false,
    },
  },
  normalizeTask(task) {
    const rawInputs = task.inputs ?? {};
    const nextInputs: typeof task.inputs = {};
    for (const [slot, binding] of Object.entries(rawInputs)) {
      const slotName = slot.trim();
      if (!slotName) continue;
      nextInputs[slotName] = {
        from: String(binding?.from ?? '').trim(),
        slot: String(binding?.slot ?? 'dataframe').trim() || 'dataframe',
        guards: binding?.guards,
      };
    }
    task.inputs = Object.keys(nextInputs).length
      ? nextInputs
      : { input1: { from: '', slot: 'dataframe' }, input2: { from: '', slot: 'dataframe' } };
    task.params.distinct = task.params.distinct === true;
    normalizeWorkflowTaskDependencies(task);
  },
  async execute({ task, runtime, resolveInputDataFrame }) {
    const slots = orderedBoundSlots(task.inputs ?? {});
    if (!slots.length) {
      throw new Error(`Task ${task.name} requires at least one dataframe input`);
    }
    const allRows: Array<Record<string, unknown>> = [];
    for (const slot of slots) {
      const dataframe: WorkflowDataFrame = await resolveInputDataFrame(slot);
      allRows.push(...dataframe.rows);
    }
    const rows = task.params.distinct === true ? dedupeRows(allRows) : allRows;
    return runtime.rowsToDataFrame(rows, { sheetName: task.name || 'Union', a1Range: '' });
  },
});

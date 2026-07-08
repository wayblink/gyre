import { defineWorkflowOperator, normalizeSqlTableBindings, normalizeWorkflowTaskDependencies } from './types.js';
import { executeSqlDataFrameQuery } from './sqlUtils.js';

export const sqlComputeOperator = defineWorkflowOperator({
  code: 'sql.compute',
  name: 'SQL Compute',
  version: '1.0.0',
  category: 'Transform',
  description: '通用 SQL 算子：将上游 dataframe 绑定为表后执行 SQL，输出 dataframe。',
  documentation: {
    usage: '把上游 dataframe 绑定成 SQL 表，执行查询并输出新的 dataframe。适合聚合、清洗、union、计算业务指标。',
    steps: [
      '把 input1/input2 等输入槽连接到上游 dataframe。',
      '在 tableBindings 中把输入槽命名成 SQL 中可引用的表名。',
      'SQL 中使用 {tableName} 引用绑定表；使用 {constants.name} 引用运行时常量。',
    ],
    example: `{
  "tableBindings": [{ "inputSlot": "control_book", "tableName": "control_book" }],
  "constants": { "cullgenCommonStock": { "$fromRuntime": "constants.cullgenCommonStock" } },
  "sql": "select max([Issued & Outstanding]) as eom_eq_balance_os from {control_book}"
}`,
  },
  inputSlots: [{ slot: 'input1', type: 'table', contentType: 'application/json', label: 'Input 1', required: false }],
  outputSlots: [{ slot: 'dataframe', type: 'table', contentType: 'application/json', label: 'DataFrame' }],
  paramsSchema: {
    sql: {
      type: 'string',
      label: 'SQL',
      required: true,
      placeholder: 'select count(*) as total from {tablea} join {tableb} on {tablea}.id = {tableb}.id',
      default: 'select * from {source}',
    },
    tableBindings: {
      type: 'array',
      label: '表名映射',
      required: false,
      description: '将 SQL 中的 {tablea} 这类占位符映射到 input1/input2 等输入槽位。',
      default: [{ tableName: 'source', inputSlot: 'input1' }],
    },
    constants: {
      type: 'object',
      label: 'SQL Constants',
      required: false,
      description: '可在 SQL 中通过 {constants.name} 引用的常量，支持运行时参数注入。',
      default: {},
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
    task.inputs = Object.keys(nextInputs).length ? nextInputs : { input1: { from: '', slot: 'dataframe' } };
    task.params.tableBindings = normalizeSqlTableBindings(task.params.tableBindings);
    normalizeWorkflowTaskDependencies(task);
  },
  async execute({ task, runtime, resolveInputDataFrame }) {
    return (await executeSqlDataFrameQuery(task, runtime, resolveInputDataFrame)).dataFrame;
  },
});

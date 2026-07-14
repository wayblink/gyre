import { defineWorkflowOperator, requireInputDataFrame } from './types.js';

export const planSummaryPersistOperator = defineWorkflowOperator({
  code: 'plan-summary.persist',
  name: 'Persist Plan Summary / 写入计划汇总',
  version: '1.0.0',
  category: 'Database',
  description: '原子替换 Plan Summary 页面数据，并保存输入文件血缘。',
  documentation: {
    usage: '供 Plan Summary workflow 使用。',
    steps: ['连接聚合后的 dataframe。', '执行后页面直接读取落表结果。'],
    example: '将按 plan_name 聚合后的 Shareworks grants 写入 Plan Summary。',
  },
  inputSlots: [{ slot: 'input1', type: 'table', contentType: 'application/json', label: 'Plan Summary', required: true }],
  outputSlots: [{ slot: 'dataframe', type: 'table', contentType: 'application/json', label: 'Write Result' }],
  paramsSchema: { sourceFileId: { type: 'number', label: '输入文件 ID', required: true } },
  async execute(context) {
    if (!context.runtime.persistPlanSummary) throw new Error('Plan Summary persistence is not available in this runtime');
    const dataframe = await requireInputDataFrame(context, 'input1');
    const sourceFileId = Number(context.task.params.sourceFileId);
    if (!Number.isInteger(sourceFileId) || sourceFileId <= 0) throw new Error('Plan Summary sourceFileId must be a positive integer');
    const result = await context.runtime.persistPlanSummary({ dataframe, sourceFileId });
    return context.runtime.rowsToDataFrame([result], { sheetName: 'Plan Summary Persist Result', a1Range: '' });
  },
  async preview(context) {
    const dataframe = await requireInputDataFrame(context, 'input1');
    return { kind: 'dataframe', dataFrame: context.runtime.rowsToDataFrame(
      [{ rowsWritten: dataframe.rows.length, mode: 'preview-no-write' }],
      { sheetName: 'Plan Summary Persist Preview', a1Range: '' },
    ) };
  },
});

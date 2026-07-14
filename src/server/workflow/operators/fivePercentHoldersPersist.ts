import { defineWorkflowOperator, requireInputDataFrame } from './types.js';

export const fivePercentHoldersPersistOperator = defineWorkflowOperator({
  code: 'five-percent-holders.persist',
  name: 'Persist 5% Holders / 写入 5% 股东',
  version: '1.0.0',
  category: 'Database',
  description: '原子替换 5% Holders 页面数据，并保存输入文件血缘。',
  documentation: {
    usage: '供 5% Holders workflow 使用。',
    steps: ['连接从 Gyre Cap Table「5% Holders」sheet 抽取的 dataframe。', '执行后页面直接读取落表结果。'],
    example: '将 5% Holders sheet 前置表格写入 five_percent_holders。',
  },
  inputSlots: [{ slot: 'input1', type: 'table', contentType: 'application/json', label: '5% Holders Sheet', required: true }],
  outputSlots: [{ slot: 'dataframe', type: 'table', contentType: 'application/json', label: 'Write Result' }],
  paramsSchema: { sourceFileId: { type: 'number', label: '输入文件 ID', required: true } },
  async execute(context) {
    if (!context.runtime.persistFivePercentHolders) throw new Error('5% Holders persistence is not available in this runtime');
    const dataframe = await requireInputDataFrame(context, 'input1');
    const sourceFileId = Number(context.task.params.sourceFileId);
    if (!Number.isInteger(sourceFileId) || sourceFileId <= 0) throw new Error('5% Holders sourceFileId must be a positive integer');
    const result = await context.runtime.persistFivePercentHolders({ dataframe, sourceFileId });
    return context.runtime.rowsToDataFrame([result], { sheetName: '5% Holders Persist Result', a1Range: '' });
  },
  async preview(context) {
    const dataframe = await requireInputDataFrame(context, 'input1');
    return {
      kind: 'dataframe',
      dataFrame: context.runtime.rowsToDataFrame(
        [{ rowsRead: dataframe.rows.length, mode: 'preview-no-write' }],
        { sheetName: '5% Holders Persist Preview', a1Range: '' },
      ),
    };
  },
});

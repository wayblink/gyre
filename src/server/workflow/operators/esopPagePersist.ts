import type { EsopPageKey } from '../../esopWorkflow/workflowDefinitions.js';
import {
  defineWorkflowOperator,
  isRecord,
  normalizeWorkflowTaskDependencies,
  requireInputDataFrame,
} from './types.js';

function normalizeSourceFileIds(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, raw]) => [key, Number(raw)] as const)
      .filter(([, fileId]) => Number.isInteger(fileId) && fileId > 0),
  );
}

export const esopPagePersistOperator = defineWorkflowOperator({
  code: 'esop.page.persist',
  name: 'Persist ESOP Page / 写入 ESOP 页面数据',
  version: '1.0.0',
  category: 'Database',
  description: '将上游 dataframe 原子写入 Grant、Exercise、Sold Shares 或 Transfer 对应业务表。',
  documentation: {
    usage: '仅供 ESOP 页面同步 workflow 使用。pageKey 决定目标业务表，sourceFileIds 保留输入文件血缘。',
    steps: ['连接一个或两个 Excel 提取节点。', '选择目标 ESOP 页面。', '执行后页面 API 直接读取本次写库结果。'],
    example: 'Grant Record 使用 Futu 授予记录作为 input1、Shareworks Options OS Detail 作为 input2。',
  },
  inputSlots: [
    { slot: 'input1', type: 'table', contentType: 'application/json', label: 'Primary DataFrame', required: true },
    { slot: 'input2', type: 'table', contentType: 'application/json', label: 'Secondary DataFrame', required: false },
  ],
  outputSlots: [{ slot: 'dataframe', type: 'table', contentType: 'application/json', label: 'Write Result' }],
  paramsSchema: {
    pageKey: {
      type: 'string',
      label: 'ESOP 页面',
      required: true,
      enum: ['grant-record', 'exercise-record', 'sold-shares', 'transfer-plan'],
    },
    sourceFileIds: {
      type: 'object',
      label: '输入文件血缘',
      required: true,
      default: {},
    },
  },
  normalizeTask(task) {
    task.inputs = Object.fromEntries(
      Object.entries(task.inputs ?? {}).filter(([slot, binding]) =>
        (slot === 'input1' || slot === 'input2') && Boolean(binding?.from?.trim()),
      ),
    );
    normalizeWorkflowTaskDependencies(task);
  },
  async execute(context) {
    if (!context.runtime.persistEsopPage) throw new Error('ESOP page persistence is not available in this runtime');
    const input1 = await requireInputDataFrame(context, 'input1');
    const input2 = context.task.inputs.input2?.from?.trim()
      ? await context.resolveInputDataFrame('input2')
      : null;
    const pageKey = String(context.task.params.pageKey ?? '') as EsopPageKey;
    const sourceFileIds = normalizeSourceFileIds(context.task.params.sourceFileIds);
    const result = await context.runtime.persistEsopPage({ pageKey, input1, input2, sourceFileIds });
    return context.runtime.rowsToDataFrame([result], { sheetName: 'ESOP Persist Result', a1Range: '' });
  },
  async preview(context) {
    const input1 = await requireInputDataFrame(context, 'input1');
    const input2 = context.task.inputs.input2?.from?.trim()
      ? await context.resolveInputDataFrame('input2')
      : null;
    return {
      kind: 'dataframe',
      dataFrame: context.runtime.rowsToDataFrame(
        [{
          pageKey: String(context.task.params.pageKey ?? ''),
          primaryRows: input1.rows.length,
          secondaryRows: input2?.rows.length ?? 0,
          mode: 'preview-no-write',
        }],
        { sheetName: 'ESOP Persist Preview', a1Range: '' },
      ),
    };
  },
});

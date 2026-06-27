import { defineWorkflowOperator, normalizeWorkflowTaskDependencies } from './types.js';

export const sheetRangeExtractOperator = defineWorkflowOperator({
  code: 'sheet.range.extract',
  name: 'Excel Range Extract',
  version: '1.0.0',
  category: 'Input',
  description: '通用 Excel 提取算子：选择文件、Sheet 和范围后，输出类似 dataframe 的结构。',
  inputSlots: [],
  outputSlots: [{ slot: 'dataframe', type: 'table', contentType: 'application/json', label: 'DataFrame' }],
  paramsSchema: {
    range: { type: 'string', label: 'A1 范围', required: true, placeholder: 'B3:F20', default: '' },
    fileId: { type: 'number', label: '文件 ID', required: true, default: null },
    headerRow: { type: 'number', label: '表头行号', required: false, description: 'Excel 中的绝对行号，例如 3', default: null },
    sheetName: { type: 'string', label: 'Sheet 名称', required: true, default: '' },
  },
  normalizeTask(task) {
    task.inputs = {};
    normalizeWorkflowTaskDependencies(task);
  },
  async execute({ task, runtime }) {
    const fileId = typeof task.params.fileId === 'number' && Number.isFinite(task.params.fileId) ? task.params.fileId : null;
    const sheetName = String(task.params.sheetName ?? '').trim();
    const range = String(task.params.range ?? '').trim();
    const rawHeaderRow = task.params.headerRow;
    const headerRow =
      typeof rawHeaderRow === 'number' && Number.isFinite(rawHeaderRow) ? rawHeaderRow : rawHeaderRow === null ? null : undefined;

    if (!fileId) throw new Error(`Task ${task.name} is missing fileId`);
    if (!sheetName || !range) throw new Error(`Task ${task.name} requires sheetName and range`);

    const buffer = await runtime.getProductFileBufferById(fileId);
    return runtime.extractSheetRangeAsDataFrame(buffer, sheetName, { range, headerRow });
  },
});

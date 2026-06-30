import { defineWorkflowOperator, normalizeWorkflowFileReference, normalizeWorkflowTaskDependencies, readWorkflowFile } from './types.js';

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
    fileRef: { type: 'object', label: '文件引用', required: true, default: null },
    fileId: { type: 'number', label: '文件 ID（兼容）', required: false, default: null },
    headerRow: { type: 'number', label: '表头行号', required: false, description: 'Excel 中的绝对行号，例如 3', default: null },
    sheetName: { type: 'string', label: 'Sheet 名称', required: true, default: '' },
  },
  normalizeTask(task) {
    task.inputs = {};
    normalizeWorkflowTaskDependencies(task);
  },
  async execute({ task, runtime }) {
    const fileRef = normalizeWorkflowFileReference(task.params.fileRef ?? task.params.fileId);
    const sheetName = String(task.params.sheetName ?? '').trim();
    const range = String(task.params.range ?? '').trim();
    const rawHeaderRow = task.params.headerRow;
    const headerRow =
      typeof rawHeaderRow === 'number' && Number.isFinite(rawHeaderRow) ? rawHeaderRow : rawHeaderRow === null ? null : undefined;

    if (!fileRef) throw new Error(`Task ${task.name} is missing fileRef`);
    if (!sheetName || !range) throw new Error(`Task ${task.name} requires sheetName and range`);

    const buffer = await readWorkflowFile(runtime, fileRef);
    return runtime.extractSheetRangeAsDataFrame(buffer, sheetName, { range, headerRow });
  },
});

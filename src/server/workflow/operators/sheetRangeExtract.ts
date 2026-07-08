import { defineWorkflowOperator, normalizeWorkflowFileReference, normalizeWorkflowTaskDependencies, readWorkflowFile } from './types.js';

export const sheetRangeExtractOperator = defineWorkflowOperator({
  code: 'sheet.range.extract',
  name: 'Excel Range Extract',
  version: '1.0.0',
  category: 'Input',
  description: '通用 Excel 提取算子：选择文件、Sheet 和范围后，输出类似 dataframe 的结构。',
  documentation: {
    usage: '从一个 Excel sheet 的 A1 范围读取数据，并输出标准 dataframe。适合读取单个连续表格，例如 Control Book、Detailed Cap Table 或一段汇总表。',
    steps: [
      '配置 fileRef 或兼容 fileId，指定要读取的 workbook。',
      '填写 sheetName 和 range；如果表头不在范围第一行，配置 headerRow 为 Excel 中的绝对行号。',
      '下游节点通过 dataframe 输出槽消费提取结果。',
    ],
    example: `{
  "fileRef": { "$fromRuntime": "fileRefs.control_book" },
  "sheetName": "EQ Control Book",
  "range": "A9:L130",
  "headerRow": 9
}`,
  },
  inputSlots: [],
  outputSlots: [{ slot: 'dataframe', type: 'table', contentType: 'application/json', label: 'DataFrame' }],
  paramsSchema: {
    range: { type: 'string', label: 'A1 范围', required: true, placeholder: 'B3:F20', default: '' },
    fileRef: { type: 'object', label: '文件引用', required: true, default: null },
    fileId: { type: 'number', label: '文件 ID（兼容）', required: false, default: null },
    headerRow: { type: 'number', label: '表头行号', required: false, description: 'Excel 中的绝对行号，例如 3', default: null },
    dropTrailingEmptyRows: { type: 'boolean', label: '剔除末尾空行', required: false, default: true },
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
    const dropTrailingEmptyRows = task.params.dropTrailingEmptyRows !== false;

    if (!fileRef) throw new Error(`Task ${task.name} is missing fileRef`);
    if (!sheetName || !range) throw new Error(`Task ${task.name} requires sheetName and range`);

    const buffer = await readWorkflowFile(runtime, fileRef);
    return runtime.extractSheetRangeAsDataFrame(buffer, sheetName, { range, headerRow, dropTrailingEmptyRows });
  },
});

import {
  defineWorkflowOperator,
  normalizeWorkflowFileReference,
  normalizeWorkflowTaskDependencies,
  readWorkflowFile,
} from './types.js';

export const sheetOptionalRangeExtractOperator = defineWorkflowOperator({
  code: 'sheet.optional-range.extract',
  name: 'Optional Excel Range Extract',
  version: '1.0.0',
  category: 'Input',
  description: '可选 Excel 提取算子：未配置文件时输出空 dataframe，配置文件时按指定 sheet/range 抽取。',
  inputSlots: [],
  outputSlots: [{ slot: 'dataframe', type: 'table', contentType: 'application/json', label: 'DataFrame' }],
  paramsSchema: {
    range: { type: 'string', label: 'A1 范围', required: true, placeholder: 'A1:E20', default: '' },
    fileRef: { type: 'object', label: '文件引用', required: false, default: {} },
    headerRow: { type: 'number', label: '表头行号', required: false, default: null },
    dropTrailingEmptyRows: { type: 'boolean', label: '剔除末尾空行', required: false, default: true },
    sheetName: { type: 'string', label: 'Sheet 名称', required: true, default: '' },
  },
  documentation: {
    usage:
      '用于可选文件输入。未传文件时不会阻断 workflow，而是输出空 dataframe；传入文件后行为等同普通 range extract。',
    steps: [
      '配置 fileRef 为可选 runtime 参数并给默认空对象。',
      '配置 sheetName/range/headerRow。',
      '下游 SQL 用 count(*) 判断是否传入了文件。',
    ],
    example: `{
  "fileRef": { "$fromRuntime": "fileRefs.previous_capitalization_summary", "$default": {} },
  "sheetName": "Capitalization Summary",
  "range": "A1:E20"
}`,
  },
  normalizeTask(task) {
    task.inputs = {};
    normalizeWorkflowTaskDependencies(task);
  },
  async execute({ task, runtime }) {
    const fileRef = normalizeWorkflowFileReference(task.params.fileRef);
    const sheetName = String(task.params.sheetName ?? '').trim() || 'Optional Source';
    const range = String(task.params.range ?? '').trim();
    const rawHeaderRow = task.params.headerRow;
    const headerRow =
      typeof rawHeaderRow === 'number' && Number.isFinite(rawHeaderRow)
        ? rawHeaderRow
        : rawHeaderRow === null
          ? null
          : undefined;
    const dropTrailingEmptyRows = task.params.dropTrailingEmptyRows !== false;

    if (!fileRef) return runtime.rowsToDataFrame([], { sheetName, a1Range: range });
    if (!sheetName || !range) throw new Error(`Task ${task.name} requires sheetName and range`);

    const buffer = await readWorkflowFile(runtime, fileRef);
    return runtime.extractSheetRangeAsDataFrame(buffer, sheetName, { range, headerRow, dropTrailingEmptyRows });
  },
});

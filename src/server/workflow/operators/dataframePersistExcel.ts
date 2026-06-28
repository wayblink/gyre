import { defineWorkflowOperator, normalizePersistExcelFileName, normalizeWorkflowTaskDependencies, requireInputDataFrame } from './types.js';

export const dataframePersistExcelOperator = defineWorkflowOperator({
  code: 'dataframe.persist.excel',
  name: 'Persist DataFrame To Excel',
  version: '1.0.0',
  category: 'Output',
  description: '将输入 dataframe 导出为 Excel 文件并写入 Files，供后续下载和预览。',
  inputSlots: [{ slot: 'input1', type: 'table', contentType: 'application/json', label: 'DataFrame', required: true }],
  outputSlots: [{ slot: 'dataframe', type: 'table', contentType: 'application/json', label: 'DataFrame' }],
  paramsSchema: {
    fileName: { type: 'string', label: '文件名', required: true, placeholder: 'workflow-output.xlsx', default: 'workflow-output.xlsx' },
    sheetName: { type: 'string', label: 'Sheet 名称', required: false, placeholder: 'Sheet1', default: 'Sheet1' },
    uploadedBy: { type: 'string', label: '上传人', required: false, placeholder: 'Workflow', default: 'Workflow' },
  },
  normalizeTask(task) {
    task.inputs = {
      input1: {
        from: String(task.inputs?.input1?.from ?? '').trim(),
        slot: 'dataframe',
        guards: task.inputs?.input1?.guards,
      },
    };
    normalizeWorkflowTaskDependencies(task);
  },
  async execute(context) {
    const { task, runtime } = context;
    const dataframe = await requireInputDataFrame(context, 'input1');
    const fileName = normalizePersistExcelFileName(task.params.fileName, `${task.name || 'workflow-output'}`);
    const sheetName = String(task.params.sheetName ?? '').trim() || dataframe.range.sheetName || 'Sheet1';
    const uploadedBy = String(task.params.uploadedBy ?? '').trim() || 'Workflow';
    const buffer = runtime.dataFrameToWorkbookBuffer(dataframe, { sheetName });

    const file = await runtime.saveGeneratedWorkbook({
      originalName: fileName,
      buffer,
      uploadedBy,
    });

    return {
      kind: 'file',
      file,
      dataFrame: dataframe,
    };
  },
  async preview(context) {
    const { task } = context;
    const dataframe = await requireInputDataFrame(context, 'input1');
    const fileName = normalizePersistExcelFileName(task.params.fileName, `${task.name || 'workflow-output'}`);
    const sheetName = String(task.params.sheetName ?? '').trim() || dataframe.range.sheetName || 'Sheet1';

    return {
      kind: 'file-plan',
      fileName,
      sheetName,
      dataFrame: dataframe,
    };
  },
});

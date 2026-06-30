import {
  defineWorkflowOperator,
  isWorkflowRuntimeReference,
  normalizePersistExcelFileName,
  normalizeWorkflowTaskDependencies,
  prefixPersistExcelFileName,
  requireInputDataFrame,
} from './types.js';
import type { WorkflowDataFrame } from '../../../shared/types.js';

function currentMonthKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function withPersistedSheetName(dataframe: WorkflowDataFrame, sheetName: string): WorkflowDataFrame {
  return {
    ...dataframe,
    range: {
      ...dataframe.range,
      sheetName,
    },
    source: dataframe.source
      ? {
          ...dataframe.source,
          sheetName,
          range: dataframe.source.range
            ? {
                ...dataframe.source.range,
                sheetName,
              }
            : dataframe.source.range,
        }
      : dataframe.source,
  };
}

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
    fileNamePrefix: { type: 'string', label: '文件名前缀', required: false, placeholder: '2026-05', default: '' },
    sheetName: { type: 'string', label: 'Sheet 名称', required: false, placeholder: 'Sheet1', default: 'Sheet1' },
    uploadedBy: { type: 'string', label: '上传人', required: false, placeholder: 'Workflow', default: 'Workflow' },
  },
  runtimeParameters: [
    {
      path: 'month',
      field: {
        type: 'string',
        label: 'Month',
        required: true,
        description: '用于生成月度输出文件名前缀，例如 2026-05-Capitalization_Table_Summary_View.xlsx。',
      },
      defaultValue: currentMonthKey,
      appliesTo: (task) => isWorkflowRuntimeReference(task.params.fileNamePrefix),
    },
  ],
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
    const baseFileName = normalizePersistExcelFileName(task.params.fileName, `${task.name || 'workflow-output'}`);
    const fileName = prefixPersistExcelFileName(baseFileName, task.params.fileNamePrefix);
    const sheetName = String(task.params.sheetName ?? '').trim() || dataframe.range.sheetName || 'Sheet1';
    const uploadedBy = String(task.params.uploadedBy ?? '').trim() || 'Workflow';
    const buffer = runtime.dataFrameToWorkbookBuffer(dataframe, { sheetName });
    const persistedDataFrame = withPersistedSheetName(dataframe, sheetName);

    const file = await runtime.saveGeneratedWorkbook({
      originalName: fileName,
      buffer,
      uploadedBy,
    });

    return {
      kind: 'file',
      file,
      dataFrame: persistedDataFrame,
    };
  },
  async preview(context) {
    const { task } = context;
    const dataframe = await requireInputDataFrame(context, 'input1');
    const baseFileName = normalizePersistExcelFileName(task.params.fileName, `${task.name || 'workflow-output'}`);
    const fileName = prefixPersistExcelFileName(baseFileName, task.params.fileNamePrefix);
    const sheetName = String(task.params.sheetName ?? '').trim() || dataframe.range.sheetName || 'Sheet1';
    const persistedDataFrame = withPersistedSheetName(dataframe, sheetName);

    return {
      kind: 'file-plan',
      fileName,
      sheetName,
      dataFrame: persistedDataFrame,
    };
  },
});

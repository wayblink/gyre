import {
  defineWorkflowOperator,
  isWorkflowRuntimeReference,
  normalizePersistExcelFileName,
  normalizeWorkflowTaskDependencies,
  prefixPersistExcelFileName,
  suffixPersistExcelFileName,
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

function timestampVersionTag(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
}

function isOutputFolder(folderPrefix: unknown): boolean {
  const normalized = String(folderPrefix ?? '')
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '');
  return normalized === 'output' || normalized.startsWith('output/');
}

function withOutputFileVersion(fileName: string, folderPrefix: unknown): string {
  if (!isOutputFolder(folderPrefix)) return fileName;
  if (/\.v\d{14}\.[^.]+$/i.test(fileName)) return fileName;
  return fileName.replace(/(\.[^.]+)$/i, `.v${timestampVersionTag()}$1`);
}

export const dataframePersistExcelOperator = defineWorkflowOperator({
  code: 'dataframe.persist.excel',
  name: 'Persist DataFrame To Excel',
  version: '1.0.0',
  category: 'Output',
  description: '将输入 dataframe 导出为 Excel 文件并写入 Files，供后续下载和预览。',
  documentation: {
    usage:
      '把输入 dataframe 写成一个 Excel 文件并保存到 Files。适合作为工作流最终输出节点，也可以用于中间结果落盘审计。',
    steps: [
      '连接需要导出的 dataframe 输入。',
      '配置 fileName 和 sheetName；fileName 会自动补齐 .xlsx 后缀。',
      '如需月度文件名前缀，把 fileNamePrefix 配置为 { "$fromRuntime": "month" }，运行时会生成 2026-05-xxx.xlsx 这类文件名。',
    ],
    example: `{
  "fileName": "Capitalization_Table_Summary_View.xlsx",
  "fileNamePrefix": { "$fromRuntime": "month" },
  "sheetName": "Capitalization Summary",
  "uploadedBy": "Workflow"
}`,
  },
  inputSlots: [{ slot: 'input1', type: 'table', contentType: 'application/json', label: 'DataFrame', required: true }],
  outputSlots: [{ slot: 'dataframe', type: 'table', contentType: 'application/json', label: 'DataFrame' }],
  paramsSchema: {
    fileName: {
      type: 'string',
      label: '文件名',
      required: true,
      placeholder: 'workflow-output.xlsx',
      default: 'workflow-output.xlsx',
    },
    fileNamePrefix: { type: 'string', label: '文件名前缀', required: false, placeholder: '2026-05', default: '' },
    fileNameSuffix: { type: 'string', label: '文件名后缀', required: false, placeholder: '2026_06', default: '' },
    folderPrefix: { type: 'string', label: '输出目录', required: false, placeholder: 'output/captable', default: '' },
    sheetName: { type: 'string', label: 'Sheet 名称', required: false, placeholder: 'Sheet1', default: 'Sheet1' },
    uploadedBy: { type: 'string', label: '上传人', required: false, placeholder: 'Workflow', default: 'Workflow' },
    skipWhenEmpty: {
      type: 'boolean',
      label: '空输入不落盘',
      required: false,
      description:
        '输入 dataframe 没有任何数据行时直接跳过写文件，保留该目录下已有的同名产物。用于「可选来源未提供」不应覆盖上一次有效快照的场景。',
      default: false,
    },
  },
  runtimeParameters: [
    {
      path: 'month',
      field: {
        type: 'string',
        label: 'Month',
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
    task.params.skipWhenEmpty = task.params.skipWhenEmpty === true;
    normalizeWorkflowTaskDependencies(task);
  },
  async execute(context) {
    const { task, runtime } = context;
    const dataframe = await requireInputDataFrame(context, 'input1');
    // Nothing to write: leave the folder alone rather than publishing an empty file that would
    // become the newest artifact for the month and replace a snapshot a previous run produced.
    if (task.params.skipWhenEmpty === true && dataframe.rows.length === 0) {
      return { kind: 'dataframe', dataFrame: dataframe };
    }
    const baseFileName = normalizePersistExcelFileName(task.params.fileName, `${task.name || 'workflow-output'}`);
    const folderPrefix = String(task.params.folderPrefix ?? '').trim() || undefined;
    const fileName = withOutputFileVersion(
      suffixPersistExcelFileName(
        prefixPersistExcelFileName(baseFileName, task.params.fileNamePrefix),
        task.params.fileNameSuffix,
      ),
      folderPrefix,
    );
    const sheetName = String(task.params.sheetName ?? '').trim() || dataframe.range.sheetName || 'Sheet1';
    const uploadedBy = String(task.params.uploadedBy ?? '').trim() || 'Workflow';
    const buffer = runtime.dataFrameToWorkbookBuffer(dataframe, { sheetName });
    const persistedDataFrame = withPersistedSheetName(dataframe, sheetName);

    const file = await runtime.saveGeneratedWorkbook({
      originalName: fileName,
      buffer,
      uploadedBy,
      folderPrefix,
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
    const fileName = suffixPersistExcelFileName(
      prefixPersistExcelFileName(baseFileName, task.params.fileNamePrefix),
      task.params.fileNameSuffix,
    );
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

import * as XLSX from 'xlsx';
import type { WorkflowDataFrame } from '../../../shared/types.js';
import {
  defineWorkflowOperator,
  isWorkflowRuntimeReference,
  normalizePersistExcelFileName,
  normalizeWorkflowTaskDependencies,
  prefixPersistExcelFileName,
  requireInputDataFrame,
} from './types.js';

function currentMonthKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
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
  const normalized = String(folderPrefix ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  return normalized === 'output' || normalized.startsWith('output/');
}

function withOutputFileVersion(fileName: string, folderPrefix: unknown): string {
  if (!isOutputFolder(folderPrefix)) return fileName;
  if (/\.v\d{14}\.[^.]+$/i.test(fileName)) return fileName;
  return fileName.replace(/(\.[^.]+)$/i, `.v${timestampVersionTag()}$1`);
}

type WorkbookSheetSpec = {
  inputSlot: string;
  sheetName: string;
  headerRow: number;
  columnFormats: Record<string, string>;
};

function normalizeColumnFormats(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([column, format]) => [column.trim(), String(format ?? '').trim()] as const)
      .filter(([column, format]) => column && format),
  );
}

function dataframeToSheet(dataframe: WorkflowDataFrame, spec: WorkbookSheetSpec): XLSX.WorkSheet {
  const rows = dataframe.rows.map((row) => dataframe.columns.map((column) => row[column] ?? null));
  const padding = Array.from({ length: Math.max(0, spec.headerRow - 1) }, () => []);
  const worksheet = XLSX.utils.aoa_to_sheet([...padding, dataframe.columns, ...rows]);

  dataframe.columns.forEach((column, columnOffset) => {
    const format = spec.columnFormats[column];
    if (!format) return;
    for (let rowOffset = 0; rowOffset < rows.length; rowOffset += 1) {
      const address = XLSX.utils.encode_cell({
        r: spec.headerRow + rowOffset,
        c: columnOffset,
      });
      const cell = worksheet[address];
      if (cell && cell.v !== null && cell.v !== undefined && cell.v !== '') {
        cell.z = format;
      }
    }
  });

  return worksheet;
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

function normalizeSheetsParam(value: unknown): WorkbookSheetSpec[] {
  if (!Array.isArray(value)) {
    return [{ inputSlot: 'input1', sheetName: 'Sheet1', headerRow: 1, columnFormats: {} }];
  }
  const sheets = value
    .map((item) => {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) return null;
      const record = item as Record<string, unknown>;
      const inputSlot = String(record.inputSlot ?? '').trim();
      const sheetName = String(record.sheetName ?? '').trim();
      const rawHeaderRow = Number(record.headerRow ?? 1);
      const headerRow = Number.isInteger(rawHeaderRow) && rawHeaderRow > 0 ? rawHeaderRow : 1;
      const columnFormats = normalizeColumnFormats(record.columnFormats);
      return inputSlot && sheetName ? { inputSlot, sheetName, headerRow, columnFormats } : null;
    })
    .filter((item): item is WorkbookSheetSpec => Boolean(item));
  return sheets.length
    ? sheets
    : [{ inputSlot: 'input1', sheetName: 'Sheet1', headerRow: 1, columnFormats: {} }];
}

function normalizeConflictPolicy(value: unknown): 'error' | 'overwrite' {
  return value === 'overwrite' ? 'overwrite' : 'error';
}

export const workbookPersistExcelOperator = defineWorkflowOperator({
  code: 'workbook.persist.excel',
  name: 'Persist Workbook To Excel',
  version: '1.0.0',
  category: 'Output',
  description: '将多个 dataframe 写入同一个 Excel workbook 的多个 sheet 并保存到 Files。',
  inputSlots: [{ slot: 'input1', type: 'table', contentType: 'application/json', label: 'DataFrame 1', required: true }],
  outputSlots: [{ slot: 'dataframe', type: 'table', contentType: 'application/json', label: 'First DataFrame' }],
  paramsSchema: {
    fileName: { type: 'string', label: '文件名', required: true, placeholder: 'workflow-output.xlsx', default: 'workflow-output.xlsx' },
    fileNamePrefix: { type: 'string', label: '文件名前缀', required: false, placeholder: '2026-05', default: '' },
    folderPrefix: { type: 'string', label: '输出目录', required: false, placeholder: 'output/captable', default: '' },
    sheets: {
      type: 'array',
      label: 'Sheets',
      required: true,
      description: '每项可设置 inputSlot、sheetName、headerRow 和 columnFormats。',
      default: [{ inputSlot: 'input1', sheetName: 'Sheet1', headerRow: 1, columnFormats: {} }],
    },
    versionedOutput: {
      type: 'boolean',
      label: '输出文件加版本时间戳',
      required: false,
      description: '开启时 output 目录下会追加时间戳；关闭后可配合 overwrite 实现固定逻辑路径。',
      default: true,
    },
    conflictPolicy: {
      type: 'string',
      label: '文件冲突策略',
      required: false,
      enum: ['error', 'overwrite'],
      default: 'error',
    },
    uploadedBy: { type: 'string', label: '上传人', required: false, placeholder: 'Workflow', default: 'Workflow' },
  },
  documentation: {
    usage: '把多个上游 dataframe 分别写入同一个 workbook 的多个 sheet。适合 CapTable 这类一个结果文件包含多张业务表的输出。',
    steps: [
      '连接多个 dataframe 输入。',
      '在 sheets 中声明 inputSlot、sheetName；可用 headerRow 定位表头，并用 columnFormats 设置 Excel 单元格格式。',
      '配置文件名、目录、版本策略和冲突策略。',
    ],
    example: `{
  "fileName": "Capitalization_Table_Summary_View.xlsx",
  "fileNamePrefix": { "$fromRuntime": "month" },
  "folderPrefix": "output/captable",
  "sheets": [
    { "inputSlot": "reconciliation", "sheetName": "Shares OS Reconciliation", "headerRow": 1 },
    { "inputSlot": "capitalization", "sheetName": "Capitalization Summary", "headerRow": 1 }
  ]
}`,
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
    const sheets = normalizeSheetsParam(task.params.sheets);
    task.inputs = Object.fromEntries(
      sheets.map((sheet) => [
        sheet.inputSlot,
        {
          from: String(task.inputs?.[sheet.inputSlot]?.from ?? '').trim(),
          slot: 'dataframe',
          guards: task.inputs?.[sheet.inputSlot]?.guards,
        },
      ]),
    );
    task.params.sheets = sheets;
    normalizeWorkflowTaskDependencies(task);
  },
  async execute(context) {
    const { task, runtime } = context;
    const sheets = normalizeSheetsParam(task.params.sheets);
    const workbook = XLSX.utils.book_new();
    let firstDataFrame: WorkflowDataFrame | null = null;
    let firstSheetName = sheets[0]?.sheetName ?? 'Sheet1';

    for (const sheet of sheets) {
      const dataframe = await requireInputDataFrame(context, sheet.inputSlot);
      firstDataFrame ??= dataframe;
      firstSheetName = firstDataFrame === dataframe ? sheet.sheetName : firstSheetName;
      XLSX.utils.book_append_sheet(workbook, dataframeToSheet(dataframe, sheet), sheet.sheetName);
    }

    if (!firstDataFrame) throw new Error(`Task ${task.name} requires at least one input dataframe`);

    const baseFileName = normalizePersistExcelFileName(task.params.fileName, `${task.name || 'workflow-output'}`);
    const folderPrefix = String(task.params.folderPrefix ?? '').trim() || undefined;
    const versionedOutput = task.params.versionedOutput !== false;
    const fileName = versionedOutput
      ? withOutputFileVersion(prefixPersistExcelFileName(baseFileName, task.params.fileNamePrefix), folderPrefix)
      : prefixPersistExcelFileName(baseFileName, task.params.fileNamePrefix);
    const uploadedBy = String(task.params.uploadedBy ?? '').trim() || 'Workflow';
    const conflictPolicy = normalizeConflictPolicy(task.params.conflictPolicy);
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const persistedDataFrame = withPersistedSheetName(firstDataFrame, firstSheetName);

    const file = await runtime.saveGeneratedWorkbook({
      originalName: fileName,
      buffer,
      uploadedBy,
      folderPrefix,
      conflictPolicy,
    });

    return {
      kind: 'file',
      file,
      dataFrame: persistedDataFrame,
    };
  },
  async preview(context) {
    const { task } = context;
    const sheets = normalizeSheetsParam(task.params.sheets);
    const first = sheets[0] ?? {
      inputSlot: 'input1',
      sheetName: 'Sheet1',
      headerRow: 1,
      columnFormats: {},
    };
    const dataframe = await requireInputDataFrame(context, first.inputSlot);
    const baseFileName = normalizePersistExcelFileName(task.params.fileName, `${task.name || 'workflow-output'}`);
    const fileName = prefixPersistExcelFileName(baseFileName, task.params.fileNamePrefix);
    return {
      kind: 'file-plan',
      fileName,
      sheetName: sheets.map((sheet) => sheet.sheetName).join(', '),
      dataFrame: withPersistedSheetName(dataframe, first.sheetName),
    };
  },
});

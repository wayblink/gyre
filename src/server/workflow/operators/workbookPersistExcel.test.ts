import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import type { ProductFileRecord, WorkflowTask } from '../../../shared/types.js';
import { rowsToDataFrame } from '../../excel.js';
import { workbookPersistExcelOperator } from './workbookPersistExcel.js';
import { prefixPersistExcelFileName, suffixPersistExcelFileName } from './types.js';

function outputFile(): ProductFileRecord {
  return {
    id: 1,
    originalName: 'base.xlsx',
    displayName: 'base.xlsx',
    storedName: 'base.xlsx',
    displayPath: 'output/base.xlsx',
    fileExt: 'xlsx',
    fileSizeBytes: 1,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    checksum: 'test',
    storageBackend: 'test',
    workbookSheetCount: 1,
    workbookRowCount: 1,
    uploadedBy: 'Workflow',
    createdAt: new Date(0).toISOString(),
  };
}

test('workbook persist applies configured column formats below a custom header row', async () => {
  const dataframe = rowsToDataFrame([{ 'As of Date': 45229, 'Process Date': 45230, Value: 1 }], {
    sheetName: 'EQ Control Book',
    a1Range: '',
  });
  const task: WorkflowTask = {
    id: 'persist',
    name: 'Persist',
    operatorCode: 'workbook.persist.excel',
    operatorVersion: '1.0.0',
    description: '',
    x: 0,
    y: 0,
    inputs: {
      control_book: { from: 'source', slot: 'dataframe' },
    },
    params: {
      fileName: 'base.xlsx',
      sheets: [
        {
          inputSlot: 'control_book',
          sheetName: 'EQ Control Book',
          headerRow: 9,
          columnFormats: {
            'As of Date': 'dd\\-mmm\\-yyyy',
            'Process Date': 'dd\\-mmm\\-yyyy',
          },
        },
      ],
    },
  };
  let savedBuffer: Buffer | null = null;

  const result = await workbookPersistExcelOperator.execute({
    task,
    executed: new Map(),
    taskMap: new Map([[task.id, task]]),
    runtimeParameters: {},
    invocationStack: [],
    executeTask: async () => dataframe,
    resolveInputDataFrame: async () => dataframe,
    runtime: {
      extractSheetRangeAsDataFrame: () => dataframe,
      rowsToDataFrame,
      dataFrameToWorkbookBuffer: () => Buffer.alloc(0),
      readFile: async () => Buffer.alloc(0),
      async saveGeneratedWorkbook(params) {
        savedBuffer = params.buffer;
        return outputFile();
      },
    },
  });

  assert.equal('kind' in result ? result.kind : null, 'file');
  assert.ok(savedBuffer);
  const workbook = XLSX.read(savedBuffer, { type: 'buffer', cellNF: true, cellText: true });
  const sheet = workbook.Sheets['EQ Control Book'];
  assert.equal(sheet?.A9?.v, 'As of Date');
  assert.equal(sheet?.B9?.v, 'Process Date');
  assert.equal(sheet?.A10?.z, 'dd\\-mmm\\-yyyy');
  assert.equal(sheet?.B10?.z, 'dd\\-mmm\\-yyyy');
  assert.equal(sheet?.A10?.w, '30-Oct-2023');
  assert.equal(sheet?.B10?.w, '31-Oct-2023');
});

test('suffixPersistExcelFileName inserts an underscore month suffix before the extension', () => {
  assert.equal(suffixPersistExcelFileName('EQ_Control_Book_Base.xlsx', '2026_06'), 'EQ_Control_Book_Base_2026_06.xlsx');
  assert.equal(suffixPersistExcelFileName('base.xlsx', ''), 'base.xlsx');
  assert.equal(suffixPersistExcelFileName('base.xlsx', '   '), 'base.xlsx');
  assert.equal(suffixPersistExcelFileName('base.xlsx', '_2026_06_'), 'base_2026_06.xlsx');
  assert.equal(
    suffixPersistExcelFileName(prefixPersistExcelFileName('base.xlsx', '2026-06'), '2026_06'),
    '2026-06-base_2026_06.xlsx',
  );
});

test('workbook persist writes the dated base file name into an independent control_book folder', async () => {
  const dataframe = rowsToDataFrame([{ Value: 1 }], { sheetName: 'EQ Control Book', a1Range: '' });
  const task: WorkflowTask = {
    id: 'persist',
    name: 'Persist',
    operatorCode: 'workbook.persist.excel',
    operatorVersion: '1.0.0',
    description: '',
    x: 0,
    y: 0,
    inputs: { control_book: { from: 'source', slot: 'dataframe' } },
    params: {
      fileName: 'EQ_Control_Book_Base.xlsx',
      folderPrefix: 'control_book',
      fileNameSuffix: '2026_06',
      versionedOutput: false,
      sheets: [{ inputSlot: 'control_book', sheetName: 'EQ Control Book', headerRow: 9 }],
    },
  };
  let savedName: string | null = null;
  let savedFolder: string | undefined;
  await workbookPersistExcelOperator.execute({
    task,
    executed: new Map(),
    taskMap: new Map([[task.id, task]]),
    runtimeParameters: {},
    invocationStack: [],
    executeTask: async () => dataframe,
    resolveInputDataFrame: async () => dataframe,
    runtime: {
      extractSheetRangeAsDataFrame: () => dataframe,
      rowsToDataFrame,
      dataFrameToWorkbookBuffer: () => Buffer.alloc(0),
      readFile: async () => Buffer.alloc(0),
      async saveGeneratedWorkbook(params) {
        savedName = params.originalName;
        savedFolder = params.folderPrefix;
        return outputFile();
      },
    },
  });
  assert.equal(savedName, 'EQ_Control_Book_Base_2026_06.xlsx');
  assert.equal(savedFolder, 'control_book');
});

test('workbook persist keeps the month suffix ahead of the version tag under output/', async () => {
  const dataframe = rowsToDataFrame([{ Value: 1 }], { sheetName: 'Sheet1', a1Range: '' });
  const task: WorkflowTask = {
    id: 'persist',
    name: 'Persist',
    operatorCode: 'workbook.persist.excel',
    operatorVersion: '1.0.0',
    description: '',
    x: 0,
    y: 0,
    inputs: { input1: { from: 'source', slot: 'dataframe' } },
    params: {
      fileName: 'base.xlsx',
      folderPrefix: 'output/control-book',
      fileNameSuffix: '2026_06',
      sheets: [{ inputSlot: 'input1', sheetName: 'Sheet1', headerRow: 1 }],
    },
  };
  let savedName = '';
  await workbookPersistExcelOperator.execute({
    task,
    executed: new Map(),
    taskMap: new Map([[task.id, task]]),
    runtimeParameters: {},
    invocationStack: [],
    executeTask: async () => dataframe,
    resolveInputDataFrame: async () => dataframe,
    runtime: {
      extractSheetRangeAsDataFrame: () => dataframe,
      rowsToDataFrame,
      dataFrameToWorkbookBuffer: () => Buffer.alloc(0),
      readFile: async () => Buffer.alloc(0),
      async saveGeneratedWorkbook(params) {
        savedName = params.originalName;
        return outputFile();
      },
    },
  });
  assert.match(savedName, /^base_2026_06\.v\d{14}\.xlsx$/);
});

test('workbook persist preview reports the same dated file name as execute', async () => {
  const dataframe = rowsToDataFrame([{ Value: 1 }], { sheetName: 'EQ Control Book', a1Range: '' });
  const task: WorkflowTask = {
    id: 'persist',
    name: 'Persist',
    operatorCode: 'workbook.persist.excel',
    operatorVersion: '1.0.0',
    description: '',
    x: 0,
    y: 0,
    inputs: { control_book: { from: 'source', slot: 'dataframe' } },
    params: {
      fileName: 'EQ_Control_Book_Base.xlsx',
      folderPrefix: 'control_book',
      fileNameSuffix: '2026_06',
      versionedOutput: false,
      sheets: [{ inputSlot: 'control_book', sheetName: 'EQ Control Book', headerRow: 9 }],
    },
  };
  const result = await workbookPersistExcelOperator.preview!({
    task,
    executed: new Map(),
    taskMap: new Map([[task.id, task]]),
    runtimeParameters: {},
    invocationStack: [],
    executeTask: async () => dataframe,
    resolveInputDataFrame: async () => dataframe,
    runtime: {
      extractSheetRangeAsDataFrame: () => dataframe,
      rowsToDataFrame,
      dataFrameToWorkbookBuffer: () => Buffer.alloc(0),
      readFile: async () => Buffer.alloc(0),
      saveGeneratedWorkbook: async () => outputFile(),
    },
  });
  assert.equal(result.kind === 'file-plan' ? result.fileName : null, 'EQ_Control_Book_Base_2026_06.xlsx');
});

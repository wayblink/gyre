import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import type { WorkflowDataFrame } from '../shared/types.js';
import {
  dataFrameToWorkbookBuffer,
  extractSheetRangeAsDataFrame,
  rowsToDataFrame,
  summarizeValidatedWorkbook,
  summarizeValidatedWorkbookAsync,
} from './excel.js';

function dataframeFixture(): WorkflowDataFrame {
  return {
    columns: ['Number', 'Employee Number', 'Common Shares Equivalent', '% of fully diluted', 'Formula'],
    rows: [
      {
        Number: '1',
        'Employee Number': '00123',
        'Common Shares Equivalent': '91,466,284',
        '% of fully diluted': '68.50%',
        Formula: 'source note',
      },
      {
        Number: '002',
        'Employee Number': '456',
        'Common Shares Equivalent': 'not available',
        '% of fully diluted': 'n/a',
        Formula: 'free text',
      },
    ],
    index: [1, 2],
    matrix: [],
    range: {
      sheetName: 'Capitalization Summary',
      a1Range: 'A1:E3',
      startRow: 1,
      endRow: 3,
      startCol: 1,
      endCol: 5,
    },
    schema: [
      { name: 'Number', index: 1, type: 'number', nullable: false, formats: [] },
      { name: 'Employee Number', index: 2, type: 'string', nullable: false, formats: [] },
      { name: 'Common Shares Equivalent', index: 3, type: 'number', nullable: false, formats: ['#,##0'] },
      { name: '% of fully diluted', index: 4, type: 'number', nullable: false, formats: ['0.00%'] },
      { name: 'Formula', index: 5, type: 'string', nullable: false, formats: [] },
    ],
  };
}

test('dataframe workbook export writes typed numeric columns as numbers and preserves string columns', () => {
  const workbook = XLSX.read(dataFrameToWorkbookBuffer(dataframeFixture()), {
    type: 'buffer',
    cellNF: true,
    cellText: true,
  });
  const worksheet = workbook.Sheets['Capitalization Summary'];
  assert.ok(worksheet);

  assert.equal(worksheet.A2?.t, 'n');
  assert.equal(worksheet.A2?.v, 1);
  assert.equal(worksheet.A3?.t, 's');
  assert.equal(worksheet.A3?.v, '002');
  assert.equal(worksheet.B2?.t, 's');
  assert.equal(worksheet.B2?.v, '00123');
  assert.equal(worksheet.C2?.t, 'n');
  assert.equal(worksheet.C2?.v, 91466284);
  assert.equal(worksheet.C3?.t, 's');
  assert.equal(worksheet.C3?.v, 'not available');
  assert.equal(worksheet.D2?.t, 'n');
  assert.equal(worksheet.D2?.v, 0.685);
  assert.equal(worksheet.D2?.z, '0.00%');
  assert.equal(worksheet.E2?.t, 's');
  assert.equal(worksheet.E2?.v, 'source note');
});

test('uploaded workbook validation rejects text disguised as xlsx', () => {
  assert.throws(
    () => summarizeValidatedWorkbook(Buffer.from('not a workbook'), 'fake.xlsx'),
    /Invalid XLSX file signature/,
  );
  assert.throws(() => summarizeValidatedWorkbook(Buffer.alloc(0), 'empty.xlsx'), /empty/i);
});

test('uploaded workbook validation accepts real xlsx and non-empty csv', () => {
  const worksheet = XLSX.utils.aoa_to_sheet([
    ['Name', 'Value'],
    ['A', 1],
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Data');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

  assert.equal(summarizeValidatedWorkbook(buffer, 'valid.xlsx').sheetCount, 1);
  assert.equal(summarizeValidatedWorkbook(Buffer.from('Name,Value\nA,1\n'), 'valid.csv').sheetCount, 1);
  assert.throws(() => summarizeValidatedWorkbook(Buffer.from([0, 1, 2]), 'binary.csv'), /Invalid CSV/);
});

test('uploaded workbook parsing can run in the resource-limited worker', async () => {
  const worksheet = XLSX.utils.aoa_to_sheet([
    ['Name', 'Value'],
    ['A', 1],
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Data');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

  const summary = await summarizeValidatedWorkbookAsync(buffer, 'valid.xlsx');
  assert.equal(summary.sheetCount, 1);
  assert.equal(summary.totalRowCount, 1);
});

test('rowsToDataFrame normalizes inferable numeric values and keeps ambiguous strings', () => {
  const dataframe = rowsToDataFrame([
    {
      Number: '1',
      'Employee Number': '00123',
      'Common Shares Equivalent': '91,466,284',
      '% of fully diluted': '68.50%',
      Formula: 'source note',
      Ambiguous: '123',
    },
    {
      Number: '002',
      'Employee Number': '456',
      'Common Shares Equivalent': 'not available',
      '% of fully diluted': 'n/a',
      Formula: 'free text',
      Ambiguous: '456',
    },
  ]);

  assert.equal(dataframe.rows[0].Number, 1);
  assert.equal(dataframe.rows[1].Number, '002');
  assert.equal(dataframe.rows[0]['Employee Number'], '00123');
  assert.equal(dataframe.rows[1]['Employee Number'], '456');
  assert.equal(dataframe.rows[0]['Common Shares Equivalent'], 91466284);
  assert.equal(dataframe.rows[1]['Common Shares Equivalent'], 'not available');
  assert.equal(dataframe.rows[0]['% of fully diluted'], 0.685);
  assert.equal(dataframe.rows[1]['% of fully diluted'], 'n/a');
  assert.equal(dataframe.rows[0].Ambiguous, '123');
  assert.equal(dataframe.schema?.find((column) => column.name === 'Number')?.type, 'mixed');
  assert.equal(dataframe.schema?.find((column) => column.name === 'Employee Number')?.type, 'string');
  assert.equal(dataframe.schema?.find((column) => column.name === '% of fully diluted')?.type, 'mixed');
});

test('extractSheetRangeAsDataFrame supports open-ended row ranges to the sheet bottom', () => {
  const worksheet = XLSX.utils.aoa_to_sheet([
    ['ignore', 'ignore'],
    ['Name', 'Value'],
    ['A', 1],
    ['B', 2],
    ['C', 3],
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Variable');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

  const dataframe = extractSheetRangeAsDataFrame(buffer, 'Variable', { range: 'A2:B', headerRow: 2 });

  assert.deepEqual(dataframe.columns, ['Name', 'Value']);
  assert.deepEqual(
    dataframe.rows.map((row) => row.Name),
    ['A', 'B', 'C'],
  );
  assert.equal(dataframe.range.startRow, 2);
  assert.equal(dataframe.range.endRow, 5);
  assert.equal(dataframe.range.a1Range, 'A2:B5');
});

test('extractSheetRangeAsDataFrame caps wide open-ended ranges to actual cells', () => {
  const worksheet = XLSX.utils.aoa_to_sheet([
    ['ignore', 'ignore', 'ignore'],
    ['ignore', 'ignore', 'ignore'],
    ['Plan Name', 'Outstanding Calc.', 'Options Outstanding'],
    ['Plan A', 100, 0],
    ['Plan B', 0, 220],
  ]);
  worksheet['!ref'] = 'A1:ZZ1000';
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'WideRef');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

  const dataframe = extractSheetRangeAsDataFrame(buffer, 'WideRef', { range: 'A3:XFD', headerRow: 3 });

  assert.deepEqual(dataframe.columns, ['Plan Name', 'Outstanding Calc.', 'Options Outstanding']);
  assert.deepEqual(
    dataframe.rows.map((row) => row['Plan Name']),
    ['Plan A', 'Plan B'],
  );
  assert.equal(dataframe.range.a1Range, 'A3:C5');
  assert.equal(dataframe.range.endCol, 3);
});

test('extractSheetRangeAsDataFrame trims trailing blank rows from extracted data', () => {
  const worksheet = XLSX.utils.aoa_to_sheet([
    ['ignore', 'ignore'],
    ['Name', 'Value'],
    ['A', 1],
    ['', ''],
    ['B', 2],
  ]);
  worksheet.A8 = { t: 's', v: '' };
  worksheet['!ref'] = 'A1:B8';
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Trailing blanks');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

  const dataframe = extractSheetRangeAsDataFrame(buffer, 'Trailing blanks', { range: 'A2:B', headerRow: 2 });

  assert.equal(dataframe.rows.length, 3);
  assert.deepEqual(
    dataframe.rows.map((row) => row.Name),
    ['A', '', 'B'],
  );
  assert.equal(dataframe.range.endRow, 5);
  assert.equal(dataframe.range.a1Range, 'A2:B5');
});

test('extractSheetRangeAsDataFrame can keep trailing blank rows when configured', () => {
  const worksheet = XLSX.utils.aoa_to_sheet([
    ['ignore', 'ignore'],
    ['Name', 'Value'],
    ['A', 1],
    ['', ''],
    ['B', 2],
  ]);
  worksheet.A8 = { t: 's', v: '' };
  worksheet['!ref'] = 'A1:B8';
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Keep trailing blanks');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

  const dataframe = extractSheetRangeAsDataFrame(buffer, 'Keep trailing blanks', {
    range: 'A2:B',
    headerRow: 2,
    dropTrailingEmptyRows: false,
  });

  assert.equal(dataframe.rows.length, 6);
  assert.equal(dataframe.range.endRow, 8);
  assert.equal(dataframe.range.a1Range, 'A2:B8');
});

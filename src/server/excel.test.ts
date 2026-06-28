import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import type { WorkflowDataFrame } from '../shared/types.js';
import { dataFrameToWorkbookBuffer, rowsToDataFrame } from './excel.js';

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

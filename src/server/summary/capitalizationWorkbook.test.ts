import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import type { SummarySnapshot } from '../../shared/types.js';
import {
  parseCapitalizationSummarySheet,
  parseCapitalizationWorkbook,
  summaryCapitalizationToWorkbookBuffer,
} from './capitalizationWorkbook.js';

function summaryFixture(): SummarySnapshot {
  return {
    month: '2026-06',
    eomDate: '2026-06-30',
    reconciliation: {
      item: 'Test',
      lastMonth: 0,
      newShares: 0,
      eomBalance: 0,
    },
    capitalization: [
      {
        type: 'cat-header-blue',
        description: 'Capitalization Table (Summary View)',
      },
      {
        type: 'data',
        number: '1',
        description: 'Common Stock',
        shares: 100,
        percent: 0.25,
      },
      {
        type: 'cat-sub-label',
        description: 'Outstanding shares',
        shares: 100,
      },
    ],
    totalFullyDiluted: 400,
    formulaTrace: {},
    notes: [],
  };
}

test('summary capitalization export writes Number values as numeric cells and omits blank string cells', () => {
  const workbook = XLSX.read(summaryCapitalizationToWorkbookBuffer(summaryFixture()), {
    type: 'buffer',
    cellNF: true,
    cellText: true,
  });
  const worksheet = workbook.Sheets['Capitalization Summary'];
  assert.ok(worksheet);

  assert.equal(worksheet.A2, undefined);
  assert.equal(worksheet.A3?.t, 'n');
  assert.equal(worksheet.A3?.v, 1);
  assert.equal(worksheet.A4, undefined);
  assert.equal(worksheet.A5, undefined);
});

test('capitalization summary parser keeps total fully diluted row percent from workbook', () => {
  const parsed = parseCapitalizationSummarySheet(
    summaryCapitalizationToWorkbookBuffer(summaryFixture()),
    'Capitalization Summary',
  );
  const totalRow = parsed.capitalization.at(-1);

  assert.equal(parsed.totalFullyDiluted, 400);
  assert.equal(totalRow?.type, 'data');
  assert.equal(totalRow?.description, 'Total Fully Diluted Shares Outstand');
  assert.equal(totalRow?.shares, 400);
  assert.equal(totalRow?.percent, 1);
});

test('capitalization workbook parser reads Shares OS Reconciliation sheet from workflow output', () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet([
      {
        Item: 'Equity Outstanding as of',
        'As of': '2026/5/31',
        'Last Month': 97_028_322,
        'New Shares': 14_460_527,
        'EOM Balance': 111_488_849,
      },
    ]),
    'Shares OS Reconciliation',
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet([
      {
        Number: null,
        Description: 'Asset Class Summary: EOM',
        'Common Shares Equivalent': 111_488_849,
        '% of fully diluted': null,
      },
      {
        Number: null,
        Description: 'Total Fully Diluted Shares Outstand',
        'Common Shares Equivalent': 133_527_448,
        '% of fully diluted': 1,
      },
    ]),
    'Capitalization Summary',
  );

  const parsed = parseCapitalizationWorkbook(
    XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer,
    'Shares OS Reconciliation',
  );

  assert.deepEqual(parsed.reconciliation, {
    item: 'Equity Outstanding as of',
    lastMonth: 97_028_322,
    newShares: 14_460_527,
    eomBalance: 111_488_849,
  });
  assert.equal(parsed.resolvedSheetName, 'Capitalization Summary');
  assert.equal(parsed.totalFullyDiluted, 133_527_448);
});

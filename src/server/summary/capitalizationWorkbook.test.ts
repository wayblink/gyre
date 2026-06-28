import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import type { SummarySnapshot } from '../../shared/types.js';
import { summaryCapitalizationToWorkbookBuffer } from './capitalizationWorkbook.js';

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

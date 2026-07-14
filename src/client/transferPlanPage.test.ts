import assert from 'node:assert/strict';
import test from 'node:test';
import type { TransferPlanResponse } from '../shared/types.js';
import { renderTransferPlanSummaryTable } from './transferPlanPage.js';

const data: TransferPlanResponse = {
  sourceFileId: 7,
  sourceFileName: '2025 BC Subplan Transfer.xlsx',
  detailCount: 2,
  items: [
    {
      id: 11,
      sourceFileId: 7,
      period: '2025-01',
      inTotal: 100,
      sourceCancelled: -3,
      cancelledQuantity: -3,
      transferToFutu: 97,
      manuallyEdited: false,
      sortOrder: 1,
    },
    {
      id: 12,
      sourceFileId: 7,
      period: '2025-02',
      inTotal: 200,
      sourceCancelled: -5,
      cancelledQuantity: -4,
      transferToFutu: 196,
      manuallyEdited: true,
      sortOrder: 2,
    },
  ],
  totals: {
    inTotal: 300,
    sourceCancelled: -8,
    cancelledQuantity: -7,
    transferToFutu: 293,
  },
};

const deps = {
  escapeHtml: (value: unknown) =>
    String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;'),
  formatNumber: (value: unknown) => Number(value).toLocaleString('en-US'),
};

test('renders transfer plan summary rows as the default table view', () => {
  const table = renderTransferPlanSummaryTable(data, 'summaryRows', deps);

  assert.match(table.headHtml, /<th>Summary<\/th>/);
  assert.match(table.headHtml, /<th>2025-01<\/th>/);
  assert.match(table.bodyHtml, /<th>In total<\/th>/);
  assert.match(table.bodyHtml, /<th>Options cancelled\/forfeited<\/th>/);
  assert.match(table.bodyHtml, /data-transfer-cancelled-id="12"/);
  assert.match(table.bodyHtml, /class="transfer-plan-cancel-input is-edited"/);
  assert.match(table.bodyHtml, /<th>Transfer to Futu<\/th>/);
});

test('renders transfer plan period rows in the transposed table view', () => {
  const table = renderTransferPlanSummaryTable(data, 'periodRows', deps);

  assert.match(table.headHtml, /<th>Period<\/th>/);
  assert.match(table.headHtml, /<th>Options cancelled\/forfeited<\/th>/);
  assert.match(table.bodyHtml, /<th>2025-01<\/th>/);
  assert.match(table.bodyHtml, /data-transfer-cancelled-id="11"/);
  assert.match(table.bodyHtml, /<th>Total<\/th>/);
  assert.match(table.bodyHtml, /<td class="transfer-plan-total">293<\/td>/);
  assert.doesNotMatch(table.bodyHtml, /<th>Summary<\/th>/);
});

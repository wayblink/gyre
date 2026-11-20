import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCellDetail, formatCellRawValue, placeCellDetail, shortenNumberPattern } from './workbookCellDetail.js';

/**
 * The read-only preview paints numbers with the cell's number format, so B148 reads `-29,590` while
 * the file stores `-29590.2182`; Univer hides the exact value behind a cell editor it refuses to open
 * in read-only mode. These are the two invariants the detail card depends on: the stored value is
 * shown with full precision, and the card never opens outside the viewer.
 */

test('the stored value wins over the painted number format', () => {
  const detail = buildCellDetail({
    sheetName: '!Option Plans Summary',
    address: 'B148',
    rawValue: -29590.2182,
    formula: '',
    numberPattern: '#,##0',
  });
  assert.equal(detail.address, 'B148');
  assert.equal(detail.sheetName, '!Option Plans Summary');
  assert.equal(detail.rawValueText, '-29590.2182');
  assert.equal(detail.numberPattern, '#,##0');
  assert.equal(detail.isEmpty, false);
});

test('Excel repeats the thousands separator group; the card keeps one', () => {
  assert.equal(shortenNumberPattern('#,###,###,###,##0'), '#,###,##0');
  assert.equal(shortenNumberPattern('#,##0'), '#,##0');
  assert.equal(shortenNumberPattern('0.00%'), '0.00%');
  assert.equal(shortenNumberPattern('  #,##0  '), '#,##0');
});

test('empty cells say so instead of rendering nothing', () => {
  const detail = buildCellDetail({ sheetName: 'Sheet1', address: 'C7', rawValue: null, formula: '' });
  assert.equal(detail.rawValueText, '');
  assert.equal(detail.isEmpty, true);
  assert.equal(detail.formulaText, '');
  assert.equal(detail.numberPattern, '');
});

test('a formula keeps the cell non-empty even without a cached value', () => {
  const detail = buildCellDetail({ sheetName: 'S', address: 'A1', rawValue: null, formula: '=SUM(A2:A9)' });
  assert.equal(detail.formulaText, '=SUM(A2:A9)');
  assert.equal(detail.isEmpty, false);
});

test('raw values keep their type instead of being painted through the number format', () => {
  assert.equal(formatCellRawValue(0), '0');
  assert.equal(formatCellRawValue(478932), '478932');
  assert.equal(formatCellRawValue(0.0000001), '1e-7');
  assert.equal(formatCellRawValue(true), 'TRUE');
  assert.equal(formatCellRawValue(false), 'FALSE');
  assert.equal(formatCellRawValue('2026-09-30'), '2026-09-30');
  assert.equal(formatCellRawValue(null), '');
  assert.equal(formatCellRawValue(undefined), '');
});

test('the card opens below-right of the pointer when there is room', () => {
  assert.deepEqual(
    placeCellDetail({ hostWidth: 900, hostHeight: 700, cardWidth: 272, cardHeight: 148, x: 120, y: 90 }),
    { left: 126, top: 96 },
  );
});

test('near the right or bottom edge the card flips instead of opening out of view', () => {
  assert.deepEqual(
    placeCellDetail({ hostWidth: 900, hostHeight: 700, cardWidth: 272, cardHeight: 148, x: 800, y: 640 }),
    { left: 522, top: 486 },
  );
});

test('a viewer smaller than the card keeps the card at the margin', () => {
  assert.deepEqual(
    placeCellDetail({ hostWidth: 200, hostHeight: 120, cardWidth: 272, cardHeight: 148, x: 100, y: 60 }),
    { left: 8, top: 8 },
  );
});

test('a pointer at the top-left corner still leaves the margin', () => {
  assert.deepEqual(placeCellDetail({ hostWidth: 900, hostHeight: 700, cardWidth: 272, cardHeight: 148, x: 5, y: 5 }), {
    left: 11,
    top: 11,
  });
});

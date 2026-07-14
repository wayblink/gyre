import assert from 'node:assert/strict';
import test from 'node:test';
import { parseEsopDateText, parseEsopNumber } from './persistence.js';

test('ESOP workbook placeholders are treated as blank numeric values', () => {
  assert.equal(parseEsopNumber('--', 'closing price'), null);
  assert.equal(parseEsopNumber('', 'closing price'), null);
  assert.equal(parseEsopNumber('1,234.5', 'quantity'), 1234.5);
});

test('Shareworks Excel date serials are persisted as readable dates', () => {
  assert.equal(parseEsopDateText(45804), '2025-05-27');
  assert.equal(parseEsopDateText('27-May-2025'), '27-May-2025');
  assert.equal(parseEsopDateText(null), null);
});

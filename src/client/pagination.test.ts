import assert from 'node:assert/strict';
import test from 'node:test';

import { edgePage, nextPageWithinBounds, paginationView } from './pagination.js';

test('pagination view reports the visible range, the page label and the enabled controls', () => {
  const middle = paginationView({ page: 3, pageSize: 20, total: 100, totalPages: 5 });
  assert.deepEqual(middle, { start: 41, end: 60, pageLabel: '3 / 5', canPrev: true, canNext: true });

  const last = paginationView({ page: 5, pageSize: 20, total: 100, totalPages: 5 });
  assert.deepEqual(last, { start: 81, end: 100, pageLabel: '5 / 5', canPrev: true, canNext: false });

  // Empty result: nothing to page through, so both directions stay disabled.
  assert.deepEqual(paginationView({ page: 1, pageSize: 20, total: 0, totalPages: 0 }), {
    start: 0,
    end: 0,
    pageLabel: '0 / 1',
    canPrev: false,
    canNext: false,
  });

  // A short last page clamps `end` to the total.
  assert.deepEqual(paginationView({ page: 2, pageSize: 20, total: 25, totalPages: 2 }), {
    start: 21,
    end: 25,
    pageLabel: '2 / 2',
    canPrev: true,
    canNext: false,
  });
});

test('relative and edge page moves stay inside the reported page count', () => {
  // 100 records / 20 per page -> 5 pages.
  assert.equal(nextPageWithinBounds(100, 20, 3, 1), 4);
  assert.equal(nextPageWithinBounds(100, 20, 3, -1), 2);
  // Clamped at both ends, and a no-op move is reported as null so the caller can skip the reload.
  assert.equal(nextPageWithinBounds(100, 20, 1, -1), null);
  assert.equal(nextPageWithinBounds(100, 20, 5, 1), null);
  assert.equal(edgePage(100, 20, 1, 'first'), null);
  assert.equal(edgePage(100, 20, 5, 'last'), null);
  assert.equal(edgePage(100, 20, 3, 'first'), 1);
  assert.equal(edgePage(100, 20, 3, 'last'), 5);
  // Empty list still resolves to page 1.
  assert.equal(edgePage(0, 20, 3, 'last'), 1);
  assert.equal(nextPageWithinBounds(0, 20, 3, 1), 1);
});

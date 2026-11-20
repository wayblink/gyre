import assert from 'node:assert/strict';
import test from 'node:test';

import { selectionRange } from './fileSelection.js';

test('shift selection covers the visible rows between the anchor and the target', () => {
  assert.deepEqual(selectionRange([1, 2, 3, 4, 5], 2, 4), { fromIndex: 1, toIndex: 3 });
  assert.deepEqual(selectionRange([1, 2, 3, 4, 5], 5, 2), { fromIndex: 1, toIndex: 4 });
  assert.deepEqual(selectionRange([1, 2, 3], 2, 2), { fromIndex: 1, toIndex: 1 });
});

test('shift selection gives up when either row is no longer visible', () => {
  // The anchor can disappear when a folder is collapsed or the search filter hides it; the click
  // then has to fall back to a plain toggle instead of selecting a surprise range.
  assert.equal(selectionRange([1, 2, 3], 9, 2), null);
  assert.equal(selectionRange([1, 2, 3], 2, 9), null);
  assert.equal(selectionRange([1, 2, 3], null, 2), null);
  assert.equal(selectionRange([], 1, 2), null);
});

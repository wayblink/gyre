import assert from 'node:assert/strict';
import test from 'node:test';

import { clearWorkbookSummaryCache, workbookSummaryFor } from './workbookSummaryCache.js';

const summary = (rows: number) => ({
  sheetCount: 1,
  totalRowCount: rows,
  sheets: [{ sheetName: 'S', rowCount: rows, columns: ['a'] }],
});

test('a workbook summary is computed once per file content, not once per request', async () => {
  // Re-parsing a 3.8 MB workbook for every render of the input table cost 100-400 ms of CPU each time,
  // and the monthly page asks for a dozen files. The summary is derived purely from the bytes, so it is
  // cached against the file's content checksum.
  clearWorkbookSummaryCache();
  let computed = 0;
  const compute = async () => {
    computed += 1;
    return summary(10);
  };

  const first = await workbookSummaryFor({ fileId: 1, stamp: 'checksum-a' }, compute);
  const second = await workbookSummaryFor({ fileId: 1, stamp: 'checksum-a' }, compute);

  assert.deepEqual(first, second);
  assert.equal(computed, 1, 'the second read is served from cache');
});

test('a changed workbook is re-summarised', async () => {
  clearWorkbookSummaryCache();
  let computed = 0;
  const compute = async () => {
    computed += 1;
    return summary(computed);
  };

  await workbookSummaryFor({ fileId: 2, stamp: 'checksum-old' }, compute);
  const updated = await workbookSummaryFor({ fileId: 2, stamp: 'checksum-new' }, compute);

  assert.equal(computed, 2);
  assert.equal(updated.totalRowCount, 2);
});

test('the cache is bounded so a long-lived server cannot grow without limit', async () => {
  clearWorkbookSummaryCache();
  for (let id = 0; id < 200; id += 1) {
    await workbookSummaryFor({ fileId: id, stamp: 'same' }, async () => summary(id));
  }
  // The oldest entries were evicted; reading one back recomputes instead of returning stale data.
  let recomputed = false;
  await workbookSummaryFor({ fileId: 0, stamp: 'same' }, async () => {
    recomputed = true;
    return summary(0);
  });
  assert.equal(recomputed, true);
});

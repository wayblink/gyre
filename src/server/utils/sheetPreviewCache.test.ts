import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cachedSheetPreview,
  clearSheetPreviewCache,
  invalidateSheetPreviewCache,
  sheetPreviewCacheKey,
  sheetPreviewCacheStats,
  type CachedSheetPreview,
} from './sheetPreviewCache.js';

function preview(rows: number): CachedSheetPreview {
  return {
    sheetName: '取消与恢复明细',
    rowCount: rows,
    columns: ['创建编号', '数量'],
    rows: Array.from({ length: rows }, (_, index) => ({ 创建编号: `CRL${index}`, 数量: -1 })),
  };
}

test('a repeated read of the same file version is served from memory', async () => {
  clearSheetPreviewCache();
  let computed = 0;
  const key = sheetPreviewCacheKey({ fileId: 7, checksum: 'abc', sheetName: '取消与恢复明细', limit: 5000 });
  const compute = async () => {
    computed += 1;
    return preview(10);
  };

  const first = await cachedSheetPreview(key, compute);
  const second = await cachedSheetPreview(key, compute);
  assert.equal(computed, 1, 'the second read must not re-parse the workbook');
  assert.equal(first, second, 'the cached value is returned as-is');
});

test('a new checksum invalidates the entry without an explicit call', async () => {
  clearSheetPreviewCache();
  let computed = 0;
  const compute = async () => {
    computed += 1;
    return preview(5);
  };

  await cachedSheetPreview(sheetPreviewCacheKey({ fileId: 7, checksum: 'old', sheetName: 'S' }), compute);
  await cachedSheetPreview(sheetPreviewCacheKey({ fileId: 7, checksum: 'new', sheetName: 'S' }), compute);
  assert.equal(computed, 2, 'an overwritten file must be parsed again');
});

test('concurrent misses for one key share a single parse', async () => {
  clearSheetPreviewCache();
  let computed = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const compute = async () => {
    computed += 1;
    await gate;
    return preview(3);
  };
  const key = sheetPreviewCacheKey({ fileId: 9, checksum: 'x', sheetName: 'S' });

  const [a, b, c] = [
    cachedSheetPreview(key, compute),
    cachedSheetPreview(key, compute),
    cachedSheetPreview(key, compute),
  ];
  release();
  await Promise.all([a, b, c]);
  assert.equal(computed, 1);
});

test('the cache stays bounded and drops what it evicts', async () => {
  clearSheetPreviewCache();
  assert.deepEqual(sheetPreviewCacheStats(), { entries: 0, rows: 0 });

  // 9 distinct files of 3000 rows each: the entry cap (8) and the row cap (20k) both bite.
  for (let fileId = 1; fileId <= 9; fileId += 1) {
    await cachedSheetPreview(sheetPreviewCacheKey({ fileId, checksum: 'c', sheetName: 'S', limit: 5000 }), async () =>
      preview(3000),
    );
  }
  const stats = sheetPreviewCacheStats();
  assert.ok(stats.entries <= 8, `entries must stay capped, got ${stats.entries}`);
  assert.ok(stats.rows <= 20_000, `rows must stay capped, got ${stats.rows}`);
});

test('deleting or overwriting one file drops every sheet of it', async () => {
  clearSheetPreviewCache();
  let computed = 0;
  const compute = async () => {
    computed += 1;
    return preview(2);
  };

  await cachedSheetPreview(sheetPreviewCacheKey({ fileId: 11, checksum: 'c', sheetName: 'A' }), compute);
  await cachedSheetPreview(sheetPreviewCacheKey({ fileId: 11, checksum: 'c', sheetName: 'B' }), compute);
  await cachedSheetPreview(sheetPreviewCacheKey({ fileId: 12, checksum: 'c', sheetName: 'A' }), compute);
  assert.equal(computed, 3);

  invalidateSheetPreviewCache(11);
  await cachedSheetPreview(sheetPreviewCacheKey({ fileId: 11, checksum: 'c', sheetName: 'A' }), compute);
  await cachedSheetPreview(sheetPreviewCacheKey({ fileId: 11, checksum: 'c', sheetName: 'B' }), compute);
  assert.equal(computed, 5, 'both sheets of the invalidated file are parsed again');

  // The other file's entry survived.
  await cachedSheetPreview(sheetPreviewCacheKey({ fileId: 12, checksum: 'c', sheetName: 'A' }), compute);
  assert.equal(computed, 5);
});

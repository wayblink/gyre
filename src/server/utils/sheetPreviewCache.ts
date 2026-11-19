/**
 * Bounded cache for parsed workbook sheets.
 *
 * Every data page re-reads its workbook from storage and runs `XLSX.read` on it: 40+ ms of blocking
 * CPU for the ~750 KB ledger, on the single Node thread that serves every other request too. The
 * files only change when a workflow overwrites them, so the parsed rows are safe to reuse as long as
 * the key contains the file's checksum (an in-place overwrite changes it) — which also means an
 * evicted entry can never be served stale.
 *
 * The bound is deliberate: a small deployment has little RAM to spare, so the cache keeps a handful
 * of entries and a hard ceiling on total rows rather than trusting the workload to stay small.
 * Concurrent misses for the same key share one parse instead of each starting their own.
 */
export type CachedSheetPreview = {
  sheetName: string;
  rowCount: number;
  columns: string[];
  rows: Array<Record<string, unknown>>;
};

const MAX_ENTRIES = 8;
const MAX_ROWS = 20_000;

const cache = new Map<string, CachedSheetPreview>();
const inflight = new Map<string, Promise<CachedSheetPreview>>();
let cachedRows = 0;

export function sheetPreviewCacheKey(params: {
  fileId: number;
  checksum: string;
  sheetName: string;
  limit?: number;
  offset?: number;
}): string {
  const limit = params.limit ?? '';
  const offset = params.offset ?? '';
  return `${params.fileId}:${params.checksum}:${params.sheetName}:${limit}:${offset}`;
}

function remember(key: string, value: CachedSheetPreview): void {
  cache.set(key, value);
  cachedRows += value.rows.length;

  // Evict oldest entries until both bounds hold. A single entry larger than MAX_ROWS is still
  // returned to its caller; it is dropped right away so it cannot pin the cache.
  while ((cache.size > MAX_ENTRIES || cachedRows > MAX_ROWS) && cache.size > 0) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    const evicted = cache.get(oldest.value);
    cache.delete(oldest.value);
    cachedRows -= evicted?.rows.length ?? 0;
  }
}

/** Return the cached preview for `key`, computing it on a miss. */
export async function cachedSheetPreview(
  key: string,
  compute: () => Promise<CachedSheetPreview>,
): Promise<CachedSheetPreview> {
  const hit = cache.get(key);
  if (hit) {
    // A Map iterates oldest-first, so re-inserting on a hit turns it into an LRU.
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }

  const pending = inflight.get(key);
  if (pending) return pending;

  const promise = (async () => {
    const value = await compute();
    remember(key, value);
    return value;
  })();
  inflight.set(key, promise);
  try {
    return await promise;
  } finally {
    inflight.delete(key);
  }
}

/** Drop everything for one file (called when it is overwritten or deleted). */
export function invalidateSheetPreviewCache(fileId: number): void {
  const prefix = `${fileId}:`;
  for (const key of [...cache.keys()]) {
    if (!key.startsWith(prefix)) continue;
    const evicted = cache.get(key);
    cache.delete(key);
    cachedRows -= evicted?.rows.length ?? 0;
  }
}

/** Test hook: drop everything. */
export function clearSheetPreviewCache(): void {
  cache.clear();
  inflight.clear();
  cachedRows = 0;
}

/** Test hook: what the cache is holding. */
export function sheetPreviewCacheStats(): { entries: number; rows: number } {
  return { entries: cache.size, rows: cachedRows };
}

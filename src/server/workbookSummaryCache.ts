import type { WorkbookSummary } from './excel.js';

/**
 * In-process cache of workbook summaries (`GET /api/files/:id`).
 *
 * The summary (sheet names, row counts, columns) is a pure function of the file bytes, and it is asked
 * for repeatedly — the monthly input table queries a dozen workbooks on every render, and each parse
 * costs 100–400 ms. Caching by content checksum makes repeat reads free while a re-uploaded file is
 * re-summarised automatically.
 */

const CACHE_LIMIT = 64;
const cache = new Map<string, WorkbookSummary>();

export async function workbookSummaryFor(
  file: { fileId: number; stamp: string },
  compute: () => Promise<WorkbookSummary> | WorkbookSummary,
): Promise<WorkbookSummary> {
  const key = `${file.fileId}:${file.stamp}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const summary = await compute();
  cache.set(key, summary);
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
  return summary;
}

export function clearWorkbookSummaryCache(): void {
  cache.clear();
}

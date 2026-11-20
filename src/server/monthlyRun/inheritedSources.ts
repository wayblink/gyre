import type { QueryResultRow } from 'pg';
import type { MonthlyRunInheritedSourceFile, WorkflowRuntimeParameters } from '../../shared/types.js';
import { isRecord, parseJson } from '../utils/json.js';
import { toIsoTimestamp } from '../utils/timestamp.js';

/**
 * The files the system carries into a month on its own.
 *
 * Nine of the monthly workflow's file references are never operator input: the trigger fills them
 * from the newest snapshot written before the month (`injectLatestEarlierBase`,
 * `injectMonthlyRecordBases`) or from last month's produced summary. The Monthly Update page only
 * knows the instance's *saved* sources, so every one of those rows showed "not configured (optional)"
 * — while the run silently consumed a real file. This module answers "which file is that?" so the
 * page can show it.
 *
 * Two sources of truth, in this order:
 *
 * 1. The month's latest `monthly_run_history` row — its `runtime_parameters_json` is the snapshot the
 *    run consumed, and it stays right after the fact even if a newer base appears later (a late
 *    re-run of the previous month moves what a *new* run would pick, and must not rewrite history).
 * 2. The chain lookup replayed over the current product files, for a month that has not run yet.
 *
 * A snapshot entry wins only when it holds a file. `{}` — the "no earlier snapshot yet" state — falls
 * through to the lookup: that run read no base, but the page configures the *next* run, and that one
 * would inherit whatever the chain resolves now.
 */

type Db = {
  query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<T[]>;
  queryOne<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<T | undefined>;
};

type FileRefFields = {
  fileId: number | null;
  logicalPath: string | null;
  sheetName: string | null;
};

type PendingEntry = FileRefFields & {
  sourceKey: string;
  resolvedFrom: MonthlyRunInheritedSourceFile['resolvedFrom'];
};

/** Read a `{ provider: 'product-files', key | id }` reference; anything else is not a file. */
function fileRefFields(value: unknown): FileRefFields | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.provider !== 'product-files') return null;
  const key = String(record.key ?? '').trim();
  const id = Number(record.id);
  const fileId = Number.isInteger(id) && id > 0 ? id : null;
  if (!key && fileId === null) return null;
  const sheetName = String(record.sheet ?? '').trim();
  return { fileId, logicalPath: key || null, sheetName: sheetName || null };
}

function runtimeFileRefs(value: unknown): Record<string, unknown> {
  const parsed = parseJson<WorkflowRuntimeParameters>(value, {});
  const fileRefs = parsed.fileRefs;
  return fileRefs && typeof fileRefs === 'object' && !Array.isArray(fileRefs)
    ? (fileRefs as Record<string, unknown>)
    : {};
}

function hasKey(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export async function resolveInheritedSourceFiles(
  db: Db,
  params: { monthKey: string; fileRefs: unknown; sourceKeys: string[] },
): Promise<MonthlyRunInheritedSourceFile[]> {
  if (!params.sourceKeys.length) return [];
  const chainRefs = isRecord(params.fileRefs) ? params.fileRefs : {};

  const latestRun = await db.queryOne<{ runtime_parameters_json: unknown }>(
    `select runtime_parameters_json from monthly_run_history
      where month_key = $1
      order by triggered_at desc, id desc
      limit 1`,
    [params.monthKey],
  );
  const runRefs = latestRun ? runtimeFileRefs(latestRun.runtime_parameters_json) : {};

  const entries: PendingEntry[] = [];
  for (const sourceKey of params.sourceKeys) {
    // What the finished run read, when it read something: a late re-run of an earlier month moves the
    // chain, and that must not rewrite what this month's run is recorded as having consumed.
    const runFields = hasKey(runRefs, sourceKey) ? fileRefFields(runRefs[sourceKey]) : null;
    if (runFields) {
      entries.push({ sourceKey, ...runFields, resolvedFrom: 'run' });
      continue;
    }
    // The run read no base (or has not run yet): show what a run started now would inherit.
    const chainFields = fileRefFields(chainRefs[sourceKey]);
    if (chainFields) entries.push({ sourceKey, ...chainFields, resolvedFrom: 'inherited' });
  }
  if (!entries.length) return [];

  // One round trip resolves both kinds of reference. `logical_path` is unique case-insensitively.
  const fileIds = [...new Set(entries.map((entry) => entry.fileId).filter((id): id is number => id !== null))];
  const logicalPaths = [
    ...new Set(entries.map((entry) => entry.logicalPath).filter((path): path is string => Boolean(path))),
  ].map((path) => path.toLowerCase());
  const files = await db.query<{ id: number; original_name: string; logical_path: string; created_at: unknown }>(
    `select id, original_name, logical_path, created_at from product_files
      where id = any($1::int[]) or lower(logical_path) = any($2::text[])`,
    [fileIds, logicalPaths],
  );
  const byId = new Map(files.map((file) => [Number(file.id), file]));
  const byPath = new Map(files.map((file) => [String(file.logical_path).toLowerCase(), file]));

  return entries.map((entry) => {
    const file =
      (entry.fileId === null ? undefined : byId.get(entry.fileId)) ??
      (entry.logicalPath === null ? undefined : byPath.get(entry.logicalPath.toLowerCase()));
    return {
      sourceKey: entry.sourceKey,
      fileId: file ? Number(file.id) : entry.fileId,
      fileName: file ? String(file.original_name) : null,
      logicalPath: file ? String(file.logical_path) : entry.logicalPath,
      sheetName: entry.sheetName,
      createdAt: file ? toIsoTimestamp(file.created_at) : null,
      resolvedFrom: entry.resolvedFrom,
    };
  });
}

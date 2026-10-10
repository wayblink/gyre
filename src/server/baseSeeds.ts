import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { fileStorage } from './storage.js';
import { extractSheetRangeAsDataFrame, summarizeValidatedWorkbookAsync } from './excel.js';
import type { DbClient } from './db.js';

/**
 * Register the cold-start base seeds committed under `database/base-seeds/`.
 *
 * Every monthly source marked `optionalCategory: 'inherit'` inherits the previous month's merged
 * base. On a fresh database there is no previous month, so the first run has no base and the merge
 * sub-workflow fails on its extract task. Shipping the real bases and registering them on init is
 * what makes a cold start runnable.
 *
 * Insert-if-missing, like the workflow definitions: an existing `product_files` row is never
 * touched, so a system that has already run months keeps its own newer bases.
 */

const SEED_ROOT = path.join(config.rootDir, 'database', 'base-seeds');
const MANIFEST_FILE = 'manifest.json';

export type BaseSeedEntry = {
  sourceKey: string;
  logicalPath: string;
  fileName: string;
  sheetName: string;
  contract: { range: string; headerRow: number };
  columns: string[];
  rowCount: number;
  bytes: number;
  sha256: string;
  baseMonth: string | null;
  note: string;
};

export type BaseSeedManifest = {
  description: string;
  exclude: Record<string, string>;
  seeds: BaseSeedEntry[];
};

export function loadBaseSeedManifest(root = SEED_ROOT): BaseSeedManifest | null {
  const manifestPath = path.join(root, MANIFEST_FILE);
  if (!existsSync(manifestPath)) return null;
  const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as BaseSeedManifest;
  if (!Array.isArray(parsed.seeds)) return null;
  return parsed;
}

/**
 * Folders a workflow declares as its output directory that `normalizeProductFileStoragePrefix()`
 * used to rewrite into `input/<folder>`. Bases written before that fix are registered under the
 * wrong path, so `injectPreviousMonthBase()` cannot find them and the inheritance chain starts a
 * month late. Relocating them on init is the same class of one-time data migration `schema.ts`
 * already performs for `employees.tags`.
 */
const RELOCATED_BASE_FOLDERS: ReadonlyArray<{ from: string; to: string }> = [
  { from: 'input/cancel_restore/', to: 'cancel_restore/' },
  { from: 'input/futu_exercises/', to: 'futu_exercises/' },
];

/** Workflow-produced bases only: `<...>_Base_<yyyy_MM>.xlsx`, never a manual upload. */
const WORKFLOW_BASE_FILE_NAME = /_Base_\d{4}_\d{2}\.xlsx$/i;

export type RelocatedBaseFile = { from: string; to: string };

/**
 * Move bases registered under a rewritten folder back to the folder the workflow declared.
 *
 * Idempotent: a row already at the target path is left alone, and the target is checked for a
 * collision first so a system that somehow has both keeps the existing one and reports the skip.
 */
export async function relocateMisplacedBaseFiles(
  db: Pick<DbClient, 'query' | 'queryOne' | 'execute'>,
): Promise<RelocatedBaseFile[]> {
  const relocated: RelocatedBaseFile[] = [];
  for (const { from, to } of RELOCATED_BASE_FOLDERS) {
    const rows = await db.query<{ id: number; logical_path: string; original_name: string; file_path: string }>(
      'select id, logical_path, original_name, file_path from product_files where logical_path like $1',
      [`${from}%`],
    );
    for (const row of rows) {
      const fileName = row.logical_path.slice(from.length);
      if (!WORKFLOW_BASE_FILE_NAME.test(fileName)) continue;
      const targetPath = `${to}${fileName}`;
      const collision = await db.queryOne<{ id: number }>(
        'select id from product_files where lower(logical_path) = lower($1)',
        [targetPath],
      );
      if (collision) continue;

      // Move the bytes too, not just the row: `fileStorage` addresses files by `file_path`, and a
      // later overwrite would otherwise write to the new path and orphan the old object.
      const buffer = await fileStorage.read(String(row.file_path));
      const stored = await fileStorage.save('product', String(row.original_name), buffer, { prefix: to });
      await db.execute('update product_files set logical_path = $2, file_path = $3, stored_name = $4 where id = $1', [
        Number(row.id),
        targetPath,
        stored.filePath,
        stored.storedName,
      ]);
      relocated.push({ from: row.logical_path, to: targetPath });
      console.log(`[base-seeds] relocated ${row.logical_path} -> ${targetPath}`);
    }
  }
  return relocated;
}

export type BaseSeedRegistrationResult = {
  registered: string[];
  skipped: string[];
};

/**
 * Register every seed that is not already present.
 *
 * A seed is verified before it is written: its bytes must match the manifest checksum and its
 * contract must still extract the recorded columns and row count. A seed that fails either check is
 * skipped with a warning rather than registered, because a base that does not satisfy the contract
 * fails mid-run on the fresh database — the exact failure this is meant to prevent.
 */
export async function seedBaseSeedFiles(
  db: Pick<DbClient, 'queryOne' | 'execute'>,
): Promise<BaseSeedRegistrationResult> {
  const manifest = loadBaseSeedManifest();
  const result: BaseSeedRegistrationResult = { registered: [], skipped: [] };
  if (!manifest) return result;

  for (const seed of manifest.seeds) {
    const filePath = path.join(SEED_ROOT, seed.logicalPath);
    if (!existsSync(filePath)) {
      console.warn(`[base-seeds] missing file for ${seed.sourceKey}: ${seed.logicalPath}`);
      result.skipped.push(seed.logicalPath);
      continue;
    }

    const existing = await db.queryOne<{ id: number }>(
      'select id from product_files where lower(logical_path) = lower($1) order by id desc limit 1',
      [seed.logicalPath],
    );
    if (existing) {
      result.skipped.push(seed.logicalPath);
      continue;
    }

    const buffer = readFileSync(filePath);
    const checksum = createHash('sha256').update(buffer).digest('hex');
    if (checksum !== seed.sha256) {
      console.warn(`[base-seeds] checksum mismatch for ${seed.logicalPath}: expected ${seed.sha256}, got ${checksum}`);
      result.skipped.push(seed.logicalPath);
      continue;
    }

    // Re-run the consuming task's extraction: this is the contract the sub-workflow will apply, so
    // verifying it here is the difference between "file exists" and "run works".
    const frame = extractSheetRangeAsDataFrame(buffer, seed.sheetName, {
      range: seed.contract.range,
      headerRow: seed.contract.headerRow,
      dropTrailingEmptyRows: true,
    });
    if (frame.rows.length !== seed.rowCount || frame.columns.length !== seed.columns.length) {
      console.warn(
        `[base-seeds] contract mismatch for ${seed.logicalPath}: ` +
          `expected ${seed.columns.length} cols / ${seed.rowCount} rows, ` +
          `got ${frame.columns.length} cols / ${frame.rows.length} rows`,
      );
      result.skipped.push(seed.logicalPath);
      continue;
    }

    const summary = await summarizeValidatedWorkbookAsync(buffer, seed.fileName);
    const stored = await fileStorage.save('product', seed.fileName, buffer, {
      prefix: path.posix.dirname(seed.logicalPath),
    });
    const inserted = await db.queryOne<{ id: number }>(
      `insert into product_files (
         original_name, stored_name, file_ext, file_path, logical_path,
         file_size_bytes, mime_type, checksum, storage_backend,
         workbook_sheet_count, workbook_row_count, uploaded_by
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       on conflict do nothing
       returning id`,
      [
        seed.fileName,
        stored.storedName,
        path.extname(seed.fileName).replace(/^\./, ''),
        stored.filePath,
        seed.logicalPath,
        buffer.length,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        checksum,
        stored.storageBackend,
        summary.sheetCount,
        summary.totalRowCount,
        'BaseSeed',
      ],
    );
    if (inserted) {
      result.registered.push(seed.logicalPath);
      console.log(
        `[base-seeds] registered ${seed.sourceKey} @ ${seed.logicalPath} (id=${inserted.id}, ` +
          `${buffer.length} bytes, ${summary.sheetCount} sheets, ${summary.totalRowCount} rows)`,
      );
    } else {
      result.skipped.push(seed.logicalPath);
    }
  }

  return result;
}

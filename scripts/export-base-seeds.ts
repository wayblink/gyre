import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { AppDb } from '../src/server/db.js';
import { fileStorage } from '../src/server/storage.js';
import { extractSheetRangeAsDataFrame } from '../src/server/excel.js';
import { canonicalProductFilePath } from '../src/server/fileIdentity.js';

/**
 * Export the cold-start base seeds from a live system into `database/base-seeds/`.
 *
 * Every `optionalCategory: 'inherit'` monthly source needs a base workbook to inherit from. On a
 * fresh database there is nothing to inherit, so the first run has no base — unless the project
 * ships one. This script copies the real bases out of a running system (with their verification
 * results) so they can be committed and re-registered on cold start.
 *
 * `previous_capitalization_summary` is deliberately absent: it is injected at run time from the
 * previous month's Capitalization Summary output (see `injectPreviousMonthBase`), so a seed would
 * be dead weight that also goes stale the moment the first month runs.
 *
 * Run:  DATABASE_URL=... npx tsx scripts/export-base-seeds.ts
 * Then: git add database/base-seeds
 */

/** Where each seed lands in `product_files` on a cold start. */
export type BaseSeedDefinition = {
  /** Monthly source key this seed satisfies. */
  sourceKey: string;
  /** Logical path the seed is registered at (must be stable across environments). */
  logicalPath: string;
  /** Sheet the consuming extract task reads. */
  sheetName: string;
  /** Contract the extract task applies, recorded so the init flow can assert before registering. */
  contract: { range: string; headerRow: number };
  /** Human-readable note for the manifest. */
  note: string;
};

/**
 * The seed set. Source keys mirror `gyre-captable-summary-v2`'s runtime params schema; the
 * logical paths are the ones `injectPreviousMonthBase()` looks for, so a seeded base is picked up
 * by the normal inheritance chain instead of needing its own wiring.
 */
export const BASE_SEEDS: BaseSeedDefinition[] = [
  {
    sourceKey: 'base_control_book',
    logicalPath: 'control_book/EQ_Control_Book_Base_2026_06.xlsx',
    sheetName: 'EQ Control Book',
    contract: { range: 'A9:L', headerRow: 9 },
    note: '2026-06 的 EQ Control Book 合并 base。',
  },
  {
    sourceKey: 'base_futu_exercises',
    logicalPath: 'futu_exercises/Futu_Exercises_Base_2026_06.xlsx',
    sheetName: 'Futu BCI Exercises',
    contract: { range: 'A1:N', headerRow: 1 },
    note: '2026-06 的 Futu BCI Exercises 合并 base（14 列，Exercise Order No. 由合并流程回填）。',
  },
  {
    sourceKey: 'base_cancel_restore_report',
    logicalPath: 'cancel_restore/Gyre_Therapeutics_Cancel_Restore_Base_2026_06.xlsx',
    sheetName: '取消与恢复明细',
    contract: { range: 'A1:W', headerRow: 1 },
    note:
      '2026-06 的取消与恢复合并 base。此前该 base 一直被写进 input/cancel_restore/（输出目录被' +
      '重写成 input/ 子目录），继承链找不到它；已修正为声明式输出目录。',
  },

  // The four record pages merge into their previous snapshot. Those snapshots are written to their
  // own folders as `<folder>/<Name>_Base_YYYY_MM.xlsx`, so a seed registers at exactly the path the
  // monthly injection looks up — a fresh environment then starts with the accumulated history
  // instead of an empty chain that only fills from the first month it happens to run.
  {
    sourceKey: 'cancellation_record_base',
    logicalPath: 'cancellation_record/Cancellation_Records_Base_2026_08.xlsx',
    sheetName: 'Cancellation Records',
    contract: { range: 'A1:W', headerRow: 1 },
    note: '2026-08 的取消记录累计快照（2025-12 起全部取消/恢复明细）。',
  },
  {
    sourceKey: 'sold_shares_base',
    logicalPath: 'sold_shares/Futu_Sold_Shares_Base_2026_08.xlsx',
    sheetName: 'Futu Sold Shares',
    contract: { range: 'A1:S', headerRow: 1 },
    note: '2026-08 的卖出记录累计快照（按工号聚合的出售汇总）。',
  },
  {
    sourceKey: 'grant_record_futu_base',
    logicalPath: 'grant_record/Futu_Grants_Base_2026_08.xlsx',
    sheetName: 'Futu Grants',
    contract: { range: 'A1:AG', headerRow: 1 },
    note: '2026-08 的 Futu 授予记录累计快照（按授予编号合并）。',
  },
  {
    sourceKey: 'grant_record_shareworks_base',
    logicalPath: 'grant_record/Shareworks_Grants_Base_2026_08.xlsx',
    sheetName: 'Shareworks Grants',
    contract: { range: 'A1:AB', headerRow: 1 },
    note: '2026-08 的 Shareworks 授予记录累计快照（按 Employee Grant Number 合并）。',
  },
  {
    sourceKey: 'exercise_record_futu_base',
    logicalPath: 'exercise_record/Futu_Exercises_Base_2026_08.xlsx',
    sheetName: 'Futu BCI Exercises to Date',
    contract: { range: 'A1:M', headerRow: 1 },
    note: '2026-08 的 Futu 行权记录累计快照（按 工号+授予编号+行权日期 合并）。',
  },
  {
    sourceKey: 'exercise_record_shareworks_base',
    logicalPath: 'exercise_record/Shareworks_Exec_Base_2026_08.xlsx',
    sheetName: 'Shareworks Exec Option OS',
    contract: { range: 'A1:V', headerRow: 1 },
    note: '2026-08 的 Shareworks 行权记录累计快照（按 Employee Grant Number 合并）。',
  },
];

const SEED_DIR = path.join(process.cwd(), 'database', 'base-seeds');
const MANIFEST_NAME = 'manifest.json';

function die(message: string): never {
  console.error(`ABORT: ${message}`);
  process.exit(1);
}

/** Month a base represents, parsed from `<...>_Base_<yyyy_MM>.xlsx`; null for manual sources. */
export function baseSeedMonth(logicalPath: string): string | null {
  const match = logicalPath.match(/_Base_(\d{4})_(\d{2})\.xlsx$/i);
  return match ? `${match[1]}-${match[2]}` : null;
}

async function main(): Promise<void> {
  const db = new AppDb();
  try {
    mkdirSync(SEED_DIR, { recursive: true });
    const entries = [];

    for (const seed of BASE_SEEDS) {
      const row = await db.queryOne<{ id: number; file_path: string; logical_path: string }>(
        'select id, file_path, logical_path from product_files where logical_path = $1 order by id desc limit 1',
        [seed.logicalPath],
      );
      if (!row) die(`seed source not found in product_files: ${seed.logicalPath}`);
      const buffer = await fileStorage.read(row.file_path);

      // Verify against the same extractor and range the sub-workflow uses: a seed that does not
      // satisfy the contract would fail mid-run on a fresh database, which is exactly what this is
      // meant to prevent.
      const frame = extractSheetRangeAsDataFrame(buffer, seed.sheetName, {
        range: seed.contract.range,
        headerRow: seed.contract.headerRow,
        dropTrailingEmptyRows: true,
      });
      if (frame.rows.length === 0) die(`${seed.logicalPath}: contract matched 0 rows`);

      const fileName = path.basename(seed.logicalPath);
      const target = path.join(SEED_DIR, seed.logicalPath);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, buffer);

      entries.push({
        sourceKey: seed.sourceKey,
        logicalPath: seed.logicalPath,
        fileName,
        sheetName: seed.sheetName,
        contract: seed.contract,
        columns: frame.columns,
        rowCount: frame.rows.length,
        bytes: buffer.length,
        sha256: createHash('sha256').update(buffer).digest('hex'),
        baseMonth: baseSeedMonth(seed.logicalPath),
        note: seed.note,
      });
      console.log(
        `exported ${seed.logicalPath} -> ${path.relative(process.cwd(), target)} ` +
          `(${buffer.length} bytes, ${frame.columns.length} cols, ${frame.rows.length} rows)`,
      );
    }

    const manifest = {
      generatedBy: 'scripts/export-base-seeds.ts',
      description:
        '冷启动 base 种子：optionalCategory=inherit 的月度本源在空库中没有可继承的上月产出，' +
        '由这些文件提供首个 base。初始化时按 logicalPath 注册进 product_files（已存在则跳过）。',
      exclude: {
        previous_capitalization_summary:
          '运行期由上月 Capitalization Summary 输出自动注入，无需种子（见 injectPreviousMonthBase）。',
      },
      seeds: entries,
    };
    writeFileSync(path.join(SEED_DIR, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`wrote ${path.relative(process.cwd(), path.join(SEED_DIR, MANIFEST_NAME))}`);
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

// Referenced by the init flow, which needs the same canonical-path helper.
export { canonicalProductFilePath };

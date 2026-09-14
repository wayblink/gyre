import crypto from 'node:crypto';
import path from 'node:path';
import XLSX from 'xlsx';
import { AppDb } from '../src/server/db.js';
import { fileStorage } from '../src/server/storage.js';
import { extractSheetRangeAsDataFrame, summarizeValidatedWorkbookAsync } from '../src/server/excel.js';
import { canonicalProductFilePath } from '../src/server/fileIdentity.js';

/**
 * One-shot: seed the initial Futu BCI Exercises base workbook (14 columns) from the
 * manually-transcribed cumulative sheet in product_files id=90, and register it in
 * product_files at the fixed path output/futu-exercises/Futu_Exercises_Base.xlsx.
 *
 * The new "Exercise Order No." column is added as the FIRST column and left empty (null)
 * for all legacy rows; the Futu incremental-merge sub-workflow will populate it going forward.
 *
 * Idempotent: re-running overwrites the existing row (conflictPolicy=overwrite semantics).
 * Aborts on ANY assertion failure — never produces a dirty base.
 */

const SOURCE_LOGICAL_PATH = 'input/2026-05/!!Gyre Cap Table 05.31.26【新】.xlsx';
const SOURCE_SHEET = 'Futu BCI Exercises to Date';
const BASE_FOLDER = 'output/futu-exercises';
const BASE_FILE_NAME = 'Futu_Exercises_Base.xlsx';
const BASE_SHEET = 'Futu BCI Exercises';

const EXPECTED_13_COLUMNS = [
  'Name', 'Employee No.', 'Futubull ID', 'User ID', 'Grant No.', 'Grant Date',
  'Grant Price(USD)', 'Exercise Date', 'Ordered Qty', 'Exercised Qty',
  'Exercise Cost(USD)', 'Deduction/Selling Qty.', 'Dealt Qty.',
];
const BASE_14_COLUMNS = ['Exercise Order No.', ...EXPECTED_13_COLUMNS];
const EXPECTED_ROWS = 423;
const EXPECTED_SUM = 2938523;

function die(msg: string): never {
  console.error(`ABORT: ${msg}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const db = new AppDb();
  try {
    // 1. Read the source workbook buffer from storage (minio) via its logical path.
    const src = await db.queryOne<{ id: number; file_path: string; file_size_bytes: string }>(
      'select id, file_path, file_size_bytes from product_files where logical_path = $1',
      [SOURCE_LOGICAL_PATH],
    );
    if (!src) die(`source product_files not found for ${SOURCE_LOGICAL_PATH}`);
    console.log(`source: id=${src.id} file_path=${src.file_path}`);
    const buffer = await fileStorage.read(src.file_path);

    // 2. Extract exactly rows 2..424 (A1:M424 excludes row 425 "in Total" and row 427 stray CN header).
    const df = extractSheetRangeAsDataFrame(buffer, SOURCE_SHEET, {
      range: 'A1:M424',
      headerRow: 1,
      dropTrailingEmptyRows: true,
    });

    // 3. Pre-assertions — abort on any mismatch, never emit a dirty base.
    if (df.columns.length !== 13) die(`expected 13 columns, got ${df.columns.length}: ${df.columns.join(',')}`);
    for (let i = 0; i < 13; i += 1) {
      if (df.columns[i] !== EXPECTED_13_COLUMNS[i]) die(`column[${i}] = "${df.columns[i]}" != "${EXPECTED_13_COLUMNS[i]}"`);
    }
    if (df.rows.length !== EXPECTED_ROWS) die(`expected ${EXPECTED_ROWS} rows, got ${df.rows.length}`);
    const sum = df.rows.reduce((acc, r) => acc + (Number((r as Record<string, unknown>)['Exercised Qty']) || 0), 0);
    if (sum !== EXPECTED_SUM) die(`sum(Exercised Qty) = ${sum} != ${EXPECTED_SUM}`);
    const totalRows = df.rows.filter((r) => String((r as Record<string, unknown>)['Name'] ?? '').trim().toLowerCase().includes('total'));
    if (totalRows.length > 0) die(`found ${totalRows.length} "in Total" row(s) in detail — range leaked the summary row`);

    // 4. Build 14-column rows: Exercise Order No. (null) + original 13 columns, preserving order.
    const rows14 = df.rows.map((r) => {
      const src = r as Record<string, unknown>;
      const out: Record<string, unknown> = { 'Exercise Order No.': null };
      for (const col of EXPECTED_13_COLUMNS) out[col] = src[col] ?? null;
      return out;
    });
    const matrix14 = [
      BASE_14_COLUMNS,
      ...rows14.map((r) => BASE_14_COLUMNS.map((c) => (r[c] === undefined ? null : r[c]))),
    ];

    // 5. Write workbook — no padding so the header lands on row 1 (matches extract_base headerRow:1).
    const ws = XLSX.utils.aoa_to_sheet(matrix14);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, BASE_SHEET);
    const outBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    // 6. Sanity: read it back with the same extractor the sub-workflow uses.
    const verify = extractSheetRangeAsDataFrame(outBuffer, BASE_SHEET, {
      range: 'A1:N', headerRow: 1, dropTrailingEmptyRows: true,
    });
    if (verify.columns.length !== 14) die(`roundtrip: expected 14 columns, got ${verify.columns.length}`);
    if (verify.columns[0] !== 'Exercise Order No.') die(`roundtrip: col0 = "${verify.columns[0]}"`);
    const verifySum = verify.rows.reduce((acc, r) => acc + (Number((r as Record<string, unknown>)['Exercised Qty']) || 0), 0);
    if (verifySum !== EXPECTED_SUM) die(`roundtrip: sum = ${verifySum} != ${EXPECTED_SUM}`);
    const nonEmptyOrderNo = verify.rows.filter((r) => (r as Record<string, unknown>)['Exercise Order No.'] != null).length;
    if (nonEmptyOrderNo !== 0) die(`roundtrip: ${nonEmptyOrderNo} rows have a non-empty Exercise Order No. (should be 0)`);
    console.log(`roundtrip OK: ${verify.rows.length} rows, 14 cols, sum=${verifySum}, Exercise Order No. all empty`);

    // 7. Save to storage + upsert product_files (overwrite semantics).
    const checksum = crypto.createHash('sha256').update(outBuffer).digest('hex');
    const logicalPath = canonicalProductFilePath(BASE_FOLDER, BASE_FILE_NAME);
    const summary = await summarizeValidatedWorkbookAsync(outBuffer, BASE_FILE_NAME);
    const stored = await fileStorage.save('product', BASE_FILE_NAME, outBuffer, { prefix: BASE_FOLDER });
    const mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    const ext = path.extname(BASE_FILE_NAME).replace(/^\./, '');

    const existing = await db.queryOne<{ id: number }>(
      'select id from product_files where lower(logical_path) = lower($1)',
      [logicalPath],
    );
    if (existing) {
      await db.execute(
        `update product_files
            set original_name=$2, stored_name=$3, file_ext=$4, file_path=$5, logical_path=$6,
                file_size_bytes=$7, mime_type=$8, checksum=$9, storage_backend=$10,
                workbook_sheet_count=$11, workbook_row_count=$12, uploaded_by=$13, created_at=current_timestamp
          where id=$1`,
        [existing.id, BASE_FILE_NAME, stored.storedName, ext, stored.filePath, logicalPath,
          outBuffer.length, mimeType, checksum, stored.storageBackend, summary.sheetCount,
          summary.totalRowCount, 'Workflow'],
      );
      console.log(`overwrote product_files id=${existing.id} @ ${logicalPath}`);
    } else {
      const row = await db.queryOne<{ id: number }>(
        `insert into product_files (original_name, stored_name, file_ext, file_path, logical_path,
           file_size_bytes, mime_type, checksum, storage_backend, workbook_sheet_count, workbook_row_count, uploaded_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
        [BASE_FILE_NAME, stored.storedName, ext, stored.filePath, logicalPath,
          outBuffer.length, mimeType, checksum, stored.storageBackend, summary.sheetCount,
          summary.totalRowCount, 'Workflow'],
      );
      console.log(`inserted product_files id=${row?.id} @ ${logicalPath}`);
    }
    console.log(`DONE: base seeded @ ${logicalPath} (${outBuffer.length} bytes, sheetCount=${summary.sheetCount}, rowCount=${summary.totalRowCount})`);
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

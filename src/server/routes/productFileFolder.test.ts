import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import XLSX from 'xlsx';
import { createDb } from '../db.js';
import { config } from '../config.js';
import { fileStorage } from '../storage.js';
import {
  normalizeProductFileStoragePrefix,
  productFileDisplayPath,
  productFileUngroupedDisplayPath,
  normalizeStorageFolderPrefix,
  saveProductWorkbook,
  toProductFile,
} from './support.js';

/**
 * The workflow persist path and the upload path normalise `folderPrefix` differently, and the
 * difference is load-bearing: a base persisted to `cancel_restore/` used to land in
 * `input/cancel_restore/`, so `injectPreviousMonthBase()` never found it and the month-to-month
 * inheritance chain silently never formed.
 */

test('a declared output folder survives as written', () => {
  // What `workbook.persist.excel` declares, and what later tasks look the file up by.
  for (const folder of ['cancel_restore', 'futu_exercises', 'control_book', 'output/captable', 'input/x']) {
    assert.equal(normalizeStorageFolderPrefix(folder), folder, `${folder} must not be rewritten`);
  }
});

test('a folder without a declared class still falls back under input/', () => {
  // Workflow-generated workbooks that do not declare an output folder keep the legacy mapping.
  assert.equal(normalizeProductFileStoragePrefix('cancel_restore'), 'input/cancel_restore');
  assert.equal(normalizeProductFileStoragePrefix('futu_exercises'), 'input/futu_exercises');
  // ...except the folders that are already output roots.
  assert.equal(normalizeProductFileStoragePrefix('output/captable'), 'output/captable');
  assert.equal(normalizeProductFileStoragePrefix('control_book'), 'control_book');
  assert.equal(normalizeProductFileStoragePrefix('input/2026-06'), 'input/2026-06');
  assert.equal(normalizeProductFileStoragePrefix(''), 'input');
});

test('uploads and moves keep the folder the operator picked in the file centre', () => {
  // The file centre lists the real tree, so `control_book/` has to stay `control_book/` rather than
  // becoming `input/control_book/`; only normalisation (traversal, empty path) is still applied.
  const source = readFileSync(new URL('./files.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /inputStorageFolderPrefix/, 'uploads/moves must not be forced under input/');
  assert.match(source, /folderPrefixIsFinal: true/, 'the upload hands its folder over as final');
  assert.match(source, /normalizeStorageFolderPrefix\(body\.folder\) \?\? 'input'/);
});

test('a traversal attempt is rejected rather than normalised into a valid path', () => {
  assert.throws(() => normalizeStorageFolderPrefix('../etc'), /Invalid folder path/);
  assert.throws(() => normalizeStorageFolderPrefix('cancel_restore/../../x'), /Invalid folder path/);
  // The upload path rejects it too, so the fix cannot be used to escape the product folder.
  assert.throws(() => normalizeProductFileStoragePrefix('../etc'), /Invalid folder path/);
});

/**
 * The regression itself: a workflow persisting to `cancel_restore/` must land there. Before the
 * `declaredOutputFolder` flag it landed in `input/cancel_restore/`, which nothing looks up, so the
 * base was produced every month and the inheritance chain never found it.
 *
 * Needs a throwaway database: PRODUCT_FOLDER_TEST_DATABASE_URL plus the same value in DATABASE_URL
 * (config reads it at module load).
 */
const databaseUrl = process.env.PRODUCT_FOLDER_TEST_DATABASE_URL;
const withDb =
  databaseUrl && config.databaseUrl === databaseUrl
    ? { databaseUrl }
    : { skip: 'PRODUCT_FOLDER_TEST_DATABASE_URL unset (or does not match DATABASE_URL)' };

function tinyWorkbook(): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet([
    ['姓名', '工号'],
    ['张三', '001'],
  ]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, '取消与恢复明细');
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

test('a workflow-declared output folder is where the file is registered', withDb, async () => {
  const db = await createDb();
  try {
    const saved = await saveProductWorkbook(db, {
      originalName: 'Gyre_Therapeutics_Cancel_Restore_Base_2026_06.xlsx',
      buffer: tinyWorkbook(),
      uploadedBy: 'Workflow',
      folderPrefix: 'cancel_restore',
      conflictPolicy: 'overwrite',
      folderPrefixIsFinal: true,
    });
    const savedLogicalPath = toProductFile(saved.file).logicalPath;
    assert.equal(savedLogicalPath, 'cancel_restore/Gyre_Therapeutics_Cancel_Restore_Base_2026_06.xlsx');

    // ...and the bytes behind that row are readable, which is what the next month's extract needs.
    const row = await db.queryOne<{ file_path: string }>(
      'select file_path from product_files where logical_path = $1',
      [savedLogicalPath],
    );
    assert.ok(row);
    assert.ok((await fileStorage.read(row.file_path)).length > 0);

    // A caller that omits `folderPrefixIsFinal` keeps the legacy mapping; only the file centre's
    // upload/move hand over a folder the operator picked, so the flag cannot be bypassed there.
    const uploaded = await saveProductWorkbook(db, {
      originalName: 'manual.xlsx',
      buffer: tinyWorkbook(),
      folderPrefix: 'cancel_restore',
      conflictPolicy: 'overwrite',
    });
    assert.equal(toProductFile(uploaded.file).logicalPath, 'input/cancel_restore/manual.xlsx');
  } finally {
    await db.close();
  }
});

/**
 * The file center groups `output/captable` and `output/plan-summary` by month in the rendered path
 * only. 150+ monthly snapshots in one flat folder are unbrowsable, but the logical path is what
 * workflow fileRefs and move targets key on, so it must stay exactly as stored.
 */
test('captable and plan-summary display paths gain a month folder taken from the file name', () => {
  assert.equal(
    productFileDisplayPath({
      logical_path: 'output/captable/2026-08-Capitalization_Table_Summary_View.v1.xlsx',
    }),
    'output/captable/2026-08/2026-08-Capitalization_Table_Summary_View.v1.xlsx',
  );
  assert.equal(
    productFileDisplayPath({ logical_path: 'output/plan-summary/2026-04-Plan_Summary.v1.xlsx' }),
    'output/plan-summary/2026-04/2026-04-Plan_Summary.v1.xlsx',
  );
  // Only those two roots: the other output folders keep their stored layout for now.
  assert.equal(
    productFileDisplayPath({ logical_path: 'output/grant-record/2026-08-Shareworks_Grants_Base.xlsx' }),
    'output/grant-record/2026-08-Shareworks_Grants_Base.xlsx',
  );
  assert.equal(productFileDisplayPath({ logical_path: 'input/2026-08/base.xlsx' }), 'input/2026-08/base.xlsx');
});

test('a snapshot without the month prefix stays in its flat folder instead of being guessed', () => {
  // These 7 old Plan_Summary snapshots predate the month-prefixed file name.
  assert.equal(
    productFileDisplayPath({ logical_path: 'output/plan-summary/Plan_Summary.v20260820220539.xlsx' }),
    'output/plan-summary/Plan_Summary.v20260820220539.xlsx',
  );
});

test('the logical-path fallback never carries the display-only month folder', () => {
  // A row without logical_path is still addressed by a stable key; grouping it into output/2026-08
  // would make the runtime binding point at a path that no workflow can resolve.
  const row = {
    original_name: '2026-08-Plan_Summary.v1.xlsx',
    file_path: 'product/output/plan-summary/2026-08-Plan_Summary.v1.xlsx',
    uploaded_by: 'Workflow',
  };
  assert.equal(productFileUngroupedDisplayPath(row), 'output/plan-summary/2026-08-Plan_Summary.v1.xlsx');
  assert.equal(productFileDisplayPath(row), 'output/plan-summary/2026-08/2026-08-Plan_Summary.v1.xlsx');
});

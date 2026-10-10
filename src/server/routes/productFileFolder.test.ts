import test from 'node:test';
import assert from 'node:assert/strict';
import XLSX from 'xlsx';
import { createDb } from '../db.js';
import { config } from '../config.js';
import { fileStorage } from '../storage.js';
import {
  inputStorageFolderPrefix,
  normalizeProductFileStoragePrefix,
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

test('an upload folder still falls back under input/', () => {
  // Uploads have no declared output folder, so a bare folder means "under input/".
  assert.equal(normalizeProductFileStoragePrefix('cancel_restore'), 'input/cancel_restore');
  assert.equal(normalizeProductFileStoragePrefix('futu_exercises'), 'input/futu_exercises');
  // ...except the folders that are already output roots.
  assert.equal(normalizeProductFileStoragePrefix('output/captable'), 'output/captable');
  assert.equal(normalizeProductFileStoragePrefix('control_book'), 'control_book');
  assert.equal(normalizeProductFileStoragePrefix('input/2026-06'), 'input/2026-06');
  assert.equal(normalizeProductFileStoragePrefix(''), 'input');
  assert.equal(inputStorageFolderPrefix('transfer-plan'), 'input/transfer-plan');
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
      declaredOutputFolder: true,
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

    // An upload with the same folder still goes under input/, so the flag cannot be bypassed.
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

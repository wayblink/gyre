import assert from 'node:assert/strict';
import test from 'node:test';

import type { ProductFileRecord } from '../shared/types.js';
import {
  buildProductFilesTree,
  collectProductFileFolders,
  compareProductFile,
  countTreeFiles,
  normalizeClientFolder,
  productFileFolder,
  productFileLogicalTreePath,
  productFileTreePath,
} from './fileTree.js';

function fileFixture(overrides: Partial<ProductFileRecord> & { id: number }): ProductFileRecord {
  return {
    id: overrides.id,
    originalName: overrides.originalName ?? 'book.xlsx',
    displayName: overrides.displayName ?? overrides.originalName ?? 'book.xlsx',
    storedName: overrides.storedName ?? overrides.originalName ?? 'book.xlsx',
    displayPath: overrides.displayPath ?? `input/${overrides.originalName ?? 'book.xlsx'}`,
    logicalPath: overrides.logicalPath,
    fileExt: 'xlsx',
    fileSizeBytes: 1024,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    checksum: 'abc',
    storageBackend: 'local',
    workbookSheetCount: 1,
    workbookRowCount: 10,
    uploadedBy: 'Administrator',
    createdAt: '2026-08-20T00:00:00.000Z',
  } as ProductFileRecord;
}

test('product file tree paths fall back through displayPath, storedName, originalName', () => {
  assert.equal(
    productFileTreePath(fileFixture({ id: 1, displayPath: 'input\\2026-05\\a.xlsx' })),
    'input/2026-05/a.xlsx',
  );
  assert.equal(productFileTreePath(fileFixture({ id: 2, displayPath: '', storedName: 'stored.xlsx' })), 'stored.xlsx');
  assert.equal(
    productFileLogicalTreePath(
      fileFixture({ id: 3, displayPath: 'output/captable/x.xlsx', logicalPath: 'input/2026-06/x.xlsx' }),
    ),
    'input/2026-06/x.xlsx',
  );
});

test('the tree groups files by folder and keeps root level files', () => {
  const files = [
    fileFixture({ id: 1, displayPath: 'input/2026-05/base.xlsx' }),
    fileFixture({ id: 2, displayPath: 'input/2026-05/detail.xlsx' }),
    fileFixture({ id: 3, displayPath: 'output/captable/summary.xlsx' }),
    fileFixture({ id: 4, displayPath: 'loose.xlsx' }),
  ];

  const root = buildProductFilesTree(files);

  assert.deepEqual(Array.from(root.children.keys()).sort(), ['input', 'output']);
  assert.deepEqual(
    root.files.map((file) => file.id),
    [4],
  );
  const may = root.children.get('input')?.children.get('2026-05');
  assert.equal(may?.path, 'input/2026-05');
  assert.deepEqual(
    may?.files.map((file) => file.id),
    [1, 2],
  );
  assert.equal(countTreeFiles(root), 4);
  assert.equal(countTreeFiles(root.children.get('input')!), 2);
});

test('the tree can be grouped by logical path instead of display path', () => {
  const files = [fileFixture({ id: 1, displayPath: 'output/captable/x.xlsx', logicalPath: 'input/2026-06/x.xlsx' })];

  const byDisplay = buildProductFilesTree(files);
  const byLogical = buildProductFilesTree(files, productFileLogicalTreePath);

  assert.ok(byDisplay.children.get('output'));
  assert.ok(byLogical.children.get('input')?.children.get('2026-06'));
});

test('folder collection returns sorted ancestor folders and always offers input and control_book', () => {
  const files = [
    fileFixture({ id: 1, displayPath: 'input/2026-05/base.xlsx', logicalPath: 'input/2026-05/base.xlsx' }),
    fileFixture({ id: 2, displayPath: 'output/captable/summary.xlsx', logicalPath: 'output/captable/summary.xlsx' }),
  ];

  assert.deepEqual(collectProductFileFolders(files), [
    'control_book',
    'input',
    'input/2026-05',
    'output',
    'output/captable',
  ]);
  assert.deepEqual(collectProductFileFolders([]), ['control_book', 'input']);
  assert.equal(productFileFolder(files[1]), 'output/captable');
});

test('files are sorted by their full path', () => {
  const a = fileFixture({ id: 1, displayPath: 'input/2026-05/a.xlsx' });
  const b = fileFixture({ id: 2, displayPath: 'input/2026-05/b.xlsx' });
  assert.ok(compareProductFile(a, b) < 0);
  assert.ok(compareProductFile(b, a) > 0);
});

test('typed folder paths are normalized the same way the server normalizes them', () => {
  assert.equal(normalizeClientFolder('  /input\\2026-05/ '), 'input/2026-05');
  assert.equal(normalizeClientFolder(''), '');
  assert.equal(normalizeClientFolder('input'), 'input');
  assert.throws(() => normalizeClientFolder('input/../secret'), /Invalid folder path/);
  assert.throws(() => normalizeClientFolder('.'), /Invalid folder path/);
  assert.throws(() => normalizeClientFolder('input//2026-05'), /Invalid folder path/);
  assert.throws(() => normalizeClientFolder(`input/a${String.fromCharCode(9)}b`), /Invalid folder path/);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';

import { fileStorage } from '../storage.js';
import { updateProductWorkbook } from './support.js';

/**
 * The editor always exports xlsx. Saving that export back onto a `.xls` workbook used to hit the
 * upload signature guard (`Invalid XLS file signature`), so the file could not be saved at all.
 * The save path has to rewrite the bytes to the extension the stored file keeps.
 */
function xlsxBuffer(): Buffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ['Name', 'Value'],
      ['A', 1],
    ]),
    'Sheet1',
  );
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

test('saving an edited workbook back onto a .xls file writes a real BIFF8 workbook', async () => {
  const existing = {
    id: 1,
    original_name: 'book.xls',
    stored_name: 'book.xls',
    file_ext: 'xls',
    file_path: '/tmp/product/input/book.xls',
    logical_path: 'input/book.xls',
    uploaded_by: 'Administrator',
    checksum: 'old-checksum',
  };
  const updates: unknown[][] = [];
  const fakeDb = {
    async queryOne(sql: string, params: unknown[]) {
      if (sql.startsWith('select * from product_files')) return existing;
      updates.push(params);
      return { ...existing, file_size_bytes: params[6], checksum: params[8] };
    },
  };

  const originalSave = fileStorage.save;
  const saved: Buffer[] = [];
  fileStorage.save = (async (_category: string, _storedName: string, buffer: Buffer) => {
    saved.push(buffer);
    return { storageBackend: 'local' as const, storedName: 'book.xls', filePath: '/tmp/product/input/book.xls' };
  }) as typeof fileStorage.save;

  try {
    const result = await updateProductWorkbook(fakeDb as never, {
      fileId: 1,
      originalName: 'book.xls',
      buffer: xlsxBuffer(),
      uploadedBy: 'Administrator',
    });

    assert.equal(saved.length, 1, 'the save path must write the converted buffer');
    assert.deepEqual([...saved[0].subarray(0, 8)], [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    assert.equal(result.summary.sheetCount, 1);
    assert.equal(updates.length, 1);
    assert.equal(updates[0][7], 'application/vnd.ms-excel');
    assert.equal(updates[0][6], saved[0].length);
  } finally {
    fileStorage.save = originalSave;
  }
});

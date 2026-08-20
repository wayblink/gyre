import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonicalProductFilePath,
  normalizeProductFileName,
  normalizeProductFolder,
  productFileCollisionKey,
} from './fileIdentity.js';

test('canonicalProductFilePath preserves the original UTF-8 file name', () => {
  assert.equal(
    canonicalProductFilePath('input/2026-05', '!!Gyre Cap Table 05.31.26【新】.xlsx'),
    'input/2026-05/!!Gyre Cap Table 05.31.26【新】.xlsx',
  );
});

test('product file identity normalizes folders but rejects path-like file names', () => {
  assert.equal(normalizeProductFolder('/input\\2026-05/'), 'input/2026-05');
  assert.throws(() => normalizeProductFolder('input/../secret'), /Invalid folder path/);
  assert.throws(() => normalizeProductFileName('../secret.xlsx'), /Invalid file name/);
  assert.throws(() => normalizeProductFileName('folder/file.xlsx'), /Invalid file name/);
});

test('product file collision key is Unicode-normalized and case-insensitive', () => {
  const composed = canonicalProductFilePath('input', 'Résumé.xlsx');
  const decomposed = canonicalProductFilePath('INPUT', 'Résumé.XLSX');
  assert.equal(productFileCollisionKey(composed), productFileCollisionKey(decomposed));
});

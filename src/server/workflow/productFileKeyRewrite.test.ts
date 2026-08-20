import assert from 'node:assert/strict';
import test from 'node:test';

import { rewriteProductFileKey } from './productFileKeyRewrite.js';

test('product file references keyed by the moved logical path are rewritten', () => {
  const tasks = [
    {
      id: 'extract_grants',
      operator: 'sheet.range.extract',
      params: { fileRef: { provider: 'product-files', key: 'input/2026-05/grants.xlsx' }, sheetName: 'Sheet1' },
    },
    { id: 'calc', operator: 'sql.compute', params: { sql: 'select 1' } },
  ];

  const result = rewriteProductFileKey(tasks, 'input/2026-05/grants.xlsx', 'input/2026-06/grants.xlsx');

  assert.equal(result.changed, 1);
  const rewritten = result.value as typeof tasks;
  assert.deepEqual(rewritten[0].params.fileRef, { provider: 'product-files', key: 'input/2026-06/grants.xlsx' });
  assert.deepEqual(rewritten[1], tasks[1]);
  // the input is left untouched
  assert.equal((tasks[0].params.fileRef as { key: string }).key, 'input/2026-05/grants.xlsx');
});

test('nested defaults are rewritten and extra reference fields survive', () => {
  const defaults = {
    month: '2026-06',
    fileRefs: {
      futu_grants: { provider: 'product-files', key: 'input/futu.xlsx', sheet: 'Grants' },
      other: { provider: 'product-files', key: 'input/keep.xlsx' },
    },
  };

  const result = rewriteProductFileKey(defaults, 'input/futu.xlsx', 'input/2026-06/futu.xlsx');

  assert.equal(result.changed, 1);
  assert.deepEqual((result.value as typeof defaults).fileRefs.futu_grants, {
    provider: 'product-files',
    key: 'input/2026-06/futu.xlsx',
    sheet: 'Grants',
  });
  assert.deepEqual((result.value as typeof defaults).fileRefs.other, defaults.fileRefs.other);
});

test('matching ignores case and unicode composition, like the logical path index does', () => {
  const value = { fileRef: { provider: 'product-files', key: 'INPUT/2026-05/Grants.xlsx' } };

  const result = rewriteProductFileKey(value, 'input/2026-05/grants.xlsx', 'input/2026-06/grants.xlsx');

  assert.equal(result.changed, 1);
  assert.equal((result.value as typeof value).fileRef.key, 'input/2026-06/grants.xlsx');
});

test('other providers, id references and unrelated keys are left alone', () => {
  const value = {
    a: { provider: 'product-files', id: 42 },
    b: { provider: 'other-store', key: 'input/2026-05/grants.xlsx' },
    c: { provider: 'product-files', key: 'input/2026-05/another.xlsx' },
    d: 'input/2026-05/grants.xlsx',
    e: null,
  };

  const result = rewriteProductFileKey(value, 'input/2026-05/grants.xlsx', 'input/2026-06/grants.xlsx');

  assert.equal(result.changed, 0);
  assert.deepEqual(result.value, value);
});

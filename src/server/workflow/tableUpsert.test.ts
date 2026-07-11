import assert from 'node:assert/strict';
import test from 'node:test';
import { buildUpsertPlan, upsertTableRows, type UpsertDbLike } from './tableUpsert.js';

test('buildUpsertPlan produces a parameterized multi-row upsert with DO UPDATE', () => {
  const plan = buildUpsertPlan({
    table: 'employees',
    columns: ['employee_id', 'source', 'employee_name'],
    rows: [
      { employee_id: 'K1', source: 'futu', employee_name: '韩林' },
      { employee_id: 'K2', source: 'futu', employee_name: '高媛' },
    ],
    conflictColumns: ['employee_id'],
    updateColumns: ['employee_name'],
  });
  assert.match(plan.sql, /insert into "employees" \("employee_id", "source", "employee_name"\)/);
  assert.match(plan.sql, /values \(\$1, \$2, \$3\), \(\$4, \$5, \$6\)/);
  assert.match(plan.sql, /on conflict \("employee_id"\) do update set "employee_name" = excluded."employee_name"/);
  assert.deepEqual(plan.params, ['K1', 'futu', '韩林', 'K2', 'futu', '高媛']);
});

test('buildUpsertPlan emits DO NOTHING when there are no update columns', () => {
  const plan = buildUpsertPlan({
    table: 'employees',
    columns: ['employee_id'],
    rows: [{ employee_id: 'x' }],
    conflictColumns: ['employee_id'],
    updateColumns: [],
  });
  assert.match(plan.sql, /on conflict \("employee_id"\) do nothing/);
});

test('buildUpsertPlan rejects invalid identifiers to block SQL injection', () => {
  assert.throws(
    () =>
      buildUpsertPlan({
        table: 'employees; drop table employees',
        columns: ['employee_id'],
        rows: [{ employee_id: 'x' }],
        conflictColumns: ['employee_id'],
        updateColumns: [],
      }),
    /Invalid table/,
  );
});

test('buildUpsertPlan requires conflict columns to be among written columns', () => {
  assert.throws(
    () =>
      buildUpsertPlan({
        table: 'employees',
        columns: ['employee_name'],
        rows: [{ employee_name: 'x' }],
        conflictColumns: ['employee_id'],
        updateColumns: [],
      }),
    /Conflict columns must be part of the written columns/,
  );
});

test('upsertTableRows enforces the table whitelist before touching the db', async () => {
  const db: UpsertDbLike = {
    queryOne: async () => {
      throw new Error('db should not be reached');
    },
  };
  await assert.rejects(
    () =>
      upsertTableRows(
        db,
        {
          table: 'app_users',
          columns: ['id'],
          rows: [{ id: 1 }],
          conflictColumns: ['id'],
          updateColumns: [],
        },
        new Set(['employees']),
      ),
    /not writable by workflow/,
  );
});

test('upsertTableRows short-circuits on empty rows without querying', async () => {
  let called = false;
  const db: UpsertDbLike = {
    queryOne: async () => {
      called = true;
      return { inserted: 0, updated: 0 } as never;
    },
  };
  const result = await upsertTableRows(
    db,
    {
      table: 'employees',
      columns: ['employee_id'],
      rows: [],
      conflictColumns: ['employee_id'],
      updateColumns: [],
    },
    new Set(['employees']),
  );
  assert.equal(called, false);
  assert.deepEqual(result, { inserted: 0, updated: 0 });
});

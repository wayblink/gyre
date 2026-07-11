import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from 'pg';
import { upsertTableRows, type UpsertDbLike } from './tableUpsert.js';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://captable:captable@127.0.0.1:55432/captable';
const SCHEMA = 'tableupsert_it_tmp';

async function connectOrNull(): Promise<Client | null> {
  const client = new Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 1500 });
  try {
    await client.connect();
    return client;
  } catch {
    await client.end().catch(() => {});
    return null;
  }
}

test('upsertTableRows performs real INSERT / UPDATE / DO NOTHING against Postgres', async (t) => {
  const client = await connectOrNull();
  if (!client) {
    t.skip('Postgres not reachable; skipping integration test');
    return;
  }
  const db: UpsertDbLike = {
    queryOne: async (text, params) => (await client.query(text, params as unknown[])).rows[0] as never,
  };
  const whitelist = new Set(['people']);
  try {
    await client.query(`drop schema if exists ${SCHEMA} cascade`);
    await client.query(`create schema ${SCHEMA}`);
    await client.query(`set search_path to ${SCHEMA}`);
    await client.query('create table people (id int, key text unique, label text)');

    // First write: two fresh rows → both inserted.
    const first = await upsertTableRows(
      db,
      {
        table: 'people',
        columns: ['id', 'key', 'label'],
        rows: [
          { id: 1, key: 'a', label: 'A' },
          { id: 2, key: 'b', label: 'B' },
        ],
        conflictColumns: ['key'],
        updateColumns: ['label'],
      },
      whitelist,
    );
    assert.deepEqual(first, { inserted: 2, updated: 0 });

    // Second write: 'a' conflicts (updated), 'c' is new (inserted).
    const second = await upsertTableRows(
      db,
      {
        table: 'people',
        columns: ['id', 'key', 'label'],
        rows: [
          { id: 1, key: 'a', label: 'A2' },
          { id: 3, key: 'c', label: 'C' },
        ],
        conflictColumns: ['key'],
        updateColumns: ['label'],
      },
      whitelist,
    );
    assert.deepEqual(second, { inserted: 1, updated: 1 });
    const updatedLabel = (await client.query(`select label from people where key = 'a'`)).rows[0].label;
    assert.equal(updatedLabel, 'A2', 'conflicting row was updated');

    // Third write with DO NOTHING: existing 'b' skipped, new 'd' inserted.
    const third = await upsertTableRows(
      db,
      {
        table: 'people',
        columns: ['id', 'key', 'label'],
        rows: [
          { id: 2, key: 'b', label: 'IGNORED' },
          { id: 4, key: 'd', label: 'D' },
        ],
        conflictColumns: ['key'],
        updateColumns: [],
      },
      whitelist,
    );
    assert.deepEqual(third, { inserted: 1, updated: 0 }, 'DO NOTHING skips the conflict, only new row counts');
    const keptLabel = (await client.query(`select label from people where key = 'b'`)).rows[0].label;
    assert.equal(keptLabel, 'B', 'DO NOTHING left the existing row untouched');
  } finally {
    await client.query(`drop schema if exists ${SCHEMA} cascade`).catch(() => {});
    await client.end().catch(() => {});
  }
});

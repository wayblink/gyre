import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { MonthlyRunDb } from './store.js';
import { MONTHLY_WORKFLOW_CODE } from './store.js';
import { resolveMonthlyWorkflowDefinition, monthlyWorkflowVersionMismatch } from './workflowSelection.js';

function createDb() {
  const calls: Array<{ text: string; params?: unknown[] }> = [];
  const db: MonthlyRunDb = {
    async query() {
      return [];
    },
    async queryOne<T>(text: string, params?: unknown[]): Promise<T | undefined> {
      calls.push({ text, params });
      return { id: params?.[0], code: params?.[0] } as T;
    },
    async execute() {},
  };
  return { db, calls };
}

test('monthly workflow selection defaults to the configured monthly workflow code', async () => {
  const { db, calls } = createDb();

  await resolveMonthlyWorkflowDefinition(db);

  assert.equal(calls[0]?.text, 'select * from workflow_definitions where code = $1');
  assert.deepEqual(calls[0]?.params, [MONTHLY_WORKFLOW_CODE]);
});

test('monthly workflow selection can target an explicit workflow code', async () => {
  const { db, calls } = createDb();

  await resolveMonthlyWorkflowDefinition(db, { workflowCode: 'monthly-v2' });

  assert.equal(calls[0]?.text, 'select * from workflow_definitions where code = $1');
  assert.deepEqual(calls[0]?.params, ['monthly-v2']);
});

test('monthly workflow selection can target an explicit workflow id', async () => {
  const { db, calls } = createDb();

  await resolveMonthlyWorkflowDefinition(db, { workflowId: 42, workflowCode: 'ignored-code' });

  assert.equal(calls[0]?.text, 'select * from workflow_definitions where id = $1');
  assert.deepEqual(calls[0]?.params, [42]);
});

test('monthly workflow version guard accepts the version the UI pinned', () => {
  assert.equal(monthlyWorkflowVersionMismatch({ version: 17 }, 17), null);
  assert.equal(monthlyWorkflowVersionMismatch({ version: '17' }, 17), null);
});

test('monthly workflow version guard rejects a stale UI or a stale workflow definition', () => {
  assert.deepEqual(monthlyWorkflowVersionMismatch({ version: 18 }, 17), { expected: 17, actual: 18 });
  assert.deepEqual(monthlyWorkflowVersionMismatch({ version: 16 }, 17), { expected: 17, actual: 16 });
  // A definition row without a usable version can never be confirmed to match.
  assert.deepEqual(monthlyWorkflowVersionMismatch({ version: null }, 17), { expected: 17, actual: 0 });
  assert.deepEqual(monthlyWorkflowVersionMismatch(null, 17), { expected: 17, actual: 0 });
});

test('monthly workflow version guard is skipped when the caller pins no version', () => {
  assert.equal(monthlyWorkflowVersionMismatch({ version: 18 }, undefined), null);
  assert.equal(monthlyWorkflowVersionMismatch({ version: 18 }, null), null);
  assert.equal(monthlyWorkflowVersionMismatch({ version: 18 }, 0), null);
});

test('monthly run API reports the workflow definition version and rejects a stale client', () => {
  const server = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');

  // The Monthly Update page needs the DB definition version to compare against the version it
  // pins, and the trigger endpoint needs the client's pinned version to reject a stale UI.
  assert.match(server, /workflowVersion: Number\(row\?\.version \?\? 0\),/);
  assert.match(server, /expectedWorkflowVersion: z\.number\(\)\.int\(\)\.positive\(\)\.optional\(\),/);
  assert.match(server, /monthlyWorkflowVersionMismatch\(workflowRow, body\.expectedWorkflowVersion\)/);
  assert.match(server, /Monthly workflow version mismatch/);
});

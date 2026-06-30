import assert from 'node:assert/strict';
import test from 'node:test';
import type { MonthlyRunDb } from './store.js';
import { MONTHLY_WORKFLOW_CODE } from './store.js';
import { resolveMonthlyWorkflowDefinition } from './workflowSelection.js';

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

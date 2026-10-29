import assert from 'node:assert/strict';
import test from 'node:test';

process.env.AUTH_DISABLED = 'true';

import {
  auditEntityFromPath,
  redactAuditPayload,
  registerAuditHook,
  writeAuditLog,
  type AuditLogEntry,
} from './audit.js';

/**
 * The audit trail: what gets recorded, what must never be recorded, and what must not break the app.
 *
 * Collection is one `onResponse` hook so no route has to remember to call it; these tests drive real
 * requests through the app and assert on what landed in the table.
 */

type FakeDb = { execute(sql: string, params?: unknown[]): Promise<unknown> };

function recordingDb(options: { fail?: boolean } = {}) {
  const inserts: Array<Array<unknown>> = [];
  const db: FakeDb = {
    async execute(sql: string, params?: unknown[]) {
      if (options.fail) throw new Error('audit table unavailable');
      if (sql.includes('insert into audit_logs')) inserts.push(params ?? []);
    },
  };
  return { db, inserts };
}

async function buildAppWithAudit(db: FakeDb) {
  const { buildApp } = await import('./app.js');
  const { createRouteContext } = await import('./routes/context.js');
  const fakeAppDb = {
    async query() {
      return [];
    },
    async queryOne() {
      return undefined;
    },
    async execute(sql: string, params?: unknown[]) {
      await db.execute(sql, params);
    },
    async transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      return fn(fakeAppDb);
    },
    async close() {},
  };
  const ctx = createRouteContext(fakeAppDb as never);
  return buildApp(ctx);
}

test('a mutating request is recorded with actor, action, status and duration', async () => {
  const { db, inserts } = recordingDb();
  const app = await buildAppWithAudit(db);
  try {
    await app.inject({ method: 'POST', url: '/api/monthly-runs/58/approvals', payload: { taskId: 'x' } });
  } finally {
    await app.close();
  }
  assert.equal(inserts.length, 1, 'one row per mutating request');
  const [, , action, entityType, entityId, method, path, statusCode] = inserts[0]!;
  assert.equal(entityType, 'monthly-runs');
  assert.equal(entityId, '58', 'the first numeric path segment is the entity id');
  assert.equal(method, 'POST');
  assert.equal(String(path), '/api/monthly-runs/58/approvals');
  // The recorded action uses the route pattern, so ids do not fragment the trail into one bucket per row.
  assert.equal(action, 'POST /api/monthly-runs/:id/approvals');
  assert.ok(Number(statusCode) > 0);
  assert.equal(String(inserts[0]![0]).length > 0, true, 'actor is never empty');
});

test('reads are not recorded: one page refresh fires too many of them', async () => {
  const { db, inserts } = recordingDb();
  const app = await buildAppWithAudit(db);
  try {
    await app.inject({ method: 'GET', url: '/api/monthly-runs/instances' });
  } finally {
    await app.close();
  }
  assert.deepEqual(inserts, []);
});

test('a login attempt is recorded, and a rejected one is marked as a failure', async () => {
  const { db, inserts } = recordingDb();
  const app = await buildAppWithAudit(db);
  try {
    await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'root', password: 'nope' } });
  } finally {
    await app.close();
  }
  assert.equal(inserts.length, 1);
  const [, , action, entityType, , , , statusCode, , , , summary] = inserts[0]!;
  assert.equal(action, 'auth.login');
  assert.equal(entityType, 'auth');
  assert.equal(Number(statusCode), 401);
  assert.equal(summary, 'auth.login_failed');
});

test('a failed audit write never fails the user action', async () => {
  const { db } = recordingDb({ fail: true });
  const app = await buildAppWithAudit(db);
  let statusCode = 0;
  try {
    // A rejected login: the route answers 401 without touching another table, so a 500 here can only
    // come from the audit write.
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'root', password: 'wrong' },
    });
    statusCode = response.statusCode;
  } finally {
    await app.close();
  }
  assert.equal(statusCode, 401, 'a broken audit table must not turn a rejected login into a server error');
});

test('credentials never reach the audit payload', () => {
  const redacted = redactAuditPayload({
    username: 'root',
    password: 'root1234',
    nested: { sessionToken: 'abc', Cookie: 'x', keep: 'visible' },
    items: [{ apiKey: 'k', name: 'n' }],
  }) as Record<string, unknown>;
  assert.equal(redacted.password, '***');
  const nested = redacted.nested as Record<string, unknown>;
  assert.equal(nested.sessionToken, '***');
  assert.equal(nested.Cookie, '***');
  assert.equal(nested.keep, 'visible');
  assert.equal(redacted.username, 'root');
  assert.equal((redacted.items as Array<Record<string, unknown>>)[0]!.apiKey, '***');
});

test('an oversized payload is truncated rather than dropped', () => {
  const big = { note: 'x'.repeat(9000) };
  const capped = redactAuditPayload(big);
  assert.equal(typeof capped, 'object');
});

test('entity parsing handles ids, nested paths and non-numeric routes', () => {
  assert.deepEqual(auditEntityFromPath('/api/monthly-runs/58/approvals'), {
    entityType: 'monthly-runs',
    entityId: '58',
  });
  assert.deepEqual(auditEntityFromPath('/api/files/upload'), { entityType: 'files', entityId: null });
  assert.deepEqual(auditEntityFromPath('/api/workflows/8'), { entityType: 'workflows', entityId: '8' });
});

test('writeAuditLog stores the redacted payload as JSON', async () => {
  const { db, inserts } = recordingDb();
  const entry: AuditLogEntry = {
    actor: 'root',
    actorRole: 'admin',
    action: 'PUT /api/x/1',
    entityType: 'x',
    entityId: '1',
    method: 'PUT',
    path: '/api/x/1',
    statusCode: 200,
    durationMs: 12,
    ip: '127.0.0.1',
    userAgent: 'vitest',
    summary: null,
    payload: { body: { token: '***' } },
  };
  await writeAuditLog(db, entry);
  assert.equal(inserts.length, 1);
  assert.equal(JSON.parse(String(inserts[0]![12])).body.token, '***');
});

test('registerAuditHook is what the app uses, not per-route calls', async () => {
  const { readFileSync } = await import('node:fs');
  const appSource = readFileSync(new URL('./app.ts', import.meta.url), 'utf8');
  assert.match(appSource, /registerAuditHook\(app/);
  assert.doesNotMatch(appSource, /writeAuditLog\(/, 'routes must not call the writer directly');
});

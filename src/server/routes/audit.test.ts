import assert from 'node:assert/strict';
import test from 'node:test';

process.env.AUTH_DISABLED = 'true';

/**
 * Reading the trail: filters, pagination and the CSV export.
 *
 * The trail is only useful if "who changed this month, and did it stick" can be answered in one query,
 * so the filters are exercised through the real app rather than by inspecting SQL strings.
 */

type Handler = { match: RegExp; rows?: unknown[]; one?: unknown };

function createFakeDb(handlers: Handler[]) {
  const calls: Array<{ text: string; params?: unknown[] }> = [];
  const db = {
    async query(text: string, params?: unknown[]) {
      calls.push({ text, params });
      const handler = handlers.find((item) => item.match.test(text));
      if (!handler) throw new Error(`Unexpected query: ${text}`);
      return (handler.rows ?? []) as never[];
    },
    async queryOne(text: string, params?: unknown[]) {
      calls.push({ text, params });
      const handler = handlers.find((item) => item.match.test(text));
      if (!handler) throw new Error(`Unexpected queryOne: ${text}`);
      return handler.one as never;
    },
    async execute() {},
    async transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      return fn(db);
    },
    async close() {},
  };
  return { db: db as never, calls };
}

async function buildTestApp(handlers: Handler[]) {
  const { buildApp } = await import('../app.js');
  const { createRouteContext } = await import('./context.js');
  const { db, calls } = createFakeDb(handlers);
  return { app: buildApp(createRouteContext(db)), calls };
}

function auditRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    actor: 'root',
    actor_role: 'admin',
    action: 'PUT /api/monthly-runs/instance',
    entity_type: 'monthly-runs',
    entity_id: null,
    method: 'PUT',
    path: '/api/monthly-runs/instance?month=2026-01',
    status_code: 200,
    duration_ms: 31,
    ip: '127.0.0.1',
    user_agent: 'vite',
    summary: null,
    payload_json: { query: { month: '2026-01' }, body: { fixedValues: { cullgenCommonStock: 0 } } },
    created_at: '2026-10-28T14:00:00.000Z',
    ...overrides,
  };
}

const COUNT = { match: /select count\(\*\)::text as count from audit_logs/, one: { count: '1' } };

test('the trail lists newest first with the fields the page needs', async () => {
  const { app } = await buildTestApp([COUNT, { match: /from audit_logs/, rows: [auditRow()] }]);
  const response = await app.inject({ method: 'GET', url: '/api/audit-logs' });
  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.total, 1);
  assert.deepEqual(body.items[0], {
    id: 7,
    actor: 'root',
    actorRole: 'admin',
    action: 'PUT /api/monthly-runs/instance',
    entityType: 'monthly-runs',
    entityId: null,
    method: 'PUT',
    path: '/api/monthly-runs/instance?month=2026-01',
    statusCode: 200,
    durationMs: 31,
    ip: '127.0.0.1',
    userAgent: 'vite',
    summary: null,
    payload: { query: { month: '2026-01' }, body: { fixedValues: { cullgenCommonStock: 0 } } },
    createdAt: '2026-10-28T14:00:00.000Z',
  });
  await app.close();
});

test('filters narrow the query instead of being applied after the fact', async () => {
  const { app, calls } = await buildTestApp([COUNT, { match: /from audit_logs/, rows: [] }]);
  await app.inject({
    method: 'GET',
    url: '/api/audit-logs?actor=root&action=monthly-runs&entityType=monthly-runs&status=failed&from=2026-10-01&to=2026-10-31',
  });
  const listCall = calls.find((call) => call.text.includes('from audit_logs') && call.text.includes('limit'));
  assert.ok(listCall, 'expected the list query');
  assert.match(listCall.text, /actor ilike \$1/);
  assert.match(listCall.text, /action ilike \$2/);
  assert.match(listCall.text, /entity_type = \$3/);
  assert.match(listCall.text, /status_code >= 400/);
  assert.match(listCall.text, /created_at >= \$4/);
  assert.match(listCall.text, /created_at <= \$5/);
  await app.close();
});

test('pagination is bounded and applied in SQL', async () => {
  const { app, calls } = await buildTestApp([COUNT, { match: /from audit_logs/, rows: [] }]);
  await app.inject({ method: 'GET', url: '/api/audit-logs?page=3&pageSize=20' });
  const listCall = calls.find((call) => call.text.includes('from audit_logs') && call.text.includes('limit'));
  assert.match(listCall?.text ?? '', /limit 20 offset 40/);
  await app.close();

  const { app: limited } = await buildTestApp([COUNT, { match: /from audit_logs/, rows: [] }]);
  const tooBig = await limited.inject({ method: 'GET', url: '/api/audit-logs?pageSize=5000' });
  assert.equal(tooBig.statusCode, 400, 'an unbounded page size would let one request dump the table');
  await limited.close();
});

test('the export streams CSV with the same filters', async () => {
  const { app } = await buildTestApp([{ match: /from audit_logs/, rows: [auditRow()] }]);
  const response = await app.inject({ method: 'GET', url: '/api/audit-logs/export?actor=root' });
  assert.equal(response.statusCode, 200);
  assert.match(String(response.headers['content-type']), /text\/csv/);
  assert.match(String(response.headers['content-disposition']), /audit-logs\.csv/);
  const lines = response.body.split('\n');
  assert.match(lines[0]!, /id,createdAt,actor,actorRole,action,entityType,entityId/);
  assert.match(lines[1]!, /"root"/);
  await app.close();
});

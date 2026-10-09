import assert from 'node:assert/strict';
import test from 'node:test';
import type { AppDb } from '../db.js';

// The route behaviours below are about payloads, not the auth gate (covered by auth.test.ts, which
// runs with the default configuration). Login is disabled for this process only.
process.env.AUTH_DISABLED = 'true';

/**
 * Route-level tests against the real Fastify app with a fake db.
 *
 * `buildApp()` was extracted from server.ts precisely so this is possible: the app used to be built
 * at module load with a live Postgres connection, which left all 100+ HTTP routes untested.
 *
 * Each handler below answers a SQL shape; `calls` records every statement so tests can assert the
 * route hit the expected query without coupling to exact SQL text.
 */

type Handler = {
  match: RegExp;
  rows?: unknown[];
  one?: unknown;
};

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
    async execute(text: string, params?: unknown[]) {
      calls.push({ text, params });
      return;
    },
    async transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      return fn(db);
    },
    async close() {},
  };
  return { db: db as unknown as AppDb, calls };
}

async function buildTestApp(handlers: Handler[]) {
  const { buildApp } = await import('../app.js');
  const { createRouteContext } = await import('./context.js');
  const { db, calls } = createFakeDb(handlers);
  const ctx = createRouteContext(db);
  return { app: buildApp(ctx), calls, db };
}

const HEALTH = { match: /^$/ };

test('health is public and carries no deployment details', async () => {
  const { app } = await buildTestApp([HEALTH]);
  const response = await app.inject({ method: 'GET', url: '/api/health' });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), { ok: true, service: 'gyre-captable', excel: 'xlsx@0.20.3' });
  assert.doesNotMatch(response.body, /database|postgres/i);
  await app.close();
});

test('unknown /api paths answer JSON 404, never the SPA shell', async () => {
  const { app } = await buildTestApp([HEALTH]);
  const response = await app.inject({ method: 'GET', url: '/api/does-not-exist' });

  assert.equal(response.statusCode, 404);
  assert.equal(JSON.parse(response.body).error, 'API route not found');
  await app.close();
});

test('monthly run endpoints read the workflow definition the page renders from', async () => {
  const { app, calls } = await buildTestApp([
    {
      match: /from workflow_definitions where code = \$1 and status = 'active'/,
      one: {
        code: 'gyre-captable-summary-v2',
        name: 'CapTable Summary',
        version: 17,
        runtime_params_schema_json: {
          fileRefs: {
            type: 'object',
            properties: {
              incremental_control_book: {
                type: 'object',
                label: 'Control Book Detail update',
                order: 2,
                required: true,
              },
            },
          },
        },
      },
    },
    { match: /from monthly_run_instances/, rows: [] },
    { match: /from months/, rows: [{ id: 1, month_key: '2026-09' }] },
  ]);

  const response = await app.inject({ method: 'GET', url: '/api/monthly-runs/source-config' });

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.workflowCode, 'gyre-captable-summary-v2');
  assert.equal(payload.workflowVersion, 17);
  assert.deepEqual(
    payload.sources.map((source: { sourceKey: string }) => source.sourceKey),
    ['incremental_control_book'],
  );
  assert.ok(calls.some((call) => /select name, version, runtime_params_schema_json/.test(call.text)));
  await app.close();
});

test('workflow definitions are listed newest first', async () => {
  const { app } = await buildTestApp([
    {
      match: /from workflow_definitions order by updated_at desc/,
      rows: [
        {
          id: 7,
          code: 'gyre-captable-summary-v2',
          name: 'CapTable Summary',
          description: '',
          status: 'active',
          version: 17,
          tasks_json: '[]',
          runtime_params_schema_json: '{}',
          runtime_params_defaults_json: '{}',
          created_at: '2026-09-01T00:00:00Z',
          updated_at: '2026-09-02T00:00:00Z',
        },
        {
          id: 3,
          code: 'plan-summary-sync',
          name: 'Plan Summary',
          description: '',
          status: 'active',
          version: 3,
          tasks_json: '[]',
          runtime_params_schema_json: '{}',
          runtime_params_defaults_json: '{}',
          created_at: '2026-08-01T00:00:00Z',
          updated_at: '2026-08-02T00:00:00Z',
        },
      ],
    },
  ]);

  const response = await app.inject({ method: 'GET', url: '/api/workflows' });

  assert.equal(response.statusCode, 200);
  const items = JSON.parse(response.body).items;
  assert.deepEqual(
    items.map((item: { id: number }) => item.id),
    [7, 3],
  );
  assert.equal(items[0].version, 17);
  await app.close();
});

test('global parameters are returned in page order with the latest revision per key', async () => {
  const { app } = await buildTestApp([
    {
      match: /distinct on \(key\)/,
      rows: [
        {
          id: 2,
          key: 'optionsOutstandingCullgen',
          value: 100,
          updated_at: '2026-09-02T00:00:00Z',
          updated_by: 'admin',
        },
        { id: 1, key: 'cullgenCommonStock', value: 14450527, updated_at: '2026-09-01T00:00:00Z', updated_by: 'admin' },
      ],
    },
  ]);

  const response = await app.inject({ method: 'GET', url: '/api/global-parameters' });

  assert.equal(response.statusCode, 200);
  const items = JSON.parse(response.body).items;
  assert.equal(items.length, 2);
  assert.ok(
    items.every((item: { key: string; value: number }) => typeof item.key === 'string' && Number.isFinite(item.value)),
  );
  await app.close();
});

test('settings endpoints keep their typed response shapes', async () => {
  const { app } = await buildTestApp([
    {
      match: /from employee_mappings/,
      rows: [{ id: 1, display_name: 'Alice', employee_id: 'E1', futu_id: 'F1', shareworks_id: 'S1' }],
    },
    {
      match: /from tracked_plans/,
      rows: [{ id: 2, plan_name: '2023 Plan', created_at: '2026-01-01T00:00:00Z', status: 'active' }],
    },
    { match: /from shareholder_tags/, rows: [{ id: 3, name: 'Bob', identity: 'ID-3', tracked: true }] },
  ]);

  const mappings = JSON.parse((await app.inject({ method: 'GET', url: '/api/settings/employee-mappings' })).body).items;
  assert.deepEqual(mappings, [{ id: 1, name: 'Alice', empId: 'E1', futuId: 'F1', shareworksId: 'S1' }]);

  const plans = JSON.parse((await app.inject({ method: 'GET', url: '/api/settings/tracked-plans' })).body).items;
  assert.deepEqual(plans, [{ id: 2, name: '2023 Plan', createTime: '2026-01-01T00:00:00Z', status: 'active' }]);

  const shareholders = JSON.parse((await app.inject({ method: 'GET', url: '/api/settings/shareholders' })).body).items;
  assert.deepEqual(shareholders, [{ id: 3, name: 'Bob', identity: 'ID-3', track: true }]);
  await app.close();
});

test('employee list paginates, filters and sorts through the shared helpers', async () => {
  const { app } = await buildTestApp([
    { match: /select count\(\*\)::int as count from employees/, one: { count: 1 } },
    {
      match: /from employees e/,
      rows: [
        {
          id: 5,
          employee_name: 'Alice',
          user_id: 'U-5',
          source: 'shareworks',
          employee_id: 'E-5',
          labels: [{ id: 1, name: 'Core', color: '#2563eb' }],
          linked_identities: [],
          grants: [],
        },
      ],
    },
    {
      match: /runtime_params_schema_json\s+from workflow_definitions/,
      one: {
        runtime_params_schema_json: {
          fileRefs: { type: 'object', properties: { employees: { type: 'object', label: 'Employees' } } },
        },
      },
    },
    { match: /from workflow_runs/, rows: [] },
  ]);

  const response = await app.inject({
    method: 'GET',
    url: '/api/employees?page=1&pageSize=20&query=ali&sort=name&dir=asc',
  });

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.total, 1);
  assert.equal(payload.items[0].employeeName, 'Alice');
  await app.close();
});

test('workflow run endpoints report a missing run as 404', async () => {
  const { app } = await buildTestApp([{ match: /from workflow_runs/, one: undefined }]);

  const response = await app.inject({ method: 'GET', url: '/api/workflow-runs/42' });

  assert.equal(response.statusCode, 404);
  assert.equal(JSON.parse(response.body).error, 'Workflow run not found');
  await app.close();
});

test('a malformed path id is rejected as 400 instead of reaching the database', async () => {
  const { app, calls } = await buildTestApp([HEALTH]);

  for (const url of [
    '/api/workflow-runs/recent',
    '/api/workflow-runs/1.5',
    '/api/workflow-runs/-1',
    '/api/workflow-runs/0',
  ]) {
    const response = await app.inject({ method: 'GET', url });
    assert.equal(response.statusCode, 400, `${url} should be a client error`);
    assert.match(JSON.parse(response.body).error, /Invalid workflow run id/);
  }

  // The rejection must happen before any query: a NaN id used to reach Postgres and surface as a
  // 500 (`invalid input syntax for type integer`).
  assert.equal(
    calls.filter((call) => /from workflow_runs/i.test(call.text)).length,
    0,
    'a malformed id must not query the database',
  );
  await app.close();
});

test('numeric path ids still reach the handler', async () => {
  const { app, calls } = await buildTestApp([{ match: /from workflow_runs/, one: undefined }]);

  const response = await app.inject({ method: 'GET', url: '/api/workflow-runs/42' });

  assert.equal(response.statusCode, 404);
  assert.equal(JSON.parse(response.body).error, 'Workflow run not found');
  assert.ok(
    calls.some((call) => /from workflow_runs/i.test(call.text) && call.params?.[0] === 42),
    'the numeric id should be passed through to the query',
  );
  await app.close();
});

test('link details resolve their stored payload', async () => {
  const { app } = await buildTestApp([
    {
      match: /from link_details/,
      one: {
        key: 'grants',
        title: 'Grants',
        columns_json: [{ key: 'name', label: 'Name' }],
        rows_json: [{ name: 'Alice' }],
        summary_json: null,
      },
    },
  ]);

  const response = await app.inject({ method: 'GET', url: '/api/link-details/grants' });

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.title, 'Grants');
  assert.deepEqual(payload.columns, [{ key: 'name', label: 'Name' }]);
  assert.deepEqual(payload.rows, [{ name: 'Alice' }]);
  await app.close();
});

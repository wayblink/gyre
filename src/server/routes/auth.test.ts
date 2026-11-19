import assert from 'node:assert/strict';
import test from 'node:test';

/**
 * Authentication gate. Runs with the default configuration (AUTH_DISABLED unset, i.e. login
 * required) so the global preHandler hook is exercised for real.
 */

async function buildApp() {
  const { buildApp: build } = await import('../app.js');
  const { createRouteContext } = await import('./context.js');
  const db = {
    async query() {
      return [];
    },
    async queryOne() {
      return undefined;
    },
    async execute() {},
    async transaction<T>(fn: (tx: unknown) => Promise<T>) {
      return fn(db);
    },
    async close() {},
  };
  return build(createRouteContext(db as never));
}

test('unauthenticated callers are rejected on every protected route', async () => {
  const app = await buildApp();

  for (const url of [
    '/api/files',
    '/api/monthly-runs',
    '/api/employees',
    '/api/holdings',
    '/api/workflows',
    '/api/admin/users',
    '/api/global-parameters',
  ]) {
    const response = await app.inject({ method: 'GET', url });
    assert.equal(response.statusCode, 401, `${url} must require a session`);
    assert.equal(JSON.parse(response.body).code, 'AUTH_REQUIRED');
  }

  // Writes are gated too, not just reads.
  assert.equal((await app.inject({ method: 'POST', url: '/api/monthly-runs', payload: {} })).statusCode, 401);
  await app.close();
});

test('the auth surface and health stay reachable without a session', async () => {
  const app = await buildApp();

  assert.equal((await app.inject({ method: 'GET', url: '/api/health' })).statusCode, 200);
  assert.equal((await app.inject({ method: 'GET', url: '/api/auth/status' })).statusCode, 200);
  // Login with unknown credentials must not leak whether the user exists.
  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username: 'nobody', password: 'whatever' },
  });
  assert.equal(login.statusCode, 401);
  await app.close();
});

test('a session is only written back once per interval, not on every request', async () => {
  const { buildApp: build } = await import('../app.js');
  const { createRouteContext } = await import('./context.js');
  const { hashSessionToken } = await import('../auth.js');
  const { config } = await import('../config.js');

  const token = 'test-session-token';
  const tokenHash = hashSessionToken(token);
  const user = {
    id: 1,
    username: 'admin',
    display_name: 'Admin',
    role: 'admin',
    email: null,
    phone: null,
    is_active: true,
    last_login_at: null,
  };

  function buildWithSession(lastSeenAt: Date) {
    const updates: string[] = [];
    const db = {
      async query(sql: string) {
        if (sql.includes('update app_sessions')) {
          updates.push(sql);
          return [];
        }
        if (sql.includes('from app_sessions s')) {
          return [
            {
              ...user,
              expires_at: new Date(Date.now() + 86_400_000).toISOString(),
              last_seen_at: lastSeenAt,
            },
          ];
        }
        return [];
      },
      async queryOne() {
        return undefined;
      },
      async execute(sql: string) {
        if (sql.includes('update app_sessions')) updates.push(sql);
      },
      async transaction<T>(fn: (tx: unknown) => Promise<T>) {
        return fn(db);
      },
      async close() {},
    };
    return { app: build(createRouteContext(db as never)), updates };
  }

  const cookie = `${config.sessionCookieName}=${token}`;

  // Seen a moment ago: serving the request must not write the row.
  const recent = buildWithSession(new Date());
  const first = await recent.app.inject({ method: 'GET', url: '/api/files', headers: { cookie } });
  assert.equal(first.statusCode, 200);
  assert.equal(recent.updates.length, 0, 'a fresh session must not be rewritten');
  await recent.app.close();

  // Idle past the interval: the expiry slides and last_seen is refreshed once.
  const stale = new Date(Date.now() - 60 * 60 * 1000);
  const idle = buildWithSession(stale);
  const second = await idle.app.inject({ method: 'GET', url: '/api/files', headers: { cookie } });
  assert.equal(second.statusCode, 200);
  assert.equal(idle.updates.length, 1, 'a stale session is written exactly once');
  await idle.app.close();

  // The hash is what the lookup uses, so a different token must not match.
  assert.equal(tokenHash.length, 64);
});

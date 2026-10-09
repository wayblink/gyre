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

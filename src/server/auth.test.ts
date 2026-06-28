import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateSessionExpiry,
  createSessionToken,
  hashPassword,
  hashSessionToken,
  parseCookies,
  serializeCookie,
  verifyPassword,
} from './auth.js';

test('hashPassword and verifyPassword validate the original password only', async () => {
  const passwordHash = await hashPassword('Admin#2026');
  assert.match(passwordHash, /^scrypt:[0-9a-f]+:[0-9a-f]+$/);
  assert.equal(await verifyPassword('Admin#2026', passwordHash), true);
  assert.equal(await verifyPassword('wrong-password', passwordHash), false);
});

test('session token hashing is deterministic and raw token stays random', () => {
  const token = createSessionToken();
  const token2 = createSessionToken();
  assert.notEqual(token, token2);
  assert.equal(hashSessionToken(token), hashSessionToken(token));
  assert.notEqual(hashSessionToken(token), hashSessionToken(token2));
});

test('cookie helpers round-trip auth cookie values', () => {
  const cookie = serializeCookie('captable_session', 'token-value', {
    httpOnly: true,
    maxAgeSeconds: 3600,
    sameSite: 'Lax',
    path: '/',
  });
  assert.match(cookie, /captable_session=token-value/);
  const parsed = parseCookies(`${cookie}; theme=teal`);
  assert.equal(parsed.captable_session, 'token-value');
  assert.equal(parsed.theme, 'teal');
});

test('calculateSessionExpiry adds ttl in hours', () => {
  const now = new Date('2026-06-28T00:00:00.000Z');
  const expiry = calculateSessionExpiry(12, now);
  assert.equal(expiry.toISOString(), '2026-06-28T12:00:00.000Z');
});

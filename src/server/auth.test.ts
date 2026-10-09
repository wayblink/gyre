import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateSessionExpiry,
  createBootstrapAdmin,
  createSessionToken,
  getPublicAccount,
  hashPassword,
  hashSessionToken,
  parseCookies,
  serializeCookie,
  updateAccountProfile,
  updateAccountPassword,
  verifyPassword,
  bootstrapSecretMatches,
} from './auth.js';

test('bootstrap secret is mandatory and must match exactly', () => {
  assert.equal(bootstrapSecretMatches('', ''), false);
  assert.equal(bootstrapSecretMatches('', 'anything'), false);
  assert.equal(bootstrapSecretMatches('configured-secret', ''), false);
  assert.equal(bootstrapSecretMatches('configured-secret', 'wrong'), false);
  assert.equal(bootstrapSecretMatches('configured-secret', 'configured-secret'), true);
});

test('bootstrap admin creation locks and creates only one first user', async () => {
  const db = new FakeBootstrapDb();
  const [first, second] = await Promise.all([
    createBootstrapAdmin(db, { username: 'first', passwordHash: 'hash-1', displayName: 'First' }),
    createBootstrapAdmin(db, { username: 'second', passwordHash: 'hash-2', displayName: 'Second' }),
  ]);

  assert.equal([first, second].filter(Boolean).length, 1);
  assert.equal(db.users.length, 1);
  assert.match(db.queries[0] ?? '', /pg_advisory_xact_lock/);
});

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

test('secure session cookies carry the Secure attribute', () => {
  const cookie = serializeCookie('captable_session', 'token-value', {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
  });
  assert.match(cookie, /; Secure$/);
});

test('calculateSessionExpiry adds ttl in hours', () => {
  const now = new Date('2026-06-28T00:00:00.000Z');
  const expiry = calculateSessionExpiry(12, now);
  assert.equal(expiry.toISOString(), '2026-06-28T12:00:00.000Z');
});

test('updateAccountProfile trims editable account fields and returns public account', async () => {
  const db = new FakeAccountDb({
    id: 7,
    username: 'root',
    password_hash: await hashPassword('Admin#2026'),
    display_name: 'Root',
    role: 'admin',
    email: null,
    phone: null,
    is_active: true,
    last_login_at: null,
  });

  const account = await updateAccountProfile(db, 7, {
    username: ' root-admin ',
    displayName: ' Root Admin ',
    email: ' admin@example.com ',
    phone: ' 13800000000 ',
  });

  assert.deepEqual(account, {
    id: 7,
    username: 'root-admin',
    displayName: 'Root Admin',
    role: 'admin',
    email: 'admin@example.com',
    phone: '13800000000',
  });
  assert.equal((await getPublicAccount(db, 7))?.email, 'admin@example.com');
});

test('updateAccountPassword requires current password and stores the new password', async () => {
  const db = new FakeAccountDb({
    id: 8,
    username: 'root',
    password_hash: await hashPassword('Old#2026'),
    display_name: 'Root',
    role: 'admin',
    email: null,
    phone: null,
    is_active: true,
    last_login_at: null,
  });

  await assert.rejects(
    () => updateAccountPassword(db, 8, { currentPassword: 'wrong', newPassword: 'New#2026' }),
    /Current password is incorrect/,
  );

  await updateAccountPassword(db, 8, { currentPassword: 'Old#2026', newPassword: 'New#2026' });
  assert.equal(await verifyPassword('Old#2026', db.user.password_hash), false);
  assert.equal(await verifyPassword('New#2026', db.user.password_hash), true);
});

type FakeUser = {
  id: number;
  username: string;
  password_hash: string;
  display_name: string;
  role: string;
  email: string | null;
  phone: string | null;
  is_active: boolean;
  last_login_at: string | null;
};

class FakeAccountDb {
  constructor(public user: FakeUser) {}

  async query<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
    if (text.includes('select id, username, display_name, role, email, phone')) {
      return [this.publicRow() as T];
    }
    if (text.includes('select id, username, password_hash')) {
      return [this.user as T];
    }
    if (text.includes('update app_users') && text.includes('password_hash = $2')) {
      this.user.password_hash = String(params[1]);
      return [];
    }
    if (text.includes('update app_users') && text.includes('username = $2')) {
      this.user.username = String(params[1]);
      this.user.display_name = String(params[2]);
      this.user.email = params[3] === null ? null : String(params[3]);
      this.user.phone = params[4] === null ? null : String(params[4]);
      return [this.publicRow() as T];
    }
    throw new Error(`Unexpected query: ${text}`);
  }

  private publicRow() {
    return {
      id: this.user.id,
      username: this.user.username,
      display_name: this.user.display_name,
      role: this.user.role,
      email: this.user.email,
      phone: this.user.phone,
    };
  }
}

class FakeBootstrapDb {
  users: Array<Record<string, unknown>> = [];
  queries: string[] = [];
  private pending = Promise.resolve();

  async transaction<T>(fn: (client: { query: FakeBootstrapDb['query'] }) => Promise<T>): Promise<T> {
    const previous = this.pending;
    let release!: () => void;
    this.pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await fn({ query: this.query.bind(this) });
    } finally {
      release();
    }
  }

  async query<T>(text: string, params: unknown[] = []): Promise<T[]> {
    this.queries.push(text);
    if (text.includes('pg_advisory_xact_lock')) return [];
    if (text.includes('count(*)')) return [{ count: this.users.length } as T];
    if (text.includes('insert into app_users')) {
      const user = {
        id: this.users.length + 1,
        username: String(params[0]),
        password_hash: String(params[1]),
        display_name: String(params[2]),
        role: String(params[3]),
        is_active: true,
        last_login_at: null,
      };
      this.users.push(user);
      return [user as T];
    }
    throw new Error(`Unexpected bootstrap query: ${text}`);
  }
}

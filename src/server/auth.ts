import crypto from 'node:crypto';
import type { Queryable } from './db.js';

const PASSWORD_SALT_BYTES = 16;
const SESSION_TOKEN_BYTES = 32;
const SCRYPT_KEYLEN = 64;

export type AuthUserRecord = {
  id: number;
  username: string;
  display_name: string;
  role: string;
  email: string | null;
  phone: string | null;
  is_active: boolean;
  last_login_at: string | null;
};

export type PublicAccount = {
  id: number;
  username: string;
  displayName: string;
  role: string;
  email: string | null;
  phone: string | null;
};

export type ManagedUserAccount = PublicAccount & {
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AuthStatusPayload = {
  authenticated: boolean;
  bootstrapRequired: boolean;
  user: {
    id: number;
    username: string;
    displayName: string;
    role: string;
    email: string | null;
    phone: string | null;
  } | null;
};

export type SessionRecord = {
  id: number;
  user_id: number;
  session_token_hash: string;
  expires_at: string;
};

function scryptAsync(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, SCRYPT_KEYLEN, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey as Buffer);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(PASSWORD_SALT_BYTES).toString('hex');
  const derivedKey = await scryptAsync(password, salt);
  return `scrypt:${salt}:${derivedKey.toString('hex')}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [algorithm, salt, expectedHex] = storedHash.split(':');
  if (algorithm !== 'scrypt' || !salt || !expectedHex) return false;
  const derivedKey = await scryptAsync(password, salt);
  const expected = Buffer.from(expectedHex, 'hex');
  if (expected.length !== derivedKey.length) return false;
  return crypto.timingSafeEqual(expected, derivedKey);
}

export function createSessionToken(): string {
  return crypto.randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
}

export function hashSessionToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function calculateSessionExpiry(ttlHours: number, now = new Date()): Date {
  return new Date(now.getTime() + ttlHours * 60 * 60 * 1000);
}

export function serializeCookie(name: string, value: string, options: {
  httpOnly?: boolean;
  maxAgeSeconds?: number;
  path?: string;
  sameSite?: 'Lax' | 'Strict' | 'None';
  secure?: boolean;
} = {}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path ?? '/'}`);
  if (options.httpOnly !== false) parts.push('HttpOnly');
  if (options.maxAgeSeconds !== undefined) parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`);
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}

export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) return {};
  return cookieHeader
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, pair) => {
      const index = pair.indexOf('=');
      if (index < 0) return acc;
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      if (!name) return acc;
      acc[name] = decodeURIComponent(value);
      return acc;
    }, {});
}

export async function hasAnyUsers(db: Queryable): Promise<boolean> {
  const row = await db.query<{ count: number }>('select count(*)::int as count from app_users');
  return Number(row[0]?.count ?? 0) > 0;
}

export async function createUser(db: Queryable, params: {
  username: string;
  passwordHash: string;
  displayName: string;
  role: string;
}): Promise<AuthUserRecord> {
  const row = await db.query<{
    id: number;
    username: string;
    display_name: string;
    role: string;
    is_active: boolean;
    last_login_at: string | null;
  }>(
    `insert into app_users (username, password_hash, display_name, role)
     values ($1, $2, $3, $4)
     returning id, username, display_name, role, is_active, last_login_at`,
    [params.username, params.passwordHash, params.displayName, params.role],
  );
  return { ...(row[0] as AuthUserRecord), email: null, phone: null };
}

export async function findUserByUsername(db: Queryable, username: string): Promise<(AuthUserRecord & { password_hash: string }) | null> {
  const row = await db.query<{
    id: number;
    username: string;
    password_hash: string;
    display_name: string;
    role: string;
    email: string | null;
    phone: string | null;
    is_active: boolean;
    last_login_at: string | null;
  }>(
    `select id, username, password_hash, display_name, role, email, phone, is_active, last_login_at
     from app_users
     where username = $1`,
    [username],
  );
  return (row[0] as (AuthUserRecord & { password_hash: string })) ?? null;
}

export async function createSession(db: Queryable, params: {
  userId: number;
  sessionTokenHash: string;
  expiresAt: Date;
}): Promise<SessionRecord> {
  const row = await db.query<SessionRecord>(
    `insert into app_sessions (user_id, session_token_hash, expires_at)
     values ($1, $2, $3)
     returning id, user_id, session_token_hash, expires_at`,
    [params.userId, params.sessionTokenHash, params.expiresAt.toISOString()],
  );
  return row[0] as SessionRecord;
}

export async function deleteSessionByHash(db: Queryable, tokenHash: string): Promise<void> {
  await db.query('delete from app_sessions where session_token_hash = $1', [tokenHash]);
}

export async function findSessionUserByTokenHash(db: Queryable, tokenHash: string): Promise<AuthUserRecord | null> {
  const row = await db.query<{
    id: number;
    username: string;
    display_name: string;
    role: string;
    email: string | null;
    phone: string | null;
    is_active: boolean;
    last_login_at: string | null;
    expires_at: string;
  }>(
    `select u.id, u.username, u.display_name, u.role, u.email, u.phone, u.is_active, u.last_login_at, s.expires_at
     from app_sessions s
     join app_users u on u.id = s.user_id
     where s.session_token_hash = $1`,
    [tokenHash],
  );
  const sessionUser = row[0];
  if (!sessionUser) return null;
  if (!sessionUser.is_active) return null;
  if (new Date(sessionUser.expires_at).getTime() <= Date.now()) return null;
  return {
    id: Number(sessionUser.id),
    username: String(sessionUser.username),
    display_name: String(sessionUser.display_name),
    role: String(sessionUser.role),
    email: sessionUser.email === null ? null : String(sessionUser.email),
    phone: sessionUser.phone === null ? null : String(sessionUser.phone),
    is_active: Boolean(sessionUser.is_active),
    last_login_at: sessionUser.last_login_at,
  };
}

export async function touchSession(db: Queryable, params: {
  tokenHash: string;
  expiresAt: Date;
}): Promise<void> {
  await db.query(
    `update app_sessions
     set last_seen_at = current_timestamp,
         expires_at = $2
     where session_token_hash = $1`,
    [params.tokenHash, params.expiresAt.toISOString()],
  );
}

export async function touchUserLastLogin(db: Queryable, userId: number): Promise<void> {
  await db.query(
    `update app_users
     set last_login_at = current_timestamp,
         updated_at = current_timestamp
     where id = $1`,
    [userId],
  );
}

function toPublicAccount(row: {
  id: number;
  username: string;
  display_name: string;
  role: string;
  email: string | null;
  phone: string | null;
}): PublicAccount {
  return {
    id: Number(row.id),
    username: String(row.username),
    displayName: String(row.display_name),
    role: String(row.role),
    email: row.email === null ? null : String(row.email),
    phone: row.phone === null ? null : String(row.phone),
  };
}

function toManagedUserAccount(row: {
  id: number;
  username: string;
  display_name: string;
  role: string;
  email: string | null;
  phone: string | null;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}): ManagedUserAccount {
  return {
    ...toPublicAccount(row),
    isActive: Boolean(row.is_active),
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getPublicAccount(db: Queryable, userId: number): Promise<PublicAccount | null> {
  const row = await db.query<{
    id: number;
    username: string;
    display_name: string;
    role: string;
    email: string | null;
    phone: string | null;
  }>(
    `select id, username, display_name, role, email, phone
     from app_users
     where id = $1 and is_active = true`,
    [userId],
  );
  return row[0] ? toPublicAccount(row[0]) : null;
}

export async function listManagedUsers(db: Queryable): Promise<ManagedUserAccount[]> {
  const rows = await db.query<{
    id: number;
    username: string;
    display_name: string;
    role: string;
    email: string | null;
    phone: string | null;
    is_active: boolean;
    last_login_at: string | null;
    created_at: string;
    updated_at: string;
  }>(
    `select id, username, display_name, role, email, phone, is_active, last_login_at, created_at, updated_at
     from app_users
     order by id`,
  );
  return rows.map(toManagedUserAccount);
}

export async function getManagedUser(db: Queryable, userId: number): Promise<ManagedUserAccount | null> {
  const row = await db.query<{
    id: number;
    username: string;
    display_name: string;
    role: string;
    email: string | null;
    phone: string | null;
    is_active: boolean;
    last_login_at: string | null;
    created_at: string;
    updated_at: string;
  }>(
    `select id, username, display_name, role, email, phone, is_active, last_login_at, created_at, updated_at
     from app_users
     where id = $1`,
    [userId],
  );
  return row[0] ? toManagedUserAccount(row[0]) : null;
}

export async function countActiveAdmins(db: Queryable, excludeUserId?: number): Promise<number> {
  const rows = await db.query<{ count: number }>(
    `select count(*)::int as count
     from app_users
     where is_active = true
       and role = 'admin'
       and ($1::int is null or id <> $1::int)`,
    [excludeUserId ?? null],
  );
  return Number(rows[0]?.count ?? 0);
}

export async function createManagedUser(db: Queryable, params: {
  username: string;
  password: string;
  displayName?: string;
  role?: string;
  email?: string | null;
  phone?: string | null;
}): Promise<ManagedUserAccount> {
  const username = params.username.trim();
  const displayName = params.displayName?.trim() || username;
  const role = params.role === 'admin' ? 'admin' : 'user';
  const email = params.email?.trim() || null;
  const phone = params.phone?.trim() || null;
  const rows = await db.query<{
    id: number;
    username: string;
    display_name: string;
    role: string;
    email: string | null;
    phone: string | null;
    is_active: boolean;
    last_login_at: string | null;
    created_at: string;
    updated_at: string;
  }>(
    `insert into app_users (username, password_hash, display_name, role, email, phone)
     values ($1, $2, $3, $4, $5, $6)
     returning id, username, display_name, role, email, phone, is_active, last_login_at, created_at, updated_at`,
    [username, await hashPassword(params.password), displayName, role, email, phone],
  );
  return toManagedUserAccount(rows[0]);
}

export async function updateManagedUser(db: Queryable, userId: number, params: {
  username?: string;
  password?: string;
  displayName?: string;
  role?: string;
  email?: string | null;
  phone?: string | null;
  isActive?: boolean;
}): Promise<ManagedUserAccount> {
  const existing = await getManagedUser(db, userId);
  if (!existing) throw new Error('User not found');
  const username = params.username?.trim() || existing.username;
  const displayName = params.displayName?.trim() || username;
  const role = params.role ?? existing.role;
  const email = params.email === undefined ? existing.email : (params.email?.trim() || null);
  const phone = params.phone === undefined ? existing.phone : (params.phone?.trim() || null);
  const isActive = params.isActive ?? existing.isActive;
  const passwordHash = params.password ? await hashPassword(params.password) : null;
  const rows = await db.query<{
    id: number;
    username: string;
    display_name: string;
    role: string;
    email: string | null;
    phone: string | null;
    is_active: boolean;
    last_login_at: string | null;
    created_at: string;
    updated_at: string;
  }>(
    `update app_users
     set username = $2,
         display_name = $3,
         role = $4,
         email = $5,
         phone = $6,
         is_active = $7,
         password_hash = coalesce($8, password_hash),
         updated_at = current_timestamp
     where id = $1
     returning id, username, display_name, role, email, phone, is_active, last_login_at, created_at, updated_at`,
    [userId, username, displayName, role, email, phone, isActive, passwordHash],
  );
  if (!rows[0]) throw new Error('User not found');
  if (!isActive) {
    await db.query('delete from app_sessions where user_id = $1', [userId]);
  }
  return toManagedUserAccount(rows[0]);
}

export async function deleteManagedUser(db: Queryable, userId: number): Promise<void> {
  await db.query('delete from app_users where id = $1', [userId]);
}

export async function updateAccountProfile(db: Queryable, userId: number, params: {
  username: string;
  displayName: string;
  email?: string | null;
  phone?: string | null;
}): Promise<PublicAccount> {
  const username = params.username.trim();
  const displayName = params.displayName.trim() || username;
  const email = params.email?.trim() || null;
  const phone = params.phone?.trim() || null;
  const row = await db.query<{
    id: number;
    username: string;
    display_name: string;
    role: string;
    email: string | null;
    phone: string | null;
  }>(
    `update app_users
     set username = $2,
         display_name = $3,
         email = $4,
         phone = $5,
         updated_at = current_timestamp
     where id = $1 and is_active = true
     returning id, username, display_name, role, email, phone`,
    [userId, username, displayName, email, phone],
  );
  if (!row[0]) throw new Error('Account not found');
  return toPublicAccount(row[0]);
}

export async function updateAccountPassword(db: Queryable, userId: number, params: {
  currentPassword: string;
  newPassword: string;
}): Promise<void> {
  const row = await db.query<{
    id: number;
    username: string;
    password_hash: string;
    display_name: string;
    role: string;
    email: string | null;
    phone: string | null;
    is_active: boolean;
    last_login_at: string | null;
  }>(
    `select id, username, password_hash, display_name, role, email, phone, is_active, last_login_at
     from app_users
     where id = $1 and is_active = true`,
    [userId],
  );
  const user = row[0];
  if (!user) throw new Error('Account not found');
  if (!(await verifyPassword(params.currentPassword, user.password_hash))) {
    throw new Error('Current password is incorrect');
  }
  await db.query(
    `update app_users
     set password_hash = $2,
         updated_at = current_timestamp
     where id = $1`,
    [userId, await hashPassword(params.newPassword)],
  );
}

export function toAuthStatus(user: AuthUserRecord | null, bootstrapRequired: boolean): AuthStatusPayload {
  if (!user) {
    return {
      authenticated: false,
      bootstrapRequired,
      user: null,
    };
  }
  return {
    authenticated: true,
    bootstrapRequired,
    user: {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      role: user.role,
      email: user.email,
      phone: user.phone,
    },
  };
}

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import {
  calculateSessionExpiry,
  countActiveAdmins,
  createBootstrapAdmin,
  createManagedUser,
  createSession,
  createSessionToken,
  deleteManagedUser,
  deleteSessionByHash,
  findSessionUserByTokenHash,
  findUserByUsername,
  getManagedUser,
  getPublicAccount,
  hashPassword,
  hashSessionToken,
  hasAnyUsers,
  listManagedUsers,
  parseCookies,
  serializeCookie,
  toAuthStatus,
  touchSession,
  touchUserLastLogin,
  updateAccountPassword,
  updateAccountProfile,
  updateManagedUser,
  verifyPassword,
  bootstrapSecretMatches,
} from '../auth.js';
import { isUniqueConstraintViolation, type RequestWithAuth } from './support.js';
import type { RouteContext } from './context.js';
import type { AuthStatus } from '../../shared/types.js';

/**
 * Authentication, the signed-in account and admin user management.
 *
 * `/api/auth/*` is the only unauthenticated surface (the global hook in app.ts skips it); everything
 * here relies on `request.currentUser`, which that hook fills in.
 */

const authBootstrapSchema = z.object({
  username: z.string().trim().min(3).max(64),
  password: z.string().min(8).max(128),
  displayName: z.string().trim().min(1).max(64).optional(),
  bootstrapSecret: z.string().trim().optional(),
});

const authLoginSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(128),
});

const accountProfilePatchSchema = z.object({
  username: z.string().trim().min(1).max(80),
  displayName: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(255).nullable().optional().or(z.literal('')),
  phone: z.string().trim().max(50).nullable().optional(),
});

const accountPasswordPatchSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});

const userRoleSchema = z.enum(['admin', 'user']);

const adminUserCreateSchema = z.object({
  username: z.string().trim().min(3).max(64),
  password: z.string().min(8).max(128),
  displayName: z.string().trim().min(1).max(120).optional(),
  role: userRoleSchema.optional().default('user'),
  email: z.string().trim().email().max(255).nullable().optional().or(z.literal('')),
  phone: z.string().trim().max(50).nullable().optional(),
});

const adminUserPatchSchema = z.object({
  username: z.string().trim().min(3).max(64).optional(),
  password: z.string().min(8).max(128).optional().or(z.literal('')),
  displayName: z.string().trim().min(1).max(120).optional(),
  role: userRoleSchema.optional(),
  email: z.string().trim().email().max(255).nullable().optional().or(z.literal('')),
  phone: z.string().trim().max(50).nullable().optional(),
  isActive: z.boolean().optional(),
});

const userIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

// Synthetic user used while login is disabled (config.authDisabled) during development.
const DEV_AUTH_USER: NonNullable<RequestWithAuth['currentUser']> = {
  id: 0,
  username: 'dev',
  display_name: 'Developer',
  role: 'admin',
  email: null,
  phone: null,
  is_active: true,
  last_login_at: null,
};

function sessionCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    maxAgeSeconds,
    path: '/',
    sameSite: 'Lax' as const,
    secure: config.sessionCookieSecure,
  };
}

function getSessionTokenFromRequest(request: { headers: Record<string, unknown> }): string | null {
  const rawCookie = request.headers.cookie;
  const cookies = parseCookies(typeof rawCookie === 'string' ? rawCookie : undefined);
  return cookies[config.sessionCookieName] ?? null;
}

async function resolveAuthUser(
  db: RouteContext['db'],
  request: { headers: Record<string, unknown> },
): Promise<RequestWithAuth['currentUser']> {
  const token = getSessionTokenFromRequest(request);
  if (!token) return null;
  const tokenHash = hashSessionToken(token);
  const user = await findSessionUserByTokenHash(db, tokenHash);
  if (!user) {
    await deleteSessionByHash(db, tokenHash);
    return null;
  }
  const expiresAt = calculateSessionExpiry(config.sessionTtlHours);
  await touchSession(db, { tokenHash, expiresAt });
  return {
    id: user.id,
    username: user.username,
    display_name: user.display_name,
    role: user.role,
    email: user.email,
    phone: user.phone,
    is_active: user.is_active,
    last_login_at: user.last_login_at,
  };
}

/** Fills `request.currentUser`, or answers 401. Used by the global preHandler hook in app.ts. */
export async function requireAuth(
  db: RouteContext['db'],
  request: { headers: Record<string, unknown> } & RequestWithAuth,
  reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } },
) {
  if (config.authDisabled) {
    request.currentUser = DEV_AUTH_USER;
    return;
  }
  request.currentUser = await resolveAuthUser(db, request);
  if (!request.currentUser) {
    return reply.code(401).send({ error: 'Authentication required', code: 'AUTH_REQUIRED' });
  }
}

/** Used by the global preHandler hook in app.ts for admin-only paths. */
export function requireAdminUser(
  request: RequestWithAuth,
  reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } },
): boolean {
  if (request.currentUser?.role === 'admin') return true;
  reply.code(403).send({ error: 'Admin role required', code: 'ADMIN_REQUIRED' });
  return false;
}

async function currentAuthStatus(
  db: RouteContext['db'],
  request: { headers: Record<string, unknown> },
): Promise<AuthStatus> {
  if (config.authDisabled) {
    return toAuthStatus(DEV_AUTH_USER, false);
  }
  const bootstrapRequired = !(await hasAnyUsers(db));
  const currentUser = await resolveAuthUser(db, request);
  return toAuthStatus(currentUser ?? null, bootstrapRequired);
}

export function registerAuthRoutes(app: FastifyInstance, ctx: RouteContext) {
  const { db } = ctx;

  app.get('/api/auth/status', async (request) => currentAuthStatus(db, request));

  app.post('/api/auth/bootstrap', async (request, reply) => {
    const body = authBootstrapSchema.parse(request.body ?? {});
    if (!config.authBootstrapSecret) {
      return reply.code(503).send({
        error: 'Administrator bootstrap is disabled until AUTH_BOOTSTRAP_SECRET is configured',
        code: 'BOOTSTRAP_SECRET_REQUIRED',
      });
    }
    if (!bootstrapSecretMatches(config.authBootstrapSecret, body.bootstrapSecret)) {
      return reply.code(403).send({ error: 'Invalid bootstrap secret' });
    }

    const user = await createBootstrapAdmin(db, {
      username: body.username,
      passwordHash: await hashPassword(body.password),
      displayName: body.displayName?.trim() || body.username,
    });
    if (!user) return reply.code(409).send({ error: 'Bootstrap already completed' });
    const sessionToken = createSessionToken();
    await createSession(db, {
      userId: user.id,
      sessionTokenHash: hashSessionToken(sessionToken),
      expiresAt: calculateSessionExpiry(config.sessionTtlHours),
    });
    await touchUserLastLogin(db, user.id);

    reply.header(
      'Set-Cookie',
      serializeCookie(config.sessionCookieName, sessionToken, sessionCookieOptions(config.sessionTtlHours * 60 * 60)),
    );

    return reply.code(201).send(
      toAuthStatus(
        {
          ...user,
          is_active: true,
        },
        false,
      ),
    );
  });

  app.post('/api/auth/login', async (request, reply) => {
    const body = authLoginSchema.parse(request.body ?? {});
    const user = await findUserByUsername(db, body.username);
    if (!user || !user.is_active || !(await verifyPassword(body.password, user.password_hash))) {
      return reply.code(401).send({ error: 'Invalid username or password' });
    }

    const sessionToken = createSessionToken();
    await createSession(db, {
      userId: user.id,
      sessionTokenHash: hashSessionToken(sessionToken),
      expiresAt: calculateSessionExpiry(config.sessionTtlHours),
    });
    await touchUserLastLogin(db, user.id);

    reply.header(
      'Set-Cookie',
      serializeCookie(config.sessionCookieName, sessionToken, sessionCookieOptions(config.sessionTtlHours * 60 * 60)),
    );

    return toAuthStatus(
      {
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        role: user.role,
        email: user.email,
        phone: user.phone,
        is_active: user.is_active,
        last_login_at: user.last_login_at,
      },
      false,
    );
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const token = getSessionTokenFromRequest(request);
    if (token) {
      await deleteSessionByHash(db, hashSessionToken(token));
    }
    reply.header('Set-Cookie', serializeCookie(config.sessionCookieName, '', sessionCookieOptions(0)));
    return reply.code(204).send();
  });

  app.get('/api/account', async (request) => {
    const user = (request as typeof request & RequestWithAuth).currentUser;
    if (!user) throw new Error('Authentication required');
    if (config.authDisabled) {
      return {
        account: {
          id: DEV_AUTH_USER.id,
          username: DEV_AUTH_USER.username,
          displayName: DEV_AUTH_USER.display_name,
          role: DEV_AUTH_USER.role,
          email: DEV_AUTH_USER.email,
          phone: DEV_AUTH_USER.phone,
        },
      };
    }
    const account = await getPublicAccount(db, user.id);
    if (!account) throw new Error('Account not found');
    return { account };
  });

  app.patch('/api/account', async (request, reply) => {
    const user = (request as typeof request & RequestWithAuth).currentUser;
    if (!user) throw new Error('Authentication required');
    const body = accountProfilePatchSchema.parse(request.body ?? {});
    try {
      const account = await updateAccountProfile(db, user.id, {
        username: body.username,
        displayName: body.displayName,
        email: body.email || null,
        phone: body.phone || null,
      });
      return { account };
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        return reply.code(409).send({ error: '账号名已存在' });
      }
      throw error;
    }
  });

  app.patch('/api/account/password', async (request, reply) => {
    const user = (request as typeof request & RequestWithAuth).currentUser;
    if (!user) throw new Error('Authentication required');
    const body = accountPasswordPatchSchema.parse(request.body ?? {});
    try {
      await updateAccountPassword(db, user.id, body);
      return reply.code(204).send();
    } catch (error) {
      if ((error as Error).message === 'Current password is incorrect') {
        return reply.code(400).send({ error: 'Current password is incorrect' });
      }
      throw error;
    }
  });

  app.get('/api/admin/users', async (request, reply) => {
    if (!requireAdminUser(request as typeof request & RequestWithAuth, reply)) return;
    return { users: await listManagedUsers(db) };
  });

  app.post('/api/admin/users', async (request, reply) => {
    if (!requireAdminUser(request as typeof request & RequestWithAuth, reply)) return;
    const body = adminUserCreateSchema.parse(request.body ?? {});
    try {
      const user = await createManagedUser(db, {
        username: body.username,
        password: body.password,
        displayName: body.displayName,
        role: body.role,
        email: body.email || null,
        phone: body.phone || null,
      });
      return reply.code(201).send({ user });
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        return reply.code(409).send({ error: '账号名已存在' });
      }
      throw error;
    }
  });

  app.patch('/api/admin/users/:id', async (request, reply) => {
    const currentUser = (request as typeof request & RequestWithAuth).currentUser;
    if (!requireAdminUser(request as typeof request & RequestWithAuth, reply)) return;
    const { id } = userIdParamSchema.parse(request.params);
    const body = adminUserPatchSchema.parse(request.body ?? {});
    const existing = await getManagedUser(db, id);
    if (!existing) return reply.code(404).send({ error: 'User not found' });
    const nextRole = body.role ?? existing.role;
    const nextActive = body.isActive ?? existing.isActive;
    if (
      existing.role === 'admin' &&
      existing.isActive &&
      (nextRole !== 'admin' || !nextActive) &&
      (await countActiveAdmins(db, id)) === 0
    ) {
      return reply.code(400).send({ error: '至少需要保留一个可用的管理员' });
    }
    if (currentUser?.id === id && (!nextActive || nextRole !== 'admin')) {
      return reply.code(400).send({ error: '不能取消当前登录管理员的管理员权限或停用当前账号' });
    }
    try {
      const user = await updateManagedUser(db, id, {
        username: body.username,
        password: body.password || undefined,
        displayName: body.displayName,
        role: body.role,
        email: body.email === undefined ? undefined : body.email || null,
        phone: body.phone === undefined ? undefined : body.phone || null,
        isActive: body.isActive,
      });
      return { user };
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        return reply.code(409).send({ error: '账号名已存在' });
      }
      throw error;
    }
  });

  app.delete('/api/admin/users/:id', async (request, reply) => {
    const currentUser = (request as typeof request & RequestWithAuth).currentUser;
    if (!requireAdminUser(request as typeof request & RequestWithAuth, reply)) return;
    const { id } = userIdParamSchema.parse(request.params);
    const existing = await getManagedUser(db, id);
    if (!existing) return reply.code(404).send({ error: 'User not found' });
    if (currentUser?.id === id) {
      return reply.code(400).send({ error: '不能删除当前登录账号' });
    }
    if (existing.role === 'admin' && existing.isActive && (await countActiveAdmins(db, id)) === 0) {
      return reply.code(400).send({ error: '至少需要保留一个可用的管理员' });
    }
    await deleteManagedUser(db, id);
    return reply.code(204).send();
  });
}

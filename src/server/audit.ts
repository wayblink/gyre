import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { RequestWithAuth } from './routes/support.js';

/**
 * Audit trail: one row per mutating request, plus every authentication event.
 *
 * Collection happens in one `onResponse` hook rather than at each route. There are sixty mutating
 * endpoints across ten route files and the number keeps growing; instrumentation spread over them is
 * forgotten exactly once and the trail has a hole nobody notices until an auditor asks. The hook also
 * records what a route never would: the resulting status code and how long the call took.
 *
 * Reads (GET) are deliberately not recorded — a single page refresh fires a dozen of them and would
 * bury the changes that matter.
 */

export type AuditLogEntry = {
  actor: string;
  actorRole: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  method: string | null;
  path: string | null;
  statusCode: number | null;
  durationMs: number | null;
  ip: string | null;
  userAgent: string | null;
  summary: string | null;
  payload: unknown;
};

export type AuditLogRecord = {
  id: number;
  actor: string;
  actorRole: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  method: string | null;
  path: string | null;
  statusCode: number | null;
  durationMs: number | null;
  ip: string | null;
  userAgent: string | null;
  summary: string | null;
  payload: unknown;
  createdAt: string;
};

/** Keys whose values must never reach the audit table. */
const REDACTED_KEY_PATTERN = /pass(word)?|secret|token|authorization|cookie|apikey|api_key|credential/i;
const REDACTED_VALUE = '***';
const MAX_PAYLOAD_BYTES = 4096;
const MAX_USER_AGENT_LENGTH = 200;

/**
 * Strip credentials and cap the size of what gets stored.
 *
 * The audit table is readable by every admin, so storing a login body verbatim would turn the trail
 * into a credential store — the opposite of what it is for. Oversized bodies are truncated rather
 * than dropped: knowing that someone sent a 300 KB payload is still useful.
 */
export function redactAuditPayload(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (depth > 6) return '[truncated]';
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => redactAuditPayload(item, depth + 1));
  }
  if (typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(source).slice(0, 60)) {
      out[key] = REDACTED_KEY_PATTERN.test(key) ? REDACTED_VALUE : redactAuditPayload(nested, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string' && value.length > 1000) return `${value.slice(0, 1000)}…[truncated]`;
  return value;
}

function capPayload(payload: unknown): unknown {
  try {
    const serialized = JSON.stringify(payload);
    if (serialized !== undefined && serialized.length > MAX_PAYLOAD_BYTES) {
      return { truncated: true, bytes: serialized.length, preview: `${serialized.slice(0, MAX_PAYLOAD_BYTES)}…` };
    }
  } catch {
    return { truncated: true, note: 'payload not serializable' };
  }
  return payload;
}

/** `POST /api/monthly-runs/58/approvals` → entity `monthly-runs`, id `58`. */
export function auditEntityFromPath(pathname: string): { entityType: string; entityId: string | null } {
  const segments = pathname
    .split('?', 1)[0]!
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);
  const apiIndex = segments.indexOf('api');
  const rest = apiIndex >= 0 ? segments.slice(apiIndex + 1) : segments;
  const entityType = rest[0] ?? 'unknown';
  const entityId = rest.find((segment, index) => index > 0 && /^\d+$/.test(segment)) ?? null;
  return { entityType, entityId };
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Routes worth recording even though they are not "a change" in the usual sense. */
const AUTH_ACTIONS: Record<string, string> = {
  '/api/auth/login': 'auth.login',
  '/api/auth/logout': 'auth.logout',
  '/api/auth/bootstrap': 'auth.bootstrap',
};

function isAuditable(method: string, pathname: string): boolean {
  if (AUTH_ACTIONS[pathname]) return true;
  return MUTATING_METHODS.has(method);
}

function actionFor(method: string, pathname: string, routePattern: string | undefined): string {
  const authAction = AUTH_ACTIONS[pathname];
  if (authAction) return authAction;
  return `${method} ${routePattern ?? pathname}`;
}

/** A failed login is a security event even though the request "succeeded" from Fastify's view. */
function summaryFor(pathname: string, statusCode: number): string | null {
  if (pathname === '/api/auth/login') return statusCode >= 400 ? 'auth.login_failed' : 'auth.login';
  if (pathname === '/api/auth/logout') return 'auth.logout';
  return null;
}

function resolveUserAgent(request: FastifyRequest): string | null {
  const header = request.headers['user-agent'];
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return null;
  return value.length > MAX_USER_AGENT_LENGTH ? `${value.slice(0, MAX_USER_AGENT_LENGTH)}…` : value;
}

function clientIp(request: FastifyRequest): string | null {
  const forwarded = request.headers['x-forwarded-for'];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (typeof first === 'string' && first.trim()) return first.split(',')[0]!.trim();
  return request.ip ?? null;
}

/**
 * Audit writes are best-effort: a full disk or a locked table must not turn into a failed user
 * action. The failure is logged rather than swallowed, because a silently broken trail is worse
 * than a noisy one.
 */
export async function writeAuditLog(
  db: { execute(sql: string, params?: unknown[]): Promise<unknown> },
  entry: AuditLogEntry,
): Promise<void> {
  await db.execute(
    `insert into audit_logs (
       actor, actor_role, action, entity_type, entity_id,
       method, path, status_code, duration_ms, ip, user_agent, summary, payload_json
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)`,
    [
      entry.actor,
      entry.actorRole,
      entry.action,
      entry.entityType,
      entry.entityId,
      entry.method,
      entry.path,
      entry.statusCode,
      entry.durationMs,
      entry.ip,
      entry.userAgent,
      entry.summary,
      JSON.stringify(entry.payload ?? null),
    ],
  );
}

export function registerAuditHook(
  app: FastifyInstance,
  deps: {
    db: { execute(sql: string, params?: unknown[]): Promise<unknown> };
    logger: { error: (obj: unknown, msg?: string) => void };
  },
): void {
  app.addHook('onResponse', async (request, reply) => {
    const rawUrl = request.raw.url ?? '';
    const pathname = rawUrl.split('?', 1)[0] ?? rawUrl;
    if (!pathname.startsWith('/api/')) return;
    if (pathname === '/api/health') return;
    const method = request.method.toUpperCase();
    if (!isAuditable(method, pathname)) return;

    const user = (request as FastifyRequest & RequestWithAuth).currentUser ?? null;
    const { entityType, entityId } = auditEntityFromPath(pathname);
    const statusCode = reply.statusCode;
    const routePattern =
      (request as FastifyRequest & { routeOptions?: { url?: string } }).routeOptions?.url ?? pathname;

    const entry: AuditLogEntry = {
      actor: user?.username?.trim() || 'system',
      actorRole: user?.role ?? null,
      action: actionFor(method, pathname, routePattern),
      entityType,
      entityId,
      method,
      path: rawUrl,
      statusCode,
      durationMs: Number.isFinite(reply.elapsedTime) ? Math.round(reply.elapsedTime) : null,
      ip: clientIp(request),
      userAgent: resolveUserAgent(request),
      summary: summaryFor(pathname, statusCode),
      payload: capPayload({
        query: redactAuditPayload(request.query ?? {}),
        body: request.isMultipart?.()
          ? { multipart: true, contentLength: request.headers['content-length'] ?? null }
          : redactAuditPayload(request.body ?? null),
      }),
    };

    try {
      await writeAuditLog(deps.db, entry);
    } catch (error) {
      deps.logger.error({ error, action: entry.action, actor: entry.actor }, 'Audit log write failed');
    }
  });
}

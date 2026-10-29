import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { toIsoTimestamp } from '../utils/timestamp.js';
import { badRequest } from './support.js';
import type { RouteContext } from './context.js';
import type { AuditLogRecord } from '../audit.js';

/**
 * Read the audit trail: `/api/audit-logs` (JSON) and `/api/audit-logs/export` (CSV).
 *
 * A trail nobody can filter is a trail nobody uses — the question is always "who changed this month,
 * when, and did it stick", so actor / action / entity / status / date range are all filterable and the
 * result is paginated.
 */

const auditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(200).optional().default(50),
  actor: z.string().trim().max(120).optional(),
  action: z.string().trim().max(200).optional(),
  entityType: z.string().trim().max(80).optional(),
  status: z.enum(['ok', 'failed']).optional(),
  from: z.string().trim().max(40).optional(),
  to: z.string().trim().max(40).optional(),
});

type AuditQuery = z.infer<typeof auditQuerySchema>;

function parseBoundary(value: string | undefined, label: string): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw badRequest(`Invalid ${label}; expected an ISO date`);
  return parsed.toISOString();
}

function whereClause(query: AuditQuery): { sql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const push = (clause: string, value: unknown) => {
    params.push(value);
    clauses.push(clause.replace('$?', `$${params.length}`));
  };

  if (query.actor) push('actor ilike $?', `%${query.actor}%`);
  if (query.action) push('action ilike $?', `%${query.action}%`);
  if (query.entityType) push('entity_type = $?', query.entityType);
  if (query.status === 'ok') clauses.push('status_code < 400');
  if (query.status === 'failed') clauses.push('(status_code >= 400 or status_code is null)');

  const from = parseBoundary(query.from, 'from');
  const to = parseBoundary(query.to, 'to');
  if (from) push('created_at >= $?', from);
  if (to) push('created_at <= $?', to);

  return { sql: clauses.length ? `where ${clauses.join(' and ')}` : '', params };
}

function toRecord(row: Record<string, unknown>): AuditLogRecord {
  const number = (value: unknown) => (value === null || value === undefined ? null : Number(value));
  return {
    id: Number(row.id),
    actor: String(row.actor ?? ''),
    actorRole: row.actor_role === null || row.actor_role === undefined ? null : String(row.actor_role),
    action: String(row.action ?? ''),
    entityType: String(row.entity_type ?? ''),
    entityId: row.entity_id === null || row.entity_id === undefined ? null : String(row.entity_id),
    method: row.method === null || row.method === undefined ? null : String(row.method),
    path: row.path === null || row.path === undefined ? null : String(row.path),
    statusCode: number(row.status_code),
    durationMs: number(row.duration_ms),
    ip: row.ip === null || row.ip === undefined ? null : String(row.ip),
    userAgent: row.user_agent === null || row.user_agent === undefined ? null : String(row.user_agent),
    summary: row.summary === null || row.summary === undefined ? null : String(row.summary),
    payload: row.payload_json ?? null,
    createdAt: toIsoTimestamp(row.created_at),
  };
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export function registerAuditRoute(app: FastifyInstance, ctx: RouteContext): void {
  const { db } = ctx;

  app.get('/api/audit-logs', async (request) => {
    const query = auditQuerySchema.parse(request.query ?? {});
    const where = whereClause(query);
    const total = await db.queryOne<{ count: string }>(`select count(*)::text as count from audit_logs ${where.sql}`, [
      ...where.params,
    ]);
    const offset = (query.page - 1) * query.pageSize;
    const rows = await db.query<Record<string, unknown>>(
      `select id, actor, actor_role, action, entity_type, entity_id, method, path,
              status_code, duration_ms, ip, user_agent, summary, payload_json, created_at
         from audit_logs
         ${where.sql}
        order by created_at desc, id desc
        limit ${query.pageSize} offset ${offset}`,
      [...where.params],
    );
    return {
      items: rows.map(toRecord),
      total: Number(total?.count ?? rows.length),
      page: query.page,
      pageSize: query.pageSize,
    };
  });

  app.get('/api/audit-logs/export', async (request, reply) => {
    const query = auditQuerySchema.parse(request.query ?? {});
    const where = whereClause(query);
    const rows = await db.query<Record<string, unknown>>(
      `select id, actor, actor_role, action, entity_type, entity_id, method, path,
              status_code, duration_ms, ip, user_agent, summary, payload_json, created_at
         from audit_logs
         ${where.sql}
        order by created_at desc, id desc
        limit 20000`,
      [...where.params],
    );
    const header = [
      'id',
      'createdAt',
      'actor',
      'actorRole',
      'action',
      'entityType',
      'entityId',
      'method',
      'path',
      'statusCode',
      'durationMs',
      'ip',
      'userAgent',
      'summary',
      'payload',
    ];
    const lines = [header.join(',')];
    for (const row of rows) {
      const record = toRecord(row);
      lines.push(
        [
          record.id,
          record.createdAt,
          record.actor,
          record.actorRole,
          record.action,
          record.entityType,
          record.entityId,
          record.method,
          record.path,
          record.statusCode,
          record.durationMs,
          record.ip,
          record.userAgent,
          record.summary,
          record.payload,
        ]
          .map(csvCell)
          .join(','),
      );
    }
    reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="audit-logs.csv"');
    return `\uFEFF${lines.join('\n')}`;
  });
}

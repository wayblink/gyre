import type { FastifyInstance } from 'fastify';
import { parseJson } from '../utils/json.js';
import type { RouteContext } from './context.js';

/** Cross-page drill-down details and the SPA history fallback. */

export function registerLinkDetailRoutes(app: FastifyInstance, ctx: RouteContext) {
  const { db } = ctx;

  app.get('/api/link-details/:key', async (request, reply) => {
    const { key } = request.params as { key: string };
    const detail = await db.queryOne<Record<string, unknown>>('select * from link_details where detail_key = $1', [
      key,
    ]);
    if (!detail) return reply.code(404).send({ error: 'Link detail not found' });
    return {
      title: String(detail.title),
      columns: parseJson(detail.columns_json, []),
      rows: parseJson(detail.rows_json, []),
      summary: parseJson(detail.summary_json, undefined),
    };
  });
}

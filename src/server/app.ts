import fs from 'node:fs';
import path from 'node:path';
import { ZodError } from 'zod';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { config } from './config.js';
import { requiresAdminRole } from './authorization.js';
import { createRouteContext, type RouteContext } from './routes/context.js';
import { requireAdminUser, requireAuth } from './routes/auth.js';
import type { RequestWithAuth } from './routes/support.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerMonthRoutes } from './routes/months.js';
import { registerMonthlyRunRoutes } from './routes/monthlyRuns.js';
import { registerFileRoutes } from './routes/files.js';
import { registerDataPageRoutes } from './routes/dataPages.js';
import { registerEmployeeRoutes } from './routes/employees.js';
import { registerParameterRoutes } from './routes/parameters.js';
import { registerSettingsRoutes } from './routes/settings.js';
import { registerWorkflowRoutes } from './routes/workflows.js';
import { registerLinkDetailRoutes } from './routes/linkDetails.js';
import { registerAuditRoute } from './routes/audit.js';
import { registerAuditHook } from './audit.js';

/** Every SPA entry path that must serve index.html instead of a 404. */
const SPA_PAGES = [
  'summary',
  'captable',
  'monthly',
  'monthly/run',
  'esop-detail',
  'grant-record',
  'exercise-record',
  'sold-shares',
  'cancellation-record',
  'transfer-plan',
  'employee-management',
  'plan-summary',
  'five-percent-holders',
  'fixed-value',
  'files',
  'workflow',
  'holdings',
  'employees',
  'account',
  'settings',
  'audit-logs',
] as const;

/**
 * Assemble the HTTP app: auth hook, the API routes grouped by domain, the SPA history fallback and
 * the static client build.
 *
 * Kept separate from server.ts (which only creates the db, calls this and listens) so tests can
 * build the app against a fake db and drive real requests through `app.inject`.
 */
export function buildApp(ctx: RouteContext): FastifyInstance {
  const app = Fastify({ logger: true });

  app.register(cors, { origin: true });
  app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });

  app.addHook('preHandler', async (request, reply) => {
    const url = request.raw.url ?? '';
    if (!url.startsWith('/api/')) return;
    if (url === '/api/health') return;
    if (url.startsWith('/api/auth/')) return;
    await requireAuth(ctx.db, request as typeof request & RequestWithAuth, reply);
    if (reply.sent) return;
    if (requiresAdminRole(request.method, url)) {
      requireAdminUser(request as typeof request & RequestWithAuth, reply);
    }
  });

  // Deliberately free of deployment details (no database URL/host): this route is unauthenticated.
  app.get('/api/health', async () => ({
    ok: true,
    service: 'gyre-captable',
    excel: 'xlsx@0.20.3',
  }));

  registerAuthRoutes(app, ctx);
  registerMonthRoutes(app, ctx);
  registerMonthlyRunRoutes(app, ctx);
  registerFileRoutes(app, ctx);
  registerDataPageRoutes(app, ctx);
  registerEmployeeRoutes(app, ctx);
  registerParameterRoutes(app, ctx);
  registerSettingsRoutes(app, ctx);
  registerWorkflowRoutes(app, ctx);
  registerLinkDetailRoutes(app, ctx);
  registerAuditRoute(app, ctx);
  // One hook records every mutating request and every authentication event; see src/server/audit.ts
  // for why this is not spread across the routes.
  registerAuditHook(app, { db: ctx.db, logger: app.log });

  app.setErrorHandler((error: Error & { statusCode?: number }, _request, reply) => {
    // A rejected request body is a client error. Without this an invalid value reaches the browser as a
    // 500 "server fault" carrying a raw zod issue dump, which reads like a crash in the logs.
    const isClientInputError = error instanceof ZodError;
    const statusCode = error.statusCode ?? (isClientInputError ? 400 : 500);
    app.log.error(error);
    reply.code(statusCode).send({ error: error.message });
  });

  // The client build only exists in a deployed image; running the API alone (tests, dev) skips it.
  if (fs.existsSync(config.clientDistDir)) {
    app.register(fastifyStatic, {
      root: config.clientDistDir,
      setHeaders: (reply, filePath) => {
        // Vite asset names contain content hashes; cache them aggressively while
        // keeping index.html revalidated so new deployments become visible.
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          reply.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          return;
        }
        if (/\.(?:png|svg|ico|webp|woff2?)$/i.test(filePath)) {
          reply.setHeader('Cache-Control', 'public, max-age=86400');
        }
      },
    });
    for (const page of SPA_PAGES) {
      app.get(`/${page}`, async (_request, reply) => reply.sendFile('index.html'));
    }
    app.get('/monthlyrun', async (_request, reply) => reply.redirect(301, '/monthly/run'));
    app.setNotFoundHandler((request, reply) => {
      if (request.raw.url?.startsWith('/api/')) return reply.code(404).send({ error: 'API route not found' });
      return reply.sendFile('index.html');
    });
  }

  return app;
}

export { createRouteContext };
export type { RouteContext };

import { config } from './config.js';
import { createDb } from './db.js';
import { buildApp } from './app.js';
import { createRouteContext } from './routes/context.js';

/**
 * Process entry point: create the db, wire the workflow runtime + routes into the Fastify app and
 * listen. Everything else lives in routes/* (HTTP) or workflow/* (execution).
 */
const db = await createDb();
const ctx = createRouteContext(db);
const app = buildApp(ctx);

process.on('SIGINT', () => {
  void db.close().finally(() => process.exit(0));
});

process.on('SIGTERM', () => {
  void db.close().finally(() => process.exit(0));
});

await app.listen({ host: config.host, port: config.port });

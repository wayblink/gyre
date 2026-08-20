import path from 'node:path';

const rootDir = process.cwd();
const minioPort = Number(process.env.MINIO_PORT ?? process.env.MINIO_HOST_PORT ?? 29000);

export const config = {
  host: process.env.HOST ?? '127.0.0.1',
  port: Number(process.env.PORT ?? 60628),
  rootDir,
  dataDir: path.join(rootDir, 'data'),
  uploadDir: path.join(rootDir, 'data', 'uploads'),
  productFileDir: path.join(rootDir, 'data', 'product-files'),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://captable:captable@127.0.0.1:55432/captable',
  clientDistDir: path.join(rootDir, 'dist', 'client'),
  storageDriver: process.env.STORAGE_DRIVER ?? 'minio',
  minioEndpoint: process.env.MINIO_ENDPOINT ?? '127.0.0.1',
  minioPort,
  minioUseSSL: process.env.MINIO_USE_SSL === 'true',
  minioAccessKey: process.env.MINIO_ACCESS_KEY ?? 'minioadmin',
  minioSecretKey: process.env.MINIO_SECRET_KEY ?? 'minioadmin',
  minioBucket: process.env.MINIO_BUCKET ?? 'captable-files',
  sessionCookieName: process.env.SESSION_COOKIE_NAME ?? 'captable_session',
  sessionTtlHours: Number(process.env.SESSION_TTL_HOURS ?? 24 * 7),
  authBootstrapSecret: process.env.AUTH_BOOTSTRAP_SECRET ?? '',
  // Login is temporarily disabled during development. Set AUTH_DISABLED=false to re-enable
  // authentication once the product is mature.
  authDisabled: (process.env.AUTH_DISABLED ?? 'true') === 'true',
  // Workflow operators and global parameters are product metadata seeded on boot.
  // Built-in workflow definitions are inserted only when missing; existing DB rows
  // remain the source of truth.
  workflowSeedOnInit: (process.env.WORKFLOW_SEED_ON_INIT ?? 'true') === 'true',
};

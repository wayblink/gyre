import fs from 'node:fs';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { config } from './config.js';
import { schemaSql } from './schema.js';
import { ensureWorkflowSeedData, seedDemoBusinessData } from './seed.js';
import { fileStorage } from './storage.js';

export type Queryable = {
  query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<T[]>;
};

export class AppDb {
  private readonly pool: Pool;

  constructor() {
    this.pool = new Pool({
      connectionString: config.databaseUrl,
      max: 10,
    });
  }

  async init() {
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.mkdirSync(config.uploadDir, { recursive: true });
    fs.mkdirSync(config.productFileDir, { recursive: true });
    await fileStorage.init();
    await this.pool.query(schemaSql);
    if (config.workflowSeedOnInit) {
      await ensureWorkflowSeedData(this);
    }
    if (config.demoSeedOnInit) {
      await seedDemoBusinessData(this);
    }
  }

  async query<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
    const result = await this.pool.query<T>(text, params);
    return result.rows;
  }

  async queryOne<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []): Promise<T | undefined> {
    const result = await this.pool.query<T>(text, params);
    return result.rows[0];
  }

  async execute(text: string, params: unknown[] = []): Promise<void> {
    await this.pool.query(text, params);
  }

  async transaction<T>(fn: (client: DbClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    const dbClient = new DbClient(client);
    try {
      await client.query('begin');
      const result = await fn(dbClient);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export class DbClient {
  constructor(private readonly client: PoolClient) {}

  async query<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
    const result = await this.client.query<T>(text, params);
    return result.rows;
  }

  async queryOne<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []): Promise<T | undefined> {
    const result = await this.client.query<T>(text, params);
    return result.rows[0];
  }

  async execute(text: string, params: unknown[] = []): Promise<void> {
    await this.client.query(text, params);
  }
}

export async function createDb(): Promise<AppDb> {
  const db = new AppDb();
  await db.init();
  return db;
}

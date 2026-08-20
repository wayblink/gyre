/**
 * Export DB-owned workflow definitions to database/workflows/<code>.json seed files.
 *
 * Workflow definitions live only in the database (see CLAUDE.md). These JSON files are
 * the seed source a fresh database bootstraps from via the generic loader in
 * src/server/workflow/workflowSeedLoader.ts (insert-if-missing, keyed on `code`).
 *
 * Re-run this whenever a built-in workflow changes in the DB and should ship as a seed:
 *   npx tsx scripts/export-workflows.ts
 *
 * By default only `active` workflows are exported (UI-created draft copies are skipped).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://captable:captable@127.0.0.1:55432/captable';

const outDir = path.join(process.cwd(), 'database', 'workflows');

async function main(): Promise<void> {
  const pool = new Pool({ connectionString });
  try {
    mkdirSync(outDir, { recursive: true });
    const { rows } = await pool.query(
      `select code, name, description, status, version,
              tasks_json, runtime_params_schema_json, runtime_params_defaults_json
         from workflow_definitions
        where status = 'active'
        order by id`,
    );
    for (const row of rows) {
      const doc = {
        code: row.code as string,
        name: row.name as string,
        description: row.description as string,
        status: row.status as string,
        version: row.version as number,
        tasks: row.tasks_json ?? [],
        runtimeParamsSchema: row.runtime_params_schema_json ?? {},
        runtimeParamsDefaults: row.runtime_params_defaults_json ?? {},
      };
      const file = path.join(outDir, `${doc.code}.json`);
      writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
      console.log(`exported ${doc.code} (v${doc.version}, ${Array.isArray(doc.tasks) ? doc.tasks.length : 0} tasks) -> ${path.relative(process.cwd(), file)}`);
    }
    console.log(`\n${rows.length} workflow(s) exported to ${path.relative(process.cwd(), outDir)}/`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import { config } from '../config.js';

type WorkflowSeedFile = {
  code?: unknown;
  name?: unknown;
  description?: unknown;
  status?: unknown;
  version?: unknown;
  tasks?: unknown;
  runtimeParamsSchema?: unknown;
  runtimeParamsDefaults?: unknown;
};

function usage(): never {
  throw new Error(
    [
      'Usage: node dist/src/server/workflow/publishWorkflowSeed.js <workflow-code> [--dry-run] [--force]',
      '',
      'Publishes database/workflows/<workflow-code>.json into workflow_definitions and workflow_definition_versions.',
    ].join('\n'),
  );
}

function parseArgs(argv: string[]) {
  const flags = new Set(argv.filter((arg) => arg.startsWith('--')));
  const positional = argv.filter((arg) => !arg.startsWith('--'));
  const workflowCode = positional[0];
  if (!workflowCode || positional.length > 1) usage();
  return {
    workflowCode,
    dryRun: flags.has('--dry-run'),
    force: flags.has('--force'),
  };
}

function loadSeed(workflowCode: string) {
  const filePath = path.join(config.rootDir, 'database', 'workflows', `${workflowCode}.json`);
  const doc = JSON.parse(readFileSync(filePath, 'utf8')) as WorkflowSeedFile;
  if (doc.code !== workflowCode) {
    throw new Error(`Seed file code mismatch: expected ${workflowCode}, got ${String(doc.code)}`);
  }
  if (typeof doc.name !== 'string' || !doc.name.trim()) throw new Error(`Seed ${workflowCode} is missing name`);
  if (typeof doc.version !== 'number' || !Number.isInteger(doc.version) || doc.version < 1) {
    throw new Error(`Seed ${workflowCode} has invalid version`);
  }
  if (!Array.isArray(doc.tasks)) throw new Error(`Seed ${workflowCode} is missing tasks array`);

  return {
    filePath,
    workflow: {
      code: workflowCode,
      name: doc.name,
      description: typeof doc.description === 'string' ? doc.description : '',
      status: doc.status === 'draft' ? 'draft' : 'active',
      version: doc.version,
      tasks: doc.tasks,
      runtimeParamsSchema:
        doc.runtimeParamsSchema && typeof doc.runtimeParamsSchema === 'object' ? doc.runtimeParamsSchema : {},
      runtimeParamsDefaults:
        doc.runtimeParamsDefaults && typeof doc.runtimeParamsDefaults === 'object' ? doc.runtimeParamsDefaults : {},
    },
  };
}

async function main() {
  const { workflowCode, dryRun, force } = parseArgs(process.argv.slice(2));
  const { filePath, workflow } = loadSeed(workflowCode);
  const pool = new Pool({ connectionString: config.databaseUrl });
  const client = await pool.connect();
  try {
    await client.query('begin');
    const existing = await client.query<{ id: number; version: number }>(
      'select id, version from workflow_definitions where code = $1 for update',
      [workflow.code],
    );
    const existingRow = existing.rows[0];
    if (existingRow && Number(existingRow.version) > workflow.version && !force) {
      throw new Error(
        `Refusing to downgrade ${workflow.code} from v${existingRow.version} to v${workflow.version}; pass --force to override.`,
      );
    }

    const upserted = await client.query<{ id: number; version: number }>(
      `insert into workflow_definitions (
         code, name, description, status, version, tasks_json,
         runtime_params_schema_json, runtime_params_defaults_json
       )
       values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb)
       on conflict (code) do update set
         name = excluded.name,
         description = excluded.description,
         status = excluded.status,
         version = excluded.version,
         tasks_json = excluded.tasks_json,
         runtime_params_schema_json = excluded.runtime_params_schema_json,
         runtime_params_defaults_json = excluded.runtime_params_defaults_json,
         updated_at = current_timestamp
       returning id, version`,
      [
        workflow.code,
        workflow.name,
        workflow.description,
        workflow.status,
        workflow.version,
        JSON.stringify(workflow.tasks),
        JSON.stringify(workflow.runtimeParamsSchema),
        JSON.stringify(workflow.runtimeParamsDefaults),
      ],
    );
    const workflowId = upserted.rows[0]?.id;
    if (!workflowId) throw new Error(`Failed to publish workflow ${workflow.code}`);

    const versioned = await client.query<{ id: number }>(
      `insert into workflow_definition_versions (
         workflow_id, version, status, tasks_json,
         runtime_params_schema_json, runtime_params_defaults_json,
         operator_bindings_json, schema_version, published_at
       )
       values ($1, $2, 'published', $3::jsonb, $4::jsonb, $5::jsonb, '{}'::jsonb, '1', current_timestamp)
       on conflict (workflow_id, version) do update set
         status = 'published',
         tasks_json = excluded.tasks_json,
         runtime_params_schema_json = excluded.runtime_params_schema_json,
         runtime_params_defaults_json = excluded.runtime_params_defaults_json,
         operator_bindings_json = excluded.operator_bindings_json,
         schema_version = excluded.schema_version,
         published_at = current_timestamp
       returning id`,
      [
        workflowId,
        workflow.version,
        JSON.stringify(workflow.tasks),
        JSON.stringify(workflow.runtimeParamsSchema),
        JSON.stringify(workflow.runtimeParamsDefaults),
      ],
    );

    if (dryRun) {
      await client.query('rollback');
    } else {
      await client.query('commit');
    }

    console.log(
      `${dryRun ? 'validated' : 'published'} ${workflow.code} v${workflow.version} from ${path.relative(config.rootDir, filePath)} ` +
        `(workflow_id=${workflowId}, version_id=${versioned.rows[0]?.id ?? 'unknown'})`,
    );
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from 'pg';
import type { AppDb } from '../db.js';
import { WorkflowRunStore } from './runStore.js';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://captable:captable@127.0.0.1:55432/captable';
const SCHEMA = 'runstore_light_it_tmp';

async function connectOrNull(): Promise<Client | null> {
  const client = new Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 1500 });
  try {
    await client.connect();
    return client;
  } catch {
    await client.end().catch(() => {});
    return null;
  }
}

/**
 * Adapt a raw pg Client to the three AppDb methods WorkflowRunStore.getRun uses. getRun fires its
 * list queries via Promise.all; a single Client can't run concurrent queries, so serialize them
 * through a promise chain (the real AppDb uses a Pool and dodges this).
 */
function appDbOver(client: Client): AppDb {
  let chain: Promise<unknown> = Promise.resolve();
  const run = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.catch(() => {});
    return next;
  };
  const db = {
    query: (text: string, params: unknown[] = []) =>
      run(async () => (await client.query(text, params as unknown[])).rows),
    queryOne: (text: string, params: unknown[] = []) =>
      run(async () => (await client.query(text, params as unknown[])).rows[0]),
    execute: (text: string, params: unknown[] = []) =>
      run(async () => {
        await client.query(text, params as unknown[]);
      }),
  };
  return db as unknown as AppDb;
}

// A dataFrame with more than LIGHT_SAMPLE_ROW_COUNT (5) rows plus the heavy cells/matrix the light
// projection is meant to strip. rows[0] carries a sentinel the monthly page reads (bc adjustment).
function bigDataFrame(rowCount: number) {
  const rows = Array.from({ length: rowCount }, (_, i) => ({
    n: i,
    bc_subplan_cancelled_adjustment: i === 0 ? 4242 : i,
  }));
  return {
    columns: ['n', 'bc_subplan_cancelled_adjustment'],
    rows,
    index: Array.from({ length: rowCount }, (_, i) => i),
    matrix: rows.map((r) => [r.n, r.bc_subplan_cancelled_adjustment]),
    cells: Object.fromEntries(rows.map((r, i) => [`A${i + 1}`, r.n])),
    range: { sheetName: 'Sheet1', a1Range: `A1:B${rowCount}`, startRow: 1, endRow: rowCount, startCol: 1, endCol: 2 },
    schema: [
      { name: 'n', type: 'number' },
      { name: 'bc_subplan_cancelled_adjustment', type: 'number' },
    ],
  };
}

test('getRun light trims step dataframes and artifact dataframe at the SQL layer; full getRun stays intact', async (t) => {
  const client = await connectOrNull();
  if (!client) {
    t.skip('Postgres not reachable; skipping integration test');
    return;
  }

  try {
    await client.query(`drop schema if exists ${SCHEMA} cascade`);
    await client.query(`create schema ${SCHEMA}`);
    await client.query(`set search_path to ${SCHEMA}`);

    // Minimal shapes of the five tables getRun reads. events/approvals stay empty.
    await client.query(`create table workflow_runs (
      id int primary key, workflow_id int, version_id int, workflow_code text, workflow_name text,
      status text, runtime_parameters_json jsonb, tasks_snapshot_json jsonb,
      started_at timestamptz default now(), finished_at timestamptz, duration_ms int,
      error_message text, approved_warning_task_ids_json jsonb default '[]'::jsonb)`);
    await client.query(`create table workflow_run_steps (
      id int primary key, run_id int, task_id text, task_name text, operator_code text, status text,
      task_snapshot_json jsonb, lock_token text, locked_at timestamptz, attempt_count int default 0,
      result_json jsonb, error_message text, started_at timestamptz, finished_at timestamptz, duration_ms int)`);
    await client.query(`create table workflow_run_artifacts (
      id int primary key, run_id int, step_id int, task_id text, artifact_type text,
      file_id int, name text, metadata_json jsonb, created_at timestamptz default now())`);
    await client.query(`create table workflow_run_events (
      id int primary key, run_id int, step_id int, task_id text, event_type text, level text,
      message text, payload_json jsonb, created_at timestamptz default now())`);
    await client.query(`create table workflow_run_approvals (id int primary key, run_id int)`);

    const RUN_ID = 1;
    await client.query(
      `insert into workflow_runs (id, workflow_id, workflow_code, workflow_name, status, runtime_parameters_json, tasks_snapshot_json)
       values ($1, 10, 'gyre-captable-summary-v2', 'Monthly', 'completed', '{}'::jsonb, '[]'::jsonb)`,
      [RUN_ID],
    );

    const ROW_COUNT = 8;
    // Step 1: plain dataframe result with a big frame.
    await client.query(
      `insert into workflow_run_steps (id, run_id, task_id, task_name, operator_code, status, task_snapshot_json, result_json)
       values (1, $1, 'calc_option_metrics', 'Calc', 'sql.compute', 'completed', '{"description":"d"}'::jsonb, $2::jsonb)`,
      [RUN_ID, JSON.stringify({ kind: 'dataframe', dataFrame: bigDataFrame(ROW_COUNT) })],
    );
    // Step 2: assert result — the assertion object must survive the light projection.
    await client.query(
      `insert into workflow_run_steps (id, run_id, task_id, task_name, operator_code, status, task_snapshot_json, result_json)
       values (2, $1, 'guard', 'Guard', 'assert', 'completed', '{}'::jsonb, $2::jsonb)`,
      [
        RUN_ID,
        JSON.stringify({
          kind: 'assert',
          assertion: {
            passed: true,
            operator: '>',
            actualValue: 10,
            expectedValue: 0,
            failureMessage: '',
            failureStrategy: 'block',
            blockExecution: true,
          },
          dataFrame: bigDataFrame(ROW_COUNT),
        }),
      ],
    );

    // Legacy artifact carrying a full dataframe in metadata (new runs no longer write this).
    await client.query(
      `insert into workflow_run_artifacts (id, run_id, step_id, task_id, artifact_type, file_id, name, metadata_json)
       values (1, $1, 1, 'calc_option_metrics', 'file', 99, 'out.xlsx', $2::jsonb)`,
      [
        RUN_ID,
        JSON.stringify({
          dataframe: bigDataFrame(ROW_COUNT),
          file: { id: 99 },
          rows: ROW_COUNT,
          columns: 2,
          range: `A1:B${ROW_COUNT}`,
        }),
      ],
    );

    // artifact_created events mirror the artifact metadata (dataframe included) into payload — the
    // real memory hog on historical runs. A warning event carries the message the monthly page reads.
    await client.query(
      `insert into workflow_run_events (id, run_id, step_id, task_id, event_type, level, message, payload_json)
       values (1, $1, 1, 'calc_option_metrics', 'artifact_created', 'info', '', $2::jsonb)`,
      [
        RUN_ID,
        JSON.stringify({
          artifactType: 'file',
          fileId: 99,
          metadata: { dataframe: bigDataFrame(ROW_COUNT), rows: ROW_COUNT },
        }),
      ],
    );
    await client.query(
      `insert into workflow_run_events (id, run_id, step_id, task_id, event_type, level, message, payload_json)
       values (2, $1, 2, 'guard', 'warning_raised', 'warning', 'BC subplan below threshold', '{}'::jsonb)`,
      [RUN_ID],
    );

    const store = new WorkflowRunStore(appDbOver(client));

    // --- light path: trimmed at the SQL layer ---
    const light = await store.getRun(RUN_ID, { light: true });
    const lightStep = light.steps.find((s) => s.taskId === 'calc_option_metrics');
    assert.ok(lightStep?.result && lightStep.result.kind === 'dataframe', 'dataframe step present');
    const lightDf = lightStep.result.dataFrame;
    assert.equal(lightDf.rows.length, 5, 'rows trimmed to LIGHT_SAMPLE_ROW_COUNT');
    assert.equal(lightDf.index.length, 5, 'index trimmed to LIGHT_SAMPLE_ROW_COUNT');
    assert.deepEqual(lightDf.matrix, [], 'matrix emptied');
    assert.ok(!('cells' in (lightDf as Record<string, unknown>)), 'cells stripped');
    assert.deepEqual(lightDf.columns, ['n', 'bc_subplan_cancelled_adjustment'], 'columns preserved');
    assert.equal(lightDf.range.a1Range, `A1:B${ROW_COUNT}`, 'range preserved');
    assert.equal(lightDf.schema?.length, 2, 'schema preserved');
    assert.equal(
      (lightDf.rows[0] as Record<string, unknown>).bc_subplan_cancelled_adjustment,
      4242,
      'rows[0] sentinel preserved',
    );

    const lightAssert = light.steps.find((s) => s.taskId === 'guard');
    assert.ok(lightAssert?.result && lightAssert.result.kind === 'assert', 'assert step keeps kind');
    assert.equal(lightAssert.result.assertion.passed, true, 'assertion preserved');
    assert.equal(lightAssert.result.assertion.operator, '>', 'assertion operator preserved');
    assert.equal(lightAssert.result.dataFrame.rows.length, 5, 'assert dataframe also trimmed');

    const lightArtifact = light.artifacts[0];
    assert.ok(!('dataframe' in lightArtifact.metadata), 'artifact dataframe dropped');
    assert.equal(lightArtifact.metadata.rows, ROW_COUNT, 'artifact rows count preserved');
    assert.equal(lightArtifact.metadata.columns, 2, 'artifact columns count preserved');
    assert.deepEqual(lightArtifact.metadata.file as Record<string, unknown>, { id: 99 }, 'artifact file preserved');

    // Event columns (type/taskId/message) survive; the heavy payload.metadata blob is dropped.
    const lightArtifactEvent = light.events.find((e) => e.eventType === 'artifact_created');
    assert.ok(lightArtifactEvent, 'artifact_created event kept');
    assert.ok(!('metadata' in lightArtifactEvent.payload), 'event payload metadata (dataframe carrier) dropped');
    assert.equal(lightArtifactEvent.payload.fileId, 99, 'small event payload fields preserved');
    const lightWarnEvent = light.events.find((e) => e.eventType === 'warning_raised');
    assert.equal(
      lightWarnEvent?.message,
      'BC subplan below threshold',
      'warning message (a column) preserved for monthly page',
    );

    // --- full path (execution/preview): untouched ---
    const full = await store.getRun(RUN_ID);
    const fullStep = full.steps.find((s) => s.taskId === 'calc_option_metrics');
    assert.ok(fullStep?.result && fullStep.result.kind === 'dataframe');
    assert.equal(fullStep.result.dataFrame.rows.length, ROW_COUNT, 'full getRun keeps every row');
    assert.equal(fullStep.result.dataFrame.matrix.length, ROW_COUNT, 'full getRun keeps matrix');
    assert.ok('cells' in (fullStep.result.dataFrame as Record<string, unknown>), 'full getRun keeps cells');
    assert.ok('dataframe' in full.artifacts[0].metadata, 'full getRun keeps artifact dataframe');
    const fullArtifactEvent = full.events.find((e) => e.eventType === 'artifact_created');
    assert.ok(fullArtifactEvent && 'metadata' in fullArtifactEvent.payload, 'full getRun keeps event payload metadata');
  } finally {
    await client.query(`drop schema if exists ${SCHEMA} cascade`).catch(() => {});
    await client.end().catch(() => {});
  }
});

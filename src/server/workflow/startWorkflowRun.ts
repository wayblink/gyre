import type { WorkflowRunRecord, WorkflowRuntimeParameters, WorkflowTask } from '../../shared/types.js';
import { parseJson } from '../utils/json.js';
import { buildFileRefsFromBindings } from './fileSources.js';
import type { WorkflowRunCreateInput } from './runRepository.js';
import { resolveWorkflowRuntimeConfiguration } from './runtimeParameters.js';
import { normalizeWorkflowTasks } from './tasks.js';

/**
 * Shared bootstrap for "start a workflow run" endpoints.
 *
 * ESOP pages, data-management pages, Monthly Update and the workflow editor all used to repeat the
 * same four steps (load the active definition, resolve the chosen product files into fileRefs,
 * resolve runtime parameters against the definition schema, persist the run and start it). Keeping
 * one implementation means the monthly page's version guard and every other entry point stay in
 * step, and a change to runtime-parameter resolution only has to happen once.
 */

/**
 * DB surface the bootstrap needs. Kept non-generic on purpose: both `AppDb`/`DbClient` (generic)
 * and the plain fakes used in tests satisfy it.
 */
export type WorkflowBootstrapDb = {
  queryOne(sql: string, params?: unknown[]): Promise<Record<string, unknown> | undefined>;
  query(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
};

export type WorkflowRunCreator = {
  createRun(input: WorkflowRunCreateInput): Promise<WorkflowRunRecord>;
};

export type WorkflowRunStarter = {
  startAsync(runId: number): void;
};

/** A source binding as it arrives from a page: the chosen product file (+ optional sheet). */
export type WorkflowSourceBinding = { fileId?: number | null; sheet?: string | null };

export async function loadActiveWorkflowDefinition(
  db: WorkflowBootstrapDb,
  workflowCode: string,
): Promise<Record<string, unknown> | null> {
  return (
    (await db.queryOne("select * from workflow_definitions where code = $1 and status = 'active' limit 1", [
      workflowCode,
    ])) ?? null
  );
}

/**
 * Resolve source bindings to product-file keys. All lookups happen in one query: the per-source
 * `queryOne` loop this replaces issued one round trip per input source on every run trigger.
 */
export async function resolveWorkflowSourceBindings(
  db: WorkflowBootstrapDb,
  sources: Record<string, WorkflowSourceBinding | undefined>,
): Promise<Record<string, { fileKey: string; sheet?: string }>> {
  const fileIds = [
    ...new Set(
      Object.values(sources)
        .map((binding) => Number(binding?.fileId ?? 0))
        .filter((fileId) => Number.isInteger(fileId) && fileId > 0),
    ),
  ];
  const logicalPaths = new Map<number, string>();
  if (fileIds.length) {
    const rows = await db.query('select id, logical_path from product_files where id = any($1::int[])', [fileIds]);
    for (const row of rows) {
      const logicalPath = String(row.logical_path ?? '').trim();
      if (logicalPath) logicalPaths.set(Number(row.id), logicalPath);
    }
  }

  const resolved: Record<string, { fileKey: string; sheet?: string }> = {};
  for (const [sourceKey, binding] of Object.entries(sources)) {
    const fileKey = binding?.fileId ? logicalPaths.get(Number(binding.fileId)) : undefined;
    if (!fileKey) continue;
    const sheet = String(binding?.sheet ?? '').trim();
    resolved[sourceKey] = sheet ? { fileKey, sheet } : { fileKey };
  }
  return resolved;
}

/**
 * Resolve what a run of `workflow` would execute: the normalized task list plus the runtime
 * parameters merged over the definition's defaults and validated against its schema.
 *
 * Exported separately from `startWorkflowRun` because callers that need the resolved parameters
 * before the run exists (Monthly Update snapshots them into its history row) must not persist a
 * run first.
 */
export async function resolveWorkflowRunPlan(params: {
  db: WorkflowBootstrapDb;
  workflow: Record<string, unknown>;
  /** Page-provided source bindings; resolved into `fileRefs`. */
  sources?: Record<string, WorkflowSourceBinding | undefined>;
  /** Extra runtime parameters (e.g. per-month fixed values) merged over the definition defaults. */
  runtimeParameters?: WorkflowRuntimeParameters;
}): Promise<{ tasks: WorkflowTask[]; runtimeParameters: WorkflowRuntimeParameters }> {
  const { db, workflow, sources = {}, runtimeParameters } = params;
  const boundFileRefs = buildFileRefsFromBindings(await resolveWorkflowSourceBindings(db, sources)).fileRefs;
  // Merge per source key instead of replacing `fileRefs` wholesale: callers that pass their bindings
  // through `runtimeParameters` (Monthly Update resolves the instance's saved sources to file keys
  // itself) must not have them wiped by a caller that passes none through `sources`.
  const resolvedRuntimeParameters: WorkflowRuntimeParameters = {
    ...(runtimeParameters ?? {}),
    fileRefs: {
      ...((runtimeParameters?.fileRefs as Record<string, unknown> | undefined) ?? {}),
      ...boundFileRefs,
    },
  };
  return resolveWorkflowRuntimeConfiguration({
    tasks: normalizeWorkflowTasks(parseJson<WorkflowTask[]>(workflow.tasks_json, [])),
    runtimeParamsSchema: parseJson(workflow.runtime_params_schema_json, {}),
    runtimeParamsDefaults: parseJson(workflow.runtime_params_defaults_json, {}),
    runtimeParameters: resolvedRuntimeParameters,
  });
}

export async function startWorkflowRun(params: {
  db: WorkflowBootstrapDb;
  runStore: WorkflowRunCreator;
  executor: WorkflowRunStarter;
  /** Definition row to run (already loaded, so callers can pin id/code/version). */
  workflow: Record<string, unknown>;
  /** Page-provided source bindings; resolved into `fileRefs`. */
  sources?: Record<string, WorkflowSourceBinding | undefined>;
  /** Extra runtime parameters (e.g. per-month fixed values) merged over the definition defaults. */
  runtimeParameters?: WorkflowRuntimeParameters;
}): Promise<WorkflowRunRecord> {
  const { db, runStore, executor, workflow, sources, runtimeParameters } = params;
  const plan = await resolveWorkflowRunPlan({ db, workflow, sources, runtimeParameters });
  const run = await runStore.createRun({
    workflow,
    tasks: plan.tasks,
    runtimeParameters: plan.runtimeParameters,
  });
  executor.startAsync(run.id);
  return run;
}

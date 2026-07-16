import type { WorkflowRunRecord, WorkflowTask } from '../../shared/types.js';
import { resolveWorkflowRuntimeConfiguration } from '../workflow/runtimeParameters.js';
import type { WorkflowRunCreateInput } from '../workflow/runRepository.js';
import {
  DATA_MANAGEMENT_WORKFLOW_CONFIGS,
  FIVE_PERCENT_HOLDER_GLOBAL_PARAMETER_KEYS,
  buildDataManagementWorkflowRuntimeParameters,
  type DataManagementPageKey,
  type DataManagementSourceBindings,
} from './workflowDefinitions.js';

type QueryDb = {
  queryOne(sql: string, params?: unknown[]): Promise<Record<string, unknown> | undefined>;
  query<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
};
type RunCreator = { createRun(input: WorkflowRunCreateInput): Promise<WorkflowRunRecord> };
type RunStarter = { startAsync(runId: number): void };

function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'object') return value as T;
  try { return JSON.parse(String(value)) as T; } catch { return fallback; }
}

async function loadFivePercentHolderRuntimeOverrides(db: QueryDb) {
  const keys = Object.values(FIVE_PERCENT_HOLDER_GLOBAL_PARAMETER_KEYS);
  const rows = await db.query<{ key: string; value: number; updated_by?: string | null }>(
    `select distinct on (key) key, value, updated_by
       from global_parameters
      where key = any($1)
      order by key, effective_from desc, updated_at desc, id desc`,
    [keys],
  );
  const fixedValues: Record<string, number> = {};
  for (const row of rows) {
    if (String(row.updated_by ?? '') === 'system') continue;
    const key = String(row.key);
    const value = Number(row.value);
    if (keys.includes(key as (typeof keys)[number]) && Number.isFinite(value)) fixedValues[key] = value;
  }
  const missingKeys = keys.filter((key) => !Number.isFinite(fixedValues[key]));
  if (missingKeys.length > 0) {
    throw new Error(`Missing 5% Holders fixed values: ${missingKeys.join(', ')}`);
  }
  return { fixedValues };
}

export async function startDataManagementWorkflow(
  db: QueryDb,
  runStore: RunCreator,
  executor: RunStarter,
  pageKey: DataManagementPageKey,
  sources: DataManagementSourceBindings,
): Promise<WorkflowRunRecord> {
  const config = DATA_MANAGEMENT_WORKFLOW_CONFIGS[pageKey];
  const workflow = await db.queryOne(
    "select * from workflow_definitions where code = $1 and status = 'active' limit 1",
    [config.workflowCode],
  );
  if (!workflow) throw new Error(`Data management workflow is not available: ${config.workflowCode}`);
  const runtimeOverrides = pageKey === 'five-percent-holders'
    ? await loadFivePercentHolderRuntimeOverrides(db)
    : {};
  const runtimeConfiguration = resolveWorkflowRuntimeConfiguration({
    tasks: parseJson<WorkflowTask[]>(workflow.tasks_json, []),
    runtimeParamsSchema: parseJson(workflow.runtime_params_schema_json, {}),
    runtimeParamsDefaults: parseJson(workflow.runtime_params_defaults_json, {}),
    runtimeParameters: buildDataManagementWorkflowRuntimeParameters(pageKey, sources, runtimeOverrides),
  });
  const run = await runStore.createRun({
    workflow, tasks: runtimeConfiguration.tasks, runtimeParameters: runtimeConfiguration.runtimeParameters,
  });
  executor.startAsync(run.id);
  return run;
}

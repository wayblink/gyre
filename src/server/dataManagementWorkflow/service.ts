import type { WorkflowRunRecord, WorkflowTask } from '../../shared/types.js';
import { resolveWorkflowRuntimeConfiguration } from '../workflow/runtimeParameters.js';
import type { WorkflowRunCreateInput } from '../workflow/runRepository.js';
import {
  DATA_MANAGEMENT_WORKFLOW_CONFIGS,
  buildDataManagementWorkflowRuntimeParameters,
  type DataManagementPageKey,
  type DataManagementSourceBindings,
} from './workflowDefinitions.js';

type QueryDb = { queryOne(sql: string, params?: unknown[]): Promise<Record<string, unknown> | undefined> };
type RunCreator = { createRun(input: WorkflowRunCreateInput): Promise<WorkflowRunRecord> };
type RunStarter = { startAsync(runId: number): void };

function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'object') return value as T;
  try { return JSON.parse(String(value)) as T; } catch { return fallback; }
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
  const runtimeConfiguration = resolveWorkflowRuntimeConfiguration({
    tasks: parseJson<WorkflowTask[]>(workflow.tasks_json, []),
    runtimeParamsSchema: parseJson(workflow.runtime_params_schema_json, {}),
    runtimeParamsDefaults: parseJson(workflow.runtime_params_defaults_json, {}),
    runtimeParameters: buildDataManagementWorkflowRuntimeParameters(pageKey, sources),
  });
  const run = await runStore.createRun({
    workflow, tasks: runtimeConfiguration.tasks, runtimeParameters: runtimeConfiguration.runtimeParameters,
  });
  executor.startAsync(run.id);
  return run;
}

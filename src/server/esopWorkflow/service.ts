import type { WorkflowRunRecord, WorkflowTask } from '../../shared/types.js';
import { resolveWorkflowRuntimeConfiguration } from '../workflow/runtimeParameters.js';
import type { WorkflowRunCreateInput } from '../workflow/runRepository.js';
import {
  ESOP_PAGE_WORKFLOW_CONFIGS,
  type EsopPageKey,
  type EsopWorkflowSourceBindings,
} from './workflowDefinitions.js';
import { buildFileRefsFromBindings } from '../workflow/fileSources.js';

type QueryDb = {
  queryOne(sql: string, params?: unknown[]): Promise<Record<string, unknown> | undefined>;
};

type RunCreator = {
  createRun(input: WorkflowRunCreateInput): Promise<WorkflowRunRecord>;
};

type RunStarter = {
  startAsync(runId: number): void;
};

function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'object') return value as T;
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return fallback;
  }
}

export async function startEsopPageWorkflow(
  db: QueryDb,
  runStore: RunCreator,
  executor: RunStarter,
  pageKey: EsopPageKey,
  sources: EsopWorkflowSourceBindings,
): Promise<WorkflowRunRecord> {
  const config = ESOP_PAGE_WORKFLOW_CONFIGS[pageKey];
  const workflow = await db.queryOne(
    'select * from workflow_definitions where code = $1 and status = \'active\' limit 1',
    [config.workflowCode],
  );
  if (!workflow) throw new Error(`ESOP workflow is not available: ${config.workflowCode}`);

  const resolvedSources: EsopWorkflowSourceBindings = {};
  for (const [sourceKey, source] of Object.entries(sources)) {
    const file = source?.fileId ? await db.queryOne('select logical_path from product_files where id = $1', [source.fileId]) : null;
    if (file?.logical_path) resolvedSources[sourceKey] = { fileKey: String(file.logical_path) };
  }
  const runtimeParameters = buildFileRefsFromBindings(resolvedSources);
  const runtimeConfiguration = resolveWorkflowRuntimeConfiguration({
    tasks: parseJson<WorkflowTask[]>(workflow.tasks_json, []),
    runtimeParamsSchema: parseJson(workflow.runtime_params_schema_json, {}),
    runtimeParamsDefaults: parseJson(workflow.runtime_params_defaults_json, {}),
    runtimeParameters,
  });
  const run = await runStore.createRun({
    workflow,
    tasks: runtimeConfiguration.tasks,
    runtimeParameters: runtimeConfiguration.runtimeParameters,
  });
  executor.startAsync(run.id);
  return run;
}

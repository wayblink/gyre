import type { WorkflowRunRecord } from '../../shared/types.js';
import {
  loadActiveWorkflowDefinition,
  startWorkflowRun,
  type WorkflowBootstrapDb,
  type WorkflowRunCreator,
  type WorkflowRunStarter,
  type WorkflowSourceBinding,
} from '../workflow/startWorkflowRun.js';
import {
  DATA_MANAGEMENT_WORKFLOW_CONFIGS,
  FIVE_PERCENT_HOLDER_GLOBAL_PARAMETER_KEYS,
  type DataManagementPageKey,
} from './workflowDefinitions.js';

export type DataManagementSourceBindings = Record<string, WorkflowSourceBinding | undefined>;

/**
 * 5% Holders reconciles against the four global fixed values, which are maintained per deployment.
 * System-generated rows are ignored so a stale automatic value can never satisfy the requirement.
 */
async function loadFivePercentHolderRuntimeOverrides(db: WorkflowBootstrapDb) {
  const keys = Object.values(FIVE_PERCENT_HOLDER_GLOBAL_PARAMETER_KEYS);
  const rows = await db.query(
    `select distinct on (key) key, value, updated_by
      from global_parameters
     where key = any($1)
      order by key, updated_at desc, id desc`,
    [keys],
  );
  const fixedValues: Record<string, number> = {};
  for (const row of rows) {
    if (String(row.updated_by ?? '') === 'system') continue;
    const key = String(row.key);
    const value = Number(row.value);
    // 0 is not a holder number, it is a baseline nobody filled in. Passing it through publishes
    // "Common Stock 0 / 0% of class" for a >5% holder with no warning, so treat it as missing.
    if (keys.includes(key as (typeof keys)[number]) && Number.isFinite(value) && value > 0) fixedValues[key] = value;
  }
  const missingKeys = keys.filter((key) => !Number.isFinite(fixedValues[key]));
  if (missingKeys.length > 0) {
    throw new Error(
      `Missing 5% Holders fixed values: ${missingKeys.join(', ')} (each must be a positive number; 0 counts as unset)`,
    );
  }
  return { fixedValues };
}

/**
 * Data-management pages (employee / plan-summary / 5%-holders) each map to one DB workflow
 * definition; the generic bootstrap resolves sources, runtime parameters and the run itself.
 */
export async function startDataManagementWorkflow(
  db: WorkflowBootstrapDb,
  runStore: WorkflowRunCreator,
  executor: WorkflowRunStarter,
  pageKey: DataManagementPageKey,
  sources: DataManagementSourceBindings,
): Promise<WorkflowRunRecord> {
  const config = DATA_MANAGEMENT_WORKFLOW_CONFIGS[pageKey];
  const workflow = await loadActiveWorkflowDefinition(db, config.workflowCode);
  if (!workflow) throw new Error(`Data management workflow is not available: ${config.workflowCode}`);
  const runtimeParameters = pageKey === 'five-percent-holders' ? await loadFivePercentHolderRuntimeOverrides(db) : {};
  return startWorkflowRun({ db, runStore, executor, workflow, sources, runtimeParameters });
}

import type { WorkflowRunRecord } from '../../shared/types.js';
import {
  loadActiveWorkflowDefinition,
  startWorkflowRun,
  type WorkflowRunCreator,
  type WorkflowRunStarter,
  type WorkflowBootstrapDb,
  type WorkflowSourceBinding,
} from '../workflow/startWorkflowRun.js';
import { ESOP_PAGE_WORKFLOW_CONFIGS, type EsopPageKey } from './workflowDefinitions.js';

export type EsopWorkflowSourceBindings = Record<string, WorkflowSourceBinding | undefined>;

/**
 * ESOP pages (grant/exercise/sold-shares/transfer-plan) each map to one DB workflow definition.
 * The generic bootstrap does the actual work; this only resolves the page's workflow code.
 */
export async function startEsopPageWorkflow(
  db: WorkflowBootstrapDb,
  runStore: WorkflowRunCreator,
  executor: WorkflowRunStarter,
  pageKey: EsopPageKey,
  sources: EsopWorkflowSourceBindings,
): Promise<WorkflowRunRecord> {
  const config = ESOP_PAGE_WORKFLOW_CONFIGS[pageKey];
  const workflow = await loadActiveWorkflowDefinition(db, config.workflowCode);
  if (!workflow) throw new Error(`ESOP workflow is not available: ${config.workflowCode}`);
  return startWorkflowRun({ db, runStore, executor, workflow, sources });
}

import type { WorkflowRunStatus } from './types.js';

const TERMINAL_WORKFLOW_RUN_STATUSES = new Set<WorkflowRunStatus>([
  'completed',
  'completed_with_warnings',
  'failed',
  'skipped',
]);

export function isWorkflowRunTerminalStatus(status: WorkflowRunStatus): boolean {
  return TERMINAL_WORKFLOW_RUN_STATUSES.has(status);
}

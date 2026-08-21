import type { WorkflowExecutionResult, WorkflowRunRecord } from '../../shared/types.js';
import { isWorkflowRunTerminalStatus } from '../../shared/workflowRunStatus.js';

export type WorkflowRunApi = <T>(url: string, options?: RequestInit) => Promise<T>;

export function createWorkflowRunClient(api: WorkflowRunApi) {
  const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

  async function getRun(runId: number, opts?: { light?: boolean }): Promise<WorkflowRunRecord> {
    return api<WorkflowRunRecord>(`/api/workflow-runs/${runId}${opts?.light ? '?light=1' : ''}`);
  }

  async function approveWarnings(
    runId: number,
    body: { taskIds?: string[]; taskId?: string; decision?: 'approved' | 'skipped' },
  ): Promise<WorkflowExecutionResult> {
    return api<WorkflowExecutionResult>(`/api/workflow-runs/${runId}/approvals`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async function pollUntilSettled(
    runId: number,
    options: {
      intervalMs?: number;
      minimumPollCount?: number;
      light?: boolean;
      onUpdate?: (run: WorkflowRunRecord) => void | Promise<void>;
    } = {},
  ): Promise<WorkflowRunRecord> {
    const intervalMs = options.intervalMs ?? 500;
    const minimumPollCount = options.minimumPollCount ?? 1;
    let pollCount = 0;

    for (;;) {
      await wait(intervalMs);
      pollCount += 1;
      const run = await getRun(runId, { light: options.light });
      await options.onUpdate?.(run);
      const hasRunningStep = run.steps.some((step) => step.status === 'running');
      const isSettled = isWorkflowRunTerminalStatus(run.status) || (run.status !== 'running' && !hasRunningStep);
      if (pollCount >= minimumPollCount && isSettled) return run;
    }
  }

  return {
    getRun,
    approveWarnings,
    pollUntilSettled,
  };
}

import type {
  WorkflowDataFrame,
  WorkflowExecutionResult,
  WorkflowExecutionTaskState,
  WorkflowRunRecord,
  WorkflowRunStatus,
  WorkflowTask,
  WorkflowTaskPreviewResult,
} from '../../shared/types.js';

export function resultToDataFrame(result: WorkflowTaskPreviewResult | null): WorkflowDataFrame | null {
  if (!result) return null;
  if (result.kind === 'dataframe' || result.kind === 'assert' || result.kind === 'file') return result.dataFrame;
  return null;
}

export function isApprovedWarning(run: WorkflowRunRecord, taskId: string): boolean {
  return run.approvedWarningTaskIds.includes(taskId);
}

export function isAssertOperatorCode(operatorCode: string): boolean {
  return (
    operatorCode === 'dataframe.assert' ||
    operatorCode === 'dataframe.sql.assert' ||
    operatorCode === 'dataframe.schema.assert' ||
    operatorCode === 'dataframe.shape.assert'
  );
}

export function isReusableStepOutput(step: WorkflowRunRecord['steps'][number] | null, task: WorkflowTask | null): boolean {
  if (!step) return false;
  if (!step.result) return false;
  if (step.status !== 'warning') return true;
  return step.result.kind !== 'assert' || Boolean(task && isAssertOperatorCode(task.operatorCode));
}

export function getRunStatusFromSteps(run: WorkflowRunRecord): WorkflowRunStatus {
  if (run.steps.some((step) => step.status === 'failed' || step.status === 'blocked')) return 'failed';
  if (run.approvals.some((approval) => approval.status === 'pending')) return 'waiting_approval';
  if (run.steps.some((step) => step.status === 'warning')) return 'completed_with_warnings';
  if (run.steps.every((step) => step.status === 'skipped')) return 'skipped';
  if (run.steps.every((step) => step.status === 'completed' || step.status === 'warning' || step.status === 'skipped')) return 'completed';
  return 'running';
}

export function hydrateRunOutputs(
  run: WorkflowRunRecord,
  taskMap: Map<string, WorkflowTask>,
): {
  executed: Map<string, WorkflowDataFrame>;
  taskResults: Map<string, WorkflowTaskPreviewResult>;
} {
  const executed = new Map<string, WorkflowDataFrame>();
  const taskResults = new Map<string, WorkflowTaskPreviewResult>();

  for (const step of run.steps) {
    const task = taskMap.get(step.taskId) ?? null;
    if ((step.status !== 'completed' && step.status !== 'warning') || !isReusableStepOutput(step, task)) continue;
    const result = step.result;
    if (!result) continue;
    const dataFrame = resultToDataFrame(result);
    if (!dataFrame) continue;
    if (step.status === 'warning' && !isApprovedWarning(run, step.taskId)) continue;
    executed.set(step.taskId, dataFrame);
    taskResults.set(step.taskId, result);
  }

  return { executed, taskResults };
}

export function getStepStates(run: WorkflowRunRecord): Record<string, WorkflowExecutionTaskState> {
  return Object.fromEntries(run.steps.map((step) => [step.taskId, step.status]));
}

export function workflowRunToExecutionResult(run: WorkflowRunRecord): WorkflowExecutionResult {
  const taskStates: Record<string, WorkflowExecutionTaskState> = {};
  const taskResults: Record<string, WorkflowTaskPreviewResult | null> = {};
  const taskTimings: WorkflowExecutionResult['taskTimings'] = {};
  const taskErrors: WorkflowExecutionResult['taskErrors'] = {};
  let result: WorkflowTaskPreviewResult | null = null;
  let failedTaskId: string | null = null;

  for (const step of run.steps) {
    taskStates[step.taskId] = step.status;
    taskResults[step.taskId] = step.result;
    taskErrors[step.taskId] = step.errorMessage;
    if (step.startedAt && step.finishedAt && step.durationMs !== null) {
      taskTimings[step.taskId] = {
        startedAt: step.startedAt,
        finishedAt: step.finishedAt,
        durationMs: step.durationMs,
      };
    }
    if (step.result) result = step.result;
    if (!failedTaskId && step.status === 'failed') failedTaskId = step.taskId;
  }

  const warnings = run.steps
    .filter((step) => step.status === 'warning')
    .map((step) => {
      const approval = run.approvals.find((item) => item.taskId === step.taskId);
      const message =
        step.result?.kind === 'assert'
          ? step.result.assertion.failureMessage
          : step.errorMessage ?? approval?.comment ?? `${step.taskName} completed with warning`;
      return {
        taskId: step.taskId,
        message,
        approved: approval?.status === 'approved' || run.approvedWarningTaskIds.includes(step.taskId),
      };
    });

  return {
    run,
    result,
    taskStates,
    taskResults,
    taskTimings,
    taskErrors,
    failedTaskId,
    blockedTaskIds: run.steps.filter((step) => step.status === 'blocked').map((step) => step.taskId),
    warningTaskIds: run.steps.filter((step) => step.status === 'warning').map((step) => step.taskId),
    waitingForApprovalTaskIds: run.approvals.filter((approval) => approval.status === 'pending').map((approval) => approval.taskId),
    warnings,
    errorMessage: run.errorMessage,
  };
}

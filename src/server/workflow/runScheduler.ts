import type {
  WorkflowExecutionTaskState,
  WorkflowRunRecord,
  WorkflowRunStatus,
  WorkflowTask,
} from '../../shared/types.js';
import { getWorkflowDependencyIds, getWorkflowExecutionOrder } from './engine.js';
import type { WorkflowOperatorRuntime } from './operators/types.js';
import type { WorkflowRunMode } from './runDispatcher.js';
import type { WorkflowRunRepository } from './runRepository.js';
import {
  getRunStatusFromSteps,
  getStepStates,
  hydrateRunOutputs,
  isApprovedWarning,
  isReusableStepOutput,
  workflowRunToExecutionResult,
} from './runResult.js';
import { WorkflowStepWorker } from './runWorker.js';

const WORKFLOW_STEP_LOCK_TIMEOUT_MS = 10 * 60 * 1_000;

export type WorkflowRunFinalizedHook = (run: WorkflowRunRecord) => Promise<void> | void;

export type WorkflowRunSchedulerOptions = {
  onRunFinalized?: WorkflowRunFinalizedHook;
};

type TaskReadiness =
  { kind: 'ready' } | { kind: 'blocked' } | { kind: 'waiting' } | { kind: 'missing_output'; dependencyId: string };

export class WorkflowRunScheduler {
  private readonly worker: WorkflowStepWorker;

  constructor(
    private readonly store: WorkflowRunRepository,
    runtime: WorkflowOperatorRuntime,
    private readonly options: WorkflowRunSchedulerOptions = {},
  ) {
    this.worker = new WorkflowStepWorker(store, runtime);
  }

  async execute(runId: number, mode: WorkflowRunMode): Promise<void> {
    try {
      await this.releaseExpiredLocks(runId);
      if ((await this.store.getRun(runId)).status === 'skipped' && mode.kind !== 'retry_unfinished') return;
      await this.store.updateRunStatus({ runId, status: 'running', errorMessage: null });
      await this.executeRunnableSteps(runId, mode);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Workflow execution failed';
      await this.store.updateRunStatus({ runId, status: 'failed', errorMessage: message, finish: true });
      await this.store.createRunFinishedEvent(runId, 'failed', { errorMessage: message });
      await this.notifyRunFinalized(runId);
    }
  }

  private async releaseExpiredLocks(runId: number): Promise<void> {
    const releasedCount = await this.store.releaseExpiredStepLocks(WORKFLOW_STEP_LOCK_TIMEOUT_MS, runId);
    if (!releasedCount) return;
    await this.store.createEvent({
      runId,
      eventType: 'expired_step_locks_released',
      level: 'warning',
      message: `${releasedCount} expired workflow step lock${releasedCount === 1 ? '' : 's'} released`,
      payload: { releasedCount, timeoutMs: WORKFLOW_STEP_LOCK_TIMEOUT_MS },
    });
  }

  async skipDownstream(runId: number, rootTaskIds: string[]): Promise<void> {
    const run = await this.store.getRun(runId);
    const tasks = run.tasksSnapshot;
    const downstream = new Set<string>();
    const queue = [...rootTaskIds];
    while (queue.length) {
      const current = queue.shift();
      if (!current) continue;
      for (const task of tasks) {
        if (!getWorkflowDependencyIds(task).includes(current) || downstream.has(task.id)) continue;
        downstream.add(task.id);
        queue.push(task.id);
      }
    }
    for (const taskId of downstream) {
      const task = tasks.find((item) => item.id === taskId);
      if (!task) continue;
      await this.store.markStepFinished({
        runId,
        task,
        status: 'skipped',
        errorMessage: `${task.name} skipped after checkpoint decision`,
      });
    }
    const latestRun = await this.store.getRun(runId);
    const result = workflowRunToExecutionResult(latestRun);
    await this.store.updateRunStatus({ runId, status: 'skipped', result, finish: true });
    await this.store.createRunFinishedEvent(runId, 'skipped', { skippedAfter: rootTaskIds });
    await this.notifyRunFinalized(runId);
  }

  async cancelRun(runId: number): Promise<void> {
    const run = await this.store.getRun(runId);
    const preservedStatuses = new Set<WorkflowExecutionTaskState>([
      'completed',
      'running',
      'failed',
      'warning',
      'skipped',
    ]);
    for (const task of run.tasksSnapshot) {
      const step = run.steps.find((item) => item.taskId === task.id);
      if (step && preservedStatuses.has(step.status)) continue;
      await this.store.markStepFinished({
        runId,
        task,
        status: 'skipped',
        errorMessage: `${task.name} cancelled by user`,
      });
    }
    const latestRun = await this.store.getRun(runId);
    const result = workflowRunToExecutionResult(latestRun);
    await this.store.updateRunStatus({ runId, status: 'skipped', result, errorMessage: null, finish: true });
    await this.store.createRunFinishedEvent(runId, 'skipped', { cancelled: true });
    await this.notifyRunFinalized(runId);
  }

  private async executeRunnableSteps(runId: number, mode: WorkflowRunMode): Promise<void> {
    let run = await this.store.getRun(runId);
    const orderedTasks = getWorkflowExecutionOrder(run.tasksSnapshot);
    const taskMap = new Map(orderedTasks.map((task) => [task.id, task]));
    let { executed, taskResults } = hydrateRunOutputs(run, taskMap);
    let stepStates: Record<string, WorkflowExecutionTaskState> = getStepStates(run);

    for (const task of orderedTasks) {
      if (mode.kind === 'single' && task.id !== mode.taskId) continue;

      run = await this.store.getRun(runId);
      if (run.status === 'skipped' && mode.kind !== 'retry_unfinished') return;
      ({ executed, taskResults } = hydrateRunOutputs(run, taskMap));
      stepStates = getStepStates(run);
      if (run.approvals.some((approval) => approval.status === 'pending')) {
        // Conditional: the approval may have been decided between that read and this write. If it
        // was, keep executing instead of parking a run nobody could ever resume.
        if (await this.store.parkRunForApproval(runId)) return;
        continue;
      }

      const currentState = stepStates[task.id] ?? 'pending';
      const currentStep = run.steps.find((step) => step.taskId === task.id) ?? null;
      const isRetryTarget = mode.kind === 'retry_unfinished' || (mode.kind === 'single' && task.id === mode.taskId);
      if (currentState === 'completed') continue;
      if (currentState === 'running') continue;
      if (currentState === 'warning' && isApprovedWarning(run, task.id) && isReusableStepOutput(currentStep, task))
        continue;
      if ((currentState === 'failed' || currentState === 'skipped') && !isRetryTarget) continue;

      const readiness = await this.resolveTaskReadiness(runId, task, run, stepStates, executed);
      if (readiness.kind === 'blocked') continue;
      if (readiness.kind === 'waiting') continue;
      if (readiness.kind === 'missing_output') {
        await this.failMissingPersistedOutput(runId, task, readiness.dependencyId);
        stepStates[task.id] = 'failed';
        continue;
      }

      const claim = await this.store.claimStep(runId, task);
      if (!claim) {
        await this.store.createEvent({
          runId,
          taskId: task.id,
          eventType: 'task_claim_skipped',
          level: 'info',
          message: `${task.name} was already claimed or no longer runnable`,
          payload: { reason: 'not claimable' },
        });
        continue;
      }

      const outcome = await this.worker.executeClaimedStep({
        runId,
        task,
        claim,
        run,
        executed,
        taskResults,
        taskMap,
      });
      stepStates[task.id] = outcome.state;
      if (outcome.paused) return;
    }

    await this.finalizeRun(runId, mode);
  }

  private async resolveTaskReadiness(
    runId: number,
    task: WorkflowTask,
    run: WorkflowRunRecord,
    stepStates: Record<string, WorkflowExecutionTaskState>,
    executed: Map<string, unknown>,
  ): Promise<TaskReadiness> {
    const dependencyIds = getWorkflowDependencyIds(task);
    const unapprovedWarningDependency = dependencyIds.find(
      (dependencyId) => stepStates[dependencyId] === 'warning' && !isApprovedWarning(run, dependencyId),
    );
    const terminalDependency = dependencyIds.find((dependencyId) => {
      const state = stepStates[dependencyId];
      return state === 'failed' || state === 'blocked' || state === 'skipped';
    });
    const pendingDependency = dependencyIds.find((dependencyId) => {
      const state = stepStates[dependencyId];
      if (!state || state === 'pending' || state === 'running') return true;
      return state !== 'completed' && !(state === 'warning' && isApprovedWarning(run, dependencyId));
    });
    const missingPersistedOutputDependency = dependencyIds.find((dependencyId) => {
      const state = stepStates[dependencyId];
      const shouldHaveOutput = state === 'completed' || (state === 'warning' && isApprovedWarning(run, dependencyId));
      return shouldHaveOutput && !executed.has(dependencyId);
    });

    if (terminalDependency || unapprovedWarningDependency) {
      const message = terminalDependency
        ? `${task.name} blocked by dependency ${terminalDependency}`
        : `${task.name} blocked by warning checkpoint ${unapprovedWarningDependency}`;
      await this.store.markStepFinished({
        runId,
        task,
        status: 'blocked',
        errorMessage: message,
      });
      return { kind: 'blocked' };
    }

    if (pendingDependency) {
      await this.store.createEvent({
        runId,
        taskId: task.id,
        eventType: 'task_waiting_dependency',
        level: 'info',
        message: `${task.name} is waiting for dependency ${pendingDependency}`,
        payload: { dependencyId: pendingDependency },
      });
      return { kind: 'waiting' };
    }

    return missingPersistedOutputDependency
      ? { kind: 'missing_output', dependencyId: missingPersistedOutputDependency }
      : { kind: 'ready' };
  }

  private async failMissingPersistedOutput(runId: number, task: WorkflowTask, dependencyId: string): Promise<void> {
    const claim = await this.store.claimStep(runId, task);
    if (!claim) return;
    await this.store.finishClaimedStep({
      runId,
      task,
      stepId: claim.step.id,
      lockToken: claim.lockToken,
      status: 'failed',
      errorMessage: `${task.name} dependency ${dependencyId} has no persisted output`,
      startedAt: claim.step.startedAt,
    });
  }

  private async finalizeRun(runId: number, mode: WorkflowRunMode): Promise<void> {
    // Parking is re-checked against the database rather than trusted from the read above: a human can
    // approve while the run is being finalised, and parking then strands it (no pending approval, no
    // queued execution). Recomputing picks up the decided state instead.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const latestRun = await this.store.getRun(runId);
      const status = mode.kind === 'single' ? getRunStatusFromSteps(latestRun) : this.getTerminalRunStatus(latestRun);
      const result = workflowRunToExecutionResult(latestRun);
      if (status === 'waiting_approval' && !(await this.store.parkRunForApproval(runId))) continue;

      const shouldFinish = mode.kind !== 'single' && status !== 'running' && status !== 'waiting_approval';
      if (status !== 'waiting_approval') {
        await this.store.updateRunStatus({
          runId,
          status,
          result,
          errorMessage: result.errorMessage,
          finish: shouldFinish,
        });
      }
      if (shouldFinish || status === 'waiting_approval') {
        await this.store.createRunFinishedEvent(runId, status, {
          failedTaskId: result.failedTaskId,
          waitingForApprovalTaskIds: result.waitingForApprovalTaskIds,
          warningTaskIds: result.warningTaskIds,
          errorMessage: result.errorMessage,
        });
      }
      if (shouldFinish) {
        await this.notifyRunFinalized(runId);
      }
      return;
    }
  }

  private async notifyRunFinalized(runId: number): Promise<void> {
    if (!this.options.onRunFinalized) return;
    const run = await this.store.getRun(runId);
    await this.options.onRunFinalized(run);
  }

  private getTerminalRunStatus(run: WorkflowRunRecord): WorkflowRunStatus {
    const waiting = run.approvals.some((approval) => approval.status === 'pending');
    if (waiting) return 'waiting_approval';
    const failed = run.steps.some((step) => step.status === 'failed');
    if (failed) return 'failed';
    const blocked = run.steps.some((step) => step.status === 'blocked');
    if (blocked) return 'failed';
    const unfinished = run.steps.some((step) => step.status === 'pending' || step.status === 'running');
    if (unfinished) return 'running';
    const warnings = run.steps.some((step) => step.status === 'warning');
    if (warnings) return 'completed_with_warnings';
    return 'completed';
  }
}

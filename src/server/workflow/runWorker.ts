import type {
  WorkflowDataFrame,
  WorkflowExecutionTaskState,
  WorkflowRunRecord,
  WorkflowTask,
  WorkflowTaskPreviewResult,
} from '../../shared/types.js';
import { evaluateTaskInputGuards, executeWorkflowTaskOutputStrict } from './engine.js';
import type { WorkflowOperatorRuntime } from './operators/types.js';
import type { WorkflowRunRepository, WorkflowRunStepClaim } from './runRepository.js';
import { isApprovedWarning, isAssertOperatorCode, workflowRunToExecutionResult } from './runResult.js';

const WORKFLOW_STEP_HEARTBEAT_MS = 5_000;

export type WorkflowStepWorkerInput = {
  runId: number;
  task: WorkflowTask;
  claim: WorkflowRunStepClaim;
  run: WorkflowRunRecord;
  executed: Map<string, WorkflowDataFrame>;
  taskResults: Map<string, WorkflowTaskPreviewResult>;
  taskMap: Map<string, WorkflowTask>;
};

export type WorkflowStepWorkerOutcome = {
  state: WorkflowExecutionTaskState;
  paused: boolean;
};

export class WorkflowStepWorker {
  constructor(
    private readonly store: WorkflowRunRepository,
    private readonly runtime: WorkflowOperatorRuntime,
  ) {}

  async executeClaimedStep(input: WorkflowStepWorkerInput): Promise<WorkflowStepWorkerOutcome> {
    return this.runWithHeartbeat(input, () => this.executeClaimedStepInner(input));
  }

  private async executeClaimedStepInner(input: WorkflowStepWorkerInput): Promise<WorkflowStepWorkerOutcome> {
    const { runId, task, claim, run, executed, taskResults, taskMap } = input;
    const startedAt = claim.step.startedAt;

    try {
      const guardResult = await this.evaluateInputGuards(
        runId,
        task,
        claim,
        executed,
        taskResults,
        taskMap,
        run,
        startedAt,
      );
      if (guardResult === 'paused' || guardResult === 'failed') {
        return { state: guardResult === 'paused' ? 'warning' : 'failed', paused: guardResult === 'paused' };
      }

      const taskOutput = await executeWorkflowTaskOutputStrict(task, executed, taskResults, taskMap, this.runtime, {
        runtimeParameters: run.runtimeParameters,
        invocationStack: [run.workflowCode, `id:${run.workflowId}`],
      });
      let nextState: WorkflowExecutionTaskState = 'completed';
      let errorMessage: string | null = null;

      if (taskOutput.result.kind === 'assert' && !taskOutput.result.assertion.passed) {
        if (taskOutput.result.assertion.failureStrategy === 'block') {
          nextState = 'failed';
          errorMessage = taskOutput.result.assertion.failureMessage;
        } else if (taskOutput.result.assertion.failureStrategy === 'warning') {
          nextState = 'warning';
          errorMessage = taskOutput.result.assertion.failureMessage;
          if (!isApprovedWarning(run, task.id)) {
            await this.store.finishClaimedStep({
              runId,
              task,
              stepId: claim.step.id,
              lockToken: claim.lockToken,
              status: 'warning',
              result: taskOutput.result,
              errorMessage,
              startedAt,
            });
            await this.store.requestApproval(runId, task, errorMessage);
            await this.store.updateRunStatus({
              runId,
              status: 'waiting_approval',
              result: workflowRunToExecutionResult(await this.store.getRun(runId)),
              errorMessage: null,
            });
            await this.store.createRunFinishedEvent(runId, 'waiting_approval', {
              waitingForApprovalTaskIds: [task.id],
            });
            return { state: 'warning', paused: true };
          }
        }
      }

      await this.store.finishClaimedStep({
        runId,
        task,
        stepId: claim.step.id,
        lockToken: claim.lockToken,
        status: nextState,
        result: taskOutput.result,
        errorMessage,
        startedAt,
      });
      return { state: nextState, paused: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Workflow task failed';
      await this.store.finishClaimedStep({
        runId,
        task,
        stepId: claim.step.id,
        lockToken: claim.lockToken,
        status: 'failed',
        errorMessage: message,
        startedAt,
      });
      return { state: 'failed', paused: false };
    }
  }

  private async evaluateInputGuards(
    runId: number,
    task: WorkflowTask,
    claim: WorkflowRunStepClaim,
    executed: Map<string, WorkflowDataFrame>,
    taskResults: Map<string, WorkflowTaskPreviewResult>,
    taskMap: Map<string, WorkflowTask>,
    run: WorkflowRunRecord,
    startedAt: string | null,
  ): Promise<'passed' | 'paused' | 'failed'> {
    const guardResults = await evaluateTaskInputGuards(task, executed, taskResults, taskMap, this.runtime);
    const failedGuard = guardResults.find(
      (result) => !result.assertion.passed && result.assertion.failureStrategy === 'block',
    );
    if (failedGuard) {
      const result: WorkflowTaskPreviewResult = {
        kind: 'assert',
        assertion: failedGuard.assertion,
        dataFrame: failedGuard.dataFrame,
      };
      await this.store.finishClaimedStep({
        runId,
        task,
        stepId: claim.step.id,
        lockToken: claim.lockToken,
        status: 'failed',
        result,
        errorMessage: failedGuard.assertion.failureMessage,
        startedAt,
      });
      return 'failed';
    }

    const warningGuard = guardResults.find(
      (result) => !result.assertion.passed && result.assertion.failureStrategy === 'warning',
    );
    if (warningGuard && !isApprovedWarning(run, task.id)) {
      const result: WorkflowTaskPreviewResult = {
        kind: 'assert',
        assertion: warningGuard.assertion,
        dataFrame: warningGuard.dataFrame,
      };
      await this.store.finishClaimedStep({
        runId,
        task,
        stepId: claim.step.id,
        lockToken: claim.lockToken,
        status: 'warning',
        result,
        errorMessage: warningGuard.assertion.failureMessage,
        startedAt,
      });
      await this.store.requestApproval(runId, task, warningGuard.assertion.failureMessage);
      await this.store.updateRunStatus({
        runId,
        status: 'waiting_approval',
        result: workflowRunToExecutionResult(await this.store.getRun(runId)),
        errorMessage: null,
      });
      await this.store.createRunFinishedEvent(runId, 'waiting_approval', { waitingForApprovalTaskIds: [task.id] });
      return 'paused';
    }

    if (isApprovedWarning(run, task.id)) {
      const existingStep = run.steps.find((step) => step.taskId === task.id);
      if (existingStep?.result?.kind === 'assert' && isAssertOperatorCode(task.operatorCode)) {
        taskResults.set(task.id, existingStep.result);
        executed.set(task.id, existingStep.result.dataFrame);
      }
    }

    return 'passed';
  }

  private async runWithHeartbeat<T>(input: WorkflowStepWorkerInput, fn: () => Promise<T>): Promise<T> {
    const { runId, task, claim } = input;
    const timer = setInterval(() => {
      void this.store.heartbeatStep(claim.step.id, claim.lockToken).catch((error) => {
        void this.store.createEvent({
          runId,
          stepId: claim.step.id,
          taskId: task.id,
          eventType: 'task_heartbeat_failed',
          level: 'warning',
          message: error instanceof Error ? error.message : `${task.name} heartbeat failed`,
          payload: { taskName: task.name, operatorCode: task.operatorCode },
        });
      });
    }, WORKFLOW_STEP_HEARTBEAT_MS);
    if (typeof timer === 'object' && 'unref' in timer) timer.unref();
    try {
      return await fn();
    } finally {
      clearInterval(timer);
    }
  }
}

import type { WorkflowRunRecord } from '../../shared/types.js';
import type { WorkflowOperatorRuntime } from './operators/types.js';
import { InProcessWorkflowRunDispatcher, type WorkflowRunDispatcher } from './runDispatcher.js';
import type { WorkflowRunRepository } from './runRepository.js';
import { WorkflowRunScheduler } from './runScheduler.js';
import type { WorkflowRunSchedulerOptions } from './runScheduler.js';

export class WorkflowRunExecutor {
  private readonly scheduler: WorkflowRunScheduler;
  private readonly dispatcher: WorkflowRunDispatcher;

  constructor(
    private readonly store: WorkflowRunRepository,
    runtime: WorkflowOperatorRuntime,
    dispatcher?: WorkflowRunDispatcher,
    schedulerOptions?: WorkflowRunSchedulerOptions,
  ) {
    this.scheduler = new WorkflowRunScheduler(store, runtime, schedulerOptions);
    this.dispatcher = dispatcher ?? new InProcessWorkflowRunDispatcher((runId, mode) => this.scheduler.execute(runId, mode));
  }

  startAsync(runId: number): void {
    this.dispatcher.enqueue(runId, { kind: 'all' });
  }

  async startSingleStepAsync(runId: number, taskId: string, tasks?: WorkflowRunRecord['tasksSnapshot']): Promise<void> {
    if (tasks) {
      await this.store.updateRunTasksSnapshot(runId, tasks);
    }
    const run = await this.store.getRun(runId);
    if (!run.tasksSnapshot.some((task) => task.id === taskId)) {
      throw new Error(`Workflow run ${runId} does not contain task ${taskId}`);
    }
    await this.store.updateRunStatus({ runId, status: 'running', errorMessage: null });
    this.dispatcher.enqueue(runId, { kind: 'single', taskId });
  }

  async retryUnfinishedAsync(runId: number, tasks?: WorkflowRunRecord['tasksSnapshot']): Promise<void> {
    if (tasks) {
      await this.store.updateRunTasksSnapshot(runId, tasks);
    }
    await this.store.updateRunStatus({ runId, status: 'running', errorMessage: null });
    this.dispatcher.enqueue(runId, { kind: 'retry_unfinished' });
  }

  async cancelRun(runId: number): Promise<WorkflowRunRecord> {
    await this.scheduler.cancelRun(runId);
    return this.store.getRun(runId);
  }

  async continueAfterApproval(runId: number, taskIds: string[], decision: 'approved' | 'skipped' = 'approved'): Promise<WorkflowRunRecord> {
    for (const taskId of taskIds) {
      await this.store.approveWarning(runId, taskId, decision);
    }
    if (decision === 'approved') {
      await this.store.updateRunStatus({ runId, status: 'running', errorMessage: null });
      this.startAsync(runId);
    } else {
      await this.scheduler.skipDownstream(runId, taskIds);
    }
    return this.store.getRun(runId);
  }
}

export type WorkflowRunMode =
  | { kind: 'all' }
  | { kind: 'single'; taskId: string };

export interface WorkflowRunDispatcher {
  enqueue(runId: number, mode: WorkflowRunMode): void;
}

export class InProcessWorkflowRunDispatcher implements WorkflowRunDispatcher {
  private readonly activeRunIds = new Set<number>();

  constructor(private readonly execute: (runId: number, mode: WorkflowRunMode) => Promise<void>) {}

  enqueue(runId: number, mode: WorkflowRunMode): void {
    if (this.activeRunIds.has(runId)) return;
    this.activeRunIds.add(runId);
    setTimeout(() => {
      void this.execute(runId, mode).finally(() => {
        this.activeRunIds.delete(runId);
      });
    }, 0);
  }
}

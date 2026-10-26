export type WorkflowRunMode = { kind: 'all' } | { kind: 'single'; taskId: string } | { kind: 'retry_unfinished' };

export interface WorkflowRunDispatcher {
  enqueue(runId: number, mode: WorkflowRunMode): void;
}

export class InProcessWorkflowRunDispatcher implements WorkflowRunDispatcher {
  private readonly activeRunIds = new Set<number>();
  /** Work requested for a run that was already executing; replayed when that pass finishes. */
  private readonly requeued = new Map<number, WorkflowRunMode>();

  constructor(private readonly execute: (runId: number, mode: WorkflowRunMode) => Promise<void>) {}

  enqueue(runId: number, mode: WorkflowRunMode): void {
    if (this.activeRunIds.has(runId)) {
      // Dropping this used to lose a human decision: the running pass was planned before the approval
      // existed, so the run parked itself with no pending approval and nothing left to execute it.
      // Keep the request instead and replay it as soon as the current pass ends.
      this.requeued.set(runId, mergeModes(this.requeued.get(runId), mode));
      return;
    }
    this.dispatch(runId, mode);
  }

  private dispatch(runId: number, mode: WorkflowRunMode): void {
    this.activeRunIds.add(runId);
    setTimeout(() => {
      void this.execute(runId, mode).finally(() => {
        this.activeRunIds.delete(runId);
        const next = this.requeued.get(runId);
        if (!next) return;
        this.requeued.delete(runId);
        this.dispatch(runId, next);
      });
    }, 0);
  }
}

/** A queued full pass subsumes a narrower one: re-running everything already covers the extra step. */
function mergeModes(queued: WorkflowRunMode | undefined, next: WorkflowRunMode): WorkflowRunMode {
  if (!queued) return next;
  if (queued.kind === 'all' || next.kind === 'all') return { kind: 'all' };
  return next;
}

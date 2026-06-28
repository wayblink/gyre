import type {
  WorkflowExecutionTaskState,
  WorkflowRunEventRecord,
  WorkflowRunRecord,
  WorkflowRunStatus,
  WorkflowRunStepRecord,
  WorkflowRuntimeParameters,
  WorkflowTask,
  WorkflowTaskPreviewResult,
} from '../../shared/types.js';

export type WorkflowRunCreateInput = {
  workflow: Record<string, unknown>;
  tasks: WorkflowTask[];
  runtimeParameters: WorkflowRuntimeParameters;
};

export type WorkflowRunEventInput = {
  runId: number;
  stepId?: number | null;
  taskId?: string | null;
  eventType: string;
  level?: WorkflowRunEventRecord['level'];
  message?: string;
  payload?: Record<string, unknown>;
  createdAt?: string;
};

export type WorkflowRunStepFinishInput = {
  runId: number;
  task: WorkflowTask;
  status: WorkflowExecutionTaskState;
  result?: WorkflowTaskPreviewResult | null;
  errorMessage?: string | null;
  startedAt?: string | null;
};

export type WorkflowRunClaimedStepFinishInput = WorkflowRunStepFinishInput & {
  stepId: number;
  lockToken: string;
};

export type WorkflowRunStepClaim = {
  step: WorkflowRunStepRecord;
  lockToken: string;
};

export type WorkflowRunStatusUpdateInput = {
  runId: number;
  status: WorkflowRunStatus;
  result?: unknown;
  errorMessage?: string | null;
  finish?: boolean;
};

export interface WorkflowRunRepository {
  createRun(params: WorkflowRunCreateInput): Promise<WorkflowRunRecord>;
  getRun(runId: number): Promise<WorkflowRunRecord>;
  createEvent(params: WorkflowRunEventInput): Promise<void>;
  // Claim/finish are the worker ownership boundary. A distributed worker must
  // finish with the same lock token it claimed, regardless of persistence backend.
  claimStep(runId: number, task: WorkflowTask): Promise<WorkflowRunStepClaim | null>;
  heartbeatStep(stepId: number, lockToken: string): Promise<boolean>;
  releaseExpiredStepLocks(timeoutMs: number, runId?: number): Promise<number>;
  finishClaimedStep(params: WorkflowRunClaimedStepFinishInput): Promise<WorkflowRunStepRecord>;
  markStepFinished(params: WorkflowRunStepFinishInput): Promise<WorkflowRunStepRecord>;
  requestApproval(runId: number, task: WorkflowTask, message: string): Promise<void>;
  approveWarning(runId: number, taskId: string, decision?: 'approved' | 'skipped'): Promise<void>;
  updateRunStatus(params: WorkflowRunStatusUpdateInput): Promise<void>;
  createRunFinishedEvent(runId: number, status: WorkflowRunStatus, payload?: Record<string, unknown>): Promise<void>;
}

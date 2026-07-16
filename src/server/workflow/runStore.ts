import type { AppDb } from '../db.js';
import { normalizeWorkflowRuntimeParameters } from './runtimeParameters.js';
import type {
  WorkflowExecutionTaskState,
  WorkflowRunApprovalRecord,
  WorkflowRunArtifactRecord,
  WorkflowRunEventRecord,
  WorkflowRunRecord,
  WorkflowRunStatus,
  WorkflowRunStepRecord,
  WorkflowRuntimeParameters,
  WorkflowTask,
  WorkflowTaskPreviewResult,
} from '../../shared/types.js';
import type {
  WorkflowRunClaimedStepFinishInput,
  WorkflowRunCreateInput,
  WorkflowRunEventInput,
  WorkflowRunRepository,
  WorkflowRunStepClaim,
  WorkflowRunStatusUpdateInput,
  WorkflowRunStepFinishInput,
} from './runRepository.js';

function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'object') return value as T;
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return fallback;
  }
}

function toIsoTimestamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
  }
  return new Date(String(value)).toISOString();
}

function toNullableIsoTimestamp(value: unknown): string | null {
  return value === null || value === undefined ? null : toIsoTimestamp(value);
}

function taskStateForEvent(status: WorkflowExecutionTaskState) {
  if (status === 'completed') return 'task_completed';
  if (status === 'failed') return 'task_failed';
  if (status === 'warning') return 'warning_raised';
  if (status === 'blocked') return 'task_blocked';
  if (status === 'skipped') return 'task_skipped';
  return `task_${status}`;
}

function toWorkflowRunStepRecord(row: Record<string, unknown>): WorkflowRunStepRecord {
  return {
    id: Number(row.id),
    runId: Number(row.run_id),
    taskId: String(row.task_id),
    taskName: String(row.task_name),
    operatorCode: String(row.operator_code),
    status: String(row.status) as WorkflowRunStepRecord['status'],
    lockToken: row.lock_token ? String(row.lock_token) : null,
    lockedAt: toNullableIsoTimestamp(row.locked_at),
    attemptCount: Number(row.attempt_count ?? 0),
    startedAt: toNullableIsoTimestamp(row.started_at),
    finishedAt: toNullableIsoTimestamp(row.finished_at),
    durationMs: row.duration_ms === null || row.duration_ms === undefined ? null : Number(row.duration_ms),
    errorMessage: row.error_message ? String(row.error_message) : null,
    result: parseJson<WorkflowTaskPreviewResult | null>(row.result_json, null),
  };
}

function toWorkflowRunArtifactRecord(row: Record<string, unknown>): WorkflowRunArtifactRecord {
  return {
    id: Number(row.id),
    runId: Number(row.run_id),
    stepId: row.step_id === null || row.step_id === undefined ? null : Number(row.step_id),
    taskId: row.task_id ? String(row.task_id) : null,
    artifactType: String(row.artifact_type) as WorkflowRunArtifactRecord['artifactType'],
    fileId: row.file_id === null || row.file_id === undefined ? null : Number(row.file_id),
    name: String(row.name ?? ''),
    metadata: parseJson<Record<string, unknown>>(row.metadata_json, {}),
    createdAt: toIsoTimestamp(row.created_at),
  };
}

function toWorkflowRunEventRecord(row: Record<string, unknown>): WorkflowRunEventRecord {
  return {
    id: Number(row.id),
    runId: Number(row.run_id),
    stepId: row.step_id === null || row.step_id === undefined ? null : Number(row.step_id),
    taskId: row.task_id ? String(row.task_id) : null,
    eventType: String(row.event_type),
    level: String(row.level ?? 'info') as WorkflowRunEventRecord['level'],
    message: String(row.message ?? ''),
    payload: parseJson<Record<string, unknown>>(row.payload_json, {}),
    createdAt: toIsoTimestamp(row.created_at),
  };
}

function toWorkflowRunApprovalRecord(row: Record<string, unknown>): WorkflowRunApprovalRecord {
  return {
    id: Number(row.id),
    runId: Number(row.run_id),
    taskId: String(row.task_id),
    approvalKey: String(row.approval_key),
    status: String(row.status ?? 'pending') as WorkflowRunApprovalRecord['status'],
    decision: row.decision ? String(row.decision) : null,
    decidedBy: row.decided_by ? String(row.decided_by) : null,
    comment: row.comment ? String(row.comment) : null,
    createdAt: toIsoTimestamp(row.created_at),
    decidedAt: toNullableIsoTimestamp(row.decided_at),
  };
}

function toWorkflowRunRecord(
  row: Record<string, unknown>,
  steps: WorkflowRunStepRecord[],
  artifacts: WorkflowRunArtifactRecord[],
  events: WorkflowRunEventRecord[],
  approvals: WorkflowRunApprovalRecord[],
): WorkflowRunRecord {
  return {
    id: Number(row.id),
    workflowId: Number(row.workflow_id),
    workflowCode: String(row.workflow_code ?? ''),
    workflowName: String(row.workflow_name ?? ''),
    status: String(row.status) as WorkflowRunStatus,
    runtimeParameters: normalizeWorkflowRuntimeParameters(parseJson(row.runtime_parameters_json, {})),
    tasksSnapshot: parseJson<WorkflowTask[]>(row.tasks_snapshot_json, []),
    startedAt: toIsoTimestamp(row.started_at),
    finishedAt: toNullableIsoTimestamp(row.finished_at),
    durationMs: row.duration_ms === null || row.duration_ms === undefined ? null : Number(row.duration_ms),
    errorMessage: row.error_message ? String(row.error_message) : null,
    approvedWarningTaskIds: parseJson<string[]>(row.approved_warning_task_ids_json, []),
    steps,
    artifacts,
    events,
    approvals,
  };
}

function buildArtifactInput(task: WorkflowTask, stepId: number, result: WorkflowTaskPreviewResult | null) {
  if (!result) return null;
  const base = {
    stepId,
    taskId: task.id,
    fileId: null as number | null,
    name: task.name,
  };

  if (result.kind === 'file') {
    return {
      ...base,
      artifactType: 'file' as const,
      fileId: result.file.id,
      name: result.file.displayName || result.file.originalName,
      metadata: {
        file: result.file,
        rows: result.dataFrame.rows.length,
        columns: result.dataFrame.columns.length,
        range: result.dataFrame.range,
      },
    };
  }

  if (result.kind === 'assert') {
    return {
      ...base,
      artifactType: 'assertion' as const,
      metadata: {
        assertion: result.assertion,
        rows: result.dataFrame.rows.length,
        columns: result.dataFrame.columns.length,
        range: result.dataFrame.range,
      },
    };
  }

  return {
    ...base,
    artifactType: 'dataframe' as const,
    metadata: {
      rows: result.dataFrame.rows.length,
      columns: result.dataFrame.columns.length,
      range: result.dataFrame.range,
      dataframe: result.dataFrame,
    },
  };
}

export class WorkflowRunStore implements WorkflowRunRepository {
  constructor(private readonly db: AppDb) {}

  async createRun(params: WorkflowRunCreateInput): Promise<WorkflowRunRecord> {
    const runRow = await this.db.queryOne<Record<string, unknown>>(
      `insert into workflow_runs (
        workflow_id, workflow_code, workflow_name, status, tasks_snapshot_json, runtime_parameters_json, approved_warning_task_ids_json
      ) values ($1, $2, $3, 'running', $4::jsonb, $5::jsonb, '[]'::jsonb)
      returning *`,
      [
        Number(params.workflow.id),
        String(params.workflow.code),
        String(params.workflow.name),
        JSON.stringify(params.tasks),
        JSON.stringify(params.runtimeParameters),
      ],
    );
    if (!runRow) throw new Error('Failed to create workflow run');
    const runId = Number(runRow.id);

    for (const task of params.tasks) {
      await this.db.execute(
        `insert into workflow_run_steps (
          run_id, task_id, task_name, operator_code, status, task_snapshot_json
        ) values ($1, $2, $3, $4, 'pending', $5::jsonb)`,
        [runId, task.id, task.name, task.operatorCode, JSON.stringify(task)],
      );
    }

    await this.createEvent({
      runId,
      eventType: 'run_started',
      message: `Workflow ${String(params.workflow.name)} started`,
      payload: {
        workflowId: Number(params.workflow.id),
        workflowCode: String(params.workflow.code),
        workflowName: String(params.workflow.name),
        runtimeParameters: params.runtimeParameters,
      },
      createdAt: toIsoTimestamp(runRow.started_at),
    });

    return this.getRun(runId);
  }

  async getRun(runId: number): Promise<WorkflowRunRecord> {
    const runRow = await this.db.queryOne<Record<string, unknown>>('select * from workflow_runs where id = $1', [runId]);
    if (!runRow) {
      const error = new Error('Workflow run not found') as Error & { statusCode?: number };
      error.statusCode = 404;
      throw error;
    }

    const [steps, artifacts, events, approvals] = await Promise.all([
      this.listSteps(runId),
      this.listArtifacts(runId),
      this.listEvents(runId),
      this.listApprovals(runId),
    ]);
    return toWorkflowRunRecord(runRow, steps, artifacts, events, approvals);
  }

  async updateRunTasksSnapshot(runId: number, tasks: WorkflowTask[]): Promise<void> {
    await this.db.execute(
      `update workflow_runs
       set tasks_snapshot_json = $2::jsonb
       where id = $1`,
      [runId, JSON.stringify(tasks)],
    );
    for (const task of tasks) {
      await this.db.execute(
        `update workflow_run_steps
         set task_name = $3,
             operator_code = $4,
             task_snapshot_json = $5::jsonb
         where run_id = $1 and task_id = $2`,
        [runId, task.id, task.name, task.operatorCode, JSON.stringify(task)],
      );
    }
  }

  async listSteps(runId: number): Promise<WorkflowRunStepRecord[]> {
    const rows = await this.db.query<Record<string, unknown>>(
      'select * from workflow_run_steps where run_id = $1 order by id asc',
      [runId],
    );
    return rows.map(toWorkflowRunStepRecord);
  }

  async listArtifacts(runId: number): Promise<WorkflowRunArtifactRecord[]> {
    const rows = await this.db.query<Record<string, unknown>>(
      'select * from workflow_run_artifacts where run_id = $1 order by id asc',
      [runId],
    );
    return rows.map(toWorkflowRunArtifactRecord);
  }

  async listEvents(runId: number): Promise<WorkflowRunEventRecord[]> {
    const rows = await this.db.query<Record<string, unknown>>(
      'select * from workflow_run_events where run_id = $1 order by created_at asc, id asc',
      [runId],
    );
    return rows.map(toWorkflowRunEventRecord);
  }

  async listApprovals(runId: number): Promise<WorkflowRunApprovalRecord[]> {
    const rows = await this.db.query<Record<string, unknown>>(
      'select * from workflow_run_approvals where run_id = $1 order by id asc',
      [runId],
    );
    return rows.map(toWorkflowRunApprovalRecord);
  }

  async createEvent(params: WorkflowRunEventInput): Promise<void> {
    await this.db.execute(
      `insert into workflow_run_events (
        run_id, step_id, task_id, event_type, level, message, payload_json, created_at
      ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, coalesce($8::timestamptz, current_timestamp))`,
      [
        params.runId,
        params.stepId ?? null,
        params.taskId ?? null,
        params.eventType,
        params.level ?? 'info',
        params.message ?? '',
        JSON.stringify(params.payload ?? {}),
        params.createdAt ?? null,
      ],
    );
  }

  async claimStep(runId: number, task: WorkflowTask): Promise<WorkflowRunStepClaim | null> {
    const startedAt = new Date().toISOString();
    const lockToken = `${process.pid}:${runId}:${task.id}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const row = await this.db.queryOne<Record<string, unknown>>(
      `update workflow_run_steps
       set status = 'running',
           lock_token = $4,
           locked_at = $3::timestamptz,
           attempt_count = attempt_count + 1,
           result_json = null,
           error_message = null,
           started_at = $3::timestamptz,
           finished_at = null,
           duration_ms = null
       where id = (
         select id
         from workflow_run_steps
         where run_id = $1
           and task_id = $2
           and status in ('pending', 'warning', 'blocked', 'failed', 'skipped')
         order by id desc
         limit 1
         for update skip locked
       )
       returning *`,
      [runId, task.id, startedAt, lockToken],
    );
    if (!row) return null;
    const step = toWorkflowRunStepRecord(row);
    await this.createEvent({
      runId,
      stepId: step.id,
      taskId: task.id,
      eventType: 'task_started',
      message: `${task.name} started`,
      payload: { taskName: task.name, operatorCode: task.operatorCode },
      createdAt: startedAt,
    });
    return { step, lockToken };
  }

  async heartbeatStep(stepId: number, lockToken: string): Promise<boolean> {
    const row = await this.db.queryOne<Record<string, unknown>>(
      `update workflow_run_steps
       set locked_at = current_timestamp
       where id = $1 and lock_token = $2 and status = 'running'
       returning id`,
      [stepId, lockToken],
    );
    return Boolean(row);
  }

  async releaseExpiredStepLocks(timeoutMs: number, runId?: number): Promise<number> {
    const rows = await this.db.query<Record<string, unknown>>(
      `update workflow_run_steps
       set status = 'pending',
           lock_token = null,
           locked_at = null,
           started_at = null
       where status = 'running'
         and ($2::integer is null or run_id = $2)
         and locked_at is not null
         and locked_at < current_timestamp - ($1::text || ' milliseconds')::interval
       returning id`,
      [Math.max(1, Math.floor(timeoutMs)), runId ?? null],
    );
    return rows.length;
  }

  async markStepFinished(params: WorkflowRunStepFinishInput): Promise<WorkflowRunStepRecord> {
    return this.finishStep(params);
  }

  async finishClaimedStep(params: WorkflowRunClaimedStepFinishInput): Promise<WorkflowRunStepRecord> {
    return this.finishStep(params, {
      stepId: params.stepId,
      lockToken: params.lockToken,
    });
  }

  private async finishStep(
    params: WorkflowRunStepFinishInput,
    claim?: { stepId: number; lockToken: string },
  ): Promise<WorkflowRunStepRecord> {
    const finishedAt = new Date().toISOString();
    const startedAt = params.startedAt ?? finishedAt;
    const durationMs = Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime());
    const claimedWhere = claim
      ? 'run_id = $1 and task_id = $2 and id = $9 and lock_token = $10 and status = \'running\''
      : `id = (
         select id from workflow_run_steps where run_id = $1 and task_id = $2 order by id desc limit 1
       )`;
    const baseParams = [
      params.runId,
      params.task.id,
      params.status,
      params.result ? JSON.stringify(params.result) : null,
      params.errorMessage ?? null,
      startedAt,
      finishedAt,
      durationMs,
    ];
    const row = await this.db.queryOne<Record<string, unknown>>(
      `update workflow_run_steps
       set status = $3,
           lock_token = null,
           locked_at = null,
           result_json = $4::jsonb,
           error_message = $5,
           started_at = coalesce(started_at, $6::timestamptz),
           finished_at = $7::timestamptz,
           duration_ms = $8
       where ${claimedWhere}
       returning *`,
      claim ? [...baseParams, claim.stepId, claim.lockToken] : baseParams,
    );
    if (!row) {
      throw new Error(
        claim
          ? `Workflow step ${params.task.id} lock is no longer owned by this worker`
          : `Workflow step ${params.task.id} not found`,
      );
    }
    const step = toWorkflowRunStepRecord(row);
    const level = params.status === 'failed' ? 'error' : params.status === 'warning' || params.status === 'blocked' ? 'warning' : 'info';
    await this.createEvent({
      runId: params.runId,
      stepId: step.id,
      taskId: params.task.id,
      eventType: params.result?.kind === 'assert' && params.status === 'failed' ? 'assertion_failed' : taskStateForEvent(params.status),
      level,
      message: params.errorMessage ?? `${params.task.name} ${params.status}`,
      payload: { taskName: params.task.name, operatorCode: params.task.operatorCode, durationMs },
      createdAt: finishedAt,
    });

    await this.persistArtifact(params.runId, params.task, step.id, params.result ?? null);
    return step;
  }

  async persistArtifact(runId: number, task: WorkflowTask, stepId: number, result: WorkflowTaskPreviewResult | null) {
    const artifactInput = buildArtifactInput(task, stepId, result);
    if (!artifactInput) return;
    const row = await this.db.queryOne<Record<string, unknown>>(
      `insert into workflow_run_artifacts (
        run_id, step_id, task_id, artifact_type, file_id, name, metadata_json
      ) values ($1, $2, $3, $4, $5, $6, $7::jsonb)
      returning *`,
      [
        runId,
        artifactInput.stepId,
        artifactInput.taskId,
        artifactInput.artifactType,
        artifactInput.fileId,
        artifactInput.name,
        JSON.stringify(artifactInput.metadata),
      ],
    );
    if (!row) return;
    const artifact = toWorkflowRunArtifactRecord(row);
    await this.createEvent({
      runId,
      stepId: artifact.stepId,
      taskId: artifact.taskId,
      eventType: 'artifact_created',
      message: `${artifact.name} artifact created`,
      payload: {
        artifactType: artifact.artifactType,
        fileId: artifact.fileId,
        metadata: artifact.metadata,
      },
      createdAt: artifact.createdAt,
    });
  }

  async requestApproval(runId: number, task: WorkflowTask, message: string): Promise<void> {
    const step = (await this.listSteps(runId)).find((item) => item.taskId === task.id) ?? null;
    const existing = await this.db.queryOne<Record<string, unknown>>(
      `select * from workflow_run_approvals
       where run_id = $1 and task_id = $2 and approval_key = $2 and status = 'pending'
       order by id desc limit 1`,
      [runId, task.id],
    );
    if (!existing) {
      await this.db.execute(
        `insert into workflow_run_approvals (
          run_id, task_id, approval_key, status, comment
        ) values ($1, $2, $3, 'pending', $4)`,
        [runId, task.id, task.id, message],
      );
    }
    await this.createEvent({
      runId,
      stepId: step?.id ?? null,
      taskId: task.id,
      eventType: 'approval_requested',
      level: 'warning',
      message,
      payload: { approvalKey: task.id },
    });
  }

  async approveWarning(runId: number, taskId: string, decision: 'approved' | 'skipped' = 'approved'): Promise<void> {
    await this.db.execute(
      `update workflow_run_approvals
       set status = $3,
           decision = $3,
           decided_by = 'user',
           decided_at = current_timestamp
       where run_id = $1 and task_id = $2 and status = 'pending'`,
      [runId, taskId, decision],
    );

    if (decision === 'approved') {
      const run = await this.getRun(runId);
      const approvedWarningTaskIds = Array.from(new Set([...run.approvedWarningTaskIds, taskId]));
      await this.db.execute(
        `update workflow_runs
         set approved_warning_task_ids_json = $2::jsonb,
             status = 'running',
             error_message = null,
             finished_at = null,
             duration_ms = null
         where id = $1`,
        [runId, JSON.stringify(approvedWarningTaskIds)],
      );
    }

    await this.createEvent({
      runId,
      taskId,
      eventType: 'approval_recorded',
      message: `Approval ${decision} for ${taskId}`,
      payload: { approvalKey: taskId, status: decision },
    });
  }

  async updateRunStatus(params: WorkflowRunStatusUpdateInput): Promise<void> {
    await this.db.execute(
      `update workflow_runs
       set status = $2,
           result_json = coalesce($3::jsonb, result_json),
           error_message = $4,
           finished_at = case when $5 then current_timestamp else finished_at end,
           duration_ms = case
             when $5 then greatest(0, floor(extract(epoch from (current_timestamp - started_at)) * 1000)::integer)
             else duration_ms
           end
       where id = $1`,
      [
        params.runId,
        params.status,
        params.result === undefined ? null : JSON.stringify(params.result),
        params.errorMessage ?? null,
        Boolean(params.finish),
      ],
    );
  }

  async createRunFinishedEvent(runId: number, status: WorkflowRunStatus, payload: Record<string, unknown> = {}): Promise<void> {
    const level = status === 'failed' ? 'error' : status === 'waiting_approval' || status === 'completed_with_warnings' ? 'warning' : 'info';
    const message =
      status === 'failed'
        ? String(payload.errorMessage ?? 'Workflow failed')
        : status === 'waiting_approval'
          ? 'Workflow is waiting for approval'
          : status === 'completed_with_warnings'
            ? 'Workflow completed with warnings'
            : status === 'skipped'
              ? 'Workflow skipped'
              : 'Workflow completed';
    await this.createEvent({
      runId,
      eventType: status === 'waiting_approval' ? 'run_waiting_approval' : 'run_completed',
      level,
      message,
      payload: { status, ...payload },
    });
  }
}

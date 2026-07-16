import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  ProductFileRecord,
  WorkflowDataFrame,
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
import { executeWorkflowTaskOutputStrict, executeWorkflowTaskPreview } from './engine.js';
import type { WorkflowOperatorRuntime } from './operators/types.js';
import { WorkflowRunExecutor } from './runExecutor.js';
import type {
  WorkflowRunCreateInput,
  WorkflowRunEventInput,
  WorkflowRunRepository,
  WorkflowRunStatusUpdateInput,
  WorkflowRunStepClaim,
  WorkflowRunStepFinishInput,
} from './runRepository.js';
import { WorkflowRunScheduler } from './runScheduler.js';
import { WorkflowRunStore } from './runStore.js';

const testDataFrame: WorkflowDataFrame = {
  columns: ['value'],
  rows: [{ value: 1 }],
  index: [0],
  matrix: [[1]],
  range: { sheetName: 'Sheet1', a1Range: 'A1:A1', startRow: 1, endRow: 1, startCol: 1, endCol: 1 },
};

const twoRowDataFrame: WorkflowDataFrame = {
  columns: ['value'],
  rows: [{ value: 1 }, { value: 2 }],
  index: [0, 1],
  matrix: [[1], [2]],
  range: { sheetName: 'Sheet1', a1Range: 'A1:A2', startRow: 1, endRow: 2, startCol: 1, endCol: 1 },
};

function productFileRecord(overrides: Partial<ProductFileRecord> = {}): ProductFileRecord {
  return {
    id: 1,
    originalName: 'workflow-output.xlsx',
    displayName: 'workflow-output.v19700101000000.xlsx',
    storedName: 'workflow-output.xlsx',
    displayPath: 'output/workflow-output.xlsx',
    fileExt: '.xlsx',
    fileSizeBytes: 4,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    checksum: 'test',
    storageBackend: 'local',
    workbookSheetCount: 1,
    workbookRowCount: 1,
    uploadedBy: 'Workflow',
    createdAt: new Date(0).toISOString(),
    ...overrides,
  };
}

function createRuntime(overrides: Partial<WorkflowOperatorRuntime> = {}): WorkflowOperatorRuntime {
  return {
    extractSheetRangeAsDataFrame: () => testDataFrame,
    rowsToDataFrame: (rows) => ({
      columns: rows.length ? Object.keys(rows[0] ?? {}) : [],
      rows,
      index: rows.map((_, index) => index),
      matrix: rows.map((row) => Object.values(row)),
      range: {
        sheetName: 'Sheet1',
        a1Range: 'A1',
        startRow: 1,
        endRow: rows.length,
        startCol: 1,
        endCol: rows.length ? Object.keys(rows[0] ?? {}).length : 1,
      },
    }),
    dataFrameToWorkbookBuffer: () => Buffer.from('test'),
    readFile: async () => Buffer.from('xlsx'),
    getProductFileBufferById: async () => Buffer.from('xlsx'),
    saveGeneratedWorkbook: async () => productFileRecord(),
    ...overrides,
  };
}

const runtime: WorkflowOperatorRuntime = createRuntime();

function sourceTask(overrides: Partial<WorkflowTask> = {}): WorkflowTask {
  return {
    id: 'source',
    name: 'Source',
    operatorCode: 'sheet.range.extract',
    operatorVersion: '1.0.0',
    description: '',
    x: 0,
    y: 0,
    params: { fileId: 1, sheetName: 'Sheet1', range: 'A1:A1' },
    inputs: {},
    ...overrides,
  };
}

function assertTask(overrides: Partial<WorkflowTask> = {}): WorkflowTask {
  return {
    id: 'assert',
    name: 'Assert',
    operatorCode: 'dataframe.assert',
    operatorVersion: '1.0.0',
    description: '',
    x: 0,
    y: 120,
    params: {
      operator: '=',
      expectedValue: 999,
      failureStrategy: 'warning',
      failureMessage: 'value mismatch',
    },
    inputs: { input1: { from: 'source', slot: 'dataframe' } },
    ...overrides,
  };
}

function persistTask(overrides: Partial<WorkflowTask> = {}): WorkflowTask {
  return {
    id: 'persist',
    name: 'Persist',
    operatorCode: 'dataframe.persist.excel',
    operatorVersion: '1.0.0',
    description: '',
    x: 0,
    y: 240,
    params: { fileName: 'workflow-output.xlsx', sheetName: 'Sheet1', uploadedBy: 'Workflow' },
    inputs: { input1: { from: 'source', slot: 'dataframe' } },
    ...overrides,
  };
}

function sqlTask(overrides: Partial<WorkflowTask> = {}): WorkflowTask {
  return {
    id: 'sql',
    name: 'SQL',
    operatorCode: 'sql.compute',
    operatorVersion: '1.0.0',
    description: '',
    x: 0,
    y: 120,
    params: {
      sql: 'select count(*) as total_rows from {source}',
      tableBindings: [{ tableName: 'source', inputSlot: 'input1' }],
    },
    inputs: { input1: { from: 'source', slot: 'dataframe' } },
    ...overrides,
  };
}

function dataframeResult(dataFrame = testDataFrame): WorkflowTaskPreviewResult {
  return { kind: 'dataframe', dataFrame };
}

function stepFromTask(runId: number, task: WorkflowTask, status: WorkflowExecutionTaskState, result: WorkflowTaskPreviewResult | null = null) {
  return {
    id: 0,
    runId,
    taskId: task.id,
    taskName: task.name,
    operatorCode: task.operatorCode,
    status,
    lockToken: null,
    lockedAt: null,
    attemptCount: status === 'pending' ? 0 : 1,
    startedAt: status === 'pending' ? null : new Date(0).toISOString(),
    finishedAt: status === 'pending' || status === 'running' ? null : new Date(0).toISOString(),
    durationMs: status === 'pending' || status === 'running' ? null : 0,
    errorMessage: null,
    result,
  } satisfies WorkflowRunStepRecord;
}

class FakeWorkflowRunStore implements WorkflowRunRepository {
  run: WorkflowRunRecord;
  expiredLockReleaseCount = 0;
  releaseExpiredStepLocksCalls: Array<{ timeoutMs: number; runId?: number }> = [];
  private nextStepId = 1;
  private nextEventId = 1;
  private nextApprovalId = 1;

  constructor(tasks: WorkflowTask[], seedSteps: Array<{ task: WorkflowTask; status: WorkflowExecutionTaskState; result?: WorkflowTaskPreviewResult | null }> = []) {
    this.run = {
      id: 100,
      workflowId: 1,
      workflowCode: 'test-workflow',
      workflowName: 'Test Workflow',
      status: 'pending',
      runtimeParameters: {},
      tasksSnapshot: tasks,
      startedAt: new Date(0).toISOString(),
      finishedAt: null,
      durationMs: null,
      errorMessage: null,
      approvedWarningTaskIds: [],
      steps: tasks.map((task) => stepFromTask(100, task, 'pending')),
      artifacts: [],
      events: [],
      approvals: [],
    };
    for (const seed of seedSteps) {
      const index = this.run.steps.findIndex((step) => step.taskId === seed.task.id);
      this.run.steps[index] = stepFromTask(100, seed.task, seed.status, seed.result ?? null);
    }
    this.run.steps.forEach((step) => {
      step.id = this.nextStepId++;
    });
  }

  async createRun(_params: WorkflowRunCreateInput): Promise<WorkflowRunRecord> {
    return this.run;
  }

  async getRun(_runId: number): Promise<WorkflowRunRecord> {
    return this.run;
  }

  async updateRunTasksSnapshot(_runId: number, tasks: WorkflowTask[]): Promise<void> {
    this.run.tasksSnapshot = tasks;
    for (const task of tasks) {
      const step = this.run.steps.find((item) => item.taskId === task.id);
      if (!step) continue;
      step.taskName = task.name;
      step.operatorCode = task.operatorCode;
    }
  }

  async createEvent(params: WorkflowRunEventInput): Promise<void> {
    this.run.events.push({
      id: this.nextEventId++,
      runId: params.runId,
      stepId: params.stepId ?? null,
      taskId: params.taskId ?? null,
      eventType: params.eventType,
      level: params.level ?? 'info',
      message: params.message ?? '',
      payload: params.payload ?? {},
      createdAt: params.createdAt ?? new Date().toISOString(),
    } satisfies WorkflowRunEventRecord);
  }

  async claimStep(_runId: number, task: WorkflowTask): Promise<WorkflowRunStepClaim | null> {
    const step = this.run.steps.find((item) =>
      item.taskId === task.id &&
      (item.status === 'pending' || item.status === 'warning' || item.status === 'blocked' || item.status === 'failed' || item.status === 'skipped')
    );
    if (!step) return null;
    const lockToken = `lock-${task.id}-${step.attemptCount + 1}`;
    step.status = 'running';
    step.lockToken = lockToken;
    step.lockedAt = new Date().toISOString();
    step.startedAt = step.lockedAt;
    step.finishedAt = null;
    step.durationMs = null;
    step.errorMessage = null;
    step.result = null;
    step.attemptCount += 1;
    return { step, lockToken };
  }

  async heartbeatStep(stepId: number, lockToken: string): Promise<boolean> {
    return this.run.steps.some((step) => step.id === stepId && step.lockToken === lockToken && step.status === 'running');
  }

  async releaseExpiredStepLocks(timeoutMs: number, runId?: number): Promise<number> {
    this.releaseExpiredStepLocksCalls.push({ timeoutMs, runId });
    const releasedCount = this.expiredLockReleaseCount;
    this.expiredLockReleaseCount = 0;
    if (!releasedCount) return 0;
    for (const step of this.run.steps) {
      if (step.runId !== runId || step.status !== 'running') continue;
      step.status = 'pending';
      step.lockToken = null;
      step.lockedAt = null;
      step.startedAt = null;
      step.finishedAt = null;
      step.durationMs = null;
      step.errorMessage = null;
      step.result = null;
    }
    return releasedCount;
  }

  async finishClaimedStep(params: WorkflowRunStepFinishInput & { stepId: number; lockToken: string }): Promise<WorkflowRunStepRecord> {
    const step = this.run.steps.find((item) => item.id === params.stepId);
    if (!step || step.lockToken !== params.lockToken || step.status !== 'running') {
      throw new Error(`Workflow step ${params.task.id} lock is no longer owned by this worker`);
    }
    return this.finishStep(step, params);
  }

  async markStepFinished(params: WorkflowRunStepFinishInput): Promise<WorkflowRunStepRecord> {
    const step = this.run.steps.find((item) => item.taskId === params.task.id);
    if (!step) throw new Error(`Workflow step ${params.task.id} not found`);
    return this.finishStep(step, params);
  }

  async requestApproval(runId: number, task: WorkflowTask, message: string): Promise<void> {
    const existing = this.run.approvals.find((approval) => approval.taskId === task.id && approval.status === 'pending');
    if (existing) return;
    this.run.approvals.push({
      id: this.nextApprovalId++,
      runId,
      taskId: task.id,
      approvalKey: `${runId}:${task.id}`,
      status: 'pending',
      decision: null,
      decidedBy: null,
      comment: message,
      createdAt: new Date().toISOString(),
      decidedAt: null,
    } satisfies WorkflowRunApprovalRecord);
  }

  async approveWarning(_runId: number, taskId: string, decision: 'approved' | 'skipped' = 'approved'): Promise<void> {
    const approval = this.run.approvals.find((item) => item.taskId === taskId && item.status === 'pending');
    if (approval) {
      approval.status = decision;
      approval.decision = decision;
      approval.decidedAt = new Date().toISOString();
    }
    if (decision === 'approved' && !this.run.approvedWarningTaskIds.includes(taskId)) {
      this.run.approvedWarningTaskIds.push(taskId);
    }
  }

  async updateRunStatus(params: WorkflowRunStatusUpdateInput): Promise<void> {
    this.run.status = params.status;
    this.run.errorMessage = params.errorMessage ?? null;
    if (params.finish) {
      this.run.finishedAt = new Date().toISOString();
    }
  }

  async createRunFinishedEvent(runId: number, status: WorkflowRunStatus, payload: Record<string, unknown> = {}): Promise<void> {
    await this.createEvent({ runId, eventType: 'run_finished', message: status, payload: { status, ...payload } });
  }

  private finishStep(step: WorkflowRunStepRecord, params: WorkflowRunStepFinishInput): WorkflowRunStepRecord {
    step.status = params.status;
    step.lockToken = null;
    step.lockedAt = null;
    step.result = params.result ?? null;
    step.errorMessage = params.errorMessage ?? null;
    step.finishedAt = new Date().toISOString();
    step.durationMs = 0;
    return step;
  }
}

test('strict task execution requires persisted upstream output', async () => {
  const source = sourceTask();
  const downstream = assertTask();
  await assert.rejects(
    () => executeWorkflowTaskOutputStrict(downstream, new Map(), new Map(), new Map([source, downstream].map((task) => [task.id, task])), runtime),
    /dependency Source has not produced a persisted output/,
  );
});

test('warning approval continues the same run without re-running the warning assert step', async () => {
  const source = sourceTask();
  const check = assertTask();
  const store = new FakeWorkflowRunStore([source, check], [{ task: source, status: 'completed', result: dataframeResult() }]);
  const scheduler = new WorkflowRunScheduler(store, runtime);

  await scheduler.execute(store.run.id, { kind: 'all' });

  assert.equal(store.run.status, 'waiting_approval');
  assert.deepEqual(store.run.approvals.map((approval) => approval.taskId), ['assert']);
  assert.equal(store.run.steps.find((step) => step.taskId === 'assert')?.status, 'warning');
  assert.equal(store.run.steps.find((step) => step.taskId === 'assert')?.attemptCount, 1);

  await store.approveWarning(store.run.id, 'assert', 'approved');
  await scheduler.execute(store.run.id, { kind: 'all' });

  assert.equal(store.run.id, 100);
  assert.equal(store.run.status, 'completed_with_warnings');
  assert.equal(store.run.steps.find((step) => step.taskId === 'assert')?.status, 'warning');
  assert.equal(store.run.steps.find((step) => step.taskId === 'assert')?.attemptCount, 1);
});

test('warning approval unblocks and runs downstream steps in the same run', async () => {
  let saveCount = 0;
  const runtimeWithSaveSpy = createRuntime({
    saveGeneratedWorkbook: async () => {
      saveCount += 1;
      return productFileRecord({ id: saveCount });
    },
  });
  const source = sourceTask();
  const check = assertTask();
  const output = persistTask({ inputs: { input1: { from: 'assert', slot: 'dataframe' } } });
  const store = new FakeWorkflowRunStore([source, check, output], [{ task: source, status: 'completed', result: dataframeResult() }]);
  const scheduler = new WorkflowRunScheduler(store, runtimeWithSaveSpy);

  await scheduler.execute(store.run.id, { kind: 'all' });

  assert.equal(store.run.status, 'waiting_approval');
  assert.equal(store.run.steps.find((step) => step.taskId === 'assert')?.status, 'warning');
  await store.markStepFinished({
    runId: store.run.id,
    task: output,
    status: 'blocked',
    errorMessage: 'Persist blocked by warning checkpoint assert',
  });
  assert.equal(store.run.steps.find((step) => step.taskId === 'persist')?.status, 'blocked');
  assert.equal(saveCount, 0);

  await store.approveWarning(store.run.id, 'assert', 'approved');
  await scheduler.execute(store.run.id, { kind: 'all' });

  assert.equal(store.run.status, 'completed_with_warnings');
  assert.equal(store.run.steps.find((step) => step.taskId === 'assert')?.status, 'warning');
  assert.equal(store.run.steps.find((step) => step.taskId === 'persist')?.status, 'completed');
  assert.equal(store.run.steps.find((step) => step.taskId === 'persist')?.result?.kind, 'file');
  assert.equal(saveCount, 1);
});

test('cancelRun marks unfinished steps skipped and finalizes the run', async () => {
  const source = sourceTask();
  const sql = sqlTask({ inputs: { input1: { from: 'source', slot: 'dataframe' } } });
  const persist = persistTask({ inputs: { input1: { from: 'sql', slot: 'dataframe' } } });
  const store = new FakeWorkflowRunStore(
    [source, sql, persist],
    [{ task: source, status: 'completed', result: dataframeResult() }],
  );
  const scheduler = new WorkflowRunScheduler(store, runtime);

  await scheduler.cancelRun(store.run.id);

  assert.equal(store.run.status, 'skipped');
  assert.equal(store.run.finishedAt !== null, true);
  assert.equal(store.run.steps.find((step) => step.taskId === 'source')?.status, 'completed');
  assert.equal(store.run.steps.find((step) => step.taskId === 'sql')?.status, 'skipped');
  assert.equal(store.run.steps.find((step) => step.taskId === 'persist')?.status, 'skipped');
  assert.ok(store.run.events.some((event) => event.eventType === 'run_finished' && event.payload.cancelled === true));
});

test('cancelRun preserves a running claimed step so its worker lock remains valid', async () => {
  const source = sourceTask();
  const sql = sqlTask({ inputs: { input1: { from: 'source', slot: 'dataframe' } } });
  const persist = persistTask({ inputs: { input1: { from: 'sql', slot: 'dataframe' } } });
  const store = new FakeWorkflowRunStore(
    [source, sql, persist],
    [
      { task: source, status: 'completed', result: dataframeResult() },
      { task: sql, status: 'running' },
    ],
  );
  const runningStep = store.run.steps.find((step) => step.taskId === 'sql');
  if (!runningStep) throw new Error('missing running step');
  runningStep.lockToken = 'active-lock';
  const scheduler = new WorkflowRunScheduler(store, runtime);

  await scheduler.cancelRun(store.run.id);

  assert.equal(store.run.status, 'skipped');
  assert.equal(store.run.steps.find((step) => step.taskId === 'sql')?.status, 'running');
  assert.equal(store.run.steps.find((step) => step.taskId === 'sql')?.lockToken, 'active-lock');
  assert.equal(store.run.steps.find((step) => step.taskId === 'persist')?.status, 'skipped');
});

test('single-step execution rejects task ids outside the run snapshot', async () => {
  const source = sourceTask();
  const store = new FakeWorkflowRunStore([source]);
  const executor = new WorkflowRunExecutor(store, runtime);

  await assert.rejects(
    () => executor.startSingleStepAsync(store.run.id, 'missing-task'),
    /does not contain task missing-task/,
  );
});

test('single-step and retry-unfinished mark the run running before dispatch', async () => {
  const source = sourceTask();
  const store = new FakeWorkflowRunStore([source], [{ task: source, status: 'failed' }]);
  store.run.status = 'failed';
  const enqueued: unknown[] = [];
  const executor = new WorkflowRunExecutor(store, runtime, {
    enqueue(_runId, mode) {
      enqueued.push(mode);
    },
  });

  await executor.startSingleStepAsync(store.run.id, 'source');
  assert.equal(store.run.status, 'running');
  assert.deepEqual(enqueued[0], { kind: 'single', taskId: 'source' });

  store.run.status = 'failed';
  await executor.retryUnfinishedAsync(store.run.id);
  assert.equal(store.run.status, 'running');
  assert.deepEqual(enqueued[1], { kind: 'retry_unfinished' });
});

test('single-step retry can replace the current run task snapshot before dispatch', async () => {
  const source = sourceTask();
  const store = new FakeWorkflowRunStore([source], [{ task: source, status: 'failed' }]);
  const executor = new WorkflowRunExecutor(store, runtime, {
    enqueue() {},
  });
  const updatedSource = sourceTask({ name: 'Updated Source', params: { fileId: 99, sheetName: 'Sheet1', range: 'A1:A1' } });

  await executor.startSingleStepAsync(store.run.id, 'source', [updatedSource]);

  assert.equal(store.run.tasksSnapshot[0]?.name, 'Updated Source');
  assert.equal(store.run.tasksSnapshot[0]?.params.fileId, 99);
  assert.equal(store.run.steps.find((step) => step.taskId === 'source')?.taskName, 'Updated Source');
});

test('single-step execution can retry a failed task without rerunning completed dependencies', async () => {
  const source = sourceTask();
  const sql = sqlTask({ inputs: { input1: { from: 'source', slot: 'dataframe' } } });
  const store = new FakeWorkflowRunStore(
    [source, sql],
    [
      { task: source, status: 'completed', result: dataframeResult() },
      { task: sql, status: 'failed' },
    ],
  );
  const scheduler = new WorkflowRunScheduler(store, runtime);

  await scheduler.execute(store.run.id, { kind: 'single', taskId: 'sql' });

  assert.equal(store.run.steps.find((step) => step.taskId === 'source')?.attemptCount, 1);
  assert.equal(store.run.steps.find((step) => step.taskId === 'sql')?.status, 'completed');
  assert.equal(store.run.steps.find((step) => step.taskId === 'sql')?.attemptCount, 2);
});

test('retry_unfinished reruns failed and blocked steps while preserving completed outputs', async () => {
  const source = sourceTask();
  const sql = sqlTask({ inputs: { input1: { from: 'source', slot: 'dataframe' } } });
  const persist = persistTask({ inputs: { input1: { from: 'sql', slot: 'dataframe' } } });
  const store = new FakeWorkflowRunStore(
    [source, sql, persist],
    [
      { task: source, status: 'completed', result: dataframeResult() },
      { task: sql, status: 'failed' },
      { task: persist, status: 'blocked' },
    ],
  );
  const scheduler = new WorkflowRunScheduler(store, runtime);

  await scheduler.execute(store.run.id, { kind: 'retry_unfinished' });

  assert.equal(store.run.steps.find((step) => step.taskId === 'source')?.attemptCount, 1);
  assert.equal(store.run.steps.find((step) => step.taskId === 'sql')?.status, 'completed');
  assert.equal(store.run.steps.find((step) => step.taskId === 'persist')?.status, 'completed');
  assert.equal(store.run.status, 'completed');
});

test('failed dependencies block downstream steps in the same run', async () => {
  const source = sourceTask();
  const downstream = assertTask();
  const store = new FakeWorkflowRunStore([source, downstream], [{ task: source, status: 'failed' }]);
  const scheduler = new WorkflowRunScheduler(store, runtime);

  await scheduler.execute(store.run.id, { kind: 'all' });

  assert.equal(store.run.status, 'failed');
  assert.equal(store.run.steps.find((step) => step.taskId === 'assert')?.status, 'blocked');
});

test('skip checkpoint decision skips downstream steps and finishes the same run', async () => {
  const source = sourceTask();
  const check = assertTask();
  const output = persistTask({ inputs: { input1: { from: 'assert', slot: 'dataframe' } } });
  const store = new FakeWorkflowRunStore([source, check, output], [{ task: source, status: 'completed', result: dataframeResult() }]);
  const scheduler = new WorkflowRunScheduler(store, runtime);

  await scheduler.execute(store.run.id, { kind: 'all' });
  assert.equal(store.run.status, 'waiting_approval');

  await store.approveWarning(store.run.id, 'assert', 'skipped');
  await scheduler.skipDownstream(store.run.id, ['assert']);

  assert.equal(store.run.id, 100);
  assert.equal(store.run.status, 'skipped');
  assert.equal(store.run.steps.find((step) => step.taskId === 'persist')?.status, 'skipped');
  assert.equal(store.run.steps.find((step) => step.taskId === 'assert')?.status, 'warning');
});

test('onRunFinalized fires once when an all-mode run reaches a terminal status', async () => {
  const source = sourceTask();
  const finalizedRuns: WorkflowRunRecord[] = [];
  const store = new FakeWorkflowRunStore([source]);
  const scheduler = new WorkflowRunScheduler(store, runtime, {
    onRunFinalized: (run) => {
      finalizedRuns.push(run);
    },
  });

  await scheduler.execute(store.run.id, { kind: 'all' });

  assert.equal(store.run.status, 'completed');
  assert.equal(finalizedRuns.length, 1);
  assert.equal(finalizedRuns[0]?.id, store.run.id);
  assert.equal(finalizedRuns[0]?.status, 'completed');
});

test('onRunFinalized does not fire for waiting approval or single-step running status', async () => {
  const source = sourceTask();
  const check = assertTask();
  const finalizedRuns: WorkflowRunRecord[] = [];
  const waitingStore = new FakeWorkflowRunStore([source, check], [{ task: source, status: 'completed', result: dataframeResult() }]);
  const waitingScheduler = new WorkflowRunScheduler(waitingStore, runtime, {
    onRunFinalized: (run) => {
      finalizedRuns.push(run);
    },
  });

  await waitingScheduler.execute(waitingStore.run.id, { kind: 'all' });

  assert.equal(waitingStore.run.status, 'waiting_approval');
  assert.equal(finalizedRuns.length, 0);

  const passingCheck = assertTask({
    params: {
      operator: '=',
      expectedValue: 1,
      failureStrategy: 'block',
      failureMessage: 'value mismatch',
    },
  });
  const output = persistTask({ inputs: { input1: { from: 'assert', slot: 'dataframe' } } });
  const singleStore = new FakeWorkflowRunStore([source, passingCheck, output], [{ task: source, status: 'completed', result: dataframeResult() }]);
  const singleScheduler = new WorkflowRunScheduler(singleStore, runtime, {
    onRunFinalized: (run) => {
      finalizedRuns.push(run);
    },
  });

  await singleScheduler.execute(singleStore.run.id, { kind: 'single', taskId: 'assert' });

  assert.equal(singleStore.run.status, 'running');
  assert.equal(finalizedRuns.length, 0);
});

test('onRunFinalized fires when execution throws and marks the run failed', async () => {
  const source = sourceTask();
  const finalizedRuns: WorkflowRunRecord[] = [];
  const store = new FakeWorkflowRunStore([source]);
  const failingStore = Object.assign(store, {
    releaseExpiredStepLocks: async () => {
      throw new Error('lock cleanup failed');
    },
  });
  const scheduler = new WorkflowRunScheduler(failingStore, runtime, {
    onRunFinalized: (run) => {
      finalizedRuns.push(run);
    },
  });

  await scheduler.execute(store.run.id, { kind: 'all' });

  assert.equal(store.run.status, 'failed');
  assert.equal(finalizedRuns.length, 1);
  assert.equal(finalizedRuns[0]?.status, 'failed');
  assert.match(finalizedRuns[0]?.errorMessage ?? '', /lock cleanup failed/);
});

test('single-step execution only advances the selected task', async () => {
  const source = sourceTask();
  const check = assertTask({
    params: {
      operator: '=',
      expectedValue: 1,
      failureStrategy: 'block',
      failureMessage: 'value mismatch',
    },
  });
  const output = persistTask({ inputs: { input1: { from: 'assert', slot: 'dataframe' } } });
  const store = new FakeWorkflowRunStore([source, check, output], [{ task: source, status: 'completed', result: dataframeResult() }]);
  const scheduler = new WorkflowRunScheduler(store, runtime);

  await scheduler.execute(store.run.id, { kind: 'single', taskId: 'assert' });

  assert.equal(store.run.status, 'running');
  assert.equal(store.run.steps.find((step) => step.taskId === 'source')?.status, 'completed');
  assert.equal(store.run.steps.find((step) => step.taskId === 'assert')?.status, 'completed');
  assert.equal(store.run.steps.find((step) => step.taskId === 'persist')?.status, 'pending');
});

test('approved warning input guard executes the target operator body instead of reusing the guard result', async () => {
  let saveCount = 0;
  const runtimeWithSaveSpy = createRuntime({
    saveGeneratedWorkbook: async () => {
      saveCount += 1;
      return productFileRecord({ id: saveCount });
    },
  });
  const source = sourceTask();
  const output = persistTask({
    inputs: {
      input1: {
        from: 'source',
        slot: 'dataframe',
        guards: [
          {
            id: 'shape_check',
            type: 'dataframe.shape.assert',
            name: 'Shape Check',
            enabled: true,
            params: {
              rowOperator: '=',
              expectedRows: 2,
              columnOperator: '=',
              expectedColumns: 1,
              failureStrategy: 'warning',
              failureMessage: 'shape mismatch',
            },
          },
        ],
      },
    },
  });
  const store = new FakeWorkflowRunStore([source, output], [{ task: source, status: 'completed', result: dataframeResult() }]);
  const scheduler = new WorkflowRunScheduler(store, runtimeWithSaveSpy);

  await scheduler.execute(store.run.id, { kind: 'all' });

  assert.equal(store.run.status, 'waiting_approval');
  assert.equal(store.run.steps.find((step) => step.taskId === 'persist')?.status, 'warning');
  assert.equal(saveCount, 0);

  await store.approveWarning(store.run.id, 'persist', 'approved');
  await scheduler.execute(store.run.id, { kind: 'all' });

  assert.equal(store.run.status, 'completed');
  assert.equal(store.run.steps.find((step) => step.taskId === 'persist')?.status, 'completed');
  assert.equal(store.run.steps.find((step) => step.taskId === 'persist')?.result?.kind, 'file');
  assert.equal(saveCount, 1);
});

test('completed dependency with missing persisted output fails dependent task clearly', async () => {
  const source = sourceTask();
  const downstream = assertTask();
  const store = new FakeWorkflowRunStore([source, downstream], [{ task: source, status: 'completed', result: null }]);
  const scheduler = new WorkflowRunScheduler(store, runtime);

  await scheduler.execute(store.run.id, { kind: 'all' });

  const assertStep = store.run.steps.find((step) => step.taskId === 'assert');
  assert.equal(store.run.status, 'failed');
  assert.equal(assertStep?.status, 'failed');
  assert.match(assertStep?.errorMessage ?? '', /dependency source has no persisted output/i);
});

test('scheduler releases expired step locks for the current run before executing', async () => {
  const source = sourceTask();
  const store = new FakeWorkflowRunStore([source]);
  const step = store.run.steps.find((item) => item.taskId === 'source');
  assert.ok(step);
  step.status = 'running';
  step.lockToken = 'stale-lock';
  step.lockedAt = new Date(0).toISOString();
  step.startedAt = new Date(0).toISOString();
  store.expiredLockReleaseCount = 1;
  const scheduler = new WorkflowRunScheduler(store, runtime);

  await scheduler.execute(store.run.id, { kind: 'all' });

  assert.equal(store.releaseExpiredStepLocksCalls.length, 1);
  assert.equal(store.releaseExpiredStepLocksCalls[0]?.runId, store.run.id);
  assert.equal(store.run.steps.find((item) => item.taskId === 'source')?.status, 'completed');
  assert.ok(store.run.events.some((event) => event.eventType === 'expired_step_locks_released'));
});

test('persist excel preview does not write files but execution does', async () => {
  let saveCount = 0;
  const savedOriginalNames: string[] = [];
  const runtimeWithSaveSpy = createRuntime({
    saveGeneratedWorkbook: async (params) => {
      saveCount += 1;
      savedOriginalNames.push(params.originalName);
      return productFileRecord({ id: saveCount });
    },
  });
  const source = sourceTask();
  const output = persistTask({ params: { fileName: 'workflow-output.xlsx', folderPrefix: 'output/test-page', sheetName: 'Output Sheet', uploadedBy: 'Workflow' } });
  const taskMap = new Map([source, output].map((task) => [task.id, task]));

  const preview = await executeWorkflowTaskPreview(output, new Map([['source', testDataFrame]]), taskMap, runtimeWithSaveSpy);
  assert.equal(preview.kind, 'file-plan');
  assert.equal(saveCount, 0);

  const execution = await executeWorkflowTaskOutputStrict(
    output,
    new Map([['source', testDataFrame]]),
    new Map([['source', dataframeResult()]]),
    taskMap,
    runtimeWithSaveSpy,
  );

  assert.equal(execution.result.kind, 'file');
  assert.equal(execution.result.dataFrame.range.sheetName, 'Output Sheet');
  assert.equal(saveCount, 1);
  assert.match(savedOriginalNames[0] ?? '', /^workflow-output\.v\d{14}\.xlsx$/);
});

test('sql compute uses current SQL text and isolated dataframe table bindings', async () => {
  const source = sourceTask();
  const sql = sqlTask();
  const taskMap = new Map([source, sql].map((task) => [task.id, task]));

  const first = await executeWorkflowTaskOutputStrict(
    sql,
    new Map([['source', twoRowDataFrame]]),
    new Map([['source', dataframeResult(twoRowDataFrame)]]),
    taskMap,
    runtime,
  );

  assert.equal(first.dataFrame.rows[0]?.total_rows, 2);

  const sqlWithChangedText = sqlTask({
    params: {
      sql: 'select 1 as total_rows',
      tableBindings: [{ tableName: 'source', inputSlot: 'input1' }],
    },
  });
  const changedTaskMap = new Map([source, sqlWithChangedText].map((task) => [task.id, task]));
  const second = await executeWorkflowTaskOutputStrict(
    sqlWithChangedText,
    new Map([['source', testDataFrame]]),
    new Map([['source', dataframeResult(testDataFrame)]]),
    changedTaskMap,
    runtime,
  );

  assert.deepEqual(second.dataFrame.rows, [{ total_rows: 1 }]);
});

test('claimed step finish scopes SQL by run and task so Postgres can infer all parameter types', async () => {
  const source = sourceTask();
  const capturedSql: string[] = [];
  const fakeDb = {
    async queryOne(_sql: string, _params: unknown[]) {
      capturedSql.push(_sql);
      return {
        id: 10,
        run_id: 100,
        task_id: source.id,
        task_name: source.name,
        operator_code: source.operatorCode,
        status: 'failed',
        lock_token: null,
        locked_at: null,
        attempt_count: 1,
        started_at: new Date(0).toISOString(),
        finished_at: new Date(1).toISOString(),
        duration_ms: 1,
        error_message: 'boom',
        result_json: null,
      };
    },
    async execute(_sql: string, _params: unknown[]) {
      capturedSql.push(_sql);
    },
  };
  const store = new WorkflowRunStore(fakeDb as never);

  await store.finishClaimedStep({
    runId: 100,
    task: source,
    stepId: 10,
    lockToken: 'lock-source',
    status: 'failed',
    errorMessage: 'boom',
    startedAt: new Date(0).toISOString(),
  });

  const updateSql = capturedSql.find((sql) => sql.includes('update workflow_run_steps'));
  assert.ok(updateSql);
  assert.match(updateSql, /run_id = \$1/);
  assert.match(updateSql, /task_id = \$2/);
});

test('unclaimed step finish uses only the SQL parameters referenced by its update statement', async () => {
  const source = sourceTask();
  const captured: Array<{ sql: string; params: unknown[] }> = [];
  const fakeDb = {
    async queryOne(sql: string, params: unknown[]) {
      captured.push({ sql, params });
      return {
        id: 10,
        run_id: 100,
        task_id: source.id,
        task_name: source.name,
        operator_code: source.operatorCode,
        status: 'blocked',
        lock_token: null,
        locked_at: null,
        attempt_count: 1,
        started_at: new Date(0).toISOString(),
        finished_at: new Date(1).toISOString(),
        duration_ms: 1,
        error_message: 'blocked',
        result_json: null,
      };
    },
    async execute(sql: string, params: unknown[]) {
      captured.push({ sql, params });
    },
  };
  const store = new WorkflowRunStore(fakeDb as never);

  await store.markStepFinished({
    runId: 100,
    task: source,
    status: 'blocked',
    errorMessage: 'blocked',
    startedAt: new Date(0).toISOString(),
  });

  const update = captured.find((item) => item.sql.includes('update workflow_run_steps'));
  assert.ok(update);
  assert.equal(update.params.length, 8);
  assert.doesNotMatch(update.sql, /\$9|\$10/);
});

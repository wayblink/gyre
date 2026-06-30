import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkflowRunArtifactRecord, WorkflowRunRecord, WorkflowTask } from '../../shared/types.js';
import {
  applyMonthlyRunPostProcessing,
  createMonthlyRunHistory,
  getMonthlyRun,
  planStatusForWorkflowRunStatus,
  toMonthlyRunHistoryRecord,
} from './store.js';

const task: WorkflowTask = {
  id: 'persist_capitalization_summary',
  name: 'Persist Capitalization Summary',
  operatorCode: 'dataframe.persist.excel',
  operatorVersion: '1.0.0',
  description: '',
  x: 0,
  y: 0,
  params: {},
  inputs: {},
};

function fileArtifact(overrides: Partial<WorkflowRunArtifactRecord> = {}): WorkflowRunArtifactRecord {
  return {
    id: 3,
    runId: 200,
    stepId: 10,
    taskId: 'persist_capitalization_summary',
    artifactType: 'file',
    fileId: 88,
    name: 'Capitalization Summary.xlsx',
    metadata: {
      range: {
        sheetName: 'Capitalization Table (Summary View)',
        a1Range: 'A1:F20',
      },
    },
    createdAt: new Date(0).toISOString(),
    ...overrides,
  };
}

function workflowRun(overrides: Partial<WorkflowRunRecord> = {}): WorkflowRunRecord {
  return {
    id: 200,
    workflowId: 159,
    workflowCode: 'gyre-captable-summary-draft',
    workflowName: 'Gyre Cap Table Summary Draft',
    status: 'completed',
    runtimeParameters: { month: '2026-06', fileIds: { control_book: 7, futu_exercises: 8, option_plans: 9 } },
    tasksSnapshot: [task],
    startedAt: new Date(0).toISOString(),
    finishedAt: new Date(10).toISOString(),
    durationMs: 10,
    errorMessage: null,
    approvedWarningTaskIds: [],
    steps: [],
    artifacts: [fileArtifact()],
    events: [],
    approvals: [],
    ...overrides,
  };
}

class FakeMonthlyDb {
  history: Record<string, unknown> | null = {
    id: 1,
    update_plan_id: 12,
    month_id: 11,
    month_key: '2026-06',
    workflow_id: 159,
    workflow_run_id: 200,
    source_file_id: 7,
    source_file_name: 'source.xlsx',
    produced_file_id: null,
    produced_file_name: null,
    produced_sheet_name: null,
    operator: 'Administrator',
    status: 'running',
    error_message: null,
    triggered_at: new Date(0).toISOString(),
    finished_at: null,
    runtime_parameters_json: { month: '2026-06', fileIds: { control_book: 7, futu_exercises: 8, option_plans: 9 } },
  };
  workflowRows: Array<Record<string, unknown>> = [];
  monthUpdates: Array<{ monthId: number; fileId: number; sheetName: string | null }> = [];
  historyUpdates: Array<Record<string, unknown>> = [];
  planUpdates: Array<Record<string, unknown>> = [];

  async queryOne<T>(sql: string, params: unknown[]): Promise<T | undefined> {
    if (/insert into monthly_run_history/i.test(sql)) {
      this.history = {
        id: 2,
        update_plan_id: params[0],
        month_id: params[1],
        month_key: params[2],
        workflow_id: params[3],
        workflow_run_id: null,
        source_file_id: params[4],
        source_file_name: null,
        produced_file_id: null,
        produced_file_name: null,
        produced_sheet_name: null,
        operator: params[5],
        status: 'running',
        error_message: null,
        triggered_at: new Date(0).toISOString(),
        finished_at: null,
        runtime_parameters_json: JSON.parse(String(params[6])),
      };
      return this.history as T;
    }
    if (/from monthly_run_history/i.test(sql) && /workflow_run_id/i.test(sql)) {
      assert.equal(params[0], 200);
      return (this.history ?? undefined) as T | undefined;
    }
    if (/from monthly_run_history/i.test(sql) && /where h\.id/i.test(sql)) {
      assert.equal(params[0], 1);
      return (this.history ?? undefined) as T | undefined;
    }
    throw new Error(`Unexpected queryOne: ${sql}`);
  }

  async query<T>(sql: string, _params?: unknown[]): Promise<T[]> {
    if (/from workflow_runs/i.test(sql)) return this.workflowRows as T[];
    if (/from product_files/i.test(sql)) return [] as T[];
    return [];
  }

  async execute(sql: string, params: unknown[]): Promise<void> {
    if (/update months/i.test(sql)) {
      this.monthUpdates.push({
        fileId: Number(params[0]),
        sheetName: params[1] === null || params[1] === undefined ? null : String(params[1]),
        monthId: Number(params[2]),
      });
      return;
    }
    if (/update monthly_run_history/i.test(sql)) {
      if (/produced_file_id/i.test(sql)) {
        this.historyUpdates.push({
          status: params[0],
          errorMessage: params[1],
          finishedAt: params[2],
          producedFileId: params[3],
          producedSheetName: params[4],
          id: params[5],
        });
        if (this.history) {
          this.history.status = params[0];
          this.history.error_message = params[1];
          this.history.finished_at = params[2];
          this.history.produced_file_id = params[3];
          this.history.produced_sheet_name = params[4];
        }
      } else {
        this.historyUpdates.push({
          status: params[0],
          errorMessage: params[1],
          finishedAt: params[2],
          id: params[3],
        });
        if (this.history) {
          this.history.status = params[0];
          this.history.error_message = params[1];
          if (params[2]) this.history.finished_at = params[2];
        }
      }
      return;
    }
    if (/update update_plans/i.test(sql)) {
      this.planUpdates.push({
        status: params[0],
        operationTime: params[1],
        id: params[2],
      });
      return;
    }
    throw new Error(`Unexpected execute: ${sql}`);
  }
}

test('planStatusForWorkflowRunStatus maps workflow statuses to Monthly Update statuses', () => {
  assert.equal(planStatusForWorkflowRunStatus('pending'), '进行中');
  assert.equal(planStatusForWorkflowRunStatus('running'), '进行中');
  assert.equal(planStatusForWorkflowRunStatus('waiting_approval'), '待复核');
  assert.equal(planStatusForWorkflowRunStatus('completed'), '已完成');
  assert.equal(planStatusForWorkflowRunStatus('completed_with_warnings'), '已完成');
  assert.equal(planStatusForWorkflowRunStatus('failed'), '失败');
  assert.equal(planStatusForWorkflowRunStatus('skipped'), '已取消');
});

test('createMonthlyRunHistory links update plan and marks it running', async () => {
  const db = new FakeMonthlyDb();

  const history = await createMonthlyRunHistory(db, {
    updatePlanId: 12,
    monthId: 11,
    monthKey: '2026-06',
    workflowId: 159,
    sourceFileId: 7,
    operator: 'root',
    runtimeParameters: { month: '2026-06' },
  });

  assert.equal(history.id, 2);
  assert.deepEqual(db.planUpdates, [
    {
      id: 12,
      status: '进行中',
      operationTime: db.planUpdates[0]?.operationTime,
    },
  ]);
});

test('getMonthlyRun reconciles waiting approval workflow state back to update plan', async () => {
  const db = new FakeMonthlyDb();
  db.workflowRows = [
    {
      id: 200,
      status: 'waiting_approval',
      error_message: null,
      finished_at: null,
    },
  ];

  const history = await getMonthlyRun(db, 1);

  assert.equal(history?.status, 'waiting_approval');
  assert.deepEqual(db.historyUpdates, [
    {
      id: 1,
      status: 'waiting_approval',
      errorMessage: null,
      finishedAt: null,
    },
  ]);
  assert.equal(db.planUpdates.at(-1)?.status, '待复核');
});

test('toMonthlyRunHistoryRecord maps nullable files and runtime parameters', () => {
  const row = new FakeMonthlyDb().history;
  assert.ok(row);

  assert.deepEqual(toMonthlyRunHistoryRecord(row), {
    id: 1,
    monthId: 11,
    monthKey: '2026-06',
    workflowId: 159,
    workflowRunId: 200,
    sourceFileId: 7,
    sourceFileName: 'source.xlsx',
    producedFileId: null,
    producedFileName: null,
    producedSheetName: null,
    operator: 'Administrator',
    status: 'running',
    errorMessage: null,
    triggeredAt: new Date(0).toISOString(),
    finishedAt: null,
    runtimeParameters: { month: '2026-06', fileIds: { control_book: 7, futu_exercises: 8, option_plans: 9 } },
    inputFiles: [],
  });
});

test('applyMonthlyRunPostProcessing mirrors success and points the month summary source to the produced workbook', async () => {
  const db = new FakeMonthlyDb();

  await applyMonthlyRunPostProcessing(db, workflowRun());

  assert.deepEqual(db.monthUpdates, [
    { monthId: 11, fileId: 88, sheetName: 'Capitalization Table (Summary View)' },
  ]);
  assert.deepEqual(db.historyUpdates, [
    {
      id: 1,
      status: 'completed',
      errorMessage: null,
      finishedAt: new Date(10).toISOString(),
      producedFileId: 88,
      producedSheetName: 'Capitalization Table (Summary View)',
    },
  ]);
  assert.equal(db.planUpdates.at(-1)?.status, '已完成');
});

test('applyMonthlyRunPostProcessing mirrors failure without changing the month summary source', async () => {
  const db = new FakeMonthlyDb();

  await applyMonthlyRunPostProcessing(
    db,
    workflowRun({
      status: 'failed',
      errorMessage: 'assertion failed',
      artifacts: [fileArtifact()],
    }),
  );

  assert.deepEqual(db.monthUpdates, []);
  assert.deepEqual(db.historyUpdates, [
    {
      id: 1,
      status: 'failed',
      errorMessage: 'assertion failed',
      finishedAt: new Date(10).toISOString(),
      producedFileId: null,
      producedSheetName: null,
    },
  ]);
  assert.equal(db.planUpdates.at(-1)?.status, '失败');
});

test('applyMonthlyRunPostProcessing keeps waiting approval history running', async () => {
  const db = new FakeMonthlyDb();

  await applyMonthlyRunPostProcessing(db, workflowRun({ status: 'waiting_approval', finishedAt: null }));

  assert.deepEqual(db.monthUpdates, []);
  assert.deepEqual(db.historyUpdates, []);
});

test('applyMonthlyRunPostProcessing ignores non-monthly workflow runs', async () => {
  const db = new FakeMonthlyDb();
  db.history = null;

  await applyMonthlyRunPostProcessing(db, workflowRun());

  assert.deepEqual(db.monthUpdates, []);
  assert.deepEqual(db.historyUpdates, []);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkflowRunArtifactRecord, WorkflowRunRecord, WorkflowTask } from '../../shared/types.js';
import { applyMonthlyRunPostProcessing, toMonthlyRunHistoryRecord } from './store.js';

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
  monthUpdates: Array<{ monthId: number; fileId: number; sheetName: string | null }> = [];
  historyUpdates: Array<Record<string, unknown>> = [];

  async queryOne<T>(sql: string, params: unknown[]): Promise<T | undefined> {
    if (/from monthly_run_history/i.test(sql) && /workflow_run_id/i.test(sql)) {
      assert.equal(params[0], 200);
      return (this.history ?? undefined) as T | undefined;
    }
    throw new Error(`Unexpected queryOne: ${sql}`);
  }

  async query<T>(_sql: string, _params?: unknown[]): Promise<T[]> {
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
      return;
    }
    throw new Error(`Unexpected execute: ${sql}`);
  }
}

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

import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkflowRunRecord, WorkflowTask } from '../../shared/types.js';
import type { WorkflowBootstrapDb, WorkflowRunCreator, WorkflowRunStarter } from '../workflow/startWorkflowRun.js';
import { triggerMonthlyRecordPageSyncs } from './recordPageSync.js';

/**
 * The record pages resolve their data with `readLatestWorkflowDataFrameArtifact(workflowCode, taskId,
 * month)`, which only sees a run of *their own* workflow tagged with `month`. Invoking the syncs
 * inline from the monthly workflow attaches the artifacts to the monthly run instead, so each page
 * gets its own run here.
 */

const CHILD_TASKS: WorkflowTask[] = [
  {
    id: 'persist',
    name: 'Persist',
    operatorCode: 'dataframe.persist.excel',
    operatorVersion: '1.0.0',
    description: '',
    x: 0,
    y: 0,
    params: { fileName: 'x.xlsx', sheetName: 'S', folderPath: 'output/x' },
    inputs: {},
  },
];

const CHILD_FILE_REFS: Record<string, string[]> = {
  'esop-exercise-record-sync': ['futu_exercises', 'shareworks_exercises'],
  'esop-sold-shares-sync': ['futu_sold_shares'],
  'esop-cancellation-record-sync': ['cancellation_report'],
};

function fakeDb(): WorkflowBootstrapDb {
  return {
    async queryOne(sql: string, params?: unknown[]) {
      assert.match(sql, /workflow_definitions/);
      const code = String(params?.[0] ?? '');
      return {
        id: Object.keys(CHILD_FILE_REFS).indexOf(code) + 100,
        code,
        status: 'active',
        tasks_json: JSON.stringify(CHILD_TASKS),
        runtime_params_schema_json: JSON.stringify({
          fileRefs: {
            type: 'object',
            label: 'fileRefs',
            properties: Object.fromEntries((CHILD_FILE_REFS[code] ?? []).map((key) => [key, { type: 'object' }])),
          },
          month: { type: 'string', label: 'Month' },
          monthUnderscore: { type: 'string', label: 'Month (underscore)' },
        }),
        runtime_params_defaults_json: '{}',
      };
    },
    async query() {
      return [];
    },
  } as unknown as WorkflowBootstrapDb;
}

function monthlyRun(): WorkflowRunRecord {
  return {
    id: 1,
    workflowId: 1,
    workflowCode: 'gyre-captable-summary-v2',
    status: 'completed',
    runtimeParameters: {
      month: '2026-08',
      monthUnderscore: '2026_08',
      fileRefs: {
        incremental_futu_exercises: { provider: 'product-files', key: 'futu.xlsx', sheet: '行权明细数据' },
        exercise_record_shareworks: { provider: 'product-files', key: 'sw.xlsx', sheet: 'Executive Awards OS Only' },
        incremental_cancel_restore_report: { provider: 'product-files', key: 'cancel.xlsx' },
      },
    },
  } as unknown as WorkflowRunRecord & Partial<WorkflowRunRecord> as WorkflowRunRecord & {
    runtimeParameters: unknown;
  } as unknown as WorkflowRunRecord;
}

function harness() {
  const created: Array<{ code: string; runtimeParameters: Record<string, unknown> }> = [];
  const started: number[] = [];
  const runStore = {
    async createRun(input: { workflow: Record<string, unknown>; runtimeParameters: Record<string, unknown> }) {
      created.push({ code: String(input.workflow.code), runtimeParameters: input.runtimeParameters });
      return { id: created.length, workflowCode: input.workflow.code, status: 'pending' } as WorkflowRunRecord;
    },
  } as unknown as WorkflowRunCreator;
  const executor = {
    startAsync(runId: number) {
      started.push(runId);
    },
  } as unknown as WorkflowRunStarter;
  return { created, started, deps: { db: fakeDb(), runStore, executor } };
}

test('a successful monthly run starts one month-tagged sync run per record page', async () => {
  const h = harness();
  await triggerMonthlyRecordPageSyncs(h.deps, monthlyRun());

  assert.deepEqual(
    h.created.map((item) => item.code),
    ['esop-exercise-record-sync', 'esop-sold-shares-sync', 'esop-cancellation-record-sync'],
  );
  assert.equal(h.started.length, 3, 'every created run must be started');

  const [exercise, sold, cancellation] = h.created;
  assert.equal(exercise.runtimeParameters.month, '2026-08');
  assert.equal(exercise.runtimeParameters.monthUnderscore, '2026_08');
  // The Futu view reuses the monthly's own Futu exercise export.
  assert.deepEqual((exercise.runtimeParameters.fileRefs as Record<string, unknown>).futu_exercises, {
    provider: 'product-files',
    key: 'futu.xlsx',
    sheet: '行权明细数据',
  });
  assert.deepEqual(
    (sold.runtimeParameters.fileRefs as Record<string, unknown>).futu_sold_shares,
    {},
    'unbound source stays empty',
  );
  assert.equal(
    ((cancellation.runtimeParameters.fileRefs as Record<string, unknown>).cancellation_report as { key: string }).key,
    'cancel.xlsx',
  );
});

test('the sync runs are skipped for other workflows and for unfinished monthly runs', async () => {
  const h = harness();
  await triggerMonthlyRecordPageSyncs(h.deps, {
    ...monthlyRun(),
    workflowCode: 'esop-sold-shares-sync',
  } as WorkflowRunRecord);
  await triggerMonthlyRecordPageSyncs(h.deps, { ...monthlyRun(), status: 'waiting_approval' } as WorkflowRunRecord);
  await triggerMonthlyRecordPageSyncs(h.deps, { ...monthlyRun(), status: 'failed' } as WorkflowRunRecord);
  assert.equal(h.created.length, 0);
});

test('a monthly run without a month parameter does not spawn snapshots', async () => {
  const h = harness();
  const run = monthlyRun();
  (run as unknown as { runtimeParameters: Record<string, unknown> }).runtimeParameters = { fileRefs: {} };
  await triggerMonthlyRecordPageSyncs(h.deps, run);
  assert.equal(h.created.length, 0);
});

test('a failing sync start is logged instead of failing the monthly run', async () => {
  const failures: unknown[] = [];
  const runStore = {
    async createRun() {
      throw new Error('boom');
    },
  } as unknown as WorkflowRunCreator;
  await triggerMonthlyRecordPageSyncs(
    { db: fakeDb(), runStore, executor: { startAsync() {} } as unknown as WorkflowRunStarter },
    monthlyRun(),
    { error: (obj) => failures.push(obj) },
  );
  assert.equal(failures.length, 3, 'each page failure is reported');
});

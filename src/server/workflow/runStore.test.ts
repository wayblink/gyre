import assert from 'node:assert/strict';
import test from 'node:test';

import { projectRunRecordLight, WorkflowRunStore } from './runStore.js';
import type { WorkflowDataFrame, WorkflowRunRecord } from '../../shared/types.js';

function bigDataFrame(): WorkflowDataFrame {
  const rows = Array.from({ length: 100 }, (_, i) => ({ bc_subplan_cancelled_adjustment: i, v: i }));
  return {
    columns: ['bc_subplan_cancelled_adjustment', 'v'],
    rows,
    index: rows.map((_, i) => i),
    matrix: rows.map((row) => [row.bc_subplan_cancelled_adjustment, row.v]),
    range: { sheetName: 'S', a1Range: 'A1:B100' } as never,
    cells: rows.map(() => [{ value: 1 } as never, { value: 2 } as never]),
  };
}

function makeRun(): WorkflowRunRecord {
  const step = (id: number, taskId: string, result: unknown) => ({
    id,
    runId: 1,
    taskId,
    taskName: taskId.toUpperCase(),
    description: '',
    operatorCode: 'op',
    status: 'completed',
    lockToken: null,
    lockedAt: null,
    attemptCount: 1,
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    errorMessage: null,
    result,
  });
  return {
    id: 1,
    workflowId: 1,
    versionId: null,
    workflowCode: 'wf',
    workflowName: 'WF',
    status: 'completed',
    runtimeParameters: {},
    tasksSnapshot: [],
    startedAt: '',
    finishedAt: null,
    durationMs: null,
    errorMessage: null,
    approvedWarningTaskIds: [],
    events: [],
    approvals: [],
    steps: [
      step(1, 't1', { kind: 'dataframe', dataFrame: bigDataFrame() }),
      step(2, 't2', { kind: 'assert', assertion: { passed: true, failureMessage: '' }, dataFrame: bigDataFrame() }),
    ],
    artifacts: [
      {
        id: 1,
        runId: 1,
        stepId: 1,
        taskId: 't1',
        artifactType: 'dataframe',
        fileId: null,
        name: 'a',
        metadata: { rows: 100, columns: 2, range: {}, dataframe: bigDataFrame() },
        createdAt: '',
      },
    ],
  } as unknown as WorkflowRunRecord;
}

test('projectRunRecordLight trims step dataframes to a few sample rows but keeps shape and rows[0]', () => {
  const run = makeRun();
  const light = projectRunRecordLight(run);

  const s1 = light.steps[0].result;
  assert.equal(s1?.kind, 'dataframe');
  if (s1?.kind === 'dataframe') {
    assert.equal(s1.dataFrame.rows.length, 5); // trimmed from 100
    assert.equal(s1.dataFrame.rows[0].bc_subplan_cancelled_adjustment, 0); // rows[0] preserved (BC adjustment)
    assert.deepEqual(s1.dataFrame.columns, ['bc_subplan_cancelled_adjustment', 'v']); // shape kept
    assert.deepEqual(s1.dataFrame.matrix, []); // heavy matrix dropped
    assert.equal(s1.dataFrame.cells, undefined); // heavy cells dropped
    assert.equal(s1.dataFrame.index.length, 5);
  }
});

test('projectRunRecordLight keeps assertion on assert steps', () => {
  const light = projectRunRecordLight(makeRun());
  const s2 = light.steps[1].result;
  assert.equal(s2?.kind, 'assert');
  if (s2?.kind === 'assert') {
    assert.ok(s2.assertion);
    assert.equal(s2.dataFrame.rows.length, 5);
  }
});

test('projectRunRecordLight drops the artifact metadata dataframe but keeps its shape counts', () => {
  const light = projectRunRecordLight(makeRun());
  const metadata = light.artifacts[0].metadata as Record<string, unknown>;
  assert.equal('dataframe' in metadata, false);
  assert.equal(metadata.rows, 100);
  assert.equal(metadata.columns, 2);
});

test('projectRunRecordLight does not mutate the original run (execution path stays full)', () => {
  const run = makeRun();
  projectRunRecordLight(run);
  const original = run.steps[0].result;
  assert.equal(original?.kind === 'dataframe' && original.dataFrame.rows.length, 100);
  assert.ok('dataframe' in (run.artifacts[0].metadata as Record<string, unknown>));
});

test("persistArtifact records an invoked child's own files under the child task ids", async () => {
  const inserts: Array<{ taskId: string; fileId: number | null; metadata: Record<string, unknown> }> = [];
  const db = {
    async queryOne(sql: string, params?: unknown[]) {
      assert.match(sql, /insert into workflow_run_artifacts/);
      const [runId, stepId, taskId, artifactType, fileId, name, metadata] = params as unknown[];
      inserts.push({
        taskId: String(taskId),
        fileId: fileId === null ? null : Number(fileId),
        metadata: JSON.parse(String(metadata)),
      });
      return {
        id: inserts.length,
        run_id: runId,
        step_id: stepId,
        task_id: taskId,
        artifact_type: artifactType,
        file_id: fileId,
        name,
        metadata_json: metadata,
        created_at: new Date().toISOString(),
      };
    },
    async execute() {
      return { rowCount: 1 };
    },
  };
  const store = new WorkflowRunStore(db as never);
  const file = (id: number, name: string) => ({ id, originalName: name, displayName: name }) as never;
  const task = { id: 'invoke_exercise_record_sync', name: 'Invoke Exercise Record Sync' } as never;
  const dataFrame = bigDataFrame();

  await store.persistArtifact(9, task, 77, {
    kind: 'file',
    file: file(2, 'exercise_record_shareworks_2026_08.xlsx'),
    dataFrame,
    nestedArtifacts: [
      {
        taskId: 'persist_exercise_record_file',
        taskName: 'Persist Futu',
        file: file(1, 'exercise_record_2026_08.xlsx'),
        dataFrame,
      },
      {
        taskId: 'persist_exercise_record_shareworks_file',
        taskName: 'Persist Shareworks',
        file: file(2, 'exercise_record_shareworks_2026_08.xlsx'),
        dataFrame,
      },
    ],
  });

  assert.deepEqual(
    inserts.map((row) => row.taskId),
    ['invoke_exercise_record_sync', 'persist_exercise_record_file', 'persist_exercise_record_shareworks_file'],
    'the invoke artifact plus one per child persist',
  );
  assert.deepEqual(
    inserts.slice(1).map((row) => row.fileId),
    [1, 2],
  );
  assert.equal(inserts[1].metadata.invokedBy, 'invoke_exercise_record_sync');
});

test('persistArtifact ignores nested artifacts unless the invoke cascades them', async () => {
  const taskIds: string[] = [];
  const db = {
    async queryOne(_sql: string, params?: unknown[]) {
      taskIds.push(String((params as unknown[])[2]));
      return {
        id: taskIds.length,
        run_id: 1,
        step_id: 1,
        task_id: 'x',
        artifact_type: 'dataframe',
        file_id: null,
        name: 'x',
        metadata_json: '{}',
        created_at: new Date().toISOString(),
      };
    },
    async execute() {
      return { rowCount: 1 };
    },
  };
  const store = new WorkflowRunStore(db as never);
  await store.persistArtifact(9, { id: 'invoke', name: 'Invoke' } as never, 1, {
    kind: 'dataframe',
    dataFrame: bigDataFrame(),
    // A dataframe result cannot carry nested artifacts; nothing must be invented.
  });
  assert.deepEqual(taskIds, ['invoke']);
});

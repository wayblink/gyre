import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkflowTask, WorkflowTaskPreviewResult } from '../../shared/types.js';
import { attachNestedArtifacts } from './invokeArtifacts.js';

/**
 * `workflow.invoke` returns one result, so a child that persists several files would lose all but
 * one. Record pages look their snapshot up by task id + month, so the missing files would simply be
 * invisible when the monthly run produced them.
 */

const CHILD_TASKS = [
  { id: 'extract_futu', name: 'Extract Futu' },
  { id: 'persist_futu', name: 'Persist Futu' },
  { id: 'persist_shareworks', name: 'Persist Shareworks' },
] as unknown as WorkflowTask[];

function file(id: number, name: string): WorkflowTaskPreviewResult {
  return {
    kind: 'file',
    file: { id, originalName: name, displayName: name } as never,
    dataFrame: { columns: ['a'], rows: [{ a: 1 }] } as never,
  };
}

test('every file the child persisted is carried on the returned result', () => {
  const futu = file(1, 'exercise_record_2026_08.xlsx');
  const shareworks = file(2, 'exercise_record_shareworks_2026_08.xlsx');
  const result = attachNestedArtifacts(
    shareworks,
    { extract_futu: { kind: 'dataframe' } as never, persist_futu: futu, persist_shareworks: shareworks },
    CHILD_TASKS,
  );

  assert.equal(result.kind, 'file');
  const nested = result.kind === 'file' ? result.nestedArtifacts : undefined;
  assert.deepEqual(nested?.map((item) => item.taskId).sort(), ['persist_futu', 'persist_shareworks']);
  // The child's own task names are kept, so the artifact list reads like a standalone run would.
  assert.equal(nested?.find((item) => item.taskId === 'persist_shareworks')?.taskName, 'Persist Shareworks');
});

test("files are carried even when the child's final result is not a file", () => {
  // Which task the engine reports as `result` depends on execution order; a child ending on a plain
  // transform must still surface what its persist tasks wrote.
  const shareworks = file(2, 'exercise_record_shareworks_2026_04.xlsx');
  const transform: WorkflowTaskPreviewResult = { kind: 'dataframe', dataFrame: { columns: ['a'], rows: [] } as never };

  const result = attachNestedArtifacts(transform, { persist_shareworks: shareworks }, CHILD_TASKS);

  assert.equal(result.kind, 'dataframe');
  assert.deepEqual(
    result.nestedArtifacts?.map((item) => item.taskId),
    ['persist_shareworks'],
  );
});

test('a child that persists nothing leaves the result untouched', () => {
  const result: WorkflowTaskPreviewResult = { kind: 'dataframe', dataFrame: { columns: [], rows: [] } as never };
  assert.equal(attachNestedArtifacts(result, {}, CHILD_TASKS), result);
});

test('a result with no child files gets no list at all', () => {
  const dataframe: WorkflowTaskPreviewResult = { kind: 'dataframe', dataFrame: { columns: [], rows: [] } as never };

  const result = attachNestedArtifacts(dataframe, { extract_futu: { kind: 'dataframe' } as never }, CHILD_TASKS);

  assert.equal('nestedArtifacts' in result, false);
});

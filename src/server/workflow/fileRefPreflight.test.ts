import test from 'node:test';
import assert from 'node:assert/strict';
import type { WorkflowTask } from '../../shared/types.js';
import {
  collectFileRefProblems,
  findFileRefProblems,
  formatFileRefProblems,
  indexProductFiles,
  referencedProductFiles,
} from './fileRefPreflight.js';

function task(id: string, params: Record<string, unknown>): WorkflowTask {
  return { id, name: id, inputs: {}, params, dependsOn: [] } as unknown as WorkflowTask;
}

const index = indexProductFiles([
  { id: 10, logical_path: 'input/a.xlsx' },
  { id: 11, logical_path: 'output/b.xlsx' },
]);

test('a resolved product-file reference passes', () => {
  const problems = collectFileRefProblems({
    tasks: [task('extract', { fileRef: { provider: 'product-files', key: 'input/a.xlsx' } })],
    runtimeFileRefs: { a: { provider: 'product-files', key: 'input/a.xlsx', sheet: 'S' } },
    index,
  });
  assert.equal(problems.length, 0);
});

test('a fileRef with no provider/key is reported as unresolved against its source key', () => {
  const problems = collectFileRefProblems({
    tasks: [task('extract_option_plans_summary', { fileRef: { sheet: '!Option Plans' } })],
    runtimeFileRefs: { option_plans_summary: { sheet: '!Option Plans' } },
    index,
  });
  assert.equal(problems.length, 2);
  assert.equal(problems[0].sourceKey, 'option_plans_summary');
  assert.equal(problems[0].reason, 'unresolved');
  assert.equal(problems[1].taskName, 'extract_option_plans_summary');
  assert.equal(problems[1].reason, 'unresolved');
});

test('a default pointing at a file no task writes is reported as missing', () => {
  const problems = collectFileRefProblems({
    tasks: [
      task('extract_base', {
        fileRef: { provider: 'product-files', key: 'output/futu-exercises/Futu_Exercises_Base.xlsx' },
      }),
    ],
    runtimeFileRefs: {
      base_futu_exercises: { provider: 'product-files', key: 'output/futu-exercises/Futu_Exercises_Base.xlsx' },
    },
    index,
  });
  assert.equal(problems.length, 2);
  assert.equal(problems[0].reason, 'missing');
  assert.match(problems[0].fileKey, /Futu_Exercises_Base\.xlsx$/);
});

test('a reference by id is checked against product_files.id', () => {
  assert.equal(
    collectFileRefProblems({
      tasks: [task('extract', { fileId: 10 })],
      index,
    }).length,
    0,
  );
  const problems = collectFileRefProblems({
    tasks: [task('extract', { fileId: 999 })],
    index,
  });
  assert.equal(problems.length, 1);
  assert.equal(problems[0].fileKey, '#999');
  assert.equal(problems[0].reason, 'missing');
});

test('an unset optional source is not a problem', () => {
  const problems = collectFileRefProblems({
    tasks: [task('extract', { fileRef: { provider: 'product-files', key: 'input/a.xlsx' } })],
    runtimeFileRefs: { series_b: undefined, bc_subplan_transfer: null },
    index,
  });
  assert.equal(problems.length, 0);
});

test('a $fromRuntime descriptor that survived resolution is unresolved, not a real key', () => {
  const problems = collectFileRefProblems({
    tasks: [task('extract', { fileRef: { $fromRuntime: 'fileRefs.option_plans_summary', $default: { sheet: 'S' } } })],
    runtimeFileRefs: { option_plans_summary: { $fromRuntime: 'fileRefs.option_plans_summary' } },
    index,
  });
  assert.equal(problems.length, 2);
  assert.ok(problems.every((problem) => problem.reason === 'unresolved'));
});

test('nested fileRefs (persist sheets) are found', () => {
  const problems = collectFileRefProblems({
    tasks: [
      task('persist', {
        sheets: [{ inputSlot: 'df', sheetName: 'S', fileRef: { provider: 'product-files', key: 'gone.xlsx' } }],
      }),
    ],
    index,
  });
  assert.equal(problems.length, 1);
  assert.equal(problems[0].taskName, 'persist');
});

test('non product-files providers are left alone', () => {
  const problems = collectFileRefProblems({
    tasks: [task('extract', { fileRef: { provider: 's3', bucket: 'b', key: 'k' } })],
    index,
  });
  assert.equal(problems.length, 0);
});

test('every problem is listed in one message', () => {
  const problems = collectFileRefProblems({
    tasks: [
      task('extract_option_plans_summary', { fileRef: { sheet: 'S' } }),
      task('extract_base', {
        fileRef: { provider: 'product-files', key: 'output/futu-exercises/Futu_Exercises_Base.xlsx' },
      }),
    ],
    runtimeFileRefs: {
      option_plans_summary: { sheet: 'S' },
      base_futu_exercises: { provider: 'product-files', key: 'output/futu-exercises/Futu_Exercises_Base.xlsx' },
    },
    index,
  });
  const message = formatFileRefProblems(problems);
  assert.match(message, /本源 option_plans_summary/);
  assert.match(message, /本源 base_futu_exercises/);
  assert.match(message, /任务 extract_base/);
});

test('referencedProductFiles collects keys and ids, skipping unresolved descriptors', () => {
  const references = referencedProductFiles({
    tasks: [
      task('a', { fileRef: { provider: 'product-files', key: 'input/a.xlsx' } }),
      task('b', { fileRef: { provider: 'product-files', id: 11 } }),
      task('c', { fileRef: { $fromRuntime: 'fileRefs.nope' } }),
    ],
    runtimeFileRefs: { x: { provider: 'product-files', key: 'output/b.xlsx' } },
  });
  assert.deepEqual(references.keys.sort(), ['input/a.xlsx', 'output/b.xlsx']);
  assert.deepEqual(references.ids, [11]);
});

test('findFileRefProblems returns null when nothing is referenced or everything resolves', async () => {
  const db = {
    async query(sql: string, params: unknown[]) {
      assert.match(sql, /logical_path = any/);
      assert.deepEqual(params[0], ['input/a.xlsx']);
      return [{ id: 10, logical_path: 'input/a.xlsx' }];
    },
  };
  const ok = await findFileRefProblems({
    db,
    tasks: [task('extract', { fileRef: { provider: 'product-files', key: 'input/a.xlsx' } })],
    runtimeFileRefs: { a: { provider: 'product-files', key: 'input/a.xlsx' } },
  });
  assert.equal(ok, null);

  const none = await findFileRefProblems({ db, tasks: [task('extract', { sheetName: 'S' })] });
  assert.equal(none, null);
});

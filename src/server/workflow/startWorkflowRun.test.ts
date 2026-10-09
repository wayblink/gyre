import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolveWorkflowRunPlan } from './startWorkflowRun.js';

/**
 * `resolveWorkflowRunPlan` is the shared bootstrap for every "start a workflow run" entry point, and
 * those entry points hand it bindings in two different shapes:
 *
 *  - ESOP / data-management pages pass `sources` (fileId + sheet), which this module resolves to
 *    product-file keys.
 *  - Monthly Update resolves the instance's saved sources to keys itself and passes them through
 *    `runtimeParameters.fileRefs` (it also post-processes that object afterwards).
 *
 * A regression here is invisible until a run executes: the monthly page silently ran against the
 * workflow definition's `$default` placeholders, so every monthly run failed on files that do not
 * exist. These tests pin both shapes.
 */

const WORKFLOW = {
  id: 1,
  code: 'gyre-captable-summary-v2',
  tasks_json: JSON.stringify([{ id: 'extract', name: 'Extract', operatorCode: 'sql', inputs: {} }]),
  // fileRefs children are objects (provider/key/sheet), matching the real definition's schema.
  runtime_params_schema_json: JSON.stringify({
    month: { type: 'string' },
    fileRefs: {
      type: 'object',
      properties: {
        base_futu_exercises: { type: 'object' },
        option_plans_summary: { type: 'object' },
        incremental_control_book: { type: 'object' },
      },
    },
  }),
  runtime_params_defaults_json: JSON.stringify({}),
};

const PRODUCT_FILES = [
  { id: 156, logical_path: 'futu_exercises/Futu_Exercises_Base_2026_05.xlsx' },
  { id: 161, logical_path: 'input/2026-06/Gyre Option Plans Summary SL.xlsx' },
];

function fakeDb(files: typeof PRODUCT_FILES = PRODUCT_FILES) {
  const queries: Array<{ sql: string; params?: unknown[] }> = [];
  return {
    queries,
    async queryOne(sql: string, params?: unknown[]) {
      queries.push({ sql, params });
      return files.find((file) => file.id === Number(params?.[0])) as Record<string, unknown> | undefined;
    },
    async query(sql: string, params?: unknown[]) {
      queries.push({ sql, params });
      const ids = (params?.[0] as number[]) ?? [];
      return files.filter((file) => ids.includes(file.id)).map((file) => ({ ...file })) as Array<
        Record<string, unknown>
      >;
    },
  };
}

test('bindings passed as sources are resolved to product-file keys', async () => {
  const db = fakeDb();
  const plan = await resolveWorkflowRunPlan({
    db,
    workflow: WORKFLOW,
    sources: { option_plans_summary: { fileId: 161, sheet: 'Summary' } },
  });

  assert.deepEqual(plan.runtimeParameters.fileRefs, {
    option_plans_summary: {
      provider: 'product-files',
      key: 'input/2026-06/Gyre Option Plans Summary SL.xlsx',
      sheet: 'Summary',
    },
  });
  // One query for all sources, not one per source.
  assert.equal(db.queries.filter((entry) => entry.sql.includes('product_files')).length, 1);
});

test('fileRefs passed through runtimeParameters survive when no sources are given', async () => {
  const db = fakeDb();
  const plan = await resolveWorkflowRunPlan({
    db,
    workflow: WORKFLOW,
    runtimeParameters: {
      month: '2026-06',
      fileRefs: {
        base_futu_exercises: { provider: 'product-files', key: 'futu_exercises/Futu_Exercises_Base_2026_05.xlsx' },
        option_plans_summary: { provider: 'product-files', key: 'input/2026-06/Gyre Option Plans Summary SL.xlsx' },
      },
    },
  });

  assert.deepEqual(plan.runtimeParameters.month, '2026-06');
  assert.deepEqual(plan.runtimeParameters.fileRefs, {
    base_futu_exercises: { provider: 'product-files', key: 'futu_exercises/Futu_Exercises_Base_2026_05.xlsx' },
    option_plans_summary: { provider: 'product-files', key: 'input/2026-06/Gyre Option Plans Summary SL.xlsx' },
  });
});

test('sources override the same key passed through runtimeParameters', async () => {
  const db = fakeDb();
  const plan = await resolveWorkflowRunPlan({
    db,
    workflow: WORKFLOW,
    sources: { option_plans_summary: { fileId: 161 } },
    runtimeParameters: {
      fileRefs: { option_plans_summary: { provider: 'product-files', key: 'stale/path.xlsx' } },
    },
  });

  assert.deepEqual(plan.runtimeParameters.fileRefs, {
    option_plans_summary: { provider: 'product-files', key: 'input/2026-06/Gyre Option Plans Summary SL.xlsx' },
  });
});

test('a binding whose file no longer resolves does not wipe the other fileRefs', async () => {
  const db = fakeDb([{ id: 161, logical_path: 'input/2026-06/Gyre Option Plans Summary SL.xlsx' }]);
  const plan = await resolveWorkflowRunPlan({
    db,
    workflow: WORKFLOW,
    sources: {
      // 156 is gone from product_files, so it cannot be resolved.
      base_futu_exercises: { fileId: 156 },
      option_plans_summary: { fileId: 161 },
    },
    runtimeParameters: {
      fileRefs: { incremental_control_book: { provider: 'product-files', key: 'input/2026-06/detail.xlsx' } },
    },
  });

  assert.deepEqual(plan.runtimeParameters.fileRefs, {
    incremental_control_book: { provider: 'product-files', key: 'input/2026-06/detail.xlsx' },
    option_plans_summary: { provider: 'product-files', key: 'input/2026-06/Gyre Option Plans Summary SL.xlsx' },
  });
});

test('runtime parameters without fileRefs still get a fileRefs object', async () => {
  const plan = await resolveWorkflowRunPlan({
    db: fakeDb(),
    workflow: WORKFLOW,
    runtimeParameters: { month: '2026-07' },
  });
  assert.deepEqual(plan.runtimeParameters.fileRefs, {});
  assert.deepEqual(plan.runtimeParameters.month, '2026-07');
});

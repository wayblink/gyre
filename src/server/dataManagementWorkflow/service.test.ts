import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkflowRunCreateInput } from '../workflow/runRepository.js';
import { startDataManagementWorkflow } from './service.js';

test('business service resolves Plan Summary by stable code and starts a run', async () => {
  const calls: WorkflowRunCreateInput[] = [];
  const workflow = {
    id: 51,
    code: 'plan-summary-sync',
    name: 'Plan Summary Sync',
    tasks_json: JSON.stringify([]),
    runtime_params_schema_json: JSON.stringify({
      fileRefs: { type: 'object', properties: { option_plans_summary: { type: 'object', properties: { sheet: { type: 'string' } } } } },
    }),
    runtime_params_defaults_json: JSON.stringify({
      fileRefs: { option_plans_summary: { sheet: '!Option Plans Summary (Post-Gyr' } },
    }),
  };
  const fakeRun = { id: 91 } as never;
  const result = await startDataManagementWorkflow(
    {
      async queryOne(_sql, params) {
        if (_sql.includes('logical_path')) return { logical_path: 'input/2026-05/option-plans-summary.xlsx' };
        assert.deepEqual(params, ['plan-summary-sync']);
        return workflow;
      },
      async query(sql, params) {
        if (sql.includes('global_parameters')) return [];
        assert.match(sql, /select id, logical_path from product_files where id = any/);
        assert.deepEqual(params, [[4]]);
        return [{ id: 4, logical_path: 'input/2026-05/option-plans-summary.xlsx' }];
      },
    },
    {
      async createRun(input) { calls.push(input); return fakeRun; },
    },
    { startAsync(runId) { assert.equal(runId, 91); } },
    'plan-summary',
    { option_plans_summary: { fileId: 4 } },
  );
  assert.equal(result, fakeRun);
  assert.deepEqual(calls[0]?.runtimeParameters, {
    fileRefs: {
      option_plans_summary: {
        provider: 'product-files',
        key: 'input/2026-05/option-plans-summary.xlsx',
        sheet: '!Option Plans Summary (Post-Gyr',
      },
    },
  });
});

test('5% Holders workflow refuses to start when global fixed values are missing', async () => {
  const workflow = {
    id: 52,
    code: 'five-percent-holders-sync',
    name: '5% Holders Sync',
    tasks_json: '[]',
    runtime_params_schema_json: '{}',
    runtime_params_defaults_json: '{}',
  };
  await assert.rejects(
    () => startDataManagementWorkflow(
      {
        async queryOne(_sql, params) {
          assert.deepEqual(params, ['five-percent-holders-sync']);
          return workflow;
        },
        async query<T extends Record<string, unknown> = Record<string, unknown>>(_sql: string, params?: unknown[]): Promise<T[]> {
          assert.deepEqual(params, [[
            'fivePercentHoldersGniCommonStock',
            'fivePercentHoldersGniTotalCses',
            'fivePercentHoldersSongjiangMaCommonStock',
            'fivePercentHoldersSongjiangMaTotalCses',
          ]]);
          return [
            { key: 'fivePercentHoldersGniCommonStock', value: 1 },
            { key: 'fivePercentHoldersGniTotalCses', value: 2 },
          ] as unknown as T[];
        },
      },
      {
        async createRun() { throw new Error('should not create run'); },
      },
      { startAsync() { throw new Error('should not start run'); } },
      'five-percent-holders',
      { capitalization_summary: { fileId: 4 } },
    ),
    /Missing 5% Holders fixed values: fivePercentHoldersSongjiangMaCommonStock, fivePercentHoldersSongjiangMaTotalCses/,
  );
});

test('5% Holders workflow ignores system-generated fixed values', async () => {
  const workflow = {
    id: 54,
    code: 'five-percent-holders-sync',
    name: '5% Holders Sync',
    tasks_json: '[]',
    runtime_params_schema_json: '{}',
    runtime_params_defaults_json: '{}',
  };
  await assert.rejects(
    () => startDataManagementWorkflow(
      {
        async queryOne() {
          return workflow;
        },
        async query<T extends Record<string, unknown> = Record<string, unknown>>(): Promise<T[]> {
          return [
            { key: 'fivePercentHoldersGniCommonStock', value: 11, updated_by: 'system' },
            { key: 'fivePercentHoldersGniTotalCses', value: 12, updated_by: 'system' },
            { key: 'fivePercentHoldersSongjiangMaCommonStock', value: 13, updated_by: 'system' },
            { key: 'fivePercentHoldersSongjiangMaTotalCses', value: 14, updated_by: 'system' },
          ] as unknown as T[];
        },
      },
      {
        async createRun() { throw new Error('should not create run'); },
      },
      { startAsync() { throw new Error('should not start run'); } },
      'five-percent-holders',
      { capitalization_summary: { fileId: 4 } },
    ),
    /Missing 5% Holders fixed values/,
  );
});

test('5% Holders workflow passes all global fixed values as runtime parameters', async () => {
  const calls: WorkflowRunCreateInput[] = [];
  const workflow = {
    id: 53,
    code: 'five-percent-holders-sync',
    name: '5% Holders Sync',
    tasks_json: '[]',
    runtime_params_schema_json: JSON.stringify({
      fixedValues: {
        type: 'object',
        properties: {
          fivePercentHoldersGniCommonStock: { type: 'number' },
          fivePercentHoldersGniTotalCses: { type: 'number' },
          fivePercentHoldersSongjiangMaCommonStock: { type: 'number' },
          fivePercentHoldersSongjiangMaTotalCses: { type: 'number' },
        },
      },
      fileRefs: {
        type: 'object',
        properties: {
          capitalization_summary: { type: 'object' },
        },
      },
    }),
    runtime_params_defaults_json: '{}',
  };
  const fakeRun = { id: 92 } as never;
  const result = await startDataManagementWorkflow(
    {
      async queryOne(_sql, params) {
        if (_sql.includes('logical_path')) return { logical_path: 'output/captable/summary.xlsx' };
        assert.deepEqual(params, ['five-percent-holders-sync']);
        return workflow;
      },
      async query(sql: string, params?: unknown[]) {
        if (sql.includes('global_parameters')) {
          assert.deepEqual(params, [[
            'fivePercentHoldersGniCommonStock',
            'fivePercentHoldersGniTotalCses',
            'fivePercentHoldersSongjiangMaCommonStock',
            'fivePercentHoldersSongjiangMaTotalCses',
          ]]);
          return [
            { key: 'fivePercentHoldersGniCommonStock', value: 11 },
            { key: 'fivePercentHoldersGniTotalCses', value: 12 },
            { key: 'fivePercentHoldersSongjiangMaCommonStock', value: 13 },
            { key: 'fivePercentHoldersSongjiangMaTotalCses', value: 14 },
          ];
        }
        assert.match(sql, /select id, logical_path from product_files where id = any/);
        assert.deepEqual(params, [[7]]);
        return [{ id: 7, logical_path: 'output/captable/summary.xlsx' }];
      },
    },
    {
      async createRun(input) { calls.push(input); return fakeRun; },
    },
    { startAsync(runId) { assert.equal(runId, 92); } },
    'five-percent-holders',
    { capitalization_summary: { fileId: 7 } },
  );
  assert.equal(result, fakeRun);
  assert.deepEqual(calls[0]?.runtimeParameters, {
    fixedValues: {
      fivePercentHoldersGniCommonStock: 11,
      fivePercentHoldersGniTotalCses: 12,
      fivePercentHoldersSongjiangMaCommonStock: 13,
      fivePercentHoldersSongjiangMaTotalCses: 14,
    },
    fileRefs: { capitalization_summary: { provider: 'product-files', key: 'output/captable/summary.xlsx' } },
  });
});

import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkflowRunCreateInput } from '../workflow/runRepository.js';
import { startEsopPageWorkflow } from './service.js';

test('business service resolves workflow by stable code and starts a run', async () => {
  const calls: WorkflowRunCreateInput[] = [];
  const workflow = {
    id: 41,
    code: 'esop-exercise-record-sync',
    name: 'ESOP / Exercise to Date Sync',
    tasks_json: JSON.stringify([
      {
        id: 'extract_exercises',
        name: 'Extract exercises',
        operatorCode: 'sheet.range.extract',
        operatorVersion: '1.0.0',
        params: {
          fileRef: { $fromRuntime: 'fileRefs.futu_exercises' },
          sheetName: 'Futu BCI Exercises to Date',
          range: 'A1:M',
          headerRow: 1,
        },
        inputs: {},
        dependsOn: [],
        x: 0,
        y: 0,
      },
    ]),
    runtime_params_schema_json: JSON.stringify({
      fileRefs: {
        type: 'object',
        label: 'fileRefs',
        properties: { futu_exercises: { type: 'object', label: 'Exercises' } },
      },
    }),
    runtime_params_defaults_json: '{}',
  };
  const fakeRun = { id: 88 } as never;
  const result = await startEsopPageWorkflow(
    {
      async queryOne(_sql, params) {
        if (_sql.includes('logical_path')) return { logical_path: 'input/2026-05/exercises.xlsx' };
        assert.deepEqual(params, ['esop-exercise-record-sync']);
        return workflow;
      },
    },
    {
      async createRun(input) {
        calls.push(input);
        return fakeRun;
      },
    },
    { startAsync(runId) { assert.equal(runId, 88); } },
    'exercise-record',
    { futu_exercises: { fileId: 17 } },
  );

  assert.equal(result, fakeRun);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.workflow.code, 'esop-exercise-record-sync');
  assert.deepEqual(calls[0]?.runtimeParameters, {
    fileRefs: { futu_exercises: { provider: 'product-files', key: 'input/2026-05/exercises.xlsx' } },
  });
  assert.deepEqual(calls[0]?.tasks[0]?.params.fileRef, { provider: 'product-files', key: 'input/2026-05/exercises.xlsx' });
});

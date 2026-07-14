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
    tasks_json: JSON.stringify([{
      id: 'extract_shareworks_grants', name: 'Extract', operatorCode: 'sheet.range.extract', operatorVersion: '1.0.0',
      params: { fileRef: { $fromRuntime: 'fileRefs.shareworks_grants' }, sheetName: 'Options OS Detail', range: 'A2:BZ', headerRow: 2 },
      inputs: {}, dependsOn: [], x: 0, y: 0,
    }]),
    runtime_params_schema_json: JSON.stringify({
      fileRefs: { type: 'object', properties: { shareworks_grants: { type: 'object' } } },
    }),
    runtime_params_defaults_json: '{}',
  };
  const fakeRun = { id: 91 } as never;
  const result = await startDataManagementWorkflow(
    {
      async queryOne(_sql, params) {
        assert.deepEqual(params, ['plan-summary-sync']);
        return workflow;
      },
    },
    {
      async createRun(input) { calls.push(input); return fakeRun; },
    },
    { startAsync(runId) { assert.equal(runId, 91); } },
    'plan-summary',
    { shareworks_grants: { fileId: 4 } },
  );
  assert.equal(result, fakeRun);
  assert.deepEqual(calls[0]?.runtimeParameters, {
    fileRefs: { shareworks_grants: { provider: 'product-files', id: 4 } },
  });
});

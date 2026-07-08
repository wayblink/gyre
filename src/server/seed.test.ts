import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDefaultWorkflowSeedDefinition } from './seed.js';

test('default Cap Table Import Flow derives runtime parameters from workflow tasks', () => {
  const workflow = buildDefaultWorkflowSeedDefinition();
  const extractTask = workflow.tasks.find((item) => item.id === 'task_extract_range');

  assert.deepEqual(extractTask?.params.fileRef, { $fromRuntime: 'fileRefs.source' });
  assert.equal(extractTask?.params.fileId, undefined);
  assert.equal(workflow.runtimeParamsSchema.fileRefs?.type, 'object');
  assert.equal(workflow.runtimeParamsSchema.fileRefs?.properties?.source?.type, 'object');
  assert.equal(workflow.runtimeParamsSchema.fileRefs?.properties?.source?.label, 'Extract Excel Range file');
  assert.equal(workflow.runtimeParamsSchema.fileRefs?.required, undefined);
  assert.deepEqual(workflow.runtimeParamsDefaults, {});
});

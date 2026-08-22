import assert from 'node:assert/strict';
import test from 'node:test';
import { requiresAdminRole } from './authorization.js';

test('file mutations require admin while monthly-run reads and new source uploads stay available', () => {
  assert.equal(requiresAdminRole('GET', '/api/files'), false);
  assert.equal(requiresAdminRole('GET', '/api/files/42/content'), false);
  assert.equal(requiresAdminRole('POST', '/api/files/upload'), false);
  assert.equal(requiresAdminRole('POST', '/api/files/upload?conflictPolicy=overwrite'), false);
  assert.equal(requiresAdminRole('PATCH', '/api/files/42'), true);
  assert.equal(requiresAdminRole('POST', '/api/files/42/move'), true);
  assert.equal(requiresAdminRole('PUT', '/api/files/42/content'), true);
  assert.equal(requiresAdminRole('DELETE', '/api/files'), true);
  assert.equal(requiresAdminRole('DELETE', '/api/files/42'), true);
});
test('workflow definition, execution and debugging APIs require admin', () => {
  assert.equal(requiresAdminRole('GET', '/api/workflows'), true);
  assert.equal(requiresAdminRole('POST', '/api/workflows/import'), true);
  assert.equal(requiresAdminRole('PATCH', '/api/workflows/9'), true);
  assert.equal(requiresAdminRole('POST', '/api/workflows/9/execute'), true);
  assert.equal(requiresAdminRole('POST', '/api/workflows/preview-task'), true);
  assert.equal(requiresAdminRole('DELETE', '/api/workflows/9'), true);

  assert.equal(requiresAdminRole('GET', '/api/workflow-runs/7'), false);
  assert.equal(requiresAdminRole('POST', '/api/workflow-runs/7/approvals'), false);
  assert.equal(requiresAdminRole('POST', '/api/workflow-runs/7/cancel'), true);
  assert.equal(requiresAdminRole('POST', '/api/workflow-runs/7/retry-unfinished'), true);
  assert.equal(requiresAdminRole('POST', '/api/workflow-runs/7/steps/task-a/execute'), true);
});

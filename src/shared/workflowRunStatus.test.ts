import assert from 'node:assert/strict';
import test from 'node:test';
import { isWorkflowRunTerminalStatus } from './workflowRunStatus.js';

test('terminal workflow run statuses stop client polling even if a stale step is still running', () => {
  assert.equal(isWorkflowRunTerminalStatus('failed'), true);
  assert.equal(isWorkflowRunTerminalStatus('completed'), true);
  assert.equal(isWorkflowRunTerminalStatus('completed_with_warnings'), true);
  assert.equal(isWorkflowRunTerminalStatus('skipped'), true);
  assert.equal(isWorkflowRunTerminalStatus('running'), false);
  assert.equal(isWorkflowRunTerminalStatus('waiting_approval'), false);
});

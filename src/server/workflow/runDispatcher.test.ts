import assert from 'node:assert/strict';
import test from 'node:test';

import { InProcessWorkflowRunDispatcher } from './runDispatcher.js';

test('a request enqueued while the run is already executing is replayed, not dropped', async () => {
  // The real-world failure: the workflow parks a step for review while the first pass is still
  // walking the remaining nodes; the operator approves, `startAsync` is called for the same run, and
  // the dispatcher dropped it because the run id was already active. The approval was recorded, the
  // parking write landed afterwards, and the run then sat in `waiting_approval` with no pending
  // approval and nobody executing it — "复核点了没反应".
  const calls: string[] = [];
  let releaseFirst = () => {};

  const dispatcher = new InProcessWorkflowRunDispatcher(async (runId, mode) => {
    calls.push(`${runId}:${mode.kind}`);
    if (calls.length === 1) {
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
    }
  });

  dispatcher.enqueue(7, { kind: 'all' });
  await new Promise((resolve) => setTimeout(resolve, 10));
  dispatcher.enqueue(7, { kind: 'all' });
  assert.deepEqual(calls, ['7:all'], 'the second request waits for the active pass');

  releaseFirst();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(calls, ['7:all', '7:all'], 'the replay actually runs the run again');
});

test('a replay collapses to a full pass when either request asks for one', async () => {
  const calls: string[] = [];
  let releaseFirst = () => {};
  const dispatcher = new InProcessWorkflowRunDispatcher(async (runId, mode) => {
    calls.push(`${runId}:${mode.kind}`);
    if (calls.length === 1) {
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
    }
  });

  dispatcher.enqueue(9, { kind: 'all' });
  await new Promise((resolve) => setTimeout(resolve, 10));
  dispatcher.enqueue(9, { kind: 'single', taskId: 'a' });
  dispatcher.enqueue(9, { kind: 'all' });
  releaseFirst();
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.deepEqual(calls, ['9:all', '9:all']);
});

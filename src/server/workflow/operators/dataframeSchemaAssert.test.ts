import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateSchemaAssertion, normalizeSchemaAssertTask } from './dataframeSchemaAssert.js';
import type { WorkflowTask } from '../../../shared/types.js';

function guardTask(params: Record<string, unknown>): WorkflowTask {
  return {
    id: 'guard',
    name: 'Assert Schema',
    operatorCode: 'dataframe.schema.assert',
    operatorVersion: '1.0.0',
    description: '',
    x: 0,
    y: 0,
    params: { mode: 'contains', expectedColumns: '行标签, 总计', ...params },
    inputs: { input1: { from: 'upstream', slot: 'dataframe' } },
  } as unknown as WorkflowTask;
}

test('a not-supplied optional input passes when skipWhenEmpty is set', () => {
  // `sheet.optional-range.extract` yields a dataframe with no columns when the source is unbound.
  // That is a documented state, so the guard must not demand a schema from it.
  const assertion = evaluateSchemaAssertion(guardTask({ skipWhenEmpty: true, failureStrategy: 'warning' }), []);
  assert.equal(assertion.passed, true);
  assert.equal(assertion.actualValue, '(not supplied)');
  // The engine only pauses on `!passed && failureStrategy === 'warning'`, so a passing assertion
  // leaves the run free to continue.
  assert.equal(!assertion.passed && assertion.failureStrategy === 'warning', false);
});

test('skipWhenEmpty still validates the schema once a file is supplied', () => {
  const assertion = evaluateSchemaAssertion(guardTask({ skipWhenEmpty: true }), ['行标签']);
  assert.equal(assertion.passed, false, 'a supplied file with the wrong columns must still fail');
  assert.match(assertion.failureMessage, /总计/);
});

test('without skipWhenEmpty an empty input still fails as before', () => {
  const assertion = evaluateSchemaAssertion(guardTask({}), []);
  assert.equal(assertion.passed, false);
});

test('normalizeTask defaults skipWhenEmpty to false', () => {
  const task = guardTask({});
  normalizeSchemaAssertTask(task);
  assert.equal(task.params.skipWhenEmpty, false);
});

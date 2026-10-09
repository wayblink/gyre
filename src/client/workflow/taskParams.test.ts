import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { WorkflowOperator, WorkflowTask, WorkflowTaskInput } from '../../shared/types.js';
import {
  findInputGuard,
  getCustomParamKeys,
  getInputBindingWithGuards,
  getInputGuardOperator,
  getInputGuardOperators,
  getSqlInputSlots,
  hasCustomStructuredParams,
  normalizeInputGuards,
} from './taskParams.js';

const VALIDATION_OPERATOR = {
  code: 'not_null',
  name: 'Not Null',
  category: 'Validation',
} as unknown as WorkflowOperator;

const TRANSFORM_OPERATOR = {
  code: 'sql_transform',
  name: 'Transform',
  category: 'Transform',
} as unknown as WorkflowOperator;

const OPERATORS = [TRANSFORM_OPERATOR, VALIDATION_OPERATOR];

function task(overrides: Partial<WorkflowTask> = {}): WorkflowTask {
  return {
    id: 't1',
    name: 'Task',
    operatorCode: 'sql_transform',
    operatorVersion: '1.0.0',
    description: '',
    x: 0,
    y: 0,
    params: {},
    inputs: {},
    ...overrides,
  };
}

test('only validation operators may back an input guard', () => {
  assert.deepEqual(
    getInputGuardOperators(OPERATORS).map((operator) => operator.code),
    ['not_null'],
  );
  assert.equal(getInputGuardOperator(OPERATORS, 'not_null')?.name, 'Not Null');
  // A transform operator is not a valid guard type, even though it exists.
  assert.equal(getInputGuardOperator(OPERATORS, 'sql_transform'), null);
  assert.equal(getInputGuardOperator(OPERATORS, 'nope'), null);
});

test('normalizeInputGuards drops unknown types and fills in operator defaults', () => {
  const guards = normalizeInputGuards(
    [
      { type: 'not_null' },
      { type: 'not_null', id: '  ', name: '  ', enabled: false, params: { column: 'a' } },
      { type: 'removed_operator' },
      null,
      'nonsense',
    ],
    OPERATORS,
  );

  assert.equal(guards.length, 2);
  assert.deepEqual(guards[0], {
    id: 'guard_1',
    type: 'not_null',
    name: 'Not Null',
    enabled: true,
    params: {},
  });
  // Blank id/name fall back rather than persisting empty strings.
  assert.equal(guards[1].id, 'guard_2');
  assert.equal(guards[1].name, 'Not Null');
  assert.equal(guards[1].enabled, false);
  assert.deepEqual(guards[1].params, { column: 'a' });
  assert.equal(normalizeInputGuards(undefined, OPERATORS).length, 0);
  assert.equal(normalizeInputGuards({}, OPERATORS).length, 0);
});

test('re-pointing a binding keeps its guards and defaults the slot', () => {
  // Persisted bindings carry untrusted guard data; normalizeInputGuards is what makes them safe.
  const input = {
    from: 'old',
    slot: 'custom',
    guards: [{ type: 'not_null', id: 'g1' }],
  } as unknown as WorkflowTaskInput;
  const next = getInputBindingWithGuards(input, { from: 'new' }, OPERATORS);

  assert.equal(next.from, 'new');
  assert.equal(next.slot, 'dataframe');
  assert.equal(next.guards?.length, 1);
  assert.equal(next.guards?.[0].id, 'g1');
  // A binding with no guards still gets an (empty) array, so the UI never has to branch.
  assert.deepEqual(getInputBindingWithGuards(undefined, { from: 'x' }, OPERATORS).guards, []);
});

test('findInputGuard normalizes every input and returns the match', () => {
  const node = task({
    inputs: {
      a: { from: 'up', slot: 'out', guards: [{ type: 'not_null', id: 'keep' }] },
      b: { from: 'up2', slot: 'out', guards: [{ type: 'not_null', id: 'target' }] },
    } as unknown as WorkflowTask['inputs'],
  });

  assert.equal(findInputGuard(node, 'target', OPERATORS)?.id, 'target');
  assert.equal(findInputGuard(node, 'missing', OPERATORS), null);
  // Both inputs were normalized in place, including the one that did not match.
  assert.equal(node.inputs.a.guards?.[0].name, 'Not Null');
});

test('custom param keys follow the operator family', () => {
  assert.deepEqual([...getCustomParamKeys(task({ operatorCode: 'sql_transform' }))], []);
  assert.ok(getCustomParamKeys(task({ operatorCode: 'sheet.range.extract' })).has('range'));
  assert.ok(getCustomParamKeys(task({ operatorCode: 'sheet.range.extract' })).has('headerRow'));
  assert.ok(getCustomParamKeys(task({ operatorCode: 'sql.compute' })).has('tableBindings'));
  assert.ok(getCustomParamKeys(task({ operatorCode: 'dataframe.persist.excel' })).has('uploadedBy'));
  assert.ok(getCustomParamKeys(task({ operatorCode: 'dataframe.assert' })).has('failureStrategy'));
  // A SQL assert owns both the SQL keys and the assert keys.
  const sqlAssert = [...getCustomParamKeys(task({ operatorCode: 'dataframe.sql.assert' }))];
  assert.ok(sqlAssert.includes('sql'));
  assert.ok(sqlAssert.includes('expectedValue'));
});

test('hasCustomStructuredParams is false for a plain transform task', () => {
  assert.equal(hasCustomStructuredParams(task({ operatorCode: 'sql_transform' })), false);
  assert.equal(hasCustomStructuredParams(task({ operatorCode: 'sheet.range.extract' })), true);
  assert.equal(hasCustomStructuredParams(task({ operatorCode: 'dataframe.assert' })), true);
});

test('sql input slots are the task input keys', () => {
  const node = task({ inputs: { a: { from: 'x', slot: 'out' }, b: { from: 'y', slot: 'out' } } });
  assert.deepEqual(getSqlInputSlots(node), ['a', 'b']);
  assert.deepEqual(getSqlInputSlots(task()), []);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { distinctGrantTypes } from './grantTypes.js';

test('grant type options come from the data and are stable, de-duplicated and sorted', () => {
  assert.deepEqual(distinctGrantTypes(['Option', 'Options (NQ)', 'Option', null, '  ', 'RSU']), [
    'Option',
    'Options (NQ)',
    'RSU',
  ]);
});

test('an empty column yields no options so the control can be hidden instead of rendered dead', () => {
  assert.deepEqual(distinctGrantTypes([]), []);
  assert.deepEqual(distinctGrantTypes([undefined, null, '']), []);
});

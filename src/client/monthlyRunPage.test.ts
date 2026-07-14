import assert from 'node:assert/strict';
import test from 'node:test';

import { retainAvailableSourceBindings } from './monthlyRunPage.js';

test('monthly input bindings survive while the product file list is still loading', () => {
  const bindings = {
    control_book: { fileId: 4 },
    summary_source: { fileId: 4 },
    futu_exercises: { fileId: 4 },
    option_plans: { fileId: 4 },
  };

  assert.deepEqual(retainAvailableSourceBindings(bindings, []), bindings);
});

test('monthly input bindings are filtered after product files have loaded', () => {
  assert.deepEqual(
    retainAvailableSourceBindings(
      {
        control_book: { fileId: 4 },
        summary_source: { fileId: 99 },
      },
      [{ id: 4 }],
    ),
    { control_book: { fileId: 4 } },
  );
});

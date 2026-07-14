import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveDefaultSummaryMonth } from './summaryPage.js';

test('CapTable defaults to the month of the latest successful monthly output', () => {
  assert.equal(
    resolveDefaultSummaryMonth(
      ['2026-06', '2026-05'],
      {
        monthKey: '2026-05',
        fileId: 9,
        fileName: 'latest-result.xlsx',
        finishedAt: '2026-07-13T10:00:00.000Z',
      },
    ),
    '2026-05',
  );
});

test('CapTable falls back to the newest available month when no execution has an output', () => {
  assert.equal(resolveDefaultSummaryMonth(['2026-06', '2026-05'], null), '2026-06');
  assert.equal(resolveDefaultSummaryMonth([], null), '');
});

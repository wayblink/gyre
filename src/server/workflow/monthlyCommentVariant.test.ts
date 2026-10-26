import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import type { WorkflowDataFrame, WorkflowTask } from '../../shared/types.js';
import { executeSqlDataFrameQuery } from './operators/sqlUtils.js';
import type { WorkflowOperatorRuntime } from './operators/types.js';

/**
 * The BC Subplan spelling check in the monthly workflow.
 *
 * The Control Book's `Comment` column identifies the 2025 BC Subplan transfer rows, and the monthly run
 * pauses for review when the spelling is not the canonical "Omnibus Inc. Pl". Spacing, punctuation and
 * case are *not* spelling differences in the source data — Shareworks exports legitimately produce
 * "Omnibus Inc.Pl." — so they must be accepted silently and only a genuinely different word (e.g.
 * "Ominibus") may raise the warning.
 *
 * The rule lives in the DB workflow definition (see CLAUDE.md), so this test loads the shipped seed and
 * executes its real SQL rather than re-implementing the predicate.
 */

const seedPath = path.join(process.cwd(), 'database', 'workflows', 'gyre-captable-summary-v2.json');

type Guard = { id: string; name: string; params: Record<string, unknown>; enabled?: boolean };

/**
 * The check is an input guard (`guard_warn_control_book_comment_variants`) attached to the comment
 * column binding of `calc_control_book_metrics`, not a task of its own.
 */
function commentVariantGuard(): Guard {
  const seed = JSON.parse(readFileSync(seedPath, 'utf8')) as {
    tasks: Array<{ inputs?: Record<string, { guards?: Guard[] }> }>;
  };
  const guards = seed.tasks.flatMap((task) => Object.values(task.inputs ?? {}).flatMap((input) => input.guards ?? []));
  const guard = guards.find((item) => String(item.params?.sql ?? '').includes('comment_variant_hint'));
  assert.ok(guard, 'the monthly seed must still carry the comment-variant guard');
  return guard;
}

function controlBook(comments: string[]): WorkflowDataFrame {
  const rows = comments.map((comment) => ({ Comment: comment, 'Shares Issued': 100 }));
  return {
    columns: ['Comment', 'Shares Issued'],
    rows,
    index: rows.map((_, index) => index + 1),
    matrix: [],
    range: { sheetName: 'EQ Control Book', a1Range: '', startRow: 2, endRow: rows.length + 1, startCol: 1, endCol: 2 },
  };
}

const runtime = {
  rowsToDataFrame: (rows: Array<Record<string, unknown>>) => ({
    columns: Object.keys(rows[0] ?? {}),
    rows,
    index: rows.map((_, index) => index + 1),
    matrix: [],
    range: { sheetName: 'result', a1Range: '', startRow: 1, endRow: rows.length, startCol: 1, endCol: 1 },
  }),
} as unknown as WorkflowOperatorRuntime;

async function hintFor(comments: string[]): Promise<string> {
  const guard = commentVariantGuard();
  const bound = {
    id: guard.id,
    name: guard.name,
    operatorCode: 'dataframe.sql.assert',
    operatorVersion: '1.0.0',
    description: '',
    x: 0,
    y: 0,
    params: {
      ...guard.params,
      tableBindings: [{ inputSlot: 'control_book', tableName: 'control_book' }],
    },
    inputs: { control_book: { from: 'calc_control_book_metrics', slot: 'dataframe' } },
    dependsOn: [],
  } as unknown as WorkflowTask;
  const { dataFrame } = await executeSqlDataFrameQuery(bound, runtime, async () => controlBook(comments));
  const value = dataFrame.rows[0]?.comment_variant_hint;
  return String(value ?? '');
}

test('spacing, punctuation and case variants of "Omnibus Inc. Pl" are accepted without a warning', async () => {
  const hint = await hintFor([
    'Omnibus Inc. Pl',
    'Omnibus Inc. Pl.',
    'Omnibus Inc.Pl',
    'Omnibus Inc.Pl.',
    'OMNIBUS INC.PL.',
    'omnibus inc. pl',
  ]);
  assert.equal(hint, '0 行', `expected no warning, got: ${hint}`);
});

test('a genuinely different spelling still stops the run for review', async () => {
  const hint = await hintFor(['Ominibus Inc. Pl']);
  assert.match(hint, /影响 1 行/);
  assert.match(hint, /Ominibus Inc\. Pl/);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import type { WorkflowDataFrame, WorkflowTask } from '../../shared/types.js';
import { executeSqlDataFrameQuery } from './operators/sqlUtils.js';
import type { WorkflowOperatorRuntime } from './operators/types.js';

/**
 * The Control Book merge must be idempotent even when the two sides store dates differently.
 *
 * Production's January workbook ended up with the same transfer twice: one row kept `As of Date` as an Excel
 * serial (46042) and the other carried the text "2026-01-20" — same day, different cell type. The merge key
 * compared the raw columns, so `46042 = "2026-01-20"` was false and the increment row was appended instead of
 * updating the base row. Every later run appended another copy.
 *
 * Comparing dates by their calendar day (not their cell representation) makes the merge idempotent across
 * export formats. This test runs the shipped SQL rather than re-implementing it.
 */

const mergeSeedPath = path.join(process.cwd(), 'database', 'workflows', 'eq-control-book-incremental-merge.json');

type Row = Record<string, unknown>;

function serial(iso: string): number {
  return Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86_400_000);
}

function baseRow(): Row {
  return {
    'Security ID': '27591',
    Security: 'GYRE',
    'As of Date': serial('2026-01-20'),
    'Process Date': serial('2026-01-27'),
    'Trans. Type': 'O.I.',
    'Trans. No.': '-',
    'Broker No.': '-',
    'Shares Issued': 61_657,
    'Shares Retired': 0,
    'Issued & Outstanding': 96_963_611,
    Comment: 'Omnibus Inc. Pl.',
    'Net Shares issued in Period': 61_657,
  };
}

function incrementRow(): Row {
  return { ...baseRow(), 'As of Date': '2026-01-20', 'Process Date': '2026-01-27', Comment: 'Omnibus Inc.Pl.' };
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

function frame(rows: Row[], columns?: string[]): WorkflowDataFrame {
  const resolved = columns ?? Object.keys(rows[0] ?? {});
  return {
    columns: resolved,
    rows,
    index: rows.map((_, index) => index + 1),
    matrix: [],
    range: { sheetName: 'EQ Control Book', a1Range: '', startRow: 1, endRow: rows.length + 1, startCol: 1, endCol: 12 },
  };
}

async function merge(base: Row[], increment: Row[]): Promise<Row[]> {
  const seed = JSON.parse(readFileSync(mergeSeedPath, 'utf8')) as {
    tasks: Array<{ id: string; operatorCode: string; params: Record<string, unknown> }>;
  };
  const task = seed.tasks.find((item) => item.id === 'merge_control_book');
  assert.ok(task, 'the merge workflow must still carry merge_control_book');
  const bound = {
    id: task.id,
    name: 'Merge Base And Increment Idempotently',
    operatorCode: task.operatorCode,
    operatorVersion: '1.0.0',
    description: '',
    x: 0,
    y: 0,
    params: task.params,
    inputs: {
      base: { from: 'extract_base_control_book', slot: 'dataframe' },
      increment: { from: 'extract_incremental_control_book', slot: 'dataframe' },
    },
    dependsOn: [],
  } as unknown as WorkflowTask;
  const frames: Record<string, WorkflowDataFrame> = { base: frame(base), increment: frame(increment) };
  const { dataFrame } = await executeSqlDataFrameQuery(bound, runtime, async (slotName: string) => frames[slotName]);
  return dataFrame.rows;
}

test('a text-dated increment updates the serial-dated base row instead of appending a copy', async () => {
  const rows = await merge([baseRow()], [incrementRow()]);
  assert.equal(rows.length, 1, `expected the row to merge, got ${rows.length} rows`);
  assert.equal(rows[0]?.['Shares Issued'], 61_657);
  // the increment wins for the fields it carries
  assert.equal(rows[0]?.Comment, 'Omnibus Inc.Pl.');
});

test('merging twice is still idempotent', async () => {
  const once = await merge([baseRow()], [incrementRow()]);
  const twice = await merge(once, [incrementRow()]);
  assert.equal(twice.length, 1);
});

test('two genuinely different rows on the same day are both kept', async () => {
  const other: Row = {
    ...incrementRow(),
    'As of Date': serial('2026-01-20'),
    'Process Date': serial('2026-01-21'),
    'Shares Issued': 200,
    'Issued & Outstanding': 96_963_811,
  };
  const rows = await merge([baseRow()], [other]);
  assert.equal(rows.length, 2);
});

// --- the same hazard in the Futu merge: it drops base rows that the increment re-states ------------------

const futuSeedPath = path.join(process.cwd(), 'database', 'workflows', 'futu-exercises-incremental-merge.json');

type FutuTask = { id: string; operatorCode: string; params: Record<string, unknown> };

function futuTask(taskId: string): FutuTask {
  const seed = JSON.parse(readFileSync(futuSeedPath, 'utf8')) as { tasks: FutuTask[] };
  const task = seed.tasks.find((item) => item.id === taskId);
  assert.ok(task, `the Futu merge workflow must still carry ${taskId}`);
  return task;
}

async function runFutuTask(taskId: string, slots: Record<string, WorkflowDataFrame>): Promise<Row[]> {
  const task = futuTask(taskId);
  const bound = {
    id: task.id,
    name: task.id,
    operatorCode: task.operatorCode,
    operatorVersion: '1.0.0',
    description: '',
    x: 0,
    y: 0,
    params: task.params,
    inputs: Object.fromEntries(Object.keys(slots).map((slot) => [slot, { from: slot, slot: 'dataframe' }])),
    dependsOn: [],
  } as unknown as WorkflowTask;
  const { dataFrame } = await executeSqlDataFrameQuery(bound, runtime, async (slotName: string) => {
    const frameForSlot = slots[slotName];
    assert.ok(frameForSlot, `unexpected slot ${slotName}`);
    return frameForSlot;
  });
  return dataFrame.rows;
}

const FUTU_COLUMNS = ['Exercise Order No.', 'Name', 'Employee No.', 'Grant No.', 'Exercise Date', 'Exercised Qty'];

function futuRow(overrides: Row = {}): Row {
  return {
    'Exercise Order No.': 'EX-1',
    Name: 'Someone',
    'Employee No.': 'E1',
    'Grant No.': 'KDN0272',
    'Exercise Date': serial('2025-12-15'),
    'Exercised Qty': 100,
    ...overrides,
  };
}

test('a text-dated Futu increment supersedes the serial-dated base row instead of duplicating it', async () => {
  // The retain rule only drops base rows that carry no Exercise Order No. (rows with one are canonical and
  // are joined later); those order-less rows are matched by Grant No. + Exercise Date, and that comparison
  // has to survive one side storing a serial and the other a text date.
  const orderLessBase = futuRow({ 'Exercise Order No.': null, 'Exercise Date': serial('2025-12-15') });
  const retained = await runFutuTask('retain_base_futu_exercises', {
    base: frame([orderLessBase], FUTU_COLUMNS),
    increment: frame([futuRow({ 'Exercise Date': '2025-12-15' })], FUTU_COLUMNS),
  });
  assert.equal(retained.length, 0, 'the increment re-states that row, so the base copy must be dropped');

  const merged = await runFutuTask('merge_futu_exercises', {
    base: frame(retained, FUTU_COLUMNS),
    increment: frame([futuRow({ 'Exercise Date': '2025-12-15' })], FUTU_COLUMNS),
  });
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.['Exercised Qty'], 100);
});

test('a base row that already carries an Exercise Order No. is kept even when the increment re-states it', async () => {
  // Rows with an order number are joined by that number in merge_futu_exercises, so retaining them is safe
  // and losing them would drop history.
  const retained = await runFutuTask('retain_base_futu_exercises', {
    base: frame([futuRow()], FUTU_COLUMNS),
    increment: frame([futuRow({ 'Exercise Date': '2025-12-15' })], FUTU_COLUMNS),
  });
  assert.equal(retained.length, 1);
});

test('a Futu base row for a different day is kept', async () => {
  const retained = await runFutuTask('retain_base_futu_exercises', {
    base: frame([futuRow({ 'Exercise Order No.': null, 'Exercise Date': serial('2025-12-15') })], FUTU_COLUMNS),
    increment: frame([futuRow({ 'Exercise Date': '2025-12-16' })], FUTU_COLUMNS),
  });
  assert.equal(retained.length, 1);
});

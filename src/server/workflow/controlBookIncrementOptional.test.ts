import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import type { WorkflowDataFrame, WorkflowTask } from '../../shared/types.js';
import { executeSqlDataFrameQuery } from './operators/sqlUtils.js';
import type { WorkflowOperatorRuntime } from './operators/types.js';

/**
 * A month without a Control Book detail export must still run.
 *
 * The monthly page asks for this month's `Control_Books_Detail_Data_*.xlsx` (sheet `27591`) as the
 * increment, but not every month produces one — when it is missing, the merge should simply carry the base
 * forward instead of blocking the run on "no input file".
 *
 * The Futu merge already works this way (`sheet.optional-range.extract` + `emptyColumns`): with no file the
 * step emits an empty dataframe that still carries the declared columns, so the schema guard on the
 * increment keeps passing and the merge returns the base unchanged. The Control Book merge now does the same.
 */

const mergeSeedPath = path.join(process.cwd(), 'database', 'workflows', 'eq-control-book-incremental-merge.json');
const monthlySeedPath = path.join(process.cwd(), 'database', 'workflows', 'gyre-captable-summary-v2.json');

const CONTROL_BOOK_COLUMNS = [
  'Security ID',
  'Security',
  'As of Date',
  'Process Date',
  'Trans. Type',
  'Trans. No.',
  'Broker No.',
  'Shares Issued',
  'Shares Retired',
  'Issued & Outstanding',
  'Comment',
  'Net Shares issued in Period',
];

type Row = Record<string, unknown>;

type SeedTask = {
  id: string;
  operatorCode: string;
  params: Record<string, unknown>;
  inputs?: Record<string, { guards?: Array<{ id: string; params: Record<string, unknown> }> }>;
};

function seedTask(file: string, taskId: string): SeedTask {
  const seed = JSON.parse(readFileSync(file, 'utf8')) as { tasks: SeedTask[] };
  const task = seed.tasks.find((item) => item.id === taskId);
  assert.ok(task, `${path.basename(file)} must still carry ${taskId}`);
  return task;
}

function baseRow(overrides: Row = {}): Row {
  return {
    'Security ID': '27591',
    Security: 'GYRE',
    'As of Date': '2026-06-30',
    'Process Date': '2026-06-30',
    'Trans. Type': 'O.I.',
    'Trans. No.': '-',
    'Broker No.': '-',
    'Shares Issued': 500,
    'Shares Retired': 0,
    'Issued & Outstanding': 96_964_111,
    Comment: 'Cede-Fast',
    'Net Shares issued in Period': 500,
    ...overrides,
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

function frame(rows: Row[], columns = CONTROL_BOOK_COLUMNS): WorkflowDataFrame {
  return {
    columns,
    rows,
    index: rows.map((_, index) => index + 1),
    matrix: [],
    range: { sheetName: 'EQ Control Book', a1Range: '', startRow: 1, endRow: rows.length + 1, startCol: 1, endCol: 12 },
  };
}

test('the Control Book increment is read with the optional extractor and declares its empty columns', () => {
  const extract = seedTask(mergeSeedPath, 'extract_incremental_control_book');
  assert.equal(
    extract.operatorCode,
    'sheet.optional-range.extract',
    'a month without a detail export must not fail the run',
  );
  const emptyColumns = String(extract.params.emptyColumns ?? '')
    .split(',')
    .map((column) => column.trim());
  // The merge key is asserted by a schema guard on the increment; an empty frame has to satisfy it.
  assert.deepEqual(emptyColumns, CONTROL_BOOK_COLUMNS);
});

test('the monthly page marks the Control Book detail as optional', () => {
  const seed = JSON.parse(readFileSync(monthlySeedPath, 'utf8')) as {
    runtimeParamsSchema: { fileRefs: { properties: Record<string, { required?: boolean; label?: string }> } };
  };
  const source = seed.runtimeParamsSchema.fileRefs.properties.incremental_control_book;
  assert.ok(source, 'the monthly definition must still declare the Control Book detail source');
  assert.equal(source.required, false, 'a missing detail export must not block the monthly run');
});

test('merging an absent increment returns the base rows untouched', async () => {
  const task = seedTask(mergeSeedPath, 'merge_control_book');
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

  const base = [
    baseRow(),
    baseRow({ 'As of Date': '2026-06-15', 'Shares Issued': 200, 'Issued & Outstanding': 96_963_611 }),
  ];
  const frames: Record<string, WorkflowDataFrame> = {
    base: frame(base),
    increment: frame([], CONTROL_BOOK_COLUMNS),
  };
  const { dataFrame } = await executeSqlDataFrameQuery(bound, runtime, async (slot: string) => frames[slot]);
  assert.equal(dataFrame.rows.length, base.length, 'the base carries forward unchanged');
  // The merge orders by As of Date, so the June 15 row comes first.
  assert.deepEqual(
    dataFrame.rows.map((row) => row['Shares Issued']),
    [200, 500],
  );
});

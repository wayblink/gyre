import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { WorkflowTask } from '../../shared/types.js';
import { rowsToDataFrame } from '../excel.js';
import { mergeKeyedDataFrames } from './operators/dataframeKeyedMerge.js';
import { executeSqlDataFrameQuery } from './operators/sqlUtils.js';
import type { WorkflowOperatorRuntime } from './operators/types.js';

type WorkflowDocTask = {
  id: string;
  operatorCode: string;
  params: Record<string, any>;
};

type WorkflowDoc = {
  version: number;
  tasks: WorkflowDocTask[];
  runtimeParamsSchema: Record<string, any>;
  runtimeParamsDefaults: Record<string, any>;
};

/** The natural key of one SERIES B shareholder transaction: date + account + the share movement. */
const SERIES_B_KEY_COLUMNS = ['As of Date', 'Process Date', 'Account Number', 'Shares Issued', 'Shares Retired'];

const sqlRuntime = {
  rowsToDataFrame: (rows: Array<Record<string, unknown>>, options: { columns?: string[] }) =>
    rowsToDataFrame(rows, {
      sheetName: 'frame',
      a1Range: '',
      columns: options.columns ?? Array.from(new Set(rows.flatMap((row) => Object.keys(row)))),
    }),
} as unknown as WorkflowOperatorRuntime;

function readWorkflow(code: string): WorkflowDoc {
  return JSON.parse(
    readFileSync(path.join(process.cwd(), 'database', 'workflows', `${code}.json`), 'utf8'),
  ) as WorkflowDoc;
}

/** The six shareholder-level rows of the 2026-09 SERIES B export (5 issuances + 1 retirement). */
const SERIES_B_ROWS = [
  { account: '0000010001', name: 'DR YUE XIONG', issued: 475300, retired: 0, asOf: 46146, processed: 46157 },
  {
    account: '0000010005',
    name: 'THE JIAN JIN AND XUFANG YE REVOCABLE',
    issued: 475300,
    retired: 0,
    asOf: 46146,
    processed: 46157,
  },
  { account: '0000010004', name: 'SIRIUS MEDICAL LIMITED', issued: 144809, retired: 0, asOf: 46146, processed: 46157 },
  { account: '0000010002', name: 'GNI GROUP LTD', issued: 458121, retired: 0, asOf: 46146, processed: 46157 },
  { account: '0000010003', name: 'GNI USA INC', issued: 2143706, retired: 0, asOf: 46146, processed: 46157 },
  { account: '0000010004', name: 'SIRIUS MEDICAL LIMITED', issued: 0, retired: 144809, asOf: 46266, processed: 46274 },
];

function ledgerRows() {
  return SERIES_B_ROWS.map((row) => ({
    'Security ID': '43105',
    Security: 'GYRE THERAPEUTICS INC SERIES B',
    'Process Date': row.processed,
    'As of Date': row.asOf,
    Transaction: 'Normal',
    Reason: row.issued > 0 ? 'RESTRICTED ISSUANCE' : 'ORIGINAL RETIREMENT',
    'Account Number': row.account,
    Name: row.name,
    'Shares Issued': row.issued,
    'Shares Retired': row.retired,
  }));
}

test('Read SERIES B merges shareholder-level detail instead of summing the 43105 rollup', () => {
  const workflow = readWorkflow('read-series-b');
  const byId = new Map(workflow.tasks.map((task) => [task.id, task]));

  const increment = byId.get('extract_series_b_increment');
  assert.equal(increment?.operatorCode, 'sheet.optional-range.extract');
  assert.equal(increment?.params.sheetName, 'CB Details Sort By Process Date');
  assert.equal(increment?.params.headerRow, 14);

  const merge = byId.get('merge_series_b_control_book');
  assert.equal(merge?.operatorCode, 'dataframe.keyed.merge');
  assert.deepEqual(merge?.params.keyColumns, SERIES_B_KEY_COLUMNS);
  assert.deepEqual(merge?.params.keyNormalization.dateColumns, ['As of Date', 'Process Date']);

  const persist = byId.get('persist_series_b_base');
  assert.equal(persist?.params.folderPrefix, 'series_b');
  assert.equal(persist?.params.fileName, 'SeriesB_Control_Book_Base.xlsx');
  assert.equal(persist?.params.versionedOutput, false);

  // The rollup is the reconciliation input, never the source of the accumulated number.
  const rollup = byId.get('extract_series_b_rollup');
  assert.equal(rollup?.params.sheetName, '43105');
  const reconcile = byId.get('assert_series_b_reconciliation');
  assert.equal(reconcile?.operatorCode, 'dataframe.sql.assert');
  assert.equal(reconcile?.params.expectedValue, 1);

  const outstanding = byId.get('sum_series_b_outstanding');
  assert.match(outstanding?.params.sql ?? '', /\[Shares Issued\]/);
  assert.match(outstanding?.params.sql ?? '', /\[Shares Retired\]/);
  assert.match(outstanding?.params.sql ?? '', /\[Shares Outstanding\]/);
});

test('the monthly workflow carries the Series B base automatically and multiplies the net outstanding shares', () => {
  const workflow = readWorkflow('gyre-captable-summary-v2');
  const props = workflow.runtimeParamsSchema.fileRefs.properties;
  const base = props.base_series_b;

  assert.equal(base.hidden, false, 'the base is shown as an inherited row so the chain is visible');
  assert.equal(base.optionalCategory, 'inherit');
  assert.equal(base.label, 'SERIES B Control Book Summary');
  assert.equal(base.required, false, 'the first month has no base yet');
  assert.equal(base.taskId, 'invoke_read_series_b');
  assert.deepEqual(workflow.runtimeParamsDefaults.fileRefs.base_series_b, { sheet: 'Series B Control Book' });
  assert.equal(props.series_b.required, true);
  assert.equal(props.series_b.defaultSheetName, 'CB Details Sort By Process Date');

  const invoke = workflow.tasks.find((task) => task.id === 'invoke_read_series_b');
  assert.equal(invoke?.params.outputTaskId, 'sum_series_b_outstanding');
  assert.equal(
    invoke?.params.runtimeParameters.fileRefs.base_series_b.$fromRuntime,
    'fileRefs.base_series_b',
    'the child workflow must receive the injected base',
  );

  const calculation = workflow.tasks.find((task) => task.id === 'calculate_series_b_preferred_stock');
  assert.match(calculation?.params.sql ?? '', /\[Shares Outstanding\]/);
  assert.match(calculation?.params.sql ?? '', /\* 5/);
  assert.equal(3552427 * 5, 17762135, 'net outstanding shares ×5 for 2026-09');
});

test('applying the same month twice keeps one row per account/date and nets retirements out', () => {
  const merged = mergeKeyedDataFrames({
    base: rowsToDataFrame(ledgerRows(), { sheetName: 'Base', a1Range: '' }),
    increment: rowsToDataFrame(ledgerRows(), { sheetName: 'Increment', a1Range: '' }),
    keyColumns: SERIES_B_KEY_COLUMNS,
    outputColumns: [
      'Security ID',
      'Security',
      'Process Date',
      'As of Date',
      'Transaction',
      'Reason',
      'Account Number',
      'Name',
      'Shares Issued',
      'Shares Retired',
    ],
    sortColumns: ['As of Date', 'Process Date', 'Account Number'],
    conflictPolicy: 'increment-wins',
    incomingBlankPolicy: 'preserve',
    keyNormalization: {
      caseInsensitive: true,
      collapseWhitespace: true,
      dateColumns: ['As of Date', 'Process Date'],
      numericColumns: ['Shares Issued', 'Shares Retired'],
      nullAsZeroColumns: [],
    },
  }).dataframe;

  assert.equal(merged.rows.length, 6, 'reapplying the same export must not duplicate the ledger');

  const issued = merged.rows.reduce((total, row) => total + Number(row['Shares Issued'] ?? 0), 0);
  const retired = merged.rows.reduce((total, row) => total + Number(row['Shares Retired'] ?? 0), 0);
  assert.equal(issued, 3697236);
  assert.equal(retired, 144809);
  assert.equal(issued - retired, 3552427, 'net outstanding shares after the retirement');

  const repeated = mergeKeyedDataFrames({
    base: merged,
    increment: rowsToDataFrame(ledgerRows(), { sheetName: 'Increment', a1Range: '' }),
    keyColumns: SERIES_B_KEY_COLUMNS,
    outputColumns: [
      'Security ID',
      'Security',
      'Process Date',
      'As of Date',
      'Transaction',
      'Reason',
      'Account Number',
      'Name',
      'Shares Issued',
      'Shares Retired',
    ],
    sortColumns: ['As of Date', 'Process Date', 'Account Number'],
    conflictPolicy: 'increment-wins',
    incomingBlankPolicy: 'preserve',
    keyNormalization: {
      caseInsensitive: true,
      collapseWhitespace: true,
      dateColumns: ['As of Date', 'Process Date'],
      numericColumns: ['Shares Issued', 'Shares Retired'],
      nullAsZeroColumns: [],
    },
  }).dataframe;

  assert.equal(repeated.rows.length, 6, 'a second merge over the same base stays idempotent');
});

test('a new shareholder transaction is appended while existing rows are replaced in place', () => {
  const firstMonth = mergeKeyedDataFrames({
    base: rowsToDataFrame([], { sheetName: 'Base', a1Range: '', columns: Object.keys(ledgerRows()[0]) }),
    increment: rowsToDataFrame(ledgerRows(), { sheetName: 'Increment', a1Range: '' }),
    keyColumns: SERIES_B_KEY_COLUMNS,
    outputColumns: Object.keys(ledgerRows()[0]),
    sortColumns: ['As of Date', 'Process Date', 'Account Number'],
    conflictPolicy: 'increment-wins',
    keyNormalization: {
      dateColumns: ['As of Date', 'Process Date'],
      numericColumns: ['Shares Issued', 'Shares Retired'],
    },
  }).dataframe;
  assert.equal(firstMonth.rows.length, 6, 'the first month seeds the ledger from its own export');

  const nextMonth = [
    ...ledgerRows(),
    {
      'Security ID': '43105',
      Security: 'GYRE THERAPEUTICS INC SERIES B',
      'Process Date': 46300,
      'As of Date': 46290,
      Transaction: 'Normal',
      Reason: 'RESTRICTED ISSUANCE',
      'Account Number': '0000010009',
      Name: 'NEW HOLDER LLC',
      'Shares Issued': 1000,
      'Shares Retired': 0,
    },
  ];

  const merged = mergeKeyedDataFrames({
    base: firstMonth,
    increment: rowsToDataFrame(nextMonth, { sheetName: 'Increment', a1Range: '' }),
    keyColumns: SERIES_B_KEY_COLUMNS,
    outputColumns: Object.keys(ledgerRows()[0]),
    sortColumns: ['As of Date', 'Process Date', 'Account Number'],
    conflictPolicy: 'increment-wins',
    keyNormalization: {
      dateColumns: ['As of Date', 'Process Date'],
      numericColumns: ['Shares Issued', 'Shares Retired'],
    },
  }).dataframe;

  assert.equal(merged.rows.length, 7, 'only the genuinely new transaction is appended');
  const issued = merged.rows.reduce((total, row) => total + Number(row['Shares Issued'] ?? 0), 0);
  assert.equal(issued, 3697236 + 1000);
});

test('the outstanding total is truncated to the workflow month even though the base keeps future rows', async () => {
  const workflow = readWorkflow('read-series-b');
  const outstanding = workflow.tasks.find((task) => task.id === 'sum_series_b_outstanding');
  const sql = String(outstanding?.params.sql ?? '');
  assert.match(sql, /wf_month_key\(\[As of Date\]\)/);
  assert.match(sql, /\{constants\.workflowMonth\}/);
  assert.ok(workflow.runtimeParamsSchema.month, 'the child workflow needs the workflow month');

  const ledger = rowsToDataFrame(ledgerRows(), { sheetName: 'ledger', a1Range: '' });
  const runFor = async (month: string) => {
    const task = {
      id: 'sum_series_b_outstanding',
      name: 'Sum SERIES B shares outstanding',
      operatorCode: 'sql.compute',
      operatorVersion: '1.0.0',
      description: '',
      x: 0,
      y: 0,
      params: {
        sql,
        constants: { workflowMonth: month },
        tableBindings: [{ inputSlot: 'control_book', tableName: 'control_book' }],
      },
      inputs: { control_book: { from: 'merge_series_b_control_book', slot: 'dataframe', guards: [] } },
      dependsOn: [],
    } as unknown as WorkflowTask;
    const { dataFrame } = await executeSqlDataFrameQuery(task, sqlRuntime, async () => ledger);
    return dataFrame.rows[0] ?? {};
  };

  // The retirement is dated 2026-09, so June and August must see only the May issuance.
  for (const month of ['2026-06', '2026-08']) {
    const row = await runFor(month);
    assert.equal(row['Shares Issued Total'], 3697236, `${month} must include the issuance`);
    assert.equal(row['Shares Retired Total'], 0, `${month} must not include the September retirement`);
    assert.equal(row['Shares Outstanding'], 3697236, `${month} stays at the pre-retirement balance`);
  }

  const september = await runFor('2026-09');
  assert.equal(september['Shares Retired Total'], 144809);
  assert.equal(september['Shares Outstanding'], 3552427);
});

test('two transactions for the same account on the same day survive as separate rows', () => {
  const twoIssuances = [
    { ...ledgerRows()[0] },
    {
      ...ledgerRows()[0],
      'Shares Issued': 1000,
      Reason: 'RESTRICTED ISSUANCE',
    },
  ];

  const merged = mergeKeyedDataFrames({
    base: rowsToDataFrame([], { sheetName: 'Base', a1Range: '', columns: Object.keys(ledgerRows()[0]) }),
    increment: rowsToDataFrame(twoIssuances, { sheetName: 'Increment', a1Range: '' }),
    keyColumns: SERIES_B_KEY_COLUMNS,
    outputColumns: Object.keys(ledgerRows()[0]),
    sortColumns: ['As of Date', 'Process Date', 'Account Number'],
    conflictPolicy: 'increment-wins',
    keyNormalization: {
      dateColumns: ['As of Date', 'Process Date'],
      numericColumns: ['Shares Issued', 'Shares Retired'],
    },
  }).dataframe;

  assert.equal(merged.rows.length, 2, 'the share movement is part of the key, so both rows are kept');
  const issued = merged.rows.reduce((total, row) => total + Number(row['Shares Issued'] ?? 0), 0);
  assert.equal(issued, 475300 + 1000);
});

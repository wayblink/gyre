import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import type { WorkflowDataFrame, WorkflowTask } from '../../shared/types.js';
import { normalizeInputGuards } from './inputGuards.js';
import { compareAssertValues } from './operators/assertUtils.js';
import { executeSqlDataFrameQuery } from './operators/sqlUtils.js';
import type { WorkflowOperatorRuntime } from './operators/types.js';

/**
 * 2025 BC Subplan shares transferred to Futu = the Omnibus transfers in the merged Control Book, summed up to
 * the run month — but each transfer once.
 *
 * The same January transfer reaches the workbook twice, because the base and the monthly increment describe it
 * in two different export formats:
 *   base     `GYRE`                            BOOK ENTRY ISSUANCE  Trans. No. (empty)  Broker 0000010072  61,657
 *   increment `GYRE THERAPEUTICS INC (NEW)`    O.I.                 Trans. No. "-"       Broker "-"         61,657
 * Both carry the same As of Date, the same Shares Issued and the same resulting Issued & Outstanding, and the
 * merge cannot join them (its key requires Trans. Type / Trans. No. / Broker No. / Shares Retired to match), so
 * the increment row is appended. Summing rows then counted 61,657 twice: 692,111 instead of 630,454 for
 * 2026-01. The row itself does belong in the total — 630,454 = 568,797 (2025-12) + 61,657 (2026-01).
 *
 * So the sum is taken over a de-duplicated set keyed by the economic fingerprint (As of Date, Process Date,
 * Shares Issued, Issued & Outstanding): one transaction cannot leave two rows with the same resulting balance,
 * while two genuinely different transfers of the same size in the same window land on different balances and
 * both survive. A warning reports the collapsed groups so the duplicate in the source stays visible.
 */

const seedPath = path.join(process.cwd(), 'database', 'workflows', 'gyre-captable-summary-v2.json');

type SeedTask = { id: string; operatorCode: string; params: Record<string, unknown> & { sql?: string } };

const TRANSFER = 568_797;
const JAN = 61_657;
const MAR = 30_390;
const APR = 34_321;
const AUG = 528_677;

const runtime = {
  rowsToDataFrame: (rows: Array<Record<string, unknown>>) => ({
    columns: Object.keys(rows[0] ?? {}),
    rows,
    index: rows.map((_, index) => index + 1),
    matrix: [],
    range: { sheetName: 'result', a1Range: '', startRow: 1, endRow: rows.length, startCol: 1, endCol: 1 },
  }),
} as unknown as WorkflowOperatorRuntime;

function seedTask(taskId: string): SeedTask {
  const seed = JSON.parse(readFileSync(seedPath, 'utf8')) as { tasks: SeedTask[] };
  const task = seed.tasks.find((item) => item.id === taskId);
  assert.ok(task, `the monthly seed must still carry ${taskId}`);
  return task;
}

function serial(iso: string): number {
  return Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86_400_000);
}

type Row = Record<string, unknown>;

function row(params: {
  asOf: string;
  processDate?: string;
  type?: string;
  transNo?: string | null;
  broker?: string | null;
  shares: number;
  balance: number;
  comment: string;
  retired?: number | null;
  security?: string;
}): Row {
  return {
    'Security ID': '27591',
    Security: params.security ?? 'GYRE',
    'As of Date': serial(params.asOf),
    'Process Date': serial(params.processDate ?? params.asOf),
    'Trans. Type': params.type ?? 'O.I.',
    'Trans. No.': params.transNo === undefined ? '-' : params.transNo,
    'Broker No.': params.broker === undefined ? '-' : params.broker,
    'Shares Issued': params.shares,
    'Shares Retired': params.retired === undefined ? 0 : params.retired,
    'Issued & Outstanding': params.balance,
    Comment: params.comment,
  };
}

/** The four Omnibus transfers the real workbook carries, plus the merged-in duplicate of the January one. */
function controlBook(): Row[] {
  return [
    row({ asOf: '2025-12-03', shares: TRANSFER, balance: 96_901_954, comment: 'Omnibus Inc. Pl.' }),
    row({
      asOf: '2026-01-20',
      processDate: '2026-01-27',
      type: 'BOOK ENTRY ISSUANCE',
      transNo: null,
      broker: '0000010072',
      shares: JAN,
      balance: 96_963_611,
      comment: 'Omnibus Inc. Pl.',
      retired: null,
    }),
    // same transfer, as the monthly increment exports it
    row({
      asOf: '2026-01-20',
      processDate: '2026-01-27',
      security: 'GYRE THERAPEUTICS INC (NEW)',
      shares: JAN,
      balance: 96_963_611,
      comment: 'Omnibus Inc.Pl.',
    }),
    row({ asOf: '2026-03-17', shares: MAR, balance: 96_994_001, comment: 'Omnibus Inc. Pl' }),
    row({ asOf: '2026-04-24', shares: APR, balance: 97_028_322, comment: 'Omnibus Inc. Pl' }),
    // unrelated rows that must not be matched
    row({ asOf: '2026-01-05', type: 'CEDE-FAST', shares: 9_999, balance: 96_902_000, comment: 'OpEx E. Williams' }),
    row({
      asOf: '2026-01-06',
      type: 'Agreement',
      shares: 71_211_370,
      balance: 96_902_100,
      comment: 'Issues to 4 China SH',
    }),
  ];
}

function dataFrame(rows: Row[]): WorkflowDataFrame {
  return {
    columns: Object.keys(rows[0]),
    rows,
    index: rows.map((_, index) => index + 1),
    matrix: [],
    range: { sheetName: 'EQ Control Book', a1Range: '', startRow: 1, endRow: rows.length, startCol: 1, endCol: 11 },
  };
}

async function controlBookMetrics(rows: Row[], workflowMonth: string): Promise<Record<string, unknown>> {
  const task = seedTask('calc_control_book_metrics');
  const bound = {
    id: task.id,
    name: 'Calc Control Book Metrics',
    operatorCode: task.operatorCode,
    operatorVersion: '1.0.0',
    description: '',
    x: 0,
    y: 0,
    params: { ...task.params, constants: { workflowMonth } },
    inputs: { control_book: { from: 'invoke_control_book_merge', slot: 'dataframe' } },
    dependsOn: [],
  } as unknown as WorkflowTask;
  const { dataFrame: out } = await executeSqlDataFrameQuery(bound, runtime, async () => dataFrame(rows));
  return out.rows[0] ?? {};
}

async function duplicateHint(rows: Row[], workflowMonth: string): Promise<{ passed: boolean; message: string }> {
  const task = seedTask('calc_control_book_metrics');
  const seed = JSON.parse(readFileSync(seedPath, 'utf8')) as {
    tasks: Array<{ id: string; inputs?: Record<string, { guards?: unknown[] }> }>;
  };
  const owner = seed.tasks.find((item) => item.id === 'calc_control_book_metrics');
  const guards = normalizeInputGuards(owner?.inputs?.control_book?.guards ?? []) as Array<{
    id: string;
    params: Record<string, unknown>;
  }>;
  const guard = guards.find((item) => String(item.params.sql ?? '').includes('bc_duplicate_hint'));
  assert.ok(guard, 'calc_control_book_metrics must warn when the Control Book carries duplicate transfers');

  const bound = {
    id: guard.id,
    name: guard.id,
    operatorCode: 'dataframe.sql.assert',
    operatorVersion: '1.0.0',
    description: '',
    x: 0,
    y: 0,
    params: {
      ...guard.params,
      constants: { workflowMonth },
      tableBindings: [{ inputSlot: 'control_book', tableName: 'control_book' }],
    },
    inputs: { control_book: { from: task.id, slot: 'dataframe' } },
    dependsOn: [],
  } as unknown as WorkflowTask;
  const { dataFrame: out } = await executeSqlDataFrameQuery(bound, runtime, async () => dataFrame(rows));
  const actual = out.rows[0]?.[out.columns[0] ?? ''];
  const isOneCell = out.rows.length === 1 && out.columns.length === 1;
  const passed = compareAssertValues(actual, guard.params.expectedValue, (guard.params.operator ?? '=') as '=');
  return { passed: isOneCell && passed, message: String(actual ?? '') };
}

test('2026-01 sums the January transfer once: 568,797 + 61,657 = 630,454', async () => {
  const metrics = await controlBookMetrics(controlBook(), '2026-01');
  assert.equal(metrics.bc_subplan_transfer_control_book, 630_454);
});

test('later months accumulate every distinct transfer, still once each', async () => {
  assert.equal((await controlBookMetrics(controlBook(), '2026-03')).bc_subplan_transfer_control_book, 630_454 + MAR);
  assert.equal(
    (await controlBookMetrics(controlBook(), '2026-04')).bc_subplan_transfer_control_book,
    630_454 + MAR + APR,
  );
  // Nothing new after April: August keeps the same total.
  assert.equal(
    (await controlBookMetrics(controlBook(), '2026-08')).bc_subplan_transfer_control_book,
    630_454 + MAR + APR,
  );
});

test('transfers after the run month are excluded', async () => {
  const january = await controlBookMetrics(controlBook(), '2026-01');
  assert.equal(january.bc_subplan_transfer_control_book, TRANSFER + JAN, 'the March/April rows are in the future');
});

test('two different transfers of the same size in one month both count', async () => {
  // Same size, same window, but each leaves a different balance — they are two transactions, not a duplicate.
  const rows = [
    row({ asOf: '2026-01-20', shares: JAN, balance: 96_963_611, comment: 'Omnibus Inc. Pl.' }),
    row({ asOf: '2026-01-20', shares: JAN, balance: 97_025_268, comment: 'Omnibus Inc. Pl.' }),
  ];
  assert.equal((await controlBookMetrics(rows, '2026-01')).bc_subplan_transfer_control_book, JAN * 2);
});

test('the typo spelling counts too, so August reaches 1,223,842', async () => {
  const august = [
    ...controlBook(),
    row({ asOf: '2026-08-12', shares: AUG, balance: 112_079_026, comment: 'Ominibus Inc. Pl' }),
  ];
  // 568,797 + 61,657 + 30,390 + 34,321 + 528,677
  assert.equal((await controlBookMetrics(august, '2026-08')).bc_subplan_transfer_control_book, 1_223_842);
});

test('the collapsed duplicate is reported on the run page instead of disappearing silently', async () => {
  const january = await duplicateHint(controlBook(), '2026-01');
  assert.equal(january.passed, false, 'the duplicate must be visible');
  assert.match(january.message, /61,657|61657/);
  assert.match(january.message, /2026-01-20|2026-01/);

  const clean = controlBook().filter((item) => item.Comment !== 'Omnibus Inc.Pl.');
  assert.equal((await duplicateHint(clean, '2026-01')).passed, true, 'a clean workbook raises nothing');

  // A duplicate dated after the run month is not part of this month's total, so it must not warn yet.
  const futureDup = [
    ...clean,
    row({ asOf: '2026-05-02', shares: MAR, balance: 98_000_000, comment: 'Omnibus Inc. Pl' }),
    row({ asOf: '2026-05-02', shares: MAR, balance: 98_000_000, comment: 'Omnibus Inc.Pl' }),
  ];
  assert.equal((await duplicateHint(futureDup, '2026-01')).passed, true);
  assert.equal((await duplicateHint(futureDup, '2026-05')).passed, false);
});

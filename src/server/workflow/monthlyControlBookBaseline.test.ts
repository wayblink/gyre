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
 * Cullgen common stock is 0 before the merger, and 0 is a legitimate value.
 *
 * The EQ Control Book carries the merger row (`Agr. & Pl. of Merger`, +14,450,527 shares) at **2026-05** —
 * the EOM balance jumps from 97,028,322 (2026-04) to 111,488,849 (2026-05) by exactly that amount. So for
 * every earlier month the honest answer is 0. The workflow used to take a whole-table `max()` of that row,
 * which returns 14,450,527 regardless of the run month; an operator who set the monthly constant to 0 (the
 * correct number for those months) was then blocked by the reconciliation guard, and the "0 means unset"
 * workaround that followed made the summary contradict the constant anyway.
 *
 * The rule these tests pin down:
 *   - the Control Book metric is derived with the same As-of cut-off as every other Control Book metric,
 *     so a pre-merger month yields 0 and a post-merger month yields 14,450,527;
 *   - the guard compares the two sides strictly, so 0 matches 0 and a real disagreement blocks;
 *   - calc_business_inputs uses the derived value — it must not fall back to the constant, or a pre-merger
 *     month would silently reclaim the merger shares;
 *   - 0 is not a warning: a value of 0 is a value.
 */

const seedPath = path.join(process.cwd(), 'database', 'workflows', 'gyre-captable-summary-v2.json');

type SeedTask = {
  id: string;
  operatorCode: string;
  params: Record<string, unknown> & { sql?: string };
  inputs?: Record<string, { guards?: unknown[] }>;
};

type Guard = { id: string; name: string; enabled?: boolean; params: Record<string, unknown> };

const MERGER_MONTH = '2026-05';
const MERGER_SHARES = 14_450_527;
const SUBPLAN_SHARES = 7_815_396;

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

function guardsOf(taskId: string, slot: string): Guard[] {
  const task = seedTask(taskId);
  return (normalizeInputGuards(task.inputs?.[slot]?.guards ?? []) as Guard[]).filter(
    (guard) => guard.enabled !== false,
  );
}

function guardMatching(taskId: string, slot: string, needle: string, strategy?: string): Guard {
  const guard = guardsOf(taskId, slot).find(
    (item) =>
      String(item.params?.sql ?? '').includes(needle) && (!strategy || item.params.failureStrategy === strategy),
  );
  assert.ok(guard, `${taskId}.${slot} must carry a ${strategy ?? ''} guard mentioning ${needle}`.trim());
  return guard;
}

function resolveConstants(guard: Guard, fixedValues: Record<string, unknown>, workflowMonth: string) {
  const raw = (guard.params.constants ?? {}) as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(raw).map(([key, value]) => {
      const reference = (value as { $fromRuntime?: unknown })?.$fromRuntime;
      if (typeof reference !== 'string') return [key, value];
      const resolved = reference.split('.').reduce<unknown>((node, segment) => {
        if (node && typeof node === 'object') return (node as Record<string, unknown>)[segment];
        if (node === 'month') return workflowMonth;
        return undefined;
      }, fixedValues as unknown);
      return [key, resolved];
    }),
  );
}

function frame(rows: Array<Record<string, unknown>>, columns: string[]): WorkflowDataFrame {
  return {
    columns,
    rows,
    index: rows.map((_, index) => index + 1),
    matrix: [],
    range: {
      sheetName: 'frame',
      a1Range: '',
      startRow: 1,
      endRow: rows.length + 1,
      startCol: 1,
      endCol: columns.length,
    },
  };
}

const serial = (iso: string) => {
  const ms = Date.parse(`${iso}T00:00:00Z`);
  return Math.round((ms - Date.UTC(1899, 11, 30)) / 86_400_000);
};

/** The Control Book rows that matter for these metrics, dated as the real workbook dates them. */
function controlBook(): WorkflowDataFrame {
  const columns = ['Security ID', 'As of Date', 'Trans. Type', 'Shares Issued', 'Issued & Outstanding', 'Comment'];
  const rows = [
    {
      'Security ID': '27591',
      'As of Date': serial('2024-07-18'),
      'Trans. Type': 'O.I.',
      'Shares Issued': SUBPLAN_SHARES,
      'Issued & Outstanding': 93_423_537,
      Comment: 'Equity Inc.Sub-Pl. Futu Network Technology',
    },
    {
      'Security ID': '27591',
      'As of Date': serial('2025-12-15'),
      'Trans. Type': 'O.I.',
      'Shares Issued': 568_797,
      'Issued & Outstanding': 96_901_954,
      Comment: 'Omnibus Inc. Pl.',
    },
    {
      'Security ID': '27591',
      'As of Date': serial('2026-01-20'),
      'Trans. Type': 'BOOK ENTRY ISSUANCE',
      'Shares Issued': 61_657,
      'Issued & Outstanding': 96_963_611,
      Comment: 'Omnibus Inc. Pl.',
    },
    {
      'Security ID': '27591',
      'As of Date': serial('2026-03-10'),
      'Trans. Type': 'O.I.',
      'Shares Issued': 30_390,
      'Issued & Outstanding': 96_994_001,
      Comment: 'Omnibus Inc. Pl',
    },
    {
      'Security ID': '27591',
      'As of Date': serial('2026-04-10'),
      'Trans. Type': 'O.I.',
      'Shares Issued': 34_321,
      'Issued & Outstanding': 97_028_322,
      Comment: 'Omnibus Inc. Pl',
    },
    {
      'Security ID': '27591',
      'As of Date': serial('2026-05-12'),
      'Trans. Type': 'Agr. & Pl. of Merger',
      'Shares Issued': MERGER_SHARES,
      'Issued & Outstanding': 111_488_849,
      Comment: '-',
    },
  ];
  return frame(rows, columns);
}

async function controlBookMetrics(workflowMonth: string): Promise<Record<string, unknown>> {
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
  const { dataFrame } = await executeSqlDataFrameQuery(bound, runtime, async () => controlBook());
  return dataFrame.rows[0] ?? {};
}

function controlMetricsFrame(overrides: Record<string, unknown>): WorkflowDataFrame {
  const row = { cullgen_common_stock: 0, gyre_2023_china_subplan_total: SUBPLAN_SHARES, ...overrides };
  return frame([row], Object.keys(row));
}

async function evaluateGuard(
  guard: Guard,
  slot: string,
  dataFrame: WorkflowDataFrame,
  fixedValues: Record<string, unknown>,
  workflowMonth: string,
): Promise<{ passed: boolean; message: string }> {
  const bindings =
    Array.isArray(guard.params.tableBindings) && guard.params.tableBindings.length
      ? (guard.params.tableBindings as Array<{ inputSlot?: string; tableName?: string }>)
      : [{ inputSlot: slot, tableName: slot }];
  const inputs: Record<string, { from: string; slot: string }> = {};
  for (const binding of bindings) {
    if (binding.inputSlot) inputs[binding.inputSlot] = { from: 'upstream', slot: 'dataframe' };
  }
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
      constants: resolveConstants(guard, fixedValues, workflowMonth),
      tableBindings: bindings,
    },
    inputs,
    dependsOn: [],
  } as unknown as WorkflowTask;
  const { dataFrame: result } = await executeSqlDataFrameQuery(bound, runtime, async () => dataFrame);
  const actual = result.rows[0]?.[result.columns[0] ?? ''];
  const isOneCell = result.rows.length === 1 && result.columns.length === 1;
  const passed = compareAssertValues(actual, guard.params.expectedValue, (guard.params.operator ?? '=') as '=');
  return { passed: isOneCell && passed, message: String(actual ?? '') };
}

// --- structural: a SQL placeholder the task/guard did not declare fails at run time, not at test time ----

test('every {constants.X} placeholder is declared in the constants of the SQL that uses it', () => {
  // `run` dies with "SQL constant placeholder is not configured" the moment a SQL body references a constant
  // it never declared — that has happened twice now (a task fallback, and a guard added without constants),
  // each time with every other test green. Walk the whole seed so the next edit cannot repeat it.
  const seed = JSON.parse(readFileSync(seedPath, 'utf8')) as {
    tasks: Array<{
      id: string;
      params?: { sql?: string; constants?: Record<string, unknown> };
      inputs?: Record<string, { guards?: Array<{ params: { sql?: string; constants?: Record<string, unknown> } }> }>;
    }>;
  };
  const undeclared: string[] = [];
  const check = (where: string, sql: unknown, declared: Record<string, unknown> | undefined) => {
    for (const name of new Set(String(sql ?? '').match(/\{constants\.([A-Za-z_][A-Za-z0-9_]*)\}/g) ?? [])) {
      const constant = name.slice('{constants.'.length, -1);
      if (!declared || !(constant in declared)) undeclared.push(`${where}: ${constant}`);
    }
  };
  for (const task of seed.tasks) {
    check(task.id, task.params?.sql, task.params?.constants);
    for (const [slot, input] of Object.entries(task.inputs ?? {})) {
      for (const guard of input.guards ?? [])
        check(`${task.id}.${slot} guard`, guard.params.sql, guard.params.constants);
    }
  }
  assert.deepEqual(undeclared, []);
});

// --- the Control Book metric must follow the run month -------------------------------------------

test('a month before the merger derives Cullgen common stock = 0, not the whole-table max', async () => {
  const january = await controlBookMetrics('2026-01');
  assert.equal(january.cullgen_common_stock, 0);
  assert.equal(january.eom_eq_balance_os, 96_963_611);
  // The BC Subplan transfer still counts up to the run month (2025-12 + 2026-01).
  assert.equal(january.bc_subplan_transfer_control_book, 568_797 + 61_657);
});

test('the merger month and later months derive the merger shares', async () => {
  for (const month of [MERGER_MONTH, '2026-08']) {
    const metrics = await controlBookMetrics(month);
    assert.equal(metrics.cullgen_common_stock, MERGER_SHARES, `${month} must include the merger shares`);
    assert.equal(metrics.eom_eq_balance_os, 111_488_849);
  }
  const april = await controlBookMetrics('2026-04');
  assert.equal(april.cullgen_common_stock, 0, '2026-04 is still before the merger');
});

test('the Gyre 2023 China SubPlan total is derived with the same cut-off', async () => {
  assert.equal((await controlBookMetrics('2024-03')).gyre_2023_china_subplan_total, 0);
  assert.equal((await controlBookMetrics('2024-08')).gyre_2023_china_subplan_total, SUBPLAN_SHARES);
  assert.equal((await controlBookMetrics('2026-01')).gyre_2023_china_subplan_total, SUBPLAN_SHARES);
});

// --- the reconciliation compares the two sides strictly, and 0 is just a value --------------------

const CULLGEN = 'cullgen_common_stock';
const SUBPLAN = 'gyre_2023_china_subplan_total';

test('a 0 constant matches a pre-merger month, and a merger-month constant matches the merger month', async () => {
  const guard = guardMatching('calc_business_inputs', 'control_metrics', CULLGEN, 'block');

  const preMerger = await evaluateGuard(
    guard,
    'control_metrics',
    controlMetricsFrame({}),
    { fixedValues: { cullgenCommonStock: 0 } },
    '2026-01',
  );
  assert.equal(preMerger.passed, true, '0 is the correct value before the merger');

  const mergerMonth = await evaluateGuard(
    guard,
    'control_metrics',
    controlMetricsFrame({ cullgen_common_stock: MERGER_SHARES }),
    { fixedValues: { cullgenCommonStock: MERGER_SHARES } },
    MERGER_MONTH,
  );
  assert.equal(mergerMonth.passed, true);
});

test('a constant that disagrees with the derived value still blocks', async () => {
  const guard = guardMatching('calc_business_inputs', 'control_metrics', CULLGEN, 'block');

  const wrongZero = await evaluateGuard(
    guard,
    'control_metrics',
    controlMetricsFrame({ cullgen_common_stock: MERGER_SHARES }),
    { fixedValues: { cullgenCommonStock: 0 } },
    MERGER_MONTH,
  );
  assert.equal(wrongZero.passed, false, '0 after the merger must not pass');

  const wrongValue = await evaluateGuard(
    guard,
    'control_metrics',
    controlMetricsFrame({}),
    { fixedValues: { cullgenCommonStock: MERGER_SHARES } },
    '2026-01',
  );
  assert.equal(wrongValue.passed, false, 'the default constant must not pass for a pre-merger month');
});

test('the same strict rule holds for the Gyre 2023 China SubPlan total', async () => {
  const guard = guardMatching('calc_business_inputs', 'control_metrics', SUBPLAN, 'block');

  assert.equal(
    (
      await evaluateGuard(
        guard,
        'control_metrics',
        controlMetricsFrame({}),
        { fixedValues: { gyre2023ChinaSubplanTotal: SUBPLAN_SHARES } },
        '2026-01',
      )
    ).passed,
    true,
  );
  assert.equal(
    (
      await evaluateGuard(
        guard,
        'control_metrics',
        controlMetricsFrame({}),
        { fixedValues: { gyre2023ChinaSubplanTotal: 0 } },
        '2026-01',
      )
    ).passed,
    false,
  );
});

test('0 is never turned into a warning: a value of 0 is a value', async () => {
  for (const [taskId, slot] of [
    ['calc_business_inputs', 'control_metrics'],
    ['build_capitalization_summary', 'business_inputs'],
  ] as const) {
    const warnings = guardsOf(taskId, slot).filter((guard) => guard.params.failureStrategy === 'warning');
    assert.deepEqual(
      warnings.map((guard) => guard.id),
      [],
      `${taskId}.${slot} must not carry a "baseline is 0 = unset" warning`,
    );
  }
});

// --- calc_business_inputs must use the derived value ---------------------------------------------

async function businessInputs(workflowMonth: string, fixedValues: Record<string, number>) {
  const task = seedTask('calc_business_inputs');
  const bound = {
    id: task.id,
    name: 'Calc Business Inputs',
    operatorCode: task.operatorCode,
    operatorVersion: '1.0.0',
    description: '',
    x: 0,
    y: 0,
    params: { ...task.params, constants: { workflowMonth, ...fixedValues } },
    inputs: {
      control_metrics: { from: 'calc_control_book_metrics', slot: 'dataframe' },
      option_metrics: { from: 'calc_option_metrics', slot: 'dataframe' },
      series_b_metrics: { from: 'calculate_series_b_preferred_stock', slot: 'dataframe' },
    },
    dependsOn: [],
  } as unknown as WorkflowTask;
  const frames: Record<string, WorkflowDataFrame> = {
    control_metrics: controlMetricsFrame({}),
    option_metrics: frame(
      [{ total_options_outstanding: 13_982_117, total_options_available: 3_389_230 }],
      ['total_options_outstanding', 'total_options_available'],
    ),
    series_b_metrics: frame([{ series_b_preferred_stock: 18_486_180 }], ['series_b_preferred_stock']),
  };
  const { dataFrame } = await executeSqlDataFrameQuery(bound, runtime, async (slot: string) => frames[slot]);
  return dataFrame.rows[0] ?? {};
}

test('a pre-merger month keeps Cullgen common stock at 0 in the business inputs', async () => {
  const inputs = await businessInputs('2026-01', {
    cullgenCommonStock: MERGER_SHARES,
    gyre2023ChinaSubplanTotal: SUBPLAN_SHARES,
    optionsOutstandingCullgen: 4_156_815,
    optionsAvailableCullgen: 10_994,
    warrantsConvertiblePreferred: 540_666,
  });
  // The derived 0 wins: falling back to the constant would hand the merger shares to a month that had none.
  assert.equal(inputs.cullgen_common_stock, 0);
  assert.equal(inputs.gyre_2023_china_subplan_total, SUBPLAN_SHARES);
});

// --- legitimate zeros elsewhere in the summary ---------------------------------------------------

test('a zero BC Subplan transfer is allowed; only a missing one blocks', async () => {
  const guard = guardsOf('build_capitalization_summary', 'control_metrics').find((item) =>
    String(item.params?.sql ?? '').includes('bc_subplan_transfer_control_book'),
  );
  assert.ok(guard, 'build_capitalization_summary must keep the transfer-source guard');

  const zero = await evaluateGuard(
    guard,
    'control_metrics',
    controlMetricsFrame({ bc_subplan_transfer_control_book: 0 }),
    {},
    '2026-01',
  );
  assert.equal(zero.passed, true);
  const missing = await evaluateGuard(
    guard,
    'control_metrics',
    controlMetricsFrame({ bc_subplan_transfer_control_book: null }),
    {},
    '2026-01',
  );
  assert.equal(missing.passed, false);
});

test('zero Gyre options outstanding is allowed; negative and null still block', async () => {
  const guard = guardsOf('persist_capitalization_summary', 'capitalization').find(
    (item) => item.name === 'Assert Options Outstanding Gyre',
  );
  assert.ok(guard, 'persist_capitalization_summary must keep the options-outstanding guard');
  const summary = (value: number | null) =>
    frame(
      [{ Description: 'Options Outstanding- Gyre', 'Common Shares Equivalent': value }],
      ['Description', 'Common Shares Equivalent'],
    );

  assert.equal((await evaluateGuard(guard, 'capitalization', summary(0), {}, '2026-01')).passed, true);
  assert.equal((await evaluateGuard(guard, 'capitalization', summary(-1), {}, '2026-01')).passed, false);
  assert.equal((await evaluateGuard(guard, 'capitalization', summary(null), {}, '2026-01')).passed, false);
});

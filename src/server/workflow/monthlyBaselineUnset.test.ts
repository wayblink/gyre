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
 * Reconciliation baselines that reach a run as 0, or that a run cannot derive at all.
 *
 * The five monthly constants are the baselines the monthly workflow reconciles against. Two of them
 * (cullgen_common_stock, gyre_2023_china_subplan_total) are cross-checked against the EQ Control Book, and
 * the 2026-10 bug report showed the failure mode: the constant was saved as 0 (the page used to accept it),
 * the Control Book disagreed, and `guard_1` blocked the whole month on a value the operator could not fix
 * from the run page. The other three are written straight into Total Fully Diluted, so a 0 there used to
 * shrink fully diluted silently.
 *
 * The rule these tests pin down:
 *   - both sources carry a value and disagree  -> block (that is real data drift)
 *   - one source carries a value               -> warn, continue on it
 *   - neither source carries a value           -> block (nothing to compute)
 * A legitimate zero in the *data* (0 BC Subplan transfer before the 2025-12 Omnibus rows, 0 Gyre options
 * outstanding) is not a missing baseline: only a null source blocks.
 *
 * The rules live in the DB workflow definition (see CLAUDE.md), so these tests load the shipped seed, run
 * its guards through the engine's own `normalizeInputGuards`, and execute the real SQL.
 */

const seedPath = path.join(process.cwd(), 'database', 'workflows', 'gyre-captable-summary-v2.json');

type Guard = {
  id: string;
  name: string;
  enabled?: boolean;
  params: Record<string, unknown> & { failureStrategy?: string };
};

type SeedTask = { id: string; inputs?: Record<string, { guards?: unknown[] }> };

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

/**
 * Guards of one task input, normalized exactly like the engine does before a run: a guard without a
 * recognized `type` is silently dropped there, which is how a hand-written warning guard can look correct
 * in the seed and never fire.
 */
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
  assert.ok(guard, `${taskId}.${slot} must carry a ${strategy ?? ''} guard mentioning ${needle}`.replace('  ', ' '));
  return guard;
}

function taskGuard(taskId: string, slot: string, name: string): Guard {
  const guard = guardsOf(taskId, slot).find((item) => item.name === name);
  assert.ok(guard, `${taskId}.${slot} must keep the guard "${name}"`);
  return guard;
}

function resolveConstants(guard: Guard, fixedValues: Record<string, unknown>): Record<string, unknown> {
  const raw = (guard.params.constants ?? {}) as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(raw).map(([key, value]) => {
      const reference = (value as { $fromRuntime?: unknown })?.$fromRuntime;
      if (typeof reference !== 'string') return [key, value];
      const resolved = reference.split('.').reduce<unknown>((node, segment) => {
        if (node && typeof node === 'object') return (node as Record<string, unknown>)[segment];
        return undefined;
      }, fixedValues as unknown);
      assert.notEqual(resolved, undefined, `runtime reference ${reference} must resolve`);
      return [key, resolved];
    }),
  );
}

function frame(columns: string[], row: Record<string, unknown>): WorkflowDataFrame {
  return {
    columns,
    rows: [row],
    index: [1],
    matrix: [],
    range: { sheetName: 'frame', a1Range: '', startRow: 1, endRow: 2, startCol: 1, endCol: columns.length },
  };
}

const BOOK = { cullgen_common_stock: 14_450_527, gyre_2023_china_subplan_total: 7_815_396 };

function controlMetrics(overrides: Record<string, unknown> = {}): WorkflowDataFrame {
  const row = { ...BOOK, ...overrides };
  return frame(Object.keys(row), row);
}

function businessInputs(overrides: Record<string, unknown> = {}): WorkflowDataFrame {
  const row = { options_outstanding_cullgen: 4_156_815, options_available_cullgen: 10_994, ...overrides };
  return frame(Object.keys(row), row);
}

function summary(commonSharesEquivalent: number): WorkflowDataFrame {
  return frame(['Description', 'Common Shares Equivalent'], {
    Description: 'Options Outstanding- Gyre',
    'Common Shares Equivalent': commonSharesEquivalent,
  });
}

async function run(
  guard: Guard,
  slot: string,
  dataFrame: WorkflowDataFrame,
  fixedValues: Record<string, unknown>,
): Promise<{ passed: boolean; actual: unknown; message: string }> {
  // Use the guard's own table bindings (the engine does): e.g. persist_capitalization_summary binds
  // `{summary}` to its capitalization slot, so deriving the table name from the slot would not bind.
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
      constants: resolveConstants(guard, fixedValues),
      tableBindings: bindings,
    },
    inputs,
    dependsOn: [],
  } as unknown as WorkflowTask;
  const { dataFrame: sqlResult } = await executeSqlDataFrameQuery(bound, runtime, async () => dataFrame);
  const firstColumn = sqlResult.columns[0];
  const actual = firstColumn ? sqlResult.rows[0]?.[firstColumn] : undefined;
  const isOneCell = sqlResult.rows.length === 1 && sqlResult.columns.length === 1;
  const passed = compareAssertValues(actual, guard.params.expectedValue, (guard.params.operator ?? '=') as '=');
  return { passed: isOneCell && passed, actual, message: String(actual ?? '') };
}

// --- structural: a SQL placeholder the task did not declare fails at run time, not at test time ----------

test('every {constants.X} placeholder is declared in the constants of the SQL that uses it', () => {
  // `run` fails with "SQL constant placeholder is not configured" the moment a task's SQL starts
  // referencing a constant the task never declared — which is exactly what adding a fallback to
  // calc_business_inputs did, after the unit tests had passed. Walk the whole seed so the next edit
  // cannot repeat it.
  const seed = JSON.parse(readFileSync(seedPath, 'utf8')) as {
    tasks: Array<{
      id: string;
      params?: { sql?: string; constants?: Record<string, unknown> };
      inputs?: Record<string, { guards?: Array<{ params: { sql?: string; constants?: Record<string, unknown> } }> }>;
    }>;
  };
  const undeclared: string[] = [];
  const check = (taskId: string, sql: unknown, declared: Record<string, unknown> | undefined) => {
    for (const name of new Set(String(sql ?? '').match(/\{constants\.([A-Za-z_][A-Za-z0-9_]*)\}/g) ?? [])) {
      const constant = name.slice('{constants.'.length, -1);
      if (!declared || !(constant in declared)) undeclared.push(`${taskId}: ${constant}`);
    }
  };
  for (const task of seed.tasks) {
    check(task.id, task.params?.sql, task.params?.constants);
    for (const input of Object.values(task.inputs ?? {})) {
      for (const guard of input.guards ?? []) check(task.id, guard.params.sql, guard.params.constants);
    }
  }
  assert.deepEqual(undeclared, []);
});

// --- cullgen_common_stock / gyre_2023_china_subplan_total: reconciled against the Control Book ---------

test('an unset cullgen_common_stock baseline (0) warns and continues on the Control Book value', async () => {
  const blocking = guardMatching('calc_business_inputs', 'control_metrics', 'cullgen_common_stock', 'block');
  const warning = guardMatching('calc_business_inputs', 'control_metrics', 'cullgen_common_stock', 'warning');
  const fixedValues = { fixedValues: { cullgenCommonStock: 0 } };

  assert.equal((await run(blocking, 'control_metrics', controlMetrics(), fixedValues)).passed, true);

  const warn = await run(warning, 'control_metrics', controlMetrics(), fixedValues);
  assert.equal(warn.passed, false, 'the unset baseline must surface a warning');
  assert.match(warn.message, /cullgen_common_stock/);
  assert.match(warn.message, /0/);
  assert.match(warn.message, /14,450,527|14450527/);
});

test('a set cullgen_common_stock baseline that disagrees with the Control Book still blocks', async () => {
  const blocking = guardMatching('calc_business_inputs', 'control_metrics', 'cullgen_common_stock', 'block');
  const warning = guardMatching('calc_business_inputs', 'control_metrics', 'cullgen_common_stock', 'warning');
  const fixedValues = { fixedValues: { cullgenCommonStock: 9_999_999 } };

  assert.equal((await run(blocking, 'control_metrics', controlMetrics(), fixedValues)).passed, false);
  assert.equal(
    (await run(warning, 'control_metrics', controlMetrics(), fixedValues)).passed,
    true,
    'a plain mismatch belongs to the blocking guard, not the warning',
  );
});

test('a matching cullgen_common_stock baseline passes without a warning', async () => {
  const blocking = guardMatching('calc_business_inputs', 'control_metrics', 'cullgen_common_stock', 'block');
  const warning = guardMatching('calc_business_inputs', 'control_metrics', 'cullgen_common_stock', 'warning');
  const fixedValues = { fixedValues: { cullgenCommonStock: 14_450_527 } };

  assert.equal((await run(blocking, 'control_metrics', controlMetrics(), fixedValues)).passed, true);
  assert.equal((await run(warning, 'control_metrics', controlMetrics(), fixedValues)).passed, true);
});

test('a Control Book without the merger row falls back to the constant and warns', async () => {
  const blocking = guardMatching('calc_business_inputs', 'control_metrics', 'cullgen_common_stock', 'block');
  const warning = guardMatching('calc_business_inputs', 'control_metrics', 'cullgen_common_stock', 'warning');
  const fixedValues = { fixedValues: { cullgenCommonStock: 14_450_527 } };
  const missingBook = controlMetrics({ cullgen_common_stock: null });

  assert.equal(
    (await run(blocking, 'control_metrics', missingBook, fixedValues)).passed,
    true,
    'the constant is a valid source when the Control Book cannot derive the value',
  );
  const warn = await run(warning, 'control_metrics', missingBook, fixedValues);
  assert.equal(warn.passed, false, 'the fallback must be visible on the run page');
  assert.match(warn.message, /Agr\. & Pl\. of Merger/);
});

test('when neither the Control Book nor the constant carries the value the run still blocks', async () => {
  const blocking = guardMatching('calc_business_inputs', 'control_metrics', 'cullgen_common_stock', 'block');
  const fixedValues = { fixedValues: { cullgenCommonStock: 0 } };

  assert.equal(
    (await run(blocking, 'control_metrics', controlMetrics({ cullgen_common_stock: 0 }), fixedValues)).passed,
    false,
  );
});

test('the same three-way rule holds for gyre_2023_china_subplan_total', async () => {
  const blocking = guardMatching('calc_business_inputs', 'control_metrics', 'gyre_2023_china_subplan_total', 'block');
  const warning = guardMatching('calc_business_inputs', 'control_metrics', 'gyre_2023_china_subplan_total', 'warning');

  const unsetConstant = { fixedValues: { gyre2023ChinaSubplanTotal: 0 } };
  assert.equal((await run(blocking, 'control_metrics', controlMetrics(), unsetConstant)).passed, true);
  assert.equal((await run(warning, 'control_metrics', controlMetrics(), unsetConstant)).passed, false);

  const missingBook = controlMetrics({ gyre_2023_china_subplan_total: 0 });
  const setConstant = { fixedValues: { gyre2023ChinaSubplanTotal: 7_815_396 } };
  assert.equal((await run(blocking, 'control_metrics', missingBook, setConstant)).passed, true);
  assert.equal((await run(warning, 'control_metrics', missingBook, setConstant)).passed, false);

  const mismatch = { fixedValues: { gyre2023ChinaSubplanTotal: 1 } };
  assert.equal((await run(blocking, 'control_metrics', controlMetrics(), mismatch)).passed, false);
});

// --- warrants / Cullgen options: constants written straight into Total Fully Diluted ----------------

test('an unset warrants or Cullgen option constant warns instead of silently shrinking fully diluted', async () => {
  const warrants = guardMatching('build_capitalization_summary', 'business_inputs', 'warrants_convertible_preferred');
  const options = guardMatching(
    'build_capitalization_summary',
    'business_inputs',
    'options_outstanding_cullgen',
    'warning',
  );
  const unset = {
    fixedValues: { warrantsConvertiblePreferred: 0, optionsOutstandingCullgen: 0, optionsAvailableCullgen: 0 },
  };

  const warnWarrants = await run(warrants, 'business_inputs', businessInputs(), unset);
  assert.equal(warnWarrants.passed, false, 'a 0 warrants constant must be surfaced, not silently dropped');
  assert.match(warnWarrants.message, /warrants_convertible_preferred/);

  const warnOptions = await run(options, 'business_inputs', businessInputs(), unset);
  assert.equal(warnOptions.passed, false);
  assert.match(warnOptions.message, /options_outstanding_cullgen|options_available_cullgen/);
});

test('set warrants and Cullgen option constants raise no warning', async () => {
  const warrants = guardMatching('build_capitalization_summary', 'business_inputs', 'warrants_convertible_preferred');
  const options = guardMatching(
    'build_capitalization_summary',
    'business_inputs',
    'options_outstanding_cullgen',
    'warning',
  );
  const fixedValues = {
    fixedValues: {
      warrantsConvertiblePreferred: 540_666,
      optionsOutstandingCullgen: 4_156_815,
      optionsAvailableCullgen: 10_994,
    },
  };

  assert.equal((await run(warrants, 'business_inputs', businessInputs(), fixedValues)).passed, true);
  assert.equal((await run(options, 'business_inputs', businessInputs(), fixedValues)).passed, true);
});

// --- legitimate zeros in the data are not missing baselines ---------------------------------------

test('a zero BC Subplan transfer is allowed; only a missing one blocks', async () => {
  const transfer = taskGuard('build_capitalization_summary', 'control_metrics', 'Assert Control Book Transfer Source');

  const zero = await run(transfer, 'control_metrics', controlMetrics({ bc_subplan_transfer_control_book: 0 }), {});
  assert.equal(zero.passed, true, 'a month before the 2025-12 Omnibus rows has a legitimate 0 transfer');

  const missing = await run(
    transfer,
    'control_metrics',
    controlMetrics({ bc_subplan_transfer_control_book: null }),
    {},
  );
  assert.equal(missing.passed, false, 'a missing transfer source is still a data error');
});

test('zero Gyre options outstanding is allowed; a negative one blocks', async () => {
  const options = taskGuard('persist_capitalization_summary', 'capitalization', 'Assert Options Outstanding Gyre');

  assert.equal((await run(options, 'capitalization', summary(0), {})).passed, true);
  assert.equal(
    (await run(options, 'capitalization', summary(-1), {})).passed,
    false,
    'a negative row means the transfer was subtracted from a smaller pool — still a data error',
  );
});

test('a missing (null) Gyre options row still blocks', async () => {
  const options = taskGuard('persist_capitalization_summary', 'capitalization', 'Assert Options Outstanding Gyre');
  const nullRow = frame(['Description', 'Common Shares Equivalent'], {
    Description: 'Options Outstanding- Gyre',
    'Common Shares Equivalent': null,
  });
  assert.equal((await run(options, 'capitalization', nullRow, {})).passed, false);
});

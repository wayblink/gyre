import assert from 'node:assert/strict';
import test from 'node:test';

import {
  emptyFivePercentHolderRows,
  hasCompleteFivePercentHolderGlobalParameters,
  isUsableFivePercentHolderValue,
  monthlyFixedValueGlobalParameterKeys,
  retiredGlobalParameterKeys,
  unmanagedGlobalParameterKeys,
} from './parameters.js';

/**
 * Global Parameter values that must never be treated as data.
 *
 * Two separate problems live here. The 5% Holders baselines are share counts: a stored 0 is a field nobody
 * filled in, and treating it as complete publishes "Common Stock 0 / 0% of class" for a >5% holder with no
 * warning. The five monthly Cap Table constants are stored per month on the monthly instance, so the
 * `global_parameters` rows with the same names are read by nothing — editing them must not look like it
 * fixes a monthly run.
 */

function map(values: Record<string, unknown>): Map<string, Record<string, unknown>> {
  return new Map(Object.entries(values).map(([key, value]) => [key, { key, value }]));
}

const COMPLETE = {
  fivePercentHoldersGniCommonStock: 72_773_219,
  fivePercentHoldersGniTotalCses: 86_323_015,
  fivePercentHoldersSongjiangMaCommonStock: 2_806_084,
  fivePercentHoldersSongjiangMaTotalCses: 7_342_131,
};

test('a 0 or negative 5% Holders baseline is not a usable value', () => {
  assert.equal(isUsableFivePercentHolderValue(72_773_219), true);
  assert.equal(isUsableFivePercentHolderValue('72773219'), true);
  assert.equal(isUsableFivePercentHolderValue(0), false);
  assert.equal(isUsableFivePercentHolderValue(-1), false);
  assert.equal(isUsableFivePercentHolderValue(null), false);
  assert.equal(isUsableFivePercentHolderValue(undefined), false);
  assert.equal(isUsableFivePercentHolderValue('abc'), false);
});

test('a stored 0 makes the 5% Holders baseline set incomplete instead of zero-publishing', () => {
  assert.equal(hasCompleteFivePercentHolderGlobalParameters(map(COMPLETE)), true);
  assert.equal(
    hasCompleteFivePercentHolderGlobalParameters(map({ ...COMPLETE, fivePercentHoldersGniCommonStock: 0 })),
    false,
  );
  assert.equal(
    hasCompleteFivePercentHolderGlobalParameters(map({ ...COMPLETE, fivePercentHoldersGniTotalCses: -5 })),
    false,
  );
  const { fivePercentHoldersSongjiangMaCommonStock: _omitted, ...partial } = COMPLETE;
  assert.equal(hasCompleteFivePercentHolderGlobalParameters(map(partial)), false);
});

test('the empty 5% Holders grid shows a 0 baseline as blank, not as zero shares', () => {
  const rows = emptyFivePercentHolderRows(map({ ...COMPLETE, fivePercentHoldersGniCommonStock: 0 }));
  assert.equal(rows[0]?.commonStock, null);
  assert.equal(rows[0]?.totalCses, COMPLETE.fivePercentHoldersGniTotalCses);
  assert.equal(rows[1]?.commonStock, COMPLETE.fivePercentHoldersSongjiangMaCommonStock);
});

test('the retired series B constant is excluded from the Global Parameter page too', () => {
  // Read SERIES B computes Series B Preferred (Shares Issued × 5). The old fixed value is read by nothing.
  assert.deepEqual([...retiredGlobalParameterKeys], ['series_b_preferred_stock']);
  assert.ok(unmanagedGlobalParameterKeys.includes('series_b_preferred_stock'));
  assert.equal(unmanagedGlobalParameterKeys.length, monthlyFixedValueGlobalParameterKeys.length + 1);
});

test('the five monthly constants are excluded from the Global Parameter page', () => {
  // They are maintained per month on the Monthly Update page; the global rows of the same name are dead.
  assert.deepEqual([...monthlyFixedValueGlobalParameterKeys].sort(), [
    'cullgen_common_stock',
    'gyre_2023_china_subplan_total',
    'options_available_cullgen',
    'options_outstanding_cullgen',
    'warrants_convertible_preferred',
  ]);
});

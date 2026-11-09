import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  applyFivePercentHolderDenominators,
  deriveFivePercentHolderDenominators,
} from './summary.js';

/**
 * The 5% Holders page used to take "Common Stock OS" as `Common Shares OS + Cullgen common stock`.
 * The business definition is the Capitalization Table Summary View's own `Asset Class Summary: EOM`
 * row — it is the issued-share total the percentages are measured against, and it drifts from that
 * two-row sum as soon as a third asset class appears in the file.
 *
 * These tests pin: (1) which row is read, (2) that a missing row is reported as missing instead of
 * silently falling back to the old sum, (3) that the percentages are recomputed from the same
 * denominators so the tiles and the table cannot disagree.
 */

const capitalizationRow = (description: string, value: unknown) => ({
  Number: '',
  Description: description,
  'Common Shares Equivalent': value,
  '% of fully diluted': '',
});

test('Common Stock OS is the Asset Class Summary: EOM row, not the sum of the share rows', () => {
  const denominators = deriveFivePercentHolderDenominators([
    capitalizationRow('Issued Shares -Equity Asset Clas', ''),
    capitalizationRow('Asset Class Summary: EOM', 111_488_849),
    capitalizationRow('Common Shares OS', 91_466_284),
    capitalizationRow('Cullgen common stock', 14_450_527),
    capitalizationRow('Total Fully Diluted Shares Outstanding', 133_555_617),
  ]);

  assert.deepEqual(denominators, { commonStockOs: 111_488_849, fullyDiluted: 133_555_617 });
});

test('denominator rows are matched case- and whitespace-insensitively and accept grouped numbers', () => {
  const denominators = deriveFivePercentHolderDenominators([
    capitalizationRow('  asset class summary:   eom ', '112,079,026'),
    capitalizationRow('TOTAL FULLY DILUTED SHARES OUTSTANDING', '156,190,293'),
  ]);

  assert.deepEqual(denominators, { commonStockOs: 112_079_026, fullyDiluted: 156_190_293 });
});

test('a missing Asset Class Summary row stays null instead of reviving the old two-row sum', () => {
  const denominators = deriveFivePercentHolderDenominators([
    capitalizationRow('Common Shares OS', 91_466_284),
    capitalizationRow('Cullgen common stock', 14_450_527),
  ]);

  assert.deepEqual(denominators, { commonStockOs: null, fullyDiluted: null });
});

test('percentages are recomputed from the given denominators for holders and the total row', () => {
  const rows = applyFivePercentHolderDenominators(
    [
      {
        rowType: 'holder' as const,
        name: 'GNI Group Ltd.',
        commonStock: 72_773_219,
        totalCses: 86_323_020,
        pctOfClass: 0.685_53,
        pctFullyDiluted: 0.567_83,
        sc13Filing: null,
        note: null,
      },
      {
        rowType: 'total' as const,
        name: 'Total >5%',
        commonStock: 75_579_303,
        totalCses: 93_665_151,
        pctOfClass: 0.711_96,
        pctFullyDiluted: 0.616_13,
        sc13Filing: null,
        note: null,
      },
    ],
    { commonStockOs: 111_488_849, fullyDiluted: 133_555_617 },
  );

  assert.equal(rows[0].pctOfClass, 72_773_219 / 111_488_849);
  assert.equal(rows[0].pctFullyDiluted, 86_323_020 / 133_555_617);
  assert.equal(rows[1].pctOfClass, 75_579_303 / 111_488_849);
  assert.equal(rows[1].pctFullyDiluted, 93_665_151 / 133_555_617);
});

test('a missing denominator leaves the percentage empty rather than guessing', () => {
  const rows = applyFivePercentHolderDenominators(
    [
      {
        rowType: 'holder' as const,
        name: 'GNI Group Ltd.',
        commonStock: 72_773_219,
        totalCses: null,
        pctOfClass: 0.685_53,
        pctFullyDiluted: 0.567_83,
        sc13Filing: null,
        note: null,
      },
    ],
    { commonStockOs: null, fullyDiluted: 0 },
  );

  assert.equal(rows[0].pctOfClass, null);
  assert.equal(rows[0].pctFullyDiluted, null);
});

test('the workflow definition reads the same rows the page does', () => {
  const seed = JSON.parse(
    readFileSync(path.join(process.cwd(), 'database/workflows/five-percent-holders-sync.json'), 'utf8'),
  ) as {
    version: number;
    tasks: Array<{ id: string; params?: { sql?: string } }>;
  };

  const calculate = seed.tasks.find((task) => task.id === 'calculate_five_percent_holders');
  assert.ok(calculate?.params?.sql);
  assert.match(calculate.params.sql, /asset class summary: eom/i);
  assert.doesNotMatch(
    calculate.params.sql,
    /in \('common shares os', 'cullgen common stock'\)/i,
    'common_stock_os must not be the two-row sum any more',
  );

  const guard = seed.tasks.find((task) => task.id === 'assert_five_percent_denominators');
  assert.ok(guard?.params?.sql);
  assert.match(guard.params.sql, /asset class summary: eom/i);
});

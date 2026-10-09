import assert from 'node:assert/strict';
import test from 'node:test';

import type { CapitalizationRow } from '../shared/types.js';
import {
  computeCapitalizationDelta,
  computeCapitalizationRowDeltas,
  findComparableRow,
  indexCapitalizationRows,
  normalizeDisplayPercent,
  normalizeCapitalizationRows,
  resolveBaselineMonth,
  resolveDefaultSummaryMonth,
  monthAvailabilityLabel,
  sortAvailableMonths,
} from './summaryPage.js';

test('month options sort newest first and distinguish months with data', () => {
  const months = sortAvailableMonths([
    { month: '2026-04', hasData: false },
    { month: '2026-06', hasData: true },
    { month: '2026-05', hasData: true },
  ]);
  assert.deepEqual(
    months.map((item) => item.month),
    ['2026-06', '2026-05', '2026-04'],
  );
  assert.equal(monthAvailabilityLabel(months[0]), '2026-06 · 有数据');
  assert.equal(monthAvailabilityLabel(months[2]), '2026-04 · 暂无数据');
});

test('legacy Captable snapshots receive the configured Series B row and updated totals', () => {
  const rows: CapitalizationRow[] = [
    { type: 'data', number: '1', description: 'Common Shares OS', shares: 90, percent: 0.9 },
    { type: 'data', number: '6', description: 'Options Outstanding- Gyre', shares: 10, percent: 0.1 },
    { type: 'data', number: '7', description: 'Options Available- Gyre', shares: 0, percent: 0 },
    { type: 'data', description: 'Total Fully Diluted Shares Outstand', shares: 100, percent: 1 },
  ];
  const result = normalizeCapitalizationRows(rows, 20);
  const seriesB = result.find((row) => row.description === 'Series B Preferred Stock');
  const total = result.find((row) => row.description.startsWith('Total Fully Diluted'));
  assert.deepEqual(seriesB, {
    type: 'data',
    number: '6',
    description: 'Series B Preferred Stock',
    shares: 20,
    percent: 20 / 120,
  });
  assert.equal(result.find((row) => row.description === 'Options Outstanding- Gyre')?.number, '7');
  assert.equal(total?.shares, 120);
  assert.equal(result.find((row) => row.description === 'Common Shares OS')?.percent, 90 / 120);
});

test('new Captable snapshots do not duplicate Series B', () => {
  const rows: CapitalizationRow[] = [
    { type: 'data', number: '6', description: 'Series B Preferred Stock', shares: 20, percent: 1 },
  ];
  assert.deepEqual(normalizeCapitalizationRows(rows, 18_486_180), rows);
});

test('CapTable defaults to the month of the latest successful monthly output', () => {
  assert.equal(
    resolveDefaultSummaryMonth(['2026-06', '2026-05'], {
      monthKey: '2026-05',
      fileId: 9,
      fileName: 'latest-result.xlsx',
      finishedAt: '2026-07-13T10:00:00.000Z',
    }),
    '2026-05',
  );
});

test('CapTable falls back to the newest available month when no execution has an output', () => {
  assert.equal(resolveDefaultSummaryMonth(['2026-06', '2026-05'], null), '2026-06');
  assert.equal(resolveDefaultSummaryMonth([], null), '');
});

test('month-over-month baseline is the closest earlier month', () => {
  assert.equal(resolveBaselineMonth(['2026-06', '2026-05', '2026-04'], '2026-06'), '2026-05');
  assert.equal(resolveBaselineMonth(['2026-06', '2026-05', '2026-04'], '2026-05'), '2026-04');
  assert.equal(resolveBaselineMonth(['2026-06', '2026-05'], '2026-05'), null);
  assert.equal(resolveBaselineMonth(['2026-06'], '2026-06'), null);
  assert.equal(resolveBaselineMonth([], '2026-06'), null);
  assert.equal(resolveBaselineMonth(['2026-05'], ''), null);
});

test('percent values are normalized the same way the summary cell renders them', () => {
  assert.equal(normalizeDisplayPercent(0.6848553887478952)?.toFixed(2), '68.49');
  assert.equal(normalizeDisplayPercent(72.4), 72.4);
  assert.equal(normalizeDisplayPercent(1), 100);
  assert.equal(normalizeDisplayPercent(0), 0);
  assert.equal(normalizeDisplayPercent(null), null);
  assert.equal(normalizeDisplayPercent(undefined), null);
  assert.equal(normalizeDisplayPercent(Number.NaN), null);
});

test('baseline rows are matched by description, falling back to the row number', () => {
  const index = indexCapitalizationRows([
    { type: 'data', number: '1', description: 'Common Shares OS', shares: 91_466_284, percent: 0.6848553887478952 },
    { type: 'data', number: '6', description: 'Options Outstanding - G', shares: 13_500_000, percent: 0.1027 },
    { type: 'data', description: 'Duplicated row', shares: 1 },
    { type: 'data', description: 'duplicated row', shares: 2 },
  ]);

  assert.equal(findComparableRow(index, { description: '  common shares OS  ' })?.shares, 91_466_284);
  assert.equal(findComparableRow(index, { description: 'Options Outstanding- Gyre', number: '6' })?.shares, 13_500_000);
  assert.equal(findComparableRow(index, { description: 'Duplicated row' }), null);
  assert.equal(findComparableRow(index, { description: 'Not in the baseline month' }), null);
  assert.equal(findComparableRow(index, { description: 'Renamed row', number: '' }), null);
});

test('share deltas carry a sign and a direction, and stay empty without a baseline', () => {
  assert.deepEqual(computeCapitalizationDelta(91_529_389, 91_466_284, 'shares'), {
    direction: 'up',
    value: 63_105,
    text: '+63,105',
  });
  assert.deepEqual(computeCapitalizationDelta(133_555_617, 137_712_213, 'shares'), {
    direction: 'down',
    value: -4_156_596,
    text: '-4,156,596',
  });
  assert.deepEqual(computeCapitalizationDelta(10_994, 10_994, 'shares'), { direction: 'flat', value: 0, text: '' });
  assert.deepEqual(computeCapitalizationDelta(10_994, undefined, 'shares'), { direction: 'none', value: 0, text: '' });
  assert.deepEqual(computeCapitalizationDelta(undefined, 10_994, 'shares'), { direction: 'none', value: 0, text: '' });
});

test('percent deltas are percentage differences and ignore rounding noise', () => {
  assert.deepEqual(computeCapitalizationDelta(66.46, 68.49, 'percent'), {
    direction: 'down',
    value: 66.46 - 68.49,
    text: '-2.03%',
  });
  assert.equal(computeCapitalizationDelta(10.4932, 10.8198, 'percent').text, '-0.33%');
  assert.equal(computeCapitalizationDelta(100, 100, 'percent').direction, 'flat');
  assert.equal(computeCapitalizationDelta(10.004, 10, 'percent').direction, 'flat');
  assert.equal(computeCapitalizationDelta(10.01, 10, 'percent').direction, 'up');
  assert.deepEqual(computeCapitalizationDelta(10, null, 'percent'), { direction: 'none', value: 0, text: '' });
});

test('row deltas compare shares and normalized percentages together', () => {
  const previous: CapitalizationRow[] = [
    { type: 'cat-sub-label', description: 'Asset Class Summary: EOM', shares: 111_488_849, percent: null },
    { type: 'data', number: '1', description: 'Common Shares OS', shares: 91_466_284, percent: 0.6848553887478952 },
    {
      type: 'data',
      number: '2',
      description: 'Cullgen common stock',
      shares: 14_450_527,
      percent: 0.10819857168568207,
    },
    {
      type: 'data',
      number: '9',
      description: 'Options Available- Cullgen',
      shares: 10_994,
      percent: 0.00008231776578891473,
    },
  ];
  const index = indexCapitalizationRows(previous);
  const deltasFor = (row: CapitalizationRow) => computeCapitalizationRowDeltas(row, findComparableRow(index, row));

  // Shares up while the share of fully diluted goes down.
  const commonShares = deltasFor({
    type: 'data',
    number: '1',
    description: 'Common Shares OS',
    shares: 91_529_389,
    percent: 0.6646424961597269,
  });
  assert.equal(commonShares.shares.direction, 'up');
  assert.equal(commonShares.shares.text, '+63,105');
  assert.equal(commonShares.percent.direction, 'down');
  assert.equal(commonShares.percent.text, '-2.02%');

  // Unchanged shares still shift as a percentage of the bigger denominator.
  const cullgen = deltasFor({
    type: 'data',
    number: '2',
    description: 'Cullgen common stock',
    shares: 14_450_527,
    percent: 0.10493279198120213,
  });
  assert.equal(cullgen.shares.direction, 'flat');
  assert.equal(cullgen.shares.text, '');
  assert.equal(cullgen.percent.direction, 'down');
  assert.equal(cullgen.percent.text, '-0.33%');

  // Sub-label rows only compare shares.
  const subLabel = deltasFor({
    type: 'cat-sub-label',
    description: 'Asset Class Summary: EOM',
    shares: 111_509_849,
    percent: null,
  });
  assert.equal(subLabel.shares.text, '+21,000');
  assert.equal(subLabel.percent.direction, 'none');

  // Rows missing from the baseline month stay blank instead of showing a fake change.
  const newRow = deltasFor({ type: 'data', number: '10', description: 'Brand new metric', shares: 42, percent: 0.001 });
  assert.equal(newRow.shares.direction, 'none');
  assert.equal(newRow.percent.direction, 'none');
});

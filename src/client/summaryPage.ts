import type { CapitalizationRow, LatestMonthlyRunOutput } from '../shared/types.js';

export function resolveDefaultSummaryMonth(
  availableMonths: string[],
  latestOutput: LatestMonthlyRunOutput | null,
): string {
  if (latestOutput && availableMonths.includes(latestOutput.monthKey)) return latestOutput.monthKey;
  return availableMonths[0] ?? '';
}

export function resolveBaselineMonth(availableMonths: string[], currentMonth: string): string | null {
  if (!currentMonth) return null;
  const earlierMonths = availableMonths.filter((month) => month && month < currentMonth).sort();
  return earlierMonths[earlierMonths.length - 1] ?? null;
}

/**
 * Mirrors formatCapitalizationPercent in main.ts: values at or below 1 are fractions.
 * Deltas must equal the difference of the two percentages the page actually shows,
 * so both months have to go through the same normalization.
 */
export function normalizeDisplayPercent(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const numericValue = Number(value);
  if (Number.isNaN(numericValue)) return null;
  return numericValue <= 1 ? numericValue * 100 : numericValue;
}

export type CapitalizationRowIndex = {
  byDescription: Map<string, CapitalizationRow[]>;
  byNumber: Map<string, CapitalizationRow[]>;
};

function pushIndexEntry(index: Map<string, CapitalizationRow[]>, key: string, row: CapitalizationRow) {
  const existing = index.get(key);
  if (existing) existing.push(row);
  else index.set(key, [row]);
}

function descriptionKey(description: string): string {
  return description.trim().toLowerCase();
}

export function indexCapitalizationRows(rows: ReadonlyArray<CapitalizationRow>): CapitalizationRowIndex {
  const index: CapitalizationRowIndex = { byDescription: new Map(), byNumber: new Map() };
  rows.forEach((row) => {
    pushIndexEntry(index.byDescription, descriptionKey(row.description), row);
    const number = row.number?.trim();
    if (number) pushIndexEntry(index.byNumber, number, row);
  });
  return index;
}

/** Only matches unambiguous rows: duplicated keys stay uncompared instead of pairing the wrong rows. */
export function findComparableRow(
  index: CapitalizationRowIndex,
  row: Pick<CapitalizationRow, 'description' | 'number'>,
): CapitalizationRow | null {
  const byDescription = index.byDescription.get(descriptionKey(row.description));
  if (byDescription?.length === 1) return byDescription[0];
  const number = row.number?.trim();
  if (number) {
    const byNumber = index.byNumber.get(number);
    if (byNumber?.length === 1) return byNumber[0];
  }
  return null;
}

export type CapitalizationDeltaDirection = 'up' | 'down' | 'flat' | 'none';

export type CapitalizationDelta = {
  direction: CapitalizationDeltaDirection;
  value: number;
  text: string;
};

const NO_CAPITALIZATION_DELTA: CapitalizationDelta = { direction: 'none', value: 0, text: '' };
const PERCENT_FLAT_THRESHOLD = 0.005;

function toComparableNumber(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const numericValue = Number(value);
  return Number.isNaN(numericValue) ? null : numericValue;
}

export function computeCapitalizationDelta(
  current: number | null | undefined,
  previous: number | null | undefined,
  kind: 'shares' | 'percent',
): CapitalizationDelta {
  const currentValue = toComparableNumber(current);
  const previousValue = toComparableNumber(previous);
  if (currentValue === null || previousValue === null) return NO_CAPITALIZATION_DELTA;

  const difference = currentValue - previousValue;
  const isFlat = kind === 'percent' ? Math.abs(difference) < PERCENT_FLAT_THRESHOLD : difference === 0;
  if (isFlat) return { direction: 'flat', value: difference, text: '' };

  const sign = difference > 0 ? '+' : '-';
  const magnitude = Math.abs(difference);
  const text = kind === 'percent'
    ? `${sign}${magnitude.toFixed(2)}%`
    : `${sign}${Math.round(magnitude).toLocaleString('en-US')}`;
  return { direction: difference > 0 ? 'up' : 'down', value: difference, text };
}

export type CapitalizationRowDeltas = {
  shares: CapitalizationDelta;
  percent: CapitalizationDelta;
};

export function computeCapitalizationRowDeltas(
  current: Pick<CapitalizationRow, 'shares' | 'percent'>,
  previous: Pick<CapitalizationRow, 'shares' | 'percent'> | null,
): CapitalizationRowDeltas {
  return {
    shares: computeCapitalizationDelta(current.shares, previous?.shares, 'shares'),
    percent: computeCapitalizationDelta(
      normalizeDisplayPercent(current.percent),
      normalizeDisplayPercent(previous?.percent),
      'percent',
    ),
  };
}

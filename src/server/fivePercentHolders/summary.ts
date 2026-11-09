import type { FivePercentHolderRow } from './persistence.js';

/**
 * Denominators the 5% Holders percentages are measured against, read from the monthly
 * Capitalization Table Summary View (`Capitalization Summary` sheet).
 *
 * Both come from the workbook itself rather than from arithmetic on other rows:
 *
 * - `commonStockOs` is the `Asset Class Summary: EOM` row. It is the issued-share total, and it is
 *   not the sum of `Common Shares OS + Cullgen common stock` — that sum was the old definition and
 *   it drifts as soon as a third asset class shows up in the file.
 * - `fullyDiluted` is the `Total Fully Diluted Shares Outstanding` row.
 *
 * A row that is missing stays null on purpose: falling back to the old sum would silently publish a
 * different number under the same label.
 */
export function deriveFivePercentHolderDenominators(rows: ReadonlyArray<Record<string, unknown>>): {
  commonStockOs: number | null;
  fullyDiluted: number | null;
} {
  let commonStockOs: number | null = null;
  let fullyDiluted: number | null = null;

  for (const row of rows) {
    const description = normalizeDescription(row.Description ?? row.description);
    if (!description) continue;
    const value = parseShares(row['Common Shares Equivalent'] ?? row['common shares equivalent']);
    if (value === null) continue;
    if (description === 'asset class summary: eom') {
      commonStockOs ??= value;
      continue;
    }
    if (description.startsWith('total fully diluted shares outstand')) {
      fullyDiluted ??= value;
    }
  }

  return { commonStockOs, fullyDiluted };
}

/**
 * Recompute `% of Class` / `% Fully Diluted` against the denominators above.
 *
 * The stored grid keeps the percentages the workflow computed at run time; once the denominators
 * come from the newest monthly output, keeping them would let the two tiles and the table disagree
 * (the tiles say 112,079,026 while the percentages still divide by last month's total).
 */
export function applyFivePercentHolderDenominators<T extends FivePercentHolderRow>(
  holders: ReadonlyArray<T>,
  denominators: { commonStockOs: number | null; fullyDiluted: number | null },
): T[] {
  return holders.map((holder) => ({
    ...holder,
    pctOfClass: ratio(holder.commonStock, denominators.commonStockOs),
    pctFullyDiluted: ratio(holder.totalCses, denominators.fullyDiluted),
  }));
}

function ratio(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator <= 0) return null;
  return numerator / denominator;
}

function normalizeDescription(value: unknown): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function parseShares(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/,/g, '').trim();
  if (!text || text === '--') return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

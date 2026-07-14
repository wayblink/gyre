import type { LatestMonthlyRunOutput } from '../shared/types.js';

export function resolveDefaultSummaryMonth(
  availableMonths: string[],
  latestOutput: LatestMonthlyRunOutput | null,
): string {
  if (latestOutput && availableMonths.includes(latestOutput.monthKey)) return latestOutput.monthKey;
  return availableMonths[0] ?? '';
}

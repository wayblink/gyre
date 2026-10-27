/**
 * The distinct values a "type" column offers, for the monthly/records filters.
 *
 * Each view of the grant record carries its type under a different column (Futu `激励类型`, Shareworks
 * `Grant Type`, the merged view a normalised field), so the filter options cannot be a hardcoded list:
 * they are derived from the rows the endpoint actually returned.
 */
export function distinctGrantTypes(values: Array<string | null | undefined>): string[] {
  const set = new Set<string>();
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) set.add(text);
  }
  return [...set].sort((left, right) => left.localeCompare(right));
}

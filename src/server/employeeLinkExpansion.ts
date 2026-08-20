// Expand an in-memory query result across linked "same person" groups.
//
// Employee "关联" declares that several external 工号 (Futu / Shareworks numbers) are the same
// person, via a canonical id (coalesce(merged_into_id, id)). Detail pages (grants / exercises /
// sold shares) search over per-工号 artifact rows; this helper makes a query that matches any one
// 工号 surface every row whose 工号 shares the matched row's canonical group.
//
// With an empty query it simply returns the rows that pass `matches` (no expansion), preserving the
// previous "filter by substring" behaviour.
export function expandByLinkedGroup<T extends { employeeNumber: string }>(
  rows: T[],
  normalizedQuery: string,
  canonicalByNumber: Map<string, number>,
  matches: (row: T) => boolean,
): T[] {
  if (!normalizedQuery) return rows.filter(matches);
  const canonicalKey = (num: string) => String(canonicalByNumber.get(num) ?? num);
  const hitGroups = new Set(rows.filter(matches).map((row) => canonicalKey(row.employeeNumber)));
  return rows.filter((row) => hitGroups.has(canonicalKey(row.employeeNumber)));
}

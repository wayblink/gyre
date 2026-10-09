/**
 * Normalizes a DB timestamp (timestamptz comes back as Date, some columns as text) to an ISO
 * string. Unparseable values are returned untouched instead of throwing, so a single bad row
 * cannot fail a whole list request.
 */
export function toIsoTimestamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
  }
  return String(value);
}

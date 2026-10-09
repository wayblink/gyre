/**
 * Shared JSON/record helpers for reading jsonb columns and untyped payloads.
 *
 * `pg` returns jsonb columns as already-parsed objects, but text/varchar columns and cached
 * snapshots arrive as strings, so every reader needs the same "parse if needed, else fall back"
 * behaviour. These lived as private copies in a dozen modules; keep one implementation here.
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'object') return value as T;
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return fallback;
  }
}

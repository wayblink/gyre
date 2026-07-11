import type { QueryResultRow } from 'pg';

export const SQL_IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface UpsertDbLike {
  queryOne<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<T | undefined>;
}

export type UpsertTableParams = {
  table: string;
  columns: string[];
  rows: Array<Record<string, unknown>>;
  conflictColumns: string[];
  updateColumns: string[];
};

export type UpsertPlan = { sql: string; params: unknown[] };

function quoteIdentifier(name: string, kind: string): string {
  if (!SQL_IDENTIFIER_PATTERN.test(name)) {
    throw new Error(`Invalid ${kind} for DB write: ${name}`);
  }
  return `"${name}"`;
}

/**
 * Build a parameterized multi-row UPSERT statement. Pure and side-effect free so the
 * generated SQL/params can be asserted in tests. All identifiers are validated and quoted.
 * `updateColumns` empty ⇒ ON CONFLICT DO NOTHING. Returns a CTE that reports how many rows
 * were inserted vs updated via `(xmax = 0)`.
 */
export function buildUpsertPlan(params: UpsertTableParams): UpsertPlan {
  const { table, columns, rows, conflictColumns, updateColumns } = params;
  if (!columns.length) throw new Error('DB upsert requires at least one column');
  if (!conflictColumns.length) throw new Error('DB upsert requires at least one conflict column');
  if (!conflictColumns.every((column) => columns.includes(column))) {
    throw new Error('Conflict columns must be part of the written columns');
  }
  if (!updateColumns.every((column) => columns.includes(column))) {
    throw new Error('Update columns must be part of the written columns');
  }

  const safeTable = quoteIdentifier(table, 'table');
  const safeColumns = columns.map((column) => quoteIdentifier(column, 'column'));
  const safeConflict = conflictColumns.map((column) => quoteIdentifier(column, 'conflict column'));

  const values: unknown[] = [];
  let placeholder = 1;
  const tuples = rows.map((row) => {
    const cells = columns.map((column) => {
      values.push(row[column] ?? null);
      return `$${placeholder++}`;
    });
    return `(${cells.join(', ')})`;
  });

  const conflictAction = updateColumns.length
    ? `do update set ${updateColumns
        .map((column) => `${quoteIdentifier(column, 'update column')} = excluded.${quoteIdentifier(column, 'update column')}`)
        .join(', ')}`
    : 'do nothing';

  const sql = `with upserted as (
  insert into ${safeTable} (${safeColumns.join(', ')})
  values ${tuples.join(', ')}
  on conflict (${safeConflict.join(', ')}) ${conflictAction}
  returning (xmax = 0) as inserted
)
select
  count(*) filter (where inserted)::int as inserted,
  count(*) filter (where not inserted)::int as updated
from upserted`;

  return { sql, params: values };
}

/**
 * Upsert dataframe rows into a whitelisted table. Enforces the table whitelist, then runs
 * the plan from {@link buildUpsertPlan}. Returns inserted/updated counts.
 */
export async function upsertTableRows(
  db: UpsertDbLike,
  params: UpsertTableParams,
  writableTables: ReadonlySet<string>,
): Promise<{ inserted: number; updated: number }> {
  if (!writableTables.has(params.table)) {
    throw new Error(`Table is not writable by workflow: ${params.table}`);
  }
  if (!params.rows.length) return { inserted: 0, updated: 0 };
  const plan = buildUpsertPlan(params);
  const result = await db.queryOne<{ inserted: number; updated: number }>(plan.sql, plan.params);
  return { inserted: Number(result?.inserted ?? 0), updated: Number(result?.updated ?? 0) };
}

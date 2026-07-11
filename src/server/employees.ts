import type { QueryResultRow } from 'pg';

export type EmployeeSource = 'futu' | 'shareworks' | 'manual';

/**
 * Normalize an external staff number (Futu 工号 / Shareworks employee number) into a
 * stable form: NFKC-fold, trim, collapse internal whitespace, uppercase. The employee
 * number IS the business key, so this must be deterministic.
 */
export function normalizeExternalNumber(raw: string): string {
  if (!raw) return '';
  return raw.normalize('NFKC').trim().replace(/\s+/g, ' ').toUpperCase();
}

/**
 * Assemble a Shareworks `last / first / middle` triple into a single display name.
 * Order and filtering mirror the Merge convention in esopPages.ts.
 */
export function assembleShareworksName(
  last: string | null | undefined,
  first: string | null | undefined,
  middle: string | null | undefined,
): string {
  return [last, first, middle]
    .map((part) => (part == null ? '' : String(part).trim()))
    .filter(Boolean)
    .join(' ');
}

/**
 * Storage abstraction for employee upsert. Injectable so the policy can be unit-tested
 * without a database (see employees.test.ts); production wires it to Postgres via
 * {@link createDbEmployeeStore}.
 */
export interface EmployeeStore {
  /** Upsert an employee keyed on its business employee_id (工号); returns the surrogate row id. */
  upsertByEmployeeId(input: {
    employeeId: string;
    source: EmployeeSource;
    name: string;
    hasFileEvidence: boolean;
  }): Promise<number | null>;
}

export type UpsertEmployeeParams = {
  /** The business key — Excel 工号 (Futu) or Shareworks employee number. */
  employeeId: string;
  source: EmployeeSource;
  name: string;
  /** Whether this occurrence is backed by an imported detail file. */
  hasFileEvidence?: boolean;
};

/**
 * Upsert an employee by its employee_id (工号). The employee number is the identity and
 * comes straight from the parsed data — nothing is system-allocated. Re-importing the same
 * number reuses the row (append-only, idempotent). Futu and Shareworks numbers live in
 * separate rows even for the same person; cross-source same-person cases are reconciled
 * later by an explicit merge, not here. Returns the surrogate row id (for grant linking).
 */
export async function upsertEmployeeByEmployeeId(
  store: EmployeeStore,
  params: UpsertEmployeeParams,
): Promise<number | null> {
  const employeeId = normalizeExternalNumber(params.employeeId);
  if (!employeeId) return null;
  return store.upsertByEmployeeId({
    employeeId,
    source: params.source,
    name: params.name.trim() || employeeId,
    hasFileEvidence: params.hasFileEvidence ?? params.source !== 'manual',
  });
}

export interface EmployeeDbLike {
  query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<T[]>;
  queryOne<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<T | undefined>;
  execute(text: string, params?: unknown[]): Promise<void>;
}

/** Postgres-backed {@link EmployeeStore}. */
export function createDbEmployeeStore(db: EmployeeDbLike): EmployeeStore {
  return {
    async upsertByEmployeeId(input) {
      const row = await db.queryOne<{ id: number }>(
        `insert into employees (employee_id, source, employee_name, has_file_evidence)
         values ($1, $2, $3, $4)
         on conflict (employee_id) do update set
           employee_name = excluded.employee_name,
           has_file_evidence = employees.has_file_evidence or excluded.has_file_evidence,
           updated_at = current_timestamp
         returning id`,
        [input.employeeId, input.source, input.name, input.hasFileEvidence],
      );
      return row ? Number(row.id) : null;
    },
  };
}

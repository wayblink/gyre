import { MONTHLY_WORKFLOW_CODE, type MonthlyRunDb } from './store.js';

export type MonthlyWorkflowSelection = {
  workflowId?: number;
  workflowCode?: string;
};

export async function resolveMonthlyWorkflowDefinition(
  db: MonthlyRunDb,
  selection: MonthlyWorkflowSelection = {},
): Promise<Record<string, unknown> | null> {
  if (selection.workflowId) {
    return (await db.queryOne<Record<string, unknown>>('select * from workflow_definitions where id = $1', [selection.workflowId])) ?? null;
  }

  const workflowCode = selection.workflowCode?.trim() || MONTHLY_WORKFLOW_CODE;
  return (await db.queryOne<Record<string, unknown>>('select * from workflow_definitions where code = $1', [workflowCode])) ?? null;
}

export function monthlyWorkflowSelectionLabel(selection: MonthlyWorkflowSelection = {}) {
  if (selection.workflowId) return `id=${selection.workflowId}`;
  return selection.workflowCode?.trim() || MONTHLY_WORKFLOW_CODE;
}

/**
 * The Monthly Update page pins the monthly workflow definition version it was built against (see
 * `MONTHLY_WORKFLOW_VERSION` in `src/client/monthlyRunPage.ts`) and sends it with every run request.
 * The definition itself is DB-owned, so a stale page (or a definition edited straight in the DB /
 * workflow page without a code deploy) shows up as a version mismatch: the page would render input
 * sources the workflow no longer reads, or miss sources it now requires. Return the mismatch so the
 * caller can reject the run, or null when the versions line up.
 */
export function monthlyWorkflowVersionMismatch(
  workflowRow: { version?: unknown } | null | undefined,
  expectedVersion: unknown,
): { expected: number; actual: number } | null {
  if (expectedVersion === undefined || expectedVersion === null) return null;
  const expected = Number(expectedVersion);
  if (!Number.isInteger(expected) || expected < 1) return null;
  const rawActual = Number(workflowRow?.version);
  const actual = Number.isInteger(rawActual) ? rawActual : 0;
  return actual === expected ? null : { expected, actual };
}

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

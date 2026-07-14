import type { WorkflowDataFrame } from '../../shared/types.js';
import type { AppDb } from '../db.js';

export type PlanSummaryPersistInput = { dataframe: WorkflowDataFrame; sourceFileId: number };
export type PlanSummaryPersistResult = { rowsWritten: number };

function number(value: unknown): number {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid Plan Summary number: ${String(value)}`);
  return parsed;
}

export async function persistPlanSummary(db: AppDb, input: PlanSummaryPersistInput): Promise<PlanSummaryPersistResult> {
  const rowsWritten = await db.transaction(async (client) => {
    await client.execute('delete from plan_summary_rows');
    let count = 0;
    for (const [sortOrder, row] of input.dataframe.rows.entries()) {
      const planName = String(row.plan_name ?? '').trim();
      if (!planName) continue;
      await client.execute(
        `insert into plan_summary_rows (
          source_file_id, plan_name, grant_count, granted, exercised, cancelled, outstanding, sort_order
        ) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [input.sourceFileId, planName, number(row.grant_count), number(row.granted), number(row.exercised), number(row.cancelled), number(row.outstanding), sortOrder],
      );
      count += 1;
    }
    return count;
  });
  return { rowsWritten };
}

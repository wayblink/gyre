import type { WorkflowRunRecord, WorkflowRuntimeParameters } from '../../shared/types.js';
import { loadActiveWorkflowDefinition, startWorkflowRun } from '../workflow/startWorkflowRun.js';
import type { WorkflowBootstrapDb } from '../workflow/startWorkflowRun.js';
import type { WorkflowRunCreator, WorkflowRunStarter } from '../workflow/startWorkflowRun.js';
import { MONTHLY_WORKFLOW_CODE } from './store.js';

/**
 * Month snapshots for the ESOP record pages, produced after a monthly run finishes.
 *
 * The record pages resolve their data through `readLatestWorkflowDataFrameArtifact`, which looks for
 * a *run of their own workflow* tagged with `runtime_parameters_json->>'month'`. Invoking the syncs
 * inside the monthly workflow does not satisfy that: the child's persisted files get recorded as
 * artifacts of the monthly run (`task_id = invoke_*`), and only the child's final task is captured —
 * so the Exercise Record page's two snapshots collided and none of them were visible per month.
 *
 * Starting a real run per page fixes all of it: each snapshot belongs to an `esop-*-sync` run with
 * the month tagged on it, `/api/months` flags it, and the file name carries the month suffix.
 */
type RecordPageSync = {
  /** Page whose snapshot this run produces; used for logging only. */
  pageKey: string;
  workflowCode: string;
  /** child fileRef key -> monthly fileRef key */
  fileRefs: Record<string, string>;
};

const RECORD_PAGE_SYNCS: readonly RecordPageSync[] = [
  {
    pageKey: 'exercise-record',
    workflowCode: 'esop-exercise-record-sync',
    // The Futu view reuses the monthly's Futu exercise export: the same workbook, and the child
    // reads its `行权汇总数据` sheet through a literal sheet name.
    fileRefs: { futu_exercises: 'incremental_futu_exercises', shareworks_exercises: 'exercise_record_shareworks' },
  },
  {
    pageKey: 'sold-shares',
    workflowCode: 'esop-sold-shares-sync',
    fileRefs: { futu_sold_shares: 'sold_shares_futu' },
  },
  {
    pageKey: 'cancellation-record',
    workflowCode: 'esop-cancellation-record-sync',
    fileRefs: { cancellation_report: 'incremental_cancel_restore_report' },
  },
];

/** Statuses whose artifacts the record pages consider readable. */
const SNAPSHOT_SOURCE_STATUSES = new Set(['completed', 'completed_with_warnings']);

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Start one `esop-*-sync` run per record page for the month the monthly run belongs to.
 *
 * Failures are logged and swallowed: a record page is a side product, and a broken sync must not
 * turn an otherwise successful monthly run into a failure.
 */
export async function triggerMonthlyRecordPageSyncs(
  deps: { db: WorkflowBootstrapDb; runStore: WorkflowRunCreator; executor: WorkflowRunStarter },
  run: WorkflowRunRecord,
  logger?: { error: (obj: unknown, msg?: string) => void; info?: (obj: unknown, msg?: string) => void },
): Promise<void> {
  if (run.workflowCode !== MONTHLY_WORKFLOW_CODE) return;
  if (!SNAPSHOT_SOURCE_STATUSES.has(run.status)) return;

  const runtimeParameters = run.runtimeParameters as WorkflowRuntimeParameters;
  const month = String(runtimeParameters.month ?? '').trim();
  if (!/^\d{4}-\d{2}$/.test(month)) return;
  const monthlyFileRefs = (runtimeParameters.fileRefs ?? {}) as Record<string, unknown>;

  for (const sync of RECORD_PAGE_SYNCS) {
    try {
      const workflow = await loadActiveWorkflowDefinition(deps.db, sync.workflowCode);
      if (!workflow) {
        logger?.error({ workflowCode: sync.workflowCode }, 'Record page snapshot skipped: workflow not found');
        continue;
      }
      const fileRefs: Record<string, unknown> = {};
      for (const [childKey, monthlyKey] of Object.entries(sync.fileRefs)) {
        // Always present, `{}` when the operator did not supply it: the child's optional extract
        // reads that as "not supplied" and yields an empty snapshot.
        fileRefs[childKey] = cloneValue(monthlyFileRefs[monthlyKey] ?? {});
      }
      const childRun = await startWorkflowRun({
        ...deps,
        workflow,
        runtimeParameters: { month, monthUnderscore: month.replace('-', '_'), fileRefs },
      });
      logger?.info?.({ pageKey: sync.pageKey, month, runId: childRun.id }, 'Record page snapshot run started');
    } catch (error) {
      logger?.error({ error, pageKey: sync.pageKey, month }, 'Record page snapshot run failed to start');
    }
  }
}

/**
 * Record pages show cumulative-as-of-month data: each view merges its previous snapshot with the
 * incoming export. The snapshot is written to its own folder as `<folder>/<Name>_Base_YYYY_MM.xlsx`
 * — the shape the other inherited bases use — so the previous one is found by path. That keeps the
 * file findable in Files and needs no artifact lookup.
 *
 * The base is never operator input: the monthly trigger and a standalone page run both inject it.
 */

/** Both the generic `AppDb` and `WorkflowBootstrapDb` satisfy this. */
type Db = {
  queryOne(sql: string, params?: unknown[]): Promise<Record<string, unknown> | undefined>;
};

export type RecordBaseTarget = {
  /** Key the *monthly* workflow uses to pass the base down to the child. */
  monthlySourceKey: string;
  /** Key the child workflow (and therefore a standalone page run) declares for it. */
  childKey: string;
  workflowCode: string;
  folder: string;
  fileName: string;
  sheet: string;
};

export const RECORD_BASE_TARGETS: RecordBaseTarget[] = [
  {
    monthlySourceKey: 'cancellation_record_base',
    childKey: 'base_cancellation_records',
    workflowCode: 'esop-cancellation-record-sync',
    folder: 'cancellation_record',
    fileName: 'Cancellation_Records_Base',
    sheet: 'Cancellation Records',
  },
  {
    monthlySourceKey: 'sold_shares_base',
    childKey: 'base_sold_shares',
    workflowCode: 'esop-sold-shares-sync',
    folder: 'sold_shares',
    fileName: 'Futu_Sold_Shares_Base',
    sheet: 'Futu Sold Shares',
  },
  {
    monthlySourceKey: 'grant_record_futu_base',
    childKey: 'base_grant_futu',
    workflowCode: 'esop-grant-record-sync',
    folder: 'grant_record',
    fileName: 'Futu_Grants_Base',
    sheet: 'Futu Grants',
  },
  {
    monthlySourceKey: 'grant_record_shareworks_base',
    childKey: 'base_grant_shareworks',
    workflowCode: 'esop-grant-record-sync',
    folder: 'grant_record',
    fileName: 'Shareworks_Grants_Base',
    sheet: 'Shareworks Grants',
  },
  {
    monthlySourceKey: 'exercise_record_futu_base',
    childKey: 'base_exercise_futu',
    workflowCode: 'esop-exercise-record-sync',
    folder: 'exercise_record',
    fileName: 'Futu_Exercises_Base',
    sheet: 'Futu BCI Exercises to Date',
  },
  {
    monthlySourceKey: 'exercise_record_shareworks_base',
    childKey: 'base_exercise_shareworks',
    workflowCode: 'esop-exercise-record-sync',
    folder: 'exercise_record',
    fileName: 'Shareworks_Exec_Base',
    sheet: 'Shareworks Exec Option OS',
  },
];

/**
 * Fill the base file references for `monthKey`'s run from the latest snapshot *before* it — a month
 * nobody ran (February, July) must not break the chain. An explicit binding always wins.
 */
async function fillBases(
  db: Db,
  fileRefs: Record<string, unknown> | undefined,
  monthKey: string,
  targets: RecordBaseTarget[],
  keyOf: (target: RecordBaseTarget) => string,
): Promise<void> {
  if (!fileRefs) return;
  const stem = `${monthKey.slice(0, 4)}_${monthKey.slice(5, 7)}`;
  await Promise.all(
    targets.map(async (target) => {
      const key = keyOf(target);
      if (fileRefs[key]) return;
      const prefix = `${target.folder}/${target.fileName}_`;
      const row = await db.queryOne(
        `select logical_path from product_files
          where logical_path like $1 and logical_path < $2
          order by logical_path desc
          limit 1`,
        [`${prefix}%.xlsx`, `${prefix}${stem}.xlsx`],
      );
      const logicalPath = String(row?.logical_path ?? '').trim();
      // Always define the key, with `{}` when there is no earlier snapshot: the child's extract
      // resolves `fileRefs.<key>` and throws when the path is absent, while `{}` is simply "no file
      // yet" — the first month of a chain then starts from its own increment.
      fileRefs[key] = logicalPath ? { provider: 'product-files', key: logicalPath, sheet: target.sheet } : {};
    }),
  );
}

/** The monthly workflow passes every base down to its invokes. */
export async function injectMonthlyRecordBases(
  db: Db,
  fileRefs: Record<string, unknown> | undefined,
  monthKey: string,
): Promise<void> {
  await fillBases(db, fileRefs, monthKey, RECORD_BASE_TARGETS, (target) => target.monthlySourceKey);
}

/** A standalone page run talks to the child workflow, which declares the child keys. */
export async function injectPageRecordBases(
  db: Db,
  fileRefs: Record<string, unknown> | undefined,
  monthKey: string,
  workflowCode: string,
): Promise<void> {
  const targets = RECORD_BASE_TARGETS.filter((target) => target.workflowCode === workflowCode);
  await fillBases(db, fileRefs, monthKey, targets, (target) => target.childKey);
}

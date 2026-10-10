import type { WorkflowRuntimeParameters, WorkflowTask } from '../../shared/types.js';
import { isRecord } from '../utils/json.js';

/**
 * Pre-flight check for workflow runs whose file inputs come from merged defaults.
 *
 * Monthly Update resolves its fileRefs from the instance's saved sources merged over the workflow
 * definition's `runtime_params_defaults`. A default that was never a real product file (a path no
 * `workbook.persist.excel` task writes) or an empty object therefore reaches a `sheet.range.extract`
 * task as `{ sheet: '...' }`, which `normalizeWorkflowFileReference()` rejects. Without this check
 * the failure only surfaces when that task executes — several steps into a run whose earlier steps
 * already wrote files, leaving a half-finished month behind.
 *
 * Every problem is collected so the operator fixes all inputs at once instead of discovering them
 * one red row per run.
 */

/** Why one file input is unusable. */
export type FileRefProblemReason =
  /** The value is not a resolvable product-file reference at all (no `provider`/`key`/`id`). */
  | 'unresolved'
  /** The reference is well-formed but no `product_files` row matches it. */
  | 'missing';

export type FileRefProblem = {
  /** Runtime source key (`fileRefs.<key>`) when the problem is visible there, else null. */
  sourceKey: string | null;
  /** Task whose `params.fileRef` is unusable, else null when only the runtime value is broken. */
  taskName: string | null;
  /** The file key/id that could not be used. */
  fileKey: string;
  reason: FileRefProblemReason;
};

type ResolvedFileReference = { provider: string; key?: string; id?: number };

/**
 * Mirror of `normalizeWorkflowFileReference()` (operators/types.ts) without importing the operator
 * registry: this module is loaded by the route layer, and a pre-flight check must not depend on
 * every operator being registered.
 */
function normalizeFileReference(value: unknown): ResolvedFileReference | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return { provider: 'product-files', id: value };
  }
  if (!isRecord(value)) return null;
  const provider = String(value.provider ?? '').trim();
  if (!provider) return null;
  if (provider === 'product-files') {
    const key = String(value.key ?? '').trim();
    if (key) return { provider, key };
    const id = Number(value.id);
    return Number.isInteger(id) && id > 0 ? { provider, id } : null;
  }
  return { provider };
}

function describeReference(value: unknown): string {
  if (isRecord(value)) {
    const key = String(value.key ?? '').trim();
    if (key) return key;
    const id = Number(value.id);
    if (Number.isInteger(id) && id > 0) return `#${id}`;
  }
  return '(empty)';
}

/** Collect every `params.fileRef` (and numeric `params.fileId`) in a task, at any depth. */
function collectTaskFileRefs(value: unknown, found: unknown[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectTaskFileRefs(item, found);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, nested] of Object.entries(value)) {
    if (key === 'fileRef') found.push(nested);
    else if (key === 'fileId' && (typeof nested === 'number' || isRecord(nested))) found.push(nested);
    else collectTaskFileRefs(nested, found);
  }
}

/** Product-file rows that exist, keyed by both `logical_path` and id. */
export type ProductFileIndex = {
  keys: Set<string>;
  ids: Set<number>;
};

export function indexProductFiles(rows: Array<{ id?: unknown; logical_path?: unknown }>): ProductFileIndex {
  const keys = new Set<string>();
  const ids = new Set<number>();
  for (const row of rows) {
    const key = String(row.logical_path ?? '').trim();
    if (key) keys.add(key);
    const id = Number(row.id);
    if (Number.isInteger(id) && id > 0) ids.add(id);
  }
  return { keys, ids };
}

/**
 * Every unusable file input in a resolved run plan.
 *
 * `runtimeFileRefs` is checked first so the operator sees the source key they have to rebind; the
 * task scan then catches references a task builds itself (rather than through `$fromRuntime`).
 */
export function collectFileRefProblems(params: {
  tasks: WorkflowTask[];
  runtimeFileRefs?: Record<string, unknown> | null;
  index: ProductFileIndex;
}): FileRefProblem[] {
  const problems: FileRefProblem[] = [];
  const { tasks, runtimeFileRefs, index } = params;

  if (runtimeFileRefs) {
    for (const [sourceKey, value] of Object.entries(runtimeFileRefs)) {
      // An absent binding is not a problem by itself: `required` sources are enforced separately,
      // and an optional source may legitimately be unset.
      if (value === undefined || value === null) continue;
      const problem = inspectReference(value, index);
      if (problem) problems.push({ ...problem, sourceKey, taskName: null });
    }
  }

  for (const task of tasks) {
    const refs: unknown[] = [];
    collectTaskFileRefs(task.params ?? {}, refs);
    for (const ref of refs) {
      const problem = inspectReference(ref, index);
      if (problem) problems.push({ ...problem, sourceKey: null, taskName: task.name });
    }
  }

  return problems;
}

function inspectReference(
  value: unknown,
  index: ProductFileIndex,
): Omit<FileRefProblem, 'sourceKey' | 'taskName'> | null {
  // A `$fromRuntime` descriptor that survived resolution means the parent runtime had nothing at
  // that path; treat it as unresolved rather than reporting the descriptor's own keys.
  if (isRecord(value) && typeof value.$fromRuntime === 'string') {
    return { fileKey: describeReference(value), reason: 'unresolved' };
  }
  const reference = normalizeFileReference(value);
  if (!reference) return { fileKey: describeReference(value), reason: 'unresolved' };
  if (reference.provider !== 'product-files') return null;
  if (reference.key !== undefined) {
    return index.keys.has(reference.key) ? null : { fileKey: reference.key, reason: 'missing' };
  }
  if (reference.id !== undefined) {
    return index.ids.has(reference.id) ? null : { fileKey: `#${reference.id}`, reason: 'missing' };
  }
  return { fileKey: describeReference(value), reason: 'unresolved' };
}

/** Human-readable summary; one line per problem so the operator can fix them all at once. */
export function formatFileRefProblems(problems: FileRefProblem[]): string {
  return problems
    .map((problem) => {
      const where = problem.sourceKey ? `本源 ${problem.sourceKey}` : `任务 ${problem.taskName ?? '?'}`;
      const what =
        problem.reason === 'unresolved'
          ? '没有解析到输入文件（该本源未绑定，或工作流默认值不是真实文件）'
          : '输入文件不存在';
      return `${where}：${what}（${problem.fileKey}）`;
    })
    .join('；');
}

/** Every product-file key/id a plan references, so the existence check loads only those rows. */
export function referencedProductFiles(params: {
  tasks: WorkflowTask[];
  runtimeFileRefs?: Record<string, unknown> | null;
}): { keys: string[]; ids: number[] } {
  const keys = new Set<string>();
  const ids = new Set<number>();
  const seen = new Set<unknown>();
  const visit = (value: unknown): void => {
    if (value === null || value === undefined || seen.has(value)) return;
    if (typeof value === 'object') seen.add(value);
    if (isRecord(value) && typeof value.$fromRuntime === 'string') return;
    const reference = normalizeFileReference(value);
    if (reference?.provider === 'product-files') {
      if (reference.key !== undefined) keys.add(reference.key);
      if (reference.id !== undefined) ids.add(reference.id);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (isRecord(value)) {
      if ('fileRef' in value) visit(value.fileRef);
      for (const nested of Object.values(value)) visit(nested);
    }
  };

  for (const value of Object.values(params.runtimeFileRefs ?? {})) visit(value);
  for (const task of params.tasks) visit(task.params ?? {});
  return { keys: [...keys], ids: [...ids] };
}

export function isWorkflowRuntimeParametersFileRefs(
  value: WorkflowRuntimeParameters['fileRefs'],
): Record<string, unknown> | null {
  return isRecord(value) ? (value as Record<string, unknown>) : null;
}

/** Loads just the product files the plan references and indexes them for the existence check. */
export async function loadProductFileIndex(
  db: { query(sql: string, params?: unknown[]): Promise<Array<Record<string, unknown>>> },
  references: { keys: string[]; ids: number[] },
): Promise<ProductFileIndex> {
  const rows = await db.query(
    'select id, logical_path from product_files where logical_path = any($1::text[]) or id = any($2::int[])',
    [references.keys, references.ids],
  );
  return indexProductFiles(rows);
}

/**
 * One-shot helper for the route layer: collect the problems and, when there are any, the message to
 * show the operator. Returns null when the plan can run.
 */
export async function findFileRefProblems(params: {
  db: { query(sql: string, params?: unknown[]): Promise<Array<Record<string, unknown>>> };
  tasks: WorkflowTask[];
  runtimeFileRefs?: Record<string, unknown> | null;
}): Promise<FileRefProblem[] | null> {
  const references = referencedProductFiles(params);
  if (!references.keys.length && !references.ids.length) return null;
  const index = await loadProductFileIndex(params.db, references);
  const problems = collectFileRefProblems({ ...params, index });
  return problems.length ? problems : null;
}

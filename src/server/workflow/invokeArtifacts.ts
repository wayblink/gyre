import type { WorkflowTask, WorkflowTaskPreviewResult, WorkflowTaskResultWithArtifacts } from '../../shared/types.js';

/**
 * Attach the child's persisted files to the result `workflow.invoke` returns.
 *
 * An invoke yields a single result, so a child that writes several files (the ESOP exercise sync
 * writes one per view) would lose all but one. Record pages resolve their snapshot by `task_id` +
 * month, so without this a snapshot produced by a monthly invoke would only be visible when it
 * happened to be the child's final task.
 *
 * The files are recorded under the *child's* task ids, which is what a standalone run of that child
 * would have produced — that is what lets one lookup cover both entry points.
 */
export function attachNestedArtifacts(
  result: WorkflowTaskPreviewResult,
  taskResults: Record<string, WorkflowTaskPreviewResult | null>,
  childTasks: WorkflowTask[],
): WorkflowTaskResultWithArtifacts {
  // Deliberately not gated on `result.kind === 'file'`: which child task the engine reports as the
  // final result depends on execution order, so a child ending on a plain transform would otherwise
  // drop the files its persist tasks wrote.
  const names = new Map(childTasks.map((task) => [task.id, task.name]));
  const nestedArtifacts = Object.entries(taskResults)
    .filter(
      (entry): entry is [string, Extract<WorkflowTaskPreviewResult, { kind: 'file' }>] => entry[1]?.kind === 'file',
    )
    .map(([taskId, childResult]) => ({
      taskId,
      taskName: names.get(taskId) ?? taskId,
      file: childResult.file,
      dataFrame: childResult.dataFrame,
    }));
  return nestedArtifacts.length > 0 ? { ...result, nestedArtifacts } : result;
}

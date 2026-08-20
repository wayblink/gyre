import type { WorkflowTask } from '../../shared/types.js';
import { getWorkflowDependencyIds } from './engine.js';

export function selectWorkflowPreviewTasks(tasks: WorkflowTask[], taskId: string): WorkflowTask[] {
  const taskMap = new Map(tasks.map((task) => [task.id, task]));
  const selected = new Set<string>();

  function visit(currentId: string) {
    if (selected.has(currentId)) return;
    const task = taskMap.get(currentId);
    if (!task) throw new Error(`Workflow task not found: ${currentId}`);
    selected.add(currentId);
    for (const dependencyId of getWorkflowDependencyIds(task)) {
      if (!taskMap.has(dependencyId)) {
        throw new Error(`Task ${task.name} references unknown dependency ${dependencyId}`);
      }
      visit(dependencyId);
    }
  }

  visit(taskId);
  return tasks.filter((task) => selected.has(task.id));
}

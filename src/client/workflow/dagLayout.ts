import { getTaskInputSlots, getTaskOutputSlots, collectWorkflowTaskParamInputUsages } from './taskOperators.js';
import type { WorkflowDefinition, WorkflowOperator, WorkflowTask } from '../../shared/types.js';

/**
 * DAG geometry and layout for the workflow canvas.
 *
 * Everything here is a pure function of a WorkflowDefinition (plus the operator catalogue that
 * decides a task's slots), which is what made it hard to test inside the 4.3k-line workflowPage
 * factory: the canvas renderer, the edge renderer and the auto-layout button all recompute node
 * heights and dependency order, so they must agree on one implementation.
 */

export const WORKFLOW_NODE_WIDTH = 300;
export const WORKFLOW_NODE_HEADER_BASE_HEIGHT = 64;
export const WORKFLOW_SLOT_ROW_MIN_HEIGHT = 34;
export const WORKFLOW_SLOT_LINE_HEIGHT = 13;
export const WORKFLOW_SLOT_COLUMN_GAP = 6;
export const WORKFLOW_CANVAS_PADDING = 48;
export const WORKFLOW_LAYOUT_COLUMN_GAP = 120;
export const WORKFLOW_LAYOUT_ROW_GAP = 56;

export type DagLayoutDeps = {
  /** Display name for a file bound to a parameter input (falls back to `File #id`). */
  getFileLabel: (fileId: number) => string;
};

export type WorkflowNodeBadge = {
  code: 'input' | 'output' | 'validation' | 'transform';
  label: string;
  title: string;
};

export function estimateWorkflowTextLines(value: unknown, charsPerLine: number): number {
  const text = String(value ?? '').trim();
  if (!text) return 1;
  return Math.max(1, Math.ceil(text.length / charsPerLine));
}

export function getWorkflowTaskMap(workflow: WorkflowDefinition): Map<string, WorkflowTask> {
  return new Map(workflow.tasks.map((task) => [task.id, task]));
}

/** Task ids this task waits for: input bindings plus explicit control dependencies. */
export function getWorkflowDependencyIds(task: WorkflowTask): string[] {
  const inputDependencies = Object.values(task.inputs ?? {})
    .map((input) => String(input?.from ?? '').trim())
    .filter(Boolean);
  const controlDependencies = Array.isArray(task.dependsOn)
    ? task.dependsOn.map((taskId) => String(taskId ?? '').trim()).filter(Boolean)
    : [];
  return Array.from(new Set([...inputDependencies, ...controlDependencies])).filter((taskId) => taskId !== task.id);
}

/** Control dependencies that are not already implied by an input binding. */
export function getWorkflowControlDependencies(task: WorkflowTask): string[] {
  const inputDependencies = new Set(
    Object.values(task.inputs ?? {})
      .map((input) => String(input?.from ?? '').trim())
      .filter(Boolean),
  );
  return (Array.isArray(task.dependsOn) ? task.dependsOn : [])
    .map((taskId) => String(taskId ?? '').trim())
    .filter((taskId) => taskId && taskId !== task.id && !inputDependencies.has(taskId));
}

/**
 * Topological order, breaking ties by canvas position so a freshly imported workflow renders in a
 * stable order. Tasks that are part of a cycle (or depend on one) are appended in canvas order
 * rather than dropped, so the canvas never hides a task.
 */
export function getWorkflowExecutionOrder(workflow: WorkflowDefinition): WorkflowTask[] {
  const taskMap = getWorkflowTaskMap(workflow);
  const inDegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();

  workflow.tasks.forEach((task) => {
    inDegree.set(task.id, 0);
    outgoing.set(task.id, []);
  });

  workflow.tasks.forEach((task) => {
    getWorkflowDependencyIds(task).forEach((from) => {
      if (!from || !taskMap.has(from) || from === task.id) return;
      outgoing.get(from)?.push(task.id);
      inDegree.set(task.id, (inDegree.get(task.id) ?? 0) + 1);
    });
  });

  const queue = workflow.tasks
    .filter((task) => (inDegree.get(task.id) ?? 0) === 0)
    .sort((left, right) => left.x - right.x || left.y - right.y || left.id.localeCompare(right.id))
    .map((task) => task.id);
  const ordered: WorkflowTask[] = [];
  const visited = new Set<string>();

  while (queue.length) {
    const taskId = queue.shift()!;
    if (visited.has(taskId)) continue;
    visited.add(taskId);
    const task = taskMap.get(taskId);
    if (task) ordered.push(task);
    for (const downstreamId of outgoing.get(taskId) ?? []) {
      inDegree.set(downstreamId, (inDegree.get(downstreamId) ?? 0) - 1);
      if ((inDegree.get(downstreamId) ?? 0) === 0) queue.push(downstreamId);
    }
  }

  workflow.tasks
    .filter((task) => !visited.has(task.id))
    .sort((left, right) => left.x - right.x || left.y - right.y || left.id.localeCompare(right.id))
    .forEach((task) => ordered.push(task));

  return ordered;
}

export function getWorkflowNodeBadge(operator: WorkflowOperator | null): WorkflowNodeBadge {
  const category = operator?.category ?? 'Transform';
  const code =
    category === 'Input'
      ? 'input'
      : category === 'Output'
        ? 'output'
        : category === 'Validation'
          ? 'validation'
          : 'transform';
  return {
    code,
    label: operator?.code ?? 'unknown.operator',
    title: operator ? `${operator.name} · ${operator.code}` : 'Unknown operator',
  };
}

export type WorkflowSlotRow = { name: string; binding: string };

export function getWorkflowNodeSlotRows(
  task: WorkflowTask,
  operator?: WorkflowOperator | null,
  getFileLabel: (fileId: number) => string = (fileId) => `File #${fileId}`,
): { inputs: WorkflowSlotRow[]; outputs: WorkflowSlotRow[]; rowCount: number } {
  const paramInputs = collectWorkflowTaskParamInputUsages(task);
  const inputSlots = getTaskInputSlots(task, operator).map((slot) => {
    const binding = task.inputs?.[slot];
    return {
      name: slot,
      binding: binding?.from ? `${binding.from}.${binding.slot}` : 'Not connected',
    };
  });
  const paramRows = paramInputs.map((usage) => ({
    name: usage.paramPath,
    binding: usage.kind === 'runtime' ? usage.runtimePath : getFileLabel(usage.fileId),
  }));
  const inputs = [...inputSlots, ...paramRows];
  const outputs = getTaskOutputSlots(task, operator).map((slot) => ({ name: slot, binding: '' }));
  return {
    inputs,
    outputs,
    rowCount: Math.max(inputs.length, outputs.length, 1),
  };
}

export function estimateWorkflowSlotHeight(row: WorkflowSlotRow): number {
  const nameLines = estimateWorkflowTextLines(row.name, 20);
  const bindingLines = row.binding ? estimateWorkflowTextLines(row.binding, 18) : 0;
  const contentLines = nameLines + bindingLines;
  return Math.max(WORKFLOW_SLOT_ROW_MIN_HEIGHT, contentLines * WORKFLOW_SLOT_LINE_HEIGHT + 10);
}

export function getWorkflowNodeHeight(task: WorkflowTask, operator?: WorkflowOperator | null): number {
  const { inputs, outputs, rowCount } = getWorkflowNodeSlotRows(task, operator);
  const taskNameHeight = estimateWorkflowTextLines(task.name, 24) * 16;
  const metaHeight = estimateWorkflowTextLines(task.id, 42) * 12;
  const slotHeight = Array.from({ length: rowCount }).reduce<number>((sum, _, index) => {
    const inputHeight = inputs[index] ? estimateWorkflowSlotHeight(inputs[index]) : WORKFLOW_SLOT_ROW_MIN_HEIGHT;
    const outputHeight = outputs[index] ? estimateWorkflowSlotHeight(outputs[index]) : WORKFLOW_SLOT_ROW_MIN_HEIGHT;
    return sum + Math.max(inputHeight, outputHeight);
  }, 0);
  const slotGaps = Math.max(0, rowCount - 1) * WORKFLOW_SLOT_COLUMN_GAP;
  return WORKFLOW_NODE_HEADER_BASE_HEIGHT + taskNameHeight + metaHeight + slotHeight + slotGaps;
}

/** Canvas extent, so the scrollable surface always covers every node plus padding. */
export function getWorkflowCanvasSize(
  workflow: WorkflowDefinition,
  getOperator: (task: WorkflowTask) => WorkflowOperator | null,
): { width: number; height: number } {
  const operatorsByTaskId = new Map(workflow.tasks.map((task) => [task.id, getOperator(task)]));
  return {
    width: Math.max(960, ...workflow.tasks.map((task) => task.x + WORKFLOW_NODE_WIDTH + WORKFLOW_CANVAS_PADDING * 2)),
    height: Math.max(
      620,
      ...workflow.tasks.map(
        (task) =>
          task.y + getWorkflowNodeHeight(task, operatorsByTaskId.get(task.id) ?? null) + WORKFLOW_CANVAS_PADDING * 2,
      ),
    ),
  };
}

export function getEdgePath(startX: number, startY: number, endX: number, endY: number): string {
  const deltaX = Math.max((endX - startX) * 0.45, 48);
  return `M ${startX} ${startY} C ${startX + deltaX} ${startY}, ${endX - deltaX} ${endY}, ${endX} ${endY}`;
}

/**
 * Column layout: tasks are grouped by their longest dependency depth and stacked in canvas order
 * inside each column, with each row offset by the previous node's real height. Returns false when
 * there is nothing to lay out (no workflow, or a single task).
 */
export function applyAutoLayoutToWorkflow(
  workflow: WorkflowDefinition | null,
  getOperator: (task: WorkflowTask) => WorkflowOperator | null,
): boolean {
  if (!workflow || workflow.tasks.length <= 1) return false;
  const taskMap = getWorkflowTaskMap(workflow);
  const inDegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  const depth = new Map<string, number>();

  workflow.tasks.forEach((task) => {
    inDegree.set(task.id, 0);
    outgoing.set(task.id, []);
    depth.set(task.id, 0);
  });

  workflow.tasks.forEach((task) => {
    getWorkflowDependencyIds(task).forEach((from) => {
      if (!from || !taskMap.has(from) || from === task.id) return;
      outgoing.get(from)?.push(task.id);
      inDegree.set(task.id, (inDegree.get(task.id) ?? 0) + 1);
    });
  });

  const queue = workflow.tasks
    .filter((task) => (inDegree.get(task.id) ?? 0) === 0)
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((task) => task.id);
  const visited = new Set<string>();

  while (queue.length) {
    const taskId = queue.shift()!;
    visited.add(taskId);
    const currentDepth = depth.get(taskId) ?? 0;
    for (const downstreamId of outgoing.get(taskId) ?? []) {
      depth.set(downstreamId, Math.max(depth.get(downstreamId) ?? 0, currentDepth + 1));
      inDegree.set(downstreamId, (inDegree.get(downstreamId) ?? 0) - 1);
      if ((inDegree.get(downstreamId) ?? 0) === 0) {
        queue.push(downstreamId);
      }
    }
  }

  workflow.tasks.forEach((task) => {
    if (!visited.has(task.id)) {
      const fallbackDepth = getWorkflowDependencyIds(task).some((dependencyId) => taskMap.has(dependencyId)) ? 1 : 0;
      depth.set(task.id, Math.max(depth.get(task.id) ?? 0, fallbackDepth));
    }
  });

  const columns = new Map<number, WorkflowTask[]>();
  workflow.tasks.forEach((task) => {
    const column = depth.get(task.id) ?? 0;
    const items = columns.get(column) ?? [];
    items.push(task);
    columns.set(column, items);
  });

  Array.from(columns.entries())
    .sort((left, right) => left[0] - right[0])
    .forEach(([column, tasks]) => {
      tasks
        .sort((left, right) => left.y - right.y || left.x - right.x || left.id.localeCompare(right.id))
        .forEach((task, rowIndex) => {
          task.x = WORKFLOW_CANVAS_PADDING + column * (WORKFLOW_NODE_WIDTH + WORKFLOW_LAYOUT_COLUMN_GAP);
          task.y =
            WORKFLOW_CANVAS_PADDING +
            tasks
              .slice(0, rowIndex)
              .reduce(
                (sum, current) => sum + getWorkflowNodeHeight(current, getOperator(current)) + WORKFLOW_LAYOUT_ROW_GAP,
                0,
              );
        });
    });

  return true;
}

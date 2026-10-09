import {
  getTaskInputSlots,
  getTaskOutputSlots,
  isAnyAssertTask,
  isAssertTask,
  isPersistExcelTask,
  isSchemaAssertTask,
  isShapeAssertTask,
  isSheetRangeExtractTask,
  isSheetSectionsExtractTask,
  isSqlAssertTask,
  isSqlTableBackedTask,
} from './taskOperators.js';
import type {
  WorkflowInputGuard,
  WorkflowInputGuardType,
  WorkflowOperator,
  WorkflowTask,
  WorkflowTaskInput,
} from '../../shared/types.js';

/**
 * Task parameter and input-guard rules for the workflow editor.
 *
 * These are pure functions of a task plus the operator catalogue, which is what made them hard to
 * test inside the 4k-line workflowPage factory: the structured-params editor, the guards modal and
 * the save path all recompute the same key sets, and a disagreement between them shows up as a
 * parameter silently dropped on save.
 */

/** Validation operators are the only ones an input guard may reference. */
export function getInputGuardOperators(
  operators: WorkflowOperator[],
): Array<WorkflowOperator & { code: WorkflowInputGuardType }> {
  return operators.filter((operator) => operator.category === 'Validation') as Array<
    WorkflowOperator & { code: WorkflowInputGuardType }
  >;
}

export function getInputGuardOperator(
  operators: WorkflowOperator[],
  type: string,
): (WorkflowOperator & { code: WorkflowInputGuardType }) | null {
  return getInputGuardOperators(operators).find((operator) => operator.code === type) ?? null;
}

/**
 * Normalize a persisted guards array: unknown guard types are dropped (their operator may have been
 * removed), ids and names fall back to the operator's, and `enabled` defaults to true.
 */
export function normalizeInputGuards(guards: unknown, operators: WorkflowOperator[]): WorkflowInputGuard[] {
  if (!Array.isArray(guards)) return [];
  return guards
    .map((guard, index) => {
      if (!guard || typeof guard !== 'object') return null;
      const record = guard as Partial<WorkflowInputGuard>;
      const operator = getInputGuardOperator(operators, String(record.type ?? ''));
      if (!operator) return null;
      return {
        id: String(record.id ?? `guard_${index + 1}`).trim() || `guard_${index + 1}`,
        type: operator.code,
        name: String(record.name ?? operator.name).trim() || operator.name,
        enabled: record.enabled !== false,
        params:
          record.params && typeof record.params === 'object' && !Array.isArray(record.params) ? record.params : {},
      };
    })
    .filter((guard): guard is WorkflowInputGuard => Boolean(guard));
}

/** Re-point an input binding while keeping its (normalized) guards. */
export function getInputBindingWithGuards(
  input: WorkflowTaskInput | undefined,
  next: { from: string; slot?: string },
  operators: WorkflowOperator[],
): WorkflowTaskInput {
  const guards = normalizeInputGuards(input?.guards, operators);
  return {
    from: next.from,
    slot: next.slot ?? 'dataframe',
    guards,
  };
}

/** Find a guard by id across a task's inputs, normalizing them in place. */
export function findInputGuard(
  task: WorkflowTask,
  guardId: string,
  operators: WorkflowOperator[],
): WorkflowInputGuard | null {
  for (const input of Object.values(task.inputs ?? {})) {
    input.guards = normalizeInputGuards(input.guards, operators);
    const guard = input.guards.find((item) => item.id === guardId);
    if (guard) return guard;
  }
  return null;
}

export function getSqlInputSlots(task: WorkflowTask): string[] {
  return Object.keys(task.inputs ?? {});
}

/**
 * Param keys the structured editor owns for a task, by operator family. Anything not listed here is
 * a free-form param and is edited as raw JSON, so this set is what decides which controls render.
 */
export function getCustomParamKeys(task: WorkflowTask): Set<string> {
  const keys = new Set<string>();

  if (isSheetRangeExtractTask(task)) {
    ['fileRef', 'fileId', 'sheetName', 'range', 'headerRow'].forEach((key) => keys.add(key));
  }

  if (isSheetSectionsExtractTask(task)) {
    ['fileRef', 'fileId', 'sheetName', 'sectionMode', 'sections', 'splitByColumn'].forEach((key) => keys.add(key));
  }

  if (isSqlTableBackedTask(task)) {
    ['sql', 'tableBindings'].forEach((key) => keys.add(key));
  }

  if (isPersistExcelTask(task)) {
    ['fileName', 'sheetName', 'uploadedBy'].forEach((key) => keys.add(key));
  }

  if (isAssertTask(task)) {
    ['operator', 'expectedValue', 'failureStrategy', 'failureMessage'].forEach((key) => keys.add(key));
  }

  if (isSqlAssertTask(task)) {
    ['sql', 'tableBindings', 'operator', 'expectedValue', 'failureStrategy', 'failureMessage'].forEach((key) =>
      keys.add(key),
    );
  }

  if (isSchemaAssertTask(task)) {
    ['mode', 'expectedColumns', 'failureStrategy', 'failureMessage'].forEach((key) => keys.add(key));
  }

  if (isShapeAssertTask(task)) {
    ['rowOperator', 'expectedRows', 'columnOperator', 'expectedColumns', 'failureStrategy', 'failureMessage'].forEach(
      (key) => keys.add(key),
    );
  }

  return keys;
}

/** Whether the structured editor has anything to render for this task. */
export function hasCustomStructuredParams(task: WorkflowTask): boolean {
  return (
    isSheetRangeExtractTask(task) ||
    isSheetSectionsExtractTask(task) ||
    isSqlTableBackedTask(task) ||
    isPersistExcelTask(task) ||
    isAnyAssertTask(task)
  );
}

/** Slot names a node renders, used by the canvas and the task editor alike. */
export function getTaskSlots(task: WorkflowTask, operator?: WorkflowOperator | null) {
  return {
    inputs: getTaskInputSlots(task, operator),
    outputs: getTaskOutputSlots(task, operator),
  };
}

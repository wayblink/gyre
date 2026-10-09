import type { WorkflowTask } from '../../shared/types.js';
import { isRecord } from '../utils/json.js';
import { normalizeWorkflowTaskInput } from './inputGuards.js';

/**
 * Normalize one stored/imported task definition into the canonical `WorkflowTask` shape.
 * Returns null when the payload is not a usable task (missing id/name/operatorCode).
 */
export function normalizeWorkflowTask(value: unknown): WorkflowTask | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || typeof value.name !== 'string' || typeof value.operatorCode !== 'string') return null;
  const inputs: WorkflowTask['inputs'] = {};
  if (isRecord(value.inputs)) {
    for (const [slotName, input] of Object.entries(value.inputs)) {
      const normalizedSlotName = String(slotName ?? '').trim();
      if (!normalizedSlotName || !isRecord(input)) continue;
      inputs[normalizedSlotName] = normalizeWorkflowTaskInput(input);
    }
  }
  const inputSourceIds = new Set(
    Object.values(inputs)
      .map((input) => String(input.from ?? '').trim())
      .filter(Boolean),
  );
  const dependsOn = Array.isArray(value.dependsOn)
    ? Array.from(
        new Set(
          value.dependsOn
            .map((taskId) => String(taskId ?? '').trim())
            .filter((taskId) => taskId && taskId !== value.id && !inputSourceIds.has(taskId)),
        ),
      )
    : [];
  return {
    id: value.id,
    name: value.name,
    operatorCode: value.operatorCode,
    operatorVersion: typeof value.operatorVersion === 'string' ? value.operatorVersion : '1.0.0',
    description: typeof value.description === 'string' ? value.description : '',
    x: Number(value.x ?? 0),
    y: Number(value.y ?? 0),
    params: isRecord(value.params) ? value.params : {},
    inputs,
    dependsOn,
  };
}

export function normalizeWorkflowTasks(value: unknown): WorkflowTask[] {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeWorkflowTask).filter((task): task is WorkflowTask => Boolean(task));
}

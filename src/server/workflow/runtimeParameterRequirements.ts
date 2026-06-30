import type {
  WorkflowRuntimeParameterField,
  WorkflowRuntimeParameters,
  WorkflowRuntimeParametersSchema,
  WorkflowTask,
} from '../../shared/types.js';
import { workflowOperatorDefinitionByCode } from './operators/registry.js';
import type { WorkflowOperatorRuntimeParameterRequirement } from './operators/types.js';

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function setNestedRuntimeField(
  schema: WorkflowRuntimeParametersSchema,
  path: string,
  field: WorkflowRuntimeParameterField,
): void {
  const segments = path.split('.').map((segment) => segment.trim()).filter(Boolean);
  if (!segments.length) return;

  let current = schema;
  segments.forEach((segment, index) => {
    const isLeaf = index === segments.length - 1;
    if (isLeaf) {
      current[segment] = cloneJson(field);
      return;
    }

    const existing = current[segment];
    if (!existing || existing.type !== 'object') {
      current[segment] = {
        type: 'object',
        label: segment,
        required: true,
        properties: {},
      };
    }
    current[segment].properties ??= {};
    current = current[segment].properties;
  });
}

function setNestedRuntimeDefault(defaults: WorkflowRuntimeParameters, path: string, value: unknown): void {
  const segments = path.split('.').map((segment) => segment.trim()).filter(Boolean);
  if (!segments.length) return;

  let current: Record<string, unknown> = defaults;
  segments.forEach((segment, index) => {
    const isLeaf = index === segments.length - 1;
    if (isLeaf) {
      current[segment] = cloneJson(value);
      return;
    }

    if (!isRecord(current[segment])) current[segment] = {};
    current = current[segment] as Record<string, unknown>;
  });
}

function getRuntimeDefaultValue(requirement: WorkflowOperatorRuntimeParameterRequirement): unknown {
  return typeof requirement.defaultValue === 'function' ? requirement.defaultValue() : requirement.defaultValue;
}

export function deriveWorkflowRuntimeConfigFromTasks(params: {
  tasks: WorkflowTask[];
  runtimeParamsSchema?: WorkflowRuntimeParametersSchema;
  runtimeParamsDefaults?: WorkflowRuntimeParameters;
}): {
  runtimeParamsSchema: WorkflowRuntimeParametersSchema;
  runtimeParamsDefaults: WorkflowRuntimeParameters;
} {
  const runtimeParamsSchema = cloneJson(params.runtimeParamsSchema ?? {});
  const runtimeParamsDefaults = cloneJson(params.runtimeParamsDefaults ?? {});

  for (const task of params.tasks) {
    const operator = workflowOperatorDefinitionByCode.get(task.operatorCode);
    for (const requirement of operator?.runtimeParameters ?? []) {
      if (requirement.appliesTo && !requirement.appliesTo(task)) continue;
      setNestedRuntimeField(runtimeParamsSchema, requirement.path, requirement.field);

      const defaultValue = getRuntimeDefaultValue(requirement);
      if (defaultValue !== undefined) {
        setNestedRuntimeDefault(runtimeParamsDefaults, requirement.path, defaultValue);
      }
    }
  }

  return { runtimeParamsSchema, runtimeParamsDefaults };
}

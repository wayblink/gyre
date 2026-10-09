import type {
  WorkflowRuntimeParameterField,
  WorkflowRuntimeParameterReference,
  WorkflowRuntimeParameters,
  WorkflowRuntimeParametersSchema,
  WorkflowTask,
} from '../../shared/types.js';
import { workflowOperatorDefinitionByCode } from './operators/registry.js';
import type { WorkflowOperatorRuntimeParameterRequirement } from './operators/types.js';
import { isRecord } from '../utils/json.js';

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
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

function getNestedRuntimeField(schema: WorkflowRuntimeParametersSchema, path: string): WorkflowRuntimeParameterField | undefined {
  const segments = path.split('.').map((segment) => segment.trim()).filter(Boolean);
  if (!segments.length) return undefined;

  return segments.reduce<WorkflowRuntimeParameterField | undefined>((current, segment, index) => {
    if (index === 0) return schema[segment];
    return current?.type === 'object' ? current.properties?.[segment] : undefined;
  }, undefined);
}

function getNestedRuntimeDefault(defaults: WorkflowRuntimeParameters, path: string): unknown {
  const segments = path.split('.').map((segment) => segment.trim()).filter(Boolean);
  let current: unknown = defaults;
  for (const segment of segments) {
    if (!isRecord(current) || !(segment in current)) return undefined;
    current = current[segment];
  }
  return current;
}

function getRuntimeDefaultValue(requirement: WorkflowOperatorRuntimeParameterRequirement): unknown {
  return typeof requirement.defaultValue === 'function' ? requirement.defaultValue() : requirement.defaultValue;
}

function readRuntimeFieldType(value: unknown): WorkflowRuntimeParameterField['type'] {
  return value === 'number' || value === 'boolean' || value === 'array' || value === 'object' ? value : 'string';
}

function isRuntimeReference(value: unknown): value is WorkflowRuntimeParameterReference {
  return isRecord(value) && typeof value.$fromRuntime === 'string';
}

function collectTaskRuntimeReferences(
  value: unknown,
  currentPath = '',
): Array<{ reference: WorkflowRuntimeParameterReference; runtimePath: string; paramPath: string }> {
  if (isRuntimeReference(value)) {
    return [{ reference: value, runtimePath: value.$fromRuntime, paramPath: currentPath }];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectTaskRuntimeReferences(item, `${currentPath}[${index}]`));
  }
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([key, nested]) =>
    collectTaskRuntimeReferences(nested, currentPath ? `${currentPath}.${key}` : key),
  );
}

function runtimeFieldForTaskReference(
  task: WorkflowTask,
  paramPath: string,
  reference: WorkflowRuntimeParameterReference,
): WorkflowRuntimeParameterField {
  const lastRuntimeSegment = paramPath.split('.').filter(Boolean).at(-1) ?? paramPath;
  const isFileReference = paramPath === 'fileRef' || paramPath === 'fileId' || /(^|\.)file(ref|id)$/i.test(paramPath);
  return {
    type: reference.$type ? readRuntimeFieldType(reference.$type) : isFileReference ? 'object' : 'string',
    label:
      typeof reference.$label === 'string' && reference.$label.trim()
        ? reference.$label.trim()
        : isFileReference
          ? `${task.name} file`
          : `${task.name} ${lastRuntimeSegment}`,
    description:
      typeof reference.$description === 'string' && reference.$description.trim()
        ? reference.$description.trim()
        : undefined,
    enum: Array.isArray(reference.$enum) ? reference.$enum.map((item) => String(item)).filter(Boolean) : undefined,
  };
}

export function deriveWorkflowRuntimeConfigFromTasks(params: {
  tasks: WorkflowTask[];
  runtimeParamsSchema?: WorkflowRuntimeParametersSchema;
  runtimeParamsDefaults?: WorkflowRuntimeParameters;
}): {
  runtimeParamsSchema: WorkflowRuntimeParametersSchema;
  runtimeParamsDefaults: WorkflowRuntimeParameters;
} {
  const runtimeParamsSchemaHints = cloneJson(params.runtimeParamsSchema ?? {});
  const runtimeParamsDefaultHints = cloneJson(params.runtimeParamsDefaults ?? {});
  const runtimeParamsSchema: WorkflowRuntimeParametersSchema = {};
  const runtimeParamsDefaults: WorkflowRuntimeParameters = {};

  for (const task of params.tasks) {
    for (const reference of collectTaskRuntimeReferences(task.params ?? {})) {
      const segments = reference.runtimePath.split('.').map((segment) => segment.trim()).filter(Boolean);
      if (!segments.length) continue;
      const existing = getNestedRuntimeField(runtimeParamsSchema, reference.runtimePath);
      if (!existing) {
        setNestedRuntimeField(
          runtimeParamsSchema,
          reference.runtimePath,
          getNestedRuntimeField(runtimeParamsSchemaHints, reference.runtimePath) ??
            runtimeFieldForTaskReference(task, reference.paramPath, reference.reference),
        );
      }
      const defaultHint = getNestedRuntimeDefault(runtimeParamsDefaultHints, reference.runtimePath);
      if (defaultHint !== undefined) {
        setNestedRuntimeDefault(runtimeParamsDefaults, reference.runtimePath, defaultHint);
        continue;
      }
      if (Object.prototype.hasOwnProperty.call(reference.reference, '$default')) {
        setNestedRuntimeDefault(runtimeParamsDefaults, reference.runtimePath, reference.reference.$default);
      }
    }

    const operator = workflowOperatorDefinitionByCode.get(task.operatorCode);
    for (const requirement of operator?.runtimeParameters ?? []) {
      if (requirement.appliesTo && !requirement.appliesTo(task)) continue;
      setNestedRuntimeField(runtimeParamsSchema, requirement.path, requirement.field);

      const defaultHint = getNestedRuntimeDefault(runtimeParamsDefaultHints, requirement.path);
      if (defaultHint !== undefined) {
        setNestedRuntimeDefault(runtimeParamsDefaults, requirement.path, defaultHint);
        continue;
      }
      if (getNestedRuntimeDefault(runtimeParamsDefaults, requirement.path) !== undefined) continue;
      const defaultValue = getRuntimeDefaultValue(requirement);
      if (defaultValue !== undefined) {
        setNestedRuntimeDefault(runtimeParamsDefaults, requirement.path, defaultValue);
      }
    }
  }

  return { runtimeParamsSchema, runtimeParamsDefaults };
}

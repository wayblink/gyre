import type {
  WorkflowRuntimeParameterField,
  WorkflowRuntimeParameterReference,
  WorkflowRuntimeParameters,
  WorkflowRuntimeParametersSchema,
  WorkflowTask,
} from '../../shared/types.js';
import { isRecord } from '../utils/json.js';

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function readRuntimeFieldType(value: unknown): WorkflowRuntimeParameterField['type'] {
  return value === 'number' || value === 'boolean' || value === 'array' || value === 'object' ? value : 'string';
}

export function normalizeWorkflowRuntimeParameters(value: unknown): WorkflowRuntimeParameters {
  return isRecord(value) ? cloneJson(value) : {};
}

export function normalizeWorkflowRuntimeParametersSchema(value: unknown): WorkflowRuntimeParametersSchema {
  if (!isRecord(value)) return {};
  const schema: WorkflowRuntimeParametersSchema = {};

  for (const [rawKey, rawField] of Object.entries(value)) {
    const key = String(rawKey ?? '').trim();
    if (!key || !isRecord(rawField)) continue;
    const fieldType = readRuntimeFieldType(rawField.type);
    const field: WorkflowRuntimeParameterField = {
      type: fieldType,
      label: String(rawField.label ?? key).trim() || key,
      required: typeof rawField.required === 'boolean' ? rawField.required : undefined,
      optionalCategory:
        rawField.optionalCategory === 'inherit' ||
        rawField.optionalCategory === 'validation' ||
        rawField.optionalCategory === 'supplement'
          ? rawField.optionalCategory
          : undefined,
      description: typeof rawField.description === 'string' ? rawField.description : undefined,
      enum: Array.isArray(rawField.enum) ? rawField.enum.map((item) => String(item)).filter(Boolean) : undefined,
      properties:
        fieldType === 'object' && isRecord(rawField.properties)
          ? normalizeWorkflowRuntimeParametersSchema(rawField.properties)
          : undefined,
    };
    schema[key] = field;
  }

  return schema;
}

function mergeRuntimeParameters(
  base: WorkflowRuntimeParameters,
  override: WorkflowRuntimeParameters,
): WorkflowRuntimeParameters {
  const merged: WorkflowRuntimeParameters = cloneJson(base);
  for (const [key, value] of Object.entries(override)) {
    if (isRecord(value) && isRecord(merged[key])) {
      merged[key] = mergeRuntimeParameters(merged[key] as WorkflowRuntimeParameters, value);
      continue;
    }
    merged[key] = cloneJson(value);
  }
  return merged;
}

function filterRuntimeValueBySchema(keyPath: string, value: unknown, field: WorkflowRuntimeParameterField): unknown {
  if (value === undefined) return undefined;

  if (field.type !== 'object' || !isRecord(value) || !field.properties) {
    return cloneJson(value);
  }

  const filtered: Record<string, unknown> = {};
  const isFileReferenceObject = /^fileRefs\.[^.]+$/.test(keyPath);
  if (isFileReferenceObject) {
    for (const key of ['provider', 'id', 'key']) {
      if (key in value) filtered[key] = cloneJson(value[key]);
    }
  }

  for (const [key, nestedField] of Object.entries(field.properties)) {
    const nestedValue = filterRuntimeValueBySchema(`${keyPath}.${key}`, value[key], nestedField);
    if (nestedValue !== undefined) filtered[key] = nestedValue;
  }

  return filtered;
}

export function filterWorkflowRuntimeParametersBySchema(
  runtimeParameters: WorkflowRuntimeParameters,
  schema: WorkflowRuntimeParametersSchema,
): WorkflowRuntimeParameters {
  const normalizedSchema = normalizeWorkflowRuntimeParametersSchema(schema);
  const filtered: WorkflowRuntimeParameters = {};

  for (const [key, field] of Object.entries(normalizedSchema)) {
    const value = filterRuntimeValueBySchema(key, runtimeParameters[key], field);
    if (value !== undefined) filtered[key] = value;
  }

  return filtered;
}

function getRuntimePathValue(runtimeParameters: WorkflowRuntimeParameters, runtimePath: string): unknown {
  const segments = runtimePath
    .split('.')
    .map((segment) => segment.trim())
    .filter(Boolean);
  let current: unknown = runtimeParameters;
  for (const segment of segments) {
    if (!isRecord(current) || !(segment in current)) return undefined;
    current = current[segment];
  }
  return current;
}

function isRuntimeReference(value: unknown): value is WorkflowRuntimeParameterReference {
  return isRecord(value) && typeof value.$fromRuntime === 'string';
}

function validateRuntimeValue(keyPath: string, value: unknown, field: WorkflowRuntimeParameterField): void {
  if (value === undefined) {
    return;
  }

  if (field.type === 'string') {
    if (typeof value !== 'string') throw new Error(`Runtime parameter ${keyPath} must be a string`);
    if (field.enum?.length && !field.enum.includes(value)) {
      throw new Error(`Runtime parameter ${keyPath} must be one of: ${field.enum.join(', ')}`);
    }
    return;
  }

  if (field.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`Runtime parameter ${keyPath} must be a number`);
    }
    return;
  }

  if (field.type === 'boolean') {
    if (typeof value !== 'boolean') throw new Error(`Runtime parameter ${keyPath} must be a boolean`);
    return;
  }

  if (field.type === 'array') {
    if (!Array.isArray(value)) throw new Error(`Runtime parameter ${keyPath} must be an array`);
    return;
  }

  if (!isRecord(value)) {
    throw new Error(`Runtime parameter ${keyPath} must be an object`);
  }

  if (!field.properties) return;
  const isFileReferenceObject = /^fileRefs\.[^.]+$/.test(keyPath);
  if (!isFileReferenceObject) {
    validateRuntimeParameters(value, field.properties, keyPath);
    return;
  }

  const fileReferenceKeys = new Set(['provider', 'id', 'key']);
  const configurableValue = Object.fromEntries(Object.entries(value).filter(([key]) => !fileReferenceKeys.has(key)));
  validateRuntimeParameters(configurableValue, field.properties, keyPath);
}

export function validateRuntimeParameters(
  runtimeParameters: WorkflowRuntimeParameters,
  schema: WorkflowRuntimeParametersSchema,
  parentPath = '',
): void {
  for (const key of Object.keys(runtimeParameters)) {
    if (!schema[key]) {
      const qualifiedKey = parentPath ? `${parentPath}.${key}` : key;
      throw new Error(`Unknown runtime parameter: ${qualifiedKey}`);
    }
  }

  for (const [key, field] of Object.entries(schema)) {
    const qualifiedKey = parentPath ? `${parentPath}.${key}` : key;
    validateRuntimeValue(qualifiedKey, runtimeParameters[key], field);
  }
}

function resolveRuntimeReferences(value: unknown, runtimeParameters: WorkflowRuntimeParameters): unknown {
  if (isRuntimeReference(value)) {
    const resolved = getRuntimePathValue(runtimeParameters, value.$fromRuntime);
    if (resolved === undefined) {
      throw new Error(`Runtime parameter reference not found: ${value.$fromRuntime}`);
    }
    return cloneJson(resolved);
  }

  if (Array.isArray(value)) {
    return value.map((item) => resolveRuntimeReferences(item, runtimeParameters));
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        resolveRuntimeReferences(nestedValue, runtimeParameters),
      ]),
    );
  }

  return value;
}

export function resolveWorkflowRuntimeConfiguration(params: {
  tasks: WorkflowTask[];
  runtimeParamsSchema: WorkflowRuntimeParametersSchema;
  runtimeParamsDefaults: WorkflowRuntimeParameters;
  runtimeParameters?: WorkflowRuntimeParameters;
}): { runtimeParameters: WorkflowRuntimeParameters; tasks: WorkflowTask[] } {
  const provided = normalizeWorkflowRuntimeParameters(params.runtimeParameters);
  // Keep monthly runs created before the cancel/restore source split executable. The
  // old single source is the current incremental input; the merge workflow supplies
  // the base independently from its configured default/previous output.
  const providedFileRefs = isRecord(provided.fileRefs) ? provided.fileRefs : null;
  if (providedFileRefs && providedFileRefs.cancel_restore_report !== undefined) {
    if (providedFileRefs.incremental_cancel_restore_report === undefined) {
      providedFileRefs.incremental_cancel_restore_report = cloneJson(providedFileRefs.cancel_restore_report);
    }
    delete providedFileRefs.cancel_restore_report;
  }
  const schema = normalizeWorkflowRuntimeParametersSchema(params.runtimeParamsSchema);
  const defaults = normalizeWorkflowRuntimeParameters(params.runtimeParamsDefaults);
  const mergedRuntimeParameters = mergeRuntimeParameters(defaults, provided);

  validateRuntimeParameters(defaults, schema);
  validateRuntimeParameters(mergedRuntimeParameters, schema);

  return {
    runtimeParameters: mergedRuntimeParameters,
    tasks: params.tasks.map((task) => resolveRuntimeReferences(task, mergedRuntimeParameters) as WorkflowTask),
  };
}

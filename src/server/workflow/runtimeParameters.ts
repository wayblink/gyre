import type {
  WorkflowRuntimeParameterField,
  WorkflowRuntimeParameterReference,
  WorkflowRuntimeParameters,
  WorkflowRuntimeParametersSchema,
  WorkflowTask,
} from '../../shared/types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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
    schema[key] = {
      type: fieldType,
      label: String(rawField.label ?? key).trim() || key,
      required: rawField.required === true,
      description: typeof rawField.description === 'string' ? rawField.description : undefined,
      enum: Array.isArray(rawField.enum) ? rawField.enum.map((item) => String(item)).filter(Boolean) : undefined,
      properties: fieldType === 'object' && isRecord(rawField.properties) ? normalizeWorkflowRuntimeParametersSchema(rawField.properties) : undefined,
    };
  }

  return schema;
}

function mergeRuntimeParameters(base: WorkflowRuntimeParameters, override: WorkflowRuntimeParameters): WorkflowRuntimeParameters {
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
  return isRecord(value) && typeof value.$fromRuntime === 'string' && Object.keys(value).length === 1;
}

function validateRuntimeValue(
  keyPath: string,
  value: unknown,
  field: WorkflowRuntimeParameterField,
  options?: { enforceRequired?: boolean },
): void {
  if (value === undefined) {
    if (field.required && options?.enforceRequired !== false) {
      throw new Error(`Missing runtime parameter: ${keyPath}`);
    }
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
  validateRuntimeParameters(value, field.properties ?? {}, keyPath, options);
}

export function validateRuntimeParameters(
  runtimeParameters: WorkflowRuntimeParameters,
  schema: WorkflowRuntimeParametersSchema,
  parentPath = '',
  options?: { enforceRequired?: boolean },
): void {
  for (const key of Object.keys(runtimeParameters)) {
    if (!schema[key]) {
      const qualifiedKey = parentPath ? `${parentPath}.${key}` : key;
      throw new Error(`Unknown runtime parameter: ${qualifiedKey}`);
    }
  }

  for (const [key, field] of Object.entries(schema)) {
    const qualifiedKey = parentPath ? `${parentPath}.${key}` : key;
    validateRuntimeValue(qualifiedKey, runtimeParameters[key], field, options);
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
      Object.entries(value).map(([key, nestedValue]) => [key, resolveRuntimeReferences(nestedValue, runtimeParameters)]),
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
  const schema = normalizeWorkflowRuntimeParametersSchema(params.runtimeParamsSchema);
  const defaults = normalizeWorkflowRuntimeParameters(params.runtimeParamsDefaults);
  const mergedRuntimeParameters = mergeRuntimeParameters(defaults, provided);

  validateRuntimeParameters(defaults, schema, '', { enforceRequired: false });
  validateRuntimeParameters(mergedRuntimeParameters, schema);

  return {
    runtimeParameters: mergedRuntimeParameters,
    tasks: params.tasks.map((task) => resolveRuntimeReferences(task, mergedRuntimeParameters) as WorkflowTask),
  };
}

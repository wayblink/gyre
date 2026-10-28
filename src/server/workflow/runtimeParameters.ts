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
      // Business-page rendering metadata. Dropping it here used to reshape the monthly input list on every
      // editor save (order, default sheet, hidden flags) and the next run failed with
      // "Missing source sheet name" — the file was bound but no longer knew which sheet to read.
      order: typeof rawField.order === 'number' && Number.isFinite(rawField.order) ? rawField.order : undefined,
      sourceGroup:
        rawField.sourceGroup === 'shareworks' || rawField.sourceGroup === 'futu' ? rawField.sourceGroup : undefined,
      taskId: typeof rawField.taskId === 'string' && rawField.taskId.trim() ? rawField.taskId.trim() : undefined,
      defaultSheetName:
        typeof rawField.defaultSheetName === 'string'
          ? rawField.defaultSheetName
          : rawField.defaultSheetName === null
            ? null
            : undefined,
      allowSheetNameOverride:
        typeof rawField.allowSheetNameOverride === 'boolean' ? rawField.allowSheetNameOverride : undefined,
      hidden: typeof rawField.hidden === 'boolean' ? rawField.hidden : undefined,
      fileTemplate:
        typeof rawField.fileTemplate === 'string' && rawField.fileTemplate.trim()
          ? rawField.fileTemplate.trim()
          : undefined,
      properties:
        fieldType === 'object' && isRecord(rawField.properties)
          ? normalizeWorkflowRuntimeParametersSchema(rawField.properties)
          : undefined,
    };
    schema[key] = field;
  }

  return schema;
}

/**
 * A file reference is atomic in its file identity: `provider` / `key` / `id` say *which file*.
 * Everything else (`sheet`, and any future metadata) is a setting that may come from a default.
 */
const FILE_REFERENCE_IDENTITY_KEYS = ['provider', 'id', 'key'] as const;

/**
 * Merge one `fileRefs.<sourceKey>` entry.
 *
 * The file identity comes from the caller **only**. Deep-merging it would let a definition default
 * put a file back into a source the caller deliberately left empty: Monthly Update passes
 * `{ sheet }` for an optional source the operator did not configure, and the definition default
 * (`{ provider, key, id, sheet }` pointing at last quarter's export) used to be merged underneath
 * it — so "not supplied" quietly became "read this historical workbook", failing the run with
 * `Product file not found` for an input the page showed as optional. `{}` therefore means "no file"
 * and must stay empty.
 *
 * Non-identity fields still merge, so a caller that supplies only a file can inherit the sheet.
 */
function mergeFileReference(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const inherited = Object.fromEntries(
    Object.entries(base).filter(([key]) => !(FILE_REFERENCE_IDENTITY_KEYS as readonly string[]).includes(key)),
  );
  return { ...cloneJson(inherited), ...cloneJson(override) };
}

function mergeRuntimeParameters(
  base: WorkflowRuntimeParameters,
  override: WorkflowRuntimeParameters,
  path = '',
): WorkflowRuntimeParameters {
  const merged: WorkflowRuntimeParameters = cloneJson(base);
  for (const [key, value] of Object.entries(override)) {
    if (isRecord(value) && isRecord(merged[key])) {
      merged[key] =
        path === 'fileRefs'
          ? mergeFileReference(merged[key] as Record<string, unknown>, value)
          : mergeRuntimeParameters(merged[key] as WorkflowRuntimeParameters, value, path ? `${path}.${key}` : key);
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

import { isRuntimeFileParameter } from './runtimeParameterPresentation.js';
import type { ProductFileRecord, WorkflowDefinition, WorkflowRuntimeParameterField } from '../../shared/types.js';

/**
 * Reading and writing a workflow's runtime parameter defaults.
 *
 * The runtime params panel, the task editor and save/execute all read the same nested
 * `runtimeParamsDefaults` object through the same dotted paths, so the path walking, the fileRef
 * shape and the control-to-value coercion live here instead of being re-derived (and drifting) in
 * each caller.
 */

export type RuntimeParameterEntry = {
  path: string;
  required: boolean;
  type: WorkflowRuntimeParameterField['type'];
  label: string;
};

export type RuntimeDefaultsDeps = {
  getProductFiles: () => ProductFileRecord[];
  productFileDisplayName: (file: ProductFileRecord) => string;
};

export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function getNestedValueAtPath(source: Record<string, unknown>, path: string): unknown {
  return path
    .split('.')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .reduce<unknown>((current, segment) => {
      if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
      return (current as Record<string, unknown>)[segment];
    }, source);
}

export function setNestedValueAtPath(source: Record<string, unknown>, path: string, value: unknown) {
  const segments = path
    .split('.')
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (!segments.length) return;
  let current: Record<string, unknown> = source;
  segments.slice(0, -1).forEach((segment) => {
    const existing = current[segment];
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
      current[segment] = {};
    }
    current = current[segment] as Record<string, unknown>;
  });
  current[segments[segments.length - 1] as string] = value;
}

/** Flattens the (possibly nested) runtime schema into the dotted paths the controls bind to. */
export function flattenWorkflowRuntimeSchema(
  schema: WorkflowDefinition['runtimeParamsSchema'],
  parentPath = '',
): RuntimeParameterEntry[] {
  return Object.entries(schema ?? {}).flatMap(([key, field]) => {
    const nextPath = parentPath ? `${parentPath}.${key}` : key;
    if (field.type === 'object' && field.properties) {
      const nested = flattenWorkflowRuntimeSchema(field.properties, nextPath);
      if (!nextPath.startsWith('fileRefs.')) return nested;
      return [
        {
          path: nextPath,
          required: field.required === true,
          type: field.type,
          label: field.label ?? nextPath,
        },
        ...nested,
      ];
    }
    return [
      {
        path: nextPath,
        required: field.required === true,
        type: field.type,
        label: field.label ?? nextPath,
      },
    ];
  });
}

export function formatRuntimeSummaryValue(value: unknown): string {
  if (value === undefined) return '未设置默认值';
  if (value === null) return 'null';
  if (typeof value === 'string') return value || '""';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function stringifyWorkflowJson(value: unknown): string {
  return JSON.stringify(value ?? {}, null, 2);
}

/** Resolves a runtime default to a product file id, whether it was stored as a key or an id. */
export function runtimeProductFileId(value: unknown, getProductFiles: () => ProductFileRecord[]): number | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.provider !== 'product-files') return null;
  const fileKey = String(record.key ?? '').trim();
  if (fileKey) return getProductFiles().find((file) => (file.logicalPath ?? file.displayPath) === fileKey)?.id ?? null;
  const fileId = Number(record.id);
  return Number.isInteger(fileId) && fileId > 0 ? fileId : null;
}

export function workflowRuntimeDefaultFileId(
  workflow: WorkflowDefinition,
  runtimePath: string,
  getProductFiles: () => ProductFileRecord[],
): number | null {
  return runtimeProductFileId(
    getNestedValueAtPath(workflow.runtimeParamsDefaults as Record<string, unknown>, runtimePath),
    getProductFiles,
  );
}

export function setWorkflowRuntimeDefaultFileId(
  workflow: WorkflowDefinition,
  runtimePath: string,
  fileId: number | null,
  getProductFiles: () => ProductFileRecord[],
) {
  const defaults = cloneJson(workflow.runtimeParamsDefaults ?? {}) as Record<string, unknown>;
  const existing = getNestedValueAtPath(defaults, runtimePath);
  const existingRecord =
    existing && typeof existing === 'object' && !Array.isArray(existing) ? (existing as Record<string, unknown>) : {};
  const file = fileId ? getProductFiles().find((item) => item.id === fileId) : null;
  setNestedValueAtPath(
    defaults,
    runtimePath,
    file
      ? {
          ...existingRecord,
          provider: 'product-files',
          key: file.logicalPath ?? file.displayPath,
          id: undefined,
        }
      : undefined,
  );
  workflow.runtimeParamsDefaults = defaults;
}

export function workflowRuntimeDefaultString(workflow: WorkflowDefinition, runtimePath: string): string {
  const value = getNestedValueAtPath(workflow.runtimeParamsDefaults as Record<string, unknown>, runtimePath);
  return typeof value === 'string' ? value : '';
}

export function setWorkflowRuntimeDefaultString(workflow: WorkflowDefinition, runtimePath: string, value: string) {
  const defaults = cloneJson(workflow.runtimeParamsDefaults ?? {}) as Record<string, unknown>;
  setNestedValueAtPath(defaults, runtimePath, value || undefined);
  workflow.runtimeParamsDefaults = defaults;
}

/** Coerces a runtime-default control into the value shape stored on the workflow. */
export function readRuntimeDefaultControlValue(
  control: HTMLInputElement | HTMLSelectElement,
  currentValue: unknown,
  getProductFiles: () => ProductFileRecord[],
): unknown {
  const type = control.dataset.runtimeDefaultType ?? '';
  const rawValue = control.value.trim();
  if (rawValue === '') return undefined;
  if (type === 'number') return Number(rawValue);
  if (type === 'boolean') return rawValue === 'true';
  if (type === 'fileRef') {
    const existing =
      currentValue && typeof currentValue === 'object' && !Array.isArray(currentValue)
        ? (currentValue as Record<string, unknown>)
        : {};
    const nextFileId = Number(rawValue);
    const file = getProductFiles().find((item) => item.id === nextFileId);
    const nextFileKey = file?.logicalPath ?? file?.displayPath;
    const sameFile = existing.key === nextFileKey && existing.provider === 'product-files';
    return {
      ...(sameFile ? existing : {}),
      provider: 'product-files',
      key: nextFileKey,
    };
  }
  return rawValue;
}

export function syncRuntimeDefaultControlToWorkflow(
  workflow: WorkflowDefinition,
  control: HTMLInputElement | HTMLSelectElement,
  getProductFiles: () => ProductFileRecord[],
): boolean {
  const path = control.dataset.runtimeDefaultPath ?? '';
  if (!path) return false;

  const defaults = cloneJson(workflow.runtimeParamsDefaults ?? {}) as Record<string, unknown>;
  const currentValue = getNestedValueAtPath(defaults, path);
  const value = readRuntimeDefaultControlValue(control, currentValue, getProductFiles);
  setNestedValueAtPath(defaults, path, value);
  workflow.runtimeParamsDefaults = defaults;
  return true;
}

export function createRuntimeDefaultsDisplay(deps: RuntimeDefaultsDeps) {
  const { getProductFiles, productFileDisplayName } = deps;
  return function formatRuntimeDefaultDisplay(entry: { path: string; type: string }, value: unknown): string {
    if (isRuntimeFileParameter(entry)) {
      const fileId = runtimeProductFileId(value, getProductFiles);
      if (!fileId) return '未设置默认文件';
      const file = getProductFiles().find((item) => item.id === fileId);
      return file ? `${productFileDisplayName(file)} (#${fileId})` : `File #${fileId}`;
    }
    return formatRuntimeSummaryValue(value);
  };
}

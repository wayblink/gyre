import type { MonthlyRunSourceDefinition } from '../../shared/types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'object') return value as T;
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return fallback;
  }
}

export type OrderedMonthlyRunSourceDefinition = MonthlyRunSourceDefinition & { order: number };

function readOptionalCategory(value: unknown): MonthlyRunSourceDefinition['optionalCategory'] {
  return value === 'inherit' || value === 'validation' || value === 'supplement' ? value : undefined;
}

/**
 * Monthly page's rich source definitions, derived from the DB workflow's fileRefs.properties
 * metadata (workflow definitions are DB-owned; see CLAUDE.md). jsonb does not preserve key order,
 * so entries carry an explicit `order` used to sort them back into display order.
 */
export function monthlySourcesFromSchemaOrdered(schemaJson: unknown): OrderedMonthlyRunSourceDefinition[] {
  const schema = parseJson<Record<string, unknown>>(schemaJson, {});
  const fileRefs = isRecord(schema.fileRefs) ? schema.fileRefs : {};
  const properties = isRecord(fileRefs.properties) ? (fileRefs.properties as Record<string, unknown>) : {};
  return Object.entries(properties)
    .map(([sourceKey, raw]) => {
      const field = isRecord(raw) ? raw : {};
      return {
        sourceKey,
        sourceGroup: field.sourceGroup === 'futu' ? ('futu' as const) : ('shareworks' as const),
        taskId: typeof field.taskId === 'string' ? field.taskId : '',
        label: typeof field.label === 'string' ? field.label : sourceKey,
        description: typeof field.description === 'string' ? field.description : '',
        defaultSheetName: typeof field.defaultSheetName === 'string' ? field.defaultSheetName : null,
        allowSheetNameOverride: field.allowSheetNameOverride === true,
        required: field.required === true,
        hidden: field.hidden === true,
        optionalCategory: readOptionalCategory(field.optionalCategory),
        order: typeof field.order === 'number' ? field.order : 0,
      };
    })
    .sort((left, right) => left.order - right.order);
}

export function monthlySourcesFromSchema(schemaJson: unknown): MonthlyRunSourceDefinition[] {
  return monthlySourcesFromSchemaOrdered(schemaJson).map(({ order: _order, ...source }) => source);
}

import type { WorkflowDataFrame, WorkflowTask } from '../../../shared/types.js';
import {
  defineWorkflowOperator,
  normalizeWorkflowTaskDependencies,
  requireInputDataFrame,
} from './types.js';

type ConflictPolicy = 'increment-wins' | 'base-wins' | 'error';
type IncomingBlankPolicy = 'preserve' | 'overwrite';

type SortSpec = {
  column: string;
  direction: 'asc' | 'desc';
};

type KeyNormalizationConfig = {
  caseInsensitive: boolean;
  collapseWhitespace: boolean;
  numericColumns: Set<string>;
  dateColumns: Set<string>;
  nullAsZeroColumns: Set<string>;
};

type MergeEntry = {
  row: Record<string, unknown>;
  source: 'base' | 'increment';
  order: number;
  action: 'retained' | 'inserted' | 'replaced';
};

export type KeyedMergeStats = {
  baseRowCount: number;
  incrementRowCount: number;
  outputRowCount: number;
  insertedRowCount: number;
  replacedRowCount: number;
  retainedRowCount: number;
  duplicateBaseKeyCount: number;
  duplicateIncrementKeyCount: number;
};

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? '').trim()).filter(Boolean);
}

function normalizeConflictPolicy(value: unknown): ConflictPolicy {
  return value === 'base-wins' || value === 'error' ? value : 'increment-wins';
}

function normalizeIncomingBlankPolicy(value: unknown): IncomingBlankPolicy {
  return value === 'overwrite' ? 'overwrite' : 'preserve';
}

function normalizeSortSpecs(value: unknown): SortSpec[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === 'string') {
        const column = item.trim();
        return column ? { column, direction: 'asc' as const } : null;
      }
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
      const record = item as Record<string, unknown>;
      const column = String(record.column ?? '').trim();
      if (!column) return null;
      return {
        column,
        direction: record.direction === 'desc' ? ('desc' as const) : ('asc' as const),
      };
    })
    .filter((item): item is SortSpec => Boolean(item));
}

function normalizeKeyNormalization(value: unknown): KeyNormalizationConfig {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
  return {
    caseInsensitive: record.caseInsensitive !== false,
    collapseWhitespace: record.collapseWhitespace !== false,
    numericColumns: new Set(stringArray(record.numericColumns)),
    dateColumns: new Set(stringArray(record.dateColumns)),
    nullAsZeroColumns: new Set(stringArray(record.nullAsZeroColumns)),
  };
}

function dateFromExcelSerial(value: number): Date | null {
  if (!Number.isFinite(value) || value < 1) return null;
  const date = new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86_400_000);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateFromValue(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') return dateFromExcelSerial(value);
  const text = String(value ?? '').trim();
  if (!text) return null;
  const numeric = Number(text.replace(/,/g, ''));
  if (Number.isFinite(numeric) && numeric > 10_000) return dateFromExcelSerial(numeric);
  const parsed = new Date(text.replace(/\//g, '-'));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeNumber(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const numeric = typeof value === 'number' ? value : Number(String(value).replace(/,/g, '').trim());
  if (!Number.isFinite(numeric)) return null;
  return String(numeric);
}

function normalizeKeyValue(column: string, value: unknown, config: KeyNormalizationConfig): string {
  if (
    (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) &&
    config.nullAsZeroColumns.has(column)
  ) {
    return 'number:0';
  }
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) {
    return '<null>';
  }

  if (config.dateColumns.has(column)) {
    const date = dateFromValue(value);
    if (date) return `date:${date.toISOString().slice(0, 10)}`;
  }

  if (config.numericColumns.has(column) || config.nullAsZeroColumns.has(column)) {
    const numeric = normalizeNumber(value);
    if (numeric !== null) return `number:${numeric}`;
  }

  let text = String(value).trim();
  if (config.collapseWhitespace) text = text.replace(/\s+/g, ' ');
  if (config.caseInsensitive) text = text.toLocaleUpperCase('en-US');
  return `text:${text}`;
}

export function buildDataFrameKey(
  row: Record<string, unknown>,
  keyColumns: string[],
  normalization: KeyNormalizationConfig | Record<string, unknown>,
): string {
  const config: KeyNormalizationConfig =
    normalization instanceof Object && 'numericColumns' in normalization && normalization.numericColumns instanceof Set
      ? normalization as KeyNormalizationConfig
      : normalizeKeyNormalization(normalization);
  return JSON.stringify(keyColumns.map((column) => normalizeKeyValue(column, row[column], config)));
}

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

function projectRow(row: Record<string, unknown>, columns: string[]): Record<string, unknown> {
  return Object.fromEntries(columns.map((column) => [column, row[column] ?? null]));
}

function mergeRows(
  current: Record<string, unknown>,
  incoming: Record<string, unknown>,
  incomingColumns: Set<string>,
  blankPolicy: IncomingBlankPolicy,
  columns: string[],
): Record<string, unknown> {
  const merged = projectRow(current, columns);
  for (const column of incomingColumns) {
    if (!columns.includes(column)) continue;
    const value = incoming[column] ?? null;
    if (blankPolicy === 'preserve' && isBlank(value) && !isBlank(merged[column])) continue;
    merged[column] = value;
  }
  return merged;
}

function compareValues(left: unknown, right: unknown): number {
  if (left === right) return 0;
  if (left === null || left === undefined || left === '') return 1;
  if (right === null || right === undefined || right === '') return -1;

  if (typeof left === 'number' && typeof right === 'number') {
    return left < right ? -1 : 1;
  }

  const leftDate = dateFromValue(left);
  const rightDate = dateFromValue(right);
  if (leftDate && rightDate) {
    return leftDate.getTime() === rightDate.getTime() ? 0 : leftDate < rightDate ? -1 : 1;
  }

  const leftText = String(left);
  const rightText = String(right);
  return leftText === rightText ? 0 : leftText < rightText ? -1 : 1;
}

function sortEntries(entries: MergeEntry[], sortSpecs: SortSpec[]): MergeEntry[] {
  if (!sortSpecs.length) return entries.sort((left, right) => left.order - right.order);
  return entries.sort((left, right) => {
    for (const spec of sortSpecs) {
      const compared = compareValues(left.row[spec.column], right.row[spec.column]);
      if (compared !== 0) return spec.direction === 'desc' ? -compared : compared;
    }
    return left.order - right.order;
  });
}

export function mergeKeyedDataFrames(params: {
  base: WorkflowDataFrame;
  increment: WorkflowDataFrame;
  keyColumns: string[];
  outputColumns?: string[];
  conflictPolicy?: ConflictPolicy;
  incomingBlankPolicy?: IncomingBlankPolicy;
  sortColumns?: unknown;
  keyNormalization?: unknown;
  emitAuditColumns?: boolean;
}): { dataframe: WorkflowDataFrame; stats: KeyedMergeStats } {
  const keyColumns = params.keyColumns.map((column) => column.trim()).filter(Boolean);
  if (!keyColumns.length) throw new Error('Keyed merge requires at least one key column');

  const baseColumns = params.base.columns;
  const incrementColumns = params.increment.columns;
  for (const column of keyColumns) {
    if (!baseColumns.includes(column)) throw new Error(`Keyed merge base input is missing key column: ${column}`);
    if (!incrementColumns.includes(column)) throw new Error(`Keyed merge increment input is missing key column: ${column}`);
  }

  const outputColumns = (params.outputColumns?.length ? params.outputColumns : [...baseColumns, ...incrementColumns])
    .map((column) => column.trim())
    .filter((column, index, values) => column && values.indexOf(column) === index);
  outputColumns.unshift(...keyColumns.filter((column) => !outputColumns.includes(column)));

  const conflictPolicy = normalizeConflictPolicy(params.conflictPolicy);
  const blankPolicy = normalizeIncomingBlankPolicy(params.incomingBlankPolicy);
  const normalization = normalizeKeyNormalization(params.keyNormalization);
  const sortSpecs = normalizeSortSpecs(params.sortColumns);
  const incomingColumns = new Set(incrementColumns);
  const entries = new Map<string, MergeEntry>();
  let order = 0;
  let duplicateBaseKeyCount = 0;
  let duplicateIncrementKeyCount = 0;
  let insertedRowCount = 0;
  let replacedRowCount = 0;

  const ingest = (dataframe: WorkflowDataFrame, source: 'base' | 'increment') => {
    for (const row of dataframe.rows) {
      const key = buildDataFrameKey(row, keyColumns, normalization);
      const existing = entries.get(key);
      if (!existing) {
        entries.set(key, {
          row: projectRow(row, outputColumns),
          source,
          order: order++,
          action: source === 'base' ? 'retained' : 'inserted',
        });
        if (source === 'increment') insertedRowCount += 1;
        continue;
      }

      if (source === 'base') duplicateBaseKeyCount += 1;
      else duplicateIncrementKeyCount += 1;

      if (source === 'increment' && conflictPolicy === 'error') {
        throw new Error(`Keyed merge found an existing key in increment input: ${key}`);
      }
      if (source === 'increment' && conflictPolicy === 'base-wins') continue;

      const nextRow = source === 'increment'
        ? mergeRows(existing.row, row, incomingColumns, blankPolicy, outputColumns)
        : projectRow(row, outputColumns);
      entries.set(key, {
        row: nextRow,
        source,
        order: existing.order,
        action: source === 'increment' ? 'replaced' : existing.action,
      });
      if (source === 'increment') replacedRowCount += 1;
    }
  };

  ingest(params.base, 'base');
  ingest(params.increment, 'increment');

  const sortedEntries = sortEntries(Array.from(entries.values()), sortSpecs);
  const auditColumns = params.emitAuditColumns === true
    ? ['__merge_key', '__merge_action', '__merge_source']
    : [];
  const rows: Array<Record<string, unknown>> = sortedEntries.map((entry) => ({
    ...entry.row,
    ...(params.emitAuditColumns === true
      ? {
          __merge_key: buildDataFrameKey(entry.row, keyColumns, normalization),
          __merge_action: entry.action,
          __merge_source: entry.source,
        }
      : {}),
  }));
  const mergedColumns = [...outputColumns, ...auditColumns];
  const mergedRange = {
    ...params.base.range,
    a1Range: '',
    startRow: 1,
    endRow: rows.length,
    startCol: 1,
    endCol: mergedColumns.length,
  };
  const dataframe: WorkflowDataFrame = {
    columns: mergedColumns,
    rows,
    index: rows.map((_, index) => index + 1),
    matrix: rows.map((row) => mergedColumns.map((column) => row[column] ?? null)),
    range: mergedRange,
    source: {
      kind: 'computed',
      sheetName: params.base.range.sheetName || 'Keyed Merge',
      range: mergedRange,
    },
  };

  const stats: KeyedMergeStats = {
    baseRowCount: params.base.rows.length,
    incrementRowCount: params.increment.rows.length,
    outputRowCount: rows.length,
    insertedRowCount,
    replacedRowCount,
    retainedRowCount: rows.length - insertedRowCount,
    duplicateBaseKeyCount,
    duplicateIncrementKeyCount,
  };

  return {
    dataframe,
    stats,
  };
}

function normalizeKeyedMergeTask(task: WorkflowTask) {
  const rawInputs = task.inputs ?? {};
  task.inputs = {
    base: {
      from: String(rawInputs.base?.from ?? '').trim(),
      slot: 'dataframe',
      guards: rawInputs.base?.guards,
    },
    increment: {
      from: String(rawInputs.increment?.from ?? '').trim(),
      slot: 'dataframe',
      guards: rawInputs.increment?.guards,
    },
  };
  task.params.keyColumns = stringArray(task.params.keyColumns);
  task.params.outputColumns = stringArray(task.params.outputColumns);
  task.params.sortColumns = normalizeSortSpecs(task.params.sortColumns);
  task.params.conflictPolicy = normalizeConflictPolicy(task.params.conflictPolicy);
  task.params.incomingBlankPolicy = normalizeIncomingBlankPolicy(task.params.incomingBlankPolicy);
  task.params.emitAuditColumns = task.params.emitAuditColumns === true;
  normalizeWorkflowTaskDependencies(task);
}

export const dataframeKeyedMergeOperator = defineWorkflowOperator({
  code: 'dataframe.keyed.merge',
  name: 'Keyed Incremental Merge / 按键增量合并',
  version: '1.0.0',
  category: 'Transform',
  description: '将 base dataframe 与 increment dataframe 按自然键幂等合并，支持冲突策略、空值策略和稳定排序。',
  documentation: {
    usage:
      '用于把周期性增量表合并到累计 base 表。相同键只保留一行，因此重复执行同一增量不会产生重复数据；默认由 increment 覆盖 base 的同键记录。',
    steps: [
      '连接 base 和 increment 两个 dataframe。',
      '在 keyColumns 中填写业务自然键；不要把累计余额或易变描述列放进键。',
      '需要稳定输出顺序时，在 sortColumns 中填写列名或 { column, direction }。',
      'outputColumns 可限制并固定输出列；emitAuditColumns 可为后续审计附加 __merge_* 列。',
    ],
    example: `{
  "keyColumns": ["entity_id", "effective_date", "amount"],
  "outputColumns": ["entity_id", "effective_date", "amount", "balance"],
  "sortColumns": ["effective_date"],
  "conflictPolicy": "increment-wins",
  "incomingBlankPolicy": "preserve"
}`,
  },
  inputSlots: [
    { slot: 'base', type: 'table', contentType: 'application/json', label: 'Base', required: true },
    { slot: 'increment', type: 'table', contentType: 'application/json', label: 'Increment', required: true },
  ],
  outputSlots: [{ slot: 'dataframe', type: 'table', contentType: 'application/json', label: 'Merged DataFrame' }],
  paramsSchema: {
    keyColumns: {
      type: 'array',
      label: '自然键列',
      required: true,
      description: '用于识别同一记录的列集合；相同键只输出一行。',
      default: [],
    },
    outputColumns: {
      type: 'array',
      label: '输出列',
      required: false,
      description: '为空时输出两个输入列名的并集；填写后固定输出列顺序。',
      default: [],
    },
    sortColumns: {
      type: 'array',
      label: '排序列',
      required: false,
      description: '可填写列名，或 { column, direction } 对象。',
      default: [],
    },
    conflictPolicy: {
      type: 'string',
      label: '冲突策略',
      required: false,
      enum: ['increment-wins', 'base-wins', 'error'],
      default: 'increment-wins',
    },
    incomingBlankPolicy: {
      type: 'string',
      label: '增量空值策略',
      required: false,
      enum: ['preserve', 'overwrite'],
      default: 'preserve',
    },
    keyNormalization: {
      type: 'object',
      label: '键标准化',
      required: false,
      description: '支持 caseInsensitive、collapseWhitespace、numericColumns、dateColumns、nullAsZeroColumns。',
      default: {},
    },
    emitAuditColumns: {
      type: 'boolean',
      label: '输出合并审计列',
      required: false,
      default: false,
    },
  },
  normalizeTask: normalizeKeyedMergeTask,
  async execute(context) {
    const base = await requireInputDataFrame(context, 'base');
    const increment = await requireInputDataFrame(context, 'increment');
    const result = mergeKeyedDataFrames({
      base,
      increment,
      keyColumns: stringArray(context.task.params.keyColumns),
      outputColumns: stringArray(context.task.params.outputColumns),
      conflictPolicy: normalizeConflictPolicy(context.task.params.conflictPolicy),
      incomingBlankPolicy: normalizeIncomingBlankPolicy(context.task.params.incomingBlankPolicy),
      sortColumns: context.task.params.sortColumns,
      keyNormalization: context.task.params.keyNormalization,
      emitAuditColumns: context.task.params.emitAuditColumns === true,
    });
    return result.dataframe;
  },
  async preview(context) {
    const base = await requireInputDataFrame(context, 'base');
    const increment = await requireInputDataFrame(context, 'increment');
    const result = mergeKeyedDataFrames({
      base,
      increment,
      keyColumns: stringArray(context.task.params.keyColumns),
      outputColumns: stringArray(context.task.params.outputColumns),
      conflictPolicy: normalizeConflictPolicy(context.task.params.conflictPolicy),
      incomingBlankPolicy: normalizeIncomingBlankPolicy(context.task.params.incomingBlankPolicy),
      sortColumns: context.task.params.sortColumns,
      keyNormalization: context.task.params.keyNormalization,
      emitAuditColumns: context.task.params.emitAuditColumns === true,
    });
    return { kind: 'dataframe', dataFrame: result.dataframe };
  },
});

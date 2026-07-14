import type {
  ProductFileRecord,
  WorkflowDataFrame,
  WorkflowFileReference,
  WorkflowOperatorCategory,
  WorkflowOperatorDocumentation,
  WorkflowOperatorParamsSchema,
  WorkflowRuntimeParameterField,
  WorkflowOperatorSlot,
  WorkflowSqlTableBinding,
  WorkflowTask,
  WorkflowTaskPreviewResult,
} from '../../../shared/types.js';
import type { EsopPagePersistInput, EsopPagePersistResult } from '../../esopWorkflow/persistence.js';
import type { FivePercentHoldersPersistInput, FivePercentHoldersPersistResult } from '../../fivePercentHolders/persistence.js';
import type { PlanSummaryPersistInput, PlanSummaryPersistResult } from '../../planSummary/persistence.js';

export type WorkflowOperatorSeedDefinition = {
  code: string;
  name: string;
  version: string;
  category: WorkflowOperatorCategory;
  description: string;
  inputSlots: WorkflowOperatorSlot[];
  outputSlots: WorkflowOperatorSlot[];
  paramsSchema: WorkflowOperatorParamsSchema;
  documentation?: WorkflowOperatorDocumentation;
};

export type WorkflowOperatorRuntimeParameterRequirement = {
  path: string;
  field: WorkflowRuntimeParameterField;
  defaultValue?: unknown | (() => unknown);
  appliesTo?: (task: WorkflowTask) => boolean;
};

export type WorkflowOperatorRuntime = {
  extractSheetRangeAsDataFrame: (
    buffer: Buffer,
    sheetName: string,
    options: { range: string; headerRow?: number | null; dropTrailingEmptyRows?: boolean },
  ) => WorkflowDataFrame;
  rowsToDataFrame: (
    rows: Array<Record<string, unknown>>,
    options: { sheetName: string; a1Range: string },
  ) => WorkflowDataFrame;
  dataFrameToWorkbookBuffer: (dataframe: WorkflowDataFrame, options: { sheetName: string }) => Buffer;
  readFile: (ref: WorkflowFileReference) => Promise<Buffer>;
  getProductFileBufferById?: (fileId: number) => Promise<Buffer>;
  saveGeneratedWorkbook: (params: {
    originalName: string;
    buffer: Buffer;
    mimeType?: string;
    uploadedBy?: string;
  }) => Promise<ProductFileRecord>;
  /**
   * Upsert dataframe rows into a whitelisted database table. Only present when the
   * host wires DB-write access (see server.ts). Implementations MUST enforce a table
   * whitelist and validate identifiers. `updateColumns` empty ⇒ ON CONFLICT DO NOTHING.
   */
  upsertTableRows?: (params: {
    table: string;
    columns: string[];
    rows: Array<Record<string, unknown>>;
    conflictColumns: string[];
    updateColumns: string[];
  }) => Promise<{ inserted: number; updated: number }>;
  persistEsopPage?: (params: EsopPagePersistInput) => Promise<EsopPagePersistResult>;
  persistPlanSummary?: (params: PlanSummaryPersistInput) => Promise<PlanSummaryPersistResult>;
  persistFivePercentHolders?: (params: FivePercentHoldersPersistInput) => Promise<FivePercentHoldersPersistResult>;
};

export type WorkflowOperatorExecutionContext = {
  task: WorkflowTask;
  executed: Map<string, WorkflowDataFrame>;
  taskMap: Map<string, WorkflowTask>;
  runtime: WorkflowOperatorRuntime;
  executeTask: (task: WorkflowTask) => Promise<WorkflowDataFrame>;
  resolveInputDataFrame: (inputSlot: string) => Promise<WorkflowDataFrame>;
};

export type WorkflowOperatorExecuteResult = WorkflowDataFrame | WorkflowTaskPreviewResult;

export type WorkflowOperatorDefinition = WorkflowOperatorSeedDefinition & {
  runtimeParameters?: WorkflowOperatorRuntimeParameterRequirement[];
  normalizeTask?: (task: WorkflowTask) => void;
  execute: (context: WorkflowOperatorExecutionContext) => Promise<WorkflowOperatorExecuteResult>;
  preview?: (context: WorkflowOperatorExecutionContext) => Promise<WorkflowTaskPreviewResult>;
};

export function defineWorkflowOperator(definition: WorkflowOperatorDefinition): WorkflowOperatorDefinition {
  return definition;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizeSqlTableBindings(value: unknown): WorkflowSqlTableBinding[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!isRecord(item)) return null;
      const tableName = String(item.tableName ?? '').trim();
      const inputSlot = String(item.inputSlot ?? '').trim();
      if (!tableName || !inputSlot) return null;
      return { tableName, inputSlot };
    })
    .filter((item): item is WorkflowSqlTableBinding => Boolean(item));
}

export function normalizePersistExcelFileName(raw: unknown, fallback: string) {
  const base = String(raw ?? '').trim() || fallback;
  return /\.xlsx$/i.test(base) ? base : `${base}.xlsx`;
}

export function prefixPersistExcelFileName(fileName: string, rawPrefix: unknown): string {
  const prefix = String(rawPrefix ?? '').trim();
  if (!prefix) return fileName;
  return `${prefix}-${fileName.replace(/^-+/, '')}`;
}

export function isWorkflowRuntimeReference(value: unknown): value is { $fromRuntime: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).$fromRuntime === 'string'
  );
}

export function normalizeWorkflowFileReference(value: unknown): WorkflowFileReference | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return { provider: 'product-files', id: value };
  }

  if (!isRecord(value)) return null;
  const provider = String(value.provider ?? '').trim();
  if (!provider) return null;

  if (provider === 'product-files') {
    const id = Number(value.id);
    return Number.isInteger(id) && id > 0 ? { provider, id } : null;
  }

  return { ...value, provider };
}

export async function readWorkflowFile(runtime: WorkflowOperatorRuntime, ref: WorkflowFileReference): Promise<Buffer> {
  if (runtime.readFile) return runtime.readFile(ref);
  if (ref.provider === 'product-files' && typeof ref.id === 'number' && runtime.getProductFileBufferById) {
    return runtime.getProductFileBufferById(ref.id);
  }
  throw new Error(`Workflow file provider not configured: ${ref.provider}`);
}

export function normalizeWorkflowTaskDependencies(task: WorkflowTask) {
  const inputSourceIds = new Set(
    Object.values(task.inputs ?? {})
      .map((binding) => String(binding?.from ?? '').trim())
      .filter(Boolean),
  );
  const dependsOn = Array.isArray(task.dependsOn) ? task.dependsOn : [];
  task.dependsOn = Array.from(
    new Set(
      dependsOn
        .map((taskId) => String(taskId ?? '').trim())
        .filter((taskId) => taskId && taskId !== task.id && !inputSourceIds.has(taskId)),
    ),
  );
}

export function toSqlIdentifier(raw: string): string {
  const cleaned = raw.trim().replace(/[^a-zA-Z0-9_]/g, '_');
  if (!cleaned) throw new Error('SQL table name cannot be empty');
  if (!/^[A-Za-z_]/.test(cleaned)) return `t_${cleaned}`;
  return cleaned;
}

export async function requireInputDataFrame(
  context: WorkflowOperatorExecutionContext,
  inputSlot: string,
  label = 'dataframe',
) {
  const inputRef = context.task.inputs[inputSlot];
  if (!inputRef?.from?.trim()) {
    throw new Error(`Task ${context.task.name} requires an upstream ${label} input`);
  }
  return context.resolveInputDataFrame(inputSlot);
}

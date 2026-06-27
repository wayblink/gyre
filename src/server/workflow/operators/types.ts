import type {
  ProductFileRecord,
  WorkflowDataFrame,
  WorkflowOperatorCategory,
  WorkflowOperatorParamsSchema,
  WorkflowOperatorSlot,
  WorkflowSqlTableBinding,
  WorkflowTask,
  WorkflowTaskPreviewResult,
} from '../../../shared/types.js';

export type WorkflowOperatorSeedDefinition = {
  code: string;
  name: string;
  version: string;
  category: WorkflowOperatorCategory;
  description: string;
  inputSlots: WorkflowOperatorSlot[];
  outputSlots: WorkflowOperatorSlot[];
  paramsSchema: WorkflowOperatorParamsSchema;
};

export type WorkflowOperatorRuntime = {
  extractSheetRangeAsDataFrame: (
    buffer: Buffer,
    sheetName: string,
    options: { range: string; headerRow?: number | null },
  ) => WorkflowDataFrame;
  rowsToDataFrame: (
    rows: Array<Record<string, unknown>>,
    options: { sheetName: string; a1Range: string },
  ) => WorkflowDataFrame;
  dataFrameToWorkbookBuffer: (dataframe: WorkflowDataFrame, options: { sheetName: string }) => Buffer;
  getProductFileBufferById: (fileId: number) => Promise<Buffer>;
  saveGeneratedWorkbook: (params: {
    originalName: string;
    buffer: Buffer;
    mimeType?: string;
    uploadedBy?: string;
  }) => Promise<ProductFileRecord>;
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

import type {
  WorkflowAssertFailureStrategy,
  WorkflowAssertOperator,
  WorkflowOperator,
  WorkflowRuntimeParameterReference,
  WorkflowSqlTableBinding,
  WorkflowTask,
} from '../../shared/types.js';

const SHEET_RANGE_EXTRACT_CODE = 'sheet.range.extract';
const SHEET_SECTIONS_EXTRACT_CODE = 'sheet.sections.extract';
const SQL_COMPUTE_CODE = 'sql.compute';
const DATAFRAME_PERSIST_EXCEL_CODE = 'dataframe.persist.excel';
const DATAFRAME_ASSERT_CODE = 'dataframe.assert';
const DATAFRAME_SQL_ASSERT_CODE = 'dataframe.sql.assert';
const DATAFRAME_SCHEMA_ASSERT_CODE = 'dataframe.schema.assert';
const DATAFRAME_SHAPE_ASSERT_CODE = 'dataframe.shape.assert';
const WORKFLOW_RUNTIME_FILE_SELECT_PREFIX = '__runtime__:';

export function isWorkflowRuntimeParameterReference(value: unknown): value is WorkflowRuntimeParameterReference {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).$fromRuntime === 'string'
  );
}

function cloneRuntimeParameterReference(value: WorkflowRuntimeParameterReference): WorkflowRuntimeParameterReference {
  return JSON.parse(JSON.stringify(value)) as WorkflowRuntimeParameterReference;
}

export function normalizeWorkflowFileParamValue(value: unknown): number | WorkflowRuntimeParameterReference | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (isWorkflowRuntimeParameterReference(value)) return cloneRuntimeParameterReference(value);
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (record.provider === 'product-files') {
      const id = Number(record.id);
      return Number.isFinite(id) && id > 0 ? id : null;
    }
  }
  return null;
}

export function getWorkflowFileParamRuntimePath(value: unknown): string | null {
  return isWorkflowRuntimeParameterReference(value) ? value.$fromRuntime : null;
}

export function encodeWorkflowFileParamSelection(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return String(value);
  if (isWorkflowRuntimeParameterReference(value)) return `${WORKFLOW_RUNTIME_FILE_SELECT_PREFIX}${value.$fromRuntime}`;
  return '';
}

export function decodeWorkflowFileParamSelection(value: string): number | WorkflowRuntimeParameterReference | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith(WORKFLOW_RUNTIME_FILE_SELECT_PREFIX)) {
    const runtimePath = trimmed.slice(WORKFLOW_RUNTIME_FILE_SELECT_PREFIX.length).trim();
    return runtimePath ? { $fromRuntime: runtimePath } : null;
  }
  const numeric = Number(trimmed);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

export type WorkflowRuntimeReferenceUsage = {
  paramPath: string;
  runtimePath: string;
};

export type WorkflowTaskParamInputUsage =
  | {
      paramPath: string;
      kind: 'file';
      fileId: number;
    }
  | {
      paramPath: string;
      kind: 'runtime';
      runtimePath: string;
    };

export function collectWorkflowRuntimeReferences(
  value: unknown,
  currentPath = '',
): WorkflowRuntimeReferenceUsage[] {
  if (isWorkflowRuntimeParameterReference(value)) {
    return [
      {
        paramPath: currentPath || '$',
        runtimePath: value.$fromRuntime,
      },
    ];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectWorkflowRuntimeReferences(item, `${currentPath}[${index}]`));
  }

  if (!value || typeof value !== 'object') return [];

  return Object.entries(value as Record<string, unknown>).flatMap(([key, nestedValue]) =>
    collectWorkflowRuntimeReferences(nestedValue, currentPath ? `${currentPath}.${key}` : key),
  );
}

export function collectWorkflowTaskParamInputUsages(task: WorkflowTask): WorkflowTaskParamInputUsage[] {
  if (!isSheetRangeExtractTask(task) && !isSheetSectionsExtractTask(task)) {
    return [];
  }

  const fileParam = normalizeWorkflowFileParamValue(task.params.fileRef ?? task.params.fileId);
  const paramPath = task.params.fileRef === undefined ? 'fileId' : 'fileRef';
  if (typeof fileParam === 'number') {
    return [{ paramPath, kind: 'file', fileId: fileParam }];
  }
  if (isWorkflowRuntimeParameterReference(fileParam)) {
    return [{ paramPath, kind: 'runtime', runtimePath: fileParam.$fromRuntime }];
  }
  return [];
}

export function isSheetRangeExtractTask(task: WorkflowTask | null): boolean {
  return task?.operatorCode === SHEET_RANGE_EXTRACT_CODE;
}

export function isSheetSectionsExtractTask(task: WorkflowTask | null): boolean {
  return task?.operatorCode === SHEET_SECTIONS_EXTRACT_CODE;
}

export function isSqlComputeTask(task: WorkflowTask | null): boolean {
  return task?.operatorCode === SQL_COMPUTE_CODE;
}

export function isPersistExcelTask(task: WorkflowTask | null): boolean {
  return task?.operatorCode === DATAFRAME_PERSIST_EXCEL_CODE;
}

export function isAssertTask(task: WorkflowTask | null): boolean {
  return task?.operatorCode === DATAFRAME_ASSERT_CODE;
}

export function isSqlAssertTask(task: WorkflowTask | null): boolean {
  return task?.operatorCode === DATAFRAME_SQL_ASSERT_CODE;
}

export function isSchemaAssertTask(task: WorkflowTask | null): boolean {
  return task?.operatorCode === DATAFRAME_SCHEMA_ASSERT_CODE;
}

export function isShapeAssertTask(task: WorkflowTask | null): boolean {
  return task?.operatorCode === DATAFRAME_SHAPE_ASSERT_CODE;
}

export function isAnyAssertTask(task: WorkflowTask | null): boolean {
  return isAssertTask(task) || isSqlAssertTask(task) || isSchemaAssertTask(task) || isShapeAssertTask(task);
}

export function isSqlTableBackedTask(task: WorkflowTask | null): boolean {
  return isSqlComputeTask(task) || isSqlAssertTask(task);
}

function cloneDefaultValue<T>(value: T): T {
  if (Array.isArray(value) || (value && typeof value === 'object')) {
    return JSON.parse(JSON.stringify(value)) as T;
  }
  return value;
}

export function buildDefaultTaskParams(operator: WorkflowOperator) {
  const params: Record<string, unknown> = {};
  Object.entries(operator.paramsSchema ?? {}).forEach(([key, field]) => {
    if (Object.prototype.hasOwnProperty.call(field, 'default')) {
      params[key] = cloneDefaultValue(field.default);
    }
  });
  return params;
}

export function buildDefaultTaskInputs(operator: WorkflowOperator) {
  const inputs: WorkflowTask['inputs'] = {};
  for (const slot of operator.inputSlots ?? []) {
    const slotName = String(slot.slot ?? '').trim();
    if (!slotName) continue;
    inputs[slotName] = { from: '', slot: 'dataframe' };
  }
  return inputs;
}

export function buildDefaultTaskName(operator: WorkflowOperator, nextIndex: number) {
  return `${operator.name} ${nextIndex}`;
}

export function buildWorkflowTask(operator: WorkflowOperator, nextIndex: number): WorkflowTask {
  return {
    id: `task_${nextIndex}`,
    name: buildDefaultTaskName(operator, nextIndex),
    operatorCode: operator.code,
    operatorVersion: operator.version,
    description: '',
    x: 48 + ((nextIndex - 1) % 3) * 340,
    y: 48 + Math.floor((nextIndex - 1) / 3) * 184,
    params: buildDefaultTaskParams(operator),
    inputs: buildDefaultTaskInputs(operator),
    dependsOn: [],
  };
}

export function normalizeTaskDependencies(task: WorkflowTask) {
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

export type WorkflowSheetSectionConfig = {
  key: string;
  title: string;
  range: string;
  headerRow: number | null;
  anchorText: string;
  rangeColumns: string;
  headerRowOffset: number | null;
  dataStartRowOffset: number | null;
  maxRows: number | null;
};

export function getSheetSections(task: WorkflowTask): WorkflowSheetSectionConfig[] {
  const raw = Array.isArray(task.params.sections) ? task.params.sections : [];
  return raw
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null;
      const record = item as Record<string, unknown>;
      const key = String(record.key ?? record.title ?? `section_${index + 1}`).trim() || `section_${index + 1}`;
      const title = String(record.title ?? key).trim();
      const range = String(record.range ?? '').trim();
      const anchorText = String(record.anchorText ?? '').trim();
      const rangeColumns = String(record.rangeColumns ?? '').trim();
      const headerRowValue = record.headerRow;
      const numericHeaderRow = Number(headerRowValue);
      const numericHeaderRowOffset = Number(record.headerRowOffset);
      const numericDataStartRowOffset = Number(record.dataStartRowOffset);
      const numericMaxRows = Number(record.maxRows);
      return {
        key,
        title,
        range,
        anchorText,
        rangeColumns,
        headerRow:
          headerRowValue === null || headerRowValue === undefined || headerRowValue === ''
            ? null
            : Number.isFinite(numericHeaderRow)
              ? numericHeaderRow
              : null,
        headerRowOffset:
          record.headerRowOffset === null || record.headerRowOffset === undefined || record.headerRowOffset === ''
            ? null
            : Number.isFinite(numericHeaderRowOffset)
              ? numericHeaderRowOffset
              : null,
        dataStartRowOffset:
          record.dataStartRowOffset === null || record.dataStartRowOffset === undefined || record.dataStartRowOffset === ''
            ? null
            : Number.isFinite(numericDataStartRowOffset)
              ? numericDataStartRowOffset
              : null,
        maxRows:
          record.maxRows === null || record.maxRows === undefined || record.maxRows === ''
            ? null
            : Number.isFinite(numericMaxRows)
              ? numericMaxRows
              : null,
      };
    })
    .filter((item): item is WorkflowSheetSectionConfig => Boolean(item));
}

export function normalizeSheetSectionsExtractTask(task: WorkflowTask) {
  if (!isSheetSectionsExtractTask(task)) return;
  task.inputs = {};
  task.params.sheetName = typeof task.params.sheetName === 'string' ? task.params.sheetName : '';
  task.params.fileRef = normalizeWorkflowFileParamValue(task.params.fileRef ?? task.params.fileId);
  delete task.params.fileId;
  const sections = getSheetSections(task);
  task.params.sectionMode = typeof task.params.sectionMode === 'string' ? task.params.sectionMode : 'manual';
  task.params.splitByColumn = typeof task.params.splitByColumn === 'string' ? task.params.splitByColumn : '';
  task.params.sections = sections.length
    ? sections
    : [
        {
          key: 'section_1',
          title: 'Section 1',
          range: '',
          headerRow: null,
          anchorText: '',
          rangeColumns: '',
          headerRowOffset: null,
          dataStartRowOffset: null,
          maxRows: null,
        },
      ];
  task.params.sectionColumn = typeof task.params.sectionColumn === 'string' && task.params.sectionColumn.trim() ? task.params.sectionColumn : 'section';
  task.params.sectionIndexColumn =
    typeof task.params.sectionIndexColumn === 'string' && task.params.sectionIndexColumn.trim()
      ? task.params.sectionIndexColumn
      : 'sectionIndex';
  task.params.sourceRangeColumn =
    typeof task.params.sourceRangeColumn === 'string' && task.params.sourceRangeColumn.trim()
      ? task.params.sourceRangeColumn
      : 'sourceRange';
  normalizeTaskDependencies(task);
}

export function getSqlTableBindings(task: WorkflowTask): WorkflowSqlTableBinding[] {
  const raw = task.params.tableBindings;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const tableName = String((item as Record<string, unknown>).tableName ?? '').trim();
      const inputSlot = String((item as Record<string, unknown>).inputSlot ?? '').trim();
      if (!tableName || !inputSlot) return null;
      return { tableName, inputSlot };
    })
    .filter((item): item is WorkflowSqlTableBinding => Boolean(item));
}

export function normalizeSqlTask(task: WorkflowTask) {
  if (!isSqlTableBackedTask(task)) return;
  const rawInputs = task.inputs ?? {};
  const nextInputs: WorkflowTask['inputs'] = {};
  for (const [slot, binding] of Object.entries(rawInputs)) {
    const slotName = slot.trim();
    if (!slotName) continue;
    nextInputs[slotName] = {
      from: String(binding?.from ?? '').trim(),
      slot: String(binding?.slot ?? 'dataframe').trim() || 'dataframe',
      guards: binding?.guards,
    };
  }
  if (!Object.keys(nextInputs).length) {
    nextInputs.input1 = { from: '', slot: 'dataframe' };
  }
  task.inputs = nextInputs;
  task.params.sql =
    typeof task.params.sql === 'string'
      ? task.params.sql
      : isSqlAssertTask(task)
        ? 'select count(*) as actual from {source}'
        : 'select * from {source}';
  task.params.tableBindings = getSqlTableBindings(task).filter((binding) => nextInputs[binding.inputSlot]);
  if (!Array.isArray(task.params.tableBindings) || !(task.params.tableBindings as WorkflowSqlTableBinding[]).length) {
    task.params.tableBindings = [{ tableName: 'source', inputSlot: 'input1' }];
  }
  if (isSqlAssertTask(task)) {
    normalizeAssertCompareParams(task);
  }
  normalizeTaskDependencies(task);
}

export function nextSqlInputSlotName(task: WorkflowTask): string {
  const existing = new Set(Object.keys(task.inputs ?? {}));
  let index = existing.size + 1;
  while (existing.has(`input${index}`)) {
    index += 1;
  }
  return `input${index}`;
}

function isAssertFailureStrategy(value: unknown): value is WorkflowAssertFailureStrategy {
  return value === 'block' || value === 'warning' || value === 'pass-through';
}

export function getAssertFailureStrategy(task: WorkflowTask): WorkflowAssertFailureStrategy {
  if (isAssertFailureStrategy(task.params.failureStrategy)) {
    return task.params.failureStrategy;
  }
  return task.params.blockExecution === false ? 'pass-through' : 'block';
}

export function normalizePersistExcelTask(task: WorkflowTask) {
  if (!isPersistExcelTask(task)) return;
  task.params.fileName =
    typeof task.params.fileName === 'string' && task.params.fileName.trim()
      ? task.params.fileName
      : `${task.name || 'workflow-output'}.xlsx`;
  task.params.sheetName = typeof task.params.sheetName === 'string' ? task.params.sheetName : 'Sheet1';
  task.params.uploadedBy = typeof task.params.uploadedBy === 'string' ? task.params.uploadedBy : 'Workflow';
  task.inputs = {
    input1: {
      from: String(task.inputs?.input1?.from ?? '').trim(),
      slot: 'dataframe',
      guards: task.inputs?.input1?.guards,
    },
  };
  normalizeTaskDependencies(task);
}

export function normalizeSheetRangeExtractTask(task: WorkflowTask) {
  if (!isSheetRangeExtractTask(task)) return;
  task.inputs = {};
  task.params.sheetName = typeof task.params.sheetName === 'string' ? task.params.sheetName : '';
  task.params.range = typeof task.params.range === 'string' ? task.params.range : '';
  task.params.fileRef = normalizeWorkflowFileParamValue(task.params.fileRef ?? task.params.fileId);
  delete task.params.fileId;
  normalizeTaskDependencies(task);
}

export function normalizeAssertTask(task: WorkflowTask) {
  if (!isAssertTask(task)) return;
  normalizeAssertCompareParams(task);
  task.inputs = {
    input1: {
      from: String(task.inputs?.input1?.from ?? '').trim(),
      slot: 'dataframe',
      guards: task.inputs?.input1?.guards,
    },
  };
  normalizeTaskDependencies(task);
}

function normalizeAssertCompareParams(task: WorkflowTask) {
  task.params.operator =
    task.params.operator === '>' ||
    task.params.operator === '>=' ||
    task.params.operator === '<' ||
    task.params.operator === '<=' ||
    task.params.operator === '=' ||
    task.params.operator === '!='
      ? task.params.operator
      : '=';
  if (!Object.prototype.hasOwnProperty.call(task.params, 'expectedValue')) {
    task.params.expectedValue = 0;
  }
  normalizeAssertFailureParams(task);
}

function normalizeAssertFailureParams(task: WorkflowTask) {
  task.params.failureMessage =
    typeof task.params.failureMessage === 'string' && task.params.failureMessage.trim()
      ? task.params.failureMessage
      : 'Assertion failed';
  task.params.failureStrategy = getAssertFailureStrategy(task);
  task.params.blockExecution = task.params.failureStrategy === 'block';
}

export function normalizeSchemaAssertTask(task: WorkflowTask) {
  if (!isSchemaAssertTask(task)) return;
  task.params.mode = task.params.mode === 'exact' ? 'exact' : 'contains';
  task.params.expectedColumns = Array.isArray(task.params.expectedColumns)
    ? task.params.expectedColumns.map((item) => String(item ?? '').trim()).filter(Boolean).join(', ')
    : String(task.params.expectedColumns ?? '');
  normalizeAssertFailureParams(task);
  task.inputs = {
    input1: {
      from: String(task.inputs?.input1?.from ?? '').trim(),
      slot: 'dataframe',
      guards: task.inputs?.input1?.guards,
    },
  };
  normalizeTaskDependencies(task);
}

export function normalizeShapeAssertTask(task: WorkflowTask) {
  if (!isShapeAssertTask(task)) return;
  const normalizeOperator = (value: unknown) =>
    value === 'any' || value === '>' || value === '>=' || value === '<' || value === '<=' || value === '=' || value === '!='
      ? value
      : '>=';
  const normalizeCount = (value: unknown, fallback: number) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0 ? Math.trunc(numeric) : fallback;
  };
  task.params.rowOperator = normalizeOperator(task.params.rowOperator);
  task.params.expectedRows = normalizeCount(task.params.expectedRows, 1);
  task.params.columnOperator = normalizeOperator(task.params.columnOperator);
  task.params.expectedColumns = normalizeCount(task.params.expectedColumns, 1);
  normalizeAssertFailureParams(task);
  task.inputs = {
    input1: {
      from: String(task.inputs?.input1?.from ?? '').trim(),
      slot: 'dataframe',
      guards: task.inputs?.input1?.guards,
    },
  };
  normalizeTaskDependencies(task);
}

export function getTaskInputSlots(task: WorkflowTask, operator?: WorkflowOperator | null): string[] {
  if (isSqlTableBackedTask(task)) {
    normalizeSqlTask(task);
    return Object.keys(task.inputs ?? {});
  }
  const declared = operator?.inputSlots?.map((slot) => slot.slot).filter(Boolean) ?? [];
  if (declared.length) return declared;
  return Object.keys(task.inputs ?? {});
}

export function getTaskOutputSlots(task: WorkflowTask, operator?: WorkflowOperator | null): string[] {
  const declared = operator?.outputSlots?.map((slot) => slot.slot).filter(Boolean) ?? [];
  if (declared.length) return declared;
  return ['output'];
}

export function applyTaskOperatorDefaults(task: WorkflowTask) {
  if (isSqlTableBackedTask(task)) {
    normalizeSqlTask(task);
    return;
  }
  if (isPersistExcelTask(task)) {
    normalizePersistExcelTask(task);
    return;
  }
  if (isAssertTask(task)) {
    normalizeAssertTask(task);
    return;
  }
  if (isSchemaAssertTask(task)) {
    normalizeSchemaAssertTask(task);
    return;
  }
  if (isShapeAssertTask(task)) {
    normalizeShapeAssertTask(task);
    return;
  }
  if (isSheetSectionsExtractTask(task)) {
    normalizeSheetSectionsExtractTask(task);
    return;
  }
  if (isSheetRangeExtractTask(task)) {
    normalizeSheetRangeExtractTask(task);
    return;
  }
  normalizeTaskDependencies(task);
}

export type { WorkflowSqlTableBinding, WorkflowAssertFailureStrategy, WorkflowAssertOperator };

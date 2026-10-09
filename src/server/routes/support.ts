import crypto from 'node:crypto';
import path from 'node:path';
import type { AppDb } from '../db.js';
import { config } from '../config.js';
import { canonicalProductFilePath, normalizeProductFileName, normalizeProductFolder } from '../fileIdentity.js';
import { fileStorage } from '../storage.js';
import { previewWorkbookSheet, summarizeValidatedWorkbookAsync } from '../excel.js';
import { MONTHLY_WORKFLOW_CODE } from '../monthlyRun/store.js';
import { monthlySourcesFromSchema } from '../monthlyRun/sourceSchema.js';
import type { MonthlyRunSourceDefinition, SummaryCapitalizationSource } from '../../shared/types.js';
import { isRecord, parseJson } from '../utils/json.js';

/**
 * Helpers shared by more than one route domain: HTTP error helpers, month lookup, product-file
 * mapping/persistence, the "latest workflow artifact" reader that every data page needs, and the
 * employee label/link maps the list pages join against.
 *
 * Every function that touches the database takes `db` explicitly so the route modules (and their
 * tests) can pass a fake; nothing here reaches for a module-level singleton.
 */

export type RequestWithAuth = {
  currentUser?: {
    id: number;
    username: string;
    display_name: string;
    role: string;
    email: string | null;
    phone: string | null;
    is_active: boolean;
    last_login_at: string | null;
  } | null;
};

export const DEFAULT_EMPLOYEE_LABEL_COLOR = '#2563eb';

export function parseEmployeeLabelRefs(value: unknown): EmployeeLabelRef[] {
  const rawLabels = Array.isArray(value) ? value : parseJson<Array<Record<string, unknown>>>(value, []);
  return rawLabels
    .map((label) => ({
      id: Number(label.id),
      name: String(label.name ?? '').trim(),
      color: normalizeEmployeeLabelColor(label.color),
    }))
    .filter((label) => Number.isInteger(label.id) && label.id > 0 && label.name !== '');
}

export type EmployeeLabelRef = {
  id: number;
  name: string;
  color: string;
};

type NameEmpNoSort = { by: 'name' | 'empNo' | null; dir: 'asc' | 'desc' };

export function readNameEmpNoSort(query: unknown): NameEmpNoSort {
  const raw = (query ?? {}) as { sort?: string; dir?: string };
  const by = raw.sort === 'name' ? 'name' : raw.sort === 'empNo' ? 'empNo' : null;
  const dir = raw.dir === 'desc' ? 'desc' : 'asc';
  return { by, dir };
}

export type LatestWorkflowDataFrameArtifact = {
  fileId: number;
  fileName: string;
  filePath: string;
  sheetName: string;
  columns: string[];
  rows: Array<Record<string, unknown>>;
  buffer: Buffer;
};

export type WorkflowPageSourceDescriptor = { sourceKey: string; label: string; sheet?: string | null };
export type WorkflowPageSourceBindingResponse = WorkflowPageSourceDescriptor & {
  fileId: number | null;
  fileName: string | null;
  sheet?: string | null;
};
export type WorkflowResultFileBindingResponse = { fileId: number; fileName: string };

export function workflowArtifactSheetName(metadata: Record<string, unknown>, fallback: string): string {
  const range = metadata.range;
  if (!isRecord(range)) return fallback;
  const sheetName = String(range.sheetName ?? '').trim();
  return sheetName || fallback;
}

export function buildCapitalizationSource(
  monthRow: {
    capitalization_source_file_id: number | null;
    capitalization_source_sheet_name: string | null;
  },
  file?: Record<string, unknown>,
): SummaryCapitalizationSource | null {
  if (!monthRow.capitalization_source_file_id) return null;
  return {
    fileId: Number(monthRow.capitalization_source_file_id),
    fileName: file ? productFileDisplayName(file) : null,
    sheetName: monthRow.capitalization_source_sheet_name ?? null,
  };
}

export function notFound(message: string) {
  const error = new Error(message) as Error & { statusCode?: number };
  error.statusCode = 404;
  return error;
}

export function badRequest(message: string) {
  const error = new Error(message) as Error & { statusCode?: number };
  error.statusCode = 400;
  return error;
}

export function conflict(message: string) {
  const error = new Error(message) as Error & { statusCode?: number };
  error.statusCode = 409;
  return error;
}

export function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === '23505'
  );
}

export function updatedByFromRequest(request: RequestWithAuth): string {
  return request.currentUser?.username?.trim() || 'system';
}

export function asBoolean(value: unknown): boolean {
  return value === true || value === 'true' || Number(value) === 1;
}

export function normalizeEmployeeLabelColor(value: unknown): string {
  const color = String(value ?? '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : DEFAULT_EMPLOYEE_LABEL_COLOR;
}

export function parseTags(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

export function toProductFile(row: Record<string, unknown>) {
  return {
    id: Number(row.id),
    originalName: String(row.original_name),
    displayName: productFileDisplayName(row),
    storedName: String(row.stored_name),
    displayPath: productFileDisplayPath(row),
    logicalPath: String(row.logical_path ?? productFileDisplayPath(row)),
    fileExt: String(row.file_ext ?? ''),
    fileSizeBytes: Number(row.file_size_bytes ?? 0),
    mimeType: String(row.mime_type ?? 'application/octet-stream'),
    checksum: String(row.checksum),
    storageBackend: String(row.storage_backend ?? 'local'),
    workbookSheetCount: Number(row.workbook_sheet_count ?? 0),
    workbookRowCount: Number(row.workbook_row_count ?? 0),
    uploadedBy: String(row.uploaded_by ?? 'Administrator'),
    createdAt: String(row.created_at),
  };
}

export function productFileDisplayPath(row: Record<string, unknown>) {
  if (row.logical_path) return String(row.logical_path);
  const relativePath = productFileRelativeStoragePath(row);
  const directory = relativePath.includes('/') ? relativePath.split('/').slice(0, -1).join('/') : '';
  const normalizedDirectory = normalizeProductFileStoragePrefix(directory);
  const inferredOutputDirectory = normalizedDirectory.startsWith('output/')
    ? null
    : inferOutputFolderFromProductFile(row);
  const displayDirectory = inferredOutputDirectory ?? normalizedDirectory;
  const rawDisplayFileName = path.posix
    .basename(String(row.original_name ?? row.stored_name ?? relativePath))
    .replace(/^\/+/, '');
  const displayFileName = displayDirectory.startsWith('output/')
    ? rawDisplayFileName
    : stripFileVersion(rawDisplayFileName);
  return `${displayDirectory}/${displayFileName}`;
}

export function productFileDisplayName(row: Record<string, unknown>) {
  return path.posix.basename(productFileDisplayPath(row));
}

export function productFileRelativeStoragePath(row: Record<string, unknown>) {
  const rawPath = String(row.file_path ?? '').replace(/\\/g, '/');
  const productRoot = config.productFileDir.replace(/\\/g, '/').replace(/\/+$/g, '');

  if (rawPath.startsWith(`${productRoot}/`)) {
    return rawPath.slice(productRoot.length + 1).replace(/^\/+/, '');
  }

  return rawPath.replace(/^product\//, '').replace(/^\/+/, '');
}

export function inferOutputFolderFromProductFile(row: Record<string, unknown>): string | null {
  const uploadedBy = String(row.uploaded_by ?? '');
  if (uploadedBy !== 'Workflow' && uploadedBy !== 'Summary Export') return null;

  const originalName = String(row.original_name ?? '').toLowerCase();
  if (originalName.includes('capitalization_table_summary_view')) return 'output/captable';
  if (originalName.includes('grant_record')) return 'output/grant-record';
  if (originalName.includes('exercise_record')) return 'output/exercise-record';
  if (originalName.includes('sold_shares')) return 'output/sold-shares';
  if (originalName.includes('transfer_plan')) return 'output/transfer-plan';
  if (originalName.includes('plan_summary')) return 'output/plan-summary';
  if (originalName.includes('five_percent_holders')) return 'output/five-percent-holders';
  return null;
}

export function normalizeProductFileStoragePrefix(prefix?: string): string {
  const normalized = normalizeStorageFolderPrefix(prefix);
  if (!normalized) return 'input';
  if (normalized === 'output' || normalized.startsWith('output/')) return normalized;
  if (normalized === 'input' || normalized.startsWith('input/')) return normalized;
  if (normalized === 'control_book' || normalized.startsWith('control_book/')) return normalized;
  return `input/${normalized}`;
}

export function normalizeStorageFolderPrefix(prefix?: string): string | undefined {
  try {
    return normalizeProductFolder(prefix) || undefined;
  } catch {
    throw badRequest('Invalid folder path');
  }
}

export function inputStorageFolderPrefix(prefix?: string): string {
  const normalized = normalizeStorageFolderPrefix(prefix);
  if (!normalized) return 'input';
  if (normalized === 'input' || normalized.startsWith('input/')) return normalized;
  return `input/${normalized}`;
}

export function stripFileVersion(fileName: string): string {
  return fileName.replace(/\.v\d{14}(?=\.[^.]+$)/i, '');
}

export function sourceFilesFromArtifacts(
  ...artifacts: Array<LatestWorkflowDataFrameArtifact | null | undefined>
): string[] {
  return [
    ...new Set(
      artifacts.map((artifact) => artifact?.filePath?.trim() || artifact?.fileName?.trim()).filter(Boolean) as string[],
    ),
  ];
}

export function resultFilesFromArtifacts(
  ...artifacts: Array<LatestWorkflowDataFrameArtifact | null | undefined>
): WorkflowResultFileBindingResponse[] {
  const byId = new Map<number, WorkflowResultFileBindingResponse>();
  for (const artifact of artifacts) {
    if (!artifact?.fileId) continue;
    byId.set(artifact.fileId, {
      fileId: artifact.fileId,
      fileName: artifact.filePath?.trim() || artifact.fileName?.trim() || `file-${artifact.fileId}`,
    });
  }
  return [...byId.values()];
}

export function productFileIdAtRuntimePath(runtimeParameters: unknown, runtimePath: string): number | null {
  const segments = runtimePath
    .split('.')
    .map((segment) => segment.trim())
    .filter(Boolean);
  let current: unknown = runtimeParameters;
  for (const segment of segments) {
    if (!isRecord(current)) return null;
    current = current[segment];
  }
  if (!isRecord(current) || current.provider !== 'product-files') return null;
  const fileId = Number(current.id);
  return Number.isInteger(fileId) && fileId > 0 ? fileId : null;
}

export function productFileKeyAtRuntimePath(runtimeParameters: unknown, runtimePath: string): string | null {
  const segments = runtimePath
    .split('.')
    .map((segment) => segment.trim())
    .filter(Boolean);
  let current: unknown = runtimeParameters;
  for (const segment of segments) {
    if (!isRecord(current)) return null;
    current = current[segment];
  }
  if (!isRecord(current) || current.provider !== 'product-files') return null;
  return String(current.key ?? '').trim() || null;
}

export function textValue(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text && text !== '--' ? text : null;
}

export function numberValue(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function nullableNumberValue(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

export function dateTextValue(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86_400_000).toISOString().slice(0, 10);
  }
  return textValue(value);
}

export function paginateItems<T>(items: T[], page: number, pageSize: number) {
  const total = items.length;
  const offset = (page - 1) * pageSize;
  return {
    items: items.slice(offset, offset + pageSize),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export function sortRowsByNameOrEmpNo<T>(
  rows: T[],
  sort: NameEmpNoSort,
  nameOf: (row: T) => string,
  empNoOf: (row: T) => string,
): T[] {
  if (!sort.by) return rows;
  const mul = sort.dir === 'desc' ? -1 : 1;
  const primary = sort.by === 'name' ? nameOf : empNoOf;
  const collator = { numeric: true, sensitivity: 'base' } as const;
  return [...rows].sort((a, b) => {
    const cmp = primary(a).localeCompare(primary(b), undefined, collator);
    if (cmp !== 0) return mul * cmp;
    return empNoOf(a).localeCompare(empNoOf(b), undefined, collator);
  });
}

export function sourcesFromWorkflowSchemaJson(schemaJson: unknown): WorkflowPageSourceDescriptor[] {
  const schema = parseJson<Record<string, unknown>>(schemaJson, {});
  const fileRefs = isRecord(schema.fileRefs) ? schema.fileRefs : {};
  const properties = isRecord(fileRefs.properties) ? (fileRefs.properties as Record<string, unknown>) : {};
  return Object.entries(properties).map(([sourceKey, field]) => {
    const nested = isRecord(field) && isRecord(field.properties) ? field.properties : {};
    const sheet = isRecord(nested.sheet) ? String(nested.sheet.default ?? '').trim() : '';
    return {
      sourceKey,
      label: isRecord(field) && typeof field.label === 'string' && field.label.trim() ? field.label.trim() : sourceKey,
      ...(sheet ? { sheet } : {}),
    };
  });
}

export async function getOrCreateMonth(db: AppDb, monthKey: string): Promise<number> {
  const existing = await db.queryOne<{ id: number }>('select id from months where month_key = $1', [monthKey]);
  if (existing) return Number(existing.id);

  const row = await db.queryOne<{ id: number }>(
    'insert into months (month_key, eom_date) values ($1, $2) returning id',
    [monthKey, eomForMonth(monthKey)],
  );
  if (!row) throw new Error(`Failed to create month ${monthKey}`);
  return Number(row.id);
}

export async function getMonth(
  db: AppDb,
  monthKey: string,
): Promise<
  | {
      id: number;
      month_key: string;
      eom_date: string;
      capitalization_source_file_id: number | null;
      capitalization_source_sheet_name: string | null;
    }
  | undefined
> {
  return db.queryOne<{
    id: number;
    month_key: string;
    eom_date: string;
    capitalization_source_file_id: number | null;
    capitalization_source_sheet_name: string | null;
  }>(
    'select id, month_key, eom_date, capitalization_source_file_id, capitalization_source_sheet_name from months where month_key = $1',
    [monthKey],
  );
}

export async function getProductFileOrThrow(db: AppDb, id: number) {
  const file = await db.queryOne<Record<string, unknown>>('select * from product_files where id = $1', [id]);
  if (!file) throw notFound('Product file not found');
  return file;
}

export async function saveProductWorkbook(
  db: AppDb,
  params: {
    originalName: string;
    buffer: Buffer;
    mimeType?: string;
    uploadedBy?: string;
    folderPrefix?: string;
    conflictPolicy?: 'error' | 'overwrite';
  },
) {
  const mimeType = params.mimeType?.trim() || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const uploadedBy = params.uploadedBy?.trim() || 'Workflow';
  const folderPrefix = normalizeProductFileStoragePrefix(params.folderPrefix);
  const originalName = normalizeProductFileName(params.originalName);
  const checksum = crypto.createHash('sha256').update(params.buffer).digest('hex');
  const ext = path.extname(originalName).toLowerCase() || '.xlsx';
  const storedName = originalName;
  const logicalPath = canonicalProductFilePath(folderPrefix, originalName);
  const existing = await db.queryOne<Record<string, unknown>>(
    'select * from product_files where lower(logical_path) = lower($1)',
    [logicalPath],
  );
  if (existing && params.conflictPolicy !== 'overwrite') {
    const error = conflict(`File already exists: ${logicalPath}`) as Error & { existingFile?: Record<string, unknown> };
    error.existingFile = existing;
    throw error;
  }
  let summary;
  try {
    summary = await summarizeValidatedWorkbookAsync(params.buffer, originalName);
  } catch (error) {
    throw badRequest(error instanceof Error ? error.message : 'Invalid workbook');
  }
  const stored = await fileStorage.save('product', storedName, params.buffer, {
    prefix: folderPrefix,
  });

  if (existing) {
    const row = await db.queryOne<Record<string, unknown>>(
      `update product_files
          set original_name = $2, stored_name = $3, file_ext = $4, file_path = $5,
              logical_path = $6, file_size_bytes = $7, mime_type = $8, checksum = $9,
              storage_backend = $10, workbook_sheet_count = $11, workbook_row_count = $12,
              uploaded_by = $13, created_at = current_timestamp
        where id = $1
        returning *`,
      [
        existing.id,
        originalName,
        stored.storedName,
        ext.replace(/^\./, ''),
        stored.filePath,
        logicalPath,
        params.buffer.length,
        mimeType,
        checksum,
        stored.storageBackend,
        summary.sheetCount,
        summary.totalRowCount,
        uploadedBy,
      ],
    );
    if (!row) throw new Error('Failed to overwrite product file');
    return { file: row, summary };
  }

  const row = await db.queryOne<Record<string, unknown>>(
    `insert into product_files (
      original_name, stored_name, file_ext, file_path, logical_path, file_size_bytes, mime_type, checksum,
      storage_backend, workbook_sheet_count, workbook_row_count, uploaded_by
    ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    returning *`,
    [
      originalName,
      stored.storedName,
      ext.replace(/^\./, ''),
      stored.filePath,
      logicalPath,
      params.buffer.length,
      mimeType,
      checksum,
      stored.storageBackend,
      summary.sheetCount,
      summary.totalRowCount,
      uploadedBy,
    ],
  );

  if (!row) {
    throw new Error('Failed to save product file');
  }

  return {
    file: row,
    summary,
  };
}

export async function updateProductWorkbook(
  db: AppDb,
  params: {
    fileId: number;
    originalName: string;
    buffer: Buffer;
    mimeType?: string;
    uploadedBy?: string;
  },
) {
  const existing = await getProductFileOrThrow(db, params.fileId);
  const mimeType = params.mimeType?.trim() || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const uploadedBy = params.uploadedBy?.trim() || String(existing.uploaded_by ?? 'Administrator');
  const originalName = String(existing.original_name);
  const checksum = crypto.createHash('sha256').update(params.buffer).digest('hex');
  const ext = path.extname(originalName).toLowerCase() || '.xlsx';
  const storedName = originalName;
  const existingDirectory = productFileRelativeStoragePath(existing).split('/').slice(0, -1).join('/');
  let summary;
  try {
    summary = await summarizeValidatedWorkbookAsync(params.buffer, originalName);
  } catch (error) {
    throw badRequest(error instanceof Error ? error.message : 'Invalid workbook');
  }

  const stored = await fileStorage.save('product', storedName, params.buffer, {
    prefix: existingDirectory,
  });

  const row = await db.queryOne<Record<string, unknown>>(
    `update product_files
      set original_name = $2,
          file_ext = $3,
          stored_name = $4,
          file_path = $5,
          logical_path = $6,
          file_size_bytes = $7,
          mime_type = $8,
          checksum = $9,
          storage_backend = $10,
          workbook_sheet_count = $11,
          workbook_row_count = $12,
          uploaded_by = $13,
          created_at = current_timestamp
    where id = $1
    returning *`,
    [
      params.fileId,
      originalName,
      ext.replace(/^\./, ''),
      stored.storedName,
      stored.filePath,
      String(existing.logical_path ?? canonicalProductFilePath(existingDirectory, originalName)),
      params.buffer.length,
      mimeType,
      checksum,
      stored.storageBackend,
      summary.sheetCount,
      summary.totalRowCount,
      uploadedBy,
    ],
  );

  if (!row) {
    throw new Error('Failed to update product file');
  }

  return {
    file: row,
    summary,
  };
}

export async function readLatestWorkflowDataFrameArtifact(
  db: AppDb,
  params: {
    workflowCode: string;
    taskId: string;
    fallbackSheetName: string;
    month?: string | null;
  },
): Promise<LatestWorkflowDataFrameArtifact | null> {
  const artifact = await db.queryOne<Record<string, unknown>>(
    `select artifact.metadata_json,
            file.id as file_id,
            file.original_name,
            file.stored_name,
            file.file_path,
            file.uploaded_by,
            file.created_at
       from workflow_run_artifacts artifact
       join workflow_runs run on run.id = artifact.run_id
       join product_files file on file.id = artifact.file_id
      where run.workflow_code = $1
        and run.status in ('completed', 'completed_with_warnings')
        and artifact.task_id = $2
        and artifact.artifact_type = 'file'
        and artifact.file_id is not null
        and ($3::text is null or run.runtime_parameters_json->>'month' = $3)
      order by run.finished_at desc nulls last, artifact.id desc
      limit 1`,
    [params.workflowCode, params.taskId, params.month?.trim() || null],
  );
  if (!artifact) return null;
  const metadata = parseJson<Record<string, unknown>>(artifact.metadata_json, {});
  const sheetName = workflowArtifactSheetName(metadata, params.fallbackSheetName);
  const buffer = await fileStorage.read(String(artifact.file_path));
  const preview = previewWorkbookSheet(buffer, sheetName, 5000);
  return {
    fileId: Number(artifact.file_id),
    fileName: productFileDisplayName(artifact),
    filePath: productFileDisplayPath(artifact),
    sheetName,
    columns: preview.columns,
    rows: preview.rows,
    buffer,
  };
}

export async function workflowSourceDescriptors(
  db: AppDb,
  workflowCode: string,
): Promise<WorkflowPageSourceDescriptor[]> {
  const row = await db.queryOne<Record<string, unknown>>(
    `select runtime_params_schema_json
       from workflow_definitions
      where code = $1
      order by (status = 'active') desc, id desc
      limit 1`,
    [workflowCode],
  );
  return sourcesFromWorkflowSchemaJson(row?.runtime_params_schema_json);
}

export async function monthlySourceDescriptors(db: AppDb): Promise<MonthlyRunSourceDefinition[]> {
  const row = await db.queryOne<Record<string, unknown>>(
    "select runtime_params_schema_json from workflow_definitions where code = $1 and status = 'active' limit 1",
    [MONTHLY_WORKFLOW_CODE],
  );
  return monthlySourcesFromSchema(row?.runtime_params_schema_json);
}

export async function monthlyRunInputSourceLabels(db: AppDb): Promise<Record<string, string>> {
  const sources = await monthlySourceDescriptors(db);
  return Object.fromEntries(sources.map((source) => [source.sourceKey, source.label]));
}

export async function pageWorkflowConfig(
  db: AppDb,
  pageKey: string,
  workflowCode: string,
): Promise<{
  pageKey: string;
  workflowCode: string;
  workflowName: string;
  description: string;
  sources: WorkflowPageSourceDescriptor[];
} | null> {
  const row = await db.queryOne<Record<string, unknown>>(
    "select name, description, runtime_params_schema_json from workflow_definitions where code = $1 and status = 'active' limit 1",
    [workflowCode],
  );
  if (!row) return null;
  return {
    pageKey,
    workflowCode,
    workflowName: String(row.name ?? ''),
    description: String(row.description ?? ''),
    sources: sourcesFromWorkflowSchemaJson(row.runtime_params_schema_json),
  };
}

export async function latestWorkflowInputSourceBindings(
  db: AppDb,
  workflowCode: string,
): Promise<WorkflowPageSourceBindingResponse[]> {
  const sources = await workflowSourceDescriptors(db, workflowCode);
  const row = await db.queryOne<Record<string, unknown>>(
    `select runtime_parameters_json
       from workflow_runs
      where workflow_code = $1
        and status in ('completed', 'completed_with_warnings')
      order by finished_at desc nulls last, id desc
      limit 1`,
    [workflowCode],
  );
  const runtimeParameters = parseJson(row?.runtime_parameters_json, {});
  const ids = sources
    .map((source) => productFileIdAtRuntimePath(runtimeParameters, `fileRefs.${source.sourceKey}`))
    .filter((fileId): fileId is number => fileId !== null);
  const keys = sources
    .map((source) => productFileKeyAtRuntimePath(runtimeParameters, `fileRefs.${source.sourceKey}`))
    .filter((fileKey): fileKey is string => fileKey !== null);
  const files =
    ids.length || keys.length
      ? await db.query<Record<string, unknown>>(
          'select * from product_files where id = any($1::int[]) or lower(logical_path) = any($2::text[])',
          [ids, keys.map((key) => key.toLowerCase())],
        )
      : [];
  const nameById = new Map(files.map((file) => [Number(file.id), productFileDisplayPath(file)]));
  const fileByKey = new Map(files.map((file) => [String(file.logical_path ?? '').toLowerCase(), file]));
  return sources.map((source) => {
    const runtimePath = `fileRefs.${source.sourceKey}`;
    const fileKey = productFileKeyAtRuntimePath(runtimeParameters, runtimePath);
    const keyedFile = fileKey ? fileByKey.get(fileKey.toLowerCase()) : undefined;
    const fileId =
      productFileIdAtRuntimePath(runtimeParameters, runtimePath) ?? (keyedFile ? Number(keyedFile.id) : null);
    const runtimeFileRef =
      isRecord(runtimeParameters) && isRecord(runtimeParameters.fileRefs)
        ? runtimeParameters.fileRefs[source.sourceKey]
        : undefined;
    const selectedSheet = isRecord(runtimeFileRef) ? String(runtimeFileRef.sheet ?? '').trim() : '';
    return {
      sourceKey: source.sourceKey,
      label: source.label,
      fileId,
      fileName: fileId ? nameById.get(fileId)?.trim() || null : null,
      sheet: selectedSheet || source.sheet || null,
    };
  });
}

export async function employeeLabelsByNumber(db: AppDb): Promise<Map<string, EmployeeLabelRef[]>> {
  const rows = await db.query<Record<string, unknown>>(
    `with employee_aliases as (
       select e.employee_id, coalesce(e.merged_into_id, e.id) as canonical_employee_id
         from employees e
        where btrim(coalesce(e.employee_id, '')) <> ''
     )
     select a.employee_id,
            coalesce(
              json_agg(json_build_object('id', l.id, 'name', l.name, 'color', l.color) order by l.name)
                filter (where l.id is not null),
              '[]'::json
            ) as labels
       from employee_aliases a
       left join employee_label_assignment ela on ela.employee_id = a.canonical_employee_id
       left join employee_label l on l.id = ela.label_id
      group by a.employee_id`,
  );
  return new Map(rows.map((row) => [String(row.employee_id ?? ''), parseEmployeeLabelRefs(row.labels)]));
}

export async function employeeCanonicalByNumber(db: AppDb): Promise<Map<string, number>> {
  const rows = await db.query<{ employee_id: string; canonical_id: number }>(
    `select employee_id, coalesce(merged_into_id, id) as canonical_id
       from employees
      where btrim(coalesce(employee_id, '')) <> ''`,
  );
  return new Map(rows.map((row) => [String(row.employee_id ?? ''), Number(row.canonical_id)]));
}

export async function employeeLinkGroupByNumber(
  db: AppDb,
): Promise<Map<string, Array<{ id: number; employeeId: string; source: string; name: string }>>> {
  const rows = await db.query<Record<string, unknown>>(
    `with aliases as (
       select e.id, e.employee_id, e.source, e.employee_name,
              coalesce(e.merged_into_id, e.id) as canonical_id
         from employees e
        where btrim(coalesce(e.employee_id, '')) <> ''
     )
     select a.employee_id,
            coalesce(
              json_agg(json_build_object('id', o.id, 'employeeId', o.employee_id, 'source', o.source, 'name', o.employee_name) order by o.id)
                filter (where o.id <> a.id),
              '[]'::json
            ) as linked
       from aliases a
       join aliases o on o.canonical_id = a.canonical_id
      group by a.employee_id`,
  );
  return new Map(rows.map((row) => [String(row.employee_id ?? ''), parseLinkedIdentities(row.linked)]));
}

export function eomForMonth(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  return `${year}/${month}/${new Date(year, month, 0).getDate()}`;
}

export function previousMonthKey(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  return month <= 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
}

export function parseLinkedIdentities(
  value: unknown,
): Array<{ id: number; employeeId: string; source: string; name: string }> {
  const arr = Array.isArray(value) ? value : [];
  return arr
    .map((item) => {
      const record = item as Record<string, unknown>;
      return {
        id: Number(record.id),
        employeeId: String(record.employeeId ?? ''),
        source: String(record.source ?? ''),
        name: String(record.name ?? ''),
      };
    })
    .filter((identity) => Number.isInteger(identity.id));
}

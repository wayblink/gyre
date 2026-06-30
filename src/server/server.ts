import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { z } from 'zod';
import { config } from './config.js';
import { createDb } from './db.js';
import {
  calculateSessionExpiry,
  createSession,
  createSessionToken,
  createUser,
  deleteSessionByHash,
  findSessionUserByTokenHash,
  findUserByUsername,
  getPublicAccount,
  hashPassword,
  hashSessionToken,
  hasAnyUsers,
  parseCookies,
  serializeCookie,
  toAuthStatus,
  touchSession,
  touchUserLastLogin,
  updateAccountPassword,
  updateAccountProfile,
  verifyPassword,
} from './auth.js';
import {
  dataFrameToWorkbookBuffer,
  extractSheetRangeAsDataFrame,
  parseWorkbook,
  previewWorkbookSheet,
  rowsToDataFrame,
  summarizeWorkbook,
} from './excel.js';
import {
  parseCapitalizationSummarySheet,
  summaryCapitalizationToWorkbookBuffer,
} from './summary/capitalizationWorkbook.js';
import { fileStorage } from './storage.js';
import {
  applyMonthlyRunPostProcessing,
  attachWorkflowRunToMonthlyHistory,
  createMonthlyRunHistory,
  getMonthlyRun,
  listMonthlyRuns,
  MONTHLY_WORKFLOW_CODE,
  reconcileMonthlyUpdatePlanStatuses,
} from './monthlyRun/store.js';
import {
  resolveMonthlyRunInputConfiguration,
  type ProductFileBindingLookup,
} from './monthlyRun/inputConfiguration.js';
import { monthlyWorkflowSelectionLabel, resolveMonthlyWorkflowDefinition } from './monthlyRun/workflowSelection.js';
import { MONTHLY_RUN_SOURCE_DEFINITIONS, MONTHLY_WORKFLOW_NAME } from './monthlyRun/workflowDefinition.js';
import { executeWorkflowTaskPreview } from './workflow/engine.js';
import { WorkflowFileSourceRegistry, productFileRef } from './workflow/fileSources.js';
import { normalizeWorkflowTaskInput } from './workflow/inputGuards.js';
import {
  normalizeWorkflowRuntimeParameters,
  normalizeWorkflowRuntimeParametersSchema,
  validateRuntimeParameters,
  resolveWorkflowRuntimeConfiguration,
} from './workflow/runtimeParameters.js';
import type { WorkflowOperatorRuntime } from './workflow/operators/types.js';
import { WorkflowRunExecutor, workflowRunToExecutionResult } from './workflow/runExecutor.js';
import { WorkflowRunStore } from './workflow/runStore.js';
import type {
  AuthStatus,
  FixedValueItem,
  MonthlyRunSourceConfigResponse,
  SourceCheckItem,
  SummarySnapshot,
  SummaryCapitalizationSource,
  WorkflowDataFrame,
  WorkflowImportExportBundle,
  WorkflowPortableDefinition,
  WorkflowRuntimeParameters,
  WorkflowTask,
} from '../shared/types.js';

const db = await createDb();
const app = Fastify({ logger: true });

type RequestWithAuth = {
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

function toIsoTimestamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
  }
  return new Date(String(value)).toISOString();
}

const updatePlanSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  remark: z.string().optional().default(''),
});

const updatePlanPatchSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  operator: z.string().min(1).optional(),
  status: z.enum(['待启动', '进行中', '待复核', '已完成', '失败', '已取消']).optional(),
  remark: z.string().optional(),
});

const metricPatchSchema = z.object({
  value: z.number().nullable().optional(),
  status: z.enum(['pass', 'warning', '']).optional(),
  uploadedFile: z.string().optional(),
});

const filePreviewQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

const fileSheetRangeQuerySchema = z.object({
  range: z.string().trim().min(1),
  headerRow: z.coerce.number().int().min(1).optional(),
});

const productFilePatchSchema = z.object({
  originalName: z.string().trim().min(1).max(255),
});

const workflowTaskPreviewBodySchema = z.object({
  workflowId: z.number().int().positive(),
  taskId: z.string().trim().min(1),
  tasks: z.array(z.any()).optional(),
  runtimeParamsSchema: z.record(z.string(), z.unknown()).optional(),
  runtimeParamsDefaults: z.record(z.string(), z.unknown()).optional(),
  runtimeParameters: z.record(z.string(), z.unknown()).optional(),
});

const workflowExecuteBodySchema = z.object({
  runtimeParameters: z.record(z.string(), z.unknown()).optional(),
  approvedWarningTaskIds: z.array(z.string().trim().min(1)).optional().default([]),
});

const workflowApprovalBodySchema = z.object({
  taskIds: z.array(z.string().trim().min(1)).optional(),
  taskId: z.string().trim().min(1).optional(),
  decision: z.enum(['approved', 'skipped']).optional().default('approved'),
});

const workflowRunRetryBodySchema = z.object({
  tasks: z.array(z.any()).optional(),
});

const monthlyRunListQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

const monthlyRunTriggerBodySchema = z.object({
  updatePlanId: z.number().int().positive().optional(),
  workflowId: z.number().int().positive().optional(),
  workflowCode: z.string().trim().min(1).optional(),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  sources: z.record(z.string(), z.object({ fileId: z.number().int().positive() })).optional(),
  operator: z.string().trim().min(1).optional().default('Administrator'),
});

const workflowPortableDefinitionSchema = z.object({
  code: z.string().trim().min(1),
  name: z.string().trim().min(1),
  description: z.string().optional().default(''),
  status: z.enum(['draft', 'active']).optional().default('draft'),
  version: z.number().int().min(1).optional().default(1),
  tasks: z.array(z.any()).optional().default([]),
  runtimeParamsSchema: z.record(z.string(), z.unknown()).optional().default({}),
  runtimeParamsDefaults: z.record(z.string(), z.unknown()).optional().default({}),
});

const workflowImportBundleSchema = z.object({
  format: z.literal('captable-workflow'),
  version: z.literal(1),
  exportedAt: z.string().optional(),
  workflow: workflowPortableDefinitionSchema,
});

const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
});

const authBootstrapSchema = z.object({
  username: z.string().trim().min(3).max(64),
  password: z.string().min(8).max(128),
  displayName: z.string().trim().min(1).max(64).optional(),
  bootstrapSecret: z.string().trim().optional(),
});

const authLoginSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(128),
});

const accountProfilePatchSchema = z.object({
  username: z.string().trim().min(1).max(80),
  displayName: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(255).nullable().optional().or(z.literal('')),
  phone: z.string().trim().max(50).nullable().optional(),
});

const accountPasswordPatchSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});

function isUniqueConstraintViolation(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === '23505';
}

function eomForMonth(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  return `${year}/${month}/${new Date(year, month, 0).getDate()}`;
}

function labelForMonth(monthKey: string): string {
  return monthKey;
}

function maskDatabaseUrl(databaseUrl: string): string {
  return databaseUrl.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:***@');
}

function sessionCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    maxAgeSeconds,
    path: '/',
    sameSite: 'Lax' as const,
    secure: false,
  };
}

function getSessionTokenFromRequest(request: { headers: Record<string, unknown> }): string | null {
  const rawCookie = request.headers.cookie;
  const cookies = parseCookies(typeof rawCookie === 'string' ? rawCookie : undefined);
  return cookies[config.sessionCookieName] ?? null;
}

async function resolveAuthUser(request: { headers: Record<string, unknown> }): Promise<RequestWithAuth['currentUser']> {
  const token = getSessionTokenFromRequest(request);
  if (!token) return null;
  const tokenHash = hashSessionToken(token);
  const user = await findSessionUserByTokenHash(db, tokenHash);
  if (!user) {
    await deleteSessionByHash(db, tokenHash);
    return null;
  }
  const expiresAt = calculateSessionExpiry(config.sessionTtlHours);
  await touchSession(db, { tokenHash, expiresAt });
  return {
    id: user.id,
    username: user.username,
    display_name: user.display_name,
    role: user.role,
    email: user.email,
    phone: user.phone,
    is_active: user.is_active,
    last_login_at: user.last_login_at,
  };
}

async function requireAuth(request: { headers: Record<string, unknown> } & RequestWithAuth, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) {
  request.currentUser = await resolveAuthUser(request);
  if (!request.currentUser) {
    return reply.code(401).send({ error: 'Authentication required', code: 'AUTH_REQUIRED' });
  }
}

async function currentAuthStatus(request: { headers: Record<string, unknown> }): Promise<AuthStatus> {
  const bootstrapRequired = !(await hasAnyUsers(db));
  const currentUser = await resolveAuthUser(request);
  return toAuthStatus(currentUser ?? null, bootstrapRequired);
}

async function getOrCreateMonth(monthKey: string): Promise<number> {
  const existing = await db.queryOne<{ id: number }>('select id from months where month_key = $1', [monthKey]);
  if (existing) return Number(existing.id);

  const row = await db.queryOne<{ id: number }>(
    'insert into months (month_key, eom_date) values ($1, $2) returning id',
    [monthKey, eomForMonth(monthKey)],
  );
  if (!row) throw new Error(`Failed to create month ${monthKey}`);
  return Number(row.id);
}

async function getMonth(
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

function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'object') return value as T;
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return fallback;
  }
}

function asBoolean(value: unknown): boolean {
  return value === true || value === 'true' || Number(value) === 1;
}

function parseTags(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function notFound(message: string) {
  const error = new Error(message) as Error & { statusCode?: number };
  error.statusCode = 404;
  return error;
}

function toUpdatePlan(row: Record<string, unknown>) {
  const month = String(row.month_key);
  return {
    id: Number(row.id),
    month,
    monthLabel: labelForMonth(month),
    operationTime: String(row.operation_time),
    operator: String(row.operator),
    status: String(row.status),
    remark: String(row.remark ?? ''),
  };
}

const FIXED_VALUE_EXPECTED_SOURCE_BY_ITEM: Record<string, string> = {
  EOM: 'EQ Control Book',
  '2025 BC Subplan shares transferred to Futu': 'EQ Control Book',
  'Σ all option plan outstanding shares': 'Option Plans Summary',
  'Σ all option plan available shares': 'Option Plans Summary',
  'Exercises to Date': 'Futu BCI Exercises to Date',
  'GYRE 2025 BC Subplan canceled': 'Futu BCI Exercises to Date',
};

const EXTRA_FIXED_VALUE_ITEMS = new Set([
  'EOM',
  '2025 BC Subplan shares transferred to Futu',
  'Σ all option plan outstanding shares',
  'Σ all option plan available shares',
  'Exercises to Date',
  'GYRE 2025 BC Subplan canceled',
]);

function checklistText(value: unknown): string {
  return String(value ?? '').trim();
}

function checklistSourceLabel(row: Record<string, unknown>, raw: Record<string, unknown>): string {
  const itemLabel = checklistText(raw.item ?? raw.metric ?? row.label);
  return (
    checklistText(raw.fileName) ||
    FIXED_VALUE_EXPECTED_SOURCE_BY_ITEM[itemLabel] ||
    checklistText(row.label) ||
    itemLabel
  );
}

function normalizeChecklistKey(value: unknown): string {
  return checklistText(value).toLowerCase();
}

function isMissingChecklistUpload(value: unknown): boolean {
  const text = normalizeChecklistKey(value);
  return !text || text === 'not uploaded';
}

function toChecklistItem(row: Record<string, unknown>, options: { forceFixed?: boolean } = {}): FixedValueItem | SourceCheckItem {
  const raw = parseJson<Record<string, unknown>>(row.raw_value, {});
  const label = checklistText(row.label);
  const itemLabel = checklistText(raw.item ?? raw.metric ?? label);
  const fallbackExpectedSource = checklistText(raw.fileName ?? row.display_file_name ?? row.uploaded_file) || '-';
  const value = row.normalized_value === null || row.normalized_value === undefined ? null : Number(row.normalized_value);
  const common = {
    id: Number(row.id),
    sourceFileId:
      row.display_source_file_id !== null && row.display_source_file_id !== undefined
        ? Number(row.display_source_file_id)
        : row.source_file_id === null || row.source_file_id === undefined
          ? null
          : Number(row.source_file_id),
    productFileId:
      row.display_product_file_id !== null && row.display_product_file_id !== undefined
        ? Number(row.display_product_file_id)
        : row.product_file_id === null || row.product_file_id === undefined
          ? null
          : Number(row.product_file_id),
    fileName: checklistText(row.display_file_name) || checklistSourceLabel(row, raw),
    isRequired: String(row.required ?? '') as 'Required' | 'Optional' | '',
    uploadedFile: checklistText(row.display_uploaded_file) || checklistText(row.uploaded_file ?? raw.uploadedFile),
    status: String(row.status ?? '') as 'pass' | 'warning' | '',
    value,
    action: (asBoolean(row.editable) ? 'edit' : '-') as 'edit' | '-',
  };

  if (row.source_group === 'fixed' || options.forceFixed) {
    const expectedSource = FIXED_VALUE_EXPECTED_SOURCE_BY_ITEM[itemLabel] ?? fallbackExpectedSource;
    return {
      id: common.id,
      item: itemLabel,
      note: expectedSource && expectedSource !== '-' ? `from ${expectedSource}` : '-',
      value: value ?? 0,
      action: 'edit',
    };
  }

  return {
    ...common,
    item: checklistText(raw.item),
    metric: checklistText(raw.metric),
  };
}

function mergeSourceChecklistItems(items: SourceCheckItem[]): SourceCheckItem[] {
  const grouped = new Map<string, SourceCheckItem[]>();
  for (const item of items) {
    const key = normalizeChecklistKey(item.fileName);
    const existing = grouped.get(key);
    if (existing) existing.push(item);
    else grouped.set(key, [item]);
  }

  return [...grouped.values()].map((group) => {
    const representative =
      group.find((item) => item.isRequired === 'Required') ??
      group.find((item) => item.productFileId || item.sourceFileId) ??
      group[0];
    const uploadedSource =
      group.find((item) => !isMissingChecklistUpload(item.uploadedFile) && (item.productFileId || item.sourceFileId)) ??
      group.find((item) => !isMissingChecklistUpload(item.uploadedFile)) ??
      representative;
    return {
      ...representative,
      isRequired: group.some((item) => item.isRequired === 'Required')
        ? 'Required'
        : group.some((item) => item.isRequired === 'Optional')
          ? 'Optional'
          : '',
      uploadedFile: uploadedSource.uploadedFile,
      productFileId: uploadedSource.productFileId ?? representative.productFileId,
      sourceFileId: uploadedSource.sourceFileId ?? representative.sourceFileId,
    };
  });
}

function toProductFile(row: Record<string, unknown>) {
  return {
    id: Number(row.id),
    originalName: String(row.original_name),
    storedName: String(row.stored_name),
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

function buildCapitalizationSource(
  monthRow: {
    capitalization_source_file_id: number | null;
    capitalization_source_sheet_name: string | null;
  },
  file?: Record<string, unknown>,
): SummaryCapitalizationSource | null {
  if (!monthRow.capitalization_source_file_id) return null;
  return {
    fileId: Number(monthRow.capitalization_source_file_id),
    fileName: file ? String(file.original_name ?? '') : null,
    sheetName: monthRow.capitalization_source_sheet_name ?? null,
  };
}

async function getProductFileOrThrow(id: number) {
  const file = await db.queryOne<Record<string, unknown>>('select * from product_files where id = $1', [id]);
  if (!file) throw notFound('Product file not found');
  return file;
}

async function checklistForPlan(updatePlanId: number) {
  const rows = await db.query<Record<string, unknown>>(
    `select sm.*,
            pf.original_name as product_file_name,
            sf.original_name as source_file_name
     from source_metrics sm
     left join product_files pf on pf.id = sm.product_file_id
     left join source_files sf on sf.id = sm.source_file_id
     where sm.update_plan_id = $1
     order by case sm.source_group when 'fixed' then 1 when 'shareworks' then 2 else 3 end, sm.sort_order`,
    [updatePlanId],
  );

  const displayRows = rows.map((row) => ({ ...row }));
  const uploadedBySource = new Map<
    string,
    { uploadedFile: string; productFileId: unknown; sourceFileId: unknown }
  >();

  for (const row of displayRows) {
    if (row.source_group !== 'shareworks' && row.source_group !== 'futu') continue;
    const raw = parseJson<Record<string, unknown>>(row.raw_value, {});
    const sourceLabel = checklistSourceLabel(row, raw);
    const uploadedFile =
      checklistText(row.uploaded_file) ||
      checklistText(row.product_file_name ?? row.source_file_name) ||
      checklistText(raw.uploadedFile);
    if (isMissingChecklistUpload(uploadedFile)) continue;
    uploadedBySource.set(normalizeChecklistKey(sourceLabel), {
      uploadedFile,
      productFileId: row.product_file_id,
      sourceFileId: row.source_file_id,
    });
  }

  for (const row of displayRows) {
    if (row.source_group !== 'shareworks' && row.source_group !== 'futu') continue;
    const raw = parseJson<Record<string, unknown>>(row.raw_value, {});
    const sourceLabel = checklistSourceLabel(row, raw);
    row.display_file_name = sourceLabel;

    const directUploadedFile =
      checklistText(row.uploaded_file) ||
      checklistText(row.product_file_name ?? row.source_file_name) ||
      checklistText(raw.uploadedFile);
    if (!isMissingChecklistUpload(directUploadedFile)) {
      row.display_uploaded_file = directUploadedFile;
      continue;
    }

    const inherited = uploadedBySource.get(normalizeChecklistKey(sourceLabel));
    if (!inherited) continue;
    row.display_uploaded_file = inherited.uploadedFile;
    row.display_product_file_id = inherited.productFileId;
    row.display_source_file_id = inherited.sourceFileId;
  }

  const isExtraFixedValueRow = (row: Record<string, unknown>) => {
    const raw = parseJson<Record<string, unknown>>(row.raw_value, {});
    const itemLabel = String(raw.item ?? raw.metric ?? row.label ?? '').trim();
    return EXTRA_FIXED_VALUE_ITEMS.has(itemLabel);
  };

  return {
    fixedValues: displayRows
      .filter((row) => row.source_group === 'fixed' || isExtraFixedValueRow(row))
      .map((row) => toChecklistItem(row, { forceFixed: true }) as FixedValueItem),
    shareworksData: mergeSourceChecklistItems(
      displayRows.filter((row) => row.source_group === 'shareworks').map((row) => toChecklistItem(row) as SourceCheckItem),
    ),
    futuData: mergeSourceChecklistItems(
      displayRows.filter((row) => row.source_group === 'futu').map((row) => toChecklistItem(row) as SourceCheckItem),
    ),
  };
}

async function copyDefaultMetrics(updatePlanId: number) {
  const templatePlan = await db.queryOne<{ id: number | null }>(
    'select min(id) as id from update_plans where id != $1',
    [updatePlanId],
  );
  if (!templatePlan?.id) return;

  const rows = await db.query<Record<string, unknown>>('select * from source_metrics where update_plan_id = $1 order by id', [
    templatePlan.id,
  ]);

  for (const row of rows) {
    await db.execute(
      `
      insert into source_metrics (
        update_plan_id, source_group, metric_key, label, required, sheet_name, cell_ref,
        range_ref, uploaded_file, raw_value, normalized_value, status, editable, sort_order
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, $14)
    `,
      [
        updatePlanId,
        row.source_group,
        row.metric_key,
        row.label,
        row.required,
        row.sheet_name,
        row.cell_ref,
        row.range_ref,
        row.uploaded_file,
        row.raw_value === null || row.raw_value === undefined ? null : JSON.stringify(row.raw_value),
        row.normalized_value,
        row.status,
        asBoolean(row.editable),
        row.sort_order,
      ],
    );
  }
}

async function settingRows(table: 'employee_mappings' | 'tracked_plans' | 'shareholder_tags') {
  return db.query<Record<string, unknown>>(`select * from ${table} order by id`);
}

function toHoldingGrant(row: Record<string, unknown>) {
  return {
    id: Number(row.id),
    employeeId: Number(row.employee_id),
    employeeName: String(row.employee_name ?? ''),
    employeeNumber: String(row.employee_number ?? ''),
    userId: row.user_id ? String(row.user_id) : null,
    tags: parseTags(row.tags),
    grantNumber: String(row.grant_number ?? ''),
    incentiveType: String(row.incentive_type ?? ''),
    grantDate: row.grant_date ? String(row.grant_date) : null,
    grantQuantity: row.grant_quantity === null || row.grant_quantity === undefined ? null : Number(row.grant_quantity),
    grantPriceUsd: row.grant_price_usd === null || row.grant_price_usd === undefined ? null : Number(row.grant_price_usd),
    expireDate: row.expire_date ? String(row.expire_date) : null,
    planName: row.plan_name ? String(row.plan_name) : null,
    conditionRule: row.condition_rule ? String(row.condition_rule) : null,
    employeePortalVisibility: row.employee_portal_visibility ? String(row.employee_portal_visibility) : null,
    closingPriceUsd: row.closing_price_usd === null || row.closing_price_usd === undefined ? null : Number(row.closing_price_usd),
    withholdingCost: row.withholding_cost ? String(row.withholding_cost) : null,
    taxCalculation: row.tax_calculation ? String(row.tax_calculation) : null,
    taxWithholding: row.tax_withholding ? String(row.tax_withholding) : null,
    fxSettlement: row.fx_settlement ? String(row.fx_settlement) : null,
    taxRule: row.tax_rule ? String(row.tax_rule) : null,
    cancellationConfirmDate: row.cancellation_confirm_date ? String(row.cancellation_confirm_date) : null,
    dataSource: row.data_source ? String(row.data_source) : null,
    vestingRuleName: row.vesting_rule_name ? String(row.vesting_rule_name) : null,
    vestingStartDate: row.vesting_start_date ? String(row.vesting_start_date) : null,
    vestedQuantity: row.vested_quantity === null || row.vested_quantity === undefined ? null : Number(row.vested_quantity),
    effectiveVestedQuantity:
      row.effective_vested_quantity === null || row.effective_vested_quantity === undefined ? null : Number(row.effective_vested_quantity),
    unvestedQuantity: row.unvested_quantity === null || row.unvested_quantity === undefined ? null : Number(row.unvested_quantity),
    vestedCancelledQuantity:
      row.vested_cancelled_quantity === null || row.vested_cancelled_quantity === undefined ? null : Number(row.vested_cancelled_quantity),
    unvestedCancelledQuantity:
      row.unvested_cancelled_quantity === null || row.unvested_cancelled_quantity === undefined ? null : Number(row.unvested_cancelled_quantity),
    exercisedQuantity: row.exercised_quantity === null || row.exercised_quantity === undefined ? null : Number(row.exercised_quantity),
    pendingExerciseQuantity:
      row.pending_exercise_quantity === null || row.pending_exercise_quantity === undefined ? null : Number(row.pending_exercise_quantity),
    outstandingQuantity:
      row.outstanding_quantity === null || row.outstanding_quantity === undefined ? null : Number(row.outstanding_quantity),
    sellableQuantity: row.sellable_quantity === null || row.sellable_quantity === undefined ? null : Number(row.sellable_quantity),
    relatedSaleOrderNumber: row.related_sale_order_number ? String(row.related_sale_order_number) : null,
    agreementInfo: row.agreement_info ? String(row.agreement_info) : null,
  };
}

function toEmployee(row: Record<string, unknown>) {
  return {
    id: Number(row.id),
    employeeNumber: String(row.employee_number ?? ''),
    employeeName: String(row.employee_name ?? ''),
    userId: row.user_id ? String(row.user_id) : null,
    tags: parseTags(row.tags),
    grantCount: Number(row.grant_count ?? 0),
  };
}

function toWorkflowOperator(row: Record<string, unknown>) {
  return {
    id: Number(row.id),
    code: String(row.code),
    name: String(row.name),
    version: String(row.version ?? '1.0.0'),
    category: String(row.category ?? 'General'),
    description: String(row.description ?? ''),
    inputSlots: parseJson(row.input_slots_json, []),
    outputSlots: parseJson(row.output_slots_json, []),
    paramsSchema: parseJson(row.params_schema_json, {}),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function toWorkflowDefinition(row: Record<string, unknown>) {
  return {
    id: Number(row.id),
    code: String(row.code),
    name: String(row.name),
    description: String(row.description ?? ''),
    status: String(row.status ?? 'draft') as 'draft' | 'active',
    version: Number(row.version ?? 1),
    tasks: normalizeWorkflowTasks(parseJson(row.tasks_json, [])),
    runtimeParamsSchema: normalizeWorkflowRuntimeParametersSchema(parseJson(row.runtime_params_schema_json, {})),
    runtimeParamsDefaults: normalizeWorkflowRuntimeParameters(parseJson(row.runtime_params_defaults_json, {})),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeWorkflowTask(value: unknown): WorkflowTask | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || typeof value.name !== 'string' || typeof value.operatorCode !== 'string') return null;
  const inputs: WorkflowTask['inputs'] = {};
  if (isRecord(value.inputs)) {
    for (const [slotName, input] of Object.entries(value.inputs)) {
      const normalizedSlotName = String(slotName ?? '').trim();
      if (!normalizedSlotName || !isRecord(input)) continue;
      inputs[normalizedSlotName] = normalizeWorkflowTaskInput(input);
    }
  }
  const inputSourceIds = new Set(
    Object.values(inputs)
      .map((input) => String(input.from ?? '').trim())
      .filter(Boolean),
  );
  const dependsOn = Array.isArray(value.dependsOn)
    ? Array.from(
        new Set(
          value.dependsOn
            .map((taskId) => String(taskId ?? '').trim())
            .filter((taskId) => taskId && taskId !== value.id && !inputSourceIds.has(taskId)),
        ),
      )
    : [];
  return {
    id: value.id,
    name: value.name,
    operatorCode: value.operatorCode,
    operatorVersion: typeof value.operatorVersion === 'string' ? value.operatorVersion : '1.0.0',
    description: typeof value.description === 'string' ? value.description : '',
    x: Number(value.x ?? 0),
    y: Number(value.y ?? 0),
    params: isRecord(value.params) ? value.params : {},
    inputs,
    dependsOn,
  };
}

function normalizeWorkflowTasks(value: unknown): WorkflowTask[] {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeWorkflowTask).filter((task): task is WorkflowTask => Boolean(task));
}

function toWorkflowPortableDefinition(workflow: unknown): WorkflowPortableDefinition {
  const source = workflow as Partial<WorkflowPortableDefinition>;
  return {
    code: String(source.code ?? '').trim(),
    name: String(source.name ?? '').trim(),
    description: String(source.description ?? ''),
    status: source.status === 'active' ? 'active' : 'draft',
    version: Number(source.version ?? 1),
    tasks: normalizeWorkflowTasks(source.tasks ?? []),
    runtimeParamsSchema: normalizeWorkflowRuntimeParametersSchema(source.runtimeParamsSchema),
    runtimeParamsDefaults: normalizeWorkflowRuntimeParameters(source.runtimeParamsDefaults),
  };
}

function toWorkflowImportExportBundle(workflow: WorkflowPortableDefinition): WorkflowImportExportBundle {
  return {
    format: 'captable-workflow',
    version: 1,
    exportedAt: new Date().toISOString(),
    workflow,
  };
}

function normalizeWorkflowRuntimeConfig(params: {
  runtimeParamsSchema: unknown;
  runtimeParamsDefaults: unknown;
}): { runtimeParamsSchema: Record<string, unknown>; runtimeParamsDefaults: WorkflowRuntimeParameters } {
  const runtimeParamsSchema = normalizeWorkflowRuntimeParametersSchema(params.runtimeParamsSchema);
  const runtimeParamsDefaults = normalizeWorkflowRuntimeParameters(params.runtimeParamsDefaults);
  validateRuntimeParameters(runtimeParamsDefaults, runtimeParamsSchema, '', { enforceRequired: false });
  return {
    runtimeParamsSchema,
    runtimeParamsDefaults,
  };
}

async function ensureUniqueWorkflowCode(baseCode: string): Promise<string> {
  const normalizedBase = baseCode.trim() || 'workflow-import';
  let candidate = normalizedBase;
  let suffix = 0;
  while (true) {
    const existing = await db.queryOne<{ id: number }>('select id from workflow_definitions where code = $1', [candidate]);
    if (!existing) return candidate;
    suffix += 1;
    candidate = suffix === 1 ? `${normalizedBase}-imported` : `${normalizedBase}-imported-${suffix}`;
  }
}

async function saveProductWorkbook(params: {
  originalName: string;
  buffer: Buffer;
  mimeType?: string;
  uploadedBy?: string;
  folderPrefix?: string;
}) {
  const mimeType =
    params.mimeType?.trim() ||
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const uploadedBy = params.uploadedBy?.trim() || 'Workflow';
  const checksum = crypto.createHash('sha256').update(params.buffer).digest('hex');
  const ext = path.extname(params.originalName).toLowerCase() || '.xlsx';
  const storedName = `${Date.now()}-${checksum.slice(0, 12)}${ext}`;
  const stored = await fileStorage.save('product', storedName, params.buffer, {
    prefix: params.folderPrefix,
  });
  const summary = summarizeWorkbook(params.buffer);

  const row = await db.queryOne<Record<string, unknown>>(
    `insert into product_files (
      original_name, stored_name, file_ext, file_path, file_size_bytes, mime_type, checksum,
      storage_backend, workbook_sheet_count, workbook_row_count, uploaded_by
    ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    returning *`,
    [
      params.originalName,
      stored.storedName,
      ext.replace(/^\./, ''),
      stored.filePath,
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

function normalizeFileMatchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function fileMatchTokens(value: string): string[] {
  return normalizeFileMatchText(value)
    .split(/\s+/)
    .filter((token) => token.length >= 2 && !/^\d+$/.test(token));
}

function fileNameMatchScore(candidate: string, target: string): number {
  const normalizedCandidate = normalizeFileMatchText(candidate);
  const normalizedTarget = normalizeFileMatchText(target);
  if (!normalizedCandidate || !normalizedTarget) return 0;
  if (normalizedCandidate === normalizedTarget) return 100;
  if (normalizedCandidate.includes(normalizedTarget) || normalizedTarget.includes(normalizedCandidate)) return 80;

  const targetTokens = fileMatchTokens(target);
  if (!targetTokens.length) return 0;
  const candidateTokens = new Set(fileMatchTokens(candidate));
  const matched = targetTokens.filter((token) => candidateTokens.has(token)).length;
  return matched / targetTokens.length;
}

async function productFileHasSheet(file: Record<string, unknown>, sheetName: string): Promise<boolean> {
  try {
    const buffer = await fileStorage.read(String(file.file_path));
    const summary = summarizeWorkbook(buffer);
    return summary.sheets.some((sheet) => sheet.sheetName.trim().toLowerCase() === sheetName.toLowerCase());
  } catch {
    return false;
  }
}

async function findProductFileForInputBinding(params: ProductFileBindingLookup): Promise<number | null> {
  const files = await db.query<Record<string, unknown>>('select id, original_name, file_path from product_files order by id desc');
  const uploadedFile = params.uploadedFile.trim();
  const sheetName = params.defaultSheetName?.trim() ?? '';

  if (uploadedFile) {
    const exact = files.find((file) => String(file.original_name).toLowerCase() === uploadedFile.toLowerCase());
    if (exact) return Number(exact.id);

    const scored = files
      .map((file) => ({ file, score: fileNameMatchScore(String(file.original_name), uploadedFile) }))
      .filter((item) => item.score >= 0.6)
      .sort((a, b) => b.score - a.score);
    if (scored[0]) return Number(scored[0].file.id);

    const current = params.currentProductFileId ? files.find((file) => Number(file.id) === params.currentProductFileId) : null;
    if (current && fileNameMatchScore(String(current.original_name), uploadedFile) >= 0.6) {
      return Number(current.id);
    }
    return null;
  }

  if (params.currentProductFileId) {
    const current = files.find((file) => Number(file.id) === params.currentProductFileId);
    if (current && (!sheetName || (await productFileHasSheet(current, sheetName)))) {
      return Number(current.id);
    }
  }

  if (!sheetName) return null;
  for (const file of files) {
    if (await productFileHasSheet(file, sheetName)) return Number(file.id);
  }
  return null;
}

async function updateProductWorkbook(params: {
  fileId: number;
  originalName: string;
  buffer: Buffer;
  mimeType?: string;
  uploadedBy?: string;
}) {
  const existing = await getProductFileOrThrow(params.fileId);
  const mimeType =
    params.mimeType?.trim() ||
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const uploadedBy = params.uploadedBy?.trim() || String(existing.uploaded_by ?? 'Administrator');
  const checksum = crypto.createHash('sha256').update(params.buffer).digest('hex');
  const ext = path.extname(params.originalName).toLowerCase() || '.xlsx';
  const summary = summarizeWorkbook(params.buffer);

  await fileStorage.save('product', String(existing.stored_name), params.buffer, {
    relativeFilePath: String(existing.file_path).replace(/^product\//, ''),
  });

  const row = await db.queryOne<Record<string, unknown>>(
    `update product_files
      set original_name = $2,
          file_ext = $3,
          file_size_bytes = $4,
          mime_type = $5,
          checksum = $6,
          workbook_sheet_count = $7,
          workbook_row_count = $8,
          uploaded_by = $9
    where id = $1
    returning *`,
    [
      params.fileId,
      params.originalName,
      ext.replace(/^\./, ''),
      params.buffer.length,
      mimeType,
      checksum,
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

const workflowFileSources = new WorkflowFileSourceRegistry();
workflowFileSources.register({
  provider: 'product-files',
  async read(ref) {
    const fileId = Number(ref.id);
    if (!Number.isInteger(fileId) || fileId <= 0) throw new Error('product-files source requires a positive id');
    const file = await getProductFileOrThrow(fileId);
    return fileStorage.read(String(file.file_path));
  },
});

const workflowOperatorRuntime: WorkflowOperatorRuntime = {
  extractSheetRangeAsDataFrame,
  rowsToDataFrame,
  dataFrameToWorkbookBuffer,
  readFile: (ref) => workflowFileSources.read(ref),
  async getProductFileBufferById(fileId) {
    return workflowFileSources.read(productFileRef(fileId));
  },
  async saveGeneratedWorkbook(params) {
    const saved = await saveProductWorkbook(params);
    return toProductFile(saved.file);
  },
};

const workflowRunStore = new WorkflowRunStore(db);
const workflowRunExecutor = new WorkflowRunExecutor(workflowRunStore, workflowOperatorRuntime, undefined, {
  onRunFinalized: (run) => applyMonthlyRunPostProcessing(db, run),
});

async function registerRoutes() {
  await app.register(cors, { origin: true });
  await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } });

  app.addHook('preHandler', async (request, reply) => {
    const url = request.raw.url ?? '';
    if (!url.startsWith('/api/')) return;
    if (url === '/api/health') return;
    if (url.startsWith('/api/auth/')) return;
    return requireAuth(request as typeof request & RequestWithAuth, reply);
  });

  app.get('/api/health', async () => ({
    ok: true,
    service: 'gyre-captable',
    database: maskDatabaseUrl(config.databaseUrl),
    excel: 'xlsx@0.18.x',
  }));

  app.get('/api/auth/status', async (request) => currentAuthStatus(request));

  app.post('/api/auth/bootstrap', async (request, reply) => {
    const body = authBootstrapSchema.parse(request.body ?? {});
    const bootstrapRequired = !(await hasAnyUsers(db));
    if (!bootstrapRequired) {
      return reply.code(409).send({ error: 'Bootstrap already completed' });
    }
    if (config.authBootstrapSecret && body.bootstrapSecret !== config.authBootstrapSecret) {
      return reply.code(403).send({ error: 'Invalid bootstrap secret' });
    }

    const user = await createUser(db, {
      username: body.username,
      passwordHash: await hashPassword(body.password),
      displayName: body.displayName?.trim() || body.username,
      role: 'admin',
    });
    const sessionToken = createSessionToken();
    await createSession(db, {
      userId: user.id,
      sessionTokenHash: hashSessionToken(sessionToken),
      expiresAt: calculateSessionExpiry(config.sessionTtlHours),
    });
    await touchUserLastLogin(db, user.id);

    reply.header(
      'Set-Cookie',
      serializeCookie(
        config.sessionCookieName,
        sessionToken,
        sessionCookieOptions(config.sessionTtlHours * 60 * 60),
      ),
    );

    return reply.code(201).send(
      toAuthStatus(
        {
          ...user,
          is_active: true,
        },
        false,
      ),
    );
  });

  app.post('/api/auth/login', async (request, reply) => {
    const body = authLoginSchema.parse(request.body ?? {});
    const user = await findUserByUsername(db, body.username);
    if (!user || !user.is_active || !(await verifyPassword(body.password, user.password_hash))) {
      return reply.code(401).send({ error: 'Invalid username or password' });
    }

    const sessionToken = createSessionToken();
    await createSession(db, {
      userId: user.id,
      sessionTokenHash: hashSessionToken(sessionToken),
      expiresAt: calculateSessionExpiry(config.sessionTtlHours),
    });
    await touchUserLastLogin(db, user.id);

    reply.header(
      'Set-Cookie',
      serializeCookie(
        config.sessionCookieName,
        sessionToken,
        sessionCookieOptions(config.sessionTtlHours * 60 * 60),
      ),
    );

    return toAuthStatus(
      {
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        role: user.role,
        email: user.email,
        phone: user.phone,
        is_active: user.is_active,
        last_login_at: user.last_login_at,
      },
      false,
    );
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const token = getSessionTokenFromRequest(request);
    if (token) {
      await deleteSessionByHash(db, hashSessionToken(token));
    }
    reply.header(
      'Set-Cookie',
      serializeCookie(config.sessionCookieName, '', sessionCookieOptions(0)),
    );
    return reply.code(204).send();
  });

  app.get('/api/account', async (request) => {
    const user = (request as typeof request & RequestWithAuth).currentUser;
    if (!user) throw new Error('Authentication required');
    const account = await getPublicAccount(db, user.id);
    if (!account) throw new Error('Account not found');
    return { account };
  });

  app.patch('/api/account', async (request, reply) => {
    const user = (request as typeof request & RequestWithAuth).currentUser;
    if (!user) throw new Error('Authentication required');
    const body = accountProfilePatchSchema.parse(request.body ?? {});
    try {
      const account = await updateAccountProfile(db, user.id, {
        username: body.username,
        displayName: body.displayName,
        email: body.email || null,
        phone: body.phone || null,
      });
      return { account };
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        return reply.code(409).send({ error: '账号名已存在' });
      }
      throw error;
    }
  });

  app.patch('/api/account/password', async (request, reply) => {
    const user = (request as typeof request & RequestWithAuth).currentUser;
    if (!user) throw new Error('Authentication required');
    const body = accountPasswordPatchSchema.parse(request.body ?? {});
    try {
      await updateAccountPassword(db, user.id, body);
      return reply.code(204).send();
    } catch (error) {
      if ((error as Error).message === 'Current password is incorrect') {
        return reply.code(400).send({ error: 'Current password is incorrect' });
      }
      throw error;
    }
  });

  app.get('/api/months', async () => {
    const rows = await db.query('select month_key as month, eom_date as "eomDate", status from months order by month_key desc');
    return { months: rows };
  });

  app.get('/api/monthly-runs', async (request) => {
    const query = monthlyRunListQuerySchema.parse(request.query);
    return { items: await listMonthlyRuns(db, query) };
  });

  app.get('/api/monthly-runs/source-config', async (): Promise<MonthlyRunSourceConfigResponse> => ({
    workflowCode: MONTHLY_WORKFLOW_CODE,
    workflowName: MONTHLY_WORKFLOW_NAME,
    sources: MONTHLY_RUN_SOURCE_DEFINITIONS,
  }));

  app.get('/api/monthly-runs/:id', async (request) => {
    const runId = Number((request.params as { id: string }).id);
    const history = await getMonthlyRun(db, runId);
    if (!history) throw notFound('Monthly run not found');
    return history;
  });

  app.post('/api/monthly-runs', async (request, reply) => {
    const body = monthlyRunTriggerBodySchema.parse(request.body ?? {});
    const inputConfiguration = body.updatePlanId
      ? await resolveMonthlyRunInputConfiguration(
          db,
          body.updatePlanId,
          async (params) => {
            const buffer = await fileStorage.read(params.filePath);
            const saved = await saveProductWorkbook({
              originalName: params.originalName,
              buffer,
              mimeType: params.mimeType,
              uploadedBy: params.uploadedBy,
              folderPrefix: params.folderPrefix,
            });
            return Number(saved.file.id);
          },
          findProductFileForInputBinding,
        )
      : null;
    if (!inputConfiguration && !body.month) {
      throw new Error('month is required when updatePlanId is not provided');
    }
    if (!inputConfiguration && !body.sources) {
      throw new Error('sources are required when updatePlanId is not provided');
    }

    const resolvedRuntimeParameters: WorkflowRuntimeParameters = inputConfiguration
        ? inputConfiguration.runtimeParameters
        : {
            month: body.month as string,
            fileRefs: Object.fromEntries(
              await Promise.all(
                MONTHLY_RUN_SOURCE_DEFINITIONS.filter((source) => source.required).map(async (source) => {
                  const binding = body.sources?.[source.sourceKey];
                  if (!binding) throw new Error(`Missing source binding: ${source.sourceKey}`);
                  await getProductFileOrThrow(binding.fileId);
                  return [source.sourceKey, productFileRef(binding.fileId)] as const;
                }),
              ),
            ),
          };

    const monthKey = String(resolvedRuntimeParameters.month);
    const monthId = await getOrCreateMonth(monthKey);
    const workflowRow = await resolveMonthlyWorkflowDefinition(db, {
      workflowId: body.workflowId,
      workflowCode: body.workflowCode,
    });
    if (!workflowRow) throw notFound(`Workflow ${monthlyWorkflowSelectionLabel(body)} not found`);

    const storedTasks = normalizeWorkflowTasks(parseJson(workflowRow.tasks_json, []));
    const runtimeConfiguration = resolveWorkflowRuntimeConfiguration({
      tasks: storedTasks,
      runtimeParamsSchema: parseJson(workflowRow.runtime_params_schema_json, {}),
      runtimeParamsDefaults: parseJson(workflowRow.runtime_params_defaults_json, {}),
      runtimeParameters: resolvedRuntimeParameters,
    });

    const runtimeFileRefs = runtimeConfiguration.runtimeParameters.fileRefs;
    const primarySourceFileId =
      inputConfiguration?.primarySourceFileId ??
      (runtimeFileRefs && typeof runtimeFileRefs === 'object' && !Array.isArray(runtimeFileRefs)
        ? Number(
            ((runtimeFileRefs as Record<string, unknown>).control_book as Record<string, unknown> | undefined)?.id ??
              ((Object.values(runtimeFileRefs)[0] as Record<string, unknown> | undefined)?.id ?? null),
          )
        : null);
    const history = await createMonthlyRunHistory(db, {
      monthId,
      monthKey,
      updatePlanId: body.updatePlanId ?? null,
      workflowId: Number(workflowRow.id),
      sourceFileId: primarySourceFileId && Number.isInteger(primarySourceFileId) ? primarySourceFileId : null,
      operator: inputConfiguration?.operator ?? body.operator,
      runtimeParameters: runtimeConfiguration.runtimeParameters,
    });
    const workflowRun = await workflowRunStore.createRun({
      workflow: workflowRow,
      tasks: runtimeConfiguration.tasks,
      runtimeParameters: runtimeConfiguration.runtimeParameters,
    });
    const attachedHistory = await attachWorkflowRunToMonthlyHistory(db, {
      historyId: history.id,
      workflowRunId: workflowRun.id,
    });

    workflowRunExecutor.startAsync(workflowRun.id);
    return reply.code(201).send({
      history: attachedHistory,
      executionResult: workflowRunToExecutionResult(await workflowRunStore.getRun(workflowRun.id)),
    });
  });

  app.post('/api/monthly-runs/:id/approvals', async (request) => {
    const historyId = Number((request.params as { id: string }).id);
    const history = await getMonthlyRun(db, historyId);
    if (!history) throw notFound('Monthly run not found');
    if (!history.workflowRunId) throw new Error('Monthly run has no workflow run attached');
    const body = workflowApprovalBodySchema.parse(request.body ?? {});
    const taskIds = body.taskIds?.length ? body.taskIds : body.taskId ? [body.taskId] : [];
    if (!taskIds.length) {
      throw new Error('At least one approval task id is required');
    }
    const run = await workflowRunExecutor.continueAfterApproval(history.workflowRunId, taskIds, body.decision);
    return workflowRunToExecutionResult(run);
  });

  app.delete('/api/monthly-runs/:id', async (request, reply) => {
    const historyId = Number((request.params as { id: string }).id);
    const history = await getMonthlyRun(db, historyId);
    if (!history) throw notFound('Monthly run not found');
    await db.execute('delete from monthly_run_history where id = $1', [historyId]);
    return reply.code(204).send();
  });

  app.get('/api/files', async () => {
    const rows = await db.query<Record<string, unknown>>('select * from product_files order by created_at desc, id desc');
    return { files: rows.map(toProductFile) };
  });

  app.post('/api/files/upload', async (request, reply) => {
    let uploadedBy = 'Administrator';
    let folderPrefix: string | undefined;
    let uploaded: { fileName: string; buffer: Buffer; mimeType: string } | null = null;

    for await (const part of request.parts()) {
      if (part.type === 'file') {
        uploaded = {
          fileName: part.filename,
          buffer: await part.toBuffer(),
          mimeType: part.mimetype,
        };
      } else if (part.fieldname === 'uploadedBy' && typeof part.value === 'string' && part.value.trim()) {
        uploadedBy = part.value.trim();
      } else if (part.fieldname === 'folderPrefix' && typeof part.value === 'string' && part.value.trim()) {
        folderPrefix = part.value.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
      }
    }

    if (!uploaded) return reply.code(400).send({ error: 'No file uploaded' });
    if (!/\.(xlsx|xls|csv)$/i.test(uploaded.fileName)) {
      return reply.code(400).send({ error: 'Only .xlsx, .xls, and .csv files are supported' });
    }

    const saved = await saveProductWorkbook({
      originalName: uploaded.fileName,
      buffer: uploaded.buffer,
      mimeType: uploaded.mimeType,
      uploadedBy,
      folderPrefix,
    });

    return reply.code(201).send({
      file: toProductFile(saved.file),
      sheets: saved.summary.sheets,
    });
  });

  app.get('/api/files/:id', async (request) => {
    const { id } = request.params as { id: string };
    const file = await getProductFileOrThrow(Number(id));
    const buffer = await fileStorage.read(String(file.file_path));
    const summary = summarizeWorkbook(buffer);
    return {
      file: toProductFile(file),
      sheets: summary.sheets,
    };
  });

  app.patch('/api/files/:id', async (request) => {
    const { id } = request.params as { id: string };
    const fileId = Number(id);
    await getProductFileOrThrow(fileId);
    const body = productFilePatchSchema.parse(request.body ?? {});
    const row = await db.queryOne<Record<string, unknown>>(
      `update product_files
          set original_name = $2
        where id = $1
        returning *`,
      [fileId, body.originalName],
    );
    if (!row) throw notFound('Product file not found');
    return { file: toProductFile(row) };
  });

  app.get('/api/files/:id/content', async (request, reply) => {
    const { id } = request.params as { id: string };
    const file = await getProductFileOrThrow(Number(id));
    const buffer = await fileStorage.read(String(file.file_path));

    reply
      .header('Content-Type', String(file.mime_type ?? 'application/octet-stream'))
      .header('Content-Length', String(buffer.length))
      .header('Content-Disposition', `inline; filename="${encodeURIComponent(String(file.original_name ?? 'workbook.xlsx'))}"`);

    return reply.send(buffer);
  });

  app.put('/api/files/:id/content', async (request, reply) => {
    const { id } = request.params as { id: string };
    const fileId = Number(id);
    await getProductFileOrThrow(fileId);

    let uploadedBy = 'Administrator';
    let uploaded: { fileName: string; buffer: Buffer; mimeType: string } | null = null;

    for await (const part of request.parts()) {
      if (part.type === 'file') {
        uploaded = {
          fileName: part.filename,
          buffer: await part.toBuffer(),
          mimeType: part.mimetype,
        };
      } else if (part.fieldname === 'uploadedBy' && typeof part.value === 'string' && part.value.trim()) {
        uploadedBy = part.value.trim();
      }
    }

    if (!uploaded) return reply.code(400).send({ error: 'No file uploaded' });
    if (!/\.(xlsx|xls|csv)$/i.test(uploaded.fileName)) {
      return reply.code(400).send({ error: 'Only .xlsx, .xls, and .csv files are supported' });
    }

    const saved = await updateProductWorkbook({
      fileId,
      originalName: uploaded.fileName,
      buffer: uploaded.buffer,
      mimeType: uploaded.mimeType,
      uploadedBy,
    });

    return reply.send({
      file: toProductFile(saved.file),
      sheets: saved.summary.sheets,
    });
  });

  app.get('/api/files/:id/sheets/:sheetName', async (request) => {
    const { id, sheetName } = request.params as { id: string; sheetName: string };
    const query = filePreviewQuerySchema.parse(request.query ?? {});
    const file = await getProductFileOrThrow(Number(id));
    const buffer = await fileStorage.read(String(file.file_path));
    return previewWorkbookSheet(buffer, sheetName, query.limit, query.offset);
  });

  app.get('/api/files/:id/sheets/:sheetName/range', async (request) => {
    const { id, sheetName } = request.params as { id: string; sheetName: string };
    const query = fileSheetRangeQuerySchema.parse(request.query ?? {});
    const file = await getProductFileOrThrow(Number(id));
    const buffer = await fileStorage.read(String(file.file_path));
    return extractSheetRangeAsDataFrame(buffer, sheetName, {
      range: query.range,
      headerRow: query.headerRow,
    });
  });

  app.delete('/api/files/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const fileId = Number(id);
    const file = await getProductFileOrThrow(fileId);
    await fileStorage.remove(String(file.file_path));
    await db.execute('delete from product_files where id = $1', [fileId]);
    return reply.code(204).send();
  });

  app.get('/api/months/:month/summary', async (request, reply) => {
    const { month } = request.params as { month: string };
    const monthRow = await getMonth(month);
    if (!monthRow) return reply.code(404).send({ error: `Month ${month} not found` });

    const snapshot = await db.queryOne<{ summary_json: unknown; formula_trace_json: unknown }>(
      'select summary_json, formula_trace_json from calculation_snapshots where month_id = $1 and status = $2',
      [monthRow.id, 'current'],
    );
    const notes = await db.query<{ id: number; time: string; content: string }>(
      'select id, created_at as time, content from notes where month_id = $1 order by id desc',
      [monthRow.id],
    );
    const summary = parseJson<Record<string, unknown>>(snapshot?.summary_json, {});
    let sourceFile: Record<string, unknown> | undefined;
    let capitalizationOverride: Pick<SummarySnapshot, 'capitalization' | 'totalFullyDiluted'> | null = null;

    if (monthRow.capitalization_source_file_id) {
      sourceFile = await db.queryOne<Record<string, unknown>>('select * from product_files where id = $1', [
        monthRow.capitalization_source_file_id,
      ]);
      if (sourceFile) {
        const buffer = await fileStorage.read(String(sourceFile.file_path));
        const parsed = parseCapitalizationSummarySheet(buffer, monthRow.capitalization_source_sheet_name);
        capitalizationOverride = {
          capitalization: parsed.capitalization,
          totalFullyDiluted: parsed.totalFullyDiluted,
        };

        if (!monthRow.capitalization_source_sheet_name || monthRow.capitalization_source_sheet_name !== parsed.resolvedSheetName) {
          await db.execute(
            'update months set capitalization_source_sheet_name = $2, updated_at = current_timestamp where id = $1',
            [monthRow.id, parsed.resolvedSheetName],
          );
          monthRow.capitalization_source_sheet_name = parsed.resolvedSheetName;
        }
      }
    }

    const fallbackSummary: SummarySnapshot = {
      month,
      eomDate: monthRow.eom_date,
      reconciliation: {
        item: 'No snapshot data',
        lastMonth: 0,
        newShares: 0,
        eomBalance: 0,
      },
      capitalization: [],
      totalFullyDiluted: 0,
      formulaTrace: {},
      notes: [],
    };

    const responseSummary: SummarySnapshot = {
      ...fallbackSummary,
      ...summary,
      month,
      eomDate: String(summary.eomDate ?? monthRow.eom_date),
      ...(capitalizationOverride ?? {}),
      formulaTrace: parseJson(snapshot?.formula_trace_json, {}),
      notes,
      capitalizationSource: buildCapitalizationSource(monthRow, sourceFile),
    };

    return responseSummary;
  });

  app.put('/api/months/:month/capitalization-source', async (request, reply) => {
    const { month } = request.params as { month: string };
    const monthRow = await getMonth(month);
    if (!monthRow) return reply.code(404).send({ error: `Month ${month} not found` });

    const body = z
      .object({
        fileId: z.number().int().positive().nullable(),
        sheetName: z.string().trim().max(255).nullable().optional(),
      })
      .parse(request.body);

    let sourceFile: Record<string, unknown> | undefined;
    let resolvedSheetName: string | null = body.sheetName?.trim() || null;

    if (body.fileId !== null) {
      sourceFile = await getProductFileOrThrow(body.fileId);
      const buffer = await fileStorage.read(String(sourceFile.file_path));
      const parsed = parseCapitalizationSummarySheet(buffer, resolvedSheetName);
      resolvedSheetName = parsed.resolvedSheetName;
    }

    await db.execute(
      `update months
       set capitalization_source_file_id = $2,
           capitalization_source_sheet_name = $3,
           updated_at = current_timestamp
       where id = $1`,
      [monthRow.id, body.fileId, resolvedSheetName],
    );

    return {
      source: buildCapitalizationSource(
        {
          capitalization_source_file_id: body.fileId,
          capitalization_source_sheet_name: resolvedSheetName,
        },
        sourceFile,
      ),
    };
  });

  app.post('/api/months/:month/capitalization-summary-file', async (request, reply) => {
    const { month } = request.params as { month: string };
    const monthRow = await getMonth(month);
    if (!monthRow) return reply.code(404).send({ error: `Month ${month} not found` });

    const snapshot = await db.queryOne<{ summary_json: unknown }>(
      'select summary_json from calculation_snapshots where month_id = $1 and status = $2',
      [monthRow.id, 'current'],
    );
    if (!snapshot) return reply.code(404).send({ error: `No summary snapshot for ${month}` });

    const summary = parseJson<SummarySnapshot>(snapshot.summary_json, {
      month,
      eomDate: monthRow.eom_date,
      reconciliation: {
        item: '',
        lastMonth: 0,
        newShares: 0,
        eomBalance: 0,
      },
      capitalization: [],
      totalFullyDiluted: 0,
      formulaTrace: {},
      notes: [],
    });

    const normalizedSummary: SummarySnapshot = {
      ...summary,
      month,
      eomDate: summary.eomDate || monthRow.eom_date,
      notes: Array.isArray(summary.notes) ? summary.notes : [],
      capitalization: Array.isArray(summary.capitalization) ? summary.capitalization : [],
    };

    const buffer = summaryCapitalizationToWorkbookBuffer(normalizedSummary);
    const saved = await saveProductWorkbook({
      originalName: `Capitalization_Table_Summary_View_${month}.xlsx`,
      buffer,
      uploadedBy: 'Summary Export',
    });

    return reply.code(201).send({
      file: toProductFile(saved.file),
      sheets: saved.summary.sheets,
    });
  });

  app.post('/api/months/:month/notes', async (request, reply) => {
    const { month } = request.params as { month: string };
    const body = z.object({ content: z.string().min(1) }).parse(request.body);
    const monthId = await getOrCreateMonth(month);
    const note = await db.queryOne(
      'insert into notes (month_id, content) values ($1, $2) returning id, created_at as time, content',
      [monthId, body.content],
    );
    return reply.code(201).send(note);
  });

  app.delete('/api/notes/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    await db.execute('delete from notes where id = $1', [Number(id)]);
    return reply.code(204).send();
  });

  app.get('/api/update-plans', async (request) => {
    const { month } = request.query as { month?: string };
    await reconcileMonthlyUpdatePlanStatuses(db);
    const rows = await db.query<Record<string, unknown>>(
      `select up.*, m.month_key
       from update_plans up
       join months m on m.id = up.month_id
       where ($1::text is null or m.month_key = $1)
       order by m.month_key desc, up.id desc`,
      [month ?? null],
    );
    return { plans: rows.map(toUpdatePlan) };
  });

  app.get('/api/update-plans/:id', async (request) => {
    const { id } = request.params as { id: string };
    await reconcileMonthlyUpdatePlanStatuses(db);
    const row = await db.queryOne<Record<string, unknown>>(
      `select up.*, m.month_key
       from update_plans up
       join months m on m.id = up.month_id
       where up.id = $1`,
      [Number(id)],
    );
    if (!row) throw notFound('Update plan not found');
    return toUpdatePlan(row);
  });

  app.post('/api/update-plans', async (request, reply) => {
    const currentUser = (request as typeof request & RequestWithAuth).currentUser;
    if (!currentUser) throw new Error('Authentication required');
    const body = updatePlanSchema.parse(request.body);
    const row = await db.queryOne<{ id: number }>(
      `insert into update_plans (month_id, operation_time, operator, status, remark)
       values ($1, $2, $3, $4, $5)
       returning id`,
      [await getOrCreateMonth(body.month), new Date().toLocaleDateString('zh-CN'), currentUser.username, '待启动', body.remark],
    );
    if (!row) throw new Error('Failed to create update plan');

    const id = Number(row.id);
    await copyDefaultMetrics(id);
    const plan = await db.queryOne<Record<string, unknown>>(
      `select up.*, m.month_key from update_plans up join months m on m.id = up.month_id where up.id = $1`,
      [id],
    );
    if (!plan) throw notFound('Update plan not found');
    return reply.code(201).send(toUpdatePlan(plan));
  });

  app.patch('/api/update-plans/:id', async (request) => {
    const { id } = request.params as { id: string };
    const planId = Number(id);
    const body = updatePlanPatchSchema.parse(request.body);
    const existing = await db.queryOne<Record<string, unknown>>('select * from update_plans where id = $1', [planId]);
    if (!existing) throw notFound('Update plan not found');

    const monthId = body.month ? await getOrCreateMonth(body.month) : Number(existing.month_id);
    await db.execute(
      `update update_plans
       set month_id = $1, operator = $2, status = $3, remark = $4, updated_at = current_timestamp
       where id = $5`,
      [
        monthId,
        body.operator ?? existing.operator,
        body.status ?? existing.status,
        body.remark ?? existing.remark,
        planId,
      ],
    );
    const row = await db.queryOne<Record<string, unknown>>(
      `select up.*, m.month_key from update_plans up join months m on m.id = up.month_id where up.id = $1`,
      [planId],
    );
    if (!row) throw notFound('Update plan not found');
    return toUpdatePlan(row);
  });

  app.delete('/api/update-plans/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    await db.execute('delete from update_plans where id = $1', [Number(id)]);
    return reply.code(204).send();
  });

  app.get('/api/update-plans/:id/checklist', async (request) => {
    const { id } = request.params as { id: string };
    return checklistForPlan(Number(id));
  });

  app.patch('/api/source-metrics/:id', async (request) => {
    const { id } = request.params as { id: string };
    const metricId = Number(id);
    const body = metricPatchSchema.parse(request.body);
    const existing = await db.queryOne<Record<string, unknown>>('select * from source_metrics where id = $1', [metricId]);
    if (!existing) throw notFound('Source metric not found');
    const row = await db.queryOne(
      `update source_metrics
       set normalized_value = $1,
           status = $2,
           uploaded_file = $3,
           source_file_id = case when $3 in ('', 'Not uploaded') then null else source_file_id end,
           product_file_id = case when $3 in ('', 'Not uploaded') then null else product_file_id end
       where id = $4
       returning *`,
      [
        body.value === undefined ? existing.normalized_value : body.value,
        body.status === undefined ? existing.status : body.status,
        body.uploadedFile === undefined ? existing.uploaded_file : body.uploadedFile,
        metricId,
      ],
    );
    return row;
  });

  app.post('/api/update-plans/:id/source-files', async (request, reply) => {
    const { id } = request.params as { id: string };
    const updatePlanId = Number(id);
    let sourceGroup = 'unknown';
    let metricId: number | null = null;
    let uploaded: { fileName: string; buffer: Buffer; mimeType: string } | null = null;

    for await (const part of request.parts()) {
      if (part.type === 'file') {
        uploaded = {
          fileName: part.filename,
          buffer: await part.toBuffer(),
          mimeType: part.mimetype,
        };
      } else if (part.fieldname === 'sourceGroup') {
        sourceGroup = String(part.value);
      } else if (part.fieldname === 'metricId') {
        metricId = Number(part.value);
      }
    }

    if (!uploaded) return reply.code(400).send({ error: 'No file uploaded' });
    const checksum = crypto.createHash('sha256').update(uploaded.buffer).digest('hex');
    const safeName = `${Date.now()}-${uploaded.fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const stored = await fileStorage.save('source', safeName, uploaded.buffer);

    const parsedRows = parseWorkbook(uploaded.buffer);
    const savedProductFile = await saveProductWorkbook({
      originalName: uploaded.fileName,
      buffer: uploaded.buffer,
      mimeType: uploaded.mimeType,
      uploadedBy: 'Input Configuration',
      folderPrefix: `sources/${updatePlanId}`,
    });
    const productFileId = Number(savedProductFile.file.id);

    const sourceFileId = await db.transaction(async (client) => {
      const fileRow = await client.queryOne<{ id: number }>(
        `insert into source_files (
          update_plan_id, source_type, file_name, original_name, file_path, storage_backend, checksum, size_bytes
        ) values ($1, $2, $3, $4, $5, $6, $7, $8)
        returning id`,
        [
          updatePlanId,
          sourceGroup,
          safeName,
          uploaded.fileName,
          stored.filePath,
          stored.storageBackend,
          checksum,
          uploaded.buffer.length,
        ],
      );
      if (!fileRow) throw new Error('Failed to create source file');

      for (const row of parsedRows) {
        await client.execute(
          'insert into source_rows (source_file_id, sheet_name, row_index, row_json) values ($1, $2, $3, $4::jsonb)',
          [fileRow.id, row.sheetName, row.rowIndex, JSON.stringify(row.row)],
        );
      }

      if (metricId) {
        await client.execute(
          `update source_metrics
           set source_file_id = $1, product_file_id = $2, uploaded_file = $3, status = 'pass'
           where id = $4 and update_plan_id = $5`,
          [fileRow.id, productFileId, uploaded.fileName, metricId, updatePlanId],
        );
      }

      return Number(fileRow.id);
    });

    return reply.code(201).send({
      id: sourceFileId,
      productFileId,
      originalName: uploaded.fileName,
      checksum,
      rowCount: parsedRows.length,
    });
  });

  app.post('/api/update-plans/:id/generate-snapshot', async (request) => {
    const { id } = request.params as { id: string };
    const planId = Number(id);
    await db.execute(
      `update update_plans
       set status = '已完成', operation_time = $1, updated_at = current_timestamp
       where id = $2`,
      [new Date().toLocaleDateString('zh-CN'), planId],
    );
    const row = await db.queryOne<Record<string, unknown>>(
      `select up.*, m.month_key from update_plans up join months m on m.id = up.month_id where up.id = $1`,
      [planId],
    );
    if (!row) throw notFound('Update plan not found');
    return { plan: toUpdatePlan(row), checklist: await checklistForPlan(planId) };
  });

  app.get('/api/holdings', async (request) => {
    const { page, pageSize } = paginationQuerySchema.parse(request.query ?? {});
    const { query = '', grantType = '', tag = '' } = request.query as {
      query?: string;
      grantType?: string;
      tag?: string;
    };
    const normalizedQuery = query.trim().toLowerCase();
    const normalizedTag = tag.trim();
    const like = `%${normalizedQuery}%`;
    const offset = (page - 1) * pageSize;
    const totalRow = await db.queryOne<{ count: number }>(
      `select count(*)::int as count
       from equity_grants g
       join employees e on e.id = g.employee_id
       where ($1 = '' or g.incentive_type = $1)
         and ($2 = '' or $2 = any(e.tags))
         and (
           $3 = ''
           or lower(
             coalesce(e.employee_name, '') || ' ' ||
             coalesce(e.employee_number, '') || ' ' ||
             coalesce(array_to_string(e.tags, ' '), '') || ' ' ||
             coalesce(g.grant_number, '') || ' ' ||
             coalesce(g.plan_name, '') || ' ' ||
             coalesce(g.vesting_rule_name, '')
           ) like $4
         )`,
      [grantType, normalizedTag, normalizedQuery, like],
    );
    const rows = await db.query<Record<string, unknown>>(
      `select
         g.*,
         e.employee_name,
         e.employee_number,
         e.user_id,
         e.tags
       from equity_grants g
       join employees e on e.id = g.employee_id
       where ($1 = '' or g.incentive_type = $1)
         and ($2 = '' or $2 = any(e.tags))
         and (
           $3 = ''
           or lower(
             coalesce(e.employee_name, '') || ' ' ||
             coalesce(e.employee_number, '') || ' ' ||
             coalesce(array_to_string(e.tags, ' '), '') || ' ' ||
             coalesce(g.grant_number, '') || ' ' ||
             coalesce(g.plan_name, '') || ' ' ||
            coalesce(g.vesting_rule_name, '')
           ) like $4
         )
       order by e.employee_number, g.grant_date, g.grant_number
       limit $5 offset $6`,
      [grantType, normalizedTag, normalizedQuery, like, pageSize, offset],
    );
    return {
      holdings: rows.map(toHoldingGrant),
      total: Number(totalRow?.count ?? 0),
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(Number(totalRow?.count ?? 0) / pageSize)),
    };
  });

  app.get('/api/employees', async (request) => {
    const { page, pageSize } = paginationQuerySchema.parse(request.query ?? {});
    const { query = '', tag = '' } = request.query as { query?: string; tag?: string };
    const normalizedQuery = query.trim().toLowerCase();
    const normalizedTag = tag.trim();
    const like = `%${normalizedQuery}%`;
    const offset = (page - 1) * pageSize;
    const totalRow = await db.queryOne<{ count: number }>(
      `select count(*)::int as count
       from employees e
       where ($1 = '' or $1 = any(e.tags))
         and (
           $2 = ''
           or lower(
             coalesce(e.employee_name, '') || ' ' ||
             coalesce(e.employee_number, '') || ' ' ||
             coalesce(e.user_id, '') || ' ' ||
             coalesce(array_to_string(e.tags, ' '), '')
           ) like $3
         )`,
      [normalizedTag, normalizedQuery, like],
    );
    const rows = await db.query<Record<string, unknown>>(
      `select
         e.id,
         e.employee_number,
         e.employee_name,
         e.user_id,
         e.tags,
         count(g.id)::int as grant_count
       from employees e
       left join equity_grants g on g.employee_id = e.id
       where ($1 = '' or $1 = any(e.tags))
         and (
         $2 = ''
         or lower(
           coalesce(e.employee_name, '') || ' ' ||
           coalesce(e.employee_number, '') || ' ' ||
           coalesce(e.user_id, '') || ' ' ||
           coalesce(array_to_string(e.tags, ' '), '')
         ) like $3
       )
       group by e.id, e.employee_number, e.employee_name, e.user_id, e.tags
       order by e.employee_number, e.id
       limit $4 offset $5`,
      [normalizedTag, normalizedQuery, like, pageSize, offset],
    );
    return {
      items: rows.map(toEmployee),
      total: Number(totalRow?.count ?? 0),
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(Number(totalRow?.count ?? 0) / pageSize)),
    };
  });

  app.post('/api/employees', async (request, reply) => {
    const body = z
      .object({
        employeeNumber: z.string().trim().min(1),
        employeeName: z.string().trim().min(1),
        userId: z.string().trim().optional().or(z.literal('')),
        tags: z.array(z.string().trim()).optional().default([]),
      })
      .parse(request.body);
    const row = await db.queryOne<Record<string, unknown>>(
      `insert into employees (employee_number, employee_name, user_id, tags)
       values ($1, $2, $3, $4::text[])
       returning id, employee_number, employee_name, user_id, tags, 0::int as grant_count`,
      [body.employeeNumber, body.employeeName, body.userId || null, body.tags],
    );
    if (!row) throw new Error('Failed to create employee');
    return reply.code(201).send(toEmployee(row));
  });

  app.patch('/api/employees/:id', async (request) => {
    const { id } = request.params as { id: string };
    const employeeId = Number(id);
    const body = z
      .object({
        employeeNumber: z.string().trim().min(1),
        employeeName: z.string().trim().min(1),
        userId: z.string().trim().optional().or(z.literal('')),
        tags: z.array(z.string().trim()).optional().default([]),
      })
      .parse(request.body);
    const row = await db.queryOne<Record<string, unknown>>(
      `update employees
       set employee_number = $1,
           employee_name = $2,
           user_id = $3,
           tags = $4::text[],
           updated_at = current_timestamp
       where id = $5
       returning id, employee_number, employee_name, user_id, tags`,
      [body.employeeNumber, body.employeeName, body.userId || null, body.tags, employeeId],
    );
    if (!row) throw notFound('Employee not found');

    const grantCount = await db.queryOne<{ count: number }>('select count(*)::int as count from equity_grants where employee_id = $1', [employeeId]);
    return toEmployee({ ...row, grant_count: Number(grantCount?.count ?? 0) });
  });

  app.delete('/api/employees/:id', async (request, reply) => {
    const employeeId = Number((request.params as { id: string }).id);
    const existing = await db.queryOne<{ count: number }>('select count(*)::int as count from equity_grants where employee_id = $1', [employeeId]);
    if (Number(existing?.count ?? 0) > 0) {
      return reply.code(400).send({ error: 'Employee has related grants and cannot be deleted' });
    }
    await db.execute('delete from employees where id = $1', [employeeId]);
    return reply.code(204).send();
  });

  app.get('/api/settings/employee-mappings', async () => ({
    items: (await settingRows('employee_mappings')).map((row) => ({
      id: Number(row.id),
      name: String(row.display_name),
      empId: String(row.employee_id),
      futuId: String(row.futu_id ?? ''),
      shareworksId: String(row.shareworks_id ?? ''),
    })),
  }));

  app.post('/api/settings/employee-mappings', async (request, reply) => {
    const body = z
      .object({ name: z.string(), empId: z.string(), futuId: z.string().optional(), shareworksId: z.string().optional() })
      .parse(request.body);
    const row = await db.queryOne<{ id: number }>(
      'insert into employee_mappings (display_name, employee_id, futu_id, shareworks_id) values ($1, $2, $3, $4) returning id',
      [body.name, body.empId, body.futuId ?? '', body.shareworksId ?? ''],
    );
    return reply.code(201).send({ id: Number(row?.id), ...body });
  });

  app.patch('/api/settings/employee-mappings/:id', async (request) => {
    const { id } = request.params as { id: string };
    const body = z.object({ name: z.string(), empId: z.string(), futuId: z.string(), shareworksId: z.string() }).parse(request.body);
    await db.execute(
      'update employee_mappings set display_name = $1, employee_id = $2, futu_id = $3, shareworks_id = $4 where id = $5',
      [body.name, body.empId, body.futuId, body.shareworksId, Number(id)],
    );
    return { id: Number(id), ...body };
  });

  app.delete('/api/settings/employee-mappings/:id', async (request, reply) => {
    await db.execute('delete from employee_mappings where id = $1', [Number((request.params as { id: string }).id)]);
    return reply.code(204).send();
  });

  app.get('/api/settings/tracked-plans', async () => ({
    items: (await settingRows('tracked_plans')).map((row) => ({
      id: Number(row.id),
      name: String(row.plan_name),
      createTime: String(row.created_at),
      status: String(row.status),
    })),
  }));

  app.post('/api/settings/tracked-plans', async (request, reply) => {
    const body = z.object({ name: z.string(), description: z.string().optional() }).parse(request.body);
    const createTime = new Date().toLocaleDateString('zh-CN');
    const row = await db.queryOne<{ id: number }>(
      'insert into tracked_plans (plan_name, description, status, created_at) values ($1, $2, $3, $4) returning id',
      [body.name, body.description ?? '', '生效中', createTime],
    );
    return reply.code(201).send({ id: Number(row?.id), name: body.name, createTime, status: '生效中' });
  });

  app.patch('/api/settings/tracked-plans/:id', async (request) => {
    const { id } = request.params as { id: string };
    const body = z.object({ name: z.string(), status: z.string().optional() }).parse(request.body);
    await db.execute('update tracked_plans set plan_name = $1, status = coalesce($2, status) where id = $3', [
      body.name,
      body.status ?? null,
      Number(id),
    ]);
    return { id: Number(id), ...body };
  });

  app.delete('/api/settings/tracked-plans/:id', async (request, reply) => {
    await db.execute('delete from tracked_plans where id = $1', [Number((request.params as { id: string }).id)]);
    return reply.code(204).send();
  });

  app.get('/api/settings/shareholders', async () => ({
    items: (await settingRows('shareholder_tags')).map((row) => ({
      id: Number(row.id),
      name: String(row.name),
      identity: String(row.identity),
      track: asBoolean(row.tracked),
    })),
  }));

  app.post('/api/settings/shareholders', async (request, reply) => {
    const body = z.object({ name: z.string(), identity: z.string(), track: z.boolean() }).parse(request.body);
    const row = await db.queryOne<{ id: number }>(
      'insert into shareholder_tags (name, identity, tracked) values ($1, $2, $3) returning id',
      [body.name, body.identity, body.track],
    );
    return reply.code(201).send({ id: Number(row?.id), ...body });
  });

  app.patch('/api/settings/shareholders/:id', async (request) => {
    const { id } = request.params as { id: string };
    const body = z.object({ name: z.string().optional(), identity: z.string().optional(), track: z.boolean().optional() }).parse(request.body);
    const current = await db.queryOne<Record<string, unknown>>('select * from shareholder_tags where id = $1', [Number(id)]);
    if (!current) throw notFound('Shareholder not found');
    await db.execute('update shareholder_tags set name = $1, identity = $2, tracked = $3 where id = $4', [
      body.name ?? current.name,
      body.identity ?? current.identity,
      body.track === undefined ? asBoolean(current.tracked) : body.track,
      Number(id),
    ]);
    return {
      id: Number(id),
      name: body.name ?? current.name,
      identity: body.identity ?? current.identity,
      track: body.track ?? asBoolean(current.tracked),
    };
  });

  app.delete('/api/settings/shareholders/:id', async (request, reply) => {
    await db.execute('delete from shareholder_tags where id = $1', [Number((request.params as { id: string }).id)]);
    return reply.code(204).send();
  });

  app.get('/api/workflow/operators', async () => {
    const rows = await db.query<Record<string, unknown>>(
      'select * from workflow_operators order by category asc, name asc, version asc',
    );
    return { operators: rows.map(toWorkflowOperator) };
  });

  app.get('/api/workflows', async () => {
    const rows = await db.query<Record<string, unknown>>(
      'select * from workflow_definitions order by updated_at desc, id desc',
    );
    return { items: rows.map(toWorkflowDefinition) };
  });

  app.get('/api/workflows/:id/export', async (request) => {
    const workflowId = Number((request.params as { id: string }).id);
    const row = await db.queryOne<Record<string, unknown>>('select * from workflow_definitions where id = $1', [workflowId]);
    if (!row) throw notFound('Workflow not found');
    const workflow = toWorkflowDefinition(row);
    return toWorkflowImportExportBundle({
      code: workflow.code,
      name: workflow.name,
      description: workflow.description,
      status: workflow.status,
      version: workflow.version,
      tasks: workflow.tasks,
      runtimeParamsSchema: workflow.runtimeParamsSchema,
      runtimeParamsDefaults: workflow.runtimeParamsDefaults,
    });
  });

  app.post('/api/workflows/import', async (request, reply) => {
    const body = workflowImportBundleSchema.parse(request.body);
    const imported = toWorkflowPortableDefinition(body.workflow);
    const uniqueCode = await ensureUniqueWorkflowCode(imported.code);
    const runtimeConfig = normalizeWorkflowRuntimeConfig({
      runtimeParamsSchema: imported.runtimeParamsSchema,
      runtimeParamsDefaults: imported.runtimeParamsDefaults,
    });

    const row = await db.queryOne<Record<string, unknown>>(
      `insert into workflow_definitions (
         code, name, description, status, version, tasks_json, runtime_params_schema_json, runtime_params_defaults_json
       )
       values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb)
       returning *`,
      [
        uniqueCode,
        imported.name,
        imported.description,
        imported.status,
        imported.version,
        JSON.stringify(imported.tasks),
        JSON.stringify(runtimeConfig.runtimeParamsSchema),
        JSON.stringify(runtimeConfig.runtimeParamsDefaults),
      ],
    );
    if (!row) throw new Error('Failed to import workflow');
    return reply.code(201).send(toWorkflowDefinition(row));
  });

  app.post('/api/workflows', async (request, reply) => {
    const body = z
      .object({
        code: z.string().trim().min(1),
        name: z.string().trim().min(1),
        description: z.string().optional().default(''),
        status: z.enum(['draft', 'active']).optional().default('draft'),
        version: z.number().int().min(1).optional().default(1),
        tasks: z.array(z.record(z.string(), z.unknown())).optional().default([]),
        runtimeParamsSchema: z.record(z.string(), z.unknown()).optional().default({}),
        runtimeParamsDefaults: z.record(z.string(), z.unknown()).optional().default({}),
      })
      .parse(request.body);

    const normalizedTasks = normalizeWorkflowTasks(body.tasks);
    const runtimeConfig = normalizeWorkflowRuntimeConfig({
      runtimeParamsSchema: body.runtimeParamsSchema,
      runtimeParamsDefaults: body.runtimeParamsDefaults,
    });

    const row = await db.queryOne<Record<string, unknown>>(
      `insert into workflow_definitions (
         code, name, description, status, version, tasks_json, runtime_params_schema_json, runtime_params_defaults_json
       )
       values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb)
       returning *`,
      [
        body.code,
        body.name,
        body.description,
        body.status,
        body.version,
        JSON.stringify(normalizedTasks),
        JSON.stringify(runtimeConfig.runtimeParamsSchema),
        JSON.stringify(runtimeConfig.runtimeParamsDefaults),
      ],
    );
    if (!row) throw new Error('Failed to create workflow');
    return reply.code(201).send(toWorkflowDefinition(row));
  });

  app.patch('/api/workflows/:id', async (request) => {
    const { id } = request.params as { id: string };
    const workflowId = Number(id);
    const existing = await db.queryOne<Record<string, unknown>>('select * from workflow_definitions where id = $1', [workflowId]);
    if (!existing) throw notFound('Workflow not found');

    const body = z
      .object({
        code: z.string().trim().min(1).optional(),
        name: z.string().trim().min(1).optional(),
        description: z.string().optional(),
        status: z.enum(['draft', 'active']).optional(),
        version: z.number().int().min(1).optional(),
        tasks: z.array(z.record(z.string(), z.unknown())).optional(),
        runtimeParamsSchema: z.record(z.string(), z.unknown()).optional(),
        runtimeParamsDefaults: z.record(z.string(), z.unknown()).optional(),
      })
      .parse(request.body);

    const normalizedTasks =
      body.tasks === undefined ? normalizeWorkflowTasks(parseJson(existing.tasks_json, [])) : normalizeWorkflowTasks(body.tasks);
    const runtimeConfig = normalizeWorkflowRuntimeConfig({
      runtimeParamsSchema:
        body.runtimeParamsSchema === undefined ? parseJson(existing.runtime_params_schema_json, {}) : body.runtimeParamsSchema,
      runtimeParamsDefaults:
        body.runtimeParamsDefaults === undefined ? parseJson(existing.runtime_params_defaults_json, {}) : body.runtimeParamsDefaults,
    });

    const row = await db.queryOne<Record<string, unknown>>(
      `update workflow_definitions
       set code = $1,
           name = $2,
           description = $3,
           status = $4,
           version = $5,
           tasks_json = $6::jsonb,
           runtime_params_schema_json = $7::jsonb,
           runtime_params_defaults_json = $8::jsonb,
           updated_at = current_timestamp
       where id = $9
       returning *`,
      [
        body.code ?? existing.code,
        body.name ?? existing.name,
        body.description ?? existing.description,
        body.status ?? existing.status,
        body.version ?? Number(existing.version ?? 1),
        JSON.stringify(normalizedTasks),
        JSON.stringify(runtimeConfig.runtimeParamsSchema),
        JSON.stringify(runtimeConfig.runtimeParamsDefaults),
        workflowId,
      ],
    );
    if (!row) throw notFound('Workflow not found');
    return toWorkflowDefinition(row);
  });

  app.post('/api/workflows/preview-task', async (request) => {
    const body = workflowTaskPreviewBodySchema.parse(request.body);
    const workflowRow = await db.queryOne<Record<string, unknown>>('select * from workflow_definitions where id = $1', [body.workflowId]);
    if (!workflowRow) throw notFound('Workflow not found');

    const sourceTasks = body.tasks ? normalizeWorkflowTasks(body.tasks) : normalizeWorkflowTasks(parseJson(workflowRow.tasks_json, []));
    const runtimeConfiguration = resolveWorkflowRuntimeConfiguration({
      tasks: sourceTasks,
      runtimeParamsSchema: body.runtimeParamsSchema ?? parseJson(workflowRow.runtime_params_schema_json, {}),
      runtimeParamsDefaults: body.runtimeParamsDefaults ?? parseJson(workflowRow.runtime_params_defaults_json, {}),
      runtimeParameters: body.runtimeParameters,
    });
    const taskMap = new Map(runtimeConfiguration.tasks.map((task) => [task.id, task]));
    const task = taskMap.get(body.taskId);
    if (!task) throw notFound('Workflow task not found');

    return executeWorkflowTaskPreview(task, new Map(), taskMap, workflowOperatorRuntime);
  });

  app.post('/api/workflows/:id/execute', async (request) => {
    const { id } = request.params as { id: string };
    const workflowId = Number(id);
    const body = workflowExecuteBodySchema.parse(request.body);
    const workflowRow = await db.queryOne<Record<string, unknown>>('select * from workflow_definitions where id = $1', [workflowId]);
    if (!workflowRow) throw notFound('Workflow not found');

    const storedTasks = normalizeWorkflowTasks(parseJson(workflowRow.tasks_json, []));
    const runtimeConfiguration = resolveWorkflowRuntimeConfiguration({
      tasks: storedTasks,
      runtimeParamsSchema: parseJson(workflowRow.runtime_params_schema_json, {}),
      runtimeParamsDefaults: parseJson(workflowRow.runtime_params_defaults_json, {}),
      runtimeParameters: body.runtimeParameters,
    });
    const run = await workflowRunStore.createRun({
      workflow: workflowRow,
      tasks: runtimeConfiguration.tasks,
      runtimeParameters: runtimeConfiguration.runtimeParameters,
    });

    if (body.approvedWarningTaskIds.length) {
      for (const taskId of body.approvedWarningTaskIds) {
        await workflowRunStore.approveWarning(run.id, taskId, 'approved');
      }
    }

    workflowRunExecutor.startAsync(run.id);
    return workflowRunToExecutionResult(await workflowRunStore.getRun(run.id));
  });

  app.get('/api/workflow-runs/:id', async (request) => {
    const runId = Number((request.params as { id: string }).id);
    return workflowRunStore.getRun(runId);
  });

  app.post('/api/workflow-runs/:id/approvals', async (request) => {
    const runId = Number((request.params as { id: string }).id);
    const body = workflowApprovalBodySchema.parse(request.body ?? {});
    const taskIds = body.taskIds?.length ? body.taskIds : body.taskId ? [body.taskId] : [];
    if (!taskIds.length) {
      throw new Error('At least one approval task id is required');
    }
    const run = await workflowRunExecutor.continueAfterApproval(runId, taskIds, body.decision);
    return workflowRunToExecutionResult(run);
  });

  app.post('/api/workflow-runs/:id/cancel', async (request) => {
    const runId = Number((request.params as { id: string }).id);
    const run = await workflowRunExecutor.cancelRun(runId);
    return workflowRunToExecutionResult(run);
  });

  app.post('/api/workflow-runs/:id/retry-unfinished', async (request) => {
    const runId = Number((request.params as { id: string }).id);
    const body = workflowRunRetryBodySchema.parse(request.body ?? {});
    await workflowRunExecutor.retryUnfinishedAsync(runId, body.tasks ? normalizeWorkflowTasks(body.tasks) : undefined);
    return workflowRunToExecutionResult(await workflowRunStore.getRun(runId));
  });

  app.post('/api/workflow-runs/:id/steps/:taskId/execute', async (request) => {
    const { id, taskId } = request.params as { id: string; taskId: string };
    const runId = Number(id);
    const body = workflowRunRetryBodySchema.parse(request.body ?? {});
    await workflowRunExecutor.startSingleStepAsync(runId, taskId, body.tasks ? normalizeWorkflowTasks(body.tasks) : undefined);
    return workflowRunToExecutionResult(await workflowRunStore.getRun(runId));
  });

  app.delete('/api/workflows/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    await db.execute('delete from workflow_definitions where id = $1', [Number(id)]);
    return reply.code(204).send();
  });

  app.get('/api/link-details/:key', async (request, reply) => {
    const { key } = request.params as { key: string };
    const detail = await db.queryOne<Record<string, unknown>>('select * from link_details where detail_key = $1', [key]);
    if (!detail) return reply.code(404).send({ error: 'Link detail not found' });
    return {
      title: String(detail.title),
      columns: parseJson(detail.columns_json, []),
      rows: parseJson(detail.rows_json, []),
      summary: parseJson(detail.summary_json, undefined),
    };
  });

  if (fs.existsSync(config.clientDistDir)) {
    await app.register(fastifyStatic, { root: config.clientDistDir });
    const spaPages = ['summary', 'monthly', 'monthly/run', 'files', 'workflow', 'holdings', 'employees', 'account', 'settings'];
    for (const page of spaPages) {
      app.get(`/${page}`, async (_request, reply) => reply.sendFile('index.html'));
    }
    app.get('/monthlyrun', async (_request, reply) => reply.redirect(301, '/monthly/run'));
    app.setNotFoundHandler((request, reply) => {
      if (request.raw.url?.startsWith('/api/')) return reply.code(404).send({ error: 'API route not found' });
      return reply.sendFile('index.html');
    });
  }
}

app.setErrorHandler((error, _request, reply) => {
  const statusCode = error.statusCode ?? 500;
  app.log.error(error);
  reply.code(statusCode).send({ error: error.message });
});

process.on('SIGINT', () => {
  void db.close().finally(() => process.exit(0));
});

process.on('SIGTERM', () => {
  void db.close().finally(() => process.exit(0));
});

await registerRoutes();
await app.listen({ host: config.host, port: config.port });

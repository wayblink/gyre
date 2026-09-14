import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { z } from 'zod';
import * as XLSX from 'xlsx';
import { config } from './config.js';
import { createDb } from './db.js';
import type { DbClient } from './db.js';
import {
  calculateSessionExpiry,
  countActiveAdmins,
  createManagedUser,
  createBootstrapAdmin,
  createSession,
  createSessionToken,
  deleteManagedUser,
  deleteSessionByHash,
  findSessionUserByTokenHash,
  findUserByUsername,
  getManagedUser,
  getPublicAccount,
  hashPassword,
  hashSessionToken,
  hasAnyUsers,
  listManagedUsers,
  parseCookies,
  serializeCookie,
  toAuthStatus,
  touchSession,
  touchUserLastLogin,
  updateAccountPassword,
  updateAccountProfile,
  updateManagedUser,
  verifyPassword,
  bootstrapSecretMatches,
} from './auth.js';
import {
  dataFrameToWorkbookBuffer,
  extractSheetRangeAsDataFrame,
  parseWorkbook,
  previewWorkbookSheet,
  rowsToDataFrame,
  summarizeWorkbook,
  summarizeValidatedWorkbookAsync,
} from './excel.js';
import { requiresAdminRole } from './authorization.js';
import {
  parseCapitalizationWorkbook,
  parseCapitalizationSummarySheet,
  summaryCapitalizationToWorkbookBuffer,
} from './summary/capitalizationWorkbook.js';
import { fileStorage } from './storage.js';
import { canonicalProductFilePath, normalizeProductFileName, normalizeProductFolder, productFileCollisionKey } from './fileIdentity.js';
import {
  applyMonthlyRunPostProcessing,
  attachWorkflowRunToMonthlyHistory,
  createMonthlyRunHistory,
  deleteMonthlyRunHistory,
  getMonthlyRun,
  listMonthlyRuns,
  MONTHLY_WORKFLOW_CODE,
  MonthlyRunHistoryDeleteConflictError,
  reconcileMonthlyUpdatePlanStatuses,
} from './monthlyRun/store.js';
import {
  deleteMonthlyRunPlan,
  ensureMonthlyRunInstance,
  getLatestMonthlyRunOutput,
  getMonthlyRunInstance,
  getMonthlyRunOutputForMonth,
  listMonthlyRunInstances,
  loadMonthlyRunRuntimeFixedValues,
  monthlyRunInstanceToRuntimeParameters,
  upsertMonthlyRunInstance,
  updateMonthlyRunInstanceExecutionState,
} from './monthlyRun/instanceStore.js';
import { monthlyWorkflowSelectionLabel, resolveMonthlyWorkflowDefinition } from './monthlyRun/workflowSelection.js';
import { monthlySourcesFromSchema } from './monthlyRun/sourceSchema.js';
import {
  buildPlanSummary,
  mergeFutuGrant,
  mergeShareworksGrant,
  toFixedValue,
  toTransferPlanPeriod,
} from './esopPages.js';
import { loadTransferPlanWorkbook, seedTransferPlanData } from './seed.js';
import { startEsopPageWorkflow } from './esopWorkflow/service.js';
import {
  ESOP_PAGE_WORKFLOW_CONFIGS,
  type EsopPageKey,
} from './esopWorkflow/workflowDefinitions.js';
import { parseFivePercentHoldersGrid } from './fivePercentHolders/persistence.js';
import { startDataManagementWorkflow } from './dataManagementWorkflow/service.js';
import {
  DATA_MANAGEMENT_WORKFLOW_CONFIGS,
  FIVE_PERCENT_HOLDER_GLOBAL_PARAMETER_KEYS,
  type DataManagementPageKey,
} from './dataManagementWorkflow/workflowDefinitions.js';
import { upsertTableRows } from './workflow/tableUpsert.js';
import { normalizeEmployeeSourceFilter, normalizeExternalNumber } from './employees.js';
import { expandByLinkedGroup } from './employeeLinkExpansion.js';
import { executeWorkflowDefinition, executeWorkflowTaskPreview } from './workflow/engine.js';
import { selectWorkflowPreviewTasks } from './workflow/previewTask.js';
import { WorkflowFileSourceRegistry, productFileRef } from './workflow/fileSources.js';
import { rewriteProductFileKey } from './workflow/productFileKeyRewrite.js';
import { normalizeWorkflowTaskInput } from './workflow/inputGuards.js';
import {
  filterWorkflowRuntimeParametersBySchema,
  normalizeWorkflowRuntimeParameters,
  normalizeWorkflowRuntimeParametersSchema,
  validateRuntimeParameters,
  resolveWorkflowRuntimeConfiguration,
} from './workflow/runtimeParameters.js';
import { deriveWorkflowRuntimeConfigFromTasks } from './workflow/runtimeParameterRequirements.js';
import type { WorkflowOperatorRuntime } from './workflow/operators/types.js';
import { WorkflowRunExecutor, workflowRunToExecutionResult } from './workflow/runExecutor.js';
import { WorkflowRunStore } from './workflow/runStore.js';
import type {
  AuthStatus,
  LatestMonthlyRunOutput,
  MonthlyRunInstanceRecord,
  MonthlyRunInstanceUpsertRequest,
  MonthlyRunSourceConfigResponse,
  MonthlyRunSourceDefinition,
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

const fivePercentHolderGlobalParameterOrder = [
  FIVE_PERCENT_HOLDER_GLOBAL_PARAMETER_KEYS.gniCommonStock,
  FIVE_PERCENT_HOLDER_GLOBAL_PARAMETER_KEYS.gniTotalCses,
  FIVE_PERCENT_HOLDER_GLOBAL_PARAMETER_KEYS.songjiangMaCommonStock,
  FIVE_PERCENT_HOLDER_GLOBAL_PARAMETER_KEYS.songjiangMaTotalCses,
] as const;

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

// Synthetic user used while login is disabled (config.authDisabled) during development.
const DEV_AUTH_USER: NonNullable<RequestWithAuth['currentUser']> = {
  id: 0,
  username: 'dev',
  display_name: 'Developer',
  role: 'admin',
  email: null,
  phone: null,
  is_active: true,
  last_login_at: null,
};

function toIsoTimestamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
  }
  return new Date(String(value)).toISOString();
}

function updatedByFromRequest(request: RequestWithAuth): string {
  return request.currentUser?.username?.trim() || 'system';
}

const updatePlanSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  remark: z.string().optional().default(''),
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

const productFileMoveSchema = z.object({
  folder: z.string().trim().max(512),
});

const productFileBulkDeleteSchema = z.object({
  ids: z.array(z.coerce.number().int().positive()).min(1).max(500),
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

const esopPageKeySchema = z.enum(['grant-record', 'exercise-record', 'sold-shares', 'transfer-plan']);

const esopWorkflowRunBodySchema = z.object({
  sources: z.record(z.string(), z.object({ fileId: z.number().int().positive() })),
});

const transferPlanEditBodySchema = z.object({
  edits: z.array(z.object({
    period: z.string().trim().min(1),
    cancelledQuantity: z.number().finite(),
  })).min(1),
});
const dataManagementPageKeySchema = z.enum(['employee', 'plan-summary', 'five-percent-holders']);
const dataManagementWorkflowRunBodySchema = esopWorkflowRunBodySchema;

const monthlyRunListQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

const monthlyRunInstanceQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
});

const monthlyRunInstanceUpsertSchema = z.object({
  operator: z.string().trim().min(1).optional(),
  sources: z.record(z.string(), z.object({
    fileId: z.number().int().positive(),
    logicalPath: z.string().trim().min(1).max(1024).nullable().optional(),
    fileKey: z.string().trim().min(1).max(1024).nullable().optional(),
    sheetName: z.string().trim().min(1).max(255).nullable().optional(),
  }).nullable()).optional(),
  fixedValues: z.record(z.string(), z.number()).optional(),
});

const monthlyRunTriggerBodySchema = z.object({
  workflowId: z.number().int().positive().optional(),
  workflowCode: z.string().trim().min(1).optional(),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
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

const userRoleSchema = z.enum(['admin', 'user']);

const adminUserCreateSchema = z.object({
  username: z.string().trim().min(3).max(64),
  password: z.string().min(8).max(128),
  displayName: z.string().trim().min(1).max(120).optional(),
  role: userRoleSchema.optional().default('user'),
  email: z.string().trim().email().max(255).nullable().optional().or(z.literal('')),
  phone: z.string().trim().max(50).nullable().optional(),
});

const adminUserPatchSchema = z.object({
  username: z.string().trim().min(3).max(64).optional(),
  password: z.string().min(8).max(128).optional().or(z.literal('')),
  displayName: z.string().trim().min(1).max(120).optional(),
  role: userRoleSchema.optional(),
  email: z.string().trim().email().max(255).nullable().optional().or(z.literal('')),
  phone: z.string().trim().max(50).nullable().optional(),
  isActive: z.boolean().optional(),
});

const userIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const fixedValuePatchSchema = z.object({
  value: z.number(),
});

const globalParameterKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z][A-Za-z0-9_.-]*$/, 'Key must start with a letter and contain only letters, numbers, dots, dashes, or underscores');

const globalParameterCreateSchema = z.object({
  key: globalParameterKeySchema,
  label: z.string().trim().min(1).max(200),
  value: z.number().finite(),
});

const globalParameterPatchSchema = fixedValuePatchSchema.extend({
  label: z.string().trim().min(1).max(200).optional(),
});

const fixedValueUpsertSchema = fixedValuePatchSchema.extend({
  key: z.enum([
    FIVE_PERCENT_HOLDER_GLOBAL_PARAMETER_KEYS.gniCommonStock,
    FIVE_PERCENT_HOLDER_GLOBAL_PARAMETER_KEYS.gniTotalCses,
    FIVE_PERCENT_HOLDER_GLOBAL_PARAMETER_KEYS.songjiangMaCommonStock,
    FIVE_PERCENT_HOLDER_GLOBAL_PARAMETER_KEYS.songjiangMaTotalCses,
  ]),
  label: z.string().trim().min(1).max(200).optional(),
});

const fixedValueLabels: Record<string, string> = {
  [FIVE_PERCENT_HOLDER_GLOBAL_PARAMETER_KEYS.gniCommonStock]: '5% Holders - GNI Group Ltd. Common Stock',
  [FIVE_PERCENT_HOLDER_GLOBAL_PARAMETER_KEYS.gniTotalCses]: '5% Holders - GNI Group Ltd. Total CSEs',
  [FIVE_PERCENT_HOLDER_GLOBAL_PARAMETER_KEYS.songjiangMaCommonStock]: '5% Holders - Songjiang Ma Common Stock',
  [FIVE_PERCENT_HOLDER_GLOBAL_PARAMETER_KEYS.songjiangMaTotalCses]: '5% Holders - Songjiang Ma Total CSEs',
};

const fixedValuePageKeyOrder = [
  'cullgen_common_stock',
  'gyre_2023_china_subplan_total',
  'warrants_convertible_preferred',
  'options_outstanding_cullgen',
  'options_available_cullgen',
] as const;

const fivePercentHolderGlobalParameterKeys = Object.values(FIVE_PERCENT_HOLDER_GLOBAL_PARAMETER_KEYS);
const fivePercentHolderGlobalParameterKeySet = new Set<string>(fivePercentHolderGlobalParameterKeys);

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

function previousMonthKey(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  return month <= 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
}

async function assertMonthlyRunInstanceReady(instance: MonthlyRunInstanceRecord): Promise<void> {
  const sources = await monthlySourceDescriptors();
  for (const source of sources) {
    const binding = instance.sources[source.sourceKey];
    const fileId = binding?.fileId ?? null;
    if (!fileId) {
      if (source.required) throw new Error(`Missing source binding: ${source.sourceKey}`);
      continue;
    }
    if (source.allowSheetNameOverride && !binding?.sheetName?.trim()) {
      throw new Error(`Missing source sheet name: ${source.sourceKey}`);
    }
    await getProductFileOrThrow(fileId);
  }
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
    secure: config.sessionCookieSecure,
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
  if (config.authDisabled) {
    request.currentUser = DEV_AUTH_USER;
    return;
  }
  request.currentUser = await resolveAuthUser(request);
  if (!request.currentUser) {
    return reply.code(401).send({ error: 'Authentication required', code: 'AUTH_REQUIRED' });
  }
}

function requireAdminUser(request: RequestWithAuth, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }): boolean {
  if (request.currentUser?.role === 'admin') return true;
  reply.code(403).send({ error: 'Admin role required', code: 'ADMIN_REQUIRED' });
  return false;
}

async function currentAuthStatus(request: { headers: Record<string, unknown> }): Promise<AuthStatus> {
  if (config.authDisabled) {
    return toAuthStatus(DEV_AUTH_USER, false);
  }
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

/**
 * Moving a file changes its logical path, and workflow definitions reference product files by that
 * path, so the stored references are repointed in the same transaction as the move.
 * Deliberately untouched: monthly run instances and every other reference keyed by file id (they
 * survive a move), and workflow run history, which must keep the path used at execution time.
 */
async function rewriteProductFileKeyInWorkflows(tx: DbClient, oldKey: string, newKey: string): Promise<number> {
  const rows = await tx.query<{ id: number; tasks_json: unknown; runtime_params_defaults_json: unknown }>(
    'select id, tasks_json, runtime_params_defaults_json from workflow_definitions',
  );
  let rewrittenWorkflows = 0;
  for (const row of rows) {
    const tasks = rewriteProductFileKey(parseJson<unknown>(row.tasks_json, []), oldKey, newKey);
    const defaults = rewriteProductFileKey(parseJson<unknown>(row.runtime_params_defaults_json, {}), oldKey, newKey);
    if (tasks.changed + defaults.changed === 0) continue;
    rewrittenWorkflows += 1;
    await tx.execute(
      `update workflow_definitions
          set tasks_json = $2::jsonb,
              runtime_params_defaults_json = $3::jsonb,
              updated_at = current_timestamp
        where id = $1`,
      [row.id, JSON.stringify(tasks.value), JSON.stringify(defaults.value)],
    );
  }
  return rewrittenWorkflows;
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

const DEFAULT_EMPLOYEE_LABEL_COLOR = '#2563eb';

function parseEmployeeLabelRefs(value: unknown): EmployeeLabelRef[] {
  const rawLabels = Array.isArray(value) ? value : parseJson<Array<Record<string, unknown>>>(value, []);
  return rawLabels
    .map((label) => ({
      id: Number(label.id),
      name: String(label.name ?? '').trim(),
      color: normalizeEmployeeLabelColor(label.color),
    }))
    .filter((label) => Number.isInteger(label.id) && label.id > 0 && label.name !== '');
}

function normalizeEmployeeLabelColor(value: unknown): string {
  const color = String(value ?? '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : DEFAULT_EMPLOYEE_LABEL_COLOR;
}

function notFound(message: string) {
  const error = new Error(message) as Error & { statusCode?: number };
  error.statusCode = 404;
  return error;
}

function badRequest(message: string) {
  const error = new Error(message) as Error & { statusCode?: number };
  error.statusCode = 400;
  return error;
}

function conflict(message: string) {
  const error = new Error(message) as Error & { statusCode?: number };
  error.statusCode = 409;
  return error;
}

function normalizeProductFileStoragePrefix(prefix?: string): string {
  const normalized = normalizeStorageFolderPrefix(prefix);
  if (!normalized) return 'input';
  if (normalized === 'output' || normalized.startsWith('output/')) return normalized;
  if (normalized === 'input' || normalized.startsWith('input/')) return normalized;
  if (normalized === 'control_book' || normalized.startsWith('control_book/')) return normalized;
  return `input/${normalized}`;
}

function productFileRelativeStoragePath(row: Record<string, unknown>) {
  const rawPath = String(row.file_path ?? '').replace(/\\/g, '/');
  const productRoot = config.productFileDir.replace(/\\/g, '/').replace(/\/+$/g, '');

  if (rawPath.startsWith(`${productRoot}/`)) {
    return rawPath.slice(productRoot.length + 1).replace(/^\/+/, '');
  }

  return rawPath.replace(/^product\//, '').replace(/^\/+/, '');
}

function inferOutputFolderFromProductFile(row: Record<string, unknown>): string | null {
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

function timestampVersionTag(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
}

function timestampVersionTagFromValue(value: unknown): string {
  const date = value ? new Date(String(value)) : new Date();
  return Number.isNaN(date.getTime()) ? timestampVersionTag() : timestampVersionTag(date);
}

function stripFileVersion(fileName: string): string {
  return fileName.replace(/\.v\d{14}(?=\.[^.]+$)/i, '');
}

function withFileVersion(fileName: string, versionSource?: unknown): string {
  if (/\.v\d{14}\.[^.]+$/i.test(fileName)) return fileName;
  const ext = path.extname(fileName);
  const baseName = ext ? fileName.slice(0, -ext.length) : fileName;
  return `${baseName}.v${timestampVersionTagFromValue(versionSource)}${ext || '.xlsx'}`;
}

function productFileDisplayPath(row: Record<string, unknown>) {
  if (row.logical_path) return String(row.logical_path);
  const relativePath = productFileRelativeStoragePath(row);
  const directory = relativePath.includes('/') ? relativePath.split('/').slice(0, -1).join('/') : '';
  const normalizedDirectory = normalizeProductFileStoragePrefix(directory);
  const inferredOutputDirectory = normalizedDirectory.startsWith('output/') ? null : inferOutputFolderFromProductFile(row);
  const displayDirectory = inferredOutputDirectory ?? normalizedDirectory;
  const rawDisplayFileName = path.posix.basename(String(row.original_name ?? row.stored_name ?? relativePath)).replace(/^\/+/, '');
  const displayFileName = displayDirectory.startsWith('output/')
    ? rawDisplayFileName
    : stripFileVersion(rawDisplayFileName);
  return `${displayDirectory}/${displayFileName}`;
}

function productFileDisplayName(row: Record<string, unknown>) {
  return path.posix.basename(productFileDisplayPath(row));
}

function toProductFile(row: Record<string, unknown>) {
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
    fileName: file ? productFileDisplayName(file) : null,
    sheetName: monthRow.capitalization_source_sheet_name ?? null,
  };
}

async function getProductFileOrThrow(id: number) {
  const file = await db.queryOne<Record<string, unknown>>('select * from product_files where id = $1', [id]);
  if (!file) throw notFound('Product file not found');
  return file;
}

function workflowArtifactSheetName(metadata: Record<string, unknown>, fallback: string): string {
  const range = metadata.range;
  if (!isRecord(range)) return fallback;
  const sheetName = String(range.sheetName ?? '').trim();
  return sheetName || fallback;
}

type LatestWorkflowDataFrameArtifact = {
  fileId: number;
  fileName: string;
  filePath: string;
  sheetName: string;
  columns: string[];
  rows: Array<Record<string, unknown>>;
  buffer: Buffer;
};

async function readLatestWorkflowDataFrameArtifact(params: {
  workflowCode: string;
  taskId: string;
  fallbackSheetName: string;
}): Promise<LatestWorkflowDataFrameArtifact | null> {
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
      order by run.finished_at desc nulls last, artifact.id desc
      limit 1`,
    [params.workflowCode, params.taskId],
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

async function loadLatestFixedValuesByKey(keys: readonly string[]): Promise<Map<string, Record<string, unknown>>> {
  const rows = await db.query<Record<string, unknown>>(
    `select distinct on (key) *
      from global_parameters
     where key = any($1)
      order by key, updated_at desc, id desc`,
    [[...keys]],
  );
  return new Map(rows
    .filter((row) => String(row.updated_by ?? '') !== 'system')
    .map((row) => [String(row.key), row]));
}

function applyFivePercentHolderGlobalParameters(
  workbook: ReturnType<typeof parseFivePercentHoldersGrid>,
  fixedValues: Map<string, Record<string, unknown>>,
): ReturnType<typeof parseFivePercentHoldersGrid>['holders'] {
  let holderIndex = 0;
  return workbook.holders.map((row) => {
    if (row.rowType !== 'holder') return row;
    const commonStockKey = holderIndex === 0
      ? FIVE_PERCENT_HOLDER_GLOBAL_PARAMETER_KEYS.gniCommonStock
      : holderIndex === 1
        ? FIVE_PERCENT_HOLDER_GLOBAL_PARAMETER_KEYS.songjiangMaCommonStock
        : null;
    const totalCsesKey = holderIndex === 0
      ? FIVE_PERCENT_HOLDER_GLOBAL_PARAMETER_KEYS.gniTotalCses
      : holderIndex === 1
        ? FIVE_PERCENT_HOLDER_GLOBAL_PARAMETER_KEYS.songjiangMaTotalCses
        : null;
    holderIndex += 1;
    if (!commonStockKey || !totalCsesKey) return row;
    const commonStock = Number(fixedValues.get(commonStockKey)?.value);
    const totalCses = Number(fixedValues.get(totalCsesKey)?.value);
    return {
      ...row,
      commonStock: Number.isFinite(commonStock) ? commonStock : null,
      totalCses: Number.isFinite(totalCses) ? totalCses : null,
    };
  });
}

function hasCompleteFivePercentHolderGlobalParameters(fixedValues: Map<string, Record<string, unknown>>): boolean {
  return fivePercentHolderGlobalParameterOrder.every((key) => Number.isFinite(Number(fixedValues.get(key)?.value)));
}

function emptyFivePercentHolderRows(fixedValues: Map<string, Record<string, unknown>>) {
  const valueFor = (key: string): number | null => {
    const value = Number(fixedValues.get(key)?.value);
    return Number.isFinite(value) ? value : null;
  };
  return [
    {
      id: 1,
      rowType: 'holder' as const,
      name: 'GNI Group Ltd. **',
      commonStock: valueFor(FIVE_PERCENT_HOLDER_GLOBAL_PARAMETER_KEYS.gniCommonStock),
      totalCses: valueFor(FIVE_PERCENT_HOLDER_GLOBAL_PARAMETER_KEYS.gniTotalCses),
      pctOfClass: null,
      pctFullyDiluted: null,
      sc13Filing: null,
      note: null,
    },
    {
      id: 2,
      rowType: 'holder' as const,
      name: 'Songjiang Ma',
      commonStock: valueFor(FIVE_PERCENT_HOLDER_GLOBAL_PARAMETER_KEYS.songjiangMaCommonStock),
      totalCses: valueFor(FIVE_PERCENT_HOLDER_GLOBAL_PARAMETER_KEYS.songjiangMaTotalCses),
      pctOfClass: null,
      pctFullyDiluted: null,
      sc13Filing: null,
      note: null,
    },
  ];
}

async function readLatestWorkflowDataFrameFile(params: {
  workflowCode: string;
  taskId: string;
  fallbackSheetName: string;
}): Promise<Array<Record<string, unknown>>> {
  return (await readLatestWorkflowDataFrameArtifact(params))?.rows ?? [];
}

function sourceFilesFromArtifacts(...artifacts: Array<LatestWorkflowDataFrameArtifact | null | undefined>): string[] {
  return [...new Set(artifacts.map((artifact) => artifact?.filePath?.trim() || artifact?.fileName?.trim()).filter(Boolean) as string[])];
}

type WorkflowPageSourceDescriptor = { sourceKey: string; label: string };
type WorkflowPageSourceBindingResponse = WorkflowPageSourceDescriptor & { fileId: number | null; fileName: string | null };
type WorkflowResultFileBindingResponse = { fileId: number; fileName: string };

function resultFilesFromArtifacts(...artifacts: Array<LatestWorkflowDataFrameArtifact | null | undefined>): WorkflowResultFileBindingResponse[] {
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

function productFileIdsFromRuntimeParameters(runtimeParameters: unknown): number[] {
  const ids: number[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!isRecord(value)) return;
    if (value.provider === 'product-files') {
      const id = Number(value.id);
      if (Number.isInteger(id) && id > 0) ids.push(id);
    }
    Object.values(value).forEach(visit);
  };
  visit(runtimeParameters);
  return [...new Set(ids)];
}

function productFileIdAtRuntimePath(runtimeParameters: unknown, runtimePath: string): number | null {
  const segments = runtimePath.split('.').map((segment) => segment.trim()).filter(Boolean);
  let current: unknown = runtimeParameters;
  for (const segment of segments) {
    if (!isRecord(current)) return null;
    current = current[segment];
  }
  if (!isRecord(current) || current.provider !== 'product-files') return null;
  const fileId = Number(current.id);
  return Number.isInteger(fileId) && fileId > 0 ? fileId : null;
}

function productFileKeyAtRuntimePath(runtimeParameters: unknown, runtimePath: string): string | null {
  const segments = runtimePath.split('.').map((segment) => segment.trim()).filter(Boolean);
  let current: unknown = runtimeParameters;
  for (const segment of segments) {
    if (!isRecord(current)) return null;
    current = current[segment];
  }
  if (!isRecord(current) || current.provider !== 'product-files') return null;
  return String(current.key ?? '').trim() || null;
}

function sourcesFromWorkflowSchemaJson(schemaJson: unknown): WorkflowPageSourceDescriptor[] {
  const schema = parseJson<Record<string, unknown>>(schemaJson, {});
  const fileRefs = isRecord(schema.fileRefs) ? schema.fileRefs : {};
  const properties = isRecord(fileRefs.properties) ? (fileRefs.properties as Record<string, unknown>) : {};
  return Object.entries(properties).map(([sourceKey, field]) => ({
    sourceKey,
    label:
      isRecord(field) && typeof field.label === 'string' && field.label.trim() ? field.label.trim() : sourceKey,
  }));
}

async function monthlySourceDescriptors(): Promise<MonthlyRunSourceDefinition[]> {
  const row = await db.queryOne<Record<string, unknown>>(
    "select runtime_params_schema_json from workflow_definitions where code = $1 and status = 'active' limit 1",
    [MONTHLY_WORKFLOW_CODE],
  );
  return monthlySourcesFromSchema(row?.runtime_params_schema_json);
}

// Run history shows the input files a past run consumed. Their labels come from the same
// DB-owned fileRefs metadata the Input Configuration table uses, so a rename there propagates
// here too. Sources recorded by an older workflow version fall back to the raw key.
async function monthlyRunInputSourceLabels(): Promise<Record<string, string>> {
  const sources = await monthlySourceDescriptors();
  return Object.fromEntries(sources.map((source) => [source.sourceKey, source.label]));
}

// Page input-source lists are derived from the DB workflow's runtime_params_schema.fileRefs
// (workflow definitions are DB-owned; see CLAUDE.md), not from any hardcoded source list.
async function workflowSourceDescriptors(workflowCode: string): Promise<WorkflowPageSourceDescriptor[]> {
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

async function pageWorkflowConfig(
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

async function latestWorkflowInputSourceBindings(
  workflowCode: string,
): Promise<WorkflowPageSourceBindingResponse[]> {
  const sources = await workflowSourceDescriptors(workflowCode);
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
  const files = ids.length || keys.length
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
    const fileId = productFileIdAtRuntimePath(runtimeParameters, runtimePath) ?? (keyedFile ? Number(keyedFile.id) : null);
    return {
      sourceKey: source.sourceKey,
      label: source.label,
      fileId,
      fileName: fileId ? nameById.get(fileId)?.trim() || null : null,
    };
  });
}

async function latestFivePercentHolderInputSourceBindings(): Promise<WorkflowPageSourceBindingResponse[]> {
  const bindings = await latestWorkflowInputSourceBindings('five-percent-holders-sync');
  const existing = bindings.find((binding) => binding.sourceKey === 'capitalization_summary');
  if (existing?.fileId) return bindings;

  const latestMonthlyOutput = await getLatestMonthlyRunOutput(db);
  if (!latestMonthlyOutput?.fileId) return bindings;

  const file = await getProductFileOrThrow(latestMonthlyOutput.fileId);
  return bindings.map((binding) => binding.sourceKey === 'capitalization_summary'
    ? {
      ...binding,
      fileId: latestMonthlyOutput.fileId,
      fileName: productFileDisplayPath(file),
    }
    : binding);
}

async function latestWorkflowInputSourceFiles(workflowCode: string): Promise<string[]> {
  const row = await db.queryOne<Record<string, unknown>>(
    `select runtime_parameters_json
       from workflow_runs
      where workflow_code = $1
        and status in ('completed', 'completed_with_warnings')
      order by finished_at desc nulls last, id desc
      limit 1`,
    [workflowCode],
  );
  if (!row) return [];
  const runtimeParameters = parseJson(row.runtime_parameters_json, {});
  const ids = productFileIdsFromRuntimeParameters(runtimeParameters);
  const keys: string[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!isRecord(value)) return;
    if (value.provider === 'product-files' && String(value.key ?? '').trim()) keys.push(String(value.key).trim());
    Object.values(value).forEach(visit);
  };
  visit(runtimeParameters);
  if (ids.length === 0 && keys.length === 0) return [];
  const files = await db.query<Record<string, unknown>>(
    'select * from product_files where id = any($1::int[]) or lower(logical_path) = any($2::text[])',
    [ids, keys.map((key) => key.toLowerCase())],
  );
  return [...new Set(files.map((file) => productFileDisplayPath(file).trim()).filter(Boolean))];
}

function textValue(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text && text !== '--' ? text : null;
}

function numberValue(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableNumberValue(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function dateTextValue(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86_400_000).toISOString().slice(0, 10);
  }
  return textValue(value);
}

function paginateItems<T>(items: T[], page: number, pageSize: number) {
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

// Optional Name / Employee No. column sort shared by the ESOP detail tables
// (grant record, exercise, sold shares). Applied after the endpoint's default
// ordering, before pagination, so it sorts the full result set (not one page).
type NameEmpNoSort = { by: 'name' | 'empNo' | null; dir: 'asc' | 'desc' };

function readNameEmpNoSort(query: unknown): NameEmpNoSort {
  const raw = (query ?? {}) as { sort?: string; dir?: string };
  const by = raw.sort === 'name' ? 'name' : raw.sort === 'empNo' ? 'empNo' : null;
  const dir = raw.dir === 'desc' ? 'desc' : 'asc';
  return { by, dir };
}

function sortRowsByNameOrEmpNo<T>(
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

type EmployeeLabelRef = {
  id: number;
  name: string;
  color: string;
};

async function employeeLabelsByNumber(): Promise<Map<string, EmployeeLabelRef[]>> {
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
  return new Map(
    rows.map((row) => [
      String(row.employee_id ?? ''),
      parseEmployeeLabelRefs(row.labels),
    ]),
  );
}

// Map each external 工号 to its canonical employee id (coalesce(merged_into_id, id)).
// Same canonical-folding basis as employeeLabelsByNumber; used to expand searches across a
// linked "same person" group so any one 工号 surfaces all linked identities' records.
async function employeeCanonicalByNumber(): Promise<Map<string, number>> {
  const rows = await db.query<{ employee_id: string; canonical_id: number }>(
    `select employee_id, coalesce(merged_into_id, id) as canonical_id
       from employees
      where btrim(coalesce(employee_id, '')) <> ''`,
  );
  return new Map(rows.map((row) => [String(row.employee_id ?? ''), Number(row.canonical_id)]));
}

function parseLinkedIdentities(value: unknown): Array<{ id: number; employeeId: string; source: string; name: string }> {
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

// For each external 工号, the OTHER members of its linked "same person" group (同一 canonical 下的
// 其它编号). Empty array means the 工号 is not linked to anyone. Detail rows use this to show a
// read-only "关联" badge marking records that belong to a linked identity.
async function employeeLinkGroupByNumber(): Promise<Map<string, Array<{ id: number; employeeId: string; source: string; name: string }>>> {
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

function employeeLabelIds(labels: EmployeeLabelRef[]): number[] {
  return labels.map((label) => label.id);
}

function employeeLabelNames(labels: EmployeeLabelRef[]): string[] {
  return labels.map((label) => label.name);
}

function rowMatches(row: Record<string, unknown>, query: string, keys: string[]) {
  if (!query) return true;
  return keys.map((key) => row[key]).join(' ').toLowerCase().includes(query);
}

function futuGrantFromWorkflowRow(row: Record<string, unknown>, index: number, labels: EmployeeLabelRef[] = []) {
  const employeeNumber = textValue(row['工号']) ?? '';
  return {
    id: index + 1,
    employeeId: index + 1,
    employeeName: textValue(row['姓名']) ?? employeeNumber,
    employeeNumber,
    userId: textValue(row['用户ID']),
    labelIds: employeeLabelIds(labels),
    labels,
    tags: employeeLabelNames(labels),
    grantNumber: textValue(row['授予编号']) ?? '',
    incentiveType: textValue(row['激励类型']) ?? '',
    grantDate: dateTextValue(row['授予日期']),
    grantQuantity: nullableNumberValue(row['授予数量']),
    grantPriceUsd: nullableNumberValue(row['授予价(USD)']),
    expireDate: dateTextValue(row['失效日期']),
    planName: textValue(row['所属计划']),
    conditionRule: textValue(row['条件规则']),
    employeePortalVisibility: textValue(row['员工端']),
    closingPriceUsd: nullableNumberValue(row['登记日收盘价(USD)']),
    withholdingCost: textValue(row['代扣成本']),
    taxCalculation: textValue(row['代算税款']),
    taxWithholding: textValue(row['代扣税款']),
    fxSettlement: textValue(row['授予统一结汇']),
    taxRule: textValue(row['授予计税规则']),
    cancellationConfirmDate: dateTextValue(row['确认取消日期']),
    dataSource: textValue(row['数据来源']),
    vestingRuleName: textValue(row['归属规则名称']),
    vestingStartDate: dateTextValue(row['归属起算日期']),
    vestedQuantity: nullableNumberValue(row['已归属']),
    effectiveVestedQuantity: nullableNumberValue(row['有效已归属']),
    unvestedQuantity: nullableNumberValue(row['待归属']),
    vestedCancelledQuantity: nullableNumberValue(row['已归属取消']),
    unvestedCancelledQuantity: nullableNumberValue(row['待归属取消']),
    exercisedQuantity: nullableNumberValue(row['已行权']),
    pendingExerciseQuantity: nullableNumberValue(row['待行权']),
    outstandingQuantity: nullableNumberValue(row.Outstanding),
    sellableQuantity: nullableNumberValue(row['可出售数量']),
    relatedSaleOrderNumber: textValue(row['关联出售订单编号']),
    agreementInfo: textValue(row['协议信息']),
  };
}

function shareworksGrantFromWorkflowRow(row: Record<string, unknown>, index: number, labels: EmployeeLabelRef[] = []) {
  return {
    id: index + 1,
    employeeNumber: textValue(row['Employee Number']) ?? '',
    labelIds: employeeLabelIds(labels),
    labels,
    tags: employeeLabelNames(labels),
    lastName: textValue(row['Last Name']),
    firstName: textValue(row['First Name']),
    middleName: textValue(row['Middle Name']),
    planName: textValue(row['Plan Name']),
    grantName: textValue(row['Grant Name']),
    grantType: textValue(row['Grant Type']),
    employeeGrantNumber: textValue(row['Employee Grant Number']),
    grantDate: dateTextValue(row['Grant Date']),
    vestingStartDate: dateTextValue(row['Vesting Start Date']),
    serviceStartDate: dateTextValue(row['Service Start Date']),
    originalVestingStartDate: dateTextValue(row['Original VCD (migrated grants)']),
    expireDate: dateTextValue(row['Expire Date']),
    participantExpireDate: dateTextValue(row['Expire Date (participant view)']),
    earliestExpireCancelDate: dateTextValue(row['Earliest Expire Cancel Date']),
    latestExpireCancelDate: dateTextValue(row['Latest Expire Cancel Date']),
    sharesGranted: nullableNumberValue(row['No. of Shares Granted']),
    exercisePricePerShare: nullableNumberValue(row['Exercise Price per Share']),
    vestingSchedule: textValue(row['Vesting Schedule']),
    earlyExerciseAllowed: textValue(row['Early Exercise Allowed']),
    sharesVested: nullableNumberValue(row['No. of Shares Vested']),
    sharesUnvested: nullableNumberValue(row['No. of Shares Unvested']),
    sharesExercisedReleased: nullableNumberValue(row['Shares Exercised / Released']),
    sharesSubjectToRepurchase: nullableNumberValue(row['Shares Subject To Repurchase']),
    sharesCancelledExpired: nullableNumberValue(row['Shares Cancelled/Expired']),
    sharesOutstanding: nullableNumberValue(row['Shares Outstanding']),
    outstandingUnvested: nullableNumberValue(row['Outstanding Unvested']),
    outstandingVestedExercisable: nullableNumberValue(row['Outstanding Vested/Exercisable']),
  };
}

function exerciseFromWorkflowRow(row: Record<string, unknown>, index: number, labels: EmployeeLabelRef[] = []) {
  return {
    id: index + 1,
    name: textValue(row.Name) ?? '',
    employeeNumber: textValue(row['Employee No.']) ?? '',
    labelIds: employeeLabelIds(labels),
    labels,
    tags: employeeLabelNames(labels),
    futubullId: textValue(row['Futubull ID']) ?? '',
    userId: textValue(row['User ID']) ?? '',
    grantNumber: textValue(row['Grant No.']) ?? '',
    grantDate: dateTextValue(row['Grant Date']) ?? '',
    grantPriceUsd: numberValue(row['Grant Price(USD)']),
    exerciseDate: dateTextValue(row['Exercise Date']) ?? '',
    orderedQuantity: numberValue(row['Ordered Qty']),
    exercisedQuantity: numberValue(row['Exercised Qty']),
    exerciseCostUsd: numberValue(row['Exercise Cost(USD)']),
    deductionSellingQuantity: numberValue(row['Deduction/Selling Qty.']),
    dealtQuantity: numberValue(row['Dealt Qty.']),
  };
}

function soldShareFromWorkflowRow(row: Record<string, unknown>, index: number, labels: EmployeeLabelRef[] = []) {
  return {
    id: index + 1,
    name: textValue(row['姓名']) ?? '',
    employeeNumber: textValue(row['工号']) ?? '',
    labelIds: employeeLabelIds(labels),
    labels,
    tags: employeeLabelNames(labels),
    futubullId: textValue(row['牛牛号']) ?? '',
    userId: textValue(row['用户ID']) ?? '',
    employmentStatus: textValue(row['在职状态']) ?? '',
    relatedPartyIdentity: textValue(row['关联人士身份']) ?? '',
    capitalGainsTaxVisibility: textValue(row['财产转让所得税']) ?? '',
    soldQuantity: numberValue(row['出售总数量']),
    dealtQuantity: numberValue(row['成交总数量']),
    dealAmountUsd: numberValue(row['成交总金额（美元）']),
    taxableIncomeUsd: numberValue(row['财产转让所得总应税收入（美元）']),
    taxPayableUsd: numberValue(row['财产转让所得总应纳税额（美元）']),
    transactionFeesUsd: numberValue(row['交易总费用（美元）']),
    netDealValueUsd: numberValue(row['成交净值（美元）']),
    grantCostUsd: numberValue(row['授予成本（美元）']),
    exerciseVestingFeeUsd: numberValue(row['行权/归属手续费（美元）']),
    withholdingTaxUsd: numberValue(row['本期合计代扣税额（美元）']),
    withholdingTaxCny: numberValue(row['本期合计代扣税额（人民币）']),
    cashNetProceedsUsd: numberValue(row['现金净收益(美元)']),
  };
}

function transferPlanFromWorkflowRows(rows: Array<Record<string, unknown>>, sourceFileId: number | null) {
  const periodColumns = Object.keys(rows[0] ?? {}).filter((column) => {
    const normalized = column.trim();
    return normalized && !['行标签', '(空白)', '总计'].includes(normalized);
  });
  const totalRows = rows.filter((row) => textValue(row['行标签']) === '总计');
  const sourceTotalRow = totalRows[0] ?? {};
  const adjustedTotalRow = totalRows[1] ?? sourceTotalRow;
  const details = rows.filter((row) => /^K\d+$/.test(textValue(row['行标签']) ?? ''));
  return periodColumns.map((period, sortOrder) => {
    const inTotal = numberValue(sourceTotalRow[period]);
    const transferToFutu = numberValue(adjustedTotalRow[period], inTotal);
    const sourceCancelled = transferToFutu - inTotal;
    return {
      id: sortOrder + 1,
      sourceFileId,
      period,
      inTotal,
      sourceCancelled,
      cancelledQuantity: sourceCancelled,
      transferToFutu,
      manuallyEdited: false,
      sortOrder,
      detailCount: details.length,
    };
  });
}

function transferPlanEditedWorkbookBuffer(
  rows: Array<Record<string, unknown>>,
  edits: Array<{ period: string; cancelledQuantity: number }>,
): Buffer {
  if (rows.length === 0) throw badRequest('Transfer Plan result file has no rows to edit');
  const firstRow = rows[0] ?? {};
  const rowLabelColumn = Object.keys(firstRow).find((column) => column.trim() === '行标签') ?? '行标签';
  const columns = Object.keys(firstRow);
  if (!columns.includes(rowLabelColumn)) columns.unshift(rowLabelColumn);
  const periodColumns = columns.filter((column) => {
    const normalized = column.trim();
    return normalized && normalized !== rowLabelColumn && !['(空白)', '总计'].includes(normalized);
  });
  const totalColumn = columns.find((column) => column.trim() === '总计') ?? '总计';
  if (!columns.includes(totalColumn)) columns.push(totalColumn);

  const editedRows = rows.map((row) => ({ ...row }));
  const totalRows = editedRows.filter((row) => textValue(row[rowLabelColumn]) === '总计');
  if (totalRows.length < 2) {
    throw badRequest('Transfer Plan result file is missing source and adjusted total rows');
  }
  const sourceTotalRow = totalRows[0]!;
  const adjustedTotalRow = totalRows[1]!;
  const editsByPeriod = new Map(edits.map((edit) => [edit.period, edit.cancelledQuantity]));
  const unknownPeriod = [...editsByPeriod.keys()].find((period) => !periodColumns.includes(period));
  if (unknownPeriod) throw badRequest(`Unknown Transfer Plan period: ${unknownPeriod}`);

  for (const period of periodColumns) {
    const sourceValue = numberValue(sourceTotalRow[period]);
    const cancelledQuantity = editsByPeriod.get(period);
    if (cancelledQuantity !== undefined) {
      adjustedTotalRow[period] = sourceValue + cancelledQuantity;
    }
  }
  sourceTotalRow[totalColumn] = periodColumns.reduce((total, period) => total + numberValue(sourceTotalRow[period]), 0);
  adjustedTotalRow[totalColumn] = periodColumns.reduce((total, period) => total + numberValue(adjustedTotalRow[period]), 0);

  const sheetRows = [
    [],
    [],
    [],
    columns,
    ...editedRows.map((row) => columns.map((column) => row[column] ?? null)),
  ];
  const worksheet = XLSX.utils.aoa_to_sheet(sheetRows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, '2025 BC Subplan Transfer');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
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
  const linkedRaw = row.linked_identities;
  const linkedIdentities = Array.isArray(linkedRaw)
    ? linkedRaw.map((identity) => ({
        id: Number((identity as Record<string, unknown>).id),
        employeeId: String((identity as Record<string, unknown>).employeeId ?? ''),
        source: String((identity as Record<string, unknown>).source ?? ''),
        name: String((identity as Record<string, unknown>).name ?? ''),
      }))
    : [];
  const source = String(row.source ?? 'futu');
  const labelsRaw = parseJson<Array<Record<string, unknown>>>(row.labels, []);
  const labels = labelsRaw
    .map((label) => ({
      id: Number(label.id),
      name: String(label.name ?? '').trim(),
      color: normalizeEmployeeLabelColor(label.color),
    }))
    .filter((label) => Number.isInteger(label.id) && label.id > 0 && label.name !== '');
  return {
    id: Number(row.id),
    employeeNumber: String(row.employee_id ?? ''),
    employeeName: String(row.employee_name ?? ''),
    userId: row.user_id ? String(row.user_id) : null,
    labelIds: Array.isArray(row.label_ids) ? row.label_ids.map((id) => Number(id)).filter((id) => Number.isInteger(id)) : [],
    labels,
    tags: parseTags(row.tags),
    grantCount: Number(row.grant_count ?? 0),
    source: (source === 'shareworks' ? 'shareworks' : source === 'manual' ? 'manual' : 'futu') as
      | 'futu'
      | 'shareworks'
      | 'manual',
    hasFileEvidence: row.has_file_evidence === true || row.has_file_evidence === 'true',
    active: row.is_active === undefined ? true : row.is_active === true || row.is_active === 'true',
    linkedIdentities,
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
    documentation: parseJson(row.documentation_json, undefined),
    createdAt: toIsoTimestamp(row.created_at),
    updatedAt: toIsoTimestamp(row.updated_at),
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
    createdAt: toIsoTimestamp(row.created_at),
    updatedAt: toIsoTimestamp(row.updated_at),
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

function normalizeWorkflowTasksForPersistence(value: unknown, context: string): WorkflowTask[] {
  if (!Array.isArray(value)) return [];
  const normalized = normalizeWorkflowTasks(value);
  if (value.length !== normalized.length) {
    const invalidIndexes = value
      .map((item, index) => (normalizeWorkflowTask(item) ? null : index + 1))
      .filter((index): index is number => index !== null);
    throw badRequest(`${context} contains invalid workflow tasks at index: ${invalidIndexes.join(', ')}`);
  }
  return normalized;
}

function toWorkflowPortableDefinition(workflow: unknown): WorkflowPortableDefinition {
  const source = workflow as Partial<WorkflowPortableDefinition>;
  return {
    code: String(source.code ?? '').trim(),
    name: String(source.name ?? '').trim(),
    description: String(source.description ?? ''),
    status: source.status === 'active' ? 'active' : 'draft',
    version: Number(source.version ?? 1),
    tasks: normalizeWorkflowTasksForPersistence(source.tasks ?? [], 'Imported workflow'),
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
  tasks: WorkflowTask[];
  runtimeParamsSchema: unknown;
  runtimeParamsDefaults: unknown;
}): { runtimeParamsSchema: Record<string, unknown>; runtimeParamsDefaults: WorkflowRuntimeParameters } {
  const runtimeParamsSchemaHints = normalizeWorkflowRuntimeParametersSchema(params.runtimeParamsSchema);
  const runtimeParamsDefaultHints = normalizeWorkflowRuntimeParameters(params.runtimeParamsDefaults);
  const runtimeConfig = deriveWorkflowRuntimeConfigFromTasks({
    tasks: params.tasks,
    runtimeParamsSchema: runtimeParamsSchemaHints,
    runtimeParamsDefaults: runtimeParamsDefaultHints,
  });
  const runtimeParamsSchema = normalizeWorkflowRuntimeParametersSchema(runtimeConfig.runtimeParamsSchema);
  const runtimeParamsDefaults = normalizeWorkflowRuntimeParameters(runtimeConfig.runtimeParamsDefaults);
  validateRuntimeParameters(runtimeParamsDefaults, runtimeParamsSchema);
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

function normalizeStorageFolderPrefix(prefix?: string): string | undefined {
  try {
    return normalizeProductFolder(prefix) || undefined;
  } catch {
    throw badRequest('Invalid folder path');
  }
}

function inputStorageFolderPrefix(prefix?: string): string {
  const normalized = normalizeStorageFolderPrefix(prefix);
  if (!normalized) return 'input';
  if (normalized === 'input' || normalized.startsWith('input/')) return normalized;
  return `input/${normalized}`;
}

async function saveProductWorkbook(params: {
  originalName: string;
  buffer: Buffer;
  mimeType?: string;
  uploadedBy?: string;
  folderPrefix?: string;
  conflictPolicy?: 'error' | 'overwrite';
}) {
  const mimeType =
    params.mimeType?.trim() ||
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
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
      [existing.id, originalName, stored.storedName, ext.replace(/^\./, ''), stored.filePath, logicalPath,
        params.buffer.length, mimeType, checksum, stored.storageBackend, summary.sheetCount,
        summary.totalRowCount, uploadedBy],
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

const workflowFileSources = new WorkflowFileSourceRegistry();
workflowFileSources.register({
  provider: 'product-files',
  async read(ref) {
    const fileKey = String(ref.key ?? '').trim();
    if (fileKey) {
      const file = await db.queryOne<Record<string, unknown>>(
        'select * from product_files where lower(logical_path) = lower($1)',
        [fileKey],
      );
      if (!file) throw notFound(`Product file not found: ${fileKey}`);
      return fileStorage.read(String(file.file_path));
    }
    const fileId = Number(ref.id);
    if (!Number.isInteger(fileId) || fileId <= 0) throw new Error('product-files source requires a positive id');
    const file = await getProductFileOrThrow(fileId);
    return fileStorage.read(String(file.file_path));
  },
});

const WORKFLOW_WRITABLE_TABLES: ReadonlySet<string> = new Set(['employees']);

const workflowOperatorRuntime: WorkflowOperatorRuntime = {
  extractSheetRangeAsDataFrame,
  rowsToDataFrame,
  dataFrameToWorkbookBuffer,
  readFile: (ref) => workflowFileSources.read(ref),
  async getProductFileBufferById(fileId) {
    const file = await getProductFileOrThrow(fileId);
    return fileStorage.read(String(file.file_path));
  },
  async saveGeneratedWorkbook(params) {
    const saved = await saveProductWorkbook(params);
    return toProductFile(saved.file);
  },
  upsertTableRows(params) {
    return upsertTableRows(db, params, WORKFLOW_WRITABLE_TABLES);
  },
  async invokeWorkflow(params) {
    const requestedKey = params.workflowId ? `id:${params.workflowId}` : String(params.workflowCode ?? '').trim();
    if (!requestedKey) {
      throw new Error('workflow.invoke requires workflowCode or workflowId');
    }
    if (params.invocationStack.includes(requestedKey)) {
      throw new Error(`workflow.invoke recursive workflow call detected: ${[...params.invocationStack, requestedKey].join(' -> ')}`);
    }

    const workflowRow = params.workflowId
      ? await db.queryOne<Record<string, unknown>>('select * from workflow_definitions where id = $1', [params.workflowId])
      : await db.queryOne<Record<string, unknown>>('select * from workflow_definitions where code = $1 and status = $2', [
          params.workflowCode,
          'active',
        ]);
    if (!workflowRow) {
      throw new Error(`workflow.invoke target workflow not found: ${params.workflowId ?? params.workflowCode}`);
    }

    const workflowId = Number(workflowRow.id);
    const workflowCode = String(workflowRow.code ?? '').trim();
    const workflowKeys = [requestedKey, workflowCode, `id:${workflowId}`].filter(Boolean);
    if (workflowKeys.some((key) => params.invocationStack.includes(key))) {
      throw new Error(
        `workflow.invoke recursive workflow call detected: ${[...params.invocationStack, workflowCode || `id:${workflowId}`].join(' -> ')}`,
      );
    }

    const storedTasks = normalizeWorkflowTasks(parseJson(workflowRow.tasks_json, []));
    const childRuntimeParamsSchema = parseJson(workflowRow.runtime_params_schema_json, {});
    const runtimeConfiguration = resolveWorkflowRuntimeConfiguration({
      tasks: storedTasks,
      runtimeParamsSchema: childRuntimeParamsSchema,
      runtimeParamsDefaults: parseJson(workflowRow.runtime_params_defaults_json, {}),
      runtimeParameters: filterWorkflowRuntimeParametersBySchema(params.runtimeParameters, childRuntimeParamsSchema),
    });
    const childResult = await executeWorkflowDefinition(runtimeConfiguration.tasks, workflowOperatorRuntime, {
      runtimeParameters: runtimeConfiguration.runtimeParameters,
      initialDataFrames: params.inputDataFrames,
      invocationStack: Array.from(new Set([...params.invocationStack, ...workflowKeys])),
    });

    if (childResult.errorMessage) {
      throw new Error(childResult.errorMessage);
    }

    if (params.outputTaskId) {
      const selected = childResult.taskResults[params.outputTaskId];
      if (!selected?.dataFrame) {
        throw new Error(`workflow.invoke output task not found or did not produce dataframe: ${params.outputTaskId}`);
      }
      return selected;
    }

    if (!childResult.result?.dataFrame) {
      throw new Error(`workflow.invoke target workflow did not produce dataframe output: ${workflowCode || workflowId}`);
    }
    return childResult.result;
  },
};

const workflowRunStore = new WorkflowRunStore(db);
const workflowRunExecutor = new WorkflowRunExecutor(workflowRunStore, workflowOperatorRuntime, undefined, {
  onRunFinalized: (run) => applyMonthlyRunPostProcessing(db, run),
});

async function removeStoredFilesAfterCommit(filePaths: string[]): Promise<void> {
  for (const filePath of [...new Set(filePaths)]) {
    try {
      await fileStorage.remove(filePath);
    } catch (error) {
      app.log.error({ error, filePath }, 'Post-commit file cleanup failed');
    }
  }
}

async function registerRoutes() {
  await app.register(cors, { origin: true });
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });

  app.addHook('preHandler', async (request, reply) => {
    const url = request.raw.url ?? '';
    if (!url.startsWith('/api/')) return;
    if (url === '/api/health') return;
    if (url.startsWith('/api/auth/')) return;
    await requireAuth(request as typeof request & RequestWithAuth, reply);
    if (reply.sent) return;
    if (requiresAdminRole(request.method, url)) {
      requireAdminUser(request as typeof request & RequestWithAuth, reply);
    }
  });

  app.get('/api/health', async () => ({
    ok: true,
    service: 'gyre-captable',
    database: maskDatabaseUrl(config.databaseUrl),
    excel: 'xlsx@0.20.3',
  }));

  app.get('/api/auth/status', async (request) => currentAuthStatus(request));

  app.post('/api/auth/bootstrap', async (request, reply) => {
    const body = authBootstrapSchema.parse(request.body ?? {});
    if (!config.authBootstrapSecret) {
      return reply.code(503).send({
        error: 'Administrator bootstrap is disabled until AUTH_BOOTSTRAP_SECRET is configured',
        code: 'BOOTSTRAP_SECRET_REQUIRED',
      });
    }
    if (!bootstrapSecretMatches(config.authBootstrapSecret, body.bootstrapSecret)) {
      return reply.code(403).send({ error: 'Invalid bootstrap secret' });
    }

    const user = await createBootstrapAdmin(db, {
      username: body.username,
      passwordHash: await hashPassword(body.password),
      displayName: body.displayName?.trim() || body.username,
    });
    if (!user) return reply.code(409).send({ error: 'Bootstrap already completed' });
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
    if (config.authDisabled) {
      return {
        account: {
          id: DEV_AUTH_USER.id,
          username: DEV_AUTH_USER.username,
          displayName: DEV_AUTH_USER.display_name,
          role: DEV_AUTH_USER.role,
          email: DEV_AUTH_USER.email,
          phone: DEV_AUTH_USER.phone,
        },
      };
    }
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

  app.get('/api/admin/users', async (request, reply) => {
    if (!requireAdminUser(request as typeof request & RequestWithAuth, reply)) return;
    return { users: await listManagedUsers(db) };
  });

  app.post('/api/admin/users', async (request, reply) => {
    if (!requireAdminUser(request as typeof request & RequestWithAuth, reply)) return;
    const body = adminUserCreateSchema.parse(request.body ?? {});
    try {
      const user = await createManagedUser(db, {
        username: body.username,
        password: body.password,
        displayName: body.displayName,
        role: body.role,
        email: body.email || null,
        phone: body.phone || null,
      });
      return reply.code(201).send({ user });
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        return reply.code(409).send({ error: '账号名已存在' });
      }
      throw error;
    }
  });

  app.patch('/api/admin/users/:id', async (request, reply) => {
    const currentUser = (request as typeof request & RequestWithAuth).currentUser;
    if (!requireAdminUser(request as typeof request & RequestWithAuth, reply)) return;
    const { id } = userIdParamSchema.parse(request.params);
    const body = adminUserPatchSchema.parse(request.body ?? {});
    const existing = await getManagedUser(db, id);
    if (!existing) return reply.code(404).send({ error: 'User not found' });
    const nextRole = body.role ?? existing.role;
    const nextActive = body.isActive ?? existing.isActive;
    if (
      existing.role === 'admin'
      && existing.isActive
      && (nextRole !== 'admin' || !nextActive)
      && (await countActiveAdmins(db, id)) === 0
    ) {
      return reply.code(400).send({ error: '至少需要保留一个可用的管理员' });
    }
    if (currentUser?.id === id && (!nextActive || nextRole !== 'admin')) {
      return reply.code(400).send({ error: '不能取消当前登录管理员的管理员权限或停用当前账号' });
    }
    try {
      const user = await updateManagedUser(db, id, {
        username: body.username,
        password: body.password || undefined,
        displayName: body.displayName,
        role: body.role,
        email: body.email === undefined ? undefined : body.email || null,
        phone: body.phone === undefined ? undefined : body.phone || null,
        isActive: body.isActive,
      });
      return { user };
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        return reply.code(409).send({ error: '账号名已存在' });
      }
      throw error;
    }
  });

  app.delete('/api/admin/users/:id', async (request, reply) => {
    const currentUser = (request as typeof request & RequestWithAuth).currentUser;
    if (!requireAdminUser(request as typeof request & RequestWithAuth, reply)) return;
    const { id } = userIdParamSchema.parse(request.params);
    const existing = await getManagedUser(db, id);
    if (!existing) return reply.code(404).send({ error: 'User not found' });
    if (currentUser?.id === id) {
      return reply.code(400).send({ error: '不能删除当前登录账号' });
    }
    if (existing.role === 'admin' && existing.isActive && (await countActiveAdmins(db, id)) === 0) {
      return reply.code(400).send({ error: '至少需要保留一个可用的管理员' });
    }
    await deleteManagedUser(db, id);
    return reply.code(204).send();
  });

  app.get('/api/months', async () => {
    const rows = await db.query('select month_key as month, eom_date as "eomDate", status from months order by month_key desc');
    return { months: rows };
  });

  app.get('/api/monthly-runs', async (request) => {
    const query = monthlyRunListQuerySchema.parse(request.query);
    return { items: await listMonthlyRuns(db, { ...query, sourceLabels: await monthlyRunInputSourceLabels() }) };
  });

  app.get('/api/monthly-runs/instances', async (request): Promise<{ items: MonthlyRunInstanceRecord[] }> => {
    const query = monthlyRunListQuerySchema.parse(request.query);
    return { items: await listMonthlyRunInstances(db, { month: query.month }) };
  });

  app.post('/api/monthly-runs/instances', async (request, reply): Promise<{ instance: MonthlyRunInstanceRecord }> => {
    const body = updatePlanSchema.parse(request.body ?? {});
    await getOrCreateMonth(body.month);
    const instance = await ensureMonthlyRunInstance(db, body.month);
    return reply.code(201).send({ instance });
  });

  app.delete('/api/monthly-runs/instances/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const operation = await db.transaction((tx) => deleteMonthlyRunPlan(tx, Number(id)));
      if (!operation) throw notFound('Monthly run instance not found');
      const { deletedFilePaths, ...deleted } = operation;
      await removeStoredFilesAfterCommit(deletedFilePaths);
      return reply.send({ deleted });
    } catch (error) {
      if (error instanceof MonthlyRunHistoryDeleteConflictError) {
        return reply.code(409).send({ error: error.message });
      }
      throw error;
    }
  });

  app.get('/api/monthly-runs/instance', async (request): Promise<{ instance: MonthlyRunInstanceRecord }> => {
    const query = monthlyRunInstanceQuerySchema.parse(request.query);
    await getOrCreateMonth(query.month);
    const instance = await ensureMonthlyRunInstance(db, query.month);
    return { instance };
  });

  app.put('/api/monthly-runs/instance', async (request): Promise<{ instance: MonthlyRunInstanceRecord }> => {
    const query = monthlyRunInstanceQuerySchema.parse(request.query);
    const body = monthlyRunInstanceUpsertSchema.parse(request.body ?? {}) as MonthlyRunInstanceUpsertRequest;
    await getOrCreateMonth(query.month);
    const instance = await upsertMonthlyRunInstance(db, query.month, body);
    return { instance };
  });

  app.get('/api/monthly-runs/source-config', async (): Promise<MonthlyRunSourceConfigResponse> => {
    const row = await db.queryOne<Record<string, unknown>>(
      "select name, runtime_params_schema_json from workflow_definitions where code = $1 and status = 'active' limit 1",
      [MONTHLY_WORKFLOW_CODE],
    );
    return {
      workflowCode: MONTHLY_WORKFLOW_CODE,
      workflowName: row?.name ? String(row.name) : MONTHLY_WORKFLOW_CODE,
      sources: monthlySourcesFromSchema(row?.runtime_params_schema_json),
      fixedValues: [],
    };
  });

  app.get('/api/monthly-runs/latest-output', async (): Promise<{ output: LatestMonthlyRunOutput | null }> => ({
    output: await getLatestMonthlyRunOutput(db),
  }));

  app.get('/api/monthly-runs/:id', async (request) => {
    const runId = Number((request.params as { id: string }).id);
    const history = await getMonthlyRun(db, runId, { sourceLabels: await monthlyRunInputSourceLabels() });
    if (!history) throw notFound('Monthly run not found');
    return history;
  });

  app.post('/api/monthly-runs', async (request, reply) => {
    const body = monthlyRunTriggerBodySchema.parse(request.body ?? {});
    if (!body.month) throw new Error('month is required');
    await getOrCreateMonth(body.month);
    const monthlyRunInstance = (await getMonthlyRunInstance(db, body.month)) ?? (await ensureMonthlyRunInstance(db, body.month));

    await assertMonthlyRunInstanceReady(monthlyRunInstance);
    const resolvedRuntimeParameters: WorkflowRuntimeParameters = monthlyRunInstanceToRuntimeParameters(monthlyRunInstance);
    resolvedRuntimeParameters.fixedValues = {
      ...(resolvedRuntimeParameters.fixedValues as Record<string, number> | undefined),
      ...(await loadMonthlyRunRuntimeFixedValues(db)),
    };

    // Previous Capitalization Summary 由业务自动引入：若上一个月的月度执行已产出汇总表，则用它作为
    // 本源（用于校验本月 EQ Control Book 的 Last Month）；无则置空、跳过对账校验。该源在 UI 隐藏。
    const prevFileRefs = resolvedRuntimeParameters.fileRefs as Record<string, unknown> | undefined;
    if (prevFileRefs && !prevFileRefs.previous_capitalization_summary) {
      const previousOutput = await getMonthlyRunOutputForMonth(db, previousMonthKey(monthlyRunInstance.monthKey));
      if (previousOutput?.logicalPath) {
        prevFileRefs.previous_capitalization_summary = { provider: 'product-files', key: previousOutput.logicalPath };
      }
    }

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
      runtimeFileRefs && typeof runtimeFileRefs === 'object' && !Array.isArray(runtimeFileRefs)
        ? Number(
            ((runtimeFileRefs as Record<string, unknown>).control_book as Record<string, unknown> | undefined)?.id ??
              ((Object.values(runtimeFileRefs)[0] as Record<string, unknown> | undefined)?.id ?? null),
          )
        : null;
    const history = await createMonthlyRunHistory(db, {
      monthId,
      monthKey,
      updatePlanId: null,
      workflowId: Number(workflowRow.id),
      sourceFileId: primarySourceFileId && Number.isInteger(primarySourceFileId) ? primarySourceFileId : null,
      operator: monthlyRunInstance.operator ?? body.operator,
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

    await updateMonthlyRunInstanceExecutionState(db, {
      monthKey,
      status: 'running',
      latestWorkflowRunId: workflowRun.id,
      latestOutputFileId: null,
      latestErrorMessage: null,
      lastTriggeredAt: history.triggeredAt,
    });

    workflowRunExecutor.startAsync(workflowRun.id);
    return reply.code(201).send({
      history: attachedHistory,
      executionResult: workflowRunToExecutionResult(await workflowRunStore.getRun(workflowRun.id)),
    });
  });

  app.post('/api/monthly-runs/:id/approvals', async (request) => {
    const historyId = Number((request.params as { id: string }).id);
    const history = await getMonthlyRun(db, historyId, { sourceLabels: await monthlyRunInputSourceLabels() });
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
    try {
      const operation = await db.transaction((tx) => deleteMonthlyRunHistory(tx, historyId));
      if (!operation) throw notFound('Monthly run not found');
      const { deletedOutputFilePath, ...deleted } = operation;
      if (deletedOutputFilePath) await removeStoredFilesAfterCommit([deletedOutputFilePath]);
      return reply.send({ deleted });
    } catch (error) {
      if (error instanceof MonthlyRunHistoryDeleteConflictError) {
        return reply.code(409).send({ error: error.message });
      }
      throw error;
    }
  });

  app.get('/api/files', async () => {
    const rows = await db.query<Record<string, unknown>>('select * from product_files order by created_at desc, id desc');
    return { files: rows.map(toProductFile) };
  });

  app.post('/api/files/upload', async (request, reply) => {
    let uploadedBy = 'Administrator';
    let folderPrefix: string | undefined;
    let conflictPolicy: 'error' | 'overwrite' = 'error';
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
      } else if (part.fieldname === 'conflictPolicy' && part.value === 'overwrite') {
        conflictPolicy = 'overwrite';
      }
    }

    if (!uploaded) return reply.code(400).send({ error: 'No file uploaded' });
    if (!/\.(xlsx|xls|csv)$/i.test(uploaded.fileName)) {
      return reply.code(400).send({ error: 'Only .xlsx, .xls, and .csv files are supported' });
    }
    if (conflictPolicy === 'overwrite' && !requireAdminUser(request as typeof request & RequestWithAuth, reply)) {
      return;
    }

    let saved;
    try {
      saved = await saveProductWorkbook({
        originalName: uploaded.fileName,
        buffer: uploaded.buffer,
        mimeType: uploaded.mimeType,
        uploadedBy,
        folderPrefix: inputStorageFolderPrefix(folderPrefix),
        conflictPolicy,
      });
    } catch (error) {
      const uploadError = error as Error & { statusCode?: number; existingFile?: Record<string, unknown> };
      if (uploadError.statusCode === 409) {
        return reply.code(409).send({
          error: uploadError.message,
          code: 'FILE_ALREADY_EXISTS',
          existingFile: uploadError.existingFile ? toProductFile(uploadError.existingFile) : undefined,
        });
      }
      throw error;
    }

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
    const file = await getProductFileOrThrow(fileId);
    const body = productFilePatchSchema.parse(request.body ?? {});
    const originalName = normalizeProductFileName(body.originalName);
    const currentLogicalPath = String(file.logical_path ?? productFileDisplayPath(file));
    const directory = currentLogicalPath.split('/').slice(0, -1).join('/');
    const logicalPath = canonicalProductFilePath(directory, originalName);
    const existing = await db.queryOne<{ id: number }>(
      'select id from product_files where lower(logical_path) = lower($1) and id <> $2',
      [logicalPath, fileId],
    );
    if (existing) throw conflict(`File already exists: ${logicalPath}`);
    const oldFilePath = String(file.file_path);
    const buffer = await fileStorage.read(oldFilePath);
    const stored = await fileStorage.save('product', originalName, buffer, { prefix: directory });
    const ext = path.extname(originalName).toLowerCase();
    const row = await db.queryOne<Record<string, unknown>>(
      `update product_files
          set original_name = $2,
              stored_name = $2,
              file_ext = $3,
              file_path = $4,
              logical_path = $5,
              storage_backend = $6,
              created_at = current_timestamp
        where id = $1
        returning *`,
      [fileId, originalName, ext.replace(/^\./, ''), stored.filePath, logicalPath, stored.storageBackend],
    );
    if (!row) throw notFound('Product file not found');
    if (oldFilePath !== stored.filePath) await fileStorage.remove(oldFilePath);
    return { file: toProductFile(row) };
  });

  app.post('/api/files/:id/move', async (request, reply) => {
    const fileId = Number((request.params as { id: string }).id);
    const file = await getProductFileOrThrow(fileId);
    const body = productFileMoveSchema.parse(request.body ?? {});
    const originalName = String(file.original_name);
    const oldLogicalPath = String(file.logical_path ?? productFileDisplayPath(file));

    let folderPrefix: string;
    try {
      const requestedFolder = normalizeProductFolder(body.folder);
      // Output workbooks stay in the output class; everything else is an input.
      folderPrefix = oldLogicalPath.startsWith('output/')
        ? normalizeProductFileStoragePrefix(requestedFolder)
        : inputStorageFolderPrefix(requestedFolder);
    } catch {
      throw badRequest('Invalid folder path');
    }

    const logicalPath = canonicalProductFilePath(folderPrefix, originalName);
    if (productFileCollisionKey(logicalPath) === productFileCollisionKey(oldLogicalPath)) {
      return { file: toProductFile(file), rewrittenWorkflows: 0 };
    }

    const existing = await db.queryOne<{ id: number }>(
      'select id from product_files where lower(logical_path) = lower($1) and id <> $2',
      [logicalPath, fileId],
    );
    if (existing) {
      const existingFile = await getProductFileOrThrow(existing.id);
      return reply.code(409).send({
        error: `File already exists: ${logicalPath}`,
        code: 'FILE_ALREADY_EXISTS',
        existingFile: toProductFile(existingFile),
      });
    }

    const oldFilePath = String(file.file_path);
    const buffer = await fileStorage.read(oldFilePath);
    const stored = await fileStorage.save('product', originalName, buffer, { prefix: folderPrefix });

    const moved = await db.transaction(async (tx) => {
      const row = await tx.queryOne<Record<string, unknown>>(
        `update product_files
            set file_path = $2,
                logical_path = $3,
                storage_backend = $4
          where id = $1
          returning *`,
        [fileId, stored.filePath, logicalPath, stored.storageBackend],
      );
      if (!row) throw notFound('Product file not found');
      const rewrittenWorkflows = await rewriteProductFileKeyInWorkflows(tx, oldLogicalPath, logicalPath);
      return { row, rewrittenWorkflows };
    });

    if (oldFilePath !== stored.filePath) await fileStorage.remove(oldFilePath);
    return { file: toProductFile(moved.row), rewrittenWorkflows: moved.rewrittenWorkflows };
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

  app.delete('/api/files', async (request, reply) => {
    const { ids } = productFileBulkDeleteSchema.parse(request.body ?? {});
    const uniqueIds = [...new Set(ids)];
    const files = await db.transaction(async (tx) => {
      const rows = await tx.query<Record<string, unknown>>(
        'select * from product_files where id = any($1::int[])',
        [uniqueIds],
      );
      if (rows.length > 0) {
        await tx.execute('delete from product_files where id = any($1::int[])', [uniqueIds]);
      }
      return rows;
    });

    await Promise.all(files.map((file) => fileStorage.remove(String(file.file_path))));
    return reply.send({ deletedIds: files.map((file) => Number(file.id)) });
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
    let capitalizationOverride: Partial<Pick<SummarySnapshot, 'capitalization' | 'totalFullyDiluted' | 'reconciliation'>> | null = null;

    if (monthRow.capitalization_source_file_id) {
      sourceFile = await db.queryOne<Record<string, unknown>>('select * from product_files where id = $1', [
        monthRow.capitalization_source_file_id,
      ]);
      if (sourceFile) {
        const buffer = await fileStorage.read(String(sourceFile.file_path));
        const parsed = parseCapitalizationWorkbook(buffer, monthRow.capitalization_source_sheet_name);
        capitalizationOverride = {
          capitalization: parsed.capitalization,
          totalFullyDiluted: parsed.totalFullyDiluted,
          ...(parsed.reconciliation ? { reconciliation: parsed.reconciliation } : {}),
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

  app.get('/api/holdings', async (request) => {
    const { page, pageSize } = paginationQuerySchema.parse(request.query ?? {});
    const { query = '', grantType = '', tagId = '', tag = '' } = request.query as {
      query?: string;
      grantType?: string;
      tagId?: string;
      tag?: string;
    };
    const normalizedQuery = query.trim().toLowerCase();
    const normalizedLabelId = Number(tagId);
    const labelIdFilter = Number.isInteger(normalizedLabelId) && normalizedLabelId > 0 ? normalizedLabelId : 0;
    const normalizedTag = tag.trim();
    const artifact = await readLatestWorkflowDataFrameArtifact({
      workflowCode: 'esop-grant-record-sync',
      taskId: 'persist_grant_record_futu_file',
      fallbackSheetName: 'Futu Grants',
    });
    const inputSourceBindings = await latestWorkflowInputSourceBindings('esop-grant-record-sync');
    const inputSourceFiles = inputSourceBindings.map((binding) => binding.fileName).filter(Boolean) as string[];
    const labelsByEmployee = await employeeLabelsByNumber();
    const canonicalByNumber = await employeeCanonicalByNumber();
    const linkGroup = await employeeLinkGroupByNumber();
    const rows = expandByLinkedGroup(
      (artifact?.rows ?? [])
        .map((row, index) => {
          const employeeNumber = textValue(row['工号']) ?? '';
          return {
            ...futuGrantFromWorkflowRow(row, index, labelsByEmployee.get(employeeNumber) ?? []),
            linkedIdentities: linkGroup.get(employeeNumber) ?? [],
          };
        })
        .filter((row) => {
          if (grantType && row.incentiveType !== grantType) return false;
          if (labelIdFilter && !row.labelIds.includes(labelIdFilter)) return false;
          if (!labelIdFilter && normalizedTag && !row.tags.includes(normalizedTag)) return false;
          return true;
        }),
      normalizedQuery,
      canonicalByNumber,
      (row) =>
        [
          row.employeeName,
          row.employeeNumber,
          row.tags.join(' '),
          row.grantNumber,
          row.planName,
          row.vestingRuleName,
        ].join(' ').toLowerCase().includes(normalizedQuery),
    ).sort(
      (left, right) =>
        left.employeeNumber.localeCompare(right.employeeNumber) ||
        String(left.grantDate ?? '').localeCompare(String(right.grantDate ?? '')) ||
        left.grantNumber.localeCompare(right.grantNumber),
    );
    const sortedRows = sortRowsByNameOrEmpNo(
      rows,
      readNameEmpNoSort(request.query),
      (row) => row.employeeName ?? '',
      (row) => row.employeeNumber ?? '',
    );
    const paginated = paginateItems(sortedRows, page, pageSize);
    return {
      holdings: paginated.items,
      sourceFiles: inputSourceFiles,
      workflowSourceBindings: inputSourceBindings,
      resultFileName: artifact?.fileName ?? null,
      workflowResultFiles: resultFilesFromArtifacts(artifact),
      resultFiles: sourceFilesFromArtifacts(artifact),
      total: paginated.total,
      page: paginated.page,
      pageSize: paginated.pageSize,
      totalPages: paginated.totalPages,
    };
  });

  app.get('/api/grants/shareworks', async (request) => {
    const { page, pageSize } = paginationQuerySchema.parse(request.query ?? {});
    const { query = '', tagId = '', tag = '' } = request.query as { query?: string; tagId?: string; tag?: string };
    const normalizedQuery = query.trim().toLowerCase();
    const normalizedLabelId = Number(tagId);
    const labelIdFilter = Number.isInteger(normalizedLabelId) && normalizedLabelId > 0 ? normalizedLabelId : 0;
    const normalizedTag = tag.trim();
    const artifact = await readLatestWorkflowDataFrameArtifact({
      workflowCode: 'esop-grant-record-sync',
      taskId: 'persist_grant_record_shareworks_file',
      fallbackSheetName: 'Shareworks Grants',
    });
    const inputSourceBindings = await latestWorkflowInputSourceBindings('esop-grant-record-sync');
    const inputSourceFiles = inputSourceBindings.map((binding) => binding.fileName).filter(Boolean) as string[];
    const labelsByEmployee = await employeeLabelsByNumber();
    const canonicalByNumber = await employeeCanonicalByNumber();
    const linkGroup = await employeeLinkGroupByNumber();
    const rows = expandByLinkedGroup(
      (artifact?.rows ?? [])
        .map((row, index) => {
          const employeeNumber = textValue(row['Employee Number']) ?? '';
          return {
            ...shareworksGrantFromWorkflowRow(row, index, labelsByEmployee.get(employeeNumber) ?? []),
            linkedIdentities: linkGroup.get(employeeNumber) ?? [],
          };
        })
        .filter((row) => Boolean(row.employeeGrantNumber))
        .filter((row) => {
          if (labelIdFilter && !row.labelIds.includes(labelIdFilter)) return false;
          if (!labelIdFilter && normalizedTag && !row.tags.includes(normalizedTag)) return false;
          return true;
        }),
      normalizedQuery,
      canonicalByNumber,
      (row) =>
        [
          row.lastName,
          row.firstName,
          row.middleName,
          row.employeeNumber,
          row.employeeGrantNumber,
          row.planName,
          row.grantName,
          row.grantType,
        ].join(' ').toLowerCase().includes(normalizedQuery),
    ).sort(
      (left, right) =>
        String(left.employeeNumber ?? '').localeCompare(String(right.employeeNumber ?? '')) ||
        String(left.grantDate ?? '').localeCompare(String(right.grantDate ?? '')) ||
        String(left.employeeGrantNumber ?? '').localeCompare(String(right.employeeGrantNumber ?? '')),
    );
    const sortedRows = sortRowsByNameOrEmpNo(
      rows,
      readNameEmpNoSort(request.query),
      (row) => `${row.lastName ?? ''} ${row.firstName ?? ''}`.trim(),
      (row) => String(row.employeeNumber ?? ''),
    );
    const paginated = paginateItems(sortedRows, page, pageSize);
    return {
      items: paginated.items,
      sourceFiles: inputSourceFiles,
      workflowSourceBindings: inputSourceBindings,
      resultFileName: artifact?.fileName ?? null,
      workflowResultFiles: resultFilesFromArtifacts(artifact),
      resultFiles: sourceFilesFromArtifacts(artifact),
      total: paginated.total,
      page: paginated.page,
      pageSize: paginated.pageSize,
      totalPages: paginated.totalPages,
    };
  });

  app.get('/api/grants/merge', async (request) => {
    const { page, pageSize } = paginationQuerySchema.parse(request.query ?? {});
    const { query = '', tagId = '', tag = '' } = request.query as { query?: string; tagId?: string; tag?: string };
    const normalizedQuery = query.trim().toLowerCase();
    const normalizedLabelId = Number(tagId);
    const labelIdFilter = Number.isInteger(normalizedLabelId) && normalizedLabelId > 0 ? normalizedLabelId : 0;
    const normalizedTag = tag.trim();
    const [futuArtifact, shareworksArtifact, labelsByEmployee] = await Promise.all([
      readLatestWorkflowDataFrameArtifact({
        workflowCode: 'esop-grant-record-sync',
        taskId: 'persist_grant_record_futu_file',
        fallbackSheetName: 'Futu Grants',
      }),
      readLatestWorkflowDataFrameArtifact({
        workflowCode: 'esop-grant-record-sync',
        taskId: 'persist_grant_record_shareworks_file',
        fallbackSheetName: 'Shareworks Grants',
      }),
      employeeLabelsByNumber(),
    ]);
    const futuRows = (futuArtifact?.rows ?? [])
      .map((row, index) => {
        const employeeNumber = textValue(row['工号']) ?? '';
        return futuGrantFromWorkflowRow(row, index, labelsByEmployee.get(employeeNumber) ?? []);
      })
      .filter((row) => {
        if (labelIdFilter && !row.labelIds.includes(labelIdFilter)) return false;
        if (!labelIdFilter && normalizedTag && !row.tags.includes(normalizedTag)) return false;
        return true;
      });
    const shareworksRows = (shareworksArtifact?.rows ?? [])
      .map((row, index) => {
        const employeeNumber = textValue(row['Employee Number']) ?? '';
        return shareworksGrantFromWorkflowRow(row, index, labelsByEmployee.get(employeeNumber) ?? []);
      })
      .filter((row) => Boolean(row.employeeGrantNumber))
      .filter((row) => {
        if (labelIdFilter && !row.labelIds.includes(labelIdFilter)) return false;
        if (!labelIdFilter && normalizedTag && !row.tags.includes(normalizedTag)) return false;
        return true;
      });
    const canonicalByNumber = await employeeCanonicalByNumber();
    const linkGroup = await employeeLinkGroupByNumber();
    const items = expandByLinkedGroup(
      [
        ...futuRows.map((row) => ({ ...mergeFutuGrant(row), linkedIdentities: linkGroup.get(row.employeeNumber) ?? [] })),
        ...shareworksRows.map((row) => ({ ...mergeShareworksGrant(row), linkedIdentities: linkGroup.get(row.employeeNumber ?? '') ?? [] })),
      ],
      normalizedQuery,
      canonicalByNumber,
      (row) =>
        [
          row.employeeName,
          row.employeeNumber,
          row.grantNumber,
          row.incentiveType,
          row.planName,
          row.vestingRuleName,
          row.source,
        ]
          .join(' ')
          .toLowerCase()
          .includes(normalizedQuery),
    ).sort(
      (left, right) =>
        left.employeeNumber.localeCompare(right.employeeNumber) ||
        String(left.grantDate ?? '').localeCompare(String(right.grantDate ?? '')) ||
        left.grantNumber.localeCompare(right.grantNumber),
    );
    const sortedItems = sortRowsByNameOrEmpNo(
      items,
      readNameEmpNoSort(request.query),
      (row) => row.employeeName ?? '',
      (row) => row.employeeNumber ?? '',
    );
    const total = sortedItems.length;
    const offset = (page - 1) * pageSize;
    const inputSourceBindings = await latestWorkflowInputSourceBindings('esop-grant-record-sync');
    return {
      items: sortedItems.slice(offset, offset + pageSize),
      sourceFiles: inputSourceBindings.map((binding) => binding.fileName).filter(Boolean) as string[],
      workflowSourceBindings: inputSourceBindings,
      workflowResultFiles: resultFilesFromArtifacts(futuArtifact, shareworksArtifact),
      resultFiles: sourceFilesFromArtifacts(futuArtifact, shareworksArtifact),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  });

  app.get('/api/exercises', async (request) => {
    const { page, pageSize } = paginationQuerySchema.parse(request.query ?? {});
    const { query = '', grantYear = '', tagId = '', tag = '' } = request.query as {
      query?: string;
      grantYear?: string;
      tagId?: string;
      tag?: string;
    };
    const normalizedQuery = query.trim().toLowerCase();
    const normalizedGrantYear = grantYear.trim();
    const normalizedLabelId = Number(tagId);
    const labelIdFilter = Number.isInteger(normalizedLabelId) && normalizedLabelId > 0 ? normalizedLabelId : 0;
    const normalizedTag = tag.trim();
    const artifact = await readLatestWorkflowDataFrameArtifact({
      workflowCode: 'esop-exercise-record-sync',
      taskId: 'persist_exercise_record_file',
      fallbackSheetName: 'Futu BCI Exercises to Date',
    });
    const inputSourceBindings = await latestWorkflowInputSourceBindings('esop-exercise-record-sync');
    const inputSourceFiles = inputSourceBindings.map((binding) => binding.fileName).filter(Boolean) as string[];
    const labelsByEmployee = await employeeLabelsByNumber();
    const canonicalByNumber = await employeeCanonicalByNumber();
    const linkGroup = await employeeLinkGroupByNumber();
    const rows = expandByLinkedGroup(
      (artifact?.rows ?? [])
        .map((row, index) => {
          const employeeNumber = textValue(row['Employee No.']) ?? '';
          return {
            ...exerciseFromWorkflowRow(row, index, labelsByEmployee.get(employeeNumber) ?? []),
            linkedIdentities: linkGroup.get(employeeNumber) ?? [],
          };
        })
        .filter((row) => {
          if (labelIdFilter && !row.labelIds.includes(labelIdFilter)) return false;
          if (!labelIdFilter && normalizedTag && !row.tags.includes(normalizedTag)) return false;
          return true;
        })
        .filter((row) => !normalizedGrantYear || row.grantDate.slice(0, 4) === normalizedGrantYear),
      normalizedQuery,
      canonicalByNumber,
      (row) =>
        [
          row.name,
          row.employeeNumber,
          row.futubullId,
          row.userId,
          row.grantNumber,
          row.grantDate,
          row.exerciseDate,
        ].join(' ').toLowerCase().includes(normalizedQuery),
    ).sort(
      (left, right) =>
        String(right.exerciseDate ?? '').localeCompare(String(left.exerciseDate ?? '')) ||
        left.employeeNumber.localeCompare(right.employeeNumber) ||
        left.grantNumber.localeCompare(right.grantNumber) ||
        left.id - right.id,
    );
    const sortedRows = sortRowsByNameOrEmpNo(
      rows,
      readNameEmpNoSort(request.query),
      (row) => row.name ?? '',
      (row) => row.employeeNumber ?? '',
    );
    const paginated = paginateItems(sortedRows, page, pageSize);
    return {
      items: paginated.items,
      sourceFiles: inputSourceFiles,
      workflowSourceBindings: inputSourceBindings,
      resultFileName: artifact?.fileName ?? null,
      workflowResultFiles: resultFilesFromArtifacts(artifact),
      resultFiles: sourceFilesFromArtifacts(artifact),
      total: paginated.total,
      page: paginated.page,
      pageSize: paginated.pageSize,
      totalPages: paginated.totalPages,
    };
  });

  app.get('/api/sold-shares', async (request) => {
    const { page, pageSize } = paginationQuerySchema.parse(request.query ?? {});
    const { query = '', employmentStatus = '', tagId = '', tag = '' } = request.query as {
      query?: string;
      employmentStatus?: string;
      tagId?: string;
      tag?: string;
    };
    const normalizedQuery = query.trim().toLowerCase();
    const normalizedEmploymentStatus = employmentStatus.trim();
    const normalizedLabelId = Number(tagId);
    const labelIdFilter = Number.isInteger(normalizedLabelId) && normalizedLabelId > 0 ? normalizedLabelId : 0;
    const normalizedTag = tag.trim();
    const artifact = await readLatestWorkflowDataFrameArtifact({
      workflowCode: 'esop-sold-shares-sync',
      taskId: 'persist_sold_shares_file',
      fallbackSheetName: 'Futu Sold Shares',
    });
    const inputSourceBindings = await latestWorkflowInputSourceBindings('esop-sold-shares-sync');
    const inputSourceFiles = inputSourceBindings.map((binding) => binding.fileName).filter(Boolean) as string[];
    const labelsByEmployee = await employeeLabelsByNumber();
    const canonicalByNumber = await employeeCanonicalByNumber();
    const linkGroup = await employeeLinkGroupByNumber();
    const rows = expandByLinkedGroup(
      (artifact?.rows ?? [])
        .map((row, index) => {
          const employeeNumber = textValue(row['工号']) ?? '';
          return {
            ...soldShareFromWorkflowRow(row, index, labelsByEmployee.get(employeeNumber) ?? []),
            linkedIdentities: linkGroup.get(employeeNumber) ?? [],
          };
        })
        .filter((row) => {
          if (labelIdFilter && !row.labelIds.includes(labelIdFilter)) return false;
          if (!labelIdFilter && normalizedTag && !row.tags.includes(normalizedTag)) return false;
          return true;
        })
        .filter((row) => !normalizedEmploymentStatus || row.employmentStatus === normalizedEmploymentStatus),
      normalizedQuery,
      canonicalByNumber,
      (row) =>
        [
          row.name,
          row.employeeNumber,
          row.futubullId,
          row.userId,
          row.employmentStatus,
          row.relatedPartyIdentity,
        ].join(' ').toLowerCase().includes(normalizedQuery),
    ).sort((left, right) => left.employeeNumber.localeCompare(right.employeeNumber) || left.id - right.id);
    const sortedRows = sortRowsByNameOrEmpNo(
      rows,
      readNameEmpNoSort(request.query),
      (row) => row.name ?? '',
      (row) => row.employeeNumber ?? '',
    );
    const paginated = paginateItems(sortedRows, page, pageSize);
    return {
      items: paginated.items,
      sourceFiles: inputSourceFiles,
      workflowSourceBindings: inputSourceBindings,
      resultFileName: artifact?.fileName ?? null,
      workflowResultFiles: resultFilesFromArtifacts(artifact),
      resultFiles: sourceFilesFromArtifacts(artifact),
      total: paginated.total,
      page: paginated.page,
      pageSize: paginated.pageSize,
      totalPages: paginated.totalPages,
    };
  });

  app.get('/api/transfer-plan', async () => {
    const artifact = await readLatestWorkflowDataFrameArtifact({
      workflowCode: 'esop-transfer-to-futu-sync',
      taskId: 'persist_transfer_plan_file',
      fallbackSheetName: '2025 BC Subplan Transfer',
    });
    const inputSourceBindings = await latestWorkflowInputSourceBindings('esop-transfer-to-futu-sync');
    const inputSourceFiles = inputSourceBindings.map((binding) => binding.fileName).filter(Boolean) as string[];
    const baseItems = transferPlanFromWorkflowRows(artifact?.rows ?? [], artifact?.fileId ?? null);
    const detailCount = baseItems[0]?.detailCount ?? 0;
    const items = baseItems.map(({ detailCount: _detailCount, ...item }) => item);
    const sourceFileId = items[0]?.sourceFileId ?? null;
    const totals = items.reduce(
      (result, item) => ({
        inTotal: result.inTotal + item.inTotal,
        sourceCancelled: result.sourceCancelled + item.sourceCancelled,
        cancelledQuantity: result.cancelledQuantity + item.cancelledQuantity,
        transferToFutu: result.transferToFutu + item.transferToFutu,
      }),
      { inTotal: 0, sourceCancelled: 0, cancelledQuantity: 0, transferToFutu: 0 },
    );

    return {
      sourceFileId,
      sourceFileName: artifact?.fileName ?? '2025 BC Subplan Transfer.xlsx',
      sourceFiles: inputSourceFiles,
      workflowSourceBindings: inputSourceBindings,
      resultFileName: artifact?.fileName ?? null,
      workflowResultFiles: resultFilesFromArtifacts(artifact),
      resultFiles: sourceFilesFromArtifacts(artifact),
      detailCount,
      items,
      totals,
    };
  });

  app.post('/api/transfer-plan/edits', async (request, reply) => {
    const body = transferPlanEditBodySchema.parse(request.body ?? {});
    const artifact = await readLatestWorkflowDataFrameArtifact({
      workflowCode: 'esop-transfer-to-futu-sync',
      taskId: 'persist_transfer_plan_file',
      fallbackSheetName: '2025 BC Subplan Transfer',
    });
    if (!artifact) throw notFound('Transfer Plan result file not found');

    const buffer = transferPlanEditedWorkbookBuffer(artifact.rows, body.edits);
    const saved = await saveProductWorkbook({
      originalName: '2025 BC Subplan Transfer.xlsx',
      buffer,
      uploadedBy: `Transfer Plan Edit · ${updatedByFromRequest(request as RequestWithAuth)}`,
      folderPrefix: inputStorageFolderPrefix('transfer-plan'),
    });
    const run = await startEsopPageWorkflow(
      db,
      workflowRunStore,
      workflowRunExecutor,
      'transfer-plan',
      { transfer_plan: { fileId: Number(saved.file.id) } },
    );

    return reply.code(201).send({
      file: toProductFile(saved.file),
      ...workflowRunToExecutionResult(run),
    });
  });

  app.patch('/api/transfer-plan/:id', async (request) => {
    const { id } = request.params as { id: string };
    const body = z.object({ cancelledQuantity: z.number().finite() }).parse(request.body ?? {});
    let row = await db.queryOne<Record<string, unknown>>(
      `update transfer_plan_periods
          set cancelled_quantity = $2,
              manually_edited = true,
              updated_at = current_timestamp
        where id = $1
        returning *`,
      [Number(id), body.cancelledQuantity],
    );
    if (!row) {
      const artifact = await readLatestWorkflowDataFrameArtifact({
        workflowCode: 'esop-transfer-to-futu-sync',
        taskId: 'persist_transfer_plan_file',
        fallbackSheetName: '2025 BC Subplan Transfer',
      });
      const item = transferPlanFromWorkflowRows(artifact?.rows ?? [], artifact?.fileId ?? null).find(
        (candidate) => candidate.id === Number(id),
      );
      if (item) {
        row = await db.queryOne<Record<string, unknown>>(
          `insert into transfer_plan_periods (
             source_file_id, period, in_total, source_cancelled, cancelled_quantity, manually_edited, sort_order, raw_json
           ) values ($1, $2, $3, $4, $5, true, $6, $7::jsonb)
           on conflict (period) do update
             set source_file_id = excluded.source_file_id,
                 in_total = excluded.in_total,
                 source_cancelled = excluded.source_cancelled,
                 cancelled_quantity = excluded.cancelled_quantity,
                 manually_edited = true,
                 sort_order = excluded.sort_order,
                 raw_json = excluded.raw_json,
                 updated_at = current_timestamp
           returning *`,
          [
            item.sourceFileId,
            item.period,
            item.inTotal,
            item.sourceCancelled,
            body.cancelledQuantity,
            item.sortOrder,
            JSON.stringify(item),
          ],
        );
      }
    }
    if (!row) throw notFound('Transfer plan period not found');
    return { item: toTransferPlanPeriod(row as never) };
  });

  app.post('/api/transfer-plan/import', async (request, reply) => {
    let uploaded: { buffer: Buffer; mimeType: string } | null = null;
    for await (const part of request.parts()) {
      if (part.type === 'file') {
        uploaded = {
          buffer: await part.toBuffer(),
          mimeType: part.mimetype,
        };
      }
    }
    if (!uploaded) return reply.code(400).send({ error: 'No file uploaded' });

    const canonicalName = '2025 BC Subplan Transfer.xlsx';
    const canonicalPath = path.join(config.rootDir, 'database', 'extracted-sheets', canonicalName);
    const temporaryPath = `${canonicalPath}.${crypto.randomUUID()}.tmp.xlsx`;
    fs.writeFileSync(temporaryPath, uploaded.buffer);
    let workbook;
    try {
      workbook = loadTransferPlanWorkbook(temporaryPath);
      fs.renameSync(temporaryPath, canonicalPath);
    } catch (error) {
      fs.rmSync(temporaryPath, { force: true });
      throw error;
    }

    const saved = await saveProductWorkbook({
      originalName: canonicalName,
      buffer: uploaded.buffer,
      mimeType: uploaded.mimeType,
      uploadedBy: 'Administrator',
      folderPrefix: inputStorageFolderPrefix('transfer-plan'),
    });
    await seedTransferPlanData(db, workbook, Number(saved.file.id));
    return reply.code(201).send({
      file: toProductFile(saved.file),
      detailCount: workbook.details.length,
    });
  });

  const employeeSelectColumns = `
    e.id,
    e.employee_name,
    e.user_id,
    e.source,
    e.employee_id,
    e.has_file_evidence,
    e.is_active,
    count(g.id)::int as grant_count,
    coalesce((
      select array_agg(distinct l.id)
      from employee_label_assignment ela
      join employee_label l on l.id = ela.label_id
      where ela.employee_id in (select m.id from employees m where m.id = e.id or m.merged_into_id = e.id)
    ), '{}') as label_ids,
    coalesce((
      select array_agg(distinct l.name order by l.name)
      from employee_label_assignment ela
      join employee_label l on l.id = ela.label_id
      where ela.employee_id in (select m.id from employees m where m.id = e.id or m.merged_into_id = e.id)
    ), '{}') as tags,
    coalesce((
      select json_agg(json_build_object('id', dl.id, 'name', dl.name, 'color', dl.color) order by dl.name)
      from (
        select distinct l.id, l.name, l.color
        from employee_label_assignment ela
        join employee_label l on l.id = ela.label_id
        where ela.employee_id in (select m.id from employees m where m.id = e.id or m.merged_into_id = e.id)
      ) dl
    ), '[]'::json) as labels,
    coalesce((
      select json_agg(json_build_object(
        'id', t.id, 'employeeId', t.employee_id, 'source', t.source, 'name', t.employee_name
      ) order by t.id)
      from employees t where t.merged_into_id = e.id
    ), '[]'::json) as linked_identities`;

  async function fetchEmployeeById(employeeId: number) {
    const row = await db.queryOne<Record<string, unknown>>(
      `select ${employeeSelectColumns}
       from employees e
       left join equity_grants g on g.employee_id = e.id
       where e.id = $1
       group by e.id`,
      [employeeId],
    );
    return row ? toEmployee(row) : null;
  }

  async function listEmployeeLabels() {
    const rows = await db.query<Record<string, unknown>>(
      `select l.id, l.name, l.color, l.created_at, l.updated_at, count(ela.employee_id)::int as employee_count
         from employee_label l
         left join employee_label_assignment ela on ela.label_id = l.id
        group by l.id
        order by lower(l.name), l.id`,
    );
    return rows.map((row) => ({
      id: Number(row.id),
      name: String(row.name ?? ''),
      color: normalizeEmployeeLabelColor(row.color),
      employeeCount: Number(row.employee_count ?? 0),
      createdAt: String(row.created_at ?? ''),
      updatedAt: String(row.updated_at ?? ''),
    }));
  }

  function normalizeEmployeeLabelIds(value: unknown): number[] {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))];
  }

  async function assertEmployeeLabelsExist(labelIds: number[]) {
    if (labelIds.length === 0) return;
    const rows = await db.query<{ id: number }>('select id from employee_label where id = any($1::int[])', [labelIds]);
    const existing = new Set(rows.map((row) => Number(row.id)));
    const missing = labelIds.filter((id) => !existing.has(id));
    if (missing.length) throw badRequest(`Employee label not found: ${missing.join(', ')}`);
  }

  async function replaceEmployeeLabels(employeeId: number, labelIds: number[]) {
    await assertEmployeeLabelsExist(labelIds);
    await db.transaction(async (tx) => {
      await tx.execute('delete from employee_label_assignment where employee_id = $1', [employeeId]);
      for (const labelId of labelIds) {
        await tx.execute(
          'insert into employee_label_assignment (employee_id, label_id) values ($1, $2) on conflict do nothing',
          [employeeId, labelId],
        );
      }
    });
  }

  app.get('/api/employee-labels', async () => ({ items: await listEmployeeLabels() }));

  app.post('/api/employee-labels', async (request, reply) => {
    const body = z.object({
      name: z.string().trim().min(1),
      color: z.string().optional(),
    }).parse(request.body ?? {});
    const color = body.color === undefined ? null : normalizeEmployeeLabelColor(body.color);
    const row = await db.queryOne<{ id: number }>(
      `insert into employee_label (name, color) values ($1, $2)
       on conflict (name) do update set updated_at = employee_label.updated_at
       returning id`,
      [body.name, color],
    );
    if (!row) throw new Error('Failed to create employee label');
    const items = await listEmployeeLabels();
    return reply.code(201).send({ items, item: items.find((label) => label.id === Number(row.id)) });
  });

  app.patch('/api/employee-labels/:id', async (request) => {
    const labelId = Number((request.params as { id: string }).id);
    const body = z.object({
      name: z.string().trim().min(1).optional(),
      color: z.string().optional(),
    }).parse(request.body ?? {});
    if (body.name === undefined && body.color === undefined) throw badRequest('Employee label update is empty');
    const color = body.color === undefined ? null : normalizeEmployeeLabelColor(body.color);
    if (body.name !== undefined) {
      const duplicate = await db.queryOne<{ id: number }>(
        'select id from employee_label where name = $1 and id <> $2 limit 1',
        [body.name, labelId],
      );
      if (duplicate) throw badRequest('Employee label name already exists');
    }
    const row = await db.queryOne<{ id: number }>(
      `update employee_label
          set name = coalesce($1, name),
              color = coalesce($2, color),
              updated_at = current_timestamp
        where id = $3
        returning id`,
      [body.name ?? null, color, labelId],
    );
    if (!row) throw notFound('Employee label not found');
    return { items: await listEmployeeLabels() };
  });

  app.delete('/api/employee-labels/:id', async (request, reply) => {
    const labelId = Number((request.params as { id: string }).id);
    await db.execute('delete from employee_label where id = $1', [labelId]);
    return reply.code(204).send();
  });

  app.get('/api/employees', async (request) => {
    const { page, pageSize } = paginationQuerySchema.parse(request.query ?? {});
    const { query = '', tag = '', source = '', sort = '', dir = '' } = request.query as {
      query?: string;
      tag?: string;
      source?: string;
      sort?: string;
      dir?: string;
    };
    const normalizedQuery = query.trim().toLowerCase();
    const normalizedLabelId = Number(tag);
    const labelIdFilter = Number.isInteger(normalizedLabelId) && normalizedLabelId > 0 ? normalizedLabelId : 0;
    const normalizedSource = normalizeEmployeeSourceFilter(source);
    const like = `%${normalizedQuery}%`;
    const offset = (page - 1) * pageSize;
    const sortColumn = sort === 'name' ? 'e.employee_name' : sort === 'empNo' ? 'e.employee_id' : 'e.id';
    const sortDir = dir === 'desc' ? 'desc' : 'asc';
    const matchClause = `
      e.merged_into_id is null
      and ($1::int = 0 or exists (
        select 1 from employee_label_assignment ela
        where ela.employee_id = e.id and ela.label_id = $1::int
      ))
      and (
        $2 = ''
        or lower(
          coalesce(e.employee_name, '') || ' ' ||
          coalesce(e.employee_id, '') || ' ' ||
          coalesce(e.user_id, '') || ' ' ||
          coalesce((
            select string_agg(l.name, ' ')
            from employee_label_assignment ela
            join employee_label l on l.id = ela.label_id
            where ela.employee_id = e.id
          ), '')
        ) like $3
      )
      and ($4 = '' or e.source = $4)`;
    const totalRow = await db.queryOne<{ count: number }>(
      `select count(*)::int as count from employees e where ${matchClause}`,
      [labelIdFilter, normalizedQuery, like, normalizedSource],
    );
    const rows = await db.query<Record<string, unknown>>(
      `select ${employeeSelectColumns}
       from employees e
       left join equity_grants g on g.employee_id = e.id
       where ${matchClause}
       group by e.id
       order by ${sortColumn} ${sortDir}, e.id ${sortDir}
       limit $5 offset $6`,
      [labelIdFilter, normalizedQuery, like, normalizedSource, pageSize, offset],
    );
    const inputSourceBindings = await latestWorkflowInputSourceBindings('employee-import');
    const sourceFiles = inputSourceBindings.map((binding) => binding.fileName).filter(Boolean) as string[];
    return {
      items: rows.map(toEmployee),
      sourceFiles,
      workflowSourceBindings: inputSourceBindings,
      resultFileName: null,
      resultFiles: [],
      total: Number(totalRow?.count ?? 0),
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(Number(totalRow?.count ?? 0) / pageSize)),
    };
  });

  app.post('/api/employees', async (request, reply) => {
    const body = z
      .object({
        employeeId: z.string().trim().min(1),
        employeeName: z.string().trim().min(1),
        userId: z.string().trim().optional().or(z.literal('')),
        labelIds: z.array(z.number().int().positive()).optional().default([]),
      })
      .parse(request.body);
    // Manual employees must carry an employee_id (工号) — it is the business key, not
    // system-generated. A duplicate employee_id is a conflict (409); the operator should
    // find the existing row instead.
    const employeeId = normalizeExternalNumber(body.employeeId);
    const existing = await db.queryOne<{ id: number }>('select id from employees where employee_id = $1', [employeeId]);
    if (existing) {
      const owner = await fetchEmployeeById(Number(existing.id));
      return reply.code(409).send({ error: '该工号已存在', employee: owner });
    }
    const row = await db.queryOne<{ id: number }>(
      `insert into employees (employee_id, source, employee_name, user_id, has_file_evidence)
       values ($1, 'manual', $2, $3, false)
       returning id`,
      [employeeId, body.employeeName, body.userId || null],
    );
    if (!row) throw new Error('Failed to create employee');
    await replaceEmployeeLabels(Number(row.id), normalizeEmployeeLabelIds(body.labelIds));
    const created = await fetchEmployeeById(Number(row.id));
    return reply.code(201).send(created);
  });

  app.patch('/api/employees/:id', async (request) => {
    const employeeId = Number((request.params as { id: string }).id);
    const body = z
      .object({
        employeeName: z.string().trim().min(1).optional(),
        userId: z.string().trim().optional().or(z.literal('')),
        labelIds: z.array(z.number().int().positive()).optional(),
        active: z.boolean().optional(),
      })
      .parse(request.body);

    const current = await db.queryOne<{ id: number }>('select id from employees where id = $1', [employeeId]);
    if (!current) throw notFound('Employee not found');

    // employee_id (工号) is the key and cannot change; name/user_id/labels/active are editable.
    await db.execute(
      `update employees
       set employee_name = coalesce($1, employee_name),
           user_id = coalesce($2, user_id),
           is_active = coalesce($3, is_active),
           updated_at = current_timestamp
       where id = $4`,
      [
        body.employeeName ?? null,
        body.userId === undefined ? null : body.userId || null,
        body.active ?? null,
        employeeId,
      ],
    );
    if (body.labelIds !== undefined) {
      await replaceEmployeeLabels(employeeId, normalizeEmployeeLabelIds(body.labelIds));
    }

    return fetchEmployeeById(employeeId);
  });

  // Link two records as the same person: merge `mergeFromId` into the target.
  // The target `:id` may be an internal row id or an employee_id (工号).
  // Append-only — the merged record becomes a tombstone rather than being deleted.
  app.post('/api/employees/:id/merge', async (request, reply) => {
    const rawTarget = String((request.params as { id: string }).id).trim();
    const body = z.object({ mergeFromId: z.number().int().positive() }).parse(request.body);
    const sourceId = body.mergeFromId;

    // Resolve the target by employee_id (工号) first, then fall back to internal row id.
    let targetId: number | null = null;
    const normalizedTarget = normalizeExternalNumber(rawTarget);
    if (normalizedTarget) {
      const idRow = await db.queryOne<{ id: number }>(
        'select id from employees where employee_id = $1 limit 1',
        [normalizedTarget],
      );
      if (idRow) targetId = Number(idRow.id);
    }
    if (targetId === null && /^\d+$/.test(rawTarget)) targetId = Number(rawTarget);
    if (targetId === null) return reply.code(404).send({ error: '找不到目标员工' });
    if (sourceId === targetId) return reply.code(400).send({ error: '不能与自身关联' });

    await db.transaction(async (tx) => {
      const target = await tx.queryOne<{ id: number }>('select id from employees where id = $1 and merged_into_id is null', [targetId]);
      const source = await tx.queryOne<{ id: number }>('select id from employees where id = $1 and merged_into_id is null', [sourceId]);
      if (!target) throw notFound('Target employee not found');
      if (!source) throw notFound('Source employee not found');

      // 关联只声明"同一人"：来源设为指向目标的 tombstone。不改写 equity_grants / 标签 / has_file_evidence
      // 等任何业务数据——展示时按 canonical 关联组读时聚合，取消关联(unlink)因此零副作用、可无损还原。
      await tx.execute(
        'update employees set merged_into_id = $1, is_active = false, updated_at = current_timestamp where id = $2',
        [targetId, sourceId],
      );
    });

    const merged = await fetchEmployeeById(targetId);
    return merged;
  });

  // Undo a link: detach `mergeFromId` from the target, restoring it to a standalone active employee.
  // Reverse of the pure mapping above — since merge no longer touches business data, unlink is side-effect free.
  app.post('/api/employees/:id/unlink', async (request, reply) => {
    const rawTarget = String((request.params as { id: string }).id).trim();
    const body = z.object({ mergeFromId: z.number().int().positive() }).parse(request.body);
    const sourceId = body.mergeFromId;

    let targetId: number | null = null;
    const normalizedTarget = normalizeExternalNumber(rawTarget);
    if (normalizedTarget) {
      const idRow = await db.queryOne<{ id: number }>('select id from employees where employee_id = $1 limit 1', [normalizedTarget]);
      if (idRow) targetId = Number(idRow.id);
    }
    if (targetId === null && /^\d+$/.test(rawTarget)) targetId = Number(rawTarget);
    if (targetId === null) return reply.code(404).send({ error: '找不到目标员工' });

    const source = await db.queryOne<{ id: number; merged_into_id: number | null }>(
      'select id, merged_into_id from employees where id = $1',
      [sourceId],
    );
    if (!source) throw notFound('Source employee not found');
    if (source.merged_into_id === null || Number(source.merged_into_id) !== targetId) {
      return reply.code(400).send({ error: '该员工未关联到此目标' });
    }
    await db.execute(
      'update employees set merged_into_id = null, is_active = true, updated_at = current_timestamp where id = $1',
      [sourceId],
    );
    return fetchEmployeeById(targetId);
  });

  app.get('/api/plan-summary', async () => {
    const artifact = await readLatestWorkflowDataFrameArtifact({
      workflowCode: 'plan-summary-sync',
      taskId: 'persist_plan_summary_file',
      fallbackSheetName: 'Plan Summary',
    });
    const inputSourceBindings = await latestWorkflowInputSourceBindings('plan-summary-sync');
    const inputSourceFiles = inputSourceBindings.map((binding) => binding.fileName).filter(Boolean) as string[];
    return {
      sourceFiles: inputSourceFiles,
      workflowSourceBindings: inputSourceBindings,
      resultFileName: artifact?.fileName ?? null,
      workflowResultFiles: resultFilesFromArtifacts(artifact),
      resultFiles: sourceFilesFromArtifacts(artifact),
      ...buildPlanSummary((artifact?.rows ?? []).map((row) => ({
      plan_name: row.plan_name === undefined || row.plan_name === null ? null : String(row.plan_name),
      grant_count: row.grant_count === undefined || row.grant_count === null ? null : Number(row.grant_count),
      granted: row.granted === undefined || row.granted === null ? null : Number(row.granted),
      exercised: row.exercised === undefined || row.exercised === null ? null : Number(row.exercised),
      cancelled: row.cancelled === undefined || row.cancelled === null ? null : Number(row.cancelled),
      outstanding: row.outstanding === undefined || row.outstanding === null ? null : Number(row.outstanding),
      }))),
    };
  });

  app.get('/api/fixed-values', async () => {
    const rows = await db.query<Record<string, unknown>>(
      `select distinct on (key) *
         from global_parameters
        where key = any($1::text[])
        order by key, updated_at desc, id desc`,
      [[...fixedValuePageKeyOrder]],
    );
    const order: Record<string, number> = Object.fromEntries(fixedValuePageKeyOrder.map((key, index) => [key, index]));
    const items = rows
      .map((row) => toFixedValue(row as Parameters<typeof toFixedValue>[0]))
      .sort((left, right) => {
        const leftRank = order[left.key] ?? 2147483647;
        const rightRank = order[right.key] ?? 2147483647;
        if (leftRank !== rightRank) return leftRank - rightRank;
        const updatedDiff = Date.parse(toIsoTimestamp(right.updatedAt)) - Date.parse(toIsoTimestamp(left.updatedAt));
        if (updatedDiff !== 0) return updatedDiff;
        return left.key.localeCompare(right.key);
      });
    return { items };
  });

  app.get('/api/five-percent-holders/fixed-values', async () => {
    const rows = await db.query<Record<string, unknown>>(
      `select distinct on (key) *
         from global_parameters
        where key = any($1::text[])
        order by key, updated_at desc, id desc`,
      [[...fivePercentHolderGlobalParameterOrder]],
    );
    const order: Record<string, number> = Object.fromEntries(fivePercentHolderGlobalParameterOrder.map((key, index) => [key, index]));
    const items = rows
      .map((row) => toFixedValue(row as Parameters<typeof toFixedValue>[0]))
      .sort((left, right) => {
        const leftRank = order[left.key] ?? 2147483647;
        const rightRank = order[right.key] ?? 2147483647;
        if (leftRank !== rightRank) return leftRank - rightRank;
        const updatedDiff = Date.parse(toIsoTimestamp(right.updatedAt)) - Date.parse(toIsoTimestamp(left.updatedAt));
        if (updatedDiff !== 0) return updatedDiff;
        return left.key.localeCompare(right.key);
      });
    return { items };
  });

  app.get('/api/global-parameters', async () => {
    const rows = await db.query<Record<string, unknown>>(
      `select distinct on (key) *
         from global_parameters
        where key <> all($1::text[])
        order by key, updated_at desc, id desc`,
      [fivePercentHolderGlobalParameterKeys],
    );
    const order: Record<string, number> = Object.fromEntries(fixedValuePageKeyOrder.map((key, index) => [key, index]));
    const items = rows
      .map((row) => toFixedValue(row as Parameters<typeof toFixedValue>[0]))
      .sort((left, right) => (order[left.key] ?? 2147483647) - (order[right.key] ?? 2147483647) || left.key.localeCompare(right.key));
    return { items };
  });

  app.post('/api/global-parameters', async (request, reply) => {
    if (!requireAdminUser(request as typeof request & RequestWithAuth, reply)) return;
    const body = globalParameterCreateSchema.parse(request.body ?? {});
    if (fivePercentHolderGlobalParameterKeySet.has(body.key)) {
      return reply.code(400).send({ error: '5% Holder parameters must be maintained from the 5% Holders page' });
    }
    try {
      const row = await db.queryOne<Record<string, unknown>>(
        `with stamp as (select clock_timestamp() as value)
         insert into global_parameters (key, label, value, effective_from, editable, updated_by, updated_at)
         select $1, $2, $3, stamp.value::text, true, $4, stamp.value
           from stamp
         returning *`,
        [body.key, body.label, body.value, updatedByFromRequest(request as typeof request & RequestWithAuth)],
      );
      return reply.code(201).send(toFixedValue(row as Parameters<typeof toFixedValue>[0]));
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        return reply.code(409).send({ error: '相同 Key 的参数创建时间冲突，请重试' });
      }
      throw error;
    }
  });

  app.patch('/api/global-parameters/:id', async (request, reply) => {
    if (!requireAdminUser(request as typeof request & RequestWithAuth, reply)) return;
    const { id } = userIdParamSchema.parse(request.params);
    const body = globalParameterPatchSchema.parse(request.body ?? {});
    const row = await db.queryOne<Record<string, unknown>>(
      `update global_parameters
          set label = coalesce($1, label),
              value = $2,
              updated_by = $3,
              updated_at = current_timestamp
        where id = $4
          and editable = true
          and key <> all($5::text[])
          returning *`,
      [body.label ?? null, body.value, updatedByFromRequest(request as typeof request & RequestWithAuth), id, fivePercentHolderGlobalParameterKeys],
    );
    if (!row) throw notFound('Global Parameter not found or not editable');
    return toFixedValue(row as Parameters<typeof toFixedValue>[0]);
  });

  app.delete('/api/global-parameters/:id', async (request, reply) => {
    if (!requireAdminUser(request as typeof request & RequestWithAuth, reply)) return;
    const { id } = userIdParamSchema.parse(request.params);
    const row = await db.queryOne<{ id: number }>(
      `delete from global_parameters
        where id = $1
          and editable = true
          and key <> all($2::text[])
        returning id`,
      [id, fivePercentHolderGlobalParameterKeys],
    );
    if (!row) throw notFound('Global Parameter not found');
    return reply.code(204).send();
  });

  app.post('/api/fixed-values', async (request) => {
    const body = fixedValueUpsertSchema.parse(request.body);
    const row = await db.queryOne<Record<string, unknown>>(
      `with stamp as (select clock_timestamp() as value)
       insert into global_parameters (key, label, value, effective_from, editable, updated_by, updated_at)
       select $1, $2, $3, stamp.value::text, true, $4, stamp.value
         from stamp
       returning *`,
      [
        body.key,
        body.label ?? fixedValueLabels[body.key] ?? body.key,
        body.value,
        updatedByFromRequest(request as typeof request & RequestWithAuth),
      ],
    );
    return toFixedValue(row as Parameters<typeof toFixedValue>[0]);
  });

  app.patch('/api/fixed-values/:id', async (request) => {
    const { id } = request.params as { id: string };
    const body = fixedValuePatchSchema.parse(request.body);
    const row = await db.queryOne<Record<string, unknown>>(
      `update global_parameters
       set value = $1,
           updated_by = $2,
           updated_at = current_timestamp
       where id = $3 and editable = true
       returning *`,
      [body.value, updatedByFromRequest(request as typeof request & RequestWithAuth), Number(id)],
    );
    if (!row) throw notFound('Fixed value not found or not editable');
    return toFixedValue(row as Parameters<typeof toFixedValue>[0]);
  });

  app.get('/api/five-percent-holders', async () => {
    const inputSourceBindings = await latestFivePercentHolderInputSourceBindings();
    const inputSourceFiles = inputSourceBindings.map((binding) => binding.fileName).filter(Boolean) as string[];
    const fixedValues = await loadLatestFixedValuesByKey(fivePercentHolderGlobalParameterOrder);
    const fixedValuesComplete = hasCompleteFivePercentHolderGlobalParameters(fixedValues);
    const emptyResult = {
      sourceFiles: inputSourceFiles,
      workflowSourceBindings: inputSourceBindings,
      resultFileName: null,
      workflowResultFiles: [] as ReturnType<typeof resultFilesFromArtifacts>,
      resultFiles: [] as string[],
      summary: {
        asOfDate: null,
        fullyDiluted: null,
        commonStockOs: null,
      },
      items: emptyFivePercentHolderRows(fixedValues),
    };
    if (!fixedValuesComplete) return emptyResult;

    const artifact = await readLatestWorkflowDataFrameArtifact({
      workflowCode: 'five-percent-holders-sync',
      taskId: 'persist_five_percent_holders_file',
      fallbackSheetName: '5% Holders',
    });
    if (!artifact) {
      return {
        ...emptyResult,
      };
    }

    const grid = artifact
      ? [
        artifact.columns,
        ...artifact.rows.map((row) => artifact.columns.map((column) => row[column] ?? null)),
      ]
      : [];
    const workbook = parseFivePercentHoldersGrid(grid);
    const holders = applyFivePercentHolderGlobalParameters(workbook, fixedValues);
    return {
      sourceFiles: inputSourceFiles,
      workflowSourceBindings: inputSourceBindings,
      resultFileName: artifact?.fileName ?? null,
      workflowResultFiles: resultFilesFromArtifacts(artifact),
      resultFiles: sourceFilesFromArtifacts(artifact),
      summary: {
        asOfDate: workbook.asOfDate,
        fullyDiluted: workbook.fullyDiluted,
        commonStockOs: workbook.commonStockOs,
      },
      items: holders.map((row, index) => ({ id: index + 1, ...row })),
    };
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

  app.get('/api/esop-workflows', async () => ({
    items: (
      await Promise.all(
        Object.values(ESOP_PAGE_WORKFLOW_CONFIGS).map((config) =>
          pageWorkflowConfig(config.pageKey, config.workflowCode),
        ),
      )
    ).filter((item): item is NonNullable<typeof item> => item !== null),
  }));

  app.post('/api/esop-workflows/:pageKey/runs', async (request, reply) => {
    const pageKey = esopPageKeySchema.parse((request.params as { pageKey: string }).pageKey) as EsopPageKey;
    const body = esopWorkflowRunBodySchema.parse(request.body ?? {});
    const config = ESOP_PAGE_WORKFLOW_CONFIGS[pageKey];
    const sourceDescriptors = await workflowSourceDescriptors(config.workflowCode);
    const expectedSourceKeys = new Set(sourceDescriptors.map((source) => source.sourceKey));
    const unknownSourceKey = Object.keys(body.sources).find((sourceKey) => !expectedSourceKeys.has(sourceKey));
    if (unknownSourceKey) throw new Error(`Unknown ESOP workflow source: ${unknownSourceKey}`);

    for (const source of sourceDescriptors) {
      const fileId = body.sources[source.sourceKey]?.fileId;
      if (!fileId) throw new Error(`Missing ESOP workflow source: ${source.sourceKey}`);
      await getProductFileOrThrow(fileId);
    }

    const run = await startEsopPageWorkflow(db, workflowRunStore, workflowRunExecutor, pageKey, body.sources);
    return reply.code(201).send(workflowRunToExecutionResult(run));
  });

  app.get('/api/data-management-workflows', async () => ({
    items: (
      await Promise.all(
        Object.values(DATA_MANAGEMENT_WORKFLOW_CONFIGS).map((config) =>
          pageWorkflowConfig(config.pageKey, config.workflowCode),
        ),
      )
    ).filter((item): item is NonNullable<typeof item> => item !== null),
  }));

  app.post('/api/data-management-workflows/:pageKey/runs', async (request, reply) => {
    const pageKey = dataManagementPageKeySchema.parse(
      (request.params as { pageKey: string }).pageKey,
    ) as DataManagementPageKey;
    const body = dataManagementWorkflowRunBodySchema.parse(request.body ?? {});
    const config = DATA_MANAGEMENT_WORKFLOW_CONFIGS[pageKey];
    const sourceDescriptors = await workflowSourceDescriptors(config.workflowCode);
    const expectedSourceKeys = new Set(sourceDescriptors.map((source) => source.sourceKey));
    const unknownSourceKey = Object.keys(body.sources).find((sourceKey) => !expectedSourceKeys.has(sourceKey));
    if (unknownSourceKey) throw new Error(`Unknown data management workflow source: ${unknownSourceKey}`);
    const sources = { ...body.sources };
    if (pageKey === 'five-percent-holders' && !sources.capitalization_summary?.fileId) {
      const latestMonthlyOutput = await getLatestMonthlyRunOutput(db);
      if (latestMonthlyOutput?.fileId) {
        sources.capitalization_summary = { fileId: latestMonthlyOutput.fileId };
      }
    }
    for (const source of sourceDescriptors) {
      const fileId = sources[source.sourceKey]?.fileId;
      if (!fileId) throw new Error(`Missing data management workflow source: ${source.sourceKey}`);
      await getProductFileOrThrow(fileId);
    }
    const run = await startDataManagementWorkflow(
      db, workflowRunStore, workflowRunExecutor, pageKey, sources,
    );
    return reply.code(201).send(workflowRunToExecutionResult(run));
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
      tasks: imported.tasks,
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

    const normalizedTasks = normalizeWorkflowTasksForPersistence(body.tasks, 'Workflow');
    const runtimeConfig = normalizeWorkflowRuntimeConfig({
      tasks: normalizedTasks,
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
        expectedUpdatedAt: z.string().trim().min(1).optional(),
      })
      .parse(request.body);

    const normalizedTasks =
      body.tasks === undefined
        ? normalizeWorkflowTasksForPersistence(parseJson(existing.tasks_json, []), 'Stored workflow')
        : normalizeWorkflowTasksForPersistence(body.tasks, 'Workflow');
    const runtimeConfig = normalizeWorkflowRuntimeConfig({
      tasks: normalizedTasks,
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
         and ($10::timestamptz is null
           or date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $10::timestamptz))
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
        body.expectedUpdatedAt ?? null,
      ],
    );
    if (!row) {
      throw conflict('工作流已被其他页面或请求更新，请刷新后重新应用本次修改');
    }
    return toWorkflowDefinition(row);
  });

  app.post('/api/workflows/preview-task', async (request) => {
    const body = workflowTaskPreviewBodySchema.parse(request.body);
    const workflowRow = await db.queryOne<Record<string, unknown>>('select * from workflow_definitions where id = $1', [body.workflowId]);
    if (!workflowRow) throw notFound('Workflow not found');

    const sourceTasks = body.tasks ? normalizeWorkflowTasks(body.tasks) : normalizeWorkflowTasks(parseJson(workflowRow.tasks_json, []));
    const previewTasks = selectWorkflowPreviewTasks(sourceTasks, body.taskId);
    const runtimeConfiguration = resolveWorkflowRuntimeConfiguration({
      tasks: previewTasks,
      runtimeParamsSchema: body.runtimeParamsSchema ?? parseJson(workflowRow.runtime_params_schema_json, {}),
      runtimeParamsDefaults: body.runtimeParamsDefaults ?? parseJson(workflowRow.runtime_params_defaults_json, {}),
      runtimeParameters: body.runtimeParameters,
    });
    const taskMap = new Map(runtimeConfiguration.tasks.map((task) => [task.id, task]));
    const task = taskMap.get(body.taskId);
    if (!task) throw notFound('Workflow task not found');

    return executeWorkflowTaskPreview(task, new Map(), taskMap, workflowOperatorRuntime, {
      runtimeParameters: runtimeConfiguration.runtimeParameters,
      invocationStack: [String(workflowRow.code), `id:${body.workflowId}`],
    });
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
    const light = (request.query as { light?: string } | undefined)?.light;
    return workflowRunStore.getRun(runId, { light: light === '1' || light === 'true' });
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
    const spaPages = [
      'summary',
      'captable',
      'monthly',
      'monthly/run',
      'esop-detail',
      'grant-record',
      'exercise-record',
      'sold-shares',
      'transfer-plan',
      'employee-management',
      'plan-summary',
      'five-percent-holders',
      'fixed-value',
      'files',
      'workflow',
      'holdings',
      'employees',
      'account',
      'settings',
    ];
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

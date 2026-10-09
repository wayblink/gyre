import type {
  MonthlyRunHistoryRecord,
  MonthlyRunInstanceRecord,
  MonthlyRunInstanceUpsertRequest,
  MonthlyRunSourceConfigResponse,
  MonthlyRunSourceDefinition,
  MonthlyRunSourceBinding,
  MonthlyRunTriggerRequest,
  MonthlyRunTriggerResponse,
  ProductFileDetail,
  ProductFileRecord,
  ProductFileSheetSummary,
  WorkflowExecutionTaskState,
  WorkflowRunRecord,
} from '../shared/types.js';
import { isWorkflowRunTerminalStatus } from '../shared/workflowRunStatus.js';
import type { ConfirmActionFn, NotifyFn } from './uiFeedback.js';
import { createWorkflowRunClient } from './workflow/runClient.js';
import type { AppLanguage } from './i18n.js';
import { UploadHttpError, uploadFormDataWithProgress } from './uploadProgress.js';

type DomGetter = <T extends HTMLElement>(id: string) => T;

type MonthlyRunPageDeps = {
  el: DomGetter;
  api: <T>(url: string, options?: RequestInit) => Promise<T>;
  escapeHtml: (text: unknown) => string;
  formatDateTime: (value: string) => string;
  refreshProductFiles: () => Promise<unknown>;
  refreshSummary: (month: string) => Promise<unknown>;
  openProductFile: (fileId: number) => Promise<void> | void;
  notify: NotifyFn;
  confirmAction: ConfirmActionFn;
  getLanguage?: () => AppLanguage;
  onMonthChanged?: (month: string) => void;
  onPlanStatusChanged?: () => void | Promise<void>;
};

type SourceDraftBindings = Record<string, MonthlyRunSourceBinding | null>;
type SourceSheetSummaryState = {
  sheets: ProductFileSheetSummary[];
  loading: boolean;
  errorMessage: string | null;
};

const sourceFileNameMatchers: Record<string, string[]> = {
  base_control_book: ['eq control book'],
  base_futu_exercises: ['futu exercises'],
  incremental_control_book: ['control books detail', 'control_books_detail', 'detail data', '27591'],
  option_plans_summary: ['option plans summary', 'gyre option plans summary sl', 'gyre cap table', 'cap table'],
  options_os_detail_by_plan: ['options os detail by plan', 'options os detail'],
};

const sourcePurposeEnglish: Record<string, string> = {
  base_control_book:
    'The complete EQ Control Book from the prior month. It becomes the base for the incremental merge and can be carried forward to the next month.',
  incremental_control_book:
    'The current month Control Book detail export. It is merged with the base by the transaction natural key without duplicating prior records.',
  series_b:
    'The SERIES B Control Book workbook. Its Shares Issued total is used to calculate Series B Preferred Stock in the capitalization summary.',
  option_plans_summary:
    'The standalone Gyre Option Plans Summary workbook. It supplies each plan’s outstanding and available share totals.',
  base_futu_exercises:
    'The complete Futu BCI Exercises base from the prior month. It becomes the base for the incremental merge and is carried forward month to month.',
  incremental_futu_exercises:
    'The current month Futu exercise detail export. It is merged with the base by exercise order number without duplicating prior records.',
  bc_subplan_transfer:
    'Optional 2025 BC Subplan transfer or vesting data. When omitted, the related adjustment is skipped after warning review.',
  previous_capitalization_summary:
    'Automatically supplied from the prior month’s Capitalization Summary output to validate the current month EQ Control Book Last Month value.',
  incremental_cancel_restore_report:
    'The current month cancel-and-restore report. It supplies the incremental cancellation adjustments used by Plan Summary.',
};

function sourceDescription(source: MonthlyRunSourceDefinition, language: AppLanguage): string {
  if (language === 'en-US') return sourcePurposeEnglish[source.sourceKey] ?? source.description;
  return source.description;
}

/**
 * Version of the monthly workflow definition (DB table `workflow_definitions.version`) this Monthly
 * Update page was built against. The definition itself lives in the database only (see CLAUDE.md);
 * the version pinned here is the guard that keeps the page and the definition in sync: whenever the
 * DB definition changes (new/renamed/removed input sources, different constants), bump its version
 * and this constant together. A mismatch blocks the page and the run instead of silently rendering
 * inputs the workflow no longer reads.
 */
export const MONTHLY_WORKFLOW_VERSION = 17;

/**
 * Compares the workflow definition version reported by the API against the version this page was
 * built against. Returns the mismatch details (or null when they match) so callers can surface a
 * bilingual error message.
 */
export function monthlyWorkflowVersionMismatch(
  actualVersion: unknown,
  expectedVersion: number = MONTHLY_WORKFLOW_VERSION,
): { expected: number; actual: number } | null {
  const actual = Number(actualVersion);
  if (Number.isInteger(actual) && actual === expectedVersion) return null;
  return { expected: expectedVersion, actual: Number.isInteger(actual) ? actual : 0 };
}

// The 5 remaining monthly fixed values, maintained per-month (each month inherits the prior month's values).
// Labels mirror the workflow constants so the Monthly Update page and workflow stay in sync.
export const MONTHLY_FIXED_VALUE_DEFS: ReadonlyArray<{
  key: string;
  label: { 'zh-CN': string; 'en-US': string };
  description: { 'zh-CN': string; 'en-US': string };
}> = [
  {
    key: 'optionsOutstandingCullgen',
    label: { 'zh-CN': 'Options Outstanding - Cullgen', 'en-US': 'Options Outstanding - Cullgen' },
    description: {
      'zh-CN': 'Cullgen 授予且已发行、尚未行权的期权数，作为固定项计入 Total Fully Diluted。',
      'en-US': 'Granted and issued Cullgen options not yet exercised; added as a fixed term into Total Fully Diluted.',
    },
  },
  {
    key: 'optionsAvailableCullgen',
    label: { 'zh-CN': 'Options Available - Cullgen', 'en-US': 'Options Available - Cullgen' },
    description: {
      'zh-CN': 'Cullgen 计划池中仍可供未来授予的期权额度，作为固定项计入 Total Fully Diluted。',
      'en-US':
        'Remaining Cullgen pool capacity available for future grants; added as a fixed term into Total Fully Diluted.',
    },
  },
  {
    key: 'warrantsConvertiblePreferred',
    label: { 'zh-CN': 'Warrants for Convertible Preferred Stock', 'en-US': 'Warrants for Convertible Preferred Stock' },
    description: {
      'zh-CN': '与可转换优先股对应的认股权证数，作为固定项计入 Total Fully Diluted。',
      'en-US': 'Warrants attached to convertible preferred stock; added as a fixed term into Total Fully Diluted.',
    },
  },
  {
    key: 'cullgenCommonStock',
    label: { 'zh-CN': 'Cullgen Common Stock', 'en-US': 'Cullgen Common Stock' },
    description: {
      'zh-CN': 'Cullgen 已发行普通股总数的对账基准值。运行时会校验 EQ Control Book 算出的该列必须等于此值，否则阻塞。',
      'en-US':
        'Reconciliation baseline for total Cullgen common stock outstanding. The run asserts the EQ Control Book column equals this value, and blocks otherwise.',
    },
  },
  {
    key: 'gyre2023ChinaSubplanTotal',
    label: { 'zh-CN': 'Gyre 2023 China SubPlan Total', 'en-US': 'Gyre 2023 China SubPlan Total' },
    description: {
      'zh-CN':
        'Gyre 2023 中国子计划期权总数的对账基准值。运行时会校验 EQ Control Book 算出的该列必须等于此值，否则阻塞。',
      'en-US':
        'Reconciliation baseline for the Gyre 2023 China sub-plan option total. The run asserts the EQ Control Book column equals this value, and blocks otherwise.',
    },
  },
];

function normalizeCandidateText(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[_.!]+/g, ' ')
    .replace(/[-–—]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function productFileCandidateName(file: Pick<ProductFileRecord, 'displayName' | 'originalName'>): string {
  return file.displayName || file.originalName;
}

export function getMonthlyRunSheetNameOptions(params: {
  bindingSheetName?: string | null;
  defaultSheetName?: string | null;
  sheets: ReadonlyArray<ProductFileSheetSummary>;
}): { selectedSheetName: string; options: string[] } {
  const options = params.sheets.map((sheet) => sheet.sheetName.trim()).filter((sheetName) => sheetName.length > 0);
  const selectedSheetName = params.bindingSheetName?.trim() || params.defaultSheetName?.trim() || options[0] || '';
  if (selectedSheetName && !options.some((sheetName) => sheetName === selectedSheetName)) {
    return { selectedSheetName, options: [selectedSheetName, ...options] };
  }
  return { selectedSheetName, options };
}

export function getMonthlyRunSourceSheetControlModel(params: {
  allowSheetNameOverride?: boolean;
  binding: MonthlyRunSourceBinding | null;
  defaultSheetName?: string | null;
  sheets: ReadonlyArray<ProductFileSheetSummary>;
}): { fileId: number; selectedSheetName: string; options: string[] } | null {
  if (!params.allowSheetNameOverride || !params.binding?.fileId) return null;
  return {
    fileId: params.binding.fileId,
    ...getMonthlyRunSheetNameOptions({
      bindingSheetName: params.binding.sheetName,
      defaultSheetName: params.defaultSheetName,
      sheets: params.sheets,
    }),
  };
}

export function retainAvailableSourceBindings(
  bindings: Record<string, MonthlyRunSourceBinding>,
  availableFiles: ReadonlyArray<Pick<ProductFileRecord, 'id' | 'logicalPath'>>,
): Record<string, MonthlyRunSourceBinding> {
  if (availableFiles.length === 0) return bindings;
  return Object.fromEntries(
    Object.entries(bindings).filter(([, binding]) => availableFiles.some((file) => isFileForBinding(file, binding))),
  );
}

export function getMonthlyRunModalSourceDefinitions<T extends Pick<MonthlyRunSourceDefinition, 'sourceKey'>>(
  sourceDefinitions: ReadonlyArray<T>,
  activeSourceKey?: string | null,
): T[] {
  if (!activeSourceKey) return [...sourceDefinitions];
  return sourceDefinitions.filter((source) => source.sourceKey === activeSourceKey);
}

export function getMonthlyRunFileCandidatesForSource<
  T extends Pick<ProductFileRecord, 'id' | 'displayName' | 'originalName'> & { logicalPath?: string | null },
>(
  sourceKey: string,
  files: ReadonlyArray<T>,
  currentFileId?: number | null,
  currentFileKey?: string | null,
  month?: string | null,
): T[] {
  // Control Book Summary (base_control_book) and Futu BCI Exercises base (base_futu_exercises)
  // reuse the prior month's dated base, kept under their dedicated folders (control_book/ and
  // futu_exercises/). Every other source is scoped to the current month's input folder.
  const folderPrefix =
    sourceKey === 'base_control_book'
      ? 'control_book/'
      : sourceKey === 'base_futu_exercises'
        ? 'futu_exercises/'
        : month && /^\d{4}-\d{2}$/.test(month)
          ? `input/${month}/`
          : null;
  const scoped = folderPrefix
    ? files.filter((file) => normalizedFileKey(file.logicalPath).startsWith(folderPrefix))
    : [...files];
  const currentBinding = currentFileId
    ? { fileId: currentFileId, logicalPath: currentFileKey ?? null, fileKey: currentFileKey ?? null }
    : null;
  const matchers = sourceFileNameMatchers[sourceKey];
  const normalizedMatchers = matchers?.map(normalizeCandidateText) ?? [];
  const matchingFiles = normalizedMatchers.length
    ? scoped.filter((file) => {
        const name = normalizeCandidateText(productFileCandidateName(file));
        if (sourceKey === 'option_plans_summary' && name.includes('options os detail')) return false;
        return normalizedMatchers.some((matcher) => name.includes(matcher));
      })
    : scoped;
  // Fall back to the whole scoped folder when nothing matches by name, so the folder still limits choice.
  const result = matchingFiles.length ? matchingFiles : scoped;
  // Always keep the already-configured file, even if it now lives outside the scoped folder.
  if (currentBinding && !result.some((file) => isFileForBinding(file, currentBinding))) {
    const currentFile = files.find((file) => isFileForBinding(file, currentBinding));
    if (currentFile) return [...result, currentFile];
  }
  return result;
}

function sourceBindingsFromInstance(
  instance: MonthlyRunInstanceRecord | null,
): Record<string, MonthlyRunSourceBinding> {
  // A failed/empty instance response used to take the whole page down on `instance.sources`.
  if (!instance?.sources) return {};
  return Object.fromEntries(
    Object.entries(instance.sources)
      .filter(([, value]) => typeof value.fileId === 'number' && value.fileId > 0)
      .map(([sourceKey, value]) => [
        sourceKey,
        {
          fileId: value.fileId as number,
          logicalPath: value.logicalPath ?? null,
          fileKey: value.logicalPath ?? null,
          sheetName: value.sheetName,
        },
      ]),
  );
}

function normalizedFileKey(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

function isFileForBinding(
  file: Pick<ProductFileRecord, 'id'> & { logicalPath?: string | null },
  binding: Pick<MonthlyRunSourceBinding, 'fileId' | 'logicalPath' | 'fileKey'> | null | undefined,
): boolean {
  if (!binding) return false;
  if (file.id === binding.fileId) return true;
  const bindingKey = normalizedFileKey(binding.logicalPath ?? binding.fileKey);
  return Boolean(bindingKey && normalizedFileKey(file.logicalPath) === bindingKey);
}

/**
 * Input Files is a single flat list. The server already sorted the definitions by the
 * DB-owned `order` field, so this only drops hidden sources — sourceGroup is deliberately not
 * used for grouping or sorting; reorder rows by editing `order` in the workflow definition.
 */
export function getMonthlyRunVisibleSources<T extends Pick<MonthlyRunSourceDefinition, 'hidden'>>(
  sourceDefinitions: ReadonlyArray<T>,
): T[] {
  return sourceDefinitions.filter((source) => !source.hidden);
}

/**
 * The run panel shows exactly one month's run. Returns true when the run state currently held
 * belongs to a different month than the selected one, so it must be dropped rather than left on
 * screen next to another month's (possibly empty) run history.
 */
export function isRunPanelStaleForMonth(activeRunMonth: string | null, selectedMonth: string): boolean {
  if (!activeRunMonth) return false;
  return activeRunMonth !== selectedMonth;
}

export function getMonthlyRunWarningTaskIds(run: Pick<WorkflowRunRecord, 'steps'>): string[] {
  return run.steps.filter((step) => step.status === 'warning').map((step) => step.taskId);
}

function statusLabel(status: string, language: AppLanguage = 'zh-CN'): string {
  if (language === 'zh-CN') {
    if (status === 'completed') return '已完成';
    if (status === 'completed_with_warnings') return '完成（含告警）';
    if (status === 'waiting_approval') return '需复核';
    if (status === 'failed') return '失败';
    if (status === 'skipped') return '已跳过';
    if (status === 'running') return '运行中';
    return status || '待启动';
  }
  if (status === 'completed') return 'Completed';
  if (status === 'completed_with_warnings') return 'Completed with warnings';
  if (status === 'waiting_approval') return 'Needs review';
  if (status === 'failed') return 'Failed';
  if (status === 'skipped') return 'Skipped';
  if (status === 'running') return 'Running';
  return status || 'Pending';
}

function taskStateLabel(status: WorkflowExecutionTaskState, language: AppLanguage = 'zh-CN'): string {
  if (language === 'zh-CN') {
    if (status === 'completed') return '已完成';
    if (status === 'running') return '运行中';
    if (status === 'failed') return '失败';
    if (status === 'blocked') return '已阻塞';
    if (status === 'warning') return '需复核';
    if (status === 'skipped') return '已跳过';
    return '待启动';
  }
  if (status === 'completed') return 'Completed';
  if (status === 'running') return 'Running';
  if (status === 'failed') return 'Failed';
  if (status === 'blocked') return 'Blocked';
  if (status === 'warning') return 'Needs review';
  if (status === 'skipped') return 'Skipped';
  return 'Pending';
}

function isMonthlyRunAttentionStatus(status: string): boolean {
  return status === 'failed' || status === 'waiting_approval' || status === 'completed_with_warnings';
}

function isMonthlyRunAttentionMessage(message?: string): boolean {
  return Boolean(message && !/submitting|submitted|ready|continuing|skipping/i.test(message));
}

function monthFolder(month: string): string {
  return /^\d{4}-\d{2}$/.test(month) ? month : new Date().toISOString().slice(0, 7);
}

export function resolveMonthlyRunPreviewFileId(
  run: Pick<WorkflowRunRecord, 'artifacts'> | null | undefined,
  instance: Pick<MonthlyRunInstanceRecord, 'latestOutputFileId'> | null | undefined,
): number | null {
  const artifactFileId =
    run?.artifacts.find(
      (artifact) => artifact.artifactType === 'file' && typeof artifact.fileId === 'number' && artifact.fileId > 0,
    )?.fileId ?? null;
  if (artifactFileId) return artifactFileId;
  const latestOutputFileId = instance?.latestOutputFileId ?? null;
  return typeof latestOutputFileId === 'number' && latestOutputFileId > 0 ? latestOutputFileId : null;
}

export function createMonthlyRunPage({
  el,
  api,
  escapeHtml,
  formatDateTime,
  refreshProductFiles,
  refreshSummary,
  openProductFile,
  notify,
  confirmAction,
  getLanguage,
  onMonthChanged,
  onPlanStatusChanged,
}: MonthlyRunPageDeps) {
  const runClient = createWorkflowRunClient(api);
  let files: ProductFileRecord[] = [];
  let monthlyWorkflowCode = '';
  /** Set when the DB monthly workflow definition version differs from MONTHLY_WORKFLOW_VERSION. */
  let workflowVersionMismatch: { expected: number; actual: number } | null = null;
  let sourceDefinitions: MonthlyRunSourceDefinition[] = [];
  let currentInstance: MonthlyRunInstanceRecord | null = null;
  let selectedSources: Record<string, MonthlyRunSourceBinding> = {};
  let draftSources: SourceDraftBindings = {};
  let activeSourceModalKey: string | null = null;
  const sourceSheetSummariesByFileId = new Map<number, SourceSheetSummaryState>();
  let activeHistoryId: number | null = null;
  let activeRun: WorkflowRunRecord | null = null;
  /** Month that activeRun / activeHistoryId belong to, so they can be dropped when it changes. */
  let activeRunMonth: string | null = null;
  let isRunning = false;
  let isSavingSources = false;
  let monthlyConstantsCollapsed = false;
  const expandedWarningTaskIds = new Set<string>();
  const text = {
    selectMonth: { 'zh-CN': '请选择月份', 'en-US': 'Please select a month' },
    codeDefined: { 'zh-CN': '代码定义', 'en-US': 'Code defined' },
    noInputDefinitions: { 'zh-CN': '暂无输入定义', 'en-US': 'No input definitions' },
    loadingSourceConfig: { 'zh-CN': '正在加载 source 配置…', 'en-US': 'Loading source configuration…' },
    configureSourcesHint: {
      'zh-CN': '请先配置每个 workflow 输入节点需要使用的源文件。',
      'en-US': 'Configure the source files required by each workflow input node first.',
    },
    notConfigured: { 'zh-CN': '未配置', 'en-US': 'Not configured' },
    notUploaded: { 'zh-CN': '未上传', 'en-US': 'Not uploaded' },
    optionalNotConfigured: { 'zh-CN': '未配置（可选）', 'en-US': 'Not configured (optional)' },
    optionalInherit: { 'zh-CN': 'Optional · 继承', 'en-US': 'Optional · Inherit' },
    optionalValidation: { 'zh-CN': 'Optional · 校验', 'en-US': 'Optional · Validation' },
    optionalSupplement: { 'zh-CN': 'Optional · 补充', 'en-US': 'Optional · Supplement' },
    optionalSourceHint: {
      'zh-CN': '可选输入：未提供时运行会产生 warning，批准后跳过该输入对应的修正。',
      'en-US':
        'Optional input: if omitted, the run raises a warning and skips the adjustment associated with this input after approval.',
    },
    chooseUploadedFile: { 'zh-CN': '选择已上传文件', 'en-US': 'Choose uploaded file' },
    currentFile: { 'zh-CN': '当前文件', 'en-US': 'Current file' },
    uploadNewFile: { 'zh-CN': '上传新文件', 'en-US': 'Upload new file' },
    monthlyConstantsTitle: { 'zh-CN': '月度常量', 'en-US': 'Monthly Constants' },
    collapseMonthlyConstants: { 'zh-CN': '收起月度常量', 'en-US': 'Collapse Monthly Constants' },
    expandMonthlyConstants: { 'zh-CN': '展开月度常量', 'en-US': 'Expand Monthly Constants' },
    monthlyConstantsHeaderHelp: {
      'zh-CN': '这些常量按月份保存，并参与当月 Cap Table 计算；编辑某一行只会更新该行。',
      'en-US':
        'These constants are stored per month and used by the monthly Cap Table calculation; editing a row updates only that row.',
    },
    monthlyConstantName: { 'zh-CN': '常量', 'en-US': 'Constant' },
    monthlyConstantValue: { 'zh-CN': '数值', 'en-US': 'Value' },
    monthlyConstantActions: { 'zh-CN': '操作', 'en-US': 'Actions' },
    editMonthlyConstant: { 'zh-CN': '编辑', 'en-US': 'Edit' },
    saveMonthlyConstant: { 'zh-CN': '保存', 'en-US': 'Save' },
    cancelMonthlyConstant: { 'zh-CN': '取消', 'en-US': 'Cancel' },
    monthlyConstantsSaved: { 'zh-CN': '月度常量已保存', 'en-US': 'Monthly constants saved' },
    selectSourceFile: { 'zh-CN': '选择', 'en-US': 'Select' },
    defaultSheet: { 'zh-CN': '默认 Sheet', 'en-US': 'Default Sheet' },
    sheetName: { 'zh-CN': 'Sheet 名称', 'en-US': 'Sheet name' },
    sheetNameRequired: { 'zh-CN': '请填写 Sheet 名称', 'en-US': 'Enter a sheet name' },
    inputSheet: { 'zh-CN': '输入 Sheet', 'en-US': 'Input sheet' },
    sheetSaved: { 'zh-CN': '输入 Sheet 已保存', 'en-US': 'Input sheet saved' },
    sheetSaveFailed: { 'zh-CN': '输入 Sheet 保存失败', 'en-US': 'Failed to save input sheet' },
    copy: { 'zh-CN': '复制', 'en-US': 'Copy' },
    copiedFileName: { 'zh-CN': '文件名已复制', 'en-US': 'File name copied' },
    copyFileNameFailed: { 'zh-CN': '复制文件名失败', 'en-US': 'Failed to copy file name' },
    fileNameHelp: { 'zh-CN': '输入文件用途', 'en-US': 'Input file purpose' },
    fileNameHelpHint: {
      'zh-CN': '点击每个输入项旁的问号，可查看该文件在 Monthly Update 中的用途。',
      'en-US': 'Click the question mark beside an input to see how the file is used in Monthly Update.',
    },
    requiredHelp: { 'zh-CN': 'Is required 取值说明', 'en-US': 'Is required value meanings' },
    requiredHelpHint: {
      'zh-CN':
        'Required：必需提供，缺少时不能执行。\nOptional · Inherit：继承上一轮输出，缺少时使用系统已保存结果。\nOptional · Validation：仅用于校验，不影响核心计算。\nOptional · Supplement：可选补充逻辑，缺少时仍可计算。',
      'en-US':
        'Required: must be provided or execution is blocked.\nOptional · Inherit: carries forward the prior output when no new file is provided.\nOptional · Validation: used only for validation and does not affect core calculations.\nOptional · Supplement: adds optional logic; calculation can continue without it.',
    },
    removeConfigTitle: { 'zh-CN': '删除 Uploaded file 配置', 'en-US': 'Delete Uploaded file configuration' },
    removeConfigConfirm: { 'zh-CN': '确定删除', 'en-US': 'Delete the Uploaded file configuration for' },
    removeConfigSuffix: {
      'zh-CN': '的 Uploaded file 配置吗？文件中心里的文件不会被删除。',
      'en-US': '? The file in Files will not be deleted.',
    },
    removedConfig: { 'zh-CN': '已删除', 'en-US': 'Deleted the Uploaded file configuration for' },
    removedConfigSuffix: { 'zh-CN': '的 Uploaded file 配置', 'en-US': '' },
    chooseFileFor: { 'zh-CN': '请先为', 'en-US': 'Please select a file for' },
    completeSourceConfig: { 'zh-CN': '请先完成 source 配置', 'en-US': 'Complete source configuration first' },
    workflowVersionMismatch: {
      'zh-CN':
        '月度更新工作流版本不匹配：前端 UI 基于 v{expected} 编写，数据库中的工作流定义为 v{actual}。请先更新数据库中的工作流定义或前端代码，使两边版本一致后再执行。',
      'en-US':
        'Monthly workflow version mismatch: this UI was built for workflow definition v{expected}, but the database holds v{actual}. Update the workflow definition (or the UI) so both versions match before running Monthly Update.',
    },
    submittingRun: { 'zh-CN': '正在提交 Monthly Update...', 'en-US': 'Submitting Monthly Update...' },
    submittedRun: { 'zh-CN': 'Monthly Update 已提交', 'en-US': 'Monthly Update submitted' },
    emptyRunState: {
      'zh-CN': '执行后会在这里显示节点状态。',
      'en-US': 'Node status will appear here after execution.',
    },
    reviewRequired: { 'zh-CN': '需人工复核', 'en-US': 'review required' },
    showWarningDetails: { 'zh-CN': '查看告警详情', 'en-US': 'View warning details' },
    hideWarningDetails: { 'zh-CN': '收起告警详情', 'en-US': 'Hide warning details' },
    noHistory: { 'zh-CN': '暂无执行历史', 'en-US': 'No execution history' },
    fileCount: { 'zh-CN': '个文件', 'en-US': 'files' },
    noInputSnapshot: { 'zh-CN': '暂无输入快照', 'en-US': 'No input snapshot' },
    loadingHistoryRun: { 'zh-CN': '正在加载历史执行记录...', 'en-US': 'Loading historical run...' },
    historyMissingRun: {
      'zh-CN': '该历史记录没有关联 workflow 执行记录',
      'en-US': 'This history record has no workflow run attached',
    },
    historyLoadFailed: { 'zh-CN': '加载历史执行记录失败', 'en-US': 'Failed to load historical run' },
    runHistory: { 'zh-CN': '运行历史', 'en-US': 'Run history' },
    cannotDeleteRunning: {
      'zh-CN': '运行中或待审批的记录不能删除',
      'en-US': 'Running or approval-pending records cannot be deleted',
    },
    deleteHistoryTitle: { 'zh-CN': '删除运行历史及输出文件', 'en-US': 'Delete run history and output file' },
    deleteHistoryConfirm: { 'zh-CN': '确定删除这条运行历史吗？', 'en-US': 'Delete this run history?' },
    outputDeleteNotice: { 'zh-CN': '对应输出文件', 'en-US': 'The output file' },
    outputDeleteNoticeSuffix: { 'zh-CN': '也会被永久删除。', 'en-US': 'will also be permanently deleted.' },
    historyDeleted: {
      'zh-CN': '运行历史及对应输出文件已删除',
      'en-US': 'Run history and corresponding output file deleted',
    },
    previewExcel: { 'zh-CN': '预览', 'en-US': 'Preview' },
    delete: { 'zh-CN': '删除', 'en-US': 'Delete' },
  } satisfies Record<string, Record<AppLanguage, string>>;

  function lang(): AppLanguage {
    return getLanguage?.() ?? 'zh-CN';
  }

  function tt(key: keyof typeof text): string {
    return text[key][lang()] ?? text[key]['zh-CN'];
  }

  function discardRunStateForOtherMonth() {
    if (!isRunPanelStaleForMonth(activeRunMonth, el<HTMLInputElement>('monthlyRunMonth').value)) return;
    activeHistoryId = null;
    activeRun = null;
    activeRunMonth = null;
    expandedWarningTaskIds.clear();
  }

  async function init() {
    el('btnMonthlyRunConfigureSources').addEventListener('click', () => void openSourceModal());
    el('btnMonthlyRunRefreshFiles').addEventListener('click', () => void refreshFiles());
    el('btnTriggerMonthlyRun').addEventListener('click', () => void triggerMonthlyRun());
    el('btnMonthlyRunContinue').addEventListener('click', () => void approveActiveRun('approved'));
    el('btnMonthlyRunSkip').addEventListener('click', () => void approveActiveRun('skipped'));
    el('monthlyRunMonth').addEventListener('change', () => {
      discardRunStateForOtherMonth();
      renderSourceInfo();
      renderRunPanel();
      onMonthChanged?.(el<HTMLInputElement>('monthlyRunMonth').value);
      if (!el('monthlyRunSourceModal').classList.contains('hidden')) {
        renderSourceModal();
      }
    });
    bindSourceModalEvents();
    await Promise.all([refreshSourceConfig(), refreshFiles(), refreshInstance(), refreshHistory()]);
    renderRunPanel();
  }

  async function onActivate() {
    discardRunStateForOtherMonth();
    await Promise.all([refreshSourceConfig(), refreshFiles(), refreshInstance(), refreshHistory()]);
    renderRunPanel();
    if (activeRun && !isWorkflowRunTerminalStatus(activeRun.status)) {
      await refreshActiveRun();
    }
  }

  async function openForMonth(month: string) {
    if (month) {
      el<HTMLInputElement>('monthlyRunMonth').value = month;
      renderSourceInfo();
    }
    await onActivate();
  }

  function bindSourceModalEvents() {
    el('btnCloseMonthlyRunSourceModal').addEventListener('click', closeSourceModal);
    el('btnCancelMonthlyRunSourceModal').addEventListener('click', closeSourceModal);
    el('btnSaveMonthlyRunSourceModal').addEventListener('click', () => void saveSourceModal());
    el('monthlyRunSourceModal').addEventListener('click', (event) => {
      if (event.target === el('monthlyRunSourceModal')) closeSourceModal();
    });
  }

  async function refreshSourceConfig() {
    const data = await api<MonthlyRunSourceConfigResponse>('/api/monthly-runs/source-config');
    monthlyWorkflowCode = data.workflowCode;
    workflowVersionMismatch = monthlyWorkflowVersionMismatch(data.workflowVersion);
    sourceDefinitions = workflowVersionMismatch ? [] : data.sources;
    ensureSelectedSourceBindings();
    if (workflowVersionMismatch) {
      // Never render sources for a definition this page does not know: the rows would not match the
      // workflow the server would actually run. Surface the mismatch and block execution instead.
      notify(formatWorkflowVersionMismatch(workflowVersionMismatch), { type: 'error' });
    }
    renderSourceInfo();
    renderBusinessDefinedInputConfiguration();
  }

  function formatWorkflowVersionMismatch(mismatch: { expected: number; actual: number }): string {
    return tt('workflowVersionMismatch')
      .replace('{expected}', String(mismatch.expected))
      .replace('{actual}', String(mismatch.actual));
  }

  async function refreshInstance() {
    const month = el<HTMLInputElement>('monthlyRunMonth').value;
    if (!month) {
      currentInstance = null;
      selectedSources = {};
      renderSourceInfo();
      renderBusinessDefinedInputConfiguration();
      return;
    }
    const data = await api<{ instance: MonthlyRunInstanceRecord }>(
      `/api/monthly-runs/instance?month=${encodeURIComponent(month)}`,
    );
    currentInstance = data.instance;
    selectedSources = sourceBindingsFromInstance(data.instance);
    renderSourceInfo();
    renderBusinessDefinedInputConfiguration();
  }

  async function saveInstance(patch: MonthlyRunInstanceUpsertRequest) {
    const month = el<HTMLInputElement>('monthlyRunMonth').value;
    if (!month) throw new Error(tt('selectMonth'));
    const data = await api<{ instance: MonthlyRunInstanceRecord }>(
      `/api/monthly-runs/instance?month=${encodeURIComponent(month)}`,
      {
        method: 'PUT',
        body: JSON.stringify(patch),
      },
    );
    currentInstance = data.instance;
    selectedSources = sourceBindingsFromInstance(data.instance);
    renderSourceInfo();
    renderBusinessDefinedInputConfiguration();
  }

  async function refreshFiles() {
    const data = await api<{ files: ProductFileRecord[] }>('/api/files');
    files = data.files;
    sanitizeSelectedSourceBindings();
    renderSourceInfo();
    renderBusinessDefinedInputConfiguration();
    if (!el('monthlyRunSourceModal').classList.contains('hidden')) {
      renderSourceModal();
    }
  }

  function renderBusinessDefinedInputConfiguration() {
    // One flat table in DB `order`; sources flagged hidden in the workflow definition are dropped
    // (e.g. Previous Capitalization Summary, which the business auto-derives from last month).
    el('monthlyRunSourcesBody').innerHTML = renderBusinessDefinedSourceRows();
    const headerHelp = document.querySelector<HTMLButtonElement>('[data-source-help-header]');
    const headerPopover = document.querySelector<HTMLElement>('[data-source-help-header-popover]');
    if (headerHelp && headerPopover) {
      headerHelp.setAttribute('aria-label', tt('fileNameHelp'));
      headerHelp.title = tt('fileNameHelp');
      headerPopover.textContent = tt('fileNameHelpHint');
      headerHelp.onclick = () => headerPopover.classList.toggle('hidden');
    }
    const requiredHelp = document.querySelector<HTMLButtonElement>('[data-required-help-header]');
    const requiredPopover = document.querySelector<HTMLElement>('[data-required-help-header-popover]');
    if (requiredHelp && requiredPopover) {
      requiredHelp.setAttribute('aria-label', tt('requiredHelp'));
      requiredHelp.title = tt('requiredHelp');
      requiredPopover.textContent = tt('requiredHelpHint');
      requiredPopover.style.whiteSpace = 'pre-line';
      requiredHelp.onclick = () => requiredPopover.classList.toggle('hidden');
    }

    document.querySelectorAll<HTMLButtonElement>('[data-business-source-upload]').forEach((button) => {
      button.addEventListener('click', () => {
        const sourceKey = button.dataset.businessSourceUpload;
        if (!sourceKey) return;
        void uploadSourceFileFor(sourceKey);
      });
    });

    document.querySelectorAll<HTMLButtonElement>('[data-source-help]').forEach((button) => {
      button.addEventListener('click', () => {
        const sourceKey = button.dataset.sourceHelp;
        if (!sourceKey) return;
        const popover = document.querySelector<HTMLElement>(`[data-source-help-popover="${CSS.escape(sourceKey)}"]`);
        if (!popover) return;
        const wasHidden = popover.classList.contains('hidden');
        document
          .querySelectorAll<HTMLElement>('[data-source-help-popover]')
          .forEach((item) => item.classList.add('hidden'));
        popover.classList.toggle('hidden', !wasHidden);
      });
    });

    document.querySelectorAll<HTMLButtonElement>('[data-business-source-configure]').forEach((button) => {
      button.addEventListener('click', () => {
        const sourceKey = button.dataset.businessSourceConfigure;
        if (!sourceKey) return;
        openSourceModal(sourceKey);
      });
    });

    document.querySelectorAll<HTMLSelectElement>('[data-business-source-sheet]').forEach((select) => {
      select.addEventListener('change', () => {
        const sourceKey = select.dataset.businessSourceSheet;
        if (!sourceKey) return;
        void saveBusinessSourceSheet(sourceKey, select.value);
      });
    });

    document.querySelectorAll<HTMLButtonElement>('[data-business-source-remove]').forEach((button) => {
      button.addEventListener('click', () => {
        const sourceKey = button.dataset.businessSourceRemove;
        if (!sourceKey) return;
        void removeSourceFileFor(sourceKey);
      });
    });

    document.querySelectorAll<HTMLButtonElement>('.source-file-link[data-source-file-preview]').forEach((button) => {
      button.addEventListener('click', () => {
        const fileId = Number(button.dataset.sourceFilePreview);
        if (!fileId) return;
        void openProductFile(fileId);
      });
    });

    document.querySelectorAll<HTMLButtonElement>('.source-file-copy[data-source-file-copy]').forEach((button) => {
      button.addEventListener('click', () => {
        const fileName = button.dataset.sourceFileCopy;
        if (!fileName) return;
        void copySourceFileName(fileName);
      });
    });

    renderMonthlyConstants();
  }

  // Monthly fixed values rendered on the main Monthly Update page (below the source table),
  // so admins can review and edit them without opening the source modal. Each row saves its
  // own value so a partial edit cannot overwrite unrelated monthly constants.
  function renderMonthlyConstants() {
    const host = el('monthlyRunConstantsBlock');
    if (!host) return;
    const fv = currentInstance?.fixedValues ?? {};
    host.innerHTML = `
      <div class="card-header monthly-run-constants__header">
        <h3 class="card-title monthly-run-constants__title">${escapeHtml(tt('monthlyConstantsTitle'))}</h3>
        <button class="card-collapse__btn monthly-run-constants-toggle" type="button" aria-expanded="${String(!monthlyConstantsCollapsed)}" aria-controls="monthlyRunConstantsBody" title="${escapeHtml(monthlyConstantsCollapsed ? tt('expandMonthlyConstants') : tt('collapseMonthlyConstants'))}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
        </button>
      </div>
      <div class="card-body monthly-run-constants-body" id="monthlyRunConstantsBody">
      <div class="monthly-run-constants__table-wrap">
        <table class="source-table monthly-run-constants__table">
          <thead>
            <tr>
              <th>${escapeHtml(tt('monthlyConstantName'))}</th>
              <th>${escapeHtml(tt('monthlyConstantValue'))}</th>
              <th>${escapeHtml(tt('monthlyConstantActions'))}</th>
            </tr>
          </thead>
          <tbody>
            ${MONTHLY_FIXED_VALUE_DEFS.map(
              (def) => `
              <tr data-constant-row="${escapeHtml(def.key)}">
                <td class="monthly-run-constants__label"><span>${escapeHtml(def.label[lang()] ?? def.label['zh-CN'])}</span><button type="button" class="monthly-run-constants__help" data-constant-help="${escapeHtml(def.key)}" aria-label="${escapeHtml(def.description[lang()] ?? def.description['zh-CN'])}" title="${escapeHtml(def.description[lang()] ?? def.description['zh-CN'])}"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"></circle><path d="M9.8 9a2.3 2.3 0 1 1 3.8 1.7c-.9.7-1.6 1.1-1.6 2.3"></path><path d="M12 16.5h.01"></path></svg></button><span class="monthly-run-constants__help-popover hidden" data-constant-help-popover="${escapeHtml(def.key)}">${escapeHtml(def.description[lang()] ?? def.description['zh-CN'])}</span></td>
                <td><input class="search-input monthly-run-constants__input" type="text" inputmode="decimal" data-const-key="${escapeHtml(def.key)}" value="${fv[def.key] === undefined ? '' : escapeHtml(String(fv[def.key]))}" disabled></td>
                <td class="monthly-run-constants__actions">
                  <button class="source-upload-btn monthly-run-constants__edit" type="button" data-constant-edit="${escapeHtml(def.key)}" title="${escapeHtml(tt('editMonthlyConstant'))}" aria-label="${escapeHtml(tt('editMonthlyConstant'))}"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m4 16.5-.8 3.3 3.3-.8L18.2 7.3a2.1 2.1 0 0 0-3-3L4 16.5Z"></path><path d="m13.8 5.2 3 3"></path></svg><span>${escapeHtml(tt('editMonthlyConstant'))}</span></button>
                  <span class="monthly-run-constants__edit-actions hidden" data-constant-edit-actions="${escapeHtml(def.key)}">
                    <button class="source-upload-btn monthly-run-constants__save" type="button" data-constant-save="${escapeHtml(def.key)}" title="${escapeHtml(tt('saveMonthlyConstant'))}" aria-label="${escapeHtml(tt('saveMonthlyConstant'))}"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m5 12 4.5 4.5L19 7"></path></svg><span>${escapeHtml(tt('saveMonthlyConstant'))}</span></button>
                    <button class="source-file-delete source-file-delete--text monthly-run-constants__cancel" type="button" data-constant-cancel="${escapeHtml(def.key)}" title="${escapeHtml(tt('cancelMonthlyConstant'))}" aria-label="${escapeHtml(tt('cancelMonthlyConstant'))}">${escapeHtml(tt('cancelMonthlyConstant'))}</button>
                  </span>
                </td>
              </tr>`,
            ).join('')}
          </tbody>
        </table>
      </div>
      </div>`;

    host.classList.toggle('is-collapsed', monthlyConstantsCollapsed);
    host.querySelector<HTMLButtonElement>('.monthly-run-constants-toggle')?.addEventListener('click', (event) => {
      monthlyConstantsCollapsed = !monthlyConstantsCollapsed;
      host.classList.toggle('is-collapsed', monthlyConstantsCollapsed);
      const button = event.currentTarget as HTMLButtonElement;
      button.setAttribute('aria-expanded', String(!monthlyConstantsCollapsed));
      button.setAttribute(
        'title',
        monthlyConstantsCollapsed ? tt('expandMonthlyConstants') : tt('collapseMonthlyConstants'),
      );
    });

    host.querySelectorAll<HTMLButtonElement>('[data-constant-help]').forEach((button) => {
      button.addEventListener('click', () => {
        const key = button.dataset.constantHelp;
        if (!key) return;
        host
          .querySelector<HTMLElement>(`[data-constant-help-popover="${CSS.escape(key)}"]`)
          ?.classList.toggle('hidden');
      });
    });

    host.querySelectorAll<HTMLButtonElement>('[data-constant-edit]').forEach((button) => {
      button.addEventListener('click', () => {
        const key = button.dataset.constantEdit;
        if (!key) return;
        const input = host.querySelector<HTMLInputElement>(`[data-const-key="${CSS.escape(key)}"]`);
        const actions = host.querySelector<HTMLElement>(`[data-constant-edit-actions="${CSS.escape(key)}"]`);
        if (!input || !actions) return;
        input.disabled = false;
        button.classList.add('hidden');
        actions.classList.remove('hidden');
        input.focus();
        input.select();
      });
    });

    host.querySelectorAll<HTMLButtonElement>('[data-constant-cancel]').forEach((button) => {
      button.addEventListener('click', () => renderMonthlyConstants());
    });

    host.querySelectorAll<HTMLButtonElement>('[data-constant-save]').forEach((button) => {
      button.addEventListener('click', () => {
        const key = button.dataset.constantSave;
        if (!key) return;
        const input = host.querySelector<HTMLInputElement>(`[data-const-key="${CSS.escape(key)}"]`);
        if (!input) return;
        const parsed = Number(input.value.replace(/[, ]/g, ''));
        if (input.value.trim() === '' || !Number.isFinite(parsed)) {
          notify(tt('monthlyConstantValue'), { type: 'warning' });
          return;
        }
        void (async () => {
          try {
            await saveInstance({ fixedValues: { [key]: parsed } });
            notify(tt('monthlyConstantsSaved'), { type: 'success' });
          } catch (error) {
            notify(error instanceof Error ? error.message : String(error), { type: 'error' });
          }
        })();
      });
    });
  }

  function renderUploadedFileCell(file: ProductFileRecord) {
    const displayName = getFileDisplayName(file);
    const escapedDisplayName = escapeHtml(displayName);
    const copyLabel = tt('copy');
    const previewLabel = tt('previewExcel');
    return `<div class="source-file-actions">
      <button
        type="button"
        class="source-file-link"
        data-source-file-preview="${file.id}"
        title="${escapedDisplayName}"
        aria-label="${escapeHtml(`${previewLabel} ${displayName}`)}"
      >
        <span class="source-file-link__text">${escapedDisplayName}</span>
      </button>
      <button
        type="button"
        class="source-file-copy"
        data-source-file-copy="${escapedDisplayName}"
        title="${escapeHtml(copyLabel)}"
        aria-label="${escapeHtml(copyLabel)}"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="9" y="9" width="11" height="11" rx="2"></rect>
          <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"></path>
        </svg>
      </button>
    </div>`;
  }

  function renderBusinessSourceSheetControl(
    source: MonthlyRunSourceDefinition,
    binding: MonthlyRunSourceBinding | null,
  ) {
    const sheetState = binding?.fileId ? sourceSheetSummariesByFileId.get(binding.fileId) : null;
    const model = getMonthlyRunSourceSheetControlModel({
      allowSheetNameOverride: source.allowSheetNameOverride,
      binding,
      defaultSheetName: source.defaultSheetName,
      sheets: sheetState?.sheets ?? [],
    });
    if (!model) return '';
    void ensureSourceSheetSummaries(model.fileId);
    const options = model.options
      .map(
        (sheetName) =>
          `<option value="${escapeHtml(sheetName)}"${sheetName === model.selectedSheetName ? ' selected' : ''}>${escapeHtml(sheetName)}</option>`,
      )
      .join('');
    const status = sheetState?.loading
      ? `<span class="source-sheet-control__status">Loading...</span>`
      : sheetState?.errorMessage
        ? `<span class="source-sheet-control__status source-sheet-control__status--error">${escapeHtml(sheetState.errorMessage)}</span>`
        : '';
    return `<label class="source-sheet-control">
      <span class="source-sheet-control__label">${escapeHtml(tt('inputSheet'))}</span>
      <select class="search-input source-sheet-control__select" data-business-source-sheet="${escapeHtml(source.sourceKey)}"${sheetState?.loading ? ' disabled' : ''}>
        ${options}
      </select>
      ${status}
    </label>`;
  }

  async function saveBusinessSourceSheet(sourceKey: string, sheetName: string) {
    const binding = selectedSources[sourceKey];
    const nextSheetName = sheetName.trim();
    if (!binding?.fileId || !nextSheetName || binding.sheetName === nextSheetName) return;
    const previousBinding = binding;
    selectedSources[sourceKey] = { ...binding, sheetName: nextSheetName };
    renderBusinessDefinedInputConfiguration();
    try {
      await saveInstance({
        operator: currentInstance?.operator ?? 'Administrator',
        sources: { [sourceKey]: selectedSources[sourceKey] },
      });
      notify(tt('sheetSaved'), { type: 'success' });
    } catch (error) {
      selectedSources[sourceKey] = previousBinding;
      renderBusinessDefinedInputConfiguration();
      notify(error instanceof Error ? error.message : tt('sheetSaveFailed'), { type: 'error' });
    }
  }

  function renderBusinessDefinedSourceRows() {
    if (workflowVersionMismatch) {
      return `<tr><td colspan="5" class="table-empty-cell" style="color:#b91c1c;">${escapeHtml(formatWorkflowVersionMismatch(workflowVersionMismatch))}</td></tr>`;
    }
    const sources = getMonthlyRunVisibleSources(sourceDefinitions);
    if (!sources.length)
      return `<tr><td colspan="5" class="table-empty-cell">${escapeHtml(tt('noInputDefinitions'))}</td></tr>`;
    return sources
      .map((source) => {
        const binding = selectedSources[source.sourceKey] ?? null;
        const file = getFileForBinding(binding);
        const uploaded = file
          ? `${renderUploadedFileCell(file)}${renderBusinessSourceSheetControl(source, binding)}`
          : `<span class="source-not-uploaded">${escapeHtml(source.required ? tt('notUploaded') : tt('optionalNotConfigured'))}</span>`;
        const uploadedTime = file ? formatUploadedTimestamp(file.createdAt) : '-';
        const actions = file
          ? `<div class="source-file-action-group">
              <button class="source-upload-btn" type="button" data-business-source-configure="${escapeHtml(source.sourceKey)}">${escapeHtml(tt('selectSourceFile'))}</button>
              <button class="source-file-delete source-file-delete--text" type="button" data-business-source-remove="${escapeHtml(source.sourceKey)}">${escapeHtml(tt('delete'))}</button>
            </div>`
          : `<div class="source-file-action-group">
              <button class="source-upload-btn" type="button" data-business-source-configure="${escapeHtml(source.sourceKey)}">${escapeHtml(tt('selectSourceFile'))}</button>
            </div>`;
        const requirementLabel = source.required
          ? 'Required'
          : source.optionalCategory === 'inherit'
            ? tt('optionalInherit')
            : source.optionalCategory === 'validation'
              ? tt('optionalValidation')
              : source.optionalCategory === 'supplement'
                ? tt('optionalSupplement')
                : 'Optional';
        return `<tr>
          <td style="text-align:left; font-weight:600; position:relative;">
            <div class="monthly-run-source-name">
              <span>${escapeHtml(source.label)}</span>
              <button type="button" class="monthly-run-source-help" data-source-help="${escapeHtml(source.sourceKey)}" aria-label="${escapeHtml(tt('fileNameHelp'))}" title="${escapeHtml(tt('fileNameHelp'))}">
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"></circle><path d="M9.8 9a2.3 2.3 0 1 1 3.8 1.7c-.9.7-1.6 1.1-1.6 2.3"></path><path d="M12 16.5h.01"></path></svg>
              </button>
            </div>
            <div class="monthly-run-source-help-popover hidden" data-source-help-popover="${escapeHtml(source.sourceKey)}">
              <strong>${escapeHtml(tt('fileNameHelp'))}</strong>
              <p>${escapeHtml(sourceDescription(source, lang()))}</p>
            </div>
          </td>
          <td>${source.required ? '<span class="source-required-badge">Required</span>' : `<span class="source-optional-badge source-optional-badge--${escapeHtml(source.optionalCategory ?? 'default')}">${escapeHtml(requirementLabel)}</span>`}</td>
          <td class="source-uploaded-cell">${uploaded}</td>
          <td class="source-uploaded-time">${escapeHtml(uploadedTime)}</td>
          <td>${actions}</td>
        </tr>`;
      })
      .join('');
  }

  function ensureSelectedSourceBindings() {
    if (!sourceDefinitions.length) return;
    selectedSources = retainAvailableSourceBindings(selectedSources, files);
  }

  function sanitizeSelectedSourceBindings() {
    selectedSources = retainAvailableSourceBindings(selectedSources, files);
    ensureSelectedSourceBindings();
  }

  function getFileById(fileId: number | null | undefined): ProductFileRecord | null {
    if (!fileId) return null;
    return files.find((file) => file.id === fileId) ?? null;
  }

  function getFileForBinding(binding: MonthlyRunSourceBinding | null | undefined): ProductFileRecord | null {
    if (!binding) return null;
    return files.find((file) => isFileForBinding(file, binding)) ?? null;
  }

  function getFileDisplayName(file: ProductFileRecord) {
    return file.displayName || file.originalName;
  }

  async function copySourceFileName(fileName: string) {
    try {
      await copyTextToClipboard(fileName);
      notify(`${fileName} ${tt('copiedFileName')}`, { type: 'success' });
    } catch (error) {
      notify(error instanceof Error ? error.message : tt('copyFileNameFailed'), { type: 'error' });
    }
  }

  async function copyTextToClipboard(text: string) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();
    if (!copied) throw new Error(tt('copyFileNameFailed'));
  }

  function formatUploadedTimestamp(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    const pad = (part: number) => String(part).padStart(2, '0');
    const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    return `${day} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  function renderSourceInfo() {
    const info = el('monthlyRunSourceInfo');
    if (workflowVersionMismatch) {
      info.innerHTML = `<span style="color:#b91c1c;">${escapeHtml(formatWorkflowVersionMismatch(workflowVersionMismatch))}</span>`;
      return;
    }
    if (!sourceDefinitions.length) {
      info.innerHTML = `<span>${escapeHtml(tt('loadingSourceConfig'))}</span>`;
      return;
    }

    const configured = sourceDefinitions.filter((source) => selectedSources[source.sourceKey]?.fileId);
    const optionalSources = sourceDefinitions.filter((source) => !source.required);
    const hints = [
      configured.length ? '' : tt('configureSourcesHint'),
      ...optionalSources.map((source) => `${source.label}: ${tt('optionalSourceHint')}`),
    ].filter(Boolean);
    const configuredPills = configured
      .map((source) => {
        const file = getFileForBinding(selectedSources[source.sourceKey] ?? null);
        return `<span class="monthly-run-source-pill"><strong>${escapeHtml(source.label)}</strong>${file ? escapeHtml(getFileDisplayName(file)) : escapeHtml(source.required ? tt('notConfigured') : tt('optionalNotConfigured'))}</span>`;
      })
      .join('');
    info.innerHTML = `${hints.map((hint) => `<span>${escapeHtml(hint)}</span>`).join('')}${configuredPills}`;
  }

  function openSourceModal(focusSourceKey?: string) {
    if (workflowVersionMismatch) {
      // No inputs can be configured for a definition this page does not know.
      notify(formatWorkflowVersionMismatch(workflowVersionMismatch), { type: 'error' });
      return;
    }
    activeSourceModalKey =
      focusSourceKey && sourceDefinitions.some((source) => source.sourceKey === focusSourceKey) ? focusSourceKey : null;
    draftSources = Object.fromEntries(
      sourceDefinitions.map((source) => [source.sourceKey, selectedSources[source.sourceKey] ?? null]),
    );
    renderSourceModal();
    el('monthlyRunSourceModal').classList.remove('hidden');
    if (focusSourceKey) {
      requestAnimationFrame(() => {
        const card = document.querySelector<HTMLElement>(`[data-source-key="${CSS.escape(focusSourceKey)}"]`);
        card?.scrollIntoView({ block: 'center' });
        card?.querySelector<HTMLInputElement | HTMLSelectElement>('[data-source-sheet]')?.focus();
      });
    }
  }

  function closeSourceModal() {
    if (isSavingSources) return;
    el('monthlyRunSourceModal').classList.add('hidden');
    activeSourceModalKey = null;
  }

  async function ensureSourceSheetSummaries(fileId: number) {
    const existing = sourceSheetSummariesByFileId.get(fileId);
    if (existing) return;
    sourceSheetSummariesByFileId.set(fileId, { sheets: [], loading: true, errorMessage: null });
    try {
      const detail = await api<ProductFileDetail>(`/api/files/${fileId}`);
      sourceSheetSummariesByFileId.set(fileId, { sheets: detail.sheets, loading: false, errorMessage: null });
    } catch (error) {
      sourceSheetSummariesByFileId.set(fileId, {
        sheets: [],
        loading: false,
        errorMessage: error instanceof Error ? error.message : 'Failed to load workbook sheets',
      });
    }
    if (!el('monthlyRunSourceModal').classList.contains('hidden')) {
      renderSourceModal();
    }
    renderBusinessDefinedInputConfiguration();
  }

  function renderSourceSheetControl(source: MonthlyRunSourceDefinition, binding: MonthlyRunSourceBinding | null) {
    const selectedFileId = binding?.fileId ?? null;
    const sheetState = selectedFileId ? sourceSheetSummariesByFileId.get(selectedFileId) : null;
    if (selectedFileId) void ensureSourceSheetSummaries(selectedFileId);
    const sheetOptions = getMonthlyRunSourceSheetControlModel({
      allowSheetNameOverride: source.allowSheetNameOverride,
      binding,
      defaultSheetName: source.defaultSheetName,
      sheets: sheetState?.sheets ?? [],
    });
    if (!sheetOptions) return '';
    const currentSheet = sheetOptions.selectedSheetName;
    const hint = sheetState?.loading
      ? `<div class="monthly-run-source-card__sheet-hint">Loading workbook sheets...</div>`
      : sheetState?.errorMessage
        ? `<div class="monthly-run-source-card__sheet-hint monthly-run-source-card__sheet-hint--error">${escapeHtml(sheetState.errorMessage)}</div>`
        : '';

    if (sheetOptions.options.length > 0) {
      const options = sheetOptions.options
        .map(
          (sheetName) =>
            `<option value="${escapeHtml(sheetName)}"${sheetName === currentSheet ? ' selected' : ''}>${escapeHtml(sheetName)}</option>`,
        )
        .join('');
      return `
        <label class="monthly-run-source-card__sheet">
          <span>${escapeHtml(tt('sheetName'))}</span>
          <select class="search-input" data-source-sheet="${escapeHtml(source.sourceKey)}">
            ${options}
          </select>
        </label>
        ${hint}
      `;
    }

    return `
      <label class="monthly-run-source-card__sheet">
        <span>${escapeHtml(tt('sheetName'))}</span>
        <input
          class="search-input"
          type="text"
          value="${escapeHtml(currentSheet)}"
          placeholder="${escapeHtml(source.defaultSheetName ?? 'Vesting Schedule')}"
          data-source-sheet="${escapeHtml(source.sourceKey)}"
        >
      </label>
      ${hint}
    `;
  }

  function renderSourceModal() {
    el('monthlyRunSourceModalMonth').textContent = monthFolder(el<HTMLInputElement>('monthlyRunMonth').value);
    const list = el('monthlyRunSourceList');
    const modalSources = getMonthlyRunModalSourceDefinitions(sourceDefinitions, activeSourceModalKey);
    list.innerHTML = modalSources
      .map((source) => {
        const binding = draftSources[source.sourceKey];
        const file = getFileForBinding(binding);
        const candidateFiles = getMonthlyRunFileCandidatesForSource(
          source.sourceKey,
          files,
          binding?.fileId ?? null,
          binding?.logicalPath ?? binding?.fileKey ?? null,
          monthFolder(el<HTMLInputElement>('monthlyRunMonth').value),
        );
        const options = [
          `<option value="">${escapeHtml(tt('chooseUploadedFile'))}</option>`,
          ...candidateFiles.map((productFile) => {
            const selected = isFileForBinding(productFile, binding) ? ' selected' : '';
            return `<option value="${productFile.id}"${selected}>${escapeHtml(getFileDisplayName(productFile))} · ${escapeHtml(formatDateTime(productFile.createdAt))}</option>`;
          }),
        ].join('');

        return `
          <section class="monthly-run-source-card" data-source-key="${escapeHtml(source.sourceKey)}">
            <div class="monthly-run-source-card__header">
              <div>
                <h4>${escapeHtml(source.label)}</h4>
                <p>${escapeHtml(source.description)}</p>
                ${!source.required ? `<p class="monthly-run-source-card__optional-hint">${escapeHtml(tt('optionalSourceHint'))}</p>` : ''}
              </div>
              <span class="monthly-run-source-card__task">${escapeHtml(source.taskId)}</span>
            </div>
            <div class="monthly-run-source-card__current">
              <span>${escapeHtml(tt('currentFile'))}</span>
              <strong>${file ? escapeHtml(getFileDisplayName(file)) : escapeHtml(source.required ? tt('notConfigured') : tt('optionalNotConfigured'))}</strong>
            </div>
            <div class="monthly-run-source-card__controls">
              <select class="search-input monthly-run-source-card__select" data-source-select="${escapeHtml(source.sourceKey)}">
                ${options}
              </select>
              <button class="btn btn-secondary monthly-run-source-card__upload" type="button" data-source-upload="${escapeHtml(source.sourceKey)}">
                ${escapeHtml(tt('uploadNewFile'))}
              </button>
            </div>
            ${renderSourceSheetControl(source, binding)}
            <div class="monthly-run-source-card__hint">
              <span>${escapeHtml(tt('defaultSheet'))}</span>
              <strong>${escapeHtml(source.defaultSheetName ?? '-')}</strong>
            </div>
          </section>
        `;
      })
      .join('');

    list.querySelectorAll<HTMLSelectElement>('[data-source-select]').forEach((select) => {
      select.addEventListener('change', () => {
        const sourceKey = select.dataset.sourceSelect;
        if (!sourceKey) return;
        const fileId = select.value ? Number(select.value) : null;
        const source = sourceDefinitions.find((item) => item.sourceKey === sourceKey);
        const file = fileId ? getFileById(fileId) : null;
        draftSources[sourceKey] = fileId
          ? {
              fileId,
              logicalPath: file?.logicalPath ?? null,
              fileKey: file?.logicalPath ?? null,
              sheetName: draftSources[sourceKey]?.sheetName ?? source?.defaultSheetName ?? null,
            }
          : null;
        if (fileId) void ensureSourceSheetSummaries(fileId);
        renderSourceModal();
      });
    });

    list.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-source-sheet]').forEach((control) => {
      const updateSheetName = () => {
        const sourceKey = control.dataset.sourceSheet;
        const binding = sourceKey ? draftSources[sourceKey] : null;
        if (!sourceKey || !binding) return;
        draftSources[sourceKey] = { ...binding, sheetName: control.value };
      };
      control.addEventListener('input', updateSheetName);
      control.addEventListener('change', updateSheetName);
    });

    list.querySelectorAll<HTMLButtonElement>('[data-source-upload]').forEach((button) => {
      button.addEventListener('click', () => {
        const sourceKey = button.dataset.sourceUpload;
        if (!sourceKey) return;
        void uploadSourceFileFor(sourceKey);
      });
    });
  }

  async function uploadSourceFileFor(sourceKey: string) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xls,.csv';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      const upload = (overwrite = false) => {
        const form = new FormData();
        form.append('file', file);
        form.append('uploadedBy', `Monthly Run · ${sourceKey}`);
        form.append('folderPrefix', monthFolder(el<HTMLInputElement>('monthlyRunMonth').value));
        if (overwrite) form.append('conflictPolicy', 'overwrite');
        return uploadFormDataWithProgress<{ file: ProductFileRecord }>('/api/files/upload', form, {
          fileName: file.name,
          title: { 'zh-CN': '正在上传月度输入文件', 'en-US': 'Uploading monthly input' },
        });
      };
      let data;
      try {
        data = await upload();
      } catch (error) {
        if (!(error instanceof UploadHttpError) || error.status !== 409) throw error;
        const confirmed = await confirmAction(`本月文件夹中已存在“${file.name}”，是否覆盖？`, {
          title: '文件已存在',
          confirmText: '覆盖',
          tone: 'danger',
        });
        if (!confirmed) return;
        data = await upload(true);
      }
      await refreshFiles();
      await refreshProductFiles();
      const source = sourceDefinitions.find((item) => item.sourceKey === sourceKey);
      const binding = {
        fileId: data.file.id,
        logicalPath: data.file.logicalPath ?? null,
        fileKey: data.file.logicalPath ?? null,
        sheetName: source?.defaultSheetName ?? null,
      };
      draftSources[sourceKey] = binding;
      selectedSources[sourceKey] = binding;
      await saveInstance({
        operator: currentInstance?.operator ?? 'Administrator',
        sources: { [sourceKey]: binding },
      });
      renderSourceInfo();
      renderBusinessDefinedInputConfiguration();
      renderSourceModal();
    });
    input.click();
  }

  async function removeSourceFileFor(sourceKey: string) {
    const source = sourceDefinitions.find((item) => item.sourceKey === sourceKey);
    const label = source?.label ?? sourceKey;
    if (
      !(await confirmAction(`${tt('removeConfigConfirm')} ${label} ${tt('removeConfigSuffix')}`, {
        title: tt('removeConfigTitle'),
        confirmText: tt('delete'),
        tone: 'danger',
      }))
    ) {
      return;
    }

    delete selectedSources[sourceKey];
    draftSources[sourceKey] = null;
    await saveInstance({
      operator: currentInstance?.operator ?? 'Administrator',
      sources: { [sourceKey]: null },
    });
    renderSourceInfo();
    renderBusinessDefinedInputConfiguration();
    if (!el('monthlyRunSourceModal').classList.contains('hidden')) {
      renderSourceModal();
    }
    notify(`${tt('removedConfig')} ${label} ${tt('removedConfigSuffix')}`.trim(), { type: 'success' });
  }

  async function saveSourceModal() {
    const modalSources = getMonthlyRunModalSourceDefinitions(sourceDefinitions, activeSourceModalKey);
    const missing = modalSources.find((source) => source.required && !draftSources[source.sourceKey]?.fileId);
    if (missing) {
      notify(`${tt('chooseFileFor')} ${missing.label}`, { type: 'warning' });
      return;
    }
    const missingSheet = modalSources.find(
      (source) =>
        source.allowSheetNameOverride &&
        draftSources[source.sourceKey]?.fileId &&
        !draftSources[source.sourceKey]?.sheetName?.trim(),
    );
    if (missingSheet) {
      notify(`${tt('sheetNameRequired')}: ${missingSheet.label}`, { type: 'warning' });
      return;
    }
    isSavingSources = true;
    try {
      const scopedSourceKeys = new Set(modalSources.map((source) => source.sourceKey));
      const nextSources: Record<string, MonthlyRunSourceBinding> = { ...selectedSources };
      for (const sourceKey of scopedSourceKeys) {
        const binding = draftSources[sourceKey];
        if (binding?.fileId) nextSources[sourceKey] = binding;
        else delete nextSources[sourceKey];
      }
      selectedSources = nextSources;
      await saveInstance({
        operator: currentInstance?.operator ?? 'Administrator',
        sources: Object.fromEntries(
          modalSources.map((source) => [source.sourceKey, nextSources[source.sourceKey] ?? null]),
        ),
      });
      renderSourceInfo();
      renderBusinessDefinedInputConfiguration();
      isSavingSources = false;
      closeSourceModal();
    } finally {
      isSavingSources = false;
    }
  }

  async function triggerMonthlyRun() {
    const month = el<HTMLInputElement>('monthlyRunMonth').value;
    if (!month) {
      notify(tt('selectMonth'), { type: 'warning' });
      return;
    }
    if (workflowVersionMismatch) {
      notify(formatWorkflowVersionMismatch(workflowVersionMismatch), { type: 'error' });
      return;
    }
    if (
      !sourceDefinitions.every((source) => {
        const binding = selectedSources[source.sourceKey];
        if (source.required && !binding?.fileId) return false;
        if (source.allowSheetNameOverride && binding?.fileId && !binding.sheetName?.trim()) return false;
        return true;
      })
    ) {
      notify(tt('completeSourceConfig'), { type: 'warning' });
      return;
    }
    if (isRunning) return;

    isRunning = true;
    activeHistoryId = null;
    activeRun = null;
    activeRunMonth = month;
    expandedWarningTaskIds.clear();
    renderRunPanel(tt('submittingRun'));
    let failedMessage: string | null = null;

    try {
      const payload: MonthlyRunTriggerRequest = {
        workflowCode: monthlyWorkflowCode,
        expectedWorkflowVersion: MONTHLY_WORKFLOW_VERSION,
        month,
        operator: currentInstance?.operator ?? 'Administrator',
      };
      const response = await api<MonthlyRunTriggerResponse>('/api/monthly-runs', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      activeHistoryId = response.history.id;
      activeRun = response.executionResult.run ?? null;
      renderRunPanel(tt('submittedRun'));
      if (activeRun) {
        await runClient.pollUntilSettled(activeRun.id, {
          minimumPollCount: 1,
          light: true,
          onUpdate: (run) => {
            if (activeRunMonth !== month) return;
            activeRun = run;
            renderRunPanel();
          },
        });
        await finalizeAfterRun(month);
      }
    } catch (error) {
      failedMessage = error instanceof Error ? error.message : 'Monthly run failed';
      renderRunPanel(failedMessage);
    } finally {
      isRunning = false;
      await refreshHistory();
      await onPlanStatusChanged?.();
      renderRunPanel(failedMessage ?? undefined);
    }
  }

  async function approveActiveRun(decision: 'approved' | 'skipped') {
    if (!activeRun || !activeHistoryId || isRunning) return;
    const waitingTaskIds = activeRun.approvals
      .filter((approval) => approval.status === 'pending')
      .map((approval) => approval.taskId);
    if (!waitingTaskIds.length) return;

    const month = el<HTMLInputElement>('monthlyRunMonth').value;
    isRunning = true;
    renderRunPanel(decision === 'skipped' ? 'Skipping downstream flow...' : 'Continuing workflow...');
    const result = await api<{ run?: WorkflowRunRecord }>(`/api/monthly-runs/${activeHistoryId}/approvals`, {
      method: 'POST',
      body: JSON.stringify({ taskIds: waitingTaskIds, decision }),
    });
    activeRun = result.run ?? activeRun;
    expandedWarningTaskIds.clear();
    await runClient.pollUntilSettled(activeRun.id, {
      minimumPollCount: 2,
      light: true,
      onUpdate: (run) => {
        if (activeRunMonth !== month) return;
        activeRun = run;
        renderRunPanel();
      },
    });
    isRunning = false;
    await finalizeAfterRun(month);
    await refreshHistory();
    await onPlanStatusChanged?.();
    renderRunPanel();
  }

  async function refreshActiveRun() {
    if (!activeRun) return;
    activeRun = await runClient.getRun(activeRun.id, { light: true });
    renderRunPanel();
  }

  function getWarningMessageForTask(run: WorkflowRunRecord, taskId: string): string | null {
    const pendingApproval = run.approvals.find(
      (approval) => approval.taskId === taskId && approval.status === 'pending',
    );
    if (pendingApproval?.comment?.trim()) return pendingApproval.comment.trim();

    const warningEvent = [...run.events]
      .reverse()
      .find(
        (event) =>
          event.taskId === taskId && (event.eventType === 'warning_raised' || event.eventType === 'approval_requested'),
      );
    if (warningEvent?.message?.trim()) return warningEvent.message.trim();

    const step = run.steps.find((item) => item.taskId === taskId);
    if (step?.errorMessage?.trim()) return step.errorMessage.trim();
    return null;
  }

  function toggleWarningTask(taskId: string) {
    if (expandedWarningTaskIds.has(taskId)) {
      expandedWarningTaskIds.delete(taskId);
    } else {
      expandedWarningTaskIds.add(taskId);
    }
    renderRunPanel();
  }

  function syncHistorySelection() {
    const body = el('monthlyRunHistoryBody');
    body.querySelectorAll<HTMLElement>('[data-history-row]').forEach((row) => {
      row.classList.toggle('is-selected', Number(row.dataset.historyRow) === activeHistoryId);
    });
  }

  async function openHistoricalRun(history: MonthlyRunHistoryRecord) {
    if (isRunning) return;
    activeHistoryId = history.id;
    activeRunMonth = history.monthKey;
    syncHistorySelection();

    if (!history.workflowRunId) {
      activeRun = null;
      expandedWarningTaskIds.clear();
      renderRunPanel(tt('historyMissingRun'));
      notify(tt('historyMissingRun'), { type: 'warning' });
      return;
    }

    activeRun = null;
    expandedWarningTaskIds.clear();
    renderRunPanel(tt('loadingHistoryRun'), 'loading');

    try {
      const run = await runClient.getRun(history.workflowRunId, { light: true });
      if (activeHistoryId !== history.id) return;
      activeRun = run;
      expandedWarningTaskIds.clear();
      getMonthlyRunWarningTaskIds(run).forEach((taskId) => expandedWarningTaskIds.add(taskId));
      renderRunPanel();
    } catch (error) {
      if (activeHistoryId !== history.id) return;
      activeRun = null;
      renderRunPanel(tt('historyLoadFailed'));
      notify(error instanceof Error ? error.message : tt('historyLoadFailed'), { type: 'error' });
    }
  }

  async function finalizeAfterRun(month: string) {
    if (!activeRun) return;
    if (activeRun.artifacts.some((artifact) => artifact.artifactType === 'file')) {
      await refreshProductFiles();
    }
    if (activeRun.status === 'completed' || activeRun.status === 'completed_with_warnings') {
      await refreshSummary(month);
    }
  }

  function renderRunPanel(overrideMessage?: string, mode: 'normal' | 'loading' = 'normal') {
    const panel = el('monthlyRunPanel');
    const summary = el('monthlyRunSummary');
    const taskList = el('monthlyRunTaskList');
    const progressBar = el('monthlyRunProgressBar');
    const progressText = el('monthlyRunProgressText');
    const actions = el('monthlyRunActions');
    const continueButton = el<HTMLButtonElement>('btnMonthlyRunContinue');
    const skipButton = el<HTMLButtonElement>('btnMonthlyRunSkip');
    const run = activeRun;

    panel.classList.remove('hidden');
    if (!run) {
      if (mode === 'loading') {
        summary.classList.remove('hidden');
        summary.innerHTML = `<span class="monthly-run-status monthly-run-status--running">${escapeHtml(overrideMessage ?? tt('loadingHistoryRun'))}</span>`;
        taskList.innerHTML = `<div class="monthly-run-empty">${escapeHtml(tt('emptyRunState'))}</div>`;
        progressBar.style.width = '0%';
        progressText.textContent = '0 / 0';
        actions.classList.add('hidden');
        return;
      }
      if (isMonthlyRunAttentionMessage(overrideMessage)) {
        summary.classList.remove('hidden');
        summary.innerHTML = `<span class="monthly-run-status monthly-run-status--failed">${escapeHtml(overrideMessage)}</span>`;
      } else {
        summary.classList.add('hidden');
        summary.innerHTML = '';
      }
      taskList.innerHTML = `<div class="monthly-run-empty">${escapeHtml(tt('emptyRunState'))}</div>`;
      progressBar.style.width = '0%';
      progressText.textContent = '0 / 0';
      actions.classList.add('hidden');
      return;
    }

    const completedStates = new Set<WorkflowExecutionTaskState>([
      'completed',
      'warning',
      'failed',
      'blocked',
      'skipped',
    ]);
    const reached = run.steps.filter((step) => completedStates.has(step.status)).length;
    const total = run.steps.length;
    const ratio = total ? Math.min(1, reached / total) : 0;
    const pendingApprovals = run.approvals.filter((approval) => approval.status === 'pending');
    const statusCode = run.status === 'completed_with_warnings' ? 'warning' : run.status;
    const shouldShowSummary =
      isMonthlyRunAttentionMessage(overrideMessage) ||
      Boolean(run.errorMessage) ||
      isMonthlyRunAttentionStatus(run.status);
    if (shouldShowSummary) {
      summary.classList.remove('hidden');
      summary.innerHTML = `<span class="monthly-run-status monthly-run-status--${escapeHtml(statusCode)}">${escapeHtml(statusLabel(run.status, lang()))}</span>${
        overrideMessage || run.errorMessage ? `<span>${escapeHtml(overrideMessage ?? run.errorMessage)}</span>` : ''
      }`;
    } else {
      summary.classList.add('hidden');
      summary.innerHTML = '';
    }
    progressBar.style.width = `${ratio * 100}%`;
    progressText.textContent = pendingApprovals.length
      ? `${reached} / ${total} · ${tt('reviewRequired')}`
      : `${reached} / ${total}`;
    taskList.innerHTML = run.steps
      .map((step, index) => {
        const warningMessage = step.status === 'warning' ? getWarningMessageForTask(run, step.taskId) : null;
        const failureMessage =
          step.status === 'failed' || step.status === 'blocked'
            ? step.result?.kind === 'assert'
              ? step.result.assertion.failureMessage
              : (step.errorMessage?.trim() ?? '')
            : '';
        const isWarningExpandable = Boolean(warningMessage);
        const isExpanded = isWarningExpandable && expandedWarningTaskIds.has(step.taskId);
        return `
        <div
          class="monthly-run-task monthly-run-task--${step.status} ${isWarningExpandable ? 'monthly-run-task--expandable' : ''} ${isExpanded ? 'is-expanded' : ''}"
          ${isWarningExpandable ? `data-warning-task-id="${escapeHtml(step.taskId)}"` : ''}
        >
          <span class="monthly-run-task__index">${step.status === 'completed' ? '✓' : step.status === 'running' ? '…' : String(index + 1).padStart(2, '0')}</span>
          <div class="monthly-run-task__main">
            <strong>${escapeHtml(step.taskName)}</strong>
            <span>${escapeHtml(step.description || step.operatorCode)}</span>
            ${
              isWarningExpandable
                ? `<button type="button" class="monthly-run-task__warning-toggle" data-warning-task-id="${escapeHtml(step.taskId)}">
                    ${escapeHtml(isExpanded ? tt('hideWarningDetails') : tt('showWarningDetails'))}
                  </button>`
                : ''
            }
          </div>
          <span class="monthly-run-task__status">${escapeHtml(taskStateLabel(step.status, lang()))}</span>
          ${isExpanded && warningMessage ? `<div class="monthly-run-task__warning-detail">${escapeHtml(warningMessage)}</div>` : ''}
          ${failureMessage ? `<div class="monthly-run-task__failure-detail">${escapeHtml(failureMessage)}</div>` : ''}
        </div>`;
      })
      .join('');

    taskList.querySelectorAll<HTMLElement>('[data-warning-task-id]').forEach((node) => {
      node.addEventListener('click', (event) => {
        event.preventDefault();
        const taskId = node.dataset.warningTaskId;
        if (!taskId) return;
        toggleWarningTask(taskId);
      });
    });

    continueButton.classList.toggle('hidden', pendingApprovals.length === 0);
    skipButton.classList.toggle('hidden', pendingApprovals.length === 0);
    actions.classList.toggle('hidden', pendingApprovals.length === 0);
  }

  async function refreshHistory(month = el<HTMLInputElement>('monthlyRunMonth').value) {
    const query = month ? `?month=${encodeURIComponent(month)}&limit=20` : '?limit=20';
    const data = await api<{ items: MonthlyRunHistoryRecord[] }>(`/api/monthly-runs${query}`);
    renderHistory(data.items);
  }

  function renderHistory(items: MonthlyRunHistoryRecord[]) {
    const body = el('monthlyRunHistoryBody');
    if (!items.length) {
      body.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:28px;color:#64748b;">${escapeHtml(tt('noHistory'))}</td></tr>`;
      return;
    }
    body.innerHTML = items
      .map((item) => {
        const canDelete = !['pending', 'running', 'waiting_approval'].includes(item.status);
        const inputSummary = item.inputFiles.length
          ? `${escapeHtml(item.inputFiles.filter((input) => input.fileId || input.fileName).length.toString())}/${escapeHtml(item.inputFiles.length.toString())} ${escapeHtml(tt('fileCount'))}`
          : '-';
        const inputDetails = item.inputFiles.length
          ? item.inputFiles
              .map(
                (input) => `
                  <div class="monthly-run-history__input-item">
                    <span class="monthly-run-history__input-label">${escapeHtml(input.label)}</span>
                    <span class="monthly-run-history__input-value">${escapeHtml(input.fileName ?? (input.fileId ? `#${input.fileId}` : '-'))}</span>
                  </div>`,
              )
              .join('')
          : `<div class="monthly-run-history__input-empty">${escapeHtml(tt('noInputSnapshot'))}</div>`;
        return `
        <tr class="monthly-run-history__row${item.id === activeHistoryId ? ' is-selected' : ''}" data-history-row="${item.id}">
          <td class="monthly-run-history__run-cell">
            <button class="table-link-button table-link-button--subtle" data-history-toggle="${item.id}" type="button">
              ${item.workflowRunId ? `#${item.workflowRunId}` : `${escapeHtml(tt('runHistory'))} #${item.id}`}
            </button>
          </td>
          <td>
            <button class="table-link-button table-link-button--subtle" data-history-toggle="${item.id}" type="button">${inputSummary}</button>
          </td>
          <td><span class="monthly-run-status monthly-run-status--${escapeHtml(item.status === 'completed_with_warnings' ? 'warning' : item.status)}">${escapeHtml(statusLabel(item.status, lang()))}</span></td>
          <td>${escapeHtml(item.producedFileName ?? (item.producedFileId ? `#${item.producedFileId}` : '-'))}</td>
          <td>${escapeHtml(formatDateTime(item.triggeredAt))}</td>
          <td>${escapeHtml(item.errorMessage ?? '-')}</td>
          <td><button class="btn btn-danger btn-sm" data-history-delete="${item.id}" type="button" ${canDelete ? '' : `disabled title="${escapeHtml(tt('cannotDeleteRunning'))}"`}>${escapeHtml(tt('delete'))}</button></td>
        </tr>
        <tr class="monthly-run-history__detail-row hidden" data-history-detail="${item.id}">
          <td colspan="7">
            <div class="monthly-run-history__detail">
              <div class="monthly-run-history__detail-header">
                <strong>Input</strong>
                <span>${escapeHtml(item.monthKey)}</span>
              </div>
              <div class="monthly-run-history__input-list">${inputDetails}</div>
            </div>
          </td>
        </tr>`;
      })
      .join('');

    body.querySelectorAll<HTMLElement>('[data-history-toggle]').forEach((button) => {
      button.addEventListener('click', () => {
        const historyId = button.dataset.historyToggle;
        if (!historyId) return;
        const history = items.find((item) => item.id === Number(historyId));
        if (!history) return;
        const detailRow = body.querySelector<HTMLElement>(`[data-history-detail="${historyId}"]`);
        detailRow?.classList.toggle('hidden');
        void openHistoricalRun(history);
      });
    });
    body.querySelectorAll<HTMLElement>('[data-history-delete]').forEach((button) => {
      button.addEventListener('click', async () => {
        const historyId = Number(button.dataset.historyDelete);
        if (!historyId) return;
        const history = items.find((item) => item.id === historyId);
        const outputNotice = history?.producedFileName
          ? `\n${tt('outputDeleteNotice')} “${history.producedFileName}” ${tt('outputDeleteNoticeSuffix')}`
          : '';
        if (
          !(await confirmAction(`${tt('deleteHistoryConfirm')}${outputNotice}`, {
            title: tt('deleteHistoryTitle'),
            confirmText: tt('delete'),
            tone: 'danger',
          }))
        )
          return;
        await api(`/api/monthly-runs/${historyId}`, { method: 'DELETE' });
        if (activeHistoryId === historyId) {
          activeHistoryId = null;
          activeRun = null;
          activeRunMonth = null;
          renderRunPanel();
        }
        await Promise.all([refreshHistory(), refreshFiles(), refreshInstance(), refreshProductFiles()]);
        const month = el<HTMLInputElement>('monthlyRunMonth').value;
        if (month) await refreshSummary(month);
        notify(tt('historyDeleted'), { type: 'success' });
      });
    });
  }

  return {
    init,
    onActivate,
    openForMonth,
    applyLanguage() {
      renderSourceInfo();
      renderBusinessDefinedInputConfiguration();
      renderRunPanel();
      void refreshHistory();
    },
  };
}

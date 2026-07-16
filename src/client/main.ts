import type {
  AccountProfile,
  AuthStatus,
  AuthenticatedUser,
  Employee,
  EmployeeLabel,
  EmployeeMapping,
  ExerciseRecord,
  FixedValueRecord,
  FivePercentHoldersResponse,
  Holding,
  LinkDetail,
  LatestMonthlyRunOutput,
  ManagedUser,
  MergedGrant,
  MonthlyRunInstanceRecord,
  PaginatedResult,
  PlanSummaryResponse,
  ProductFileDetail,
  ProductFileRecord,
  SoldShare,
  SummaryCapitalizationSource,
  SummarySnapshot,
  TrackedPlan,
  TransferPlanResponse,
  ShareholderTag,
  WorkflowExecutionResult,
  WorkflowPageConfig,
  WorkflowResultFileBinding,
  WorkflowPageSourceBinding,
  WorkflowRunRecord,
  ShareworksGrant,
} from '../shared/types.js';
import { isWorkflowRunTerminalStatus } from '../shared/workflowRunStatus.js';
import { createFilesPage } from './filesPage.js';
import { createMonthlyRunPage } from './monthlyRunPage.js';
import {
  applyThemeSelection,
  COLOR_OPTIONS,
  getStoredTheme,
  type ThemeColorName,
  type ThemeSelection,
} from './theme.js';
import { confirmAction, notify } from './uiFeedback.js';
import { createWorkflowPage } from './workflowPage.js';
import { createDocsPage } from './docsPage.js';
import { resolveDefaultSummaryMonth } from './summaryPage.js';
import { buildEmployeesApiUrl, type EmployeeSourceFilter } from './employeesPage.js';
import { renderTransferPlanSummaryTable, type TransferPlanTableView } from './transferPlanPage.js';
import { applyStaticTranslations, persistLanguage, readStoredLanguage, type AppLanguage } from './i18n.js';
import { uploadFormDataWithProgress } from './uploadProgress.js';
import '../../css/style.css';
import '@univerjs/design/lib/index.css';
import '@univerjs/ui/lib/index.css';
import '@univerjs/sheets-ui/lib/index.css';

let currentMonth = '';
let currentSummary: SummarySnapshot | null = null;
let authStatus: AuthStatus | null = null;
let updatePlans: MonthlyRunInstanceRecord[] = [];
let employees: Employee[] = [];
let employeeLabels: EmployeeLabel[] = [];
let employeeMappings: EmployeeMapping[] = [];
let planManagements: TrackedPlan[] = [];
let shareholders: ShareholderTag[] = [];
let summarySourceFiles: ProductFileRecord[] = [];
let holdingsPage = 1;
let holdingsTotal = 0;
let holdingsPageSize = 20;
type GrantView = 'futu' | 'shareworks' | 'merge';
let activeGrantView: GrantView = 'futu';
let exercisePage = 1;
let exerciseTotal = 0;
let exercisePageSize = 20;
let soldSharesPage = 1;
let soldSharesTotal = 0;
let soldSharesPageSize = 20;
let transferPlanSourceFileId: number | null = null;
let transferPlanTableView: TransferPlanTableView = 'summaryRows';
let employeesPage = 1;
let employeesTotal = 0;
let employeesPageSize = 20;
let employeesSort: { by: 'name' | 'empNo' | ''; dir: 'asc' | 'desc' } = { by: '', dir: 'asc' };
let employeesSourceFilter: EmployeeSourceFilter = '';

const pageTitles: Record<string, string> = {
  captable: '股权汇总',
  monthly: '月度更新',
  monthlyrun: '月度运行',
  'esop-detail': 'ESOP 明细',
  'grant-record': '授予记录',
  'exercise-record': '行权记录',
  'sold-shares': '卖出记录',
  'transfer-plan': '2025 转仓至 Futu',
  'employee-management': '员工管理',
  'plan-summary': '计划汇总',
  'five-percent-holders': '5% 股东',
  'fixed-value': 'Global Parameter',
  files: '文件中心',
  workflow: '工作流',
  'user-management': '用户管理',
  docs: '使用手册',
  holdings: '持仓明细',
  employees: '员工列表',
  account: '账号设置',
  settings: '系统设置',
};
type PageKey = keyof typeof pageTitles;
const DEFAULT_PAGE: PageKey = 'captable';
const FIXED_CAPITALIZATION_SUMMARY_SHEET = 'Capitalization Summary';
const validPages = new Set<PageKey>(Object.keys(pageTitles) as PageKey[]);
const adminOnlyPages = new Set<PageKey>(['files', 'workflow', 'user-management']);
const SIDEBAR_COLLAPSED_STORAGE_KEY = 'captable.sidebar.collapsed';
const MONTHLY_RUN_INPUT_COLLAPSED_STORAGE_KEY = 'captable.monthlyRun.inputCollapsed';
let sidebarCollapsed = false;
let monthlyRunInputCollapsed = false;
let themeSelection: ThemeSelection = getStoredTheme();
let currentLanguage: AppLanguage = readStoredLanguage();
let appInitialized = false;
let currentAccount: AccountProfile | null = null;
let managedUsers: ManagedUser[] = [];
let editingManagedUserId: number | null = null;

let editingEmployeeId: number | null = null;
let editingEmployeeLabelId: number | null = null;
let editingEmployeeLabelIds: number[] = [];
let mergeSourceEmployeeId: number | null = null;
const DEFAULT_EMPLOYEE_LABEL_COLOR = '#2563eb';

type WorkflowUpdatePageKey =
  | 'grant-record'
  | 'exercise-record'
  | 'sold-shares'
  | 'transfer-plan'
  | 'employee-management'
  | 'plan-summary'
  | 'five-percent-holders';

type WorkflowUpdateKind = 'esop' | 'data-management';

const workflowUpdatePageKinds: Record<WorkflowUpdatePageKey, WorkflowUpdateKind> = {
  'grant-record': 'esop',
  'exercise-record': 'esop',
  'sold-shares': 'esop',
  'transfer-plan': 'esop',
  'employee-management': 'data-management',
  'plan-summary': 'data-management',
  'five-percent-holders': 'data-management',
};

const workflowSourceBindingsByPage: Partial<Record<WorkflowUpdatePageKey, WorkflowPageSourceBinding[]>> = {};
const workflowResultFilesByPage: Partial<Record<WorkflowUpdatePageKey, WorkflowResultFileBinding[]>> = {};
let workflowUpdateConfigs: Partial<Record<WorkflowUpdatePageKey, WorkflowPageConfig>> = {};
let activeWorkflowUpdatePage: WorkflowUpdatePageKey | null = null;
let workflowUpdateSelectedFiles: Record<string, number | null> = {};
const fivePercentHolderGlobalParameterKeys = {
  gniCommonStock: 'fivePercentHoldersGniCommonStock',
  gniTotalCses: 'fivePercentHoldersGniTotalCses',
  songjiangMaCommonStock: 'fivePercentHoldersSongjiangMaCommonStock',
  songjiangMaTotalCses: 'fivePercentHoldersSongjiangMaTotalCses',
} as const;
const fivePercentHolderGlobalParameterLabels: Record<string, string> = {
  [fivePercentHolderGlobalParameterKeys.gniCommonStock]: '5% Holders - GNI Group Ltd. Common Stock',
  [fivePercentHolderGlobalParameterKeys.gniTotalCses]: '5% Holders - GNI Group Ltd. Total CSEs',
  [fivePercentHolderGlobalParameterKeys.songjiangMaCommonStock]: '5% Holders - Songjiang Ma Common Stock',
  [fivePercentHolderGlobalParameterKeys.songjiangMaTotalCses]: '5% Holders - Songjiang Ma Total CSEs',
};
let fivePercentHoldersEditMode = false;
let fivePercentHoldersSaving = false;
let fivePercentHolderGlobalParameters: FixedValueRecord[] = [];

const filesPage = createFilesPage({
  el,
  api,
  apiBinary,
  escapeHtml,
  formatDateTime,
  formatFileSize,
  notify,
  confirmAction,
  getLanguage: () => currentLanguage,
});

const workflowPage = createWorkflowPage({
  el,
  api,
  escapeHtml,
  getProductFiles: () => filesPage.getProductFiles(),
  refreshProductFiles: () => filesPage.refreshProductFiles(),
  notify,
  confirmAction,
  getLanguage: () => currentLanguage,
});

const docsPage = createDocsPage({
  el,
  getLanguage: () => currentLanguage,
  isAdmin: () => isAdminUser(),
});

const monthlyRunPage = createMonthlyRunPage({
  el,
  api,
  escapeHtml,
  formatDateTime,
  refreshProductFiles: () => filesPage.refreshProductFiles(),
  refreshSummary: (month) => renderSummaryPage(month),
  notify,
  confirmAction,
  getLanguage: () => currentLanguage,
  onMonthChanged: (month) => {
    if (getPageFromLocation() !== 'monthlyrun') return;
    void openMonthlyRunMonthOnly(month);
  },
  onPlanStatusChanged: () => renderMonthlyPage(''),
});

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
}

function formatFileList(files: string | Array<string | null | undefined> | null | undefined): string {
  const list = (Array.isArray(files) ? files : [files])
    .map((file) => String(file ?? '').trim())
    .filter(Boolean);
  return list.join(' / ');
}

function setPageFileMetric(page: PageKey, selector: string, files: string | Array<string | null | undefined> | null | undefined, label: string) {
  const section = document.getElementById(`page-${page}`);
  const nameNode = section?.querySelector<HTMLElement>(selector);
  if (!nameNode) return;
  const text = formatFileList(files);
  nameNode.textContent = text || '-';
  nameNode.setAttribute('title', text ? `${label}: ${text}` : '');
}

function setPageSourceFiles(page: PageKey, files: string | Array<string | null | undefined> | null | undefined) {
  setPageFileMetric(page, '[data-page-source-file-name]', files, 'SourceFile');
}

function setPageResultFiles(page: PageKey, files: string | Array<string | null | undefined> | null | undefined) {
  setPageFileMetric(page, '[data-page-result-file-name]', files, 'OutputFile');
}

function setPageInputSourceFiles(page: PageKey, files: string | Array<string | null | undefined> | null | undefined) {
  setPageFileMetric(page, '[data-page-source-files-name]', files, 'SourceFiles');
}

function productFileDisplayName(file: ProductFileRecord) {
  return file.displayName || file.originalName;
}

function resetActivePageSourceFile() {
  const activeSection = document.querySelector<HTMLElement>('.page-section.active');
  activeSection
    ?.querySelectorAll<HTMLElement>('[data-page-source-file-name], [data-page-result-file-name], [data-page-source-files-name]')
    .forEach((nameNode) => {
      nameNode.textContent = '-';
      nameNode.removeAttribute('title');
    });
}

function responseResultFiles(response: { resultFiles?: string[]; resultFileName?: string | null }) {
  if (response.resultFiles?.length) return response.resultFiles;
  if (response.resultFileName) return response.resultFileName;
  return [];
}

function setWorkflowPageFiles(
  page: PageKey,
  response: {
    sourceFiles?: string[];
    workflowSourceBindings?: WorkflowPageSourceBinding[];
    workflowResultFiles?: WorkflowResultFileBinding[];
    resultFiles?: string[];
    resultFileName?: string | null;
  },
) {
  setPageResultFiles(page, responseResultFiles(response));
  setPageInputSourceFiles(page, response.sourceFiles ?? []);
  if (isWorkflowUpdatePage(page)) {
    if (response.workflowSourceBindings) workflowSourceBindingsByPage[page] = response.workflowSourceBindings;
    if (response.workflowResultFiles) workflowResultFilesByPage[page] = response.workflowResultFiles;
  }
}

function isWorkflowUpdatePage(page: string): page is WorkflowUpdatePageKey {
  return Object.prototype.hasOwnProperty.call(workflowUpdatePageKinds, page);
}

function workflowUpdateConfigEndpoint(kind: WorkflowUpdateKind) {
  return kind === 'esop' ? '/api/esop-workflows' : '/api/data-management-workflows';
}

function workflowUpdateRunEndpoint(page: WorkflowUpdatePageKey) {
  const kind = workflowUpdatePageKinds[page];
  const apiPageKey = page === 'employee-management' ? 'employee' : page;
  return kind === 'esop'
    ? `/api/esop-workflows/${apiPageKey}/runs`
    : `/api/data-management-workflows/${apiPageKey}/runs`;
}

async function loadWorkflowUpdateConfigs() {
  const [esop, dataManagement] = await Promise.all([
    api<{ items: WorkflowPageConfig[] }>(workflowUpdateConfigEndpoint('esop')),
    api<{ items: WorkflowPageConfig[] }>(workflowUpdateConfigEndpoint('data-management')),
  ]);
  workflowUpdateConfigs = Object.fromEntries(
    [...esop.items, ...dataManagement.items]
      .map((config) => (config.pageKey === 'employee' ? { ...config, pageKey: 'employee-management' } : config))
      .filter((config) => isWorkflowUpdatePage(config.pageKey))
      .map((config) => [config.pageKey, config]),
  ) as Partial<Record<WorkflowUpdatePageKey, WorkflowPageConfig>>;
}

function getWorkflowUpdateConfig(page: WorkflowUpdatePageKey): WorkflowPageConfig {
  const config = workflowUpdateConfigs[page];
  if (!config) throw new Error(`Missing workflow config for ${page}`);
  return config;
}

function workflowUpdateBindingFor(page: WorkflowUpdatePageKey, sourceKey: string): WorkflowPageSourceBinding | null {
  return workflowSourceBindingsByPage[page]?.find((binding) => binding.sourceKey === sourceKey) ?? null;
}

function workflowUpdateFileOptions(selectedFileId: number | null) {
  return [
    `<option value="">No file selected</option>`,
    ...filesPage.getProductFiles().map((file) => {
      const selected = file.id === selectedFileId ? ' selected' : '';
      return `<option value="${file.id}"${selected}>${escapeHtml(productFileDisplayName(file))} (#${file.id})</option>`;
    }),
  ].join('');
}

function renderWorkflowUpdateModalSources() {
  const page = activeWorkflowUpdatePage;
  if (!page) return;
  const config = getWorkflowUpdateConfig(page);
  el('workflowUpdateSourceList').innerHTML = config.sources
    .map((source) => {
      const selectedFileId = workflowUpdateSelectedFiles[source.sourceKey] ?? null;
      const previous = workflowUpdateBindingFor(page, source.sourceKey);
      return `
        <div class="workflow-update-source-card" data-workflow-update-source="${escapeHtml(source.sourceKey)}">
          <div class="workflow-update-source-card__main">
            <div class="workflow-update-source-card__title">${escapeHtml(source.label)}</div>
            <div class="workflow-update-source-card__meta">Source key: ${escapeHtml(source.sourceKey)}</div>
            <div class="workflow-update-source-card__meta">Previous: ${escapeHtml(previous?.fileName ?? 'Not set')}</div>
          </div>
          <div class="workflow-update-source-card__controls">
            <select class="form-input" data-workflow-update-file-select="${escapeHtml(source.sourceKey)}">
              ${workflowUpdateFileOptions(selectedFileId)}
            </select>
            <button class="btn btn-secondary btn-sm" type="button" data-workflow-update-upload="${escapeHtml(source.sourceKey)}">Upload</button>
          </div>
        </div>`;
    })
    .join('');

  el('workflowUpdateSourceList')
    .querySelectorAll<HTMLSelectElement>('[data-workflow-update-file-select]')
    .forEach((select) => {
      select.addEventListener('change', () => {
        const sourceKey = select.dataset.workflowUpdateFileSelect;
        if (!sourceKey) return;
        const fileId = Number(select.value);
        workflowUpdateSelectedFiles[sourceKey] = Number.isInteger(fileId) && fileId > 0 ? fileId : null;
      });
    });

  el('workflowUpdateSourceList')
    .querySelectorAll<HTMLButtonElement>('[data-workflow-update-upload]')
    .forEach((button) => {
      button.addEventListener('click', () => {
        const sourceKey = button.dataset.workflowUpdateUpload;
        if (!sourceKey) return;
        void uploadWorkflowUpdateSourceFile(sourceKey);
      });
    });
}

async function openWorkflowUpdateModal(page: WorkflowUpdatePageKey) {
  await loadWorkflowUpdateConfigs();
  await filesPage.refreshProductFiles();
  const config = getWorkflowUpdateConfig(page);
  activeWorkflowUpdatePage = page;
  workflowUpdateSelectedFiles = Object.fromEntries(
    config.sources.map((source) => [
      source.sourceKey,
      workflowUpdateBindingFor(page, source.sourceKey)?.fileId ?? null,
    ]),
  );
  el('workflowUpdateModalTitle').textContent = `Update ${config.workflowName}`;
  el('workflowUpdateModalSubtitle').textContent = config.description;
  el('workflowUpdateStatus').textContent = '默认使用上一次成功执行的输入文件；上传新文件后会自动替换当前输入项。';
  renderWorkflowUpdateModalSources();
  el('workflowUpdateModal').classList.remove('hidden');
}

function closeWorkflowUpdateModal() {
  el('workflowUpdateModal').classList.add('hidden');
  activeWorkflowUpdatePage = null;
  workflowUpdateSelectedFiles = {};
}

async function uploadWorkflowUpdateSourceFile(sourceKey: string) {
  const page = activeWorkflowUpdatePage;
  if (!page) return;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.xlsx,.xls,.csv';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    form.append('uploadedBy', `Workflow Update · ${page} · ${sourceKey}`);
    try {
      el('workflowUpdateStatus').textContent = 'Uploading file...';
      const data = await uploadFormDataWithProgress<{ file: ProductFileRecord }>('/api/files/upload', form, {
        fileName: file.name,
        title: { 'zh-CN': '正在上传 Workflow 输入文件', 'en-US': 'Uploading workflow input' },
      });
      await filesPage.refreshProductFiles(data.file.id);
      workflowUpdateSelectedFiles[sourceKey] = data.file.id;
      renderWorkflowUpdateModalSources();
      el('workflowUpdateStatus').textContent = `Uploaded ${productFileDisplayName(data.file)}.`;
    } catch (error) {
      notify((error as Error).message, { type: 'error' });
      el('workflowUpdateStatus').textContent = 'Upload failed.';
    }
  });
  input.click();
}

async function pollWorkflowUpdateRunUntilFinished(runId: number): Promise<WorkflowRunRecord> {
  const startedAt = Date.now();
  const timeoutMs = 120_000;
  for (;;) {
    await new Promise((resolve) => window.setTimeout(resolve, 600));
    const run = await api<WorkflowRunRecord>(`/api/workflow-runs/${runId}`);
    if (isWorkflowRunTerminalStatus(run.status)) return run;
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Workflow run #${runId} did not finish within ${Math.round(timeoutMs / 1000)}s`);
    }
  }
}

async function refreshWorkflowUpdatePage(page: WorkflowUpdatePageKey) {
  if (page === 'grant-record') {
    await renderHoldingsPage(currentMonth);
  } else if (page === 'exercise-record') {
    await renderExerciseRecords();
  } else if (page === 'sold-shares') {
    await renderSoldShares();
  } else if (page === 'transfer-plan') {
    await renderTransferPlan();
  } else if (page === 'employee-management') {
    await loadEmployeesPage();
  } else if (page === 'plan-summary') {
    await renderPlanSummaryPage();
  } else if (page === 'five-percent-holders') {
    await renderFivePercentHoldersPage();
  }
}

async function confirmWorkflowUpdate() {
  const page = activeWorkflowUpdatePage;
  if (!page) return;
  const config = getWorkflowUpdateConfig(page);
  const missing = config.sources.find((source) => !workflowUpdateSelectedFiles[source.sourceKey]);
  if (missing) {
    notify(`请选择或上传 ${missing.label}`, { type: 'warning' });
    return;
  }

  const confirmButton = el<HTMLButtonElement>('btnConfirmWorkflowUpdate');
  confirmButton.disabled = true;
  el('workflowUpdateStatus').textContent = 'Starting workflow...';
  try {
    const sources = Object.fromEntries(
      config.sources.map((source) => [source.sourceKey, { fileId: workflowUpdateSelectedFiles[source.sourceKey] }]),
    );
    const result = await api<WorkflowExecutionResult>(workflowUpdateRunEndpoint(page), {
      method: 'POST',
      body: JSON.stringify({ sources }),
    });
    const runId = result.run?.id;
    if (!runId) throw new Error('Workflow run was not created');
    el('workflowUpdateStatus').textContent = `Workflow running (#${runId})...`;
    const run = await pollWorkflowUpdateRunUntilFinished(runId);
    if (run.status !== 'completed' && run.status !== 'completed_with_warnings') {
      throw new Error(run.errorMessage ?? `Workflow ended with status ${run.status}`);
    }
    await filesPage.refreshProductFiles();
    await refreshWorkflowUpdatePage(page);
    notify(run.status === 'completed_with_warnings' ? 'Workflow 完成（包含 Warning）' : 'Workflow 更新完成', {
      type: run.status === 'completed_with_warnings' ? 'warning' : 'success',
    });
    closeWorkflowUpdateModal();
  } catch (error) {
    notify((error as Error).message, { type: 'error' });
    el('workflowUpdateStatus').textContent = `Workflow failed: ${(error as Error).message}`;
  } finally {
    confirmButton.disabled = false;
  }
}

function downloadWorkflowResultFiles(page: WorkflowUpdatePageKey) {
  const files = workflowResultFilesByPage[page] ?? [];
  if (files.length === 0) {
    notify('当前页面没有可导出的文件', { type: 'warning' });
    return;
  }
  files.forEach((file, index) => {
    window.setTimeout(() => {
      const link = document.createElement('a');
      link.href = `/api/files/${file.fileId}/content`;
      link.download = file.fileName || `result-file-${file.fileId}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    }, index * 150);
  });
  notify(files.length === 1 ? '开始导出文件' : `开始导出 ${files.length} 个文件`, {
    type: 'success',
  });
}

function isAdminUser(): boolean {
  return authStatus?.user?.role === 'admin';
}

function canAccessPage(page: PageKey): boolean {
  return !adminOnlyPages.has(page) || isAdminUser();
}

function applyRoleVisibility() {
  document.querySelectorAll<HTMLElement>('.nav-dev-tools').forEach((node) => {
    node.classList.toggle('hidden', !isAdminUser());
  });
  document.querySelectorAll<HTMLElement>('[data-admin-only="true"]').forEach((node) => {
    node.classList.toggle('hidden', !isAdminUser());
  });
  // Re-render the manual so admin-only doc pages appear/disappear with the role.
  docsPage.render();
}

const pageTitleTranslations: Record<PageKey, Record<AppLanguage, string>> = {
  captable: { 'zh-CN': '股权汇总', 'en-US': 'CapTable' },
  monthly: { 'zh-CN': '月度更新', 'en-US': 'Monthly Update' },
  monthlyrun: { 'zh-CN': '月度运行', 'en-US': 'Monthly Run' },
  'esop-detail': { 'zh-CN': 'ESOP 明细', 'en-US': 'ESOP Detail' },
  'grant-record': { 'zh-CN': '授予记录', 'en-US': 'Grant Record' },
  'exercise-record': { 'zh-CN': '行权记录', 'en-US': 'Exercise to Date' },
  'sold-shares': { 'zh-CN': '卖出记录', 'en-US': 'Sold Shares' },
  'transfer-plan': { 'zh-CN': '2025 转仓至 Futu', 'en-US': '2025 Transfer to Futu' },
  'employee-management': { 'zh-CN': '员工管理', 'en-US': 'Employee Management' },
  'plan-summary': { 'zh-CN': '计划汇总', 'en-US': 'Plan Summary' },
  'five-percent-holders': { 'zh-CN': '5% 股东', 'en-US': '5% Holders' },
  'fixed-value': { 'zh-CN': 'Global Parameter', 'en-US': 'Global Parameter' },
  files: { 'zh-CN': '文件中心', 'en-US': 'Files' },
  workflow: { 'zh-CN': '工作流', 'en-US': 'Workflow' },
  'user-management': { 'zh-CN': '用户管理', 'en-US': 'User Management' },
  docs: { 'zh-CN': '使用手册', 'en-US': 'Docs' },
  holdings: { 'zh-CN': '持仓明细', 'en-US': 'Holdings' },
  employees: { 'zh-CN': '员工列表', 'en-US': 'Employees' },
  account: { 'zh-CN': '账号设置', 'en-US': 'Account Settings' },
  settings: { 'zh-CN': '系统设置', 'en-US': 'Settings' },
};

const uiText: Record<string, Record<AppLanguage, string>> = {
  authUsername: { 'zh-CN': '用户名', 'en-US': 'Username' },
  authPassword: { 'zh-CN': '密码', 'en-US': 'Password' },
  authDisplayName: { 'zh-CN': '显示名称', 'en-US': 'Display name' },
  authBootstrapSecret: { 'zh-CN': '初始化密钥', 'en-US': 'Bootstrap secret' },
  login: { 'zh-CN': '登录', 'en-US': 'Log in' },
  createAndLogin: { 'zh-CN': '创建并登录', 'en-US': 'Create and log in' },
  collapseSidebar: { 'zh-CN': '收起导航栏', 'en-US': 'Collapse sidebar' },
  expandSidebar: { 'zh-CN': '展开导航栏', 'en-US': 'Expand sidebar' },
  devTools: { 'zh-CN': '仅管理员', 'en-US': 'Admin Only' },
  account: { 'zh-CN': '账号', 'en-US': 'Account' },
  logout: { 'zh-CN': '退出登录', 'en-US': 'Log out' },
  search: { 'zh-CN': '搜索', 'en-US': 'Search' },
  tag: { 'zh-CN': '标签', 'en-US': 'Tag' },
  incentiveType: { 'zh-CN': '激励类型', 'en-US': 'Incentive Type' },
  allTypes: { 'zh-CN': '全部类型', 'en-US': 'All Types' },
  grantYear: { 'zh-CN': '授予年份', 'en-US': 'Grant Year' },
  employmentStatus: { 'zh-CN': '在职状态', 'en-US': 'Employment Status' },
  month: { 'zh-CN': '月份', 'en-US': 'Month' },
  defaultSnapshot: { 'zh-CN': '默认快照数据', 'en-US': 'Default snapshot data' },
  currentView: { 'zh-CN': '当前视图：', 'en-US': 'Current view: ' },
  noSummaryData: { 'zh-CN': '暂无汇总数据', 'en-US': 'No summary data' },
  export: { 'zh-CN': '导出', 'en-US': 'Export' },
  save: { 'zh-CN': '保存', 'en-US': 'Save' },
  cancel: { 'zh-CN': '取消', 'en-US': 'Cancel' },
  close: { 'zh-CN': '关闭', 'en-US': 'Close' },
  edit: { 'zh-CN': '编辑', 'en-US': 'Edit' },
  delete: { 'zh-CN': '删除', 'en-US': 'Delete' },
  actions: { 'zh-CN': '操作', 'en-US': 'Actions' },
  rows: { 'zh-CN': '行数', 'en-US': 'Rows' },
  first: { 'zh-CN': '« 首页', 'en-US': '« First' },
  previous: { 'zh-CN': '上一页', 'en-US': 'Previous' },
  next: { 'zh-CN': '下一页', 'en-US': 'Next' },
  last: { 'zh-CN': '末页 »', 'en-US': 'Last »' },
  language: { 'zh-CN': '语言', 'en-US': 'Language' },
  languageSubtitle: { 'zh-CN': '切换界面显示语言', 'en-US': 'Switch the interface language' },
  uiLanguage: { 'zh-CN': '界面语言', 'en-US': 'Interface language' },
  colorTheme: { 'zh-CN': '配色', 'en-US': 'Color Theme' },
  colorThemeSubtitle: { 'zh-CN': '控制品牌主色与强调色倾向', 'en-US': 'Control the brand and accent color' },
  colorScheme: { 'zh-CN': '配色方案', 'en-US': 'Color scheme' },
  current: { 'zh-CN': '当前', 'en-US': 'Current' },
  blueDesc: { 'zh-CN': '稳健的默认企业蓝', 'en-US': 'Stable default enterprise blue' },
  tealDesc: { 'zh-CN': '更偏产品和数据工具的青绿色强调', 'en-US': 'Teal accent for product and data tools' },
  amberDesc: { 'zh-CN': '偏暖的金橙色强调，更接近演示型工作台', 'en-US': 'Warm amber accent for demo-oriented workspaces' },
  accountInfo: { 'zh-CN': '账号信息', 'en-US': 'Account Information' },
  accountInfoSubtitle: { 'zh-CN': '管理当前登录账号的基础信息和联系方式', 'en-US': 'Manage the current account profile and contact details' },
  username: { 'zh-CN': '账号名', 'en-US': 'Username' },
  displayName: { 'zh-CN': '显示名', 'en-US': 'Display name' },
  email: { 'zh-CN': '邮箱', 'en-US': 'Email' },
  contact: { 'zh-CN': '联系方式', 'en-US': 'Contact' },
  changePassword: { 'zh-CN': '修改密码', 'en-US': 'Change Password' },
  saveAccount: { 'zh-CN': '保存账号信息', 'en-US': 'Save Account' },
  changePasswordSubtitle: { 'zh-CN': '请输入原密码，并确认两次新密码一致', 'en-US': 'Enter the current password and confirm the new password twice' },
  currentPassword: { 'zh-CN': '当前密码', 'en-US': 'Current password' },
  newPassword: { 'zh-CN': '新密码', 'en-US': 'New password' },
  confirmNewPassword: { 'zh-CN': '确认新密码', 'en-US': 'Confirm new password' },
  updatePassword: { 'zh-CN': '更新密码', 'en-US': 'Update Password' },
  userManagementSubtitle: { 'zh-CN': '管理员创建、编辑、停用系统用户和角色', 'en-US': 'Admins create, edit, deactivate system users and roles' },
  newUser: { 'zh-CN': '新增用户', 'en-US': 'New User' },
  role: { 'zh-CN': '角色', 'en-US': 'Role' },
  status: { 'zh-CN': '状态', 'en-US': 'Status' },
  lastLogin: { 'zh-CN': '最后登录', 'en-US': 'Last Login' },
  createdAt: { 'zh-CN': '创建时间', 'en-US': 'Created At' },
  active: { 'zh-CN': '启用', 'en-US': 'Active' },
  inactive: { 'zh-CN': '停用', 'en-US': 'Inactive' },
  password: { 'zh-CN': '密码', 'en-US': 'Password' },
  optionalPassword: { 'zh-CN': '密码（留空则不修改）', 'en-US': 'Password (leave blank to keep)' },
  createUser: { 'zh-CN': '创建用户', 'en-US': 'Create User' },
  editUser: { 'zh-CN': '编辑用户', 'en-US': 'Edit User' },
  noUsers: { 'zh-CN': '暂无用户', 'en-US': 'No users' },
  sourceFile: { 'zh-CN': 'SourceFile', 'en-US': 'SourceFile' },
  sourceFiles: { 'zh-CN': 'SourceFiles', 'en-US': 'SourceFiles' },
  resultFile: { 'zh-CN': 'Output File', 'en-US': 'Output File' },
  captableHeroEyebrow: { 'zh-CN': '股本汇总', 'en-US': 'Equity Summary' },
  captableHeroText: { 'zh-CN': '展示月度 Capitalization Table Summary View，数据来自当前选择的输出文件。', 'en-US': 'View the monthly Capitalization Table Summary using the selected output file.' },
  grantHeroEyebrow: { 'zh-CN': '授予记录', 'en-US': 'Grant Records' },
  grantHeroText: { 'zh-CN': '展示 Futu、Shareworks 及合并后的授予明细，数据来自对应 workflow 输出文件。', 'en-US': 'View Futu, Shareworks, and merged grant details from workflow output files.' },
  exerciseHeroEyebrow: { 'zh-CN': '行权记录', 'en-US': 'Exercise Records' },
  exerciseHeroText: { 'zh-CN': '展示 Futu 全部行权记录，数据来自 Files 中的独立工作簿。', 'en-US': 'View all Futu exercise records from the workbook stored in Files.' },
  soldHeroEyebrow: { 'zh-CN': '卖出记录', 'en-US': 'Sold Share Records' },
  soldHeroText: { 'zh-CN': '展示 Futu 卖出汇总记录，数据来自 Files 中的独立工作簿。', 'en-US': 'View Futu sold-share summary records from the workbook stored in Files.' },
  transferHeroEyebrow: { 'zh-CN': '2025年计划', 'en-US': '2025 Plan' },
  transferHeroText: { 'zh-CN': '按月汇总归属记录，取消数量可直接编辑；数据来自 Files 中的独立工作簿。', 'en-US': 'Summarize monthly vesting records and edit cancellation quantities directly.' },
  employeeHeroEyebrow: { 'zh-CN': '员工管理', 'en-US': 'Employee Management' },
  employeeHeroText: { 'zh-CN': '员工主数据由员工归集 workflow 从 ESOP 明细输入文件中生成，并支持手工补充。', 'en-US': 'Employee master data is generated from ESOP detail workflows and can be manually supplemented.' },
  planHeroEyebrow: { 'zh-CN': '计划汇总', 'en-US': 'Plan Summary' },
  planHeroText: { 'zh-CN': '按 Plan Name 聚合授予、行权、取消及 outstanding 数量。', 'en-US': 'Aggregate grants, exercises, cancellations, and outstanding quantities by Plan Name.' },
  holdersHeroEyebrow: { 'zh-CN': '持股5%以上股东', 'en-US': '5% Holders' },
  holdersHeroText: { 'zh-CN': '由 Global Parameter 手工维护的 5% holder 数字与 Capitalization Summary 分母计算生成。', 'en-US': 'Generated from manually maintained Global Parameter holder numbers and Capitalization Summary denominators.' },
  fixedHeroEyebrow: { 'zh-CN': '管理可以更改的全局参数', 'en-US': 'Manage Editable Global Parameters' },
  fixedHeroText: { 'zh-CN': 'Data Management 下的全局参数维护页，用于管理月度流程中可由管理员调整的业务常量。', 'en-US': 'Maintain business constants that admins can adjust in the monthly process.' },
  docsHeroEyebrow: { 'zh-CN': '使用手册', 'en-US': 'Docs' },
  docsHeroText: { 'zh-CN': '系统各页面与工作流的使用说明，按主题分多篇文档。', 'en-US': 'Usage guides for system pages and workflows, organized by topic.' },
  esopHeroEyebrow: { 'zh-CN': '股权明细', 'en-US': 'ESOP Detail' },
  esopHeroText: { 'zh-CN': '股权明细的业务总入口，包含授予、行权、卖出和 2025 转富途计划四类台账。', 'en-US': 'The ESOP detail hub for grants, exercises, sold shares, and the 2025 transfer plan.' },
};

const placeholderTranslations: Array<[string, Record<AppLanguage, string>]> = [
  ['searchHolder', { 'zh-CN': '按姓名、计划、授予编号搜索...', 'en-US': 'Search by name, plan, grant...' }],
  ['filterHoldingsTag', { 'zh-CN': '按员工标签筛选', 'en-US': 'Filter by employee tag' }],
  ['searchExercises', { 'zh-CN': '按姓名、员工、授予编号搜索...', 'en-US': 'Search by name, employee, grant...' }],
  ['searchSoldShares', { 'zh-CN': '按姓名、员工、账号搜索...', 'en-US': 'Search by name, employee, account...' }],
  ['searchEmployeesPage', { 'zh-CN': '按姓名、工号、用户 ID 搜索...', 'en-US': 'Search by name, employee no., user id...' }],
  ['filterEmployeesPageTag', { 'zh-CN': '按标签筛选', 'en-US': 'Filter by tag' }],
  ['accountEmail', { 'zh-CN': 'name@example.com', 'en-US': 'name@example.com' }],
  ['accountPhone', { 'zh-CN': '电话或 IM', 'en-US': 'Phone or IM' }],
  ['managedUserUsername', { 'zh-CN': '输入登录账号', 'en-US': 'Enter login username' }],
  ['managedUserDisplayName', { 'zh-CN': '输入显示名', 'en-US': 'Enter display name' }],
  ['managedUserEmail', { 'zh-CN': 'name@example.com', 'en-US': 'name@example.com' }],
  ['managedUserPhone', { 'zh-CN': '电话或 IM', 'en-US': 'Phone or IM' }],
  ['employeesPageNumber', { 'zh-CN': '输入工号（新增后不可改）', 'en-US': 'Enter employee no. (cannot be changed after creation)' }],
  ['employeesPageName', { 'zh-CN': '输入员工姓名', 'en-US': 'Enter employee name' }],
  ['employeesPageUserId', { 'zh-CN': '输入用户 ID', 'en-US': 'Enter user id' }],
  ['employeesMergeTargetNumber', { 'zh-CN': '输入目标员工的工号 / Emp. No.', 'en-US': 'Enter target employee no. / Emp. No.' }],
];

function t(key: keyof typeof uiText): string {
  return uiText[key][currentLanguage] ?? uiText[key]['zh-CN'];
}

function pageTitleFor(page: PageKey): string {
  return pageTitleTranslations[page]?.[currentLanguage] ?? pageTitles[page];
}

function otherLanguage(language: AppLanguage = currentLanguage): AppLanguage {
  return language === 'zh-CN' ? 'en-US' : 'zh-CN';
}

function pageTitleForLanguage(page: PageKey, language: AppLanguage): string {
  return pageTitleTranslations[page]?.[language] ?? pageTitles[page];
}

function setText(selector: string, text: string) {
  const node = document.querySelector<HTMLElement>(selector);
  if (node) node.textContent = text;
}

function setAllText(selector: string, text: string) {
  document.querySelectorAll<HTMLElement>(selector).forEach((node) => {
    node.textContent = text;
  });
}

function setPlaceholder(id: string, text: string) {
  const node = document.getElementById(id) as HTMLInputElement | null;
  if (node) node.placeholder = text;
}

function setButtonLabel(id: string, label: string) {
  const button = document.getElementById(id);
  if (!button) return;
  const svg = button.querySelector('svg');
  button.textContent = '';
  if (svg) button.appendChild(svg);
  button.appendChild(document.createTextNode(svg ? ` ${label}` : label));
}

function setOptionText(selectId: string, value: string, text: string) {
  const select = document.getElementById(selectId) as HTMLSelectElement | null;
  const option = select?.querySelector<HTMLOptionElement>(`option[value="${value}"]`);
  if (option) option.textContent = text;
}

function setSearchLabels(page: PageKey, labels: string[]) {
  document.querySelectorAll<HTMLElement>(`#page-${page} .search-label`).forEach((node, index) => {
    if (labels[index]) node.textContent = labels[index];
  });
}

function getCurrentMonthTextNode(): HTMLElement {
  const existing = document.getElementById('currentMonthText');
  if (existing) return existing;

  const node = document.createElement('strong');
  node.id = 'currentMonthText';
  node.textContent = t('noSummaryData');
  const container = document.querySelector<HTMLElement>('#currentMonthInfo .info-text');
  if (container) {
    container.appendChild(node);
  }
  return node;
}

function syncCurrentViewInfoText() {
  const container = document.querySelector<HTMLElement>('#currentMonthInfo .info-text');
  if (!container) return;

  const currentMonthText = getCurrentMonthTextNode();
  const currentValue = currentMonthText.textContent?.trim();
  container.replaceChildren(document.createTextNode(t('currentView')), currentMonthText);
  if (!currentValue || currentValue === '暂无汇总数据' || currentValue === 'No summary data') {
    currentMonthText.textContent = t('noSummaryData');
  }
}

function setPageHero(page: PageKey, bodyKey: keyof typeof uiText) {
  const section = document.getElementById(`page-${page}`);
  if (!section) return;
  const hero = section.querySelector<HTMLElement>('.product-page-hero');
  if (hero) hero.dataset.noStaticTranslate = 'true';
  const eyebrow = hero?.querySelector<HTMLElement>('.product-page-hero__eyebrow');
  const heading = hero?.querySelector<HTMLElement>('h2');
  const paragraph = hero?.querySelector<HTMLElement>('p');
  if (eyebrow) eyebrow.textContent = pageTitleForLanguage(page, otherLanguage());
  if (heading) heading.textContent = pageTitleForLanguage(page, currentLanguage);
  if (paragraph) paragraph.textContent = t(bodyKey);
}

function syncLanguageButtons() {
  document.querySelectorAll<HTMLButtonElement>('[data-language]').forEach((button) => {
    const active = button.dataset.language === currentLanguage;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-checked', active ? 'true' : 'false');
  });
}

function applyLanguage() {
  document.documentElement.lang = currentLanguage;
  document.body.dataset.language = currentLanguage;
  applyRoleVisibility();

  document.querySelectorAll<HTMLElement>('.nav-item[data-page]').forEach((node) => {
    const page = normalizePage(node.dataset.page ?? '') as PageKey;
    const text = node.querySelector<HTMLElement>('.nav-text');
    if (validPages.has(page) && text) {
      text.textContent = pageTitleFor(page);
      node.setAttribute('title', pageTitleFor(page));
    }
  });
  setText('.nav-section-label', t('devTools'));
  setText('#btnAccountPage', t('account'));
  setText('#btnLogout', t('logout'));

  setPageHero('esop-detail', 'esopHeroText');
  setPageHero('grant-record', 'grantHeroText');
  setPageHero('exercise-record', 'exerciseHeroText');
  setPageHero('sold-shares', 'soldHeroText');
  setPageHero('transfer-plan', 'transferHeroText');
  setPageHero('employee-management', 'employeeHeroText');
  setPageHero('plan-summary', 'planHeroText');
  setPageHero('five-percent-holders', 'holdersHeroText');
  setPageHero('fixed-value', 'fixedHeroText');
  setText('#page-fixed-value h2', pageTitleFor('fixed-value'));
  setPageHero('docs', 'docsHeroText');
  setPageHero('captable', 'captableHeroText');

  setAllText('.product-page-hero__metric > span', t('sourceFile'));
  setAllText('[data-page-file-label="source-files"]', t('sourceFiles'));
  setAllText('[data-page-file-label="result-file"]', t('resultFile'));
  [
    'btnSearchHoldings',
    'btnSearchExercises',
    'btnSearchSoldShares',
    'btnSearchEmployeesPage',
  ].forEach((id) => setButtonLabel(id, t('search')));
  setButtonLabel('btnExport', t('export'));
  setButtonLabel('btnToggleTransferPlanTableView', transferPlanTableView === 'summaryRows'
    ? (currentLanguage === 'zh-CN' ? '转置表格' : 'Transpose table')
    : (currentLanguage === 'zh-CN' ? '恢复横向' : 'Restore horizontal'));
  setButtonLabel('btnAddEmployeesPage', currentLanguage === 'zh-CN' ? '新增员工' : 'New Employee');
  setButtonLabel('btnManageEmployeeLabels', currentLanguage === 'zh-CN' ? '标签管理' : 'Manage Labels');
  setButtonLabel('btnAddEmployeeLabel', currentLanguage === 'zh-CN' ? '新增标签' : 'New Tag');
  setText('#employeeLabelManagementModal .modal-title', currentLanguage === 'zh-CN' ? '标签管理' : 'Label Management');
  setText('#employeeLabelManagementModal .modal-subtitle', currentLanguage === 'zh-CN'
    ? '先创建标签，再分配给员工；名称或颜色变更会自动影响所有员工。'
    : 'Create labels first, then assign them to employees. Name or color changes apply to all employees.');
  setAllText('[data-close="employeeLabelManagementModal"].btn', currentLanguage === 'zh-CN' ? '关闭' : 'Close');
  setAllText('#employeesPageModal [data-close="employeesPageModal"].btn', t('cancel'));
  setText('#btnSubmitEmployeesPage', t('save'));
  setAllText('#employeesMergeModal [data-close="employeesMergeModal"].btn', t('cancel'));
  setText('#btnSubmitEmployeesMerge', currentLanguage === 'zh-CN' ? '关联' : 'Link');
  setSearchLabels('captable', [t('month')]);
  setSearchLabels('grant-record', [t('search'), t('tag'), t('incentiveType')]);
  setSearchLabels('exercise-record', [t('search'), t('grantYear')]);
  setSearchLabels('sold-shares', [t('search'), t('employmentStatus')]);
  setSearchLabels('employee-management', [t('search'), t('tag')]);
  setOptionText('capitalizationSourceFile', '', t('defaultSnapshot'));
  setOptionText('filterGrantType', '', t('allTypes'));
  syncCurrentViewInfoText();

  placeholderTranslations.forEach(([id, copy]) => setPlaceholder(id, copy[currentLanguage]));

  setText('#settingsLanguageTitle', t('language'));
  setText('#settingsLanguageSubtitle', t('languageSubtitle'));
  setText('#settingsLanguageLabel', t('uiLanguage'));
  setText('#page-settings .settings-quick-card:nth-of-type(2) .card-title', t('colorTheme'));
  setText('#page-settings .settings-quick-card:nth-of-type(2) .card-subtitle', t('colorThemeSubtitle'));
  setText('#page-settings .settings-quick-card:nth-of-type(2) .settings-placeholder__label', t('colorScheme'));

  setText('#page-account .card-title', t('accountInfo'));
  setText('#page-account .card-subtitle', t('accountInfoSubtitle'));
  setAllText('#page-account label', '');
  const accountLabels = document.querySelectorAll<HTMLElement>('#page-account .form-group label');
  [t('username'), t('displayName'), t('email'), t('contact')].forEach((copy, index) => {
    if (accountLabels[index]) accountLabels[index].textContent = copy;
  });
  setText('#btnOpenChangePasswordModal', t('changePassword'));
  setText('#btnSaveAccountProfile', t('saveAccount'));
  setText('#accountPasswordModal .modal-title', t('changePassword'));
  setText('#accountPasswordModal .card-subtitle', t('changePasswordSubtitle'));
  const passwordLabels = document.querySelectorAll<HTMLElement>('#accountPasswordModal .form-group label');
  [t('currentPassword'), t('newPassword'), t('confirmNewPassword')].forEach((copy, index) => {
    if (passwordLabels[index]) passwordLabels[index].textContent = copy;
  });
  setText('#btnChangeAccountPassword', t('updatePassword'));
  setAllText('[data-close="accountPasswordModal"].btn', t('cancel'));

  setText('#page-user-management .card-title', pageTitleFor('user-management'));
  setText('#page-user-management .card-subtitle', t('userManagementSubtitle'));
  setText('#btnOpenManagedUserModal', t('newUser'));
  setText('#managedUserModalTitle', editingManagedUserId ? t('editUser') : t('createUser'));
  setText('#btnSubmitManagedUser', editingManagedUserId ? t('save') : t('createUser'));
  setAllText('[data-close="managedUserModal"].btn', t('cancel'));
  setOptionText('managedUserIsActive', 'true', t('active'));
  setOptionText('managedUserIsActive', 'false', t('inactive'));
  const userLabels = document.querySelectorAll<HTMLElement>('#managedUserModal .form-group label');
  [t('username'), t('displayName'), t('role'), t('email'), t('contact'), editingManagedUserId ? t('optionalPassword') : t('password'), t('status')].forEach((copy, index) => {
    if (userLabels[index]) userLabels[index].textContent = copy;
  });

  setText('label.auth-field span', t('authUsername'));
  const authLabels = document.querySelectorAll<HTMLElement>('.auth-field span');
  [t('authUsername'), t('authPassword'), t('authDisplayName'), t('authBootstrapSecret')].forEach((copy, index) => {
    if (authLabels[index]) authLabels[index].textContent = copy;
  });

  setText('#btnCloseLinkModalFooter', t('close'));
  setText('#page-plan-summary .card-title', pageTitleFor('plan-summary'));
  setText('#page-plan-summary .card-subtitle', currentLanguage === 'zh-CN' ? '由股权授予明细聚合生成' : 'Aggregated from equity grant detail');
  setText('#page-five-percent-holders .card-title', pageTitleFor('five-percent-holders'));
  setText('#page-fixed-value .card-title', currentLanguage === 'zh-CN' ? '参数' : 'Global Parameter');
  setAllText('.pagination-size-label', t('rows'));
  setAllText('[id$="FirstPage"]', t('first'));
  setAllText('[id$="PrevPage"]', t('previous'));
  setAllText('[id$="NextPage"]', t('next'));
  setAllText('[id$="LastPage"]', t('last'));
  renderUserManagementTable();

  const activePage = getPageFromLocation();
  el('pageTitle').textContent = activePage === 'monthlyrun'
    ? `${pageTitleFor('monthly')} / ${pageTitleFor('monthlyrun')}`
    : pageTitleFor(activePage);
  el('authSubmit').textContent = authStatus?.bootstrapRequired ? t('createAndLogin') : t('login');
  el('sidebarToggle').setAttribute('aria-label', sidebarCollapsed ? t('expandSidebar') : t('collapseSidebar'));
  syncLanguageButtons();
  renderThemeCards();
  applyStaticTranslations(document, currentLanguage);
}

function localizeAppDom() {
  applyStaticTranslations(document, currentLanguage);
}

function setLanguage(language: AppLanguage) {
  if (currentLanguage === language) return;
  currentLanguage = language;
  persistLanguage(language);
  applyLanguage();
  docsPage.render();
  filesPage.applyLanguage?.();
  workflowPage.applyLanguage?.();
  monthlyRunPage.applyLanguage?.();
}

async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const shouldSendJsonContentType =
    options.body !== undefined && options.body !== null && !(options.body instanceof FormData);
  const response = await fetch(url, {
    credentials: 'same-origin',
    headers: shouldSendJsonContentType ? { 'Content-Type': 'application/json' } : undefined,
    ...options,
  });
  if (response.status === 401) {
    await handleUnauthorized();
    throw new Error('请先登录');
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(body.error ?? response.statusText);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

async function apiBinary(url: string, options: RequestInit = {}): Promise<ArrayBuffer> {
  const response = await fetch(url, { credentials: 'same-origin', ...options });
  if (response.status === 401) {
    await handleUnauthorized();
    throw new Error('请先登录');
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(body.error ?? response.statusText);
  }
  return await response.arrayBuffer();
}

function formatNumber(num: unknown): string {
  if (num === null || num === undefined || Number.isNaN(Number(num))) return '-';
  return Number(num).toLocaleString('en-US');
}

function formatMonthCN(monthKey: string): string {
  const [year, month] = monthKey.split('-');
  if (currentLanguage === 'en-US') {
    const date = new Date(Number(year), Number(month) - 1, 1);
    if (!Number.isNaN(date.getTime())) {
      return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(date);
    }
  }
  return `${year}年${Number(month)}月`;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function getEOMDate(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  return `${year}/${month}/${new Date(year, month, 0).getDate()}`;
}

function escapeHtml(text: unknown): string {
  const div = document.createElement('div');
  div.textContent = String(text ?? '');
  return div.innerHTML;
}

function normalizeEmployeeLabelColor(value: unknown): string {
  const color = String(value ?? '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : DEFAULT_EMPLOYEE_LABEL_COLOR;
}

function employeeLabelStyle(color: unknown): string {
  return ` style="--employee-label-color:${normalizeEmployeeLabelColor(color)}"`;
}

function formatTagChips(labels: Array<{ name: string; color: string }>, fallbackTags: string[] = []): string {
  const visibleLabels = labels.length
    ? labels
    : fallbackTags.map((name) => ({ name, color: DEFAULT_EMPLOYEE_LABEL_COLOR }));
  return visibleLabels.length
    ? `<div class="employee-table-tag-list">${visibleLabels
        .map((label) => `<span class="employee-table-tag"${employeeLabelStyle(label.color)}>${escapeHtml(label.name)}</span>`)
        .join('')}</div>`
    : '-';
}

function statusClass(status: string): string {
  if (status === '已完成') return 'status-completed';
  if (status === '进行中') return 'status-inprogress';
  if (status === '待复核') return 'status-review';
  if (status === '失败') return 'status-failed';
  if (status === '已取消') return 'status-cancelled';
  if (status === 'completed' || status === 'completed_with_warnings') return 'status-completed';
  if (status === 'running') return 'status-inprogress';
  if (status === 'waiting_approval') return 'status-review';
  if (status === 'failed') return 'status-failed';
  if (status === 'skipped') return 'status-cancelled';
  return 'status-pending';
}

function monthlyRunStatusLabel(status: string): string {
  if (currentLanguage === 'en-US') {
    if (status === 'completed') return 'Completed';
    if (status === 'completed_with_warnings') return 'Completed';
    if (status === 'running') return 'In Progress';
    if (status === 'waiting_approval') return 'Pending review';
    if (status === 'failed') return 'Failed';
    if (status === 'skipped') return 'Cancelled';
    if (status === 'draft') return 'Not started';
    return status || 'Not started';
  }
  if (status === 'completed') return '已完成';
  if (status === 'completed_with_warnings') return '已完成';
  if (status === 'running') return '进行中';
  if (status === 'waiting_approval') return '待复核';
  if (status === 'failed') return '失败';
  if (status === 'skipped') return '已取消';
  if (status === 'draft') return '待启动';
  return status || '待启动';
}

function readSidebarCollapsedPreference(): boolean {
  return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === 'true';
}

function applySidebarState() {
  document.body.classList.toggle('sidebar-collapsed', sidebarCollapsed);
  const toggle = el<HTMLButtonElement>('sidebarToggle');
  toggle.setAttribute('aria-expanded', String(!sidebarCollapsed));
  toggle.setAttribute('aria-label', sidebarCollapsed ? '展开导航栏' : '收起导航栏');
}

function setSidebarCollapsed(next: boolean) {
  sidebarCollapsed = next;
  window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(next));
  applySidebarState();
}

function initSidebarToggle() {
  sidebarCollapsed = readSidebarCollapsedPreference();
  applySidebarState();
  el('sidebarToggle').addEventListener('click', () => setSidebarCollapsed(!sidebarCollapsed));
}

function renderThemeCards() {
  el('themeColorOptions').innerHTML = COLOR_OPTIONS.map(
    (option) => {
      const descByColor: Record<ThemeColorName, string> = {
        blue: t('blueDesc'),
        teal: t('tealDesc'),
        amber: t('amberDesc'),
      };
      return `
      <button
        class="theme-card${themeSelection.color === option.name ? ' active' : ''}"
        type="button"
        data-theme-color="${option.name}"
      >
        <span class="theme-card-head">
          <span>
            <strong>${escapeHtml(option.label)}</strong>
            <small>${escapeHtml(descByColor[option.name])}</small>
          </span>
          ${themeSelection.color === option.name ? `<span class="theme-check">${escapeHtml(t('current'))}</span>` : ''}
        </span>
        <span class="theme-swatches" aria-hidden="true">
          ${option.swatches.map((color) => `<span class="theme-swatch" style="background-color:${escapeHtml(color)}"></span>`).join('')}
        </span>
      </button>`;
    },
  ).join('');

  document.querySelectorAll<HTMLElement>('[data-theme-color]').forEach((button) => {
    button.addEventListener('click', () => setThemeColor(button.dataset.themeColor as ThemeColorName));
  });
}

function applyTheme() {
  applyThemeSelection(themeSelection);
  if (document.getElementById('themeColorOptions')) {
    renderThemeCards();
  }
}

function setThemeColor(color: ThemeColorName) {
  if (themeSelection.color === color) return;
  themeSelection = { ...themeSelection, color };
  applyTheme();
}

function setCurrentUser(user: AuthenticatedUser | null) {
  const userName = user?.displayName || user?.username || '访客';
  const avatar = userName.trim().charAt(0).toUpperCase() || 'U';
  el('currentUserAvatar').textContent = avatar;
  applyRoleVisibility();
}

function closeUserMenu() {
  el('userMenu').classList.add('hidden');
  el('currentUserAvatar').setAttribute('aria-expanded', 'false');
}

function toggleUserMenu() {
  const menu = el('userMenu');
  const isOpening = menu.classList.contains('hidden');
  menu.classList.toggle('hidden', !isOpening);
  el('currentUserAvatar').setAttribute('aria-expanded', String(isOpening));
}

async function openAccountPage() {
  closeUserMenu();
  await navigateToPage('account');
}

function showAuthError(message: string) {
  const node = el('authError');
  node.textContent = message;
  node.classList.remove('hidden');
}

function clearAuthError() {
  const node = el('authError');
  node.textContent = '';
  node.classList.add('hidden');
}

function setAuthMode(bootstrapRequired: boolean) {
  el('authSubmit').textContent = bootstrapRequired ? t('createAndLogin') : t('login');
  el('authDisplayNameField').classList.toggle('hidden', !bootstrapRequired);
  el('authBootstrapSecretField').classList.toggle('hidden', !bootstrapRequired);
  el<HTMLInputElement>('authPassword').autocomplete = bootstrapRequired ? 'new-password' : 'current-password';
}

function showAuthShell(status: AuthStatus) {
  authStatus = status;
  document.body.classList.add('auth-required');
  el('authShell').classList.remove('hidden');
  setAuthMode(status.bootstrapRequired);
  setCurrentUser(null);
}

function hideAuthShell() {
  document.body.classList.remove('auth-required');
  el('authShell').classList.add('hidden');
  clearAuthError();
}

async function fetchAuthStatus(): Promise<AuthStatus> {
  const response = await fetch('/api/auth/status', { credentials: 'same-origin' });
  if (!response.ok) {
    throw new Error('无法获取登录状态');
  }
  const status = (await response.json()) as AuthStatus;
  authStatus = status;
  return status;
}

async function handleUnauthorized() {
  const status = await fetchAuthStatus();
  showAuthShell(status);
}

async function submitAuthForm(event: Event) {
  event.preventDefault();
  if (!authStatus) return;
  clearAuthError();

  const payload = {
    username: el<HTMLInputElement>('authUsername').value.trim(),
    password: el<HTMLInputElement>('authPassword').value,
  };
  if (!payload.username || !payload.password) {
    showAuthError('请输入用户名和密码');
    return;
  }

  const url = authStatus.bootstrapRequired ? '/api/auth/bootstrap' : '/api/auth/login';
  const body = authStatus.bootstrapRequired
    ? {
        ...payload,
        displayName: el<HTMLInputElement>('authDisplayName').value.trim(),
        bootstrapSecret: el<HTMLInputElement>('authBootstrapSecret').value.trim(),
      }
    : payload;

  const response = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({ error: response.statusText }));
    showAuthError(errorBody.error ?? '登录失败');
    return;
  }

  const status = (await response.json()) as AuthStatus;
  authStatus = status;
  setCurrentUser(status.user);
  hideAuthShell();
  if (!appInitialized) {
    await initializeApp();
  }
}

async function logout() {
  await fetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'same-origin',
  });
  authStatus = { authenticated: false, bootstrapRequired: false, user: null };
  showAuthShell(authStatus);
}

function normalizePage(page: string | null | undefined): PageKey {
  const value = page?.trim().toLowerCase() ?? '';
  if (value === 'summary') return 'captable';
  if (value === 'holdings') return 'grant-record';
  if (value === 'employees') return 'employee-management';
  if (!validPages.has(value as PageKey)) return DEFAULT_PAGE;
  const pageKey = value as PageKey;
  return canAccessPage(pageKey) ? pageKey : DEFAULT_PAGE;
}

function buildPagePath(page: PageKey): string {
  if (page === 'monthlyrun') return '/monthly/run';
  return page === DEFAULT_PAGE ? `/${DEFAULT_PAGE}` : `/${page}`;
}

function getPageFromLocation(): PageKey {
  const path = window.location.pathname.replace(/^\/+|\/+$/g, '');
  const segments = path.split('/').filter(Boolean);
  if (segments[0] === 'monthly' && segments[1] === 'run') return 'monthlyrun';
  const page = segments[0]?.split('?')[0] ?? '';
  return normalizePage(page);
}

function replacePagePath(page: PageKey) {
  const url = new URL(window.location.href);
  url.pathname = buildPagePath(page);
  url.hash = '';
  window.history.replaceState(null, '', url);
}

function setActivePage(page: string) {
  const targetPage = normalizePage(page);
  const navPage = targetPage === 'monthlyrun' ? 'monthly' : targetPage;
  document.querySelectorAll<HTMLElement>('.nav-item').forEach((node) => {
    const isActive = node.dataset.page === navPage;
    node.classList.toggle('active', isActive);
    if (isActive) {
      node.setAttribute('aria-current', 'page');
    } else {
      node.removeAttribute('aria-current');
    }
  });
  document.querySelectorAll<HTMLElement>('.page-section').forEach((node) => {
    node.classList.toggle('active', node.id === `page-${targetPage}`);
  });
  el('pageTitle').textContent = targetPage === 'monthlyrun'
    ? `${pageTitleFor('monthly')} / ${pageTitleFor('monthlyrun')}`
    : pageTitleFor(targetPage);
  resetActivePageSourceFile();
}

async function activatePage(page: PageKey) {
  try {
    if (page === 'captable') {
      await refreshSummarySourceFileOptions();
      if (currentMonth) await renderSummaryPage(currentMonth);
      return;
    }

    if (page === 'files') {
      await filesPage.refreshProductFiles(getFileIdFromLocation());
      return;
    }

    if (page === 'monthlyrun') {
      await openMonthlyRunFromUrl();
      return;
    }

    if (page === 'workflow') {
      workflowPage.onActivate();
    }

    if (page === 'user-management') {
      await loadUserManagementPage();
    }

    if (page === 'grant-record') {
      await renderHoldingsPage(currentMonth);
    }

    if (page === 'exercise-record') {
      await renderExerciseRecords();
    }

    if (page === 'sold-shares') {
      await renderSoldShares();
    }

    if (page === 'transfer-plan') {
      await renderTransferPlan();
    }

    if (page === 'employee-management') {
      await loadEmployeesPage();
    }

    if (page === 'plan-summary') {
      await renderPlanSummaryPage();
    }

    if (page === 'five-percent-holders') {
      await renderFivePercentHoldersPage();
    }

    if (page === 'fixed-value') {
      await renderFixedValuePage();
    }

    if (page === 'account') {
      await loadAccountPage();
    }

    if (page === 'docs') {
      docsPage.render();
    }
  } finally {
    localizeAppDom();
  }
}

async function syncPageFromLocation() {
  const page = getPageFromLocation();
  setActivePage(page);
  if (window.location.pathname !== buildPagePath(page)) {
    replacePagePath(page);
  }
  await activatePage(page);
}

async function navigateToPage(page: string) {
  const targetPage = normalizePage(page);
  const targetPath = buildPagePath(targetPage);
  if (window.location.pathname === targetPath) {
    setActivePage(targetPage);
    await activatePage(targetPage);
    return;
  }
  window.history.pushState(null, '', targetPath);
  setActivePage(targetPage);
  await activatePage(targetPage);
}

function getFileIdFromLocation(): number | undefined {
  const fileId = Number(new URLSearchParams(window.location.search).get('fileId'));
  return Number.isInteger(fileId) && fileId > 0 ? fileId : undefined;
}

async function navigateToProductFile(fileId: number) {
  const targetPath = buildPagePath('files');
  const url = new URL(window.location.href);
  url.pathname = targetPath;
  url.search = '';
  url.searchParams.set('fileId', String(fileId));
  url.hash = '';
  window.history.pushState(null, '', url);
  setActivePage('files');
  await filesPage.refreshProductFiles(fileId);
}

async function openMonthlyRunPlan(planId: number) {
  const plan = updatePlans.find((item) => item.id === planId);
  if (!plan) return;
  await openMonthlyRunMonthOnly(plan.monthKey);
}

async function openMonthlyRunMonthOnly(month: string) {
  const targetPath = buildPagePath('monthlyrun');
  const url = new URL(window.location.href);
  url.pathname = targetPath;
  url.search = '';
  url.searchParams.set('month', month);
  url.hash = '';
  if (window.location.pathname !== targetPath || window.location.search !== url.search) {
    window.history.pushState(null, '', url);
  }
  el('monthlyRunInputMonth').textContent = formatMonthCN(month);
  el('modalTitle').textContent = 'Input Configuration';
  el('shareworksBody').innerHTML = '<tr><td colspan="4" class="table-empty-cell">正在加载输入定义...</td></tr>';
  el('futuBody').innerHTML = '<tr><td colspan="4" class="table-empty-cell">正在加载输入定义...</td></tr>';
  setActivePage('monthlyrun');
  localizeAppDom();
  await monthlyRunPage.openForMonth(month);
}

async function openMonthlyRunFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const month = params.get('month')?.trim();
  await openMonthlyRunMonthOnly(month || el<HTMLInputElement>('monthlyRunMonth').value || currentMonth);
}

function initNavigation() {
  document.querySelectorAll<HTMLElement>('.nav-item').forEach((item) => {
    item.setAttribute('role', 'link');
    item.tabIndex = 0;
    item.addEventListener('click', () => {
      void navigateToPage(item.dataset.page ?? DEFAULT_PAGE);
    });
    item.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      void navigateToPage(item.dataset.page ?? DEFAULT_PAGE);
    });
  });
  window.addEventListener('popstate', () => {
    void syncPageFromLocation();
  });
  void syncPageFromLocation();
}

function applyInitialRouteBeforeReveal() {
  const page = getPageFromLocation();
  setActivePage(page);
  if (window.location.pathname !== buildPagePath(page)) {
    replacePagePath(page);
  }
  document.body.classList.remove('app-booting');
  document.body.classList.add('app-ready');
}

function initMonthPicker() {
  el<HTMLInputElement>('monthPicker').value = currentMonth;

  el('monthPicker').addEventListener('change', () => {
    const month = el<HTMLInputElement>('monthPicker').value;
    if (!month) {
      notify('请选择月份', { type: 'warning' });
      return;
    }
    currentMonth = month;
    void renderSummaryPage(month);
    void renderHoldingsPage(month);
  });
  el('btnExport').addEventListener('click', () => exportData());
  el('btnOpenMonthlyUpdateFromCapTable').addEventListener('click', () => {
    void navigateToPage('monthly');
  });
}

async function initSummaryPage() {
  const [months, latestOutputResponse] = await Promise.all([
    fetchAvailableMonths(),
    api<{ output: LatestMonthlyRunOutput | null }>('/api/monthly-runs/latest-output'),
  ]);
  currentMonth = resolveDefaultSummaryMonth(months, latestOutputResponse.output);
  el<HTMLInputElement>('monthPicker').value = currentMonth;
  await refreshSummarySourceFileOptions();
  if (months.length === 0) {
    renderEmptySummaryPage('暂无月度业务数据。请先创建 Monthly Update 或导入正式数据。');
  } else {
    await renderSummaryPage(currentMonth);
  }
  el<HTMLSelectElement>('capitalizationSourceFile').addEventListener('change', () => void saveCapitalizationSource());
  el('btnAddNote').addEventListener('click', () => {
    el('addNoteForm').classList.remove('hidden');
    el<HTMLTextAreaElement>('noteContent').focus();
  });
  el('btnCancelNote').addEventListener('click', () => {
    el('addNoteForm').classList.add('hidden');
    el<HTMLTextAreaElement>('noteContent').value = '';
  });
  el('btnSaveNote').addEventListener('click', async () => {
    const input = el<HTMLTextAreaElement>('noteContent');
    const content = input.value.trim();
    if (!content) {
      notify('请输入备注内容', { type: 'warning' });
      return;
    }
    await api(`/api/months/${currentMonth}/notes`, { method: 'POST', body: JSON.stringify({ content }) });
    input.value = '';
    el('addNoteForm').classList.add('hidden');
    await renderSummaryPage(currentMonth);
  });
}

async function fetchAvailableMonths() {
  const data = await api<{ months: Array<{ month: string }> }>('/api/months');
  return data.months.map((item) => item.month);
}

function renderEmptySummaryPage(message: string) {
  currentSummary = null;
  resetActivePageSourceFile();
  getCurrentMonthTextNode().textContent = t('noSummaryData');
  el('eomDate').textContent = '-';
  el('reconciliationBody').innerHTML = `<tr><td colspan="5" class="table-empty-cell">${escapeHtml(message)}</td></tr>`;
  el('capitalizationBody').innerHTML = `<tr><td colspan="4" class="table-empty-cell">${escapeHtml(message)}</td></tr>`;
  applyCapitalizationSourceState(null);
  renderNotes([]);
  localizeAppDom();
}

function formatCapitalizationPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '';
  const numericValue = Number(value);
  return numericValue <= 1 ? `${(numericValue * 100).toFixed(2)}%` : `${numericValue.toFixed(2)}%`;
}

function isTotalFullyDilutedRow(description: string): boolean {
  return description.trim().toLowerCase().startsWith('total fully diluted shares outstand');
}

async function renderSummaryPage(month: string) {
  try {
    currentMonth = month;
    el<HTMLInputElement>('monthPicker').value = month;
    const data = await api<SummarySnapshot>(`/api/months/${month}/summary`);
    currentSummary = data;
    setPageSourceFiles('captable', data.capitalizationSource?.fileName ?? t('defaultSnapshot'));
    getCurrentMonthTextNode().textContent = formatMonthCN(month);
    el('eomDate').textContent = data.eomDate || getEOMDate(month);
    el('reconciliationBody').innerHTML = `
      <tr>
        <td style="text-align:left; font-weight:600;">${escapeHtml(data.reconciliation.item)}</td>
        <td>${escapeHtml(data.eomDate || getEOMDate(month))}</td>
        <td class="highlight-number">${formatNumber(data.reconciliation.lastMonth)}</td>
        <td class="highlight-number">${formatNumber(data.reconciliation.newShares)}</td>
        <td class="highlight-number">${formatNumber(data.reconciliation.eomBalance)}</td>
      </tr>`;

    const capBody = el('capitalizationBody');
    capBody.innerHTML = data.capitalization
      .map((item) => {
        if (item.type === 'cat-header-blue' || item.type === 'cat-header-gray') {
          return `<tr class="cat-header-blue"><td></td><td colspan="3" style="text-align:left;">${escapeHtml(item.description)}</td></tr>`;
        }
        if (item.type === 'cat-sub-label') {
          const sharesHtml = item.shares === undefined ? '' : item.highlightShares ? `<span class="highlight-yellow">${formatNumber(item.shares)}</span>` : formatNumber(item.shares);
          return `<tr class="cat-sub-label">
            <td></td><td style="text-align:left;">${escapeHtml(item.description)}</td>
            <td class="col-number">${sharesHtml}</td><td></td>
          </tr>`;
        }
        const percent = formatCapitalizationPercent(item.percent);
        const isTotalRow = isTotalFullyDilutedRow(item.description);
        return `<tr class="${isTotalRow ? 'total-row-blue' : 'cap-data-row'}">
          <td>${escapeHtml(item.number ?? '')}</td>
          <td style="text-align:left;${isTotalRow ? ' font-weight:var(--font-bold);' : ''}">${escapeHtml(item.description)}</td>
          <td class="col-number"${isTotalRow ? ' style="font-weight:var(--font-bold);"' : ''}>${formatNumber(item.shares)}</td>
          <td class="col-percent"${isTotalRow ? ' style="font-weight:var(--font-bold);"' : ''}>${percent}</td>
        </tr>`;
      })
      .join('');
    applyCapitalizationSourceState(data.capitalizationSource ?? null);
    capBody.querySelectorAll<HTMLElement>('.link-blue').forEach((link) => {
      link.addEventListener('click', () => void openLinkModal(link.dataset.link ?? ''));
    });
    renderNotes(data.notes);
    localizeAppDom();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load summary data';
    if (/Month .* not found/i.test(message)) {
      renderEmptySummaryPage('暂无月度业务数据。请先创建 Monthly Update 或导入正式数据。');
      return;
    }
    currentSummary = null;
    resetActivePageSourceFile();
    getCurrentMonthTextNode().textContent = t('noSummaryData');
    el('eomDate').textContent = '-';
    el('reconciliationBody').innerHTML = `<tr><td colspan="5" class="table-empty-cell">${escapeHtml(message)}</td></tr>`;
    el('capitalizationBody').innerHTML = '';
    applyCapitalizationSourceState(null);
    renderNotes([]);
    localizeAppDom();
  }
}

async function refreshSummarySourceFileOptions() {
  const data = await api<{ files: ProductFileRecord[] }>('/api/files');
  summarySourceFiles = data.files;
  const select = el<HTMLSelectElement>('capitalizationSourceFile');
  const currentValue = select.value;
  select.innerHTML = [
    `<option value="">${escapeHtml(t('defaultSnapshot'))}</option>`,
    ...summarySourceFiles.map((file) => `<option value="${file.id}">${escapeHtml(productFileDisplayName(file))}</option>`),
  ].join('');
  if (currentValue && summarySourceFiles.some((file) => String(file.id) === currentValue)) {
    select.value = currentValue;
  }
}

function applyCapitalizationSourceState(source: SummaryCapitalizationSource | null) {
  const select = el<HTMLSelectElement>('capitalizationSourceFile');

  select.value = source?.fileId ? String(source.fileId) : '';
}

async function saveCapitalizationSource() {
  const select = el<HTMLSelectElement>('capitalizationSourceFile');
  const targetMonth = currentSummary?.month || el<HTMLInputElement>('monthPicker').value || currentMonth;

  select.disabled = true;

  try {
    await api(`/api/months/${targetMonth}/capitalization-source`, {
      method: 'PUT',
      body: JSON.stringify({
        fileId: select.value ? Number(select.value) : null,
        sheetName: select.value ? FIXED_CAPITALIZATION_SUMMARY_SHEET : null,
      }),
    });
    await renderSummaryPage(targetMonth);
  } catch (error) {
    notify((error as Error).message, { type: 'error' });
    await renderSummaryPage(targetMonth);
  } finally {
    select.disabled = false;
  }
}

function renderNotes(notes: SummarySnapshot['notes']) {
  const container = el('notesContainer');
  if (!notes || notes.length === 0) {
    container.innerHTML = '<div class="note-empty">暂无备注，点击右上角添加备注按钮添加</div>';
    localizeAppDom();
    return;
  }
  container.innerHTML = notes
    .map(
      (note) => `
      <div class="note-item">
        <div class="note-header">
          <span class="note-time">${escapeHtml(note.time)}</span>
          <div class="note-actions"><button class="note-action-btn" data-id="${note.id}" data-action="delete" title="删除">Delete</button></div>
        </div>
        <div class="note-content">${escapeHtml(note.content)}</div>
      </div>`,
    )
    .join('');
  container.querySelectorAll<HTMLElement>('[data-action="delete"]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!(await confirmAction('确定删除此备注吗？', { title: '删除备注', confirmText: '删除', tone: 'danger' }))) return;
      await api(`/api/notes/${button.dataset.id}`, { method: 'DELETE' });
      await renderSummaryPage(currentMonth);
    });
  });
  localizeAppDom();
}

async function initMonthlyPage() {
  await renderMonthlyPage('');
  el('btnAddUpdate').addEventListener('click', () => {
    el<HTMLInputElement>('newPlanMonth').value = currentMonth;
    el<HTMLTextAreaElement>('newPlanRemark').value = '';
    el('addPlanModal').classList.remove('hidden');
  });
  el('btnCloseAddModal').addEventListener('click', () => el('addPlanModal').classList.add('hidden'));
  el('btnCancelAddModal').addEventListener('click', () => el('addPlanModal').classList.add('hidden'));
  el('btnSubmitAdd').addEventListener('click', submitNewPlan);
}

function applyMonthlyRunInputCollapsed() {
  const card = el('monthlyRunInputCard');
  const toggle = el<HTMLButtonElement>('btnToggleMonthlyRunInput');
  card.classList.toggle('is-collapsed', monthlyRunInputCollapsed);
  toggle.setAttribute('aria-expanded', String(!monthlyRunInputCollapsed));
  toggle.setAttribute('title', monthlyRunInputCollapsed ? 'Expand Input Configuration' : 'Collapse Input Configuration');
}

function initMonthlyRunInputCard() {
  const toggle = el<HTMLButtonElement>('btnToggleMonthlyRunInput');
  if (toggle.dataset.bound === 'true') return;
  toggle.dataset.bound = 'true';
  monthlyRunInputCollapsed = localStorage.getItem(MONTHLY_RUN_INPUT_COLLAPSED_STORAGE_KEY) === 'true';
  applyMonthlyRunInputCollapsed();
  toggle.addEventListener('click', () => {
    monthlyRunInputCollapsed = !monthlyRunInputCollapsed;
    localStorage.setItem(MONTHLY_RUN_INPUT_COLLAPSED_STORAGE_KEY, String(monthlyRunInputCollapsed));
    applyMonthlyRunInputCollapsed();
  });
}

async function submitNewPlan() {
  const month = el<HTMLInputElement>('newPlanMonth').value;
  if (!month) {
    notify('请填写月份', { type: 'warning' });
    return;
  }
  await api<{ instance: MonthlyRunInstanceRecord }>('/api/monthly-runs/instances', { method: 'POST', body: JSON.stringify({ month }) });
  el('addPlanModal').classList.add('hidden');
  await renderMonthlyPage('');
}

async function renderMonthlyPage(filterMonth: string) {
  const data = await api<{ items: MonthlyRunInstanceRecord[] }>(`/api/monthly-runs/instances${filterMonth ? `?month=${encodeURIComponent(filterMonth)}` : ''}`);
  updatePlans = data.items;
  el('planTotalCount').textContent = String(updatePlans.length);
  el('planCompletedCount').textContent = String(updatePlans.filter((plan) => plan.status === 'completed' || plan.status === 'completed_with_warnings').length);
  el('planInProgressCount').textContent = String(updatePlans.filter((plan) => plan.status === 'running').length);
  el('planPendingCount').textContent = String(updatePlans.filter((plan) => plan.status === 'draft' || plan.status === 'waiting_approval').length);

  const tbody = el('monthlyUpdateBody');
  if (updatePlans.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="table-empty-cell">暂无月度更新计划</td></tr>';
    localizeAppDom();
    return;
  }
  tbody.innerHTML = updatePlans
    .map(
      (plan, index) => `
      <tr>
        <td>${index + 1}</td>
        <td><button class="table-link-button" data-action="view" data-id="${plan.id}" type="button">${escapeHtml(plan.monthKey)}</button></td>
        <td>${escapeHtml(formatDateTime(plan.updatedAt))}</td>
        <td>${escapeHtml(plan.operator)}</td>
        <td><span class="status-badge ${statusClass(plan.status)}">${escapeHtml(monthlyRunStatusLabel(plan.status))}</span></td>
        <td><div class="action-buttons">
          <button class="btn btn-primary" data-action="view" data-id="${plan.id}">查看详情</button>
          <button class="btn btn-danger" data-action="delete" data-id="${plan.id}">删除</button>
        </div></td>
      </tr>`,
    )
    .join('');
  tbody.querySelectorAll<HTMLElement>('[data-action="view"]').forEach((button) => button.addEventListener('click', () => void openMonthlyRunPlan(Number(button.dataset.id))));
  tbody.querySelectorAll<HTMLElement>('[data-action="delete"]').forEach((button) => button.addEventListener('click', () => void deleteUpdatePlan(Number(button.dataset.id))));
  localizeAppDom();
}

async function deleteUpdatePlan(id: number) {
  const plan = updatePlans.find((item) => item.id === id);
  if (!plan) return;
  if (!(await confirmAction(`确定删除【${plan.monthKey}】的月度运行实例吗？此操作不可撤销。`, { title: '删除月度运行实例', confirmText: '删除', tone: 'danger' }))) return;
  await api(`/api/monthly-runs/instances/${id}`, { method: 'DELETE' });
  await renderMonthlyPage('');
}

function renderUsedValue(used: boolean): string {
  return used ? '<span class="source-used source-used--true">true</span>' : '<span class="source-used source-used--false">false</span>';
}

async function initHoldingsPage() {
  await renderHoldingsPage(currentMonth);
  el('btnSearchHoldings').addEventListener('click', searchHoldingsPage);
  el('btnHoldingsFirstPage').addEventListener('click', () => goToHoldingsPage('first'));
  el('btnHoldingsPrevPage').addEventListener('click', () => changeHoldingsPage(-1));
  el('btnHoldingsNextPage').addEventListener('click', () => changeHoldingsPage(1));
  el('btnHoldingsLastPage').addEventListener('click', () => goToHoldingsPage('last'));
  el<HTMLSelectElement>('holdingsPageSizeSelect').addEventListener('change', (event) =>
    changeHoldingsPageSize(Number((event.target as HTMLSelectElement).value)),
  );
  document.querySelectorAll<HTMLButtonElement>('[data-grant-view]').forEach((button) => {
    button.addEventListener('click', () => {
      const view = button.dataset.grantView as GrantView;
      if (view === activeGrantView) return;
      activeGrantView = view;
      holdingsPage = 1;
      applyGrantView();
      void renderHoldingsPage(currentMonth);
    });
  });
  applyGrantView();
}

function initWorkflowUpdateModal() {
  document.querySelectorAll<HTMLButtonElement>('[data-workflow-update-page]').forEach((button) => {
    button.addEventListener('click', () => {
      const page = button.dataset.workflowUpdatePage ?? '';
      if (!isWorkflowUpdatePage(page)) return;
      if (page === 'five-percent-holders') {
        void handleFivePercentHoldersUpdateClick();
        return;
      }
      void openWorkflowUpdateModal(page);
    });
  });
  document.querySelectorAll<HTMLButtonElement>('[data-workflow-export-page]').forEach((button) => {
    button.addEventListener('click', () => {
      const page = button.dataset.workflowExportPage ?? '';
      if (!isWorkflowUpdatePage(page)) return;
      downloadWorkflowResultFiles(page);
    });
  });
  el('btnCloseWorkflowUpdateModal').addEventListener('click', closeWorkflowUpdateModal);
  el('btnCancelWorkflowUpdateModal').addEventListener('click', closeWorkflowUpdateModal);
  el('btnConfirmWorkflowUpdate').addEventListener('click', () => void confirmWorkflowUpdate());
  el('workflowUpdateModal').addEventListener('click', (event) => {
    if (event.target === el('workflowUpdateModal')) closeWorkflowUpdateModal();
  });
}

async function initExercisePage() {
  await renderExerciseRecords();
  el('btnSearchExercises').addEventListener('click', searchExercises);
  el('filterExerciseGrantYear').addEventListener('change', searchExercises);
  el('searchExercises').addEventListener('keydown', (event) => {
    if ((event as KeyboardEvent).key === 'Enter') searchExercises();
  });
  el('btnExercisesFirstPage').addEventListener('click', () => goToExercisePage('first'));
  el('btnExercisesPrevPage').addEventListener('click', () => changeExercisePage(-1));
  el('btnExercisesNextPage').addEventListener('click', () => changeExercisePage(1));
  el('btnExercisesLastPage').addEventListener('click', () => goToExercisePage('last'));
  el<HTMLSelectElement>('exercisePageSizeSelect').addEventListener('change', (event) =>
    changeExercisePageSize(Number((event.target as HTMLSelectElement).value)),
  );
}

async function initSoldSharesPage() {
  await renderSoldShares();
  el('btnSearchSoldShares').addEventListener('click', searchSoldShares);
  el('filterSoldSharesEmploymentStatus').addEventListener('change', searchSoldShares);
  el('searchSoldShares').addEventListener('keydown', (event) => {
    if ((event as KeyboardEvent).key === 'Enter') searchSoldShares();
  });
  el('btnSoldSharesFirstPage').addEventListener('click', () => goToSoldSharesPage('first'));
  el('btnSoldSharesPrevPage').addEventListener('click', () => changeSoldSharesPage(-1));
  el('btnSoldSharesNextPage').addEventListener('click', () => changeSoldSharesPage(1));
  el('btnSoldSharesLastPage').addEventListener('click', () => goToSoldSharesPage('last'));
  el<HTMLSelectElement>('soldSharesPageSizeSelect').addEventListener('change', (event) =>
    changeSoldSharesPageSize(Number((event.target as HTMLSelectElement).value)),
  );
}

async function initTransferPlanPage() {
  el('btnToggleTransferPlanTableView').addEventListener('click', () => {
    transferPlanTableView = transferPlanTableView === 'summaryRows' ? 'periodRows' : 'summaryRows';
    void renderTransferPlan();
  });
  el('transferPlanSummaryBody').addEventListener('change', (event) => {
    const input = (event.target as HTMLElement).closest<HTMLInputElement>('[data-transfer-cancelled-id]');
    if (input) void updateTransferPlanCancellation(input);
  });
  await renderTransferPlan();
}

async function initEmployeesPage() {
  el('btnSearchEmployeesPage').addEventListener('click', searchEmployeesPage);
  el<HTMLSelectElement>('filterEmployeesPageTag').addEventListener('change', searchEmployeesPage);
  el<HTMLSelectElement>('filterEmployeesPageSource').addEventListener('change', (event) => {
    employeesSourceFilter = (event.target as HTMLSelectElement).value as EmployeeSourceFilter;
    searchEmployeesPage();
  });
  el('btnAddEmployeesPage').addEventListener('click', () => openEmployeesPageModal());
  el('btnManageEmployeeLabels').addEventListener('click', () => openEmployeeLabelManagementModal());
  el('btnAddEmployeeLabel').addEventListener('click', () => openEmployeeLabelModal());
  el<HTMLInputElement>('employeeLabelColor').addEventListener('input', renderEmployeeLabelColorPreview);
  el('btnOpenEmployeeLabelPicker').addEventListener('click', () => {
    el('employeeLabelPickerMenu').classList.toggle('hidden');
    renderEmployeeAssignmentLabels();
  });
  el('employeesPageSelectedLabels').addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-remove-employee-label-id]');
    if (!button) return;
    editingEmployeeLabelIds = editingEmployeeLabelIds.filter((id) => id !== Number(button.dataset.removeEmployeeLabelId));
    renderEmployeeAssignmentLabels();
  });
  el('employeeLabelPickerMenu').addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-add-employee-label-id]');
    if (!button) return;
    const labelId = Number(button.dataset.addEmployeeLabelId);
    if (!editingEmployeeLabelIds.includes(labelId)) {
      editingEmployeeLabelIds = [...editingEmployeeLabelIds, labelId];
    }
    el('employeeLabelPickerMenu').classList.add('hidden');
    renderEmployeeAssignmentLabels();
  });
  el('btnSubmitEmployeesPage').addEventListener('click', () => void submitEmployeesPage());
  el('btnSubmitEmployeeLabel').addEventListener('click', () => void submitEmployeeLabel());
  el('btnSubmitEmployeesMerge').addEventListener('click', () => void submitEmployeesMerge());
  el('btnEmployeesFirstPage').addEventListener('click', () => goToEmployeesPage('first'));
  el('btnEmployeesPrevPage').addEventListener('click', () => changeEmployeesPage(-1));
  el('btnEmployeesNextPage').addEventListener('click', () => changeEmployeesPage(1));
  el('btnEmployeesLastPage').addEventListener('click', () => goToEmployeesPage('last'));
  el<HTMLSelectElement>('employeesPageSizeSelect').addEventListener('change', (event) =>
    changeEmployeesPageSize(Number((event.target as HTMLSelectElement).value)),
  );
  document.querySelectorAll<HTMLElement>('#employeesPageTable [data-employees-sort]').forEach((header) =>
    header.addEventListener('click', () => toggleEmployeesSort(header.dataset.employeesSort as 'name' | 'empNo')),
  );
  await loadEmployeeLabels();
  await loadEmployeesPage();
}

function managedUserStatusLabel(user: ManagedUser): string {
  return user.isActive ? t('active') : t('inactive');
}

function renderUserManagementTable() {
  const headerLabels: Record<string, string> = {
    username: t('username'),
    displayName: t('displayName'),
    role: t('role'),
    status: t('status'),
    email: t('email'),
    contact: t('contact'),
    lastLogin: t('lastLogin'),
    createdAt: t('createdAt'),
    actions: t('actions'),
  };
  document.querySelectorAll<HTMLElement>('[data-user-management-label]').forEach((node) => {
    const key = node.dataset.userManagementLabel ?? '';
    node.textContent = headerLabels[key] ?? node.textContent ?? '';
  });

  const body = el<HTMLTableSectionElement>('userManagementBody');
  if (!managedUsers.length) {
    body.innerHTML = `<tr><td colspan="9" class="table-empty-cell">${escapeHtml(t('noUsers'))}</td></tr>`;
    return;
  }
  body.innerHTML = managedUsers.map((user) => `
    <tr data-managed-user-id="${user.id}">
      <td>${escapeHtml(user.username)}</td>
      <td>${escapeHtml(user.displayName)}</td>
      <td>${escapeHtml(user.role)}</td>
      <td>${escapeHtml(managedUserStatusLabel(user))}</td>
      <td>${escapeHtml(user.email ?? '-')}</td>
      <td>${escapeHtml(user.phone ?? '-')}</td>
      <td>${escapeHtml(user.lastLoginAt ? formatDateTime(user.lastLoginAt) : '-')}</td>
      <td>${escapeHtml(formatDateTime(user.createdAt))}</td>
      <td>
        <div class="action-buttons">
          <button class="btn btn-secondary btn-sm" type="button" data-edit-managed-user="${user.id}">${escapeHtml(t('edit'))}</button>
          <button class="btn btn-danger btn-sm" type="button" data-delete-managed-user="${user.id}">${escapeHtml(t('delete'))}</button>
        </div>
      </td>
    </tr>
  `).join('');

  body.querySelectorAll<HTMLButtonElement>('[data-edit-managed-user]').forEach((button) => {
    button.addEventListener('click', () => openManagedUserModal(Number(button.dataset.editManagedUser)));
  });
  body.querySelectorAll<HTMLButtonElement>('[data-delete-managed-user]').forEach((button) => {
    button.addEventListener('click', () => void deleteUserManagementUser(Number(button.dataset.deleteManagedUser)));
  });
}

async function loadUserManagementPage() {
  if (!isAdminUser()) {
    await navigateToPage(DEFAULT_PAGE);
    return;
  }
  const data = await api<{ users: ManagedUser[] }>('/api/admin/users');
  managedUsers = data.users;
  renderUserManagementTable();
}

function closeManagedUserModal() {
  el('managedUserModal').classList.add('hidden');
  editingManagedUserId = null;
}

function openManagedUserModal(userId?: number) {
  const user = managedUsers.find((item) => item.id === userId) ?? null;
  editingManagedUserId = user?.id ?? null;
  el<HTMLInputElement>('managedUserUsername').value = user?.username ?? '';
  el<HTMLInputElement>('managedUserDisplayName').value = user?.displayName ?? '';
  el<HTMLSelectElement>('managedUserRole').value = user?.role ?? 'user';
  el<HTMLInputElement>('managedUserEmail').value = user?.email ?? '';
  el<HTMLInputElement>('managedUserPhone').value = user?.phone ?? '';
  el<HTMLInputElement>('managedUserPassword').value = '';
  el<HTMLSelectElement>('managedUserIsActive').value = user?.isActive === false ? 'false' : 'true';
  el('managedUserModalTitle').textContent = editingManagedUserId ? t('editUser') : t('createUser');
  el('managedUserModalSubtitle').textContent = editingManagedUserId
    ? (currentLanguage === 'zh-CN' ? '留空密码则不修改' : 'Leave password blank to keep it unchanged')
    : (currentLanguage === 'zh-CN' ? '默认角色为 user' : 'Default role is user');
  const passwordLabel = document.querySelectorAll<HTMLElement>('#managedUserModal .form-group label')[5];
  if (passwordLabel) passwordLabel.textContent = editingManagedUserId ? t('optionalPassword') : t('password');
  el('btnSubmitManagedUser').textContent = editingManagedUserId ? t('save') : t('createUser');
  el('managedUserModal').classList.remove('hidden');
}

async function submitManagedUser() {
  const password = el<HTMLInputElement>('managedUserPassword').value;
  const payload: Record<string, unknown> = {
    username: el<HTMLInputElement>('managedUserUsername').value.trim(),
    displayName: el<HTMLInputElement>('managedUserDisplayName').value.trim(),
    role: el<HTMLSelectElement>('managedUserRole').value,
    email: el<HTMLInputElement>('managedUserEmail').value.trim() || null,
    phone: el<HTMLInputElement>('managedUserPhone').value.trim() || null,
    isActive: el<HTMLSelectElement>('managedUserIsActive').value === 'true',
  };
  if (!payload.username || !payload.displayName) {
    notify(currentLanguage === 'zh-CN' ? '账号名和显示名不能为空' : 'Username and display name are required', { type: 'warning' });
    return;
  }
  if (!editingManagedUserId) {
    if (!password) {
      notify(currentLanguage === 'zh-CN' ? '新用户必须设置密码' : 'Password is required for a new user', { type: 'warning' });
      return;
    }
    payload.password = password;
  } else if (password) {
    payload.password = password;
  }

  try {
    const response = editingManagedUserId
      ? await api<{ user: ManagedUser }>(`/api/admin/users/${editingManagedUserId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        })
      : await api<{ user: ManagedUser }>('/api/admin/users', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
    const index = managedUsers.findIndex((user) => user.id === response.user.id);
    managedUsers = index >= 0
      ? managedUsers.map((user) => (user.id === response.user.id ? response.user : user))
      : [...managedUsers, response.user];
    closeManagedUserModal();
    renderUserManagementTable();
    notify(currentLanguage === 'zh-CN' ? '用户已保存' : 'User saved', { type: 'success' });
  } catch (error) {
    notify((error as Error).message, { type: 'error' });
  }
}

async function deleteUserManagementUser(userId: number) {
  const user = managedUsers.find((item) => item.id === userId);
  if (!user) return;
  const confirmed = await confirmAction(
    currentLanguage === 'zh-CN' ? `确定删除用户【${user.username}】吗？` : `Delete user ${user.username}?`,
    { title: t('delete'), confirmText: t('delete'), tone: 'danger' },
  );
  if (!confirmed) return;
  try {
    await api(`/api/admin/users/${userId}`, { method: 'DELETE' });
    managedUsers = managedUsers.filter((item) => item.id !== userId);
    renderUserManagementTable();
    notify(currentLanguage === 'zh-CN' ? '用户已删除' : 'User deleted', { type: 'success' });
  } catch (error) {
    notify((error as Error).message, { type: 'error' });
  }
}

async function initUserManagementPage() {
  el('btnOpenManagedUserModal').addEventListener('click', () => openManagedUserModal());
  el('btnSubmitManagedUser').addEventListener('click', () => void submitManagedUser());
  document.querySelectorAll<HTMLElement>('[data-close="managedUserModal"]').forEach((button) => {
    button.addEventListener('click', closeManagedUserModal);
  });
  el('managedUserModal').addEventListener('click', (event) => {
    if (event.target === el('managedUserModal')) closeManagedUserModal();
  });
}

async function initAccountPage() {
  el('btnSaveAccountProfile').addEventListener('click', () => void submitAccountProfile());
  el('btnOpenChangePasswordModal').addEventListener('click', openAccountPasswordModal);
  el('btnChangeAccountPassword').addEventListener('click', () => void submitAccountPassword());
  document.querySelectorAll<HTMLElement>('[data-close="accountPasswordModal"]').forEach((button) => {
    button.addEventListener('click', closeAccountPasswordModal);
  });
  el('accountPasswordModal').addEventListener('click', (event) => {
    if (event.target === el('accountPasswordModal')) closeAccountPasswordModal();
  });
}

async function loadAccountPage() {
  const data = await api<{ account: AccountProfile }>('/api/account');
  currentAccount = data.account;
  el<HTMLInputElement>('accountUsername').value = data.account.username;
  el<HTMLInputElement>('accountDisplayName').value = data.account.displayName;
  el<HTMLInputElement>('accountEmail').value = data.account.email ?? '';
  el<HTMLInputElement>('accountPhone').value = data.account.phone ?? '';
}

async function submitAccountProfile() {
  const payload = {
    username: el<HTMLInputElement>('accountUsername').value.trim(),
    displayName: el<HTMLInputElement>('accountDisplayName').value.trim(),
    email: el<HTMLInputElement>('accountEmail').value.trim() || null,
    phone: el<HTMLInputElement>('accountPhone').value.trim() || null,
  };
  if (!payload.username || !payload.displayName) {
    notify('账号名和显示名不能为空', { type: 'warning' });
    return;
  }
  try {
    const data = await api<{ account: AccountProfile }>('/api/account', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    currentAccount = data.account;
    authStatus = authStatus ? { ...authStatus, user: data.account } : authStatus;
    setCurrentUser(data.account);
    notify('账号信息已保存', { type: 'success' });
  } catch (error) {
    notify((error as Error).message, { type: 'error' });
  }
}

async function submitAccountPassword() {
  const currentPassword = el<HTMLInputElement>('accountCurrentPassword').value;
  const newPassword = el<HTMLInputElement>('accountNewPassword').value;
  const confirmNewPassword = el<HTMLInputElement>('accountConfirmNewPassword').value;
  if (!currentPassword || !newPassword || !confirmNewPassword) {
    notify('请填写当前密码、新密码和确认新密码', { type: 'warning' });
    return;
  }
  if (newPassword !== confirmNewPassword) {
    notify('两次输入的新密码不一致', { type: 'warning' });
    return;
  }
  if (newPassword.length < 8) {
    notify('新密码长度至少为 8 位', { type: 'warning' });
    return;
  }
  try {
    await api('/api/account/password', {
      method: 'PATCH',
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    resetAccountPasswordForm();
    closeAccountPasswordModal();
    notify('密码已更新', { type: 'success' });
  } catch (error) {
    notify((error as Error).message, { type: 'error' });
  }
}

function resetAccountPasswordForm() {
  el<HTMLInputElement>('accountCurrentPassword').value = '';
  el<HTMLInputElement>('accountNewPassword').value = '';
  el<HTMLInputElement>('accountConfirmNewPassword').value = '';
}

function openAccountPasswordModal() {
  resetAccountPasswordForm();
  el('accountPasswordModal').classList.remove('hidden');
  el<HTMLInputElement>('accountCurrentPassword').focus();
}

function closeAccountPasswordModal() {
  el('accountPasswordModal').classList.add('hidden');
}


function renderHoldingsPagination(page: number, totalPages: number, total: number) {
  const start = total === 0 ? 0 : (page - 1) * holdingsPageSize + 1;
  const end = Math.min(page * holdingsPageSize, total);
  el('holdingsPaginationSummary').textContent = total === 0 ? '0 records' : `Showing ${start}-${end} of ${total} records`;
  el('holdingsPaginationPage').textContent = `${total === 0 ? 0 : page} / ${Math.max(totalPages, 1)}`;
  el<HTMLButtonElement>('btnHoldingsFirstPage').disabled = page <= 1;
  el<HTMLButtonElement>('btnHoldingsPrevPage').disabled = page <= 1;
  el<HTMLButtonElement>('btnHoldingsNextPage').disabled = total === 0 || page >= totalPages;
  el<HTMLButtonElement>('btnHoldingsLastPage').disabled = total === 0 || page >= totalPages;
}

function renderEmployeesPagination(page: number, totalPages: number, total: number) {
  const start = total === 0 ? 0 : (page - 1) * employeesPageSize + 1;
  const end = Math.min(page * employeesPageSize, total);
  el('employeesPaginationSummary').textContent = total === 0 ? '0 employees' : `Showing ${start}-${end} of ${total} employees`;
  el('employeesPaginationPage').textContent = `${total === 0 ? 0 : page} / ${Math.max(totalPages, 1)}`;
  el<HTMLButtonElement>('btnEmployeesFirstPage').disabled = page <= 1;
  el<HTMLButtonElement>('btnEmployeesPrevPage').disabled = page <= 1;
  el<HTMLButtonElement>('btnEmployeesNextPage').disabled = total === 0 || page >= totalPages;
  el<HTMLButtonElement>('btnEmployeesLastPage').disabled = total === 0 || page >= totalPages;
}

function renderExercisePagination(page: number, totalPages: number, total: number) {
  const start = total === 0 ? 0 : (page - 1) * exercisePageSize + 1;
  const end = Math.min(page * exercisePageSize, total);
  el('exercisePaginationSummary').textContent = total === 0 ? '0 records' : `Showing ${start}-${end} of ${total} records`;
  el('exercisePaginationPage').textContent = `${total === 0 ? 0 : page} / ${Math.max(totalPages, 1)}`;
  el<HTMLButtonElement>('btnExercisesFirstPage').disabled = page <= 1;
  el<HTMLButtonElement>('btnExercisesPrevPage').disabled = page <= 1;
  el<HTMLButtonElement>('btnExercisesNextPage').disabled = total === 0 || page >= totalPages;
  el<HTMLButtonElement>('btnExercisesLastPage').disabled = total === 0 || page >= totalPages;
}

function renderSoldSharesPagination(page: number, totalPages: number, total: number) {
  const start = total === 0 ? 0 : (page - 1) * soldSharesPageSize + 1;
  const end = Math.min(page * soldSharesPageSize, total);
  el('soldSharesPaginationSummary').textContent =
    total === 0 ? '0 records' : `Showing ${start}-${end} of ${total} records`;
  el('soldSharesPaginationPage').textContent = `${total === 0 ? 0 : page} / ${Math.max(totalPages, 1)}`;
  el<HTMLButtonElement>('btnSoldSharesFirstPage').disabled = page <= 1;
  el<HTMLButtonElement>('btnSoldSharesPrevPage').disabled = page <= 1;
  el<HTMLButtonElement>('btnSoldSharesNextPage').disabled = total === 0 || page >= totalPages;
  el<HTMLButtonElement>('btnSoldSharesLastPage').disabled = total === 0 || page >= totalPages;
}

function searchHoldingsPage() {
  holdingsPage = 1;
  void renderHoldingsPage(currentMonth);
}

function searchExercises() {
  exercisePage = 1;
  void renderExerciseRecords();
}

function changeExercisePage(delta: number) {
  const maxPage = Math.max(1, Math.ceil(exerciseTotal / exercisePageSize));
  const nextPage = Math.min(Math.max(1, exercisePage + delta), maxPage);
  if (nextPage === exercisePage) return;
  exercisePage = nextPage;
  void renderExerciseRecords();
}

function goToExercisePage(target: 'first' | 'last') {
  const maxPage = Math.max(1, Math.ceil(exerciseTotal / exercisePageSize));
  const nextPage = target === 'first' ? 1 : maxPage;
  if (nextPage === exercisePage) return;
  exercisePage = nextPage;
  void renderExerciseRecords();
}

function changeExercisePageSize(size: number) {
  if (size === exercisePageSize) return;
  exercisePageSize = size;
  exercisePage = 1;
  void renderExerciseRecords();
}

function searchSoldShares() {
  soldSharesPage = 1;
  void renderSoldShares();
}

function changeSoldSharesPage(delta: number) {
  const maxPage = Math.max(1, Math.ceil(soldSharesTotal / soldSharesPageSize));
  const nextPage = Math.min(Math.max(1, soldSharesPage + delta), maxPage);
  if (nextPage === soldSharesPage) return;
  soldSharesPage = nextPage;
  void renderSoldShares();
}

function goToSoldSharesPage(target: 'first' | 'last') {
  const maxPage = Math.max(1, Math.ceil(soldSharesTotal / soldSharesPageSize));
  const nextPage = target === 'first' ? 1 : maxPage;
  if (nextPage === soldSharesPage) return;
  soldSharesPage = nextPage;
  void renderSoldShares();
}

function changeSoldSharesPageSize(size: number) {
  if (size === soldSharesPageSize) return;
  soldSharesPageSize = size;
  soldSharesPage = 1;
  void renderSoldShares();
}

function applyGrantView() {
  const viewCopy: Record<GrantView, { title: string; subtitle: string }> = {
    futu: { title: 'Futu Grant Record', subtitle: currentLanguage === 'zh-CN' ? 'Futu 授予数据原始格式' : 'Raw Futu grant data' },
    shareworks: { title: 'Shareworks Grant Record', subtitle: currentLanguage === 'zh-CN' ? 'Options OS Detail 原始格式' : 'Raw Options OS Detail data' },
    merge: { title: 'Merged Grant Record', subtitle: currentLanguage === 'zh-CN' ? 'Futu + Shareworks 标准化拼表' : 'Standardized Futu + Shareworks merge' },
  };
  document.querySelectorAll<HTMLButtonElement>('[data-grant-view]').forEach((button) => {
    const active = button.dataset.grantView === activeGrantView;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  (['futu', 'shareworks', 'merge'] as GrantView[]).forEach((view) => {
    el(`grantPanel-${view}`).classList.toggle('hidden', view !== activeGrantView);
  });
  el('grantViewTitle').textContent = viewCopy[activeGrantView].title;
  el('grantViewSubtitle').textContent = viewCopy[activeGrantView].subtitle;
  el<HTMLSelectElement>('filterGrantType').disabled = activeGrantView !== 'futu';
  el<HTMLInputElement>('filterHoldingsTag').disabled = activeGrantView === 'shareworks';
  localizeAppDom();
}

function changeHoldingsPage(delta: number) {
  const currentPage = holdingsPage;
  const maxPage = Math.max(1, Math.ceil(holdingsTotal / holdingsPageSize));
  const nextPage = Math.min(Math.max(1, currentPage + delta), maxPage);
  if (nextPage === currentPage) return;
  holdingsPage = nextPage;
  void renderHoldingsPage(currentMonth);
}

function goToHoldingsPage(target: 'first' | 'last') {
  const maxPage = Math.max(1, Math.ceil(holdingsTotal / holdingsPageSize));
  const nextPage = target === 'first' ? 1 : maxPage;
  if (nextPage === holdingsPage) return;
  holdingsPage = nextPage;
  void renderHoldingsPage(currentMonth);
}

function changeHoldingsPageSize(size: number) {
  if (size === holdingsPageSize) return;
  holdingsPageSize = size;
  holdingsPage = 1;
  void renderHoldingsPage(currentMonth);
}

function searchEmployeesPage() {
  employeesPage = 1;
  void loadEmployeesPage();
}

function changeEmployeesPage(delta: number) {
  const currentPage = employeesPage;
  const maxPage = Math.max(1, Math.ceil(employeesTotal / employeesPageSize));
  const nextPage = Math.min(Math.max(1, currentPage + delta), maxPage);
  if (nextPage === currentPage) return;
  employeesPage = nextPage;
  void loadEmployeesPage();
}

function goToEmployeesPage(target: 'first' | 'last') {
  const maxPage = Math.max(1, Math.ceil(employeesTotal / employeesPageSize));
  const nextPage = target === 'first' ? 1 : maxPage;
  if (nextPage === employeesPage) return;
  employeesPage = nextPage;
  void loadEmployeesPage();
}

function changeEmployeesPageSize(size: number) {
  if (size === employeesPageSize) return;
  employeesPageSize = size;
  employeesPage = 1;
  void loadEmployeesPage();
}

async function renderHoldingsPage(month: string) {
  const query = el<HTMLInputElement>('searchHolder').value.trim();
  const tag = el<HTMLInputElement>('filterHoldingsTag').value.trim();
  const grantType = el<HTMLSelectElement>('filterGrantType').value;
  if (activeGrantView === 'shareworks') {
    const data = await api<PaginatedResult<ShareworksGrant>>(
      `/api/grants/shareworks?query=${encodeURIComponent(query)}&page=${holdingsPage}&pageSize=${holdingsPageSize}`,
    );
    setWorkflowPageFiles('grant-record', data);
    const items = data.items ?? [];
    holdingsPage = data.page;
    holdingsTotal = data.total;
    renderHoldingsPagination(data.page, data.totalPages, data.total);
    renderShareworksGrants(items, data);
    localizeAppDom();
    return;
  }
  if (activeGrantView === 'merge') {
    const data = await api<PaginatedResult<MergedGrant>>(
      `/api/grants/merge?query=${encodeURIComponent(query)}&tag=${encodeURIComponent(tag)}&page=${holdingsPage}&pageSize=${holdingsPageSize}`,
    );
    setWorkflowPageFiles('grant-record', data);
    const items = data.items ?? [];
    holdingsPage = data.page;
    holdingsTotal = data.total;
    renderHoldingsPagination(data.page, data.totalPages, data.total);
    renderMergedGrants(items, data);
    localizeAppDom();
    return;
  }
  const data = await api<PaginatedResult<Holding>>(
    `/api/holdings?month=${month}&query=${encodeURIComponent(query)}&grantType=${encodeURIComponent(grantType)}&tag=${encodeURIComponent(tag)}&page=${holdingsPage}&pageSize=${holdingsPageSize}`,
  );
  setWorkflowPageFiles('grant-record', data);
  const items = data.holdings ?? [];
  holdingsPage = data.page;
  holdingsTotal = data.total;
  renderHoldingsPagination(data.page, data.totalPages, data.total);
  const tbody = el('holdingsBody');
  if (items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="34" class="table-empty-cell">暂无符合条件的持仓记录</td></tr>';
    localizeAppDom();
    return;
  }
  tbody.innerHTML = items
    .map(
      (item, index) => `
      <tr>
        <td>${(data.page - 1) * data.pageSize + index + 1}</td>
        <td style="text-align:left; font-weight:var(--font-semibold);">${escapeHtml(item.employeeName)}</td>
        <td>${escapeHtml(item.grantNumber)}</td>
        <td>${escapeHtml(item.userId)}</td>
        <td>${escapeHtml(item.employeeNumber)}</td>
        <td><span class="grant-type-badge ${getGrantTypeClass(String(item.incentiveType))}">${escapeHtml(item.incentiveType)}</span></td>
        <td>${escapeHtml(item.grantDate)}</td>
        <td class="col-number">${formatNumber(item.grantQuantity)}</td>
        <td class="col-number">${item.grantPriceUsd === null ? '-' : `$${Number(item.grantPriceUsd).toFixed(2)}`}</td>
        <td>${escapeHtml(item.expireDate)}</td>
        <td style="text-align:left;">${escapeHtml(item.planName)}</td>
        <td>${escapeHtml(item.conditionRule)}</td>
        <td>${escapeHtml(item.employeePortalVisibility)}</td>
        <td class="col-number">${item.closingPriceUsd === null ? '-' : `$${Number(item.closingPriceUsd).toFixed(2)}`}</td>
        <td>${escapeHtml(item.withholdingCost)}</td>
        <td>${escapeHtml(item.taxCalculation)}</td>
        <td>${escapeHtml(item.taxWithholding)}</td>
        <td>${escapeHtml(item.fxSettlement)}</td>
        <td>${escapeHtml(item.taxRule)}</td>
        <td>${escapeHtml(item.cancellationConfirmDate)}</td>
        <td>${escapeHtml(item.dataSource)}</td>
        <td style="text-align:left;">${escapeHtml(item.vestingRuleName)}</td>
        <td>${escapeHtml(item.vestingStartDate)}</td>
        <td class="col-number">${formatNumber(item.vestedQuantity)}</td>
        <td class="col-number">${formatNumber(item.effectiveVestedQuantity)}</td>
        <td class="col-number">${formatNumber(item.unvestedQuantity)}</td>
        <td class="col-number">${formatNumber(item.vestedCancelledQuantity)}</td>
        <td class="col-number">${formatNumber(item.unvestedCancelledQuantity)}</td>
        <td class="col-number">${formatNumber(item.exercisedQuantity)}</td>
        <td class="col-number">${formatNumber(item.pendingExerciseQuantity)}</td>
        <td class="col-number" style="font-weight:var(--font-semibold);">${formatNumber(item.outstandingQuantity)}</td>
        <td class="col-number">${formatNumber(item.sellableQuantity)}</td>
        <td class="grant-long-cell">${escapeHtml(item.relatedSaleOrderNumber)}</td>
        <td>${escapeHtml(item.agreementInfo)}</td>
      </tr>`,
    )
    .join('');
  localizeAppDom();
}

function renderShareworksGrants(items: ShareworksGrant[], data: PaginatedResult<ShareworksGrant>) {
  const tbody = el('shareworksGrantBody');
  if (items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="29" class="table-empty-cell">暂无符合条件的 Shareworks 记录</td></tr>';
    localizeAppDom();
    return;
  }
  tbody.innerHTML = items
    .map(
      (item, index) => `
      <tr>
        <td>${(data.page - 1) * data.pageSize + index + 1}</td>
        <td>${escapeHtml(item.employeeNumber)}</td>
        <td>${escapeHtml(item.lastName)}</td>
        <td>${escapeHtml(item.firstName)}</td>
        <td>${escapeHtml(item.middleName)}</td>
        <td style="text-align:left;">${escapeHtml(item.planName)}</td>
        <td style="text-align:left;">${escapeHtml(item.grantName)}</td>
        <td>${escapeHtml(item.grantType)}</td>
        <td>${escapeHtml(item.employeeGrantNumber)}</td>
        <td>${escapeHtml(item.grantDate)}</td>
        <td>${escapeHtml(item.vestingStartDate)}</td>
        <td>${escapeHtml(item.serviceStartDate)}</td>
        <td>${escapeHtml(item.originalVestingStartDate)}</td>
        <td>${escapeHtml(item.expireDate)}</td>
        <td>${escapeHtml(item.participantExpireDate)}</td>
        <td>${escapeHtml(item.earliestExpireCancelDate)}</td>
        <td>${escapeHtml(item.latestExpireCancelDate)}</td>
        <td class="col-number">${formatNumber(item.sharesGranted)}</td>
        <td class="col-number">${item.exercisePricePerShare === null ? '-' : `$${Number(item.exercisePricePerShare).toFixed(2)}`}</td>
        <td>${escapeHtml(item.vestingSchedule)}</td>
        <td>${escapeHtml(item.earlyExerciseAllowed)}</td>
        <td class="col-number">${formatNumber(item.sharesVested)}</td>
        <td class="col-number">${formatNumber(item.sharesUnvested)}</td>
        <td class="col-number">${formatNumber(item.sharesExercisedReleased)}</td>
        <td class="col-number">${formatNumber(item.sharesSubjectToRepurchase)}</td>
        <td class="col-number">${formatNumber(item.sharesCancelledExpired)}</td>
        <td class="col-number">${formatNumber(item.sharesOutstanding)}</td>
        <td class="col-number">${formatNumber(item.outstandingUnvested)}</td>
        <td class="col-number">${formatNumber(item.outstandingVestedExercisable)}</td>
      </tr>`,
    )
    .join('');
  localizeAppDom();
}

function renderMergedGrants(items: MergedGrant[], data: PaginatedResult<MergedGrant>) {
  const tbody = el('mergedGrantBody');
  if (items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="18" class="table-empty-cell">暂无符合条件的合并记录</td></tr>';
    localizeAppDom();
    return;
  }
  tbody.innerHTML = items
    .map(
      (item, index) => `
      <tr>
        <td>${(data.page - 1) * data.pageSize + index + 1}</td>
        <td style="text-align:left; font-weight:var(--font-semibold);">${escapeHtml(item.employeeName)}</td>
        <td>${escapeHtml(item.grantNumber)}</td>
        <td>${escapeHtml(item.employeeNumber)}</td>
        <td>${escapeHtml(item.incentiveType)}</td>
        <td>${escapeHtml(item.grantDate)}</td>
        <td class="col-number">${formatNumber(item.grantQuantity)}</td>
        <td class="col-number">${item.grantPrice === null ? '-' : `$${Number(item.grantPrice).toFixed(2)}`}</td>
        <td>${escapeHtml(item.expireDate)}</td>
        <td style="text-align:left;">${escapeHtml(item.planName)}</td>
        <td>${escapeHtml(item.vestingRuleName)}</td>
        <td>${escapeHtml(item.vestingStartDate)}</td>
        <td class="col-number">${formatNumber(item.sharesVested)}</td>
        <td class="col-number">${formatNumber(item.sharesUnvested)}</td>
        <td class="col-number">${formatNumber(item.sharesExercisedReleased)}</td>
        <td class="col-number">${formatNumber(item.sharesCancelledExpired)}</td>
        <td class="col-number">${formatNumber(item.sharesOutstanding)}</td>
        <td><span class="grant-source-badge grant-source-badge--${item.source.toLowerCase()}">${escapeHtml(item.source)}</span></td>
      </tr>`,
    )
    .join('');
  localizeAppDom();
}

async function renderExerciseRecords() {
  const query = el<HTMLInputElement>('searchExercises').value.trim();
  const grantYear = el<HTMLSelectElement>('filterExerciseGrantYear').value;
  const data = await api<PaginatedResult<ExerciseRecord>>(
    `/api/exercises?query=${encodeURIComponent(query)}&grantYear=${encodeURIComponent(grantYear)}&page=${exercisePage}&pageSize=${exercisePageSize}`,
  );
  setWorkflowPageFiles('exercise-record', data);
  const items = data.items ?? [];
  exercisePage = data.page;
  exerciseTotal = data.total;
  renderExercisePagination(data.page, data.totalPages, data.total);

  const tbody = el('exerciseBody');
  if (items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="14" class="table-empty-cell">暂无符合条件的行权记录</td></tr>';
    localizeAppDom();
    return;
  }
  tbody.innerHTML = items
    .map(
      (item, index) => `
      <tr>
        <td>${(data.page - 1) * data.pageSize + index + 1}</td>
        <td style="text-align:left; font-weight:var(--font-semibold);">${escapeHtml(item.name)}</td>
        <td>${escapeHtml(item.employeeNumber)}</td>
        <td>${escapeHtml(item.futubullId)}</td>
        <td>${escapeHtml(item.userId)}</td>
        <td>${escapeHtml(item.grantNumber)}</td>
        <td>${escapeHtml(item.grantDate)}</td>
        <td class="col-number">$${item.grantPriceUsd.toFixed(5)}</td>
        <td>${escapeHtml(item.exerciseDate)}</td>
        <td class="col-number">${formatNumber(item.orderedQuantity)}</td>
        <td class="col-number">${formatNumber(item.exercisedQuantity)}</td>
        <td class="col-number">$${item.exerciseCostUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td class="col-number">${formatNumber(item.deductionSellingQuantity)}</td>
        <td class="col-number">${formatNumber(item.dealtQuantity)}</td>
      </tr>`,
    )
    .join('');
  localizeAppDom();
}

function formatCurrency(value: number, currency: 'USD' | 'CNY' = 'USD') {
  const symbol = currency === 'USD' ? '$' : '¥';
  return `${symbol}${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function renderSoldShares() {
  const query = el<HTMLInputElement>('searchSoldShares').value.trim();
  const employmentStatus = el<HTMLSelectElement>('filterSoldSharesEmploymentStatus').value;
  const data = await api<PaginatedResult<SoldShare>>(
    `/api/sold-shares?query=${encodeURIComponent(query)}&employmentStatus=${encodeURIComponent(employmentStatus)}&page=${soldSharesPage}&pageSize=${soldSharesPageSize}`,
  );
  setWorkflowPageFiles('sold-shares', data);
  const items = data.items ?? [];
  soldSharesPage = data.page;
  soldSharesTotal = data.total;
  renderSoldSharesPagination(data.page, data.totalPages, data.total);

  const tbody = el('soldSharesBody');
  if (items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="20" class="table-empty-cell">暂无符合条件的出售记录</td></tr>';
    localizeAppDom();
    return;
  }
  tbody.innerHTML = items
    .map(
      (item, index) => `
      <tr>
        <td>${(data.page - 1) * data.pageSize + index + 1}</td>
        <td style="text-align:left; font-weight:var(--font-semibold);">${escapeHtml(item.name)}</td>
        <td>${escapeHtml(item.employeeNumber)}</td>
        <td>${escapeHtml(item.futubullId)}</td>
        <td>${escapeHtml(item.userId)}</td>
        <td>${escapeHtml(item.employmentStatus)}</td>
        <td>${escapeHtml(item.relatedPartyIdentity)}</td>
        <td>${escapeHtml(item.capitalGainsTaxVisibility)}</td>
        <td class="col-number">${formatNumber(item.soldQuantity)}</td>
        <td class="col-number">${formatNumber(item.dealtQuantity)}</td>
        <td class="col-number">${formatCurrency(item.dealAmountUsd)}</td>
        <td class="col-number">${formatCurrency(item.taxableIncomeUsd)}</td>
        <td class="col-number">${formatCurrency(item.taxPayableUsd)}</td>
        <td class="col-number">${formatCurrency(item.transactionFeesUsd)}</td>
        <td class="col-number">${formatCurrency(item.netDealValueUsd)}</td>
        <td class="col-number">${formatCurrency(item.grantCostUsd)}</td>
        <td class="col-number">${formatCurrency(item.exerciseVestingFeeUsd)}</td>
        <td class="col-number">${formatCurrency(item.withholdingTaxUsd)}</td>
        <td class="col-number">${formatCurrency(item.withholdingTaxCny, 'CNY')}</td>
        <td class="col-number">${formatCurrency(item.cashNetProceedsUsd)}</td>
      </tr>`,
    )
    .join('');
  localizeAppDom();
}

async function renderTransferPlan() {
  const data = await api<TransferPlanResponse>('/api/transfer-plan');
  setWorkflowPageFiles('transfer-plan', data);
  transferPlanSourceFileId = data.sourceFileId;
  el('transferPlanSourceName').textContent = data.sourceFileName;
  el('transferPlanInTotal').textContent = formatNumber(data.totals.inTotal);
  el('transferPlanCancelled').textContent = formatNumber(data.totals.cancelledQuantity);
  el('transferPlanTransferred').textContent = formatNumber(data.totals.transferToFutu);
  el('transferPlanDetailCount').textContent = formatNumber(data.detailCount);

  const table = renderTransferPlanSummaryTable(data, transferPlanTableView, { escapeHtml, formatNumber });
  el('transferPlanSummaryHead').innerHTML = table.headHtml;
  el('transferPlanSummaryBody').innerHTML = table.bodyHtml;
  el('transferPlanSummaryTable').classList.toggle('table-transfer-plan--transposed', transferPlanTableView === 'periodRows');
  const toggleButton = el<HTMLButtonElement>('btnToggleTransferPlanTableView');
  setButtonLabel('btnToggleTransferPlanTableView', transferPlanTableView === 'summaryRows'
    ? (currentLanguage === 'zh-CN' ? '转置表格' : 'Transpose table')
    : (currentLanguage === 'zh-CN' ? '恢复横向' : 'Restore horizontal'));
  toggleButton.setAttribute('aria-pressed', String(transferPlanTableView === 'periodRows'));
  localizeAppDom();
}

async function updateTransferPlanCancellation(input: HTMLInputElement) {
  const id = Number(input.dataset.transferCancelledId);
  const cancelledQuantity = Number(input.value);
  if (!Number.isFinite(id) || !Number.isFinite(cancelledQuantity)) {
    notify('请输入有效的取消数量', { type: 'warning' });
    await renderTransferPlan();
    return;
  }
  input.disabled = true;
  try {
    await api(`/api/transfer-plan/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ cancelledQuantity }),
    });
    await renderTransferPlan();
    notify('取消数量已更新', { type: 'success' });
  } catch (error) {
    input.disabled = false;
    notify((error as Error).message, { type: 'error' });
  }
}

async function importTransferPlanWorkbook() {
  const input = el<HTMLInputElement>('transferPlanFileInput');
  const file = input.files?.[0];
  if (!file) return;
  const form = new FormData();
  form.append('file', file);
  try {
    await uploadFormDataWithProgress('/api/transfer-plan/import', form, {
      fileName: file.name,
      title: { 'zh-CN': '正在导入 Transfer 明细', 'en-US': 'Importing transfer detail' },
      completedText: { 'zh-CN': '导入完成', 'en-US': 'Import completed' },
    });
    await renderTransferPlan();
    await filesPage.refreshProductFiles();
    notify('Transfer detail 已导入', { type: 'success' });
  } catch (error) {
    notify((error as Error).message, { type: 'error' });
  } finally {
    input.value = '';
  }
}

function exportTransferPlanWorkbook() {
  if (transferPlanSourceFileId === null) {
    notify('当前没有可导出的源文件', { type: 'warning' });
    return;
  }
  window.location.href = `/api/files/${transferPlanSourceFileId}/content`;
}

async function loadEmployeeLabels() {
  const data = await api<{ items: EmployeeLabel[] }>('/api/employee-labels');
  employeeLabels = data.items;
  renderEmployeeLabelControls();
}

function renderEmployeeLabelControls() {
  const filter = el<HTMLSelectElement>('filterEmployeesPageTag');
  const selectedFilter = filter.value;
  filter.innerHTML = [
    '<option value="">All Tags</option>',
    ...employeeLabels.map((label) => `<option value="${label.id}">${escapeHtml(label.name)}</option>`),
  ].join('');
  filter.value = employeeLabels.some((label) => String(label.id) === selectedFilter) ? selectedFilter : '';

  renderEmployeeAssignmentLabels();
  renderEmployeeLabelsTable();
}

function renderEmployeeAssignmentLabels() {
  const validLabelIds = new Set(employeeLabels.map((label) => label.id));
  editingEmployeeLabelIds = editingEmployeeLabelIds.filter((id, index, ids) => validLabelIds.has(id) && ids.indexOf(id) === index);
  const selectedLabelIds = new Set(editingEmployeeLabelIds);
  const selectedLabels = editingEmployeeLabelIds
    .map((id) => employeeLabels.find((label) => label.id === id))
    .filter((label): label is EmployeeLabel => Boolean(label));
  el('employeesPageSelectedLabels').innerHTML = selectedLabels.length
    ? selectedLabels
        .map(
          (label) => `
          <span class="employee-label-chip"${employeeLabelStyle(label.color)}>
            <span>${escapeHtml(label.name)}</span>
            <button class="employee-label-chip__remove" type="button" aria-label="Remove label" data-remove-employee-label-id="${label.id}">×</button>
          </span>`,
        )
        .join('')
    : '<span class="employee-label-picker__empty-inline">No labels selected</span>';

  const availableLabels = employeeLabels.filter((label) => !selectedLabelIds.has(label.id));
  el('employeeLabelPickerMenu').innerHTML = availableLabels.length
    ? availableLabels
        .map(
          (label) => `
          <button class="employee-label-picker__option" type="button" data-add-employee-label-id="${label.id}">
            <span class="employee-label-picker__dot"${employeeLabelStyle(label.color)}></span>
            ${escapeHtml(label.name)}
          </button>`,
        )
        .join('')
    : '<div class="employee-label-picker__empty">暂无可添加标签</div>';
}

function renderEmployeeLabelsTable() {
  if (employeeLabels.length === 0) {
    el('employeeLabelsBody').innerHTML = '<tr><td colspan="4" class="table-empty-cell">暂无标签</td></tr>';
    return;
  }
  el('employeeLabelsBody').innerHTML = employeeLabels
    .map(
      (label) => `
      <tr>
        <td style="text-align:left; font-weight:600;"><span class="employee-table-tag"${employeeLabelStyle(label.color)}>${escapeHtml(label.name)}</span></td>
        <td><span class="employee-label-color-swatch"${employeeLabelStyle(label.color)}></span></td>
        <td class="col-number">${formatNumber(label.employeeCount)}</td>
        <td>
          <div class="action-buttons">
            <button class="btn btn-secondary btn-sm" data-action="edit-employee-label" data-id="${label.id}">${currentLanguage === 'zh-CN' ? '编辑' : 'Edit'}</button>
            <button class="btn btn-danger btn-sm" data-action="delete-employee-label" data-id="${label.id}">删除</button>
          </div>
        </td>
      </tr>`,
    )
    .join('');
  el('employeeLabelsBody')
    .querySelectorAll<HTMLElement>('[data-action="edit-employee-label"]')
    .forEach((button) => button.addEventListener('click', () => openEmployeeLabelModal(Number(button.dataset.id))));
  el('employeeLabelsBody')
    .querySelectorAll<HTMLElement>('[data-action="delete-employee-label"]')
    .forEach((button) => button.addEventListener('click', () => void deleteEmployeeLabel(Number(button.dataset.id))));
}

function openEmployeeLabelManagementModal() {
  renderEmployeeLabelsTable();
  el('employeeLabelManagementModal').classList.remove('hidden');
}

function openEmployeeLabelModal(id?: number) {
  editingEmployeeLabelId = id ?? null;
  const label = employeeLabels.find((item) => item.id === id);
  el('employeeLabelModalTitle').textContent = label
    ? (currentLanguage === 'zh-CN' ? '编辑标签' : 'Edit Tag')
    : (currentLanguage === 'zh-CN' ? '新增标签' : 'New Tag');
  el<HTMLInputElement>('employeeLabelName').value = label?.name ?? '';
  el<HTMLInputElement>('employeeLabelColor').value = normalizeEmployeeLabelColor(label?.color);
  renderEmployeeLabelColorPreview();
  el('employeeLabelModal').classList.remove('hidden');
}

function renderEmployeeLabelColorPreview() {
  const color = normalizeEmployeeLabelColor(el<HTMLInputElement>('employeeLabelColor').value);
  const preview = el('employeeLabelColorPreview');
  preview.setAttribute('style', `--employee-label-color:${color}`);
}

async function submitEmployeeLabel() {
  const name = el<HTMLInputElement>('employeeLabelName').value.trim();
  const color = normalizeEmployeeLabelColor(el<HTMLInputElement>('employeeLabelColor').value);
  if (!name) {
    notify('请填写标签名称', { type: 'warning' });
    return;
  }
  try {
    if (editingEmployeeLabelId) {
      await api(`/api/employee-labels/${editingEmployeeLabelId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name, color }),
      });
    } else {
      await api('/api/employee-labels', {
        method: 'POST',
        body: JSON.stringify({ name, color }),
      });
    }
  } catch (error) {
    notify((error as Error).message, { type: 'warning' });
    return;
  }
  el('employeeLabelModal').classList.add('hidden');
  editingEmployeeLabelId = null;
  await loadEmployeeLabels();
  await loadEmployeesPage();
}

async function deleteEmployeeLabel(id: number) {
  const label = employeeLabels.find((item) => item.id === id);
  if (!label) return;
  if (!confirmAction(`删除标签「${label.name}」？该标签会从所有员工上移除。`)) return;
  await api(`/api/employee-labels/${id}`, { method: 'DELETE' });
  await loadEmployeeLabels();
  await loadEmployeesPage();
}

function selectedEmployeeLabelIds() {
  const validLabelIds = new Set(employeeLabels.map((label) => label.id));
  return editingEmployeeLabelIds.filter((id, index, ids) => validLabelIds.has(id) && ids.indexOf(id) === index);
}

async function loadEmployeesPage() {
  const query = el<HTMLInputElement>('searchEmployeesPage').value.trim();
  const tag = el<HTMLSelectElement>('filterEmployeesPageTag').value;
  const data = await api<PaginatedResult<Employee>>(
    buildEmployeesApiUrl({
      query,
      tag,
      source: employeesSourceFilter,
      page: employeesPage,
      pageSize: employeesPageSize,
      sort: employeesSort,
    }),
  );
  setWorkflowPageFiles('employee-management', data);
  employees = data.items ?? [];
  employeesPage = data.page;
  employeesTotal = data.total;
  renderEmployeesSortIndicators();
  renderEmployeesPagination(data.page, data.totalPages, data.total);
  renderEmployeesPageTable();
  localizeAppDom();
}

function renderEmployeesSortIndicators() {
  document.querySelectorAll<HTMLElement>('#employeesPageTable [data-sort-key]').forEach((node) => {
    const key = node.dataset.sortKey;
    node.textContent = employeesSort.by && employeesSort.by === key ? (employeesSort.dir === 'asc' ? '▲' : '▼') : '';
  });
}

function toggleEmployeesSort(by: 'name' | 'empNo') {
  if (employeesSort.by === by) {
    employeesSort.dir = employeesSort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    employeesSort = { by, dir: 'asc' };
  }
  employeesPage = 1;
  void loadEmployeesPage();
}

function renderEmployeesPageTable() {
  if (employees.length === 0) {
    el('employeesPageBody').innerHTML =
      '<tr><td colspan="8" class="table-empty-cell">暂无符合条件的员工</td></tr>';
    localizeAppDom();
    return;
  }
  el('employeesPageBody').innerHTML = employees
    .map((item, index) => {
      const sourceLabels: Record<string, string> = { futu: 'Futu', shareworks: 'Shareworks', manual: '手工' };
      const sourceLabel = sourceLabels[item.source] ?? item.source;
      const sourceClass = item.source === 'manual' ? 'employee-origin-badge--manual' : 'employee-origin-badge--extracted';
      const linkedText = item.linkedIdentities.length
        ? item.linkedIdentities.map((identity) => `${identity.source}:${identity.employeeId} ${identity.name}`.trim()).join('；')
        : '-';
      const toggleLabel = item.active ? '停用' : '启用';
      const rowClass = item.active ? '' : ' class="table-row--muted"';
      return `
      <tr${rowClass}>
        <td>${(employeesPage - 1) * employeesPageSize + index + 1}</td>
        <td style="text-align:left; font-weight:600;">${escapeHtml(item.employeeName)}</td>
        <td>${escapeHtml(item.employeeNumber || '-')}</td>
        <td><span class="employee-origin-badge ${sourceClass}">${escapeHtml(sourceLabel)}</span></td>
        <td style="text-align:left;">${escapeHtml(linkedText)}</td>
        <td style="text-align:left;">${formatTagChips(item.labels ?? [], item.tags)}</td>
        <td class="col-number">${formatNumber(item.grantCount)}</td>
        <td>
          <div class="action-buttons">
            <button class="btn btn-secondary btn-sm" data-action="edit-employee-page" data-id="${item.id}">编辑</button>
            <button class="btn btn-secondary btn-sm" data-action="merge-employee-page" data-id="${item.id}">关联</button>
            <button class="btn btn-warning btn-sm" data-action="toggle-employee-page" data-id="${item.id}">${toggleLabel}</button>
          </div>
        </td>
      </tr>`;
    })
    .join('');
  el('employeesPageBody')
    .querySelectorAll<HTMLElement>('[data-action="edit-employee-page"]')
    .forEach((button) => button.addEventListener('click', () => openEmployeesPageModal(Number(button.dataset.id))));
  el('employeesPageBody')
    .querySelectorAll<HTMLElement>('[data-action="merge-employee-page"]')
    .forEach((button) => button.addEventListener('click', () => openEmployeesMergeModal(Number(button.dataset.id))));
  el('employeesPageBody')
    .querySelectorAll<HTMLElement>('[data-action="toggle-employee-page"]')
    .forEach((button) => button.addEventListener('click', () => void toggleEmployeeActive(Number(button.dataset.id))));
  localizeAppDom();
}

function openEmployeesPageModal(id?: number) {
  editingEmployeeId = id ?? null;
  const item = employees.find((row) => row.id === id);
  el('employeesPageModalTitle').textContent = item
    ? (currentLanguage === 'zh-CN' ? '编辑员工' : 'Edit Employee')
    : (currentLanguage === 'zh-CN' ? '新增员工' : 'New Employee');
  el('employeesPageNumberRow').style.display = '';
  const numberInput = el<HTMLInputElement>('employeesPageNumber');
  numberInput.value = item?.employeeNumber ?? '';
  numberInput.readOnly = Boolean(item); // employee_id (工号) is the key: editable only when creating
  el<HTMLInputElement>('employeesPageName').value = item?.employeeName ?? '';
  el<HTMLInputElement>('employeesPageUserId').value = item?.userId ?? '';
  editingEmployeeLabelIds = [...(item?.labelIds ?? [])];
  renderEmployeeLabelControls();
  el('employeeLabelPickerMenu').classList.add('hidden');
  el('employeesPageModal').classList.remove('hidden');
}

async function submitEmployeesPage() {
  const employeeId = el<HTMLInputElement>('employeesPageNumber').value.trim();
  const employeeName = el<HTMLInputElement>('employeesPageName').value.trim();
  const userId = el<HTMLInputElement>('employeesPageUserId').value.trim();
  const labelIds = selectedEmployeeLabelIds();
  if (!employeeName) {
    notify('请填写员工姓名', { type: 'warning' });
    return;
  }
  if (!editingEmployeeId && !employeeId) {
    notify('请填写工号（Emp. No.）', { type: 'warning' });
    return;
  }

  try {
    if (editingEmployeeId) {
      await api(`/api/employees/${editingEmployeeId}`, {
        method: 'PATCH',
        body: JSON.stringify({ employeeName, userId, labelIds }),
      });
    } else {
      await api('/api/employees', { method: 'POST', body: JSON.stringify({ employeeId, employeeName, userId, labelIds }) });
    }
  } catch (error) {
    notify((error as Error).message, { type: 'warning' });
    return;
  }
  el('employeesPageModal').classList.add('hidden');
  editingEmployeeId = null;
  editingEmployeeLabelIds = [];
  await loadEmployeeLabels();
  await loadEmployeesPage();
}

async function toggleEmployeeActive(id: number) {
  const item = employees.find((row) => row.id === id);
  if (!item) return;
  const nextActive = !item.active;
  const verb = nextActive ? '启用' : '停用';
  if (!(await confirmAction(`确定${verb}员工【${item.employeeName}】吗？`, { title: `${verb}员工`, confirmText: verb }))) return;
  await api(`/api/employees/${id}`, { method: 'PATCH', body: JSON.stringify({ active: nextActive }) });
  await loadEmployeesPage();
}

function openEmployeesMergeModal(id: number) {
  const item = employees.find((row) => row.id === id);
  if (!item) return;
  mergeSourceEmployeeId = id;
  el('employeesMergeSourceLabel').textContent = `${item.employeeName}（No. ${item.employeeNumber}）`;
  el<HTMLInputElement>('employeesMergeTargetNumber').value = '';
  el('employeesMergeModal').classList.remove('hidden');
}

async function submitEmployeesMerge() {
  if (mergeSourceEmployeeId === null) return;
  const targetNumber = el<HTMLInputElement>('employeesMergeTargetNumber').value.trim();
  if (!targetNumber) {
    notify('请输入目标员工工号', { type: 'warning' });
    return;
  }
  try {
    await api(`/api/employees/${encodeURIComponent(targetNumber)}/merge`, {
      method: 'POST',
      body: JSON.stringify({ mergeFromId: mergeSourceEmployeeId }),
    });
  } catch (error) {
    notify((error as Error).message, { type: 'warning' });
    return;
  }
  el('employeesMergeModal').classList.add('hidden');
  mergeSourceEmployeeId = null;
  notify('已关联为同一人', { type: 'success' });
  await loadEmployeesPage();
}

async function renderPlanSummaryPage() {
  const data = await api<PlanSummaryResponse>('/api/plan-summary');
  setWorkflowPageFiles('plan-summary', data);
  el('planSummaryPlanCount').textContent = formatNumber(data.totals.planCount);
  el('planSummaryGranted').textContent = formatNumber(data.totals.granted);
  el('planSummaryExercised').textContent = formatNumber(data.totals.exercised);
  el('planSummaryOutstanding').textContent = formatNumber(data.totals.outstanding);

  if (data.items.length === 0) {
    el('planSummaryBody').innerHTML = '<tr><td colspan="6" class="table-empty-cell">暂无计划汇总数据</td></tr>';
    localizeAppDom();
    return;
  }

  el('planSummaryBody').innerHTML = data.items
    .map(
      (item) => `
      <tr>
        <td style="text-align:left; font-weight:600;">${escapeHtml(item.planName)}</td>
        <td class="col-number">${formatNumber(item.grantCount)}</td>
        <td class="col-number">${formatNumber(item.granted)}</td>
        <td class="col-number">${formatNumber(item.exercised)}</td>
        <td class="col-number">${formatNumber(item.cancelled)}</td>
        <td class="col-number" style="font-weight:600;">${formatNumber(item.outstanding)}</td>
      </tr>`,
    )
    .join('');
  localizeAppDom();
}

function formatHolderPercent(value: number | null): string {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
  return `${(Number(value) * 100).toLocaleString('en-US', { maximumFractionDigits: 3 })}%`;
}

function fivePercentHoldersUpdateButton(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>('[data-workflow-update-page="five-percent-holders"]');
}

function setFivePercentHoldersUpdateButtonState() {
  const button = fivePercentHoldersUpdateButton();
  if (!button) return;
  const label = button.querySelector<HTMLElement>('[data-workflow-action-label]');
  if (label) {
    label.textContent = fivePercentHoldersEditMode ? 'Save' : 'Update';
  } else {
    button.textContent = fivePercentHoldersEditMode ? 'Save' : 'Update';
  }
  button.disabled = fivePercentHoldersSaving;
}

function fixedValueByKey(key: string): FixedValueRecord | null {
  return fivePercentHolderGlobalParameters.find((item) => item.key === key) ?? null;
}

function fixedValueKeyForHolderCell(holderIndex: number, field: 'commonStock' | 'totalCses'): string | null {
  if (holderIndex === 0) {
    return field === 'commonStock' ? fivePercentHolderGlobalParameterKeys.gniCommonStock : fivePercentHolderGlobalParameterKeys.gniTotalCses;
  }
  if (holderIndex === 1) {
    return field === 'commonStock' ? fivePercentHolderGlobalParameterKeys.songjiangMaCommonStock : fivePercentHolderGlobalParameterKeys.songjiangMaTotalCses;
  }
  return null;
}

function renderFivePercentHolderEditableNumber(item: FivePercentHoldersResponse['items'][number], field: 'commonStock' | 'totalCses', holderIndex: number) {
  const key = fixedValueKeyForHolderCell(holderIndex, field);
  const fixedValue = key ? fixedValueByKey(key) : null;
  if (!fivePercentHoldersEditMode || item.rowType !== 'holder' || !key) {
    if (item.rowType === 'holder' && key) return formatNumber(fixedValue?.value ?? null);
    return formatNumber(field === 'commonStock' ? item.commonStock : item.totalCses);
  }
  const inputValue = fixedValue?.value ?? '';
  const idAttribute = fixedValue?.id ? ` data-five-percent-fixed-value-id="${fixedValue.id}"` : '';
  return `<input class="form-input fixed-value-inline-input" type="text" inputmode="decimal" value="${escapeHtml(String(inputValue))}"${idAttribute} data-five-percent-fixed-value-key="${escapeHtml(key)}">`;
}

async function loadFivePercentHolderGlobalParameters() {
  const keys = new Set<string>(Object.values(fivePercentHolderGlobalParameterKeys));
  const data = await api<{ items: FixedValueRecord[] }>('/api/five-percent-holders/fixed-values');
  fivePercentHolderGlobalParameters = data.items.filter((item) => keys.has(item.key) && item.updatedBy !== 'system');
}

async function renderFivePercentHoldersPage() {
  const data = await api<FivePercentHoldersResponse>('/api/five-percent-holders');
  await loadFivePercentHolderGlobalParameters();
  setWorkflowPageFiles('five-percent-holders', data);
  setFivePercentHoldersUpdateButtonState();
  const summary = data.summary;
  el('fivePercentHoldersSummary').innerHTML = `
    <div class="stat-chip"><span class="stat-chip__label">As of</span><span class="stat-chip__value">${escapeHtml(summary.asOfDate ?? '-')}</span></div>
    <div class="stat-chip"><span class="stat-chip__label">Fully Diluted</span><span class="stat-chip__value">${formatNumber(summary.fullyDiluted)}</span></div>
    <div class="stat-chip"><span class="stat-chip__label">Common Stock OS</span><span class="stat-chip__value">${formatNumber(summary.commonStockOs)}</span></div>`;

  if (data.items.length === 0) {
    el('fivePercentHoldersBody').innerHTML =
      '<tr><td colspan="5" class="table-empty-cell">暂无 5% 股东记录</td></tr>';
    localizeAppDom();
    return;
  }

  let holderIndex = 0;
  el('fivePercentHoldersBody').innerHTML = data.items
    .map((item) => {
      const rowClass = item.rowType === 'total' ? ' class="table-row--total"' : '';
      const currentHolderIndex = item.rowType === 'holder' ? holderIndex++ : -1;
      return `
      <tr${rowClass}>
        <td style="text-align:left; font-weight:600;">${escapeHtml(item.name)}</td>
        <td class="col-number">${renderFivePercentHolderEditableNumber(item, 'commonStock', currentHolderIndex)}</td>
        <td class="col-number">${renderFivePercentHolderEditableNumber(item, 'totalCses', currentHolderIndex)}</td>
        <td class="col-number">${formatHolderPercent(item.pctOfClass)}</td>
        <td class="col-number">${formatHolderPercent(item.pctFullyDiluted)}</td>
      </tr>`;
    })
    .join('');
  localizeAppDom();
}

function readFivePercentHolderGlobalParameterDrafts() {
  const drafts = Array.from(document.querySelectorAll<HTMLInputElement>('[data-five-percent-fixed-value-key]')).map((input) => {
    const rawId = input.dataset.fivePercentFixedValueId;
    const id = rawId ? Number(rawId) : null;
    const key = String(input.dataset.fivePercentFixedValueKey ?? '');
    const value = Number(input.value.replace(/,/g, '').trim());
    if ((id !== null && (!Number.isInteger(id) || id <= 0)) || !key || !Number.isFinite(value)) {
      throw new Error('请输入有效的 5% Holders 数字');
    }
    return { id, key, value };
  });
  if (drafts.length !== 4) throw new Error('5% Holders 需要编辑四个全局参数');
  return drafts;
}

async function runFivePercentHoldersWorkflowWithPreviousSource() {
  const binding = workflowUpdateBindingFor('five-percent-holders', 'capitalization_summary');
  const fileId = Number(binding?.fileId);
  const sources = Number.isInteger(fileId) && fileId > 0
    ? { capitalization_summary: { fileId } }
    : {};
  const result = await api<WorkflowExecutionResult>(workflowUpdateRunEndpoint('five-percent-holders'), {
    method: 'POST',
    body: JSON.stringify({ sources }),
  });
  const runId = result.run?.id;
  if (!runId) throw new Error('Workflow run was not created');
  const run = await pollWorkflowUpdateRunUntilFinished(runId);
  if (run.status !== 'completed' && run.status !== 'completed_with_warnings') {
    throw new Error(run.errorMessage ?? `Workflow ended with status ${run.status}`);
  }
  return run;
}

async function saveFivePercentHolderGlobalParametersAndRunWorkflow() {
  const drafts = readFivePercentHolderGlobalParameterDrafts();
  fivePercentHoldersSaving = true;
  setFivePercentHoldersUpdateButtonState();
  try {
    for (const draft of drafts) {
      const payload = {
        key: draft.key,
        label: fivePercentHolderGlobalParameterLabels[draft.key] ?? draft.key,
        value: draft.value,
        updatedBy: authStatus?.user?.displayName ?? 'Administrator',
      };
      if (draft.id) {
        await api(`/api/fixed-values/${draft.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ value: draft.value, updatedBy: payload.updatedBy }),
        });
      } else {
        await api('/api/fixed-values', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
    }
    notify('Global Parameter 已保存，正在运行 5% Holders workflow...', { type: 'success' });
    const run = await runFivePercentHoldersWorkflowWithPreviousSource();
    await filesPage.refreshProductFiles();
    fivePercentHoldersEditMode = false;
    await renderFivePercentHoldersPage();
    notify(run.status === 'completed_with_warnings' ? '5% Holders 更新完成（包含 Warning）' : '5% Holders 更新完成', {
      type: run.status === 'completed_with_warnings' ? 'warning' : 'success',
    });
  } catch (error) {
    notify((error as Error).message, { type: 'error' });
  } finally {
    fivePercentHoldersSaving = false;
    setFivePercentHoldersUpdateButtonState();
  }
}

async function handleFivePercentHoldersUpdateClick() {
  if (fivePercentHoldersSaving) return;
  if (!fivePercentHoldersEditMode) {
    fivePercentHoldersEditMode = true;
    await renderFivePercentHoldersPage();
    return;
  }
  await saveFivePercentHolderGlobalParametersAndRunWorkflow();
}

async function renderFixedValuePage() {
  const data = await api<{ items: FixedValueRecord[] }>('/api/global-parameters');
  if (data.items.length === 0) {
    el('fixedValuePageBody').innerHTML = '<tr><td colspan="6" class="table-empty-cell">暂无 Global Parameter 配置</td></tr>';
    localizeAppDom();
    return;
  }

  el('fixedValuePageBody').innerHTML = data.items
    .map(
      (item) => `
      <tr>
        <td style="text-align:left;">${escapeHtml(item.key)}</td>
        <td style="text-align:left; font-weight:600;">${escapeHtml(item.label)}</td>
        <td class="col-number">${formatNumber(item.value)}</td>
        <td>${escapeHtml(item.effectiveFrom)}</td>
        <td>${escapeHtml(item.updatedBy)}</td>
        <td>
          ${isAdminUser() && item.editable
            ? `<div class="action-buttons">
                <button class="btn btn-secondary btn-sm" data-action="edit-fixed-value" data-id="${item.id}" type="button">edit</button>
                <button class="btn btn-danger btn-sm" data-action="delete-fixed-value" data-id="${item.id}" type="button" aria-label="删除 ${escapeHtml(item.label)}" title="删除">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M19 6l-1 14H6L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path></svg>
                </button>
              </div>`
            : '<span>-</span>'}
        </td>
      </tr>`,
    )
    .join('');

  el('fixedValuePageBody')
    .querySelectorAll<HTMLElement>('[data-action="edit-fixed-value"]')
    .forEach((button) => button.addEventListener('click', () => void editFixedValue(Number(button.dataset.id), data.items)));
  el('fixedValuePageBody')
    .querySelectorAll<HTMLElement>('[data-action="delete-fixed-value"]')
    .forEach((button) => button.addEventListener('click', () => void deleteFixedValue(Number(button.dataset.id), data.items)));
  localizeAppDom();
}

async function editFixedValue(id: number, items: FixedValueRecord[]) {
  if (!isAdminUser()) return;
  const item = items.find((row) => row.id === id);
  if (!item) return;
  const next = prompt(`Update ${item.label}:`, String(item.value));
  if (next === null) return;
  const value = Number(next.replace(/,/g, ''));
  if (!Number.isFinite(value)) {
    notify('请输入有效数字', { type: 'warning' });
    return;
  }
  try {
    await api(`/api/global-parameters/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ value, updatedBy: authStatus?.user?.displayName ?? 'Administrator' }),
    });
    await renderFixedValuePage();
  } catch (error) {
    notify((error as Error).message, { type: 'error' });
  }
}

function openFixedValueModal() {
  if (!isAdminUser()) return;
  el<HTMLInputElement>('fixedValueKey').value = '';
  el<HTMLInputElement>('fixedValueLabel').value = '';
  el<HTMLInputElement>('fixedValueValue').value = '';
  el<HTMLInputElement>('fixedValueEffectiveFrom').value = currentMonth || new Date().toISOString().slice(0, 7);
  el('fixedValueModal').classList.remove('hidden');
  el<HTMLInputElement>('fixedValueKey').focus();
}

async function createFixedValue() {
  if (!isAdminUser()) return;
  const key = el<HTMLInputElement>('fixedValueKey').value.trim();
  const label = el<HTMLInputElement>('fixedValueLabel').value.trim();
  const rawValue = el<HTMLInputElement>('fixedValueValue').value.replace(/,/g, '').trim();
  const value = Number(rawValue);
  const effectiveFrom = el<HTMLInputElement>('fixedValueEffectiveFrom').value.trim();
  if (!key || !label || !rawValue || !effectiveFrom || !Number.isFinite(value)) {
    notify('请完整填写 Key、Item、Value 和 Effective From', { type: 'warning' });
    return;
  }

  const submitButton = el<HTMLButtonElement>('btnSubmitFixedValue');
  submitButton.disabled = true;
  try {
    await api('/api/global-parameters', {
      method: 'POST',
      body: JSON.stringify({
        key,
        label,
        value,
        effectiveFrom,
        updatedBy: authStatus?.user?.displayName ?? 'Administrator',
      }),
    });
    el('fixedValueModal').classList.add('hidden');
    await renderFixedValuePage();
    notify('Global Parameter 已新增', { type: 'success' });
  } catch (error) {
    notify((error as Error).message, { type: 'error' });
  } finally {
    submitButton.disabled = false;
  }
}

async function deleteFixedValue(id: number, items: FixedValueRecord[]) {
  if (!isAdminUser()) return;
  const item = items.find((row) => row.id === id);
  if (!item) return;
  if (!(await confirmAction(`确定删除 Global Parameter「${item.label}」吗？此操作不可撤销。`, {
    title: '删除 Global Parameter',
    confirmText: '删除',
    tone: 'danger',
  }))) return;

  try {
    await api(`/api/global-parameters/${id}`, { method: 'DELETE' });
    await renderFixedValuePage();
    notify('Global Parameter 已删除', { type: 'success' });
  } catch (error) {
    notify((error as Error).message, { type: 'error' });
  }
}

function getGrantTypeClass(type: string): string {
  if (type === 'Option') return 'type-iso';
  if (type === 'RSU') return 'type-rsu';
  if (type === 'Common Stock') return 'type-common';
  return '';
}

async function initSettingsPage() {
  document.querySelectorAll<HTMLElement>('[data-close]').forEach((button) => {
    button.addEventListener('click', () => el(button.dataset.close ?? '').classList.add('hidden'));
  });
  document.querySelectorAll<HTMLButtonElement>('[data-language]').forEach((button) => {
    button.addEventListener('click', () => {
      const language = button.dataset.language === 'en-US' ? 'en-US' : 'zh-CN';
      setLanguage(language);
    });
  });
  el('btnAddFixedValue').addEventListener('click', openFixedValueModal);
  el('btnSubmitFixedValue').addEventListener('click', () => void createFixedValue());
  renderThemeCards();
  syncLanguageButtons();
}

async function loadEmployees() {
  employeeMappings = (await api<{ items: EmployeeMapping[] }>('/api/settings/employee-mappings')).items;
  renderEmployeeTable();
}

async function loadPlans() {
  planManagements = (await api<{ items: TrackedPlan[] }>('/api/settings/tracked-plans')).items;
  renderPlanManageTable();
}

async function loadShareholders() {
  shareholders = (await api<{ items: ShareholderTag[] }>('/api/settings/shareholders')).items;
  renderShareholderTable();
}

function renderEmployeeTable() {
  const keyword = el<HTMLInputElement>('searchEmployee').value.trim().toLowerCase();
  const list = keyword ? employeeMappings.filter((item) => item.name.toLowerCase().includes(keyword)) : employeeMappings;
  el('employeeBody').innerHTML = list
    .map(
      (item, index) => `
      <tr><td>${index + 1}</td><td style="text-align:left; font-weight:600;">${escapeHtml(item.name)}</td>
      <td>${escapeHtml(item.empId)}</td><td>${escapeHtml(item.futuId || '-')}</td><td>${escapeHtml(item.shareworksId || '-')}</td>
      <td><div class="action-buttons"><button class="btn btn-secondary btn-sm" data-action="edit-emp" data-id="${item.id}">编辑</button><button class="btn btn-danger btn-sm" data-action="del-emp" data-id="${item.id}">删除</button></div></td></tr>`,
    )
    .join('');
  el('employeeBody').querySelectorAll<HTMLElement>('[data-action="edit-emp"]').forEach((button) => button.addEventListener('click', () => void editEmployee(Number(button.dataset.id))));
  el('employeeBody').querySelectorAll<HTMLElement>('[data-action="del-emp"]').forEach((button) => button.addEventListener('click', () => void deleteEmployee(Number(button.dataset.id))));
  localizeAppDom();
}

function renderPlanManageTable() {
  const keyword = el<HTMLInputElement>('searchPlan').value.trim().toLowerCase();
  const list = keyword ? planManagements.filter((item) => item.name.toLowerCase().includes(keyword)) : planManagements;
  el('planManageBody').innerHTML = list
    .map(
      (item, index) => `
      <tr><td>${index + 1}</td><td style="text-align:left; font-weight:600;">${escapeHtml(item.name)}</td><td>${escapeHtml(item.createTime)}</td>
      <td><span class="status-badge ${item.status === '生效中' ? 'status-completed' : 'status-pending'}">${escapeHtml(item.status)}</span></td>
      <td><div class="action-buttons"><button class="btn btn-secondary btn-sm" data-action="edit-plan" data-id="${item.id}">编辑</button><button class="btn btn-danger btn-sm" data-action="del-plan" data-id="${item.id}">删除</button></div></td></tr>`,
    )
    .join('');
  el('planManageBody').querySelectorAll<HTMLElement>('[data-action="edit-plan"]').forEach((button) => button.addEventListener('click', () => void editTrackedPlan(Number(button.dataset.id))));
  el('planManageBody').querySelectorAll<HTMLElement>('[data-action="del-plan"]').forEach((button) => button.addEventListener('click', () => void deleteTrackedPlan(Number(button.dataset.id))));
  localizeAppDom();
}

function renderShareholderTable() {
  const keyword = el<HTMLInputElement>('searchShareholder').value.trim().toLowerCase();
  const list = keyword ? shareholders.filter((item) => item.name.toLowerCase().includes(keyword)) : shareholders;
  el('shareholderBody').innerHTML = list
    .map(
      (item, index) => `
      <tr><td>${index + 1}</td><td style="text-align:left; font-weight:600;">${escapeHtml(item.name)}</td><td style="text-align:left;">${escapeHtml(item.identity)}</td>
      <td><label class="toggle-switch"><input type="checkbox" ${item.track ? 'checked' : ''} data-id="${item.id}" data-field="track"><span class="toggle-slider"></span></label><span class="${item.track ? 'toggle-track-yes' : 'toggle-track-no'}">${item.track ? '是' : '否'}</span></td>
      <td><div class="action-buttons"><button class="btn btn-secondary btn-sm" data-action="edit-sh" data-id="${item.id}">编辑</button><button class="btn btn-danger btn-sm" data-action="del-sh" data-id="${item.id}">删除</button></div></td></tr>`,
    )
    .join('');
  el('shareholderBody').querySelectorAll<HTMLInputElement>('input[data-field="track"]').forEach((input) => input.addEventListener('change', () => void patchShareholder(Number(input.dataset.id), { track: input.checked })));
  el('shareholderBody').querySelectorAll<HTMLElement>('[data-action="edit-sh"]').forEach((button) => button.addEventListener('click', () => void editShareholder(Number(button.dataset.id))));
  el('shareholderBody').querySelectorAll<HTMLElement>('[data-action="del-sh"]').forEach((button) => button.addEventListener('click', () => void deleteShareholder(Number(button.dataset.id))));
  localizeAppDom();
}

async function submitEmployee() {
  const name = el<HTMLInputElement>('newEmpName').value.trim();
  const empId = el<HTMLInputElement>('newEmpId').value.trim();
  if (!name || !empId) {
    notify('请填写员工姓名和身份ID', { type: 'warning' });
    return;
  }
  await api('/api/settings/employee-mappings', {
    method: 'POST',
    body: JSON.stringify({ name, empId, futuId: el<HTMLInputElement>('newEmpFutu').value.trim(), shareworksId: el<HTMLInputElement>('newEmpShare').value.trim() }),
  });
  el('addEmployeeModal').classList.add('hidden');
  await loadEmployees();
}

async function editEmployee(id: number) {
  const item = employeeMappings.find((row) => row.id === id);
  if (!item) return;
  const name = prompt('员工姓名：', item.name);
  if (name === null) return;
  const empId = prompt('员工身份ID：', item.empId);
  if (empId === null) return;
  const futuId = prompt('futu员工ID号：', item.futuId) ?? '';
  const shareworksId = prompt('shareworks员工ID号：', item.shareworksId) ?? '';
  await api(`/api/settings/employee-mappings/${id}`, { method: 'PATCH', body: JSON.stringify({ name, empId, futuId, shareworksId }) });
  await loadEmployees();
}

async function deleteEmployee(id: number) {
  const item = employeeMappings.find((row) => row.id === id);
  if (!item) return;
  if (!(await confirmAction(`确定删除员工【${item.name}】吗？`, { title: '删除员工映射', confirmText: '删除', tone: 'danger' }))) return;
  await api(`/api/settings/employee-mappings/${id}`, { method: 'DELETE' });
  await loadEmployees();
}

async function submitTrackedPlan() {
  const name = el<HTMLInputElement>('newPlanName').value.trim();
  if (!name) {
    notify('请填写计划名称', { type: 'warning' });
    return;
  }
  await api('/api/settings/tracked-plans', { method: 'POST', body: JSON.stringify({ name, description: el<HTMLTextAreaElement>('newPlanDesc').value.trim() }) });
  el('addPlanManageModal').classList.add('hidden');
  await loadPlans();
}

async function editTrackedPlan(id: number) {
  const item = planManagements.find((row) => row.id === id);
  if (!item) return;
  const name = prompt('计划名称：', item.name);
  if (!name?.trim()) return;
  await api(`/api/settings/tracked-plans/${id}`, { method: 'PATCH', body: JSON.stringify({ name: name.trim() }) });
  await loadPlans();
}

async function deleteTrackedPlan(id: number) {
  const item = planManagements.find((row) => row.id === id);
  if (!item) return;
  if (!(await confirmAction(`确定删除计划【${item.name}】吗？`, { title: '删除计划', confirmText: '删除', tone: 'danger' }))) return;
  await api(`/api/settings/tracked-plans/${id}`, { method: 'DELETE' });
  await loadPlans();
}

async function submitShareholder() {
  const name = el<HTMLInputElement>('newShName').value.trim();
  const identity = el<HTMLInputElement>('newShId').value.trim();
  if (!name || !identity) {
    notify('请填写股东姓名和身份信息', { type: 'warning' });
    return;
  }
  await api('/api/settings/shareholders', { method: 'POST', body: JSON.stringify({ name, identity, track: el<HTMLSelectElement>('newShTrack').value === 'true' }) });
  el('addShareholderModal').classList.add('hidden');
  await loadShareholders();
}

async function patchShareholder(id: number, patch: Partial<ShareholderTag>) {
  await api(`/api/settings/shareholders/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
  await loadShareholders();
}

async function editShareholder(id: number) {
  const item = shareholders.find((row) => row.id === id);
  if (!item) return;
  const name = prompt('股东姓名：', item.name);
  if (name === null) return;
  const identity = prompt('身份信息：', item.identity);
  if (identity === null) return;
  await patchShareholder(id, { name, identity });
}

async function deleteShareholder(id: number) {
  const item = shareholders.find((row) => row.id === id);
  if (!item) return;
  if (!(await confirmAction(`确定删除股东【${item.name}】吗？`, { title: '删除股东', confirmText: '删除', tone: 'danger' }))) return;
  await api(`/api/settings/shareholders/${id}`, { method: 'DELETE' });
  await loadShareholders();
}

function formatFileSize(bytes: number) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, index)).toFixed(index > 0 ? 1 : 0)} ${units[index]}`;
}

function exportData() {
  if (!currentSummary) {
    notify('当前月份没有可导出的摘要数据', { type: 'warning' });
    return;
  }
  let csv = '\ufeff';
  csv += `CapTable 股权数据 - ${formatMonthCN(currentMonth)}\n\n`;
  csv += '【流通股份对账】\n项目,截至日期,上月末,本月新增,本月末\n';
  csv += `${currentSummary.reconciliation.item},${currentSummary.eomDate},${currentSummary.reconciliation.lastMonth},${currentSummary.reconciliation.newShares},${currentSummary.reconciliation.eomBalance}\n\n`;
  csv += '【资本结构】\nDescription,股份,占比\n';
  currentSummary.capitalization.forEach((item) => {
    csv += `"${item.description}",${item.shares ?? ''},${item.percent ?? ''}\n`;
  });
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `CapTable_${currentMonth}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

async function openLinkModal(key: string) {
  const detail = await api<LinkDetail>(`/api/link-details/${key}`);
  el('linkModalTitle').textContent = detail.title;
  const html = `<div class="link-modal-table-wrapper"><table class="link-modal-table">
    <thead><tr>${detail.columns.map((col) => `<th>${escapeHtml(col.label)}</th>`).join('')}</tr></thead>
    <tbody>
      ${detail.rows
        .map((row) => `<tr>${detail.columns.map((col) => `<td>${typeof row[col.key] === 'number' ? formatNumber(row[col.key]) : escapeHtml(row[col.key] ?? '-')}</td>`).join('')}</tr>`)
        .join('')}
      ${
        detail.summary
          ? `<tr class="link-modal-summary-row">${detail.columns.map((col) => `<td>${typeof detail.summary?.[col.key] === 'number' ? formatNumber(detail.summary[col.key]) : escapeHtml(detail.summary?.[col.key] ?? '')}</td>`).join('')}</tr>`
          : ''
      }
    </tbody></table></div>`;
  el('linkModalContent').innerHTML = html;
  el('linkDetailModal').classList.remove('hidden');
  localizeAppDom();
}

function initLinkModal() {
  const close = () => el('linkDetailModal').classList.add('hidden');
  el('btnCloseLinkModal').addEventListener('click', close);
  el('btnCloseLinkModalFooter').addEventListener('click', close);
  el('linkDetailModal').addEventListener('click', (event) => {
    if (event.target === el('linkDetailModal')) close();
  });
}

async function initializeApp() {
  if (appInitialized) return;
  initSidebarToggle();
  applyInitialRouteBeforeReveal();
  initNavigation();
  initMonthlyRunInputCard();
  initMonthPicker();
  await initSummaryPage();
  await initMonthlyPage();
  await monthlyRunPage.init();
  await filesPage.init();
  await workflowPage.init();
  await initHoldingsPage();
  await initExercisePage();
  await initSoldSharesPage();
  await initTransferPlanPage();
  await initEmployeesPage();
  initWorkflowUpdateModal();
  await initUserManagementPage();
  await initAccountPage();
  await initSettingsPage();
  initLinkModal();
  applyLanguage();
  el('currentUserAvatar').addEventListener('click', (event) => {
    event.stopPropagation();
    toggleUserMenu();
  });
  el('btnAccountPage').addEventListener('click', () => void openAccountPage());
  el('btnLogout').addEventListener('click', () => {
    closeUserMenu();
    void logout();
  });
  document.addEventListener('click', (event) => {
    const target = event.target as Node | null;
    if (target && el('userMenu').contains(target)) return;
    if (target && el('currentUserAvatar').contains(target)) return;
    closeUserMenu();
  });
  appInitialized = true;
}

document.addEventListener('DOMContentLoaded', async () => {
  try {
    applyTheme();
    el('authForm').addEventListener('submit', (event) => void submitAuthForm(event));
    const status = await fetchAuthStatus();
    if (!status.authenticated) {
      showAuthShell(status);
      applyLanguage();
      document.body.classList.remove('app-booting');
      return;
    }
    setCurrentUser(status.user);
    hideAuthShell();
    await initializeApp();
  } catch (error) {
    console.error(error);
    notify((error as Error).message, { type: 'error' });
  }
});

import type {
  AuthStatus,
  AuthenticatedUser,
  Employee,
  EmployeeLabel,
  ExerciseRecord,
  FixedValueRecord,
  FivePercentHoldersResponse,
  Holding,
  LinkDetail,
  LatestMonthlyRunOutput,
  ManagedUser,
  MergedExercise,
  MergedGrant,
  MonthlyRunInstanceRecord,
  MonthlyRunPlanDeleteResult,
  PaginatedResult,
  PlanSummaryResponse,
  ProductFileRecord,
  SoldShare,
  SummaryCapitalizationSource,
  SummarySnapshot,
  TransferPlanResponse,
  WorkflowExecutionResult,
  WorkflowResultFileBinding,
  WorkflowPageSourceBinding,
  ShareworksExercise,
  ShareworksGrant,
} from '../shared/types.js';
import type { AccountProfile } from '../shared/types.js';
import { createFilesPage } from './filesPage.js';
import { createFilePickerModal } from './filePickerModal.js';
import { createMonthlyRunPage } from './monthlyRunPage.js';
import { createWorkflowUpdateModal, type WorkflowUpdatePageKey } from './workflowUpdateModal.js';
import { createTexts, TEXTS, type TextKey } from './texts.js';

const texts = createTexts('main');

/** Page titles keyed by page; the values live in the merged translation table. */
const pageTitleTranslations = TEXTS.pageTitles as Record<PageKey, Record<AppLanguage, string>>;
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
import {
  computeCapitalizationRowDeltas,
  findComparableRow,
  indexCapitalizationRows,
  normalizeCapitalizationRows,
  resolveBaselineMonth,
  resolveDefaultSummaryMonth,
  sortAvailableMonths,
  type AvailableMonth,
  type CapitalizationDelta,
} from './summaryPage.js';
import { buildEmployeesApiUrl, type EmployeeSourceFilter } from './employeesPage.js';
import { renderTransferPlanSummaryTable, type TransferPlanTableView } from './transferPlanPage.js';
import { buildLinkedBadge } from './linkedBadge.js';
import { applyStaticTranslations, persistLanguage, readStoredLanguage, type AppLanguage } from './i18n.js';
import { csvRow } from './csv.js';
import {
  edgePage,
  nextPageWithinBounds,
  paginationView,
  renderPaginationControls,
  type PaginationIds,
} from './pagination.js';
import '../../css/style.css';

let currentMonth = '';
let availableMonthOptions: AvailableMonth[] = [];
let currentSummary: SummarySnapshot | null = null;
let baselineSummaryCache: { month: string; data: SummarySnapshot | null } | null = null;
let authStatus: AuthStatus | null = null;
let updatePlans: MonthlyRunInstanceRecord[] = [];
let employees: Employee[] = [];
let employeeLabels: EmployeeLabel[] = [];
let summarySourceFiles: ProductFileRecord[] = [];
let holdingsPage = 1;
let holdingsTotal = 0;
let holdingsPageSize = 20;
type GrantView = 'futu' | 'shareworks' | 'merge';
let activeGrantView: GrantView = 'futu';
type ExerciseView = 'futu' | 'shareworks' | 'merge';
let activeExerciseView: ExerciseView = 'futu';
let exercisePage = 1;
let exerciseTotal = 0;
let exercisePageSize = 20;
let soldSharesPage = 1;
let soldSharesTotal = 0;
let soldSharesPageSize = 20;
let transferPlanTableView: TransferPlanTableView = 'summaryRows';
let transferPlanEditMode = false;
let employeesPage = 1;
let employeesTotal = 0;
let employeesPageSize = 20;
let employeesSort: { by: 'name' | 'empNo' | ''; dir: 'asc' | 'desc' } = { by: '', dir: 'asc' };
type NameEmpNoSort = { by: 'name' | 'empNo' | ''; dir: 'asc' | 'desc' };
let grantSort: NameEmpNoSort = { by: '', dir: 'asc' };
let exerciseSort: NameEmpNoSort = { by: '', dir: 'asc' };
let soldSharesSort: NameEmpNoSort = { by: '', dir: 'asc' };
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
  'fixed-value': '全局参数',
  'data-management': '数据管理',
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
let managedUsers: ManagedUser[] = [];
let editingManagedUserId: number | null = null;
let editingFixedValueId: number | null = null;

let editingEmployeeId: number | null = null;
let editingEmployeeLabelId: number | null = null;
let editingEmployeeLabelIds: number[] = [];
let mergeSourceEmployeeId: number | null = null;
const DEFAULT_EMPLOYEE_LABEL_COLOR = '#2563eb';

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

// Shared tree file picker (folder-grouped, expandable) reused by the workflow update modal so the
// source-file selection matches the Files Center navigator instead of a flat native <select>.
const filePicker = createFilePickerModal({
  el,
  api,
  escapeHtml,
  formatFileSize,
  getProductFiles: () => filesPage.getProductFiles(),
  refreshProductFiles: () => filesPage.refreshProductFiles(),
  notify,
  confirmAction,
  getLanguage: () => currentLanguage,
});

const workflowPage = createWorkflowPage({
  el,
  api,
  escapeHtml,
  formatFileSize,
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

/** Re-render the page whose workflow just ran (the modal calls back into this). */
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
    await renderPlanSummaryPage(currentMonth);
  } else if (page === 'five-percent-holders') {
    await renderFivePercentHoldersPage();
  }
}

const workflowUpdateModal = createWorkflowUpdateModal({
  el,
  api,
  escapeHtml,
  notify,
  getLanguage: () => currentLanguage,
  getProductFiles: () => filesPage.getProductFiles(),
  refreshProductFiles: () => filesPage.refreshProductFiles(),
  openFilePicker: (options) => filePicker.open(options),
  productFileDisplayName,
  refreshPage: (page) => refreshWorkflowUpdatePage(page),
});

const monthlyRunPage = createMonthlyRunPage({
  el,
  api,
  escapeHtml,
  formatDateTime,
  refreshProductFiles: () => filesPage.refreshProductFiles(),
  refreshSummary: (month) => {
    baselineSummaryCache = null;
    return renderSummaryPage(month);
  },
  openProductFile: (fileId) => navigateToProductFile(fileId),
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
  const list = (Array.isArray(files) ? files : [files]).map((file) => String(file ?? '').trim()).filter(Boolean);
  return list.join(' / ');
}

function setPageFileMetric(
  page: PageKey,
  selector: string,
  files: string | Array<string | null | undefined> | null | undefined,
  label: string,
) {
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
    ?.querySelectorAll<HTMLElement>(
      '[data-page-source-file-name], [data-page-result-file-name], [data-page-source-files-name]',
    )
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
  if (workflowUpdateModal.isWorkflowUpdatePage(page)) {
    workflowUpdateModal.rememberPageData(page, response);
  }
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

/** Keys of the `main` namespace in src/client/texts.ts. */
type UiTextKey = TextKey<'main'>;

type LanguageBinding =
  | { kind: 'text'; selector: string; key: UiTextKey }
  | { kind: 'allText'; selector: string; key: UiTextKey | '' }
  | { kind: 'button'; id: string; key: UiTextKey }
  | { kind: 'option'; id: string; value: string; key: UiTextKey }
  | { kind: 'placeholder'; id: string; key: UiTextKey }
  | { kind: 'hero'; page: PageKey; key: UiTextKey }
  | { kind: 'searchLabels'; page: PageKey; keys: UiTextKey[] }
  | { kind: 'pageTitle'; selector: string; page: PageKey };

/**
 * Declarative map of "when the language changes, write this copy into these nodes".
 *
 * applyLanguage() used to be ~150 hand-written DOM statements, so every new label meant another
 * line buried in the middle of it. These entries are applied in order by applyLanguageBindings();
 * the imperative tail of applyLanguage() keeps only what depends on live state (editing mode, the
 * transposed transfer-plan table, pagination re-renders).
 */
const LANGUAGE_BINDINGS: LanguageBinding[] = [
  { kind: 'text', selector: '.nav-section-label', key: 'devTools' },
  { kind: 'text', selector: '#btnAccountPage', key: 'account' },
  { kind: 'text', selector: '#btnLogout', key: 'logout' },
  { kind: 'hero', page: 'esop-detail', key: 'esopHeroText' },
  { kind: 'hero', page: 'grant-record', key: 'grantHeroText' },
  { kind: 'hero', page: 'exercise-record', key: 'exerciseHeroText' },
  { kind: 'hero', page: 'sold-shares', key: 'soldHeroText' },
  { kind: 'hero', page: 'transfer-plan', key: 'transferHeroText' },
  { kind: 'hero', page: 'employee-management', key: 'employeeHeroText' },
  { kind: 'hero', page: 'plan-summary', key: 'planHeroText' },
  { kind: 'hero', page: 'five-percent-holders', key: 'holdersHeroText' },
  { kind: 'hero', page: 'docs', key: 'docsHeroText' },
  { kind: 'hero', page: 'captable', key: 'captableHeroText' },
  { kind: 'allText', selector: '.product-page-hero__metric > span', key: 'sourceFile' },
  { kind: 'allText', selector: '[data-page-file-label="source-files"]', key: 'sourceFiles' },
  { kind: 'allText', selector: '[data-page-file-label="result-file"]', key: 'resultFile' },
  { kind: 'button', id: 'btnExport', key: 'export' },
  { kind: 'button', id: 'btnEditTransferPlan', key: 'edit' },
  { kind: 'button', id: 'btnSaveTransferPlanEdit', key: 'confirmAndRun' },
  { kind: 'button', id: 'btnCancelTransferPlanEdit', key: 'cancel' },
  { kind: 'button', id: 'btnAddEmployeesPage', key: 'newEmployee' },
  { kind: 'button', id: 'btnManageEmployeeLabels', key: 'manageLabels' },
  { kind: 'text', selector: '#btnCancelWorkflowUpdateModal', key: 'cancel' },
  { kind: 'text', selector: '#btnConfirmWorkflowUpdate', key: 'confirmAndRun' },
  { kind: 'text', selector: '#workflowUpdateProgressLabel', key: 'workflowProgress' },
  { kind: 'button', id: 'btnAddEmployeeLabel', key: 'newTag' },
  { kind: 'text', selector: '#employeeLabelManagementModal .modal-title', key: 'labelManagementTitle' },
  { kind: 'text', selector: '#employeeLabelManagementModal .modal-subtitle', key: 'employeeLabelModalSubtitle' },
  { kind: 'allText', selector: '[data-close="employeeLabelManagementModal"].btn', key: 'close' },
  { kind: 'allText', selector: '#employeesPageModal [data-close="employeesPageModal"].btn', key: 'cancel' },
  { kind: 'text', selector: '#btnSubmitEmployeesPage', key: 'save' },
  { kind: 'allText', selector: '#employeesMergeModal [data-close="employeesMergeModal"].btn', key: 'cancel' },
  { kind: 'text', selector: '#btnSubmitEmployeesMerge', key: 'link' },
  { kind: 'searchLabels', page: 'captable', keys: ['month'] },
  { kind: 'searchLabels', page: 'grant-record', keys: ['search', 'tag', 'incentiveType'] },
  { kind: 'searchLabels', page: 'exercise-record', keys: ['search', 'tag', 'grantYear'] },
  { kind: 'searchLabels', page: 'sold-shares', keys: ['search', 'tag', 'employmentStatus'] },
  { kind: 'searchLabels', page: 'employee-management', keys: ['search', 'tag'] },
  { kind: 'option', id: 'capitalizationSourceFile', value: '', key: 'defaultSnapshot' },
  { kind: 'option', id: 'filterGrantType', value: '', key: 'allTypes' },
  { kind: 'option', id: 'filterHoldingsTag', value: '', key: 'allTags' },
  { kind: 'option', id: 'filterExerciseTag', value: '', key: 'allTags' },
  { kind: 'option', id: 'filterSoldSharesTag', value: '', key: 'allTags' },
  { kind: 'option', id: 'filterEmployeesPageTag', value: '', key: 'allTags' },
  { kind: 'text', selector: '#settingsLanguageTitle', key: 'language' },
  { kind: 'text', selector: '#settingsLanguageSubtitle', key: 'languageSubtitle' },
  { kind: 'text', selector: '#settingsLanguageLabel', key: 'uiLanguage' },
  { kind: 'text', selector: '#page-settings .settings-quick-card:nth-of-type(2) .card-title', key: 'colorTheme' },
  {
    kind: 'text',
    selector: '#page-settings .settings-quick-card:nth-of-type(2) .card-subtitle',
    key: 'colorThemeSubtitle',
  },
  {
    kind: 'text',
    selector: '#page-settings .settings-quick-card:nth-of-type(2) .settings-placeholder__label',
    key: 'colorScheme',
  },
  { kind: 'text', selector: '#page-account .card-title', key: 'accountInfo' },
  { kind: 'text', selector: '#page-account .card-subtitle', key: 'accountInfoSubtitle' },
  { kind: 'text', selector: '#btnOpenChangePasswordModal', key: 'changePassword' },
  { kind: 'text', selector: '#btnSaveAccountProfile', key: 'saveAccount' },
  { kind: 'text', selector: '#accountPasswordModal .modal-title', key: 'changePassword' },
  { kind: 'text', selector: '#accountPasswordModal .card-subtitle', key: 'changePasswordSubtitle' },
  { kind: 'text', selector: '#btnChangeAccountPassword', key: 'updatePassword' },
  { kind: 'allText', selector: '[data-close="accountPasswordModal"].btn', key: 'cancel' },
  { kind: 'text', selector: '#page-user-management .card-subtitle', key: 'userManagementSubtitle' },
  { kind: 'text', selector: '#btnOpenManagedUserModal', key: 'newUser' },
  { kind: 'allText', selector: '[data-close="managedUserModal"].btn', key: 'cancel' },
  { kind: 'option', id: 'managedUserIsActive', value: 'true', key: 'active' },
  { kind: 'option', id: 'managedUserIsActive', value: 'false', key: 'inactive' },
  { kind: 'text', selector: 'label.auth-field span', key: 'authUsername' },
  { kind: 'text', selector: '#btnCloseLinkModalFooter', key: 'close' },
  { kind: 'text', selector: '#page-plan-summary .card-subtitle', key: 'planSummarySubtitle' },
  { kind: 'text', selector: '#page-fixed-value .card-title', key: 'globalParameterTitle' },
  { kind: 'allText', selector: '.pagination-size-label-text', key: 'rows' },
  { kind: 'allText', selector: '[id$="FirstPage"]', key: 'first' },
  { kind: 'allText', selector: '[id$="PrevPage"]', key: 'previous' },
  { kind: 'allText', selector: '[id$="NextPage"]', key: 'next' },
  { kind: 'allText', selector: '[id$="LastPage"]', key: 'last' },
  { kind: 'button', id: 'btnSearchHoldings', key: 'search' },
  { kind: 'button', id: 'btnSearchExercises', key: 'search' },
  { kind: 'button', id: 'btnSearchSoldShares', key: 'search' },
  { kind: 'button', id: 'btnSearchEmployeesPage', key: 'search' },
  { kind: 'pageTitle', selector: '#page-user-management .card-title', page: 'user-management' },
  { kind: 'pageTitle', selector: '#page-plan-summary .card-title', page: 'plan-summary' },
  { kind: 'pageTitle', selector: '#page-five-percent-holders .card-title', page: 'five-percent-holders' },
  { kind: 'allText', selector: '#page-account label', key: '' },

  {
    kind: 'placeholder',
    id: 'searchHolder',
    key: 'placeholderSearchHolder',
  },
  {
    kind: 'placeholder',
    id: 'filterHoldingsTag',
    key: 'placeholderFilterHoldingsTag',
  },
  {
    kind: 'placeholder',
    id: 'searchExercises',
    key: 'placeholderSearchExercises',
  },
  {
    kind: 'placeholder',
    id: 'searchSoldShares',
    key: 'placeholderSearchSoldShares',
  },
  { kind: 'placeholder', id: 'filterEmployeesPageTag', key: 'placeholderFilterEmployeesPageTag' },
  { kind: 'placeholder', id: 'accountEmail', key: 'placeholderAccountEmail' },
  { kind: 'placeholder', id: 'accountPhone', key: 'placeholderAccountPhone' },
  {
    kind: 'placeholder',
    id: 'managedUserUsername',
    key: 'placeholderManagedUserUsername',
  },
  { kind: 'placeholder', id: 'managedUserDisplayName', key: 'placeholderManagedUserDisplayName' },
  { kind: 'placeholder', id: 'managedUserEmail', key: 'placeholderManagedUserEmail' },
  { kind: 'placeholder', id: 'managedUserPhone', key: 'placeholderManagedUserPhone' },
  { kind: 'placeholder', id: 'searchEmployeesPage', key: 'placeholderSearchEmployeesPage' },
  { kind: 'placeholder', id: 'employeesPageNumber', key: 'placeholderEmployeesPageNumber' },
  { kind: 'placeholder', id: 'employeesMergeTargetNumber', key: 'placeholderEmployeesMergeTargetNumber' },
  { kind: 'placeholder', id: 'employeesPageName', key: 'placeholderEmployeesPageName' },
  { kind: 'placeholder', id: 'employeesPageUserId', key: 'placeholderEmployeesPageUserId' },
];

function applyLanguageBindings() {
  for (const binding of LANGUAGE_BINDINGS) {
    switch (binding.kind) {
      case 'text':
        setText(binding.selector, t(binding.key));
        break;
      case 'allText':
        setAllText(binding.selector, binding.key ? t(binding.key) : '');
        break;
      case 'button':
        setButtonLabel(binding.id, t(binding.key));
        break;
      case 'option':
        setOptionText(binding.id, binding.value, t(binding.key));
        break;
      case 'placeholder':
        setPlaceholder(binding.id, t(binding.key));
        break;
      case 'hero':
        setPageHero(binding.page, binding.key);
        break;
      case 'searchLabels':
        setSearchLabels(
          binding.page,
          binding.keys.map((key) => t(key)),
        );
        break;
      case 'pageTitle':
        setText(binding.selector, pageTitleFor(binding.page));
        break;
    }
  }
}

const t = (key: UiTextKey) => texts(key, currentLanguage);

/** Same as t(), with `{placeholder}` substitution for messages that carry a value. */
function tp(key: UiTextKey, params: Record<string, string | number>): string {
  return t(key).replace(/\{(\w+)\}/g, (_match, name: string) => String(params[name] ?? ''));
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

function setPageHero(page: PageKey, bodyKey: UiTextKey) {
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

function syncWorkflowActionLabels() {
  document
    .querySelectorAll<HTMLElement>('[data-workflow-update-page] [data-workflow-action-label]')
    .forEach((label) => {
      const button = label.closest<HTMLButtonElement>('[data-workflow-update-page]');
      if (button?.dataset.workflowUpdatePage === 'five-percent-holders' && fivePercentHoldersEditMode) {
        label.textContent = t('confirmAndRun');
        return;
      }
      label.textContent = t('update');
    });
  document
    .querySelectorAll<HTMLElement>('[data-workflow-export-page] [data-workflow-action-label]')
    .forEach((label) => {
      label.textContent = t('export');
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

  applyLanguageBindings();

  // Labels that depend on live page state stay imperative.
  setButtonLabel(
    'btnToggleTransferPlanTableView',
    transferPlanTableView === 'summaryRows' ? t('transposeTable') : t('restoreHorizontal'),
  );
  syncCurrentViewInfoText();

  setText('#page-user-management .card-title', pageTitleFor('user-management'));
  setText('#page-user-management .card-subtitle', t('userManagementSubtitle'));
  setText('#managedUserModalTitle', editingManagedUserId ? t('editUser') : t('createUser'));
  setText('#btnSubmitManagedUser', editingManagedUserId ? t('save') : t('createUser'));
  const userLabels = document.querySelectorAll<HTMLElement>('#managedUserModal .form-group label');
  [
    t('username'),
    t('displayName'),
    t('role'),
    t('email'),
    t('contact'),
    editingManagedUserId ? t('optionalPassword') : t('password'),
    t('status'),
  ].forEach((copy, index) => {
    if (userLabels[index]) userLabels[index].textContent = copy;
  });

  setText('label.auth-field span', t('authUsername'));
  const authLabels = document.querySelectorAll<HTMLElement>('.auth-field span');
  [t('authUsername'), t('authPassword'), t('authDisplayName'), t('authBootstrapSecret')].forEach((copy, index) => {
    if (authLabels[index]) authLabels[index].textContent = copy;
  });

  const accountLabels = document.querySelectorAll<HTMLElement>('#page-account .form-group label');
  [t('username'), t('displayName'), t('email'), t('contact')].forEach((copy, index) => {
    if (accountLabels[index]) accountLabels[index].textContent = copy;
  });
  const passwordLabels = document.querySelectorAll<HTMLElement>('#accountPasswordModal .form-group label');
  [t('currentPassword'), t('newPassword'), t('confirmNewPassword')].forEach((copy, index) => {
    if (passwordLabels[index]) passwordLabels[index].textContent = copy;
  });

  renderHoldingsPagination(holdingsPage, pageCountOf(holdingsTotal, holdingsPageSize), holdingsTotal);
  renderExercisePagination(exercisePage, pageCountOf(exerciseTotal, exercisePageSize), exerciseTotal);
  renderSoldSharesPagination(soldSharesPage, pageCountOf(soldSharesTotal, soldSharesPageSize), soldSharesTotal);
  renderEmployeesPagination(employeesPage, pageCountOf(employeesTotal, employeesPageSize), employeesTotal);
  renderUserManagementTable();

  const activePage = getPageFromLocation();
  el('pageTitle').textContent = pageTitleFor(activePage);
  el('authSubmit').textContent = authStatus?.bootstrapRequired ? t('createAndLogin') : t('login');
  el('sidebarToggle').setAttribute('aria-label', sidebarCollapsed ? t('expandSidebar') : t('collapseSidebar'));
  syncLanguageButtons();
  renderThemeCards();
  applyStaticTranslations(document, currentLanguage);
  syncWorkflowActionLabels();
}

function localizeAppDom() {
  applyStaticTranslations(document, currentLanguage);
  syncWorkflowActionLabels();
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

/**
 * Shared request core: session cookie, JSON content type for non-form bodies, 401 -> re-auth, and
 * `{ error }` payloads surfaced as thrown messages. `api`/`apiBinary` only differ in how they read
 * a successful response.
 */
async function request(url: string, options: RequestInit = {}): Promise<Response> {
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
  return response;
}

async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await request(url, options);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

async function apiBinary(url: string, options: RequestInit = {}): Promise<ArrayBuffer> {
  return (await request(url, options)).arrayBuffer();
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

function linkedBadge(row: { linkedIdentities?: Array<{ source: string; employeeId: string; name: string }> }): string {
  return buildLinkedBadge(row.linkedIdentities, currentLanguage, escapeHtml);
}

function formatTagChips(labels: Array<{ name: string; color: string }>, fallbackTags: string[] = []): string {
  const visibleLabels = labels.length
    ? labels
    : fallbackTags.map((name) => ({ name, color: DEFAULT_EMPLOYEE_LABEL_COLOR }));
  return visibleLabels.length
    ? `<div class="employee-table-tag-list">${visibleLabels
        .map(
          (label) =>
            `<span class="employee-table-tag"${employeeLabelStyle(label.color)}>${escapeHtml(label.name)}</span>`,
        )
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
  el('themeColorOptions').innerHTML = COLOR_OPTIONS.map((option) => {
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
  }).join('');

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
  el('pageTitle').textContent = pageTitleFor(targetPage);
  el('monthlyRunTopbarMonth')?.classList.toggle('hidden', targetPage !== 'monthlyrun');
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
      if (currentMonth) await renderPlanSummaryPage(currentMonth);
    }

    if (page === 'five-percent-holders') {
      await renderFivePercentHoldersPage();
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
  el('modalTitle').textContent = 'Input Files';
  el('monthlyRunSourcesBody').innerHTML = '<tr><td colspan="5" class="table-empty-cell">正在加载输入定义...</td></tr>';
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
  availableMonthOptions = sortAvailableMonths(months);
  currentMonth = resolveDefaultSummaryMonth(
    availableMonthOptions.map((item) => item.month),
    latestOutputResponse.output,
  );
  renderMonthPicker('monthPicker', currentMonth, 'hasCapTableData');
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

function initPlanSummaryPage() {
  renderMonthPicker('planSummaryMonthPicker', currentMonth, 'hasPlanSummaryData');
  const picker = el<HTMLInputElement>('planSummaryMonthPicker');
  picker.value = currentMonth;
  picker.addEventListener('change', () => {
    const month = picker.value;
    if (!month) {
      notify('请选择月份', { type: 'warning' });
      return;
    }
    currentMonth = month;
    renderMonthPicker('planSummaryMonthPicker', month, 'hasPlanSummaryData');
    void renderPlanSummaryPage(month);
  });
  el('btnOpenMonthlyUpdateFromPlanSummary').addEventListener('click', () => {
    void navigateToPage('monthly');
  });
  if (getPageFromLocation() === 'plan-summary' && currentMonth) {
    void renderPlanSummaryPage(currentMonth);
  }
}

async function fetchAvailableMonths(): Promise<AvailableMonth[]> {
  const data = await api<{ months: AvailableMonth[] }>('/api/months');
  availableMonthOptions = sortAvailableMonths(data.months);
  return availableMonthOptions;
}

function renderMonthPicker(inputId: string, selectedMonth: string, dataKey: 'hasCapTableData' | 'hasPlanSummaryData') {
  const picker = el<HTMLInputElement>(inputId);
  const control = picker.closest<HTMLElement>('.month-picker-control');
  const trigger = control?.querySelector<HTMLButtonElement>('.month-picker-trigger');
  const label = control?.querySelector<HTMLElement>('.month-picker-trigger span');
  const panel = control?.querySelector<HTMLElement>('.month-picker-panel');
  picker.value = selectedMonth;
  if (!control || !trigger || !label || !panel) return;
  label.textContent = formatMonthCN(selectedMonth);
  const selected = availableMonthOptions.find((item) => item.month === selectedMonth);
  trigger.classList.toggle('month-has-data', Boolean(selected?.[dataKey]));
  const grouped = new Map<string, AvailableMonth[]>();
  availableMonthOptions.forEach((item) => {
    const year = item.month.slice(0, 4);
    const list = grouped.get(year) ?? [];
    list.push(item);
    grouped.set(year, list);
  });
  panel.innerHTML = [...grouped.entries()]
    .map(
      ([year, months]) => `
    <section class="month-picker-year"><strong>${year}</strong><div class="month-picker-grid">
      ${months
        .map((item) => {
          const hasData = Boolean(item[dataKey]);
          const isSelected = item.month === selectedMonth;
          return `<button type="button" class="month-picker-option${hasData ? ' has-data' : ''}${isSelected ? ' is-selected' : ''}" data-month-value="${item.month}" aria-pressed="${isSelected}" title="${hasData ? '有可用数据' : '暂无可用数据'}">${Number(item.month.slice(5))}月${hasData ? '<span aria-hidden="true">✓</span>' : ''}</button>`;
        })
        .join('')}
    </div></section>`,
    )
    .join('');
  if (trigger.dataset.bound !== 'true') {
    trigger.dataset.bound = 'true';
    trigger.addEventListener('click', () => {
      panel.classList.toggle('hidden');
      trigger.setAttribute('aria-expanded', String(!panel.classList.contains('hidden')));
    });
    panel.addEventListener('click', (event) => {
      const target = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-month-value]');
      if (!target) return;
      const month = target.dataset.monthValue ?? '';
      panel.classList.add('hidden');
      trigger.setAttribute('aria-expanded', 'false');
      if (month) {
        picker.value = month;
        picker.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
  }
}

function renderEmptySummaryPage(message: string) {
  currentSummary = null;
  resetActivePageSourceFile();
  getCurrentMonthTextNode().textContent = t('noSummaryData');
  el('eomDate').textContent = '-';
  el('reconciliationBody').innerHTML = `<tr><td colspan="5" class="table-empty-cell">${escapeHtml(message)}</td></tr>`;
  el('capitalizationBody').innerHTML = `<tr><td colspan="6" class="table-empty-cell">${escapeHtml(message)}</td></tr>`;
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

const CAPITALIZATION_DELTA_ICONS = {
  up: '<svg class="cap-delta__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>',
  down: '<svg class="cap-delta__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>',
} as const;

function renderCapitalizationDeltaCell(delta: CapitalizationDelta): string {
  if (delta.direction === 'none') return '<td class="col-delta"></td>';
  if (delta.direction === 'flat') return '<td class="col-delta cap-delta--flat">–</td>';
  return `<td class="col-delta cap-delta--${delta.direction}">${CAPITALIZATION_DELTA_ICONS[delta.direction]}<span class="cap-delta__text">${escapeHtml(delta.text)}</span></td>`;
}

/** Loads the baseline month used for month-over-month deltas. Never rejects: no baseline just means no deltas. */
async function loadBaselineSummary(baselineMonth: string | null): Promise<SummarySnapshot | null> {
  if (!baselineMonth) return null;
  if (baselineSummaryCache?.month === baselineMonth) return baselineSummaryCache.data;
  try {
    const data = await api<SummarySnapshot>(`/api/months/${baselineMonth}/summary`);
    baselineSummaryCache = { month: baselineMonth, data };
  } catch {
    baselineSummaryCache = { month: baselineMonth, data: null };
  }
  return baselineSummaryCache.data;
}

async function renderSummaryPage(month: string) {
  try {
    currentMonth = month;
    renderMonthPicker('monthPicker', month, 'hasCapTableData');
    const availableMonths = await fetchAvailableMonths();
    const [data, baselineSummary] = await Promise.all([
      api<SummarySnapshot>(`/api/months/${month}/summary`),
      loadBaselineSummary(
        resolveBaselineMonth(
          availableMonths.map((item) => item.month),
          month,
        ),
      ),
    ]);
    const capitalization = normalizeCapitalizationRows(data.capitalization, data.fixedValues?.seriesBPreferredStock);
    currentSummary = { ...data, capitalization };
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

    const baselineIndex = indexCapitalizationRows(
      normalizeCapitalizationRows(
        baselineSummary?.capitalization ?? [],
        baselineSummary?.fixedValues?.seriesBPreferredStock,
      ),
    );
    const capBody = el('capitalizationBody');
    capBody.innerHTML = capitalization
      .map((item) => {
        if (item.type === 'cat-header-blue' || item.type === 'cat-header-gray') {
          return `<tr class="cat-header-blue"><td></td><td colspan="5" style="text-align:left;">${escapeHtml(item.description)}</td></tr>`;
        }
        const deltas = computeCapitalizationRowDeltas(item, findComparableRow(baselineIndex, item));
        if (item.type === 'cat-sub-label') {
          const sharesHtml =
            item.shares === undefined
              ? ''
              : item.highlightShares
                ? `<span class="highlight-yellow">${formatNumber(item.shares)}</span>`
                : formatNumber(item.shares);
          return `<tr class="cat-sub-label">
            <td></td><td style="text-align:left;">${escapeHtml(item.description)}</td>
            <td class="col-number">${sharesHtml}</td>${renderCapitalizationDeltaCell(deltas.shares)}
            <td></td>${renderCapitalizationDeltaCell(deltas.percent)}
          </tr>`;
        }
        const percent = formatCapitalizationPercent(item.percent);
        const isTotalRow = isTotalFullyDilutedRow(item.description);
        return `<tr class="${isTotalRow ? 'total-row-blue' : 'cap-data-row'}">
          <td>${escapeHtml(item.number ?? '')}</td>
          <td style="text-align:left;${isTotalRow ? ' font-weight:var(--font-bold);' : ''}">${escapeHtml(item.description)}</td>
          <td class="col-number"${isTotalRow ? ' style="font-weight:var(--font-bold);"' : ''}>${formatNumber(item.shares)}</td>${renderCapitalizationDeltaCell(deltas.shares)}
          <td class="col-percent"${isTotalRow ? ' style="font-weight:var(--font-bold);"' : ''}>${percent}</td>${renderCapitalizationDeltaCell(deltas.percent)}
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
    el('reconciliationBody').innerHTML =
      `<tr><td colspan="5" class="table-empty-cell">${escapeHtml(message)}</td></tr>`;
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
    ...summarySourceFiles.map(
      (file) => `<option value="${file.id}">${escapeHtml(productFileDisplayName(file))}</option>`,
    ),
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
    baselineSummaryCache = null;
    await renderSummaryPage(targetMonth);
  } catch (error) {
    notify((error as Error).message, { type: 'error' });
    baselineSummaryCache = null;
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
      if (!(await confirmAction('确定删除此备注吗？', { title: '删除备注', confirmText: '删除', tone: 'danger' })))
        return;
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
  toggle.setAttribute('title', monthlyRunInputCollapsed ? 'Expand Input Files' : 'Collapse Input Files');
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
  await api<{ instance: MonthlyRunInstanceRecord }>('/api/monthly-runs/instances', {
    method: 'POST',
    body: JSON.stringify({ month }),
  });
  el('addPlanModal').classList.add('hidden');
  await renderMonthlyPage('');
}

async function renderMonthlyPage(filterMonth: string) {
  const data = await api<{ items: MonthlyRunInstanceRecord[] }>(
    `/api/monthly-runs/instances${filterMonth ? `?month=${encodeURIComponent(filterMonth)}` : ''}`,
  );
  updatePlans = data.items;
  el('planTotalCount').textContent = String(updatePlans.length);
  el('planCompletedCount').textContent = String(
    updatePlans.filter((plan) => plan.status === 'completed' || plan.status === 'completed_with_warnings').length,
  );
  el('planInProgressCount').textContent = String(updatePlans.filter((plan) => plan.status === 'running').length);
  el('planPendingCount').textContent = String(
    updatePlans.filter((plan) => plan.status === 'draft' || plan.status === 'waiting_approval').length,
  );

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
  tbody
    .querySelectorAll<HTMLElement>('[data-action="view"]')
    .forEach((button) => button.addEventListener('click', () => void openMonthlyRunPlan(Number(button.dataset.id))));
  tbody
    .querySelectorAll<HTMLElement>('[data-action="delete"]')
    .forEach((button) => button.addEventListener('click', () => void deleteUpdatePlan(Number(button.dataset.id))));
  localizeAppDom();
}

async function deleteUpdatePlan(id: number) {
  const plan = updatePlans.find((item) => item.id === id);
  if (!plan) return;
  const confirmed = await confirmAction(
    `确定删除【${plan.monthKey}】的月度更新计划吗？将同时永久删除该月的输入文件、输出文件及全部历史执行记录，此操作不可撤销。`,
    { title: '删除月度更新计划', confirmText: '删除', tone: 'danger' },
  );
  if (!confirmed) return;
  try {
    const { deleted } = await api<{ deleted: MonthlyRunPlanDeleteResult }>(`/api/monthly-runs/instances/${id}`, {
      method: 'DELETE',
    });
    await renderMonthlyPage('');
    notify(
      `已删除【${deleted.monthKey}】：输入文件 ${deleted.deletedInputFileCount} 个、输出文件 ${deleted.deletedOutputFileIds.length} 个、历史记录 ${deleted.deletedHistoryCount} 条`,
      { type: 'success' },
    );
  } catch (error) {
    notify(error instanceof Error ? error.message : '删除月度更新计划失败', { type: 'error' });
  }
}

async function initHoldingsPage() {
  await loadEmployeeLabels();
  await renderHoldingsPage(currentMonth);
  el('btnSearchHoldings').addEventListener('click', searchHoldingsPage);
  el<HTMLSelectElement>('filterHoldingsTag').addEventListener('change', searchHoldingsPage);
  el<HTMLSelectElement>('filterGrantType').addEventListener('change', searchHoldingsPage);
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
  document.querySelectorAll<HTMLButtonElement>('[data-exercise-view]').forEach((button) => {
    button.addEventListener('click', () => {
      const view = button.dataset.exerciseView as ExerciseView;
      if (view === activeExerciseView) return;
      activeExerciseView = view;
      exercisePage = 1;
      applyExerciseView();
      void renderExerciseRecords();
    });
  });
  applyExerciseView();
}

function initWorkflowUpdateModal() {
  document.querySelectorAll<HTMLButtonElement>('[data-workflow-update-page]').forEach((button) => {
    button.addEventListener('click', () => {
      const page = button.dataset.workflowUpdatePage ?? '';
      if (!workflowUpdateModal.isWorkflowUpdatePage(page)) return;
      if (page === 'five-percent-holders') {
        void handleFivePercentHoldersUpdateClick();
        return;
      }
      void workflowUpdateModal.openModal(page);
    });
  });
  document.querySelectorAll<HTMLButtonElement>('[data-workflow-export-page]').forEach((button) => {
    button.addEventListener('click', () => {
      const page = button.dataset.workflowExportPage ?? '';
      if (!workflowUpdateModal.isWorkflowUpdatePage(page)) return;
      workflowUpdateModal.downloadResultFiles(page);
    });
  });
  el('btnCancelFivePercentHoldersEdit').addEventListener('click', () => void cancelFivePercentHoldersEdit());
  workflowUpdateModal.bindEvents();
}

async function initExercisePage() {
  await renderExerciseRecords();
  el('btnSearchExercises').addEventListener('click', searchExercises);
  el<HTMLSelectElement>('filterExerciseTag').addEventListener('change', searchExercises);
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
  el<HTMLSelectElement>('filterSoldSharesTag').addEventListener('change', searchSoldShares);
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
  el('btnEditTransferPlan').addEventListener('click', () => {
    transferPlanEditMode = true;
    void renderTransferPlan();
  });
  el('btnCancelTransferPlanEdit').addEventListener('click', () => {
    transferPlanEditMode = false;
    void renderTransferPlan();
  });
  el('btnSaveTransferPlanEdit').addEventListener('click', () => void saveTransferPlanEdit());
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
    editingEmployeeLabelIds = editingEmployeeLabelIds.filter(
      (id) => id !== Number(button.dataset.removeEmployeeLabelId),
    );
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
  document
    .querySelectorAll<HTMLElement>('#employeesPageTable [data-employees-sort]')
    .forEach((header) =>
      header.addEventListener('click', () => toggleEmployeesSort(header.dataset.employeesSort as 'name' | 'empNo')),
    );
  document
    .querySelectorAll<HTMLElement>('[data-grant-sort]')
    .forEach((header) =>
      header.addEventListener('click', () => toggleGrantSort(header.dataset.grantSort as 'name' | 'empNo')),
    );
  document
    .querySelectorAll<HTMLElement>('[data-exercise-sort]')
    .forEach((header) =>
      header.addEventListener('click', () => toggleExerciseSort(header.dataset.exerciseSort as 'name' | 'empNo')),
    );
  document
    .querySelectorAll<HTMLElement>('[data-sold-sort]')
    .forEach((header) =>
      header.addEventListener('click', () => toggleSoldSharesSort(header.dataset.soldSort as 'name' | 'empNo')),
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
  body.innerHTML = managedUsers
    .map(
      (user) => `
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
  `,
    )
    .join('');

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
    ? currentLanguage === 'zh-CN'
      ? '留空密码则不修改'
      : 'Leave password blank to keep it unchanged'
    : currentLanguage === 'zh-CN'
      ? '默认角色为 user'
      : 'Default role is user';
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
    notify(t('usernameAndDisplayNameRequired'), {
      type: 'warning',
    });
    return;
  }
  if (!editingManagedUserId) {
    if (!password) {
      notify(t('newUserPasswordRequired'), {
        type: 'warning',
      });
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
    managedUsers =
      index >= 0
        ? managedUsers.map((user) => (user.id === response.user.id ? response.user : user))
        : [...managedUsers, response.user];
    closeManagedUserModal();
    renderUserManagementTable();
    notify(t('userSaved'), { type: 'success' });
  } catch (error) {
    notify((error as Error).message, { type: 'error' });
  }
}

async function deleteUserManagementUser(userId: number) {
  const user = managedUsers.find((item) => item.id === userId);
  if (!user) return;
  const confirmed = await confirmAction(tp('confirmDeleteUser', { username: user.username }), {
    title: t('delete'),
    confirmText: t('delete'),
    tone: 'danger',
  });
  if (!confirmed) return;
  try {
    await api(`/api/admin/users/${userId}`, { method: 'DELETE' });
    managedUsers = managedUsers.filter((item) => item.id !== userId);
    renderUserManagementTable();
    notify(t('userDeleted'), { type: 'success' });
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

function pageCountOf(total: number, pageSize: number) {
  return Math.max(1, Math.ceil(total / pageSize));
}

function paginationSummaryText(start: number, end: number, total: number, unit: 'records' | 'employees') {
  if (currentLanguage === 'zh-CN') {
    const noun = unit === 'employees' ? '名员工' : '条记录';
    return total === 0 ? `共 0 ${noun}` : `显示 ${start}-${end}，共 ${total} ${noun}`;
  }
  return total === 0 ? `0 ${unit}` : `Showing ${start}-${end} of ${total} ${unit}`;
}

const PAGINATION_IDS = {
  holdings: {
    summary: 'holdingsPaginationSummary',
    page: 'holdingsPaginationPage',
    first: 'btnHoldingsFirstPage',
    prev: 'btnHoldingsPrevPage',
    next: 'btnHoldingsNextPage',
    last: 'btnHoldingsLastPage',
  },
  employees: {
    summary: 'employeesPaginationSummary',
    page: 'employeesPaginationPage',
    first: 'btnEmployeesFirstPage',
    prev: 'btnEmployeesPrevPage',
    next: 'btnEmployeesNextPage',
    last: 'btnEmployeesLastPage',
  },
  exercises: {
    summary: 'exercisePaginationSummary',
    page: 'exercisePaginationPage',
    first: 'btnExercisesFirstPage',
    prev: 'btnExercisesPrevPage',
    next: 'btnExercisesNextPage',
    last: 'btnExercisesLastPage',
  },
  soldShares: {
    summary: 'soldSharesPaginationSummary',
    page: 'soldSharesPaginationPage',
    first: 'btnSoldSharesFirstPage',
    prev: 'btnSoldSharesPrevPage',
    next: 'btnSoldSharesNextPage',
    last: 'btnSoldSharesLastPage',
  },
} as const satisfies Record<string, PaginationIds>;

function renderHoldingsPagination(page: number, totalPages: number, total: number) {
  const view = paginationView({ page, pageSize: holdingsPageSize, total, totalPages });
  renderPaginationControls(
    el,
    PAGINATION_IDS.holdings,
    view,
    paginationSummaryText(view.start, view.end, total, 'records'),
  );
}

function renderEmployeesPagination(page: number, totalPages: number, total: number) {
  const view = paginationView({ page, pageSize: employeesPageSize, total, totalPages });
  renderPaginationControls(
    el,
    PAGINATION_IDS.employees,
    view,
    paginationSummaryText(view.start, view.end, total, 'employees'),
  );
}

function renderExercisePagination(page: number, totalPages: number, total: number) {
  const view = paginationView({ page, pageSize: exercisePageSize, total, totalPages });
  renderPaginationControls(
    el,
    PAGINATION_IDS.exercises,
    view,
    paginationSummaryText(view.start, view.end, total, 'records'),
  );
}

function renderSoldSharesPagination(page: number, totalPages: number, total: number) {
  const view = paginationView({ page, pageSize: soldSharesPageSize, total, totalPages });
  renderPaginationControls(
    el,
    PAGINATION_IDS.soldShares,
    view,
    paginationSummaryText(view.start, view.end, total, 'records'),
  );
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
  const next = nextPageWithinBounds(exerciseTotal, exercisePageSize, exercisePage, delta);
  if (next === null) return;
  exercisePage = next;
  void renderExerciseRecords();
}

function goToExercisePage(target: 'first' | 'last') {
  const next = edgePage(exerciseTotal, exercisePageSize, exercisePage, target);
  if (next === null) return;
  exercisePage = next;
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
  const next = nextPageWithinBounds(soldSharesTotal, soldSharesPageSize, soldSharesPage, delta);
  if (next === null) return;
  soldSharesPage = next;
  void renderExerciseRecords();
}

function goToSoldSharesPage(target: 'first' | 'last') {
  const next = edgePage(soldSharesTotal, soldSharesPageSize, soldSharesPage, target);
  if (next === null) return;
  soldSharesPage = next;
  void renderExerciseRecords();
}

function changeSoldSharesPageSize(size: number) {
  if (size === soldSharesPageSize) return;
  soldSharesPageSize = size;
  soldSharesPage = 1;
  void renderExerciseRecords();
}

function applyGrantView() {
  const viewCopy: Record<GrantView, { title: string; subtitle: string }> = {
    futu: {
      title: 'Futu Grant Record',
      subtitle: t('rawFutuGrantData'),
    },
    shareworks: {
      title: 'Shareworks Grant Record',
      subtitle: t('rawOptionsOsDetail'),
    },
    merge: {
      title: 'Merged Grant Record',
      subtitle: t('standardizedFutuShareworksMerge'),
    },
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
  el<HTMLSelectElement>('filterHoldingsTag').disabled = false;
  localizeAppDom();
}

function applyExerciseView() {
  const viewCopy: Record<ExerciseView, { title: string; subtitle: string }> = {
    futu: {
      title: 'Futu Exercise Records',
      subtitle: t('rawFutuBciExercises'),
    },
    shareworks: {
      title: 'Shareworks Exec Option OS',
      subtitle:
        currentLanguage === 'zh-CN'
          ? 'Executive Awards OS Only 原始格式（逐授予）'
          : 'Raw Executive Awards OS Only (per grant)',
    },
    merge: {
      title: 'Merged Exercise Records',
      subtitle:
        currentLanguage === 'zh-CN'
          ? 'Futu 行权流水 + Shareworks 逐授予拼接'
          : 'Futu exercise transactions + Shareworks per-grant rows',
    },
  };
  document.querySelectorAll<HTMLButtonElement>('[data-exercise-view]').forEach((button) => {
    const active = button.dataset.exerciseView === activeExerciseView;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  (['futu', 'shareworks', 'merge'] as ExerciseView[]).forEach((view) => {
    el(`exercisePanel-${view}`).classList.toggle('hidden', view !== activeExerciseView);
  });
  el('exerciseViewTitle').textContent = viewCopy[activeExerciseView].title;
  el('exerciseViewSubtitle').textContent = viewCopy[activeExerciseView].subtitle;
  // Grant Year filter is Futu-only (Shareworks/merge rows have no per-transaction exercise semantics).
  el<HTMLSelectElement>('filterExerciseGrantYear').disabled = activeExerciseView !== 'futu';
  localizeAppDom();
}

function changeHoldingsPage(delta: number) {
  const next = nextPageWithinBounds(holdingsTotal, holdingsPageSize, holdingsPage, delta);
  if (next === null) return;
  holdingsPage = next;
  void renderHoldingsPage(currentMonth);
}

function goToHoldingsPage(target: 'first' | 'last') {
  const next = edgePage(holdingsTotal, holdingsPageSize, holdingsPage, target);
  if (next === null) return;
  holdingsPage = next;
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
  const next = nextPageWithinBounds(employeesTotal, employeesPageSize, employeesPage, delta);
  if (next === null) return;
  employeesPage = next;
  void loadEmployeesPage();
}

function goToEmployeesPage(target: 'first' | 'last') {
  const next = edgePage(employeesTotal, employeesPageSize, employeesPage, target);
  if (next === null) return;
  employeesPage = next;
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
  const tagId = el<HTMLSelectElement>('filterHoldingsTag').value;
  const grantType = el<HTMLSelectElement>('filterGrantType').value;
  renderSortIndicators('#page-grant-record', grantSort);
  if (activeGrantView === 'shareworks') {
    const data = await api<PaginatedResult<ShareworksGrant>>(
      `/api/grants/shareworks?query=${encodeURIComponent(query)}&tagId=${encodeURIComponent(tagId)}&page=${holdingsPage}&pageSize=${holdingsPageSize}${sortQuery(grantSort)}`,
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
      `/api/grants/merge?query=${encodeURIComponent(query)}&tagId=${encodeURIComponent(tagId)}&page=${holdingsPage}&pageSize=${holdingsPageSize}${sortQuery(grantSort)}`,
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
    `/api/holdings?month=${month}&query=${encodeURIComponent(query)}&grantType=${encodeURIComponent(grantType)}&tagId=${encodeURIComponent(tagId)}&page=${holdingsPage}&pageSize=${holdingsPageSize}${sortQuery(grantSort)}`,
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
        <td style="text-align:left; font-weight:var(--font-semibold);">${escapeHtml(item.employeeName)}${linkedBadge(item)}</td>
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
        <td>${escapeHtml(item.employeeNumber)}${linkedBadge(item)}</td>
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
        <td style="text-align:left; font-weight:var(--font-semibold);">${escapeHtml(item.employeeName)}${linkedBadge(item)}</td>
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
  const tagId = el<HTMLSelectElement>('filterExerciseTag').value;
  if (activeExerciseView === 'shareworks') {
    await renderShareworksExercises(query, tagId);
    return;
  }
  if (activeExerciseView === 'merge') {
    await renderMergedExercises(query, tagId);
    return;
  }
  const grantYear = el<HTMLSelectElement>('filterExerciseGrantYear').value;
  renderSortIndicators('#exerciseTable', exerciseSort);
  const data = await api<PaginatedResult<ExerciseRecord>>(
    `/api/exercises?query=${encodeURIComponent(query)}&tagId=${encodeURIComponent(tagId)}&grantYear=${encodeURIComponent(grantYear)}&page=${exercisePage}&pageSize=${exercisePageSize}${sortQuery(exerciseSort)}`,
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
        <td style="text-align:left; font-weight:var(--font-semibold);">${escapeHtml(item.name)}${linkedBadge(item)}</td>
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

async function renderShareworksExercises(query: string, tagId: string) {
  const data = await api<PaginatedResult<ShareworksExercise>>(
    `/api/exercises/shareworks?query=${encodeURIComponent(query)}&tagId=${encodeURIComponent(tagId)}&page=${exercisePage}&pageSize=${exercisePageSize}`,
  );
  setWorkflowPageFiles('exercise-record', data);
  const items = data.items ?? [];
  exercisePage = data.page;
  exerciseTotal = data.total;
  renderExercisePagination(data.page, data.totalPages, data.total);
  const tbody = el('shareworksExerciseBody');
  if (items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="23" class="table-empty-cell">暂无符合条件的 Shareworks 记录</td></tr>';
    localizeAppDom();
    return;
  }
  tbody.innerHTML = items
    .map(
      (item, index) => `
      <tr>
        <td>${(data.page - 1) * data.pageSize + index + 1}</td>
        <td>${escapeHtml(item.lastName)}${linkedBadge(item)}</td>
        <td>${escapeHtml(item.firstName)}</td>
        <td>${escapeHtml(item.middleName)}</td>
        <td style="text-align:left;">${escapeHtml(item.planName)}</td>
        <td>${escapeHtml(item.grantType)}</td>
        <td>${escapeHtml(item.employeeGrantNumber)}</td>
        <td>${escapeHtml(item.grantDate)}</td>
        <td class="col-number">${formatNumber(item.sharesGranted)}</td>
        <td class="col-number">${item.exercisePricePerShare === null ? '-' : `$${Number(item.exercisePricePerShare).toFixed(2)}`}</td>
        <td>${escapeHtml(item.vestingSchedule)}</td>
        <td>${escapeHtml(item.vestingStartDate)}</td>
        <td>${escapeHtml(item.originalVestingStartDate)}</td>
        <td>${escapeHtml(item.expireDate)}</td>
        <td>${escapeHtml(item.earlyExerciseAllowed)}</td>
        <td class="col-number">${formatNumber(item.sharesVested)}</td>
        <td class="col-number">${formatNumber(item.sharesUnvested)}</td>
        <td class="col-number">${formatNumber(item.sharesExercisedReleased)}</td>
        <td class="col-number">${formatNumber(item.sharesSubjectToRepurchase)}</td>
        <td class="col-number">${formatNumber(item.sharesCancelledExpired)}</td>
        <td class="col-number">${formatNumber(item.sharesOutstanding)}</td>
        <td class="col-number">${formatNumber(item.outstandingVestedExercisable)}</td>
        <td class="col-number">${formatNumber(item.outstandingUnvested)}</td>
      </tr>`,
    )
    .join('');
  localizeAppDom();
}

async function renderMergedExercises(query: string, tagId: string) {
  const data = await api<PaginatedResult<MergedExercise>>(
    `/api/exercises/merge?query=${encodeURIComponent(query)}&tagId=${encodeURIComponent(tagId)}&page=${exercisePage}&pageSize=${exercisePageSize}`,
  );
  setWorkflowPageFiles('exercise-record', data);
  const items = data.items ?? [];
  exercisePage = data.page;
  exerciseTotal = data.total;
  renderExercisePagination(data.page, data.totalPages, data.total);
  const tbody = el('mergedExerciseBody');
  if (items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="23" class="table-empty-cell">暂无符合条件的合并记录</td></tr>';
    localizeAppDom();
    return;
  }
  tbody.innerHTML = items
    .map(
      (item, index) => `
      <tr>
        <td>${(data.page - 1) * data.pageSize + index + 1}</td>
        <td style="text-align:left; font-weight:var(--font-semibold);">${escapeHtml(item.employeeName)}${linkedBadge(item)}</td>
        <td>${escapeHtml(item.grantNumber)}</td>
        <td>${escapeHtml(item.employeeNumber)}</td>
        <td><span class="grant-source-badge grant-source-badge--${item.source.toLowerCase()}">${escapeHtml(item.source)}</span></td>
        <td>${escapeHtml(item.grantDate)}</td>
        <td class="col-number">${item.grantPriceUsd === null ? '-' : `$${Number(item.grantPriceUsd).toFixed(5)}`}</td>
        <td>${escapeHtml(item.exerciseDate)}</td>
        <td class="col-number">${formatNumber(item.orderedQuantity)}</td>
        <td class="col-number">${formatNumber(item.exercisedQuantity)}</td>
        <td class="col-number">${item.exerciseCostUsd === null ? '-' : `$${Number(item.exerciseCostUsd).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</td>
        <td class="col-number">${formatNumber(item.deductionSellingQuantity)}</td>
        <td class="col-number">${formatNumber(item.dealtQuantity)}</td>
        <td style="text-align:left;">${escapeHtml(item.planName)}</td>
        <td>${escapeHtml(item.grantType)}</td>
        <td>${escapeHtml(item.vestingSchedule)}</td>
        <td>${escapeHtml(item.vestingStartDate)}</td>
        <td>${escapeHtml(item.expireDate)}</td>
        <td class="col-number">${formatNumber(item.sharesGranted)}</td>
        <td class="col-number">${item.exercisePricePerShare === null ? '-' : `$${Number(item.exercisePricePerShare).toFixed(2)}`}</td>
        <td class="col-number">${formatNumber(item.sharesVested)}</td>
        <td class="col-number">${formatNumber(item.sharesUnvested)}</td>
        <td class="col-number">${formatNumber(item.sharesExercisedReleased)}</td>
        <td class="col-number">${formatNumber(item.sharesOutstanding)}</td>
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
  const tagId = el<HTMLSelectElement>('filterSoldSharesTag').value;
  const employmentStatus = el<HTMLSelectElement>('filterSoldSharesEmploymentStatus').value;
  renderSortIndicators('#soldSharesTable', soldSharesSort);
  const data = await api<PaginatedResult<SoldShare>>(
    `/api/sold-shares?query=${encodeURIComponent(query)}&tagId=${encodeURIComponent(tagId)}&employmentStatus=${encodeURIComponent(employmentStatus)}&page=${soldSharesPage}&pageSize=${soldSharesPageSize}${sortQuery(soldSharesSort)}`,
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
        <td style="text-align:left; font-weight:var(--font-semibold);">${escapeHtml(item.name)}${linkedBadge(item)}</td>
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
  el('transferPlanSourceName').textContent = data.sourceFileName;
  el('transferPlanInTotal').textContent = formatNumber(data.totals.inTotal);
  el('transferPlanCancelled').textContent = formatNumber(data.totals.cancelledQuantity);
  el('transferPlanTransferred').textContent = formatNumber(data.totals.transferToFutu);
  el('transferPlanDetailCount').textContent = formatNumber(data.detailCount);

  const table = renderTransferPlanSummaryTable(
    data,
    transferPlanTableView,
    { escapeHtml, formatNumber },
    {
      editable: transferPlanEditMode,
    },
  );
  el('transferPlanSummaryHead').innerHTML = table.headHtml;
  el('transferPlanSummaryBody').innerHTML = table.bodyHtml;
  el('transferPlanSummaryTable').classList.toggle(
    'table-transfer-plan--transposed',
    transferPlanTableView === 'periodRows',
  );
  el('btnEditTransferPlan').classList.toggle('hidden', transferPlanEditMode);
  el('btnSaveTransferPlanEdit').classList.toggle('hidden', !transferPlanEditMode);
  el('btnCancelTransferPlanEdit').classList.toggle('hidden', !transferPlanEditMode);
  document
    .querySelectorAll<HTMLElement>(
      '[data-workflow-update-page="transfer-plan"], [data-workflow-export-page="transfer-plan"]',
    )
    .forEach((button) => {
      button.classList.toggle('hidden', transferPlanEditMode);
    });
  el('transferPlanEditStatus').textContent = transferPlanEditMode
    ? currentLanguage === 'zh-CN'
      ? '编辑模式：仅 Options cancelled/forfeited 可修改。Confirm & Run 后会生成新的输入文件并运行 workflow。'
      : 'Edit mode: only Options cancelled/forfeited is editable. Confirm & Run creates a new input file and runs the workflow.'
    : currentLanguage === 'zh-CN'
      ? '页面按最新 workflow 结果文件渲染；如需调整取消数量，请进入 Edit 后 Confirm & Run。'
      : 'This page renders the latest workflow result file. Use Edit, then Confirm & Run to adjust cancellations.';
  const toggleButton = el<HTMLButtonElement>('btnToggleTransferPlanTableView');
  setButtonLabel(
    'btnToggleTransferPlanTableView',
    transferPlanTableView === 'summaryRows'
      ? currentLanguage === 'zh-CN'
        ? '转置表格'
        : 'Transpose table'
      : currentLanguage === 'zh-CN'
        ? '恢复横向'
        : 'Restore horizontal',
  );
  toggleButton.setAttribute('aria-pressed', String(transferPlanTableView === 'periodRows'));
  localizeAppDom();
}

function readTransferPlanEdits(): Array<{ period: string; cancelledQuantity: number }> {
  return Array.from(document.querySelectorAll<HTMLInputElement>('[data-transfer-cancelled-period]')).map((input) => {
    const period = input.dataset.transferCancelledPeriod ?? '';
    const cancelledQuantity = Number(input.value);
    if (!period || !Number.isFinite(cancelledQuantity)) {
      input.classList.add('is-invalid');
      throw new Error('请输入有效的取消数量');
    }
    input.classList.remove('is-invalid');
    return { period, cancelledQuantity };
  });
}

async function saveTransferPlanEdit() {
  const saveButton = el<HTMLButtonElement>('btnSaveTransferPlanEdit');
  const cancelButton = el<HTMLButtonElement>('btnCancelTransferPlanEdit');
  let edits: Array<{ period: string; cancelledQuantity: number }>;
  try {
    edits = readTransferPlanEdits();
  } catch (error) {
    notify((error as Error).message, { type: 'error' });
    return;
  }

  saveButton.disabled = true;
  cancelButton.disabled = true;
  el('transferPlanEditStatus').textContent =
    currentLanguage === 'zh-CN'
      ? '正在保存编辑、生成输入文件并运行 workflow...'
      : 'Saving edits, creating an input file, and running the workflow...';
  workflowUpdateModal.openProgressModal(
    t('transferPlanConfirmAndRun'),
    currentLanguage === 'zh-CN'
      ? '正在根据编辑内容生成新的输入文件，并运行 Transfer Plan workflow。'
      : 'Creating a new input file from your edits and running the Transfer Plan workflow.',
  );
  try {
    const result = await api<WorkflowExecutionResult>('/api/transfer-plan/edits', {
      method: 'POST',
      body: JSON.stringify({ edits }),
    });
    const runId = result.run?.id;
    if (!runId) throw new Error('Workflow run was not created');
    if (result.run) workflowUpdateModal.renderProgress(result.run);
    el('workflowUpdateStatus').textContent = workflowUpdateModal.statusMessage('running', String(runId));
    const run = await workflowUpdateModal.pollRunUntilFinished(runId, (run) => workflowUpdateModal.renderProgress(run));
    if (run.status !== 'completed' && run.status !== 'completed_with_warnings') {
      throw new Error(run.errorMessage ?? `Workflow ended with status ${run.status}`);
    }
    workflowUpdateModal.renderProgress(run);
    el('workflowUpdateStatus').textContent = workflowUpdateModal.statusMessage(
      run.status === 'completed_with_warnings' ? 'completedWithWarnings' : 'completed',
    );
    transferPlanEditMode = false;
    await filesPage.refreshProductFiles();
    await renderTransferPlan();
    notify(run.status === 'completed_with_warnings' ? 'Workflow 完成（包含 Warning）' : 'Transfer Plan 已更新', {
      type: run.status === 'completed_with_warnings' ? 'warning' : 'success',
    });
    workflowUpdateModal.forceCloseModal();
  } catch (error) {
    notify((error as Error).message, { type: 'error' });
    el('transferPlanEditStatus').textContent = (error as Error).message;
    el('workflowUpdateStatus').textContent = workflowUpdateModal.statusMessage('failed', (error as Error).message);
    el('workflowUpdateProgress').classList.add('is-error');
    workflowUpdateModal.setCloseLocked(false);
    el('btnCloseWorkflowUpdateModal').classList.remove('hidden');
  } finally {
    saveButton.disabled = false;
    cancelButton.disabled = false;
  }
}

async function loadEmployeeLabels() {
  const data = await api<{ items: EmployeeLabel[] }>('/api/employee-labels');
  employeeLabels = data.items;
  renderEmployeeLabelControls();
}

function renderEmployeeLabelControls() {
  renderEmployeeLabelFilter('filterHoldingsTag');
  renderEmployeeLabelFilter('filterExerciseTag');
  renderEmployeeLabelFilter('filterSoldSharesTag');
  const filter = el<HTMLSelectElement>('filterEmployeesPageTag');
  const selectedFilter = filter.value;
  filter.innerHTML = [
    `<option value="">${escapeHtml(t('allTags'))}</option>`,
    ...employeeLabels.map((label) => `<option value="${label.id}">${escapeHtml(label.name)}</option>`),
  ].join('');
  filter.value = employeeLabels.some((label) => String(label.id) === selectedFilter) ? selectedFilter : '';

  renderEmployeeAssignmentLabels();
  renderEmployeeLabelsTable();
}

function renderEmployeeLabelFilter(id: string) {
  const filter = el<HTMLSelectElement>(id);
  const selectedFilter = filter.value;
  filter.innerHTML = [
    `<option value="">${escapeHtml(t('allTags'))}</option>`,
    ...employeeLabels.map((label) => `<option value="${label.id}">${escapeHtml(label.name)}</option>`),
  ].join('');
  filter.value = employeeLabels.some((label) => String(label.id) === selectedFilter) ? selectedFilter : '';
}

function renderEmployeeAssignmentLabels() {
  const validLabelIds = new Set(employeeLabels.map((label) => label.id));
  editingEmployeeLabelIds = editingEmployeeLabelIds.filter(
    (id, index, ids) => validLabelIds.has(id) && ids.indexOf(id) === index,
  );
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
            <button class="btn btn-secondary btn-sm" data-action="edit-employee-label" data-id="${label.id}">${t('edit')}</button>
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
    ? currentLanguage === 'zh-CN'
      ? '编辑标签'
      : 'Edit Tag'
    : currentLanguage === 'zh-CN'
      ? '新增标签'
      : 'New Tag';
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
    node.dataset.dir = employeesSort.by && employeesSort.by === key ? employeesSort.dir : 'none';
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

// Shared Name / Employee No. header sorting for the ESOP detail tables.
function sortQuery(sort: NameEmpNoSort): string {
  return sort.by ? `&sort=${sort.by}&dir=${sort.dir}` : '';
}

function renderSortIndicators(scopeSelector: string, sort: NameEmpNoSort) {
  document.querySelectorAll<HTMLElement>(`${scopeSelector} [data-sort-key]`).forEach((node) => {
    const key = node.dataset.sortKey;
    node.dataset.dir = sort.by && sort.by === key ? sort.dir : 'none';
  });
}

function nextSort(current: NameEmpNoSort, by: 'name' | 'empNo'): NameEmpNoSort {
  if (current.by === by) {
    return { by, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  }
  return { by, dir: 'asc' };
}

function toggleGrantSort(by: 'name' | 'empNo') {
  grantSort = nextSort(grantSort, by);
  holdingsPage = 1;
  void renderHoldingsPage(currentMonth);
}

function toggleExerciseSort(by: 'name' | 'empNo') {
  exerciseSort = nextSort(exerciseSort, by);
  exercisePage = 1;
  void renderExerciseRecords();
}

function toggleSoldSharesSort(by: 'name' | 'empNo') {
  soldSharesSort = nextSort(soldSharesSort, by);
  soldSharesPage = 1;
  void renderSoldShares();
}

function renderEmployeesPageTable() {
  if (employees.length === 0) {
    el('employeesPageBody').innerHTML = '<tr><td colspan="8" class="table-empty-cell">暂无符合条件的员工</td></tr>';
    localizeAppDom();
    return;
  }
  el('employeesPageBody').innerHTML = employees
    .map((item, index) => {
      const sourceLabels: Record<string, string> = { futu: 'Futu', shareworks: 'Shareworks', manual: '手工' };
      const sourceLabel = sourceLabels[item.source] ?? item.source;
      const sourceClass =
        item.source === 'manual' ? 'employee-origin-badge--manual' : 'employee-origin-badge--extracted';
      const linkedHtml = item.linkedIdentities.length
        ? item.linkedIdentities
            .map(
              (identity) =>
                `<span class="linked-identity">${escapeHtml(`${identity.source}:${identity.employeeId} ${identity.name}`.trim())}` +
                `<button type="button" class="linked-identity__unlink" data-action="unlink-employee" data-source-id="${identity.id}" data-target-number="${escapeHtml(item.employeeNumber)}" title="${t('unlink')}">×</button></span>`,
            )
            .join(' ')
        : '-';
      const toggleLabel = item.active ? '停用' : '启用';
      const toggleButtonClass = item.active ? 'btn-danger' : 'btn-secondary';
      const rowClass = item.active ? '' : ' class="table-row--muted"';
      return `
      <tr${rowClass}>
        <td>${(employeesPage - 1) * employeesPageSize + index + 1}</td>
        <td style="text-align:left; font-weight:600;">${escapeHtml(item.employeeName)}</td>
        <td>${escapeHtml(item.employeeNumber || '-')}</td>
        <td><span class="employee-origin-badge ${sourceClass}">${escapeHtml(sourceLabel)}</span></td>
        <td style="text-align:left;">${linkedHtml}</td>
        <td style="text-align:left;">${formatTagChips(item.labels ?? [], item.tags)}</td>
        <td class="col-number">${formatNumber(item.grantCount)}</td>
        <td>
          <div class="action-buttons">
            <button class="btn btn-secondary btn-sm" data-action="edit-employee-page" data-id="${item.id}">编辑</button>
            <button class="btn btn-secondary btn-sm" data-action="merge-employee-page" data-id="${item.id}">关联</button>
            <button class="btn ${toggleButtonClass} btn-sm" data-action="toggle-employee-page" data-id="${item.id}">${toggleLabel}</button>
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
  el('employeesPageBody')
    .querySelectorAll<HTMLElement>('[data-action="unlink-employee"]')
    .forEach((button) =>
      button.addEventListener(
        'click',
        () => void unlinkEmployee(Number(button.dataset.sourceId), button.dataset.targetNumber ?? ''),
      ),
    );
  localizeAppDom();
}

async function unlinkEmployee(sourceId: number, targetNumber: string): Promise<void> {
  if (!sourceId || !targetNumber) return;
  const confirmed = await confirmAction(
    currentLanguage === 'zh-CN'
      ? '确认取消该关联？取消后该编号恢复为独立员工，不影响授予/行权/卖出等任何业务记录。'
      : 'Unlink this identity? It becomes a standalone employee again; grant/exercise/sale records are unaffected.',
    {
      title: t('unlink'),
      confirmText: t('unlink'),
    },
  );
  if (!confirmed) return;
  await api(`/api/employees/${encodeURIComponent(targetNumber)}/unlink`, {
    method: 'POST',
    body: JSON.stringify({ mergeFromId: sourceId }),
  });
  notify(t('unlinked'), { type: 'success' });
  await loadEmployeesPage();
}

function openEmployeesPageModal(id?: number) {
  editingEmployeeId = id ?? null;
  const item = employees.find((row) => row.id === id);
  el('employeesPageModalTitle').textContent = item
    ? currentLanguage === 'zh-CN'
      ? '编辑员工'
      : 'Edit Employee'
    : currentLanguage === 'zh-CN'
      ? '新增员工'
      : 'New Employee';
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
      await api('/api/employees', {
        method: 'POST',
        body: JSON.stringify({ employeeId, employeeName, userId, labelIds }),
      });
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
  if (
    !(await confirmAction(`确定${verb}员工【${item.employeeName}】吗？`, { title: `${verb}员工`, confirmText: verb }))
  )
    return;
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

async function renderPlanSummaryPage(month: string) {
  renderMonthPicker('planSummaryMonthPicker', month, 'hasPlanSummaryData');
  const data = await api<PlanSummaryResponse>(`/api/plan-summary?month=${encodeURIComponent(month)}`);
  setWorkflowPageFiles('plan-summary', data);
  el('planSummaryPlanCount').textContent = formatNumber(data.totals.planCount);
  el('planSummaryGranted').textContent = formatNumber(data.totals.granted);
  el('planSummaryExercised').textContent = formatNumber(data.totals.exercised);
  el('planSummaryOutstanding').textContent = formatNumber(data.totals.outstanding);

  if (data.items.length === 0) {
    el('planSummaryBody').innerHTML = '<tr><td colspan="5" class="table-empty-cell">暂无计划汇总数据</td></tr>';
    localizeAppDom();
    return;
  }

  el('planSummaryBody').innerHTML = data.items
    .map(
      (item) => `
      <tr>
        <td style="text-align:left; font-weight:600;">${escapeHtml(item.planName)}</td>
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

function fivePercentHoldersCancelButton(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>('#btnCancelFivePercentHoldersEdit');
}

function setFivePercentHoldersUpdateButtonState() {
  const button = fivePercentHoldersUpdateButton();
  if (!button) return;
  const label = button.querySelector<HTMLElement>('[data-workflow-action-label]');
  const text = fivePercentHoldersEditMode ? t('confirmAndRun') : t('update');
  if (label) {
    label.textContent = text;
  } else {
    button.textContent = text;
  }
  button.disabled = fivePercentHoldersSaving;
  const cancelButton = fivePercentHoldersCancelButton();
  if (cancelButton) {
    cancelButton.classList.toggle('hidden', !fivePercentHoldersEditMode);
    cancelButton.disabled = fivePercentHoldersSaving;
    setButtonLabel('btnCancelFivePercentHoldersEdit', t('cancel'));
  }
}

function fixedValueByKey(key: string): FixedValueRecord | null {
  return fivePercentHolderGlobalParameters.find((item) => item.key === key) ?? null;
}

function fixedValueKeyForHolderCell(holderIndex: number, field: 'commonStock' | 'totalCses'): string | null {
  if (holderIndex === 0) {
    return field === 'commonStock'
      ? fivePercentHolderGlobalParameterKeys.gniCommonStock
      : fivePercentHolderGlobalParameterKeys.gniTotalCses;
  }
  if (holderIndex === 1) {
    return field === 'commonStock'
      ? fivePercentHolderGlobalParameterKeys.songjiangMaCommonStock
      : fivePercentHolderGlobalParameterKeys.songjiangMaTotalCses;
  }
  return null;
}

function renderFivePercentHolderEditableNumber(
  item: FivePercentHoldersResponse['items'][number],
  field: 'commonStock' | 'totalCses',
  holderIndex: number,
) {
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
    el('fivePercentHoldersBody').innerHTML = '<tr><td colspan="5" class="table-empty-cell">暂无 5% 股东记录</td></tr>';
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
  const drafts = Array.from(document.querySelectorAll<HTMLInputElement>('[data-five-percent-fixed-value-key]')).map(
    (input) => {
      const rawId = input.dataset.fivePercentFixedValueId;
      const id = rawId ? Number(rawId) : null;
      const key = String(input.dataset.fivePercentFixedValueKey ?? '');
      const value = Number(input.value.replace(/,/g, '').trim());
      if ((id !== null && (!Number.isInteger(id) || id <= 0)) || !key || !Number.isFinite(value)) {
        throw new Error('请输入有效的 5% Holders 数字');
      }
      return { id, key, value };
    },
  );
  if (drafts.length !== 4) throw new Error('5% Holders 需要编辑四个全局参数');
  return drafts;
}

async function runFivePercentHoldersWorkflowWithPreviousSource() {
  const binding = workflowUpdateModal.bindingFor('five-percent-holders', 'capitalization_summary');
  const fileId = Number(binding?.fileId);
  const sources = Number.isInteger(fileId) && fileId > 0 ? { capitalization_summary: { fileId } } : {};
  const result = await api<WorkflowExecutionResult>(workflowUpdateModal.runEndpoint('five-percent-holders'), {
    method: 'POST',
    body: JSON.stringify({ sources }),
  });
  const runId = result.run?.id;
  if (!runId) throw new Error('Workflow run was not created');
  const run = await workflowUpdateModal.pollRunUntilFinished(runId);
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

async function cancelFivePercentHoldersEdit() {
  if (fivePercentHoldersSaving || !fivePercentHoldersEditMode) return;
  fivePercentHoldersEditMode = false;
  await renderFivePercentHoldersPage();
}

// The 5 monthly-workflow fixed values now live per-month on monthly_run_instances (inherited from
async function renderFixedValuePage() {
  const data = await api<{ items: FixedValueRecord[] }>('/api/global-parameters');
  if (data.items.length === 0) {
    el('fixedValuePageBody').innerHTML =
      '<tr><td colspan="6" class="table-empty-cell">暂无 Global Parameter 配置</td></tr>';
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
        <td>${escapeHtml(item.updatedAt)}</td>
        <td>${escapeHtml(item.updatedBy)}</td>
        <td>
          ${
            isAdminUser() && item.editable
              ? `<div class="action-buttons">
                <button class="btn btn-secondary btn-sm" data-action="edit-fixed-value" data-id="${item.id}" type="button">edit</button>
                <button class="btn btn-danger btn-sm" data-action="delete-fixed-value" data-id="${item.id}" type="button" aria-label="删除 ${escapeHtml(item.label)}" title="删除">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M19 6l-1 14H6L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path></svg>
                </button>
              </div>`
              : '<span>-</span>'
          }
        </td>
      </tr>`,
    )
    .join('');

  el('fixedValuePageBody')
    .querySelectorAll<HTMLElement>('[data-action="edit-fixed-value"]')
    .forEach((button) =>
      button.addEventListener('click', () => void editFixedValue(Number(button.dataset.id), data.items)),
    );
  el('fixedValuePageBody')
    .querySelectorAll<HTMLElement>('[data-action="delete-fixed-value"]')
    .forEach((button) =>
      button.addEventListener('click', () => void deleteFixedValue(Number(button.dataset.id), data.items)),
    );
  localizeAppDom();
}

async function editFixedValue(id: number, items: FixedValueRecord[]) {
  if (!isAdminUser()) return;
  const item = items.find((row) => row.id === id);
  if (!item) return;
  openFixedValueEditModal(item);
}

function openFixedValueEditModal(item: FixedValueRecord) {
  if (!isAdminUser()) return;
  editingFixedValueId = item.id;
  el<HTMLInputElement>('fixedValueEditKey').value = item.key;
  el<HTMLInputElement>('fixedValueEditLabel').value = item.label;
  el<HTMLInputElement>('fixedValueEditValue').value = String(item.value);
  el('fixedValueEditModal').classList.remove('hidden');
  el<HTMLInputElement>('fixedValueEditValue').focus();
}

async function saveFixedValueEdit() {
  if (!isAdminUser() || editingFixedValueId === null) return;
  const label = el<HTMLInputElement>('fixedValueEditLabel').value.trim();
  const rawValue = el<HTMLInputElement>('fixedValueEditValue').value.replace(/,/g, '').trim();
  const value = Number(rawValue);
  if (!label || !Number.isFinite(value)) {
    notify('请填写参数解释并输入有效数字', { type: 'warning' });
    return;
  }
  const submitButton = el<HTMLButtonElement>('btnSubmitFixedValueEdit');
  submitButton.disabled = true;
  try {
    await api(`/api/global-parameters/${editingFixedValueId}`, {
      method: 'PATCH',
      body: JSON.stringify({ label, value }),
    });
    editingFixedValueId = null;
    el('fixedValueEditModal').classList.add('hidden');
    await renderFixedValuePage();
    notify('Global Parameter 已保存', { type: 'success' });
  } catch (error) {
    notify((error as Error).message, { type: 'error' });
  } finally {
    submitButton.disabled = false;
  }
}

function openFixedValueModal() {
  if (!isAdminUser()) return;
  el<HTMLInputElement>('fixedValueKey').value = '';
  el<HTMLInputElement>('fixedValueLabel').value = '';
  el<HTMLInputElement>('fixedValueValue').value = '';
  el('fixedValueModal').classList.remove('hidden');
  el<HTMLInputElement>('fixedValueKey').focus();
}

async function createFixedValue() {
  if (!isAdminUser()) return;
  const key = el<HTMLInputElement>('fixedValueKey').value.trim();
  const label = el<HTMLInputElement>('fixedValueLabel').value.trim();
  const rawValue = el<HTMLInputElement>('fixedValueValue').value.replace(/,/g, '').trim();
  const value = Number(rawValue);
  if (!key || !label || !rawValue || !Number.isFinite(value)) {
    notify('请完整填写 Key、参数解释和 Value', { type: 'warning' });
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
  if (
    !(await confirmAction(`确定删除 Global Parameter「${item.label}」吗？此操作不可撤销。`, {
      title: '删除 Global Parameter',
      confirmText: '删除',
      tone: 'danger',
    }))
  )
    return;

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
    button.addEventListener('click', () => {
      const modalId = button.dataset.close ?? '';
      el(modalId).classList.add('hidden');
      if (modalId === 'fixedValueEditModal') editingFixedValueId = null;
    });
  });
  document.querySelectorAll<HTMLButtonElement>('[data-language]').forEach((button) => {
    button.addEventListener('click', () => {
      const language = button.dataset.language === 'en-US' ? 'en-US' : 'zh-CN';
      setLanguage(language);
    });
  });
  el('btnAddFixedValue').addEventListener('click', openFixedValueModal);
  el('btnSubmitFixedValue').addEventListener('click', () => void createFixedValue());
  el('btnSubmitFixedValueEdit').addEventListener('click', () => void saveFixedValueEdit());
  renderThemeCards();
  syncLanguageButtons();
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
  csv += `${csvRow([`CapTable 股权数据 - ${formatMonthCN(currentMonth)}`])}\n\n`;
  csv += `${csvRow(['【流通股份对账】'])}\n${csvRow(['项目', '截至日期', '上月末', '本月新增', '本月末'])}\n`;
  csv += `${csvRow([currentSummary.reconciliation.item, currentSummary.eomDate, currentSummary.reconciliation.lastMonth, currentSummary.reconciliation.newShares, currentSummary.reconciliation.eomBalance])}\n\n`;
  csv += `${csvRow(['【资本结构】'])}\n${csvRow(['Description', '股份', '占比'])}\n`;
  currentSummary.capitalization.forEach((item) => {
    csv += `${csvRow([item.description, item.shares, item.percent])}\n`;
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
        .map(
          (row) =>
            `<tr>${detail.columns.map((col) => `<td>${typeof row[col.key] === 'number' ? formatNumber(row[col.key]) : escapeHtml(row[col.key] ?? '-')}</td>`).join('')}</tr>`,
        )
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
  initPlanSummaryPage();
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

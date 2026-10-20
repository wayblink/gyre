import type {
  AuthStatus,
  AuthenticatedUser,
  Employee,
  EmployeeLabel,
  LinkDetail,
  LatestMonthlyRunOutput,
  MonthlyRunInstanceRecord,
  MonthlyRunPlanDeleteResult,
  PaginatedResult,
  PlanSummaryResponse,
  ProductFileRecord,
  WorkflowResultFileBinding,
  WorkflowPageSourceBinding,
} from '../shared/types.js';
import { createFilesPage } from './filesPage.js';
import { createFilePickerModal } from './filePickerModal.js';
import { createMonthlyRunPage } from './monthlyRunPage.js';
import { createWorkflowUpdateModal, type WorkflowUpdatePageKey } from './workflowUpdateModal.js';
import { createUserManagementPage } from './userManagementPage.js';
import { createFixedValuePage } from './fixedValuePage.js';
import { createAccountPage } from './accountPage.js';
import { createFivePercentHoldersPage } from './fivePercentHoldersPage.js';
import { createTexts, TEXTS, type TextKey } from './texts.js';

const texts = createTexts('main');

/** Page titles keyed by page; the values live in the merged translation table. */
const pageTitleTranslations = TEXTS.pageTitles as Record<PageKey, Record<AppLanguage, string>>;
import { createThemeControls } from './theme.js';
import { confirmAction, notify } from './uiFeedback.js';
import { createWorkflowPage } from './workflowPage.js';
import { createDocsPage } from './docsPage.js';
import {
  resolveDefaultSummaryMonth,
  sortAvailableMonths,
  type AvailableMonth,
  type MonthAvailabilityKey,
} from './summaryPage.js';
import { buildEmployeesApiUrl, type EmployeeSourceFilter } from './employeesPage.js';
import { createTransferPlanPage } from './transferPlanPage.js';
import { createCaptablePage } from './captablePage.js';
import { paginationSummaryText } from './tableSort.js';
import { createEsopTables, formatCurrency } from './esopTables.js';
import { buildLinkedBadge } from './linkedBadge.js';
import { pageCountOf } from './pagination.js';
import { applyStaticTranslations, persistLanguage, readStoredLanguage, type AppLanguage } from './i18n.js';
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
let authStatus: AuthStatus | null = null;
let updatePlans: MonthlyRunInstanceRecord[] = [];
let employees: Employee[] = [];
let employeeLabels: EmployeeLabel[] = [];
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
  'cancellation-record': '取消记录',
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
const validPages = new Set<PageKey>(Object.keys(pageTitles) as PageKey[]);
const adminOnlyPages = new Set<PageKey>(['files', 'workflow', 'user-management']);
const SIDEBAR_COLLAPSED_STORAGE_KEY = 'captable.sidebar.collapsed';
const MONTHLY_RUN_INPUT_COLLAPSED_STORAGE_KEY = 'captable.monthlyRun.inputCollapsed';
let sidebarCollapsed = false;
let monthlyRunInputCollapsed = false;
let currentLanguage: AppLanguage = readStoredLanguage();
let appInitialized = false;

let editingEmployeeId: number | null = null;
let editingEmployeeLabelId: number | null = null;
let editingEmployeeLabelIds: number[] = [];
let mergeSourceEmployeeId: number | null = null;
const DEFAULT_EMPLOYEE_LABEL_COLOR = '#2563eb';

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
    await esopTables.renderHoldings(currentMonth);
  } else if (page === 'exercise-record') {
    await esopTables.renderExercises();
  } else if (page === 'sold-shares') {
    await esopTables.renderSoldShares();
  } else if (page === 'cancellation-record') {
    await esopTables.renderCancellationRecords();
  } else if (page === 'transfer-plan') {
    await transferPlanPage.render();
  } else if (page === 'employee-management') {
    await loadEmployeesPage();
  } else if (page === 'plan-summary') {
    await renderPlanSummaryPage(currentMonth);
  } else if (page === 'five-percent-holders') {
    await fivePercentHoldersPage.render();
  }
}

const workflowUpdateModal = createWorkflowUpdateModal({
  el,
  api,
  escapeHtml,
  notify,
  getLanguage: () => currentLanguage,
  getProductFiles: () => filesPage.getProductFiles(),
  getMonth: () => currentMonth,
  refreshProductFiles: () => filesPage.refreshProductFiles(),
  openFilePicker: (options) => filePicker.open(options),
  productFileDisplayName,
  refreshPage: (page) => refreshWorkflowUpdatePage(page),
});

const fivePercentHoldersPage = createFivePercentHoldersPage({
  el,
  api,
  escapeHtml,
  notify,
  formatNumber,
  getLanguage: () => currentLanguage,
  currentUserName: () => authStatus?.user?.displayName ?? 'Administrator',
  refreshProductFiles: () => filesPage.refreshProductFiles(),
  rememberPageData: (page, response) => workflowUpdateModal.rememberPageData(page, response),
  workflowModal: {
    bindingFor: (page, sourceKey) => workflowUpdateModal.bindingFor(page, sourceKey),
    runEndpoint: (page) => workflowUpdateModal.runEndpoint(page),
    pollRunUntilFinished: (runId) => workflowUpdateModal.pollRunUntilFinished(runId),
  },
  localizeDom: localizeAppDom,
});

const esopTables = createEsopTables(
  {
    el,
    api,
    escapeHtml,
    formatNumber,
    formatCurrency,
    notify,
    linkedBadge: (identities, language, escape) => buildLinkedBadge(identities as never, language, escape),
    grantTypeClass: getGrantTypeClass,
    setPageSourceFiles: setWorkflowPageFiles,
    localizeDom: localizeAppDom,
    getLanguage: () => currentLanguage,
  },
  {
    getMonth: () => currentMonth,
    renderMonthPicker,
    loadEmployeeLabels: () => loadEmployeeLabels(),
  },
);

const captablePage = createCaptablePage(
  {
    el,
    api,
    escapeHtml,
    formatNumber,
    notify,
    confirmAction,
    productFileDisplayName,
    getLanguage: () => currentLanguage,
  },
  {
    getMonth: () => currentMonth,
    setMonth: (month) => {
      currentMonth = month;
    },
    fetchAvailableMonths,
    renderMonthPicker,
    setPageSourceFiles,
    getCurrentMonthTextNode,
    resetActivePageSourceFile,
    openLinkModal: (key) => void openLinkModal(key),
    localizeDom: localizeAppDom,
  },
);

const transferPlanPage = createTransferPlanPage({
  el,
  api,
  escapeHtml,
  formatNumber,
  notify,
  getLanguage: () => currentLanguage,
  setButtonLabel,
  rememberPageData: (page, response) => workflowUpdateModal.rememberPageData(page, response),
  refreshProductFiles: () => filesPage.refreshProductFiles(),
  localizeDom: localizeAppDom,
  workflowModal: {
    openProgressModal: (title, subtitle) => workflowUpdateModal.openProgressModal(title, subtitle),
    renderProgress: (run) => workflowUpdateModal.renderProgress(run),
    statusMessage: (key, detail) => workflowUpdateModal.statusMessage(key, detail),
    pollRunUntilFinished: (runId, onProgress) => workflowUpdateModal.pollRunUntilFinished(runId, onProgress),
    forceCloseModal: () => workflowUpdateModal.forceCloseModal(),
    setCloseLocked: (locked) => workflowUpdateModal.setCloseLocked(locked),
  },
});

const accountPage = createAccountPage({
  el,
  api,
  notify,
  getLanguage: () => currentLanguage,
  onProfileSaved: setCurrentUser,
});

const themeControls = createThemeControls({
  el,
  escapeHtml,
  text: (key) => t(key),
});

const fixedValuePage = createFixedValuePage({
  el,
  api,
  escapeHtml,
  notify,
  confirmAction,
  formatNumber,
  getLanguage: () => currentLanguage,
  isAdmin: isAdminUser,
  localizeDom: localizeAppDom,
});

const userManagementPage = createUserManagementPage({
  el,
  api,
  escapeHtml,
  notify,
  confirmAction,
  getLanguage: () => currentLanguage,
  formatDateTime,
  isAdmin: isAdminUser,
  redirectToDefaultPage: () => navigateToPage(DEFAULT_PAGE),
});

const monthlyRunPage = createMonthlyRunPage({
  el,
  api,
  escapeHtml,
  formatDateTime,
  refreshProductFiles: () => filesPage.refreshProductFiles(),
  refreshSummary: (month) => captablePage.render(month),
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
  { kind: 'hero', page: 'cancellation-record', key: 'cancellationHeroText' },
  { kind: 'hero', page: 'transfer-plan', key: 'transferHeroText' },
  { kind: 'hero', page: 'employee-management', key: 'employeeHeroText' },
  { kind: 'hero', page: 'plan-summary', key: 'planHeroText' },
  { kind: 'hero', page: 'five-percent-holders', key: 'holdersHeroText' },
  { kind: 'hero', page: 'docs', key: 'docsHeroText' },
  { kind: 'hero', page: 'captable', key: 'captableHeroText' },
  // Everything except the month-picker caption, which has its own label.
  {
    kind: 'allText',
    selector: '.product-page-hero__metric > span:not(.month-picker-caption)',
    key: 'sourceFile',
  },
  { kind: 'allText', selector: '.month-picker-caption', key: 'monthCaption' },
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
  { kind: 'searchLabels', page: 'cancellation-record', keys: ['search', 'tag', 'employmentStatus'] },
  { kind: 'searchLabels', page: 'employee-management', keys: ['search', 'tag'] },
  { kind: 'option', id: 'capitalizationSourceFile', value: '', key: 'defaultSnapshot' },
  { kind: 'option', id: 'filterGrantType', value: '', key: 'allTypes' },
  { kind: 'option', id: 'filterHoldingsTag', value: '', key: 'allTags' },
  { kind: 'option', id: 'filterExerciseTag', value: '', key: 'allTags' },
  { kind: 'option', id: 'filterSoldSharesTag', value: '', key: 'allTags' },
  { kind: 'option', id: 'filterCancellationTag', value: '', key: 'allTags' },
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
      if (button?.dataset.workflowUpdatePage === 'five-percent-holders' && fivePercentHoldersPage.isEditMode()) {
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
  transferPlanPage.syncLabels();
  syncCurrentViewInfoText();

  setText('#page-user-management .card-title', pageTitleFor('user-management'));
  setText('#page-user-management .card-subtitle', t('userManagementSubtitle'));
  const userLabels = document.querySelectorAll<HTMLElement>('#managedUserModal .form-group label');
  [t('username'), t('displayName'), t('role'), t('email'), t('contact'), t('status')].forEach((copy, index) => {
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

  esopTables.applyLanguage();
  renderEmployeesPagination(employeesPage, pageCountOf(employeesTotal, employeesPageSize), employeesTotal);
  userManagementPage.applyLanguage();

  const activePage = getPageFromLocation();
  el('pageTitle').textContent = pageTitleFor(activePage);
  el('authSubmit').textContent = authStatus?.bootstrapRequired ? t('createAndLogin') : t('login');
  el('sidebarToggle').setAttribute('aria-label', sidebarCollapsed ? t('expandSidebar') : t('collapseSidebar'));
  syncLanguageButtons();
  // The theme picker carries localized descriptions, so it is re-rendered on a language switch.
  themeControls.renderCards();
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
      await captablePage.refreshSourceFileOptions();
      if (currentMonth) await captablePage.render(currentMonth);
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
      await userManagementPage.load();
    }

    // The Global Parameter page has no sidebar entry (it is linked from the docs and the 5% holders
    // page), and without this branch it only rendered after a mutation.
    if (page === 'fixed-value') {
      await fixedValuePage.render();
    }

    if (page === 'grant-record') {
      await esopTables.renderHoldings(currentMonth);
    }

    if (page === 'exercise-record') {
      await esopTables.renderExercises();
    }

    if (page === 'sold-shares') {
      await esopTables.renderSoldShares();
    }

    if (page === 'cancellation-record') {
      await esopTables.renderCancellationRecords();
    }

    if (page === 'transfer-plan') {
      await transferPlanPage.render();
    }

    if (page === 'employee-management') {
      await loadEmployeesPage();
    }

    if (page === 'plan-summary') {
      if (currentMonth) await renderPlanSummaryPage(currentMonth);
    }

    if (page === 'five-percent-holders') {
      await fivePercentHoldersPage.render();
    }

    if (page === 'account') {
      await accountPage.load();
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
    void captablePage.render(month);
    void esopTables.renderHoldings(month);
  });
  el('btnExport').addEventListener('click', () => captablePage.exportCsv());
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
  await captablePage.refreshSourceFileOptions();
  if (months.length === 0) {
    captablePage.renderEmpty('暂无月度业务数据。请先创建 Monthly Update 或导入正式数据。');
  } else {
    await captablePage.render(currentMonth);
  }
  el('btnAddNote').addEventListener('click', () => {
    el('addNoteForm').classList.remove('hidden');
    el<HTMLTextAreaElement>('noteContent').focus();
  });
  el('btnCancelNote').addEventListener('click', () => {
    el('addNoteForm').classList.add('hidden');
    el<HTMLTextAreaElement>('noteContent').value = '';
  });
  captablePage.bindSourceFileControl();
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
    await captablePage.render(currentMonth);
  });
}

/**
 * Month snapshot picker for a record page: switching months re-renders the table against that
 * month's snapshot (the workflow run is tagged with `month`). `has*Data` marks months that have one.
 */
function initRecordMonthPicker(options: {
  pickerId: string;
  dataKey: MonthAvailabilityKey;
  render: (month: string) => Promise<void> | void;
}) {
  renderMonthPicker(options.pickerId, currentMonth, options.dataKey);
  const picker = el<HTMLInputElement>(options.pickerId);
  picker.value = currentMonth;
  picker.addEventListener('change', () => {
    const month = picker.value;
    if (!month) {
      notify('请选择月份', { type: 'warning' });
      return;
    }
    currentMonth = month;
    renderMonthPicker(options.pickerId, month, options.dataKey);
    void options.render(month);
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

function renderMonthPicker(inputId: string, selectedMonth: string, dataKey: MonthAvailabilityKey) {
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

function initWorkflowUpdateModal() {
  document.querySelectorAll<HTMLButtonElement>('[data-workflow-update-page]').forEach((button) => {
    button.addEventListener('click', () => {
      const page = button.dataset.workflowUpdatePage ?? '';
      if (!workflowUpdateModal.isWorkflowUpdatePage(page)) return;
      if (page === 'five-percent-holders') {
        void fivePercentHoldersPage.handleUpdateClick();
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
  el('btnCancelFivePercentHoldersEdit').addEventListener('click', () => void fivePercentHoldersPage.cancelEdit());
  workflowUpdateModal.bindEvents();
}

async function initTransferPlanPage() {
  el('btnToggleTransferPlanTableView').addEventListener('click', () => void transferPlanPage.toggleTableView());
  el('btnEditTransferPlan').addEventListener('click', () => void transferPlanPage.startEdit());
  el('btnCancelTransferPlanEdit').addEventListener('click', () => void transferPlanPage.cancelEdit());
  el('btnSaveTransferPlanEdit').addEventListener('click', () => void transferPlanPage.saveEdit());
  await transferPlanPage.render();
}

function renderEmployeesPagination(page: number, totalPages: number, total: number) {
  const view = paginationView({ page, pageSize: employeesPageSize, total, totalPages });
  renderPaginationControls(
    el,
    PAGINATION_IDS.employees,
    view,
    paginationSummaryText(view.start, view.end, total, 'employees', currentLanguage),
  );
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
      header.addEventListener('click', () => esopTables.toggleGrantSort(header.dataset.grantSort as 'name' | 'empNo')),
    );
  document
    .querySelectorAll<HTMLElement>('[data-exercise-sort]')
    .forEach((header) =>
      header.addEventListener('click', () =>
        esopTables.toggleExerciseSort(header.dataset.exerciseSort as 'name' | 'empNo'),
      ),
    );
  document
    .querySelectorAll<HTMLElement>('[data-sold-sort]')
    .forEach((header) =>
      header.addEventListener('click', () =>
        esopTables.toggleSoldSharesSort(header.dataset.soldSort as 'name' | 'empNo'),
      ),
    );
  document
    .querySelectorAll<HTMLElement>('[data-cancellation-sort]')
    .forEach((header) =>
      header.addEventListener('click', () =>
        esopTables.toggleCancellationSort(header.dataset.cancellationSort as 'name' | 'empNo'),
      ),
    );
  await loadEmployeeLabels();
  await loadEmployeesPage();
}

async function initAccountPage() {
  el('btnSaveAccountProfile').addEventListener('click', () => void accountPage.submitProfile());
  el('btnOpenChangePasswordModal').addEventListener('click', () => accountPage.openPasswordModal());
  el('btnChangeAccountPassword').addEventListener('click', () => void accountPage.submitPassword());
  document.querySelectorAll<HTMLElement>('[data-close="accountPasswordModal"]').forEach((button) => {
    button.addEventListener('click', () => accountPage.closePasswordModal());
  });
  el('accountPasswordModal').addEventListener('click', (event) => {
    if (event.target === el('accountPasswordModal')) accountPage.closePasswordModal();
  });
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
    ? t('employeeLabelModalTitleEdit')
    : t('employeeLabelModalTitleCreate');
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
  const confirmed = await confirmAction(t('employeeUnlinkConfirm'), {
    title: t('unlink'),
    confirmText: t('unlink'),
  });
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
    ? t('employeesPageModalTitleEdit')
    : t('employeesPageModalTitleCreate');
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

// The 5 monthly-workflow fixed values now live per-month on monthly_run_instances (inherited from
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
      if (modalId === 'fixedValueEditModal') fixedValuePage.cancelEdit();
    });
  });
  document.querySelectorAll<HTMLButtonElement>('[data-language]').forEach((button) => {
    button.addEventListener('click', () => {
      const language = button.dataset.language === 'en-US' ? 'en-US' : 'zh-CN';
      setLanguage(language);
    });
  });
  el('btnAddFixedValue').addEventListener('click', () => fixedValuePage.openCreateModal());
  el('btnSubmitFixedValue').addEventListener('click', () => void fixedValuePage.submitCreate());
  el('btnSubmitFixedValueEdit').addEventListener('click', () => void fixedValuePage.submitEdit());
  themeControls.renderCards();
  syncLanguageButtons();
}

function formatFileSize(bytes: number) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, index)).toFixed(index > 0 ? 1 : 0)} ${units[index]}`;
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
  initRecordMonthPicker({
    pickerId: 'grantMonthPicker',
    dataKey: 'hasGrantData',
    render: (month) => esopTables.renderHoldings(month),
  });
  initRecordMonthPicker({
    pickerId: 'exerciseMonthPicker',
    dataKey: 'hasExerciseData',
    render: () => esopTables.renderExercises(),
  });
  initRecordMonthPicker({
    pickerId: 'soldSharesMonthPicker',
    dataKey: 'hasSoldSharesData',
    render: () => esopTables.renderSoldShares(),
  });
  initRecordMonthPicker({
    pickerId: 'cancellationMonthPicker',
    dataKey: 'hasCancellationData',
    render: () => esopTables.renderCancellationRecords(),
  });
  await esopTables.init();
  await initTransferPlanPage();
  await initEmployeesPage();
  initWorkflowUpdateModal();
  userManagementPage.bindEvents();
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
    themeControls.apply();
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

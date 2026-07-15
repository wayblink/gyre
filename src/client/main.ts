import type {
  AccountProfile,
  AuthStatus,
  AuthenticatedUser,
  Employee,
  EmployeeMapping,
  ExerciseRecord,
  FixedValueRecord,
  FivePercentHoldersResponse,
  Holding,
  LinkDetail,
  LatestMonthlyRunOutput,
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
  ShareworksGrant,
} from '../shared/types.js';
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
import '../../css/style.css';
import '@univerjs/design/lib/index.css';
import '@univerjs/ui/lib/index.css';
import '@univerjs/sheets-ui/lib/index.css';

let currentMonth = '';
let currentSummary: SummarySnapshot | null = null;
let authStatus: AuthStatus | null = null;
let updatePlans: MonthlyRunInstanceRecord[] = [];
let employees: Employee[] = [];
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
  'fixed-value': '固定参数',
  files: '文件中心',
  workflow: '工作流',
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
const SIDEBAR_COLLAPSED_STORAGE_KEY = 'captable.sidebar.collapsed';
const MONTHLY_RUN_INPUT_COLLAPSED_STORAGE_KEY = 'captable.monthlyRun.inputCollapsed';
let sidebarCollapsed = false;
let monthlyRunInputCollapsed = false;
let themeSelection: ThemeSelection = getStoredTheme();
let currentLanguage: AppLanguage = readStoredLanguage();
let appInitialized = false;
let currentAccount: AccountProfile | null = null;

let editingEmployeeId: number | null = null;
let mergeSourceEmployeeId: number | null = null;

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

const docsPage = createDocsPage({ el, getLanguage: () => currentLanguage });

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

function setPageSourceFiles(page: PageKey, files: string | Array<string | null | undefined> | null | undefined) {
  const list = (Array.isArray(files) ? files : [files])
    .map((file) => String(file ?? '').trim())
    .filter(Boolean);
  const section = document.getElementById(`page-${page}`);
  const nameNode = section?.querySelector<HTMLElement>('[data-page-source-file-name]');
  if (!nameNode) return;
  const label = list.join(' / ');
  nameNode.textContent = label || '-';
  nameNode.setAttribute('title', label ? `SourceFile: ${label}` : '');
}

function productFileDisplayName(file: ProductFileRecord) {
  return file.displayName || file.originalName;
}

function resetActivePageSourceFile() {
  const activeSection = document.querySelector<HTMLElement>('.page-section.active');
  const nameNode = activeSection?.querySelector<HTMLElement>('[data-page-source-file-name]');
  if (!nameNode) return;
  nameNode.textContent = '-';
  nameNode.removeAttribute('title');
}

function responseSourceFiles(response: { sourceFiles?: string[]; sourceFileName?: string | null }) {
  return response.sourceFiles?.length ? response.sourceFiles : response.sourceFileName;
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
  'fixed-value': { 'zh-CN': '固定参数', 'en-US': 'Fixed Value' },
  files: { 'zh-CN': '文件中心', 'en-US': 'Files' },
  workflow: { 'zh-CN': '工作流', 'en-US': 'Workflow' },
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
  devTools: { 'zh-CN': '开发工具', 'en-US': 'Developer Tools' },
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
  sourceFile: { 'zh-CN': 'SourceFile', 'en-US': 'SourceFile' },
  captableHeroEyebrow: { 'zh-CN': '股本汇总', 'en-US': 'Equity Summary' },
  captableHeroText: { 'zh-CN': '展示月度 Capitalization Table Summary View，数据来自当前选择的 SourceFile。', 'en-US': 'View the monthly Capitalization Table Summary using the selected SourceFile.' },
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
  holdersHeroText: { 'zh-CN': '来源：Gyre Cap Table「5% Holders」sheet（EDGAR SC13 申报口径）。', 'en-US': 'Source: Gyre Cap Table “5% Holders” sheet, aligned with EDGAR SC13 filings.' },
  fixedHeroEyebrow: { 'zh-CN': '管理可以更改的固定值', 'en-US': 'Manage Editable Fixed Values' },
  fixedHeroText: { 'zh-CN': 'Data Management 下的固定值维护页，用于管理月度流程中可由管理员调整的业务常量。', 'en-US': 'Maintain business constants that admins can adjust in the monthly process.' },
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
  ['employeesPageNumber', { 'zh-CN': '输入工号（新增后不可改）', 'en-US': 'Enter employee no. (cannot be changed after creation)' }],
  ['employeesPageName', { 'zh-CN': '输入员工姓名', 'en-US': 'Enter employee name' }],
  ['employeesPageUserId', { 'zh-CN': '输入用户 ID', 'en-US': 'Enter user id' }],
  ['employeesPageTags', { 'zh-CN': '用英文逗号分隔标签', 'en-US': 'Comma separated tags' }],
  ['employeesMergeTargetNumber', { 'zh-CN': '输入目标员工的工号 / Emp. No.', 'en-US': 'Enter target employee no. / Emp. No.' }],
];

function t(key: keyof typeof uiText): string {
  return uiText[key][currentLanguage] ?? uiText[key]['zh-CN'];
}

function pageTitleFor(page: PageKey): string {
  return pageTitleTranslations[page]?.[currentLanguage] ?? pageTitles[page];
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

function setPageHero(page: PageKey, eyebrowKey: keyof typeof uiText, title: string, bodyKey: keyof typeof uiText) {
  const section = document.getElementById(`page-${page}`);
  if (!section) return;
  const hero = section.querySelector<HTMLElement>('.product-page-hero');
  const eyebrow = hero?.querySelector<HTMLElement>('.product-page-hero__eyebrow');
  const heading = hero?.querySelector<HTMLElement>('h2');
  const paragraph = hero?.querySelector<HTMLElement>('p');
  if (eyebrow) eyebrow.textContent = t(eyebrowKey);
  if (heading) heading.textContent = title;
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

  setPageHero('esop-detail', 'esopHeroEyebrow', 'ESOP Detail', 'esopHeroText');
  setPageHero('grant-record', 'grantHeroEyebrow', 'Grant Record', 'grantHeroText');
  setPageHero('exercise-record', 'exerciseHeroEyebrow', 'Exercise to Date', 'exerciseHeroText');
  setPageHero('sold-shares', 'soldHeroEyebrow', 'Sold Shares', 'soldHeroText');
  setPageHero('transfer-plan', 'transferHeroEyebrow', '2025 Transfer to Futu', 'transferHeroText');
  setPageHero('employee-management', 'employeeHeroEyebrow', 'Employee Management', 'employeeHeroText');
  setPageHero('plan-summary', 'planHeroEyebrow', 'Plan Summary', 'planHeroText');
  setPageHero('five-percent-holders', 'holdersHeroEyebrow', '5% Holders', 'holdersHeroText');
  setPageHero('fixed-value', 'fixedHeroEyebrow', 'Fixed Value', 'fixedHeroText');
  setPageHero('docs', 'docsHeroEyebrow', pageTitleFor('docs'), 'docsHeroText');
  setPageHero('captable', 'captableHeroEyebrow', 'CapTable', 'captableHeroText');

  setAllText('.product-page-hero__metric > span', t('sourceFile'));
  [
    'btnSearchHoldings',
    'btnSearchExercises',
    'btnSearchSoldShares',
    'btnSearchEmployeesPage',
  ].forEach((id) => setButtonLabel(id, t('search')));
  setButtonLabel('btnExport', t('export'));
  setButtonLabel('btnExportTransferPlan', `${t('export')} detail`);
  setButtonLabel('btnImportTransferPlan', currentLanguage === 'zh-CN' ? '导入明细' : 'Import detail');
  setButtonLabel('btnToggleTransferPlanTableView', transferPlanTableView === 'summaryRows'
    ? (currentLanguage === 'zh-CN' ? '转置表格' : 'Transpose table')
    : (currentLanguage === 'zh-CN' ? '恢复横向' : 'Restore horizontal'));
  setButtonLabel('btnAddEmployeesPage', currentLanguage === 'zh-CN' ? '新增员工' : 'New Employee');
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

  setText('label.auth-field span', t('authUsername'));
  const authLabels = document.querySelectorAll<HTMLElement>('.auth-field span');
  [t('authUsername'), t('authPassword'), t('authDisplayName'), t('authBootstrapSecret')].forEach((copy, index) => {
    if (authLabels[index]) authLabels[index].textContent = copy;
  });

  setText('#btnCloseLinkModalFooter', t('close'));
  setText('#page-plan-summary .card-title', pageTitleFor('plan-summary'));
  setText('#page-plan-summary .card-subtitle', currentLanguage === 'zh-CN' ? '由股权授予明细聚合生成' : 'Aggregated from equity grant detail');
  setText('#page-five-percent-holders .card-title', pageTitleFor('five-percent-holders'));
  setText('#page-fixed-value .card-title', currentLanguage === 'zh-CN' ? '固定值' : 'Fixed Values');
  setText('#page-fixed-value .card-subtitle', currentLanguage === 'zh-CN' ? '管理员可维护' : 'Admin editable');
  setAllText('.pagination-size-label', t('rows'));
  setAllText('[id$="FirstPage"]', t('first'));
  setAllText('[id$="PrevPage"]', t('previous'));
  setAllText('[id$="NextPage"]', t('next'));
  setAllText('[id$="LastPage"]', t('last'));

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

function formatTags(tags: string[]): string {
  return tags.length ? tags.join(', ') : '-';
}

function parseTagInput(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
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
  return validPages.has(value as PageKey) ? (value as PageKey) : DEFAULT_PAGE;
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
  el('fixedValueBody').innerHTML = '<tr><td colspan="5" class="table-empty-cell">正在加载输入定义...</td></tr>';
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
  el<HTMLInputElement>('monthPickerMonthly').value = '';

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
  el('btnSearchMonthly').addEventListener('click', () => void renderMonthlyPage(el<HTMLInputElement>('monthPickerMonthly').value));
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
  el('btnImportTransferPlan').addEventListener('click', () => {
    el<HTMLInputElement>('transferPlanFileInput').click();
  });
  el('btnExportTransferPlan').addEventListener('click', exportTransferPlanWorkbook);
  el('transferPlanFileInput').addEventListener('change', () => void importTransferPlanWorkbook());
  el('transferPlanSummaryBody').addEventListener('change', (event) => {
    const input = (event.target as HTMLElement).closest<HTMLInputElement>('[data-transfer-cancelled-id]');
    if (input) void updateTransferPlanCancellation(input);
  });
  await renderTransferPlan();
}

async function initEmployeesPage() {
  el('btnSearchEmployeesPage').addEventListener('click', searchEmployeesPage);
  el<HTMLSelectElement>('filterEmployeesPageSource').addEventListener('change', (event) => {
    employeesSourceFilter = (event.target as HTMLSelectElement).value as EmployeeSourceFilter;
    searchEmployeesPage();
  });
  el('btnAddEmployeesPage').addEventListener('click', () => openEmployeesPageModal());
  el('btnSubmitEmployeesPage').addEventListener('click', () => void submitEmployeesPage());
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
  await loadEmployeesPage();
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
    setPageSourceFiles('grant-record', responseSourceFiles(data));
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
    setPageSourceFiles('grant-record', responseSourceFiles(data));
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
  setPageSourceFiles('grant-record', responseSourceFiles(data));
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
    tbody.innerHTML = '<tr><td colspan="31" class="table-empty-cell">暂无符合条件的 Shareworks 记录</td></tr>';
    localizeAppDom();
    return;
  }
  tbody.innerHTML = items
    .map(
      (item, index) => `
      <tr>
        <td>${(data.page - 1) * data.pageSize + index + 1}</td>
        <td>${escapeHtml(item.costCenter)}</td>
        <td>${escapeHtml(item.participantType)}</td>
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
  setPageSourceFiles('exercise-record', responseSourceFiles(data));
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
  setPageSourceFiles('sold-shares', responseSourceFiles(data));
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
  setPageSourceFiles('transfer-plan', responseSourceFiles(data));
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
    await api('/api/transfer-plan/import', { method: 'POST', body: form });
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

async function loadEmployeesPage() {
  const query = el<HTMLInputElement>('searchEmployeesPage').value.trim();
  const tag = el<HTMLInputElement>('filterEmployeesPageTag').value.trim();
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
  setPageSourceFiles('employee-management', responseSourceFiles(data));
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
        <td style="text-align:left;">${escapeHtml(formatTags(item.tags))}</td>
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
  el<HTMLInputElement>('employeesPageTags').value = item?.tags.join(', ') ?? '';
  el('employeesPageModal').classList.remove('hidden');
}

async function submitEmployeesPage() {
  const employeeId = el<HTMLInputElement>('employeesPageNumber').value.trim();
  const employeeName = el<HTMLInputElement>('employeesPageName').value.trim();
  const userId = el<HTMLInputElement>('employeesPageUserId').value.trim();
  const tags = parseTagInput(el<HTMLInputElement>('employeesPageTags').value);
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
        body: JSON.stringify({ employeeName, userId, tags }),
      });
    } else {
      await api('/api/employees', { method: 'POST', body: JSON.stringify({ employeeId, employeeName, userId, tags }) });
    }
  } catch (error) {
    notify((error as Error).message, { type: 'warning' });
    return;
  }
  el('employeesPageModal').classList.add('hidden');
  editingEmployeeId = null;
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
  setPageSourceFiles('plan-summary', responseSourceFiles(data));
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

async function renderFivePercentHoldersPage() {
  const data = await api<FivePercentHoldersResponse>('/api/five-percent-holders');
  setPageSourceFiles('five-percent-holders', responseSourceFiles(data));
  const summary = data.summary;
  el('fivePercentHoldersSummary').innerHTML = `
    <div class="stat-chip"><span class="stat-chip__label">As of</span><span class="stat-chip__value">${escapeHtml(summary.asOfDate ?? '-')}</span></div>
    <div class="stat-chip"><span class="stat-chip__label">Fully Diluted</span><span class="stat-chip__value">${formatNumber(summary.fullyDiluted)}</span></div>
    <div class="stat-chip"><span class="stat-chip__label">Common Stock OS</span><span class="stat-chip__value">${formatNumber(summary.commonStockOs)}</span></div>`;

  if (data.items.length === 0) {
    el('fivePercentHoldersBody').innerHTML =
      '<tr><td colspan="6" class="table-empty-cell">暂无 5% 股东记录</td></tr>';
    localizeAppDom();
    return;
  }

  el('fivePercentHoldersBody').innerHTML = data.items
    .map((item) => {
      const rowClass = item.rowType === 'total' ? ' class="table-row--total"' : '';
      const filing = [item.sc13Filing, item.note].filter(Boolean).map((text) => escapeHtml(String(text))).join('<br>');
      return `
      <tr${rowClass}>
        <td style="text-align:left; font-weight:600;">${escapeHtml(item.name)}</td>
        <td class="col-number">${formatNumber(item.commonStock)}</td>
        <td class="col-number">${formatNumber(item.totalCses)}</td>
        <td class="col-number">${formatHolderPercent(item.pctOfClass)}</td>
        <td class="col-number">${formatHolderPercent(item.pctFullyDiluted)}</td>
        <td style="text-align:left;">${filing || '-'}</td>
      </tr>`;
    })
    .join('');
  localizeAppDom();
}

async function renderFixedValuePage() {
  const data = await api<{ items: FixedValueRecord[] }>('/api/fixed-values');
  if (data.items.length === 0) {
    el('fixedValuePageBody').innerHTML = '<tr><td colspan="6" class="table-empty-cell">暂无固定参数配置</td></tr>';
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
        <td><button class="btn btn-secondary btn-sm" data-action="edit-fixed-value" data-id="${item.id}" ${item.editable ? '' : 'disabled'}>edit</button></td>
      </tr>`,
    )
    .join('');

  el('fixedValuePageBody')
    .querySelectorAll<HTMLElement>('[data-action="edit-fixed-value"]')
    .forEach((button) => button.addEventListener('click', () => void editFixedValue(Number(button.dataset.id), data.items)));
  localizeAppDom();
}

async function editFixedValue(id: number, items: FixedValueRecord[]) {
  const item = items.find((row) => row.id === id);
  if (!item) return;
  const next = prompt(`Update ${item.label}:`, String(item.value));
  if (next === null) return;
  const value = Number(next.replace(/,/g, ''));
  if (!Number.isFinite(value)) {
    notify('请输入有效数字', { type: 'warning' });
    return;
  }
  await api(`/api/fixed-values/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ value, updatedBy: authStatus?.user?.displayName ?? 'Administrator' }),
  });
  await renderFixedValuePage();
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

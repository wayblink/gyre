import type {
  Employee,
  EmployeeMapping,
  Holding,
  LinkDetail,
  PaginatedResult,
  ProductFileDetail,
  ProductFileRecord,
  SourceChecklist,
  SummaryCapitalizationSource,
  SummarySnapshot,
  TrackedPlan,
  UpdatePlan,
  ShareholderTag,
} from '../shared/types.js';
import { createFilesPage } from './filesPage.js';
import {
  applyThemeSelection,
  COLOR_OPTIONS,
  getStoredTheme,
  getThemeColorOption,
  getThemeStyleOption,
  STYLE_OPTIONS,
  type ThemeColorName,
  type ThemeSelection,
  type ThemeStyleName,
} from './theme.js';
import { createWorkflowPage } from './workflowPage.js';
import '../../css/style.css';
import '@univerjs/design/lib/index.css';
import '@univerjs/ui/lib/index.css';
import '@univerjs/sheets-ui/lib/index.css';

let currentMonth = '2026-05';
let currentSummary: SummarySnapshot | null = null;
let updatePlans: UpdatePlan[] = [];
let currentPlan: UpdatePlan | null = null;
let currentFileList: SourceChecklist | null = null;
let uploadedFiles: File[] = [];
let employees: Employee[] = [];
let employeeMappings: EmployeeMapping[] = [];
let planManagements: TrackedPlan[] = [];
let shareholders: ShareholderTag[] = [];
let summarySourceFiles: ProductFileRecord[] = [];
let holdingsPage = 1;
let holdingsTotal = 0;
const holdingsPageSize = 20;
let employeesPage = 1;
let employeesTotal = 0;
const employeesPageSize = 20;

const pageTitles: Record<string, string> = {
  summary: 'Summary',
  monthly: 'Monthly Updates',
  files: 'Files',
  workflow: 'Workflow',
  holdings: 'Holdings',
  employees: 'Employees',
  settings: 'Settings',
};
type PageKey = keyof typeof pageTitles;
const DEFAULT_PAGE: PageKey = 'summary';
const validPages = new Set<PageKey>(Object.keys(pageTitles) as PageKey[]);
const SIDEBAR_COLLAPSED_STORAGE_KEY = 'captable.sidebar.collapsed';
let sidebarCollapsed = false;
let themeSelection: ThemeSelection = getStoredTheme();

let editingEmployeeId: number | null = null;

const filesPage = createFilesPage({
  el,
  api,
  apiBinary,
  escapeHtml,
  formatDateTime,
  formatFileSize,
});

const workflowPage = createWorkflowPage({
  el,
  api,
  escapeHtml,
  getProductFiles: () => filesPage.getProductFiles(),
  refreshProductFiles: () => filesPage.refreshProductFiles(),
});

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
}

async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const shouldSendJsonContentType =
    options.body !== undefined && options.body !== null && !(options.body instanceof FormData);
  const response = await fetch(url, {
    headers: shouldSendJsonContentType ? { 'Content-Type': 'application/json' } : undefined,
    ...options,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(body.error ?? response.statusText);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

async function apiBinary(url: string, options: RequestInit = {}): Promise<ArrayBuffer> {
  const response = await fetch(url, options);
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
  return 'status-pending';
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
  el('themeStyleOptions').innerHTML = STYLE_OPTIONS.map(
    (option) => `
      <button
        class="theme-card${themeSelection.style === option.name ? ' active' : ''}"
        type="button"
        data-theme-style="${option.name}"
      >
        <span class="theme-card-head">
          <span>
            <strong>${escapeHtml(option.label)}</strong>
            <small>${escapeHtml(option.desc)}</small>
          </span>
          ${themeSelection.style === option.name ? '<span class="theme-check">当前</span>' : ''}
        </span>
        <span class="theme-swatches" aria-hidden="true">
          ${option.swatches.map((color) => `<span class="theme-swatch" style="background-color:${escapeHtml(color)}"></span>`).join('')}
        </span>
      </button>`,
  ).join('');

  el('themeColorOptions').innerHTML = COLOR_OPTIONS.map(
    (option) => `
      <button
        class="theme-card${themeSelection.color === option.name ? ' active' : ''}"
        type="button"
        data-theme-color="${option.name}"
      >
        <span class="theme-card-head">
          <span>
            <strong>${escapeHtml(option.label)}</strong>
            <small>${escapeHtml(option.desc)}</small>
          </span>
          ${themeSelection.color === option.name ? '<span class="theme-check">当前</span>' : ''}
        </span>
        <span class="theme-swatches" aria-hidden="true">
          ${option.swatches.map((color) => `<span class="theme-swatch" style="background-color:${escapeHtml(color)}"></span>`).join('')}
        </span>
      </button>`,
  ).join('');

  document.querySelectorAll<HTMLElement>('[data-theme-style]').forEach((button) => {
    button.addEventListener('click', () => setThemeStyle(button.dataset.themeStyle as ThemeStyleName));
  });
  document.querySelectorAll<HTMLElement>('[data-theme-color]').forEach((button) => {
    button.addEventListener('click', () => setThemeColor(button.dataset.themeColor as ThemeColorName));
  });
}

function renderThemeSummary() {
  const styleOption = getThemeStyleOption(themeSelection.style);
  const colorOption = getThemeColorOption(themeSelection.color);
  el('settingsStyleStatus').textContent = styleOption.label;
  el('settingsColorStatus').textContent = colorOption.label;
  el('appearanceSummaryTitle').textContent = `${styleOption.label} ${colorOption.label}`;
  el('appearanceSummaryText').textContent =
    themeSelection.style === 'glass'
      ? `${colorOption.label} 配色下启用玻璃高光与更强层次，适合更强调品牌感和视觉表现的工作台。`
      : `${colorOption.label} 配色下保持克制、清晰的扁平企业风格，适合高频使用和长时间操作。`;
}

function applyTheme() {
  applyThemeSelection(themeSelection);
  if (document.getElementById('themeStyleOptions')) {
    renderThemeCards();
    renderThemeSummary();
  }
}

function setThemeStyle(style: ThemeStyleName) {
  if (themeSelection.style === style) return;
  themeSelection = { ...themeSelection, style };
  applyTheme();
}

function setThemeColor(color: ThemeColorName) {
  if (themeSelection.color === color) return;
  themeSelection = { ...themeSelection, color };
  applyTheme();
}

function normalizePage(page: string | null | undefined): PageKey {
  const value = page?.trim().toLowerCase() ?? '';
  return validPages.has(value as PageKey) ? (value as PageKey) : DEFAULT_PAGE;
}

function buildPagePath(page: PageKey): string {
  return page === DEFAULT_PAGE ? `/${DEFAULT_PAGE}` : `/${page}`;
}

function getPageFromLocation(): PageKey {
  const path = window.location.pathname.replace(/^\/+|\/+$/g, '');
  const page = path.split('/')[0]?.split('?')[0] ?? '';
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
  document.querySelectorAll<HTMLElement>('.nav-item').forEach((node) => {
    const isActive = node.dataset.page === targetPage;
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
  el('pageTitle').textContent = pageTitles[targetPage];
}

async function activatePage(page: PageKey) {
  if (page === 'summary') {
    await refreshSummarySourceFileOptions();
    await renderSummaryPage(currentMonth);
    return;
  }

  if (page === 'files') {
    await filesPage.refreshProductFiles();
    return;
  }

  if (page === 'workflow') {
    workflowPage.onActivate();
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

  el('btnSearch').addEventListener('click', () => {
    const month = el<HTMLInputElement>('monthPicker').value;
    if (!month) return alert('请选择月份');
    currentMonth = month;
    void renderSummaryPage(month);
    void renderHoldingsPage(month);
  });
  el('btnReset').addEventListener('click', () => {
    currentMonth = '2026-05';
    el<HTMLInputElement>('monthPicker').value = currentMonth;
    void renderSummaryPage(currentMonth);
  });
  el('btnExport').addEventListener('click', () => exportData());
  el('btnSaveSummaryToFiles').addEventListener('click', () => void saveSummaryToFiles());
  el('btnRefresh').addEventListener('click', () => void renderSummaryPage(currentMonth));
  el('btnSearchMonthly').addEventListener('click', () => void renderMonthlyPage(el<HTMLInputElement>('monthPickerMonthly').value));
}

async function initSummaryPage() {
  await refreshSummarySourceFileOptions();
  await renderSummaryPage(currentMonth);
  el('btnSaveCapitalizationSource').addEventListener('click', () => void saveCapitalizationSource());
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
    if (!content) return alert('请输入备注内容');
    await api(`/api/months/${currentMonth}/notes`, { method: 'POST', body: JSON.stringify({ content }) });
    input.value = '';
    el('addNoteForm').classList.add('hidden');
    await renderSummaryPage(currentMonth);
  });
}

async function renderSummaryPage(month: string) {
  try {
    const data = await api<SummarySnapshot>(`/api/months/${month}/summary`);
    currentSummary = data;
    el('currentMonthText').textContent = formatMonthCN(month);
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
          return `<tr class="cat-header-blue"><td></td><td colspan="4" style="text-align:left;">${escapeHtml(item.description)}</td></tr>`;
        }
        if (item.type === 'cat-sub-label') {
          const sharesHtml = item.shares === undefined ? '' : item.highlightShares ? `<span class="highlight-yellow">${formatNumber(item.shares)}</span>` : formatNumber(item.shares);
          return `<tr class="cat-sub-label">
            <td></td><td style="text-align:left;">${escapeHtml(item.description)}</td>
            <td class="col-number">${sharesHtml}</td><td></td><td class="col-formula">${item.formula ?? ''}</td>
          </tr>`;
        }
        const percent = item.percent === null || item.percent === undefined ? '' : item.percent < 1 ? `${(item.percent * 100).toFixed(2)}%` : `${item.percent.toFixed(2)}%`;
        return `<tr class="cap-data-row">
          <td>${escapeHtml(item.number ?? '')}</td>
          <td style="text-align:left;">${escapeHtml(item.description)}</td>
          <td class="col-number">${formatNumber(item.shares)}</td>
          <td class="col-percent">${percent}</td>
          <td class="col-formula">${item.formula ?? ''}</td>
        </tr>`;
      })
      .join('');
    el('totalShares').textContent = formatNumber(data.totalFullyDiluted);
    applyCapitalizationSourceState(data.capitalizationSource ?? null);
    capBody.querySelectorAll<HTMLElement>('.link-blue').forEach((link) => {
      link.addEventListener('click', () => void openLinkModal(link.dataset.link ?? ''));
    });
    renderNotes(data.notes);
  } catch (error) {
    currentSummary = null;
    el('reconciliationBody').innerHTML = `<tr><td colspan="5" class="table-empty-cell">${escapeHtml((error as Error).message)}</td></tr>`;
    el('capitalizationBody').innerHTML = '';
    applyCapitalizationSourceState(null);
    renderNotes([]);
  }
}

async function refreshSummarySourceFileOptions() {
  const data = await api<{ files: ProductFileRecord[] }>('/api/files');
  summarySourceFiles = data.files;
  const select = el<HTMLSelectElement>('capitalizationSourceFile');
  const currentValue = select.value;
  select.innerHTML = [
    '<option value="">默认快照数据</option>',
    ...summarySourceFiles.map((file) => `<option value="${file.id}">${escapeHtml(file.originalName)}</option>`),
  ].join('');
  if (currentValue && summarySourceFiles.some((file) => String(file.id) === currentValue)) {
    select.value = currentValue;
  }
}

function applyCapitalizationSourceState(source: SummaryCapitalizationSource | null) {
  const select = el<HTMLSelectElement>('capitalizationSourceFile');
  const sheetInput = el<HTMLInputElement>('capitalizationSourceSheet');
  const badge = el('capitalizationSourceBadge');

  select.value = source?.fileId ? String(source.fileId) : '';
  sheetInput.value = source?.sheetName ?? '';
  badge.textContent = source?.fileName
    ? `Capitalization Source: ${source.fileName}${source.sheetName ? ` / ${source.sheetName}` : ''}`
    : 'Capitalization Source: Snapshot';
}

async function saveCapitalizationSource() {
  const select = el<HTMLSelectElement>('capitalizationSourceFile');
  const sheetInput = el<HTMLInputElement>('capitalizationSourceSheet');
  const button = el<HTMLButtonElement>('btnSaveCapitalizationSource');
  const previousText = button.textContent ?? 'Set Source';

  button.disabled = true;
  button.textContent = 'Saving...';

  try {
    await api(`/api/months/${currentMonth}/capitalization-source`, {
      method: 'PUT',
      body: JSON.stringify({
        fileId: select.value ? Number(select.value) : null,
        sheetName: sheetInput.value.trim() || null,
      }),
    });
    await renderSummaryPage(currentMonth);
    alert('Capitalization Table 数据来源已更新');
  } catch (error) {
    alert((error as Error).message);
  } finally {
    button.disabled = false;
    button.textContent = previousText;
  }
}

function renderNotes(notes: SummarySnapshot['notes']) {
  const container = el('notesContainer');
  if (!notes || notes.length === 0) {
    container.innerHTML = '<div class="note-empty">暂无备注，点击右上角添加备注按钮添加</div>';
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
      if (!confirm('确定删除此备注吗？')) return;
      await api(`/api/notes/${button.dataset.id}`, { method: 'DELETE' });
      await renderSummaryPage(currentMonth);
    });
  });
}

async function initMonthlyPage() {
  await renderMonthlyPage('');
  el('btnAddUpdate').addEventListener('click', () => {
    el<HTMLInputElement>('newPlanMonth').value = '2026-06';
    el<HTMLInputElement>('newPlanOperator').value = 'Gu';
    el<HTMLTextAreaElement>('newPlanRemark').value = '';
    uploadedFiles = [];
    renderUploadFileList();
    el('addPlanModal').classList.remove('hidden');
  });
  el('btnCloseAddModal').addEventListener('click', () => el('addPlanModal').classList.add('hidden'));
  el('btnCancelAddModal').addEventListener('click', () => el('addPlanModal').classList.add('hidden'));
  el('btnSubmitAdd').addEventListener('click', submitNewPlan);
  el('btnCloseModal').addEventListener('click', closeFileModal);
  el('btnSkipUpload').addEventListener('click', skipWarnings);
  el('btnSaveExit').addEventListener('click', closeFileModal);
  el('btnConfirmUpdate').addEventListener('click', confirmUpdate);
  initFileUpload();
}

async function submitNewPlan() {
  const month = el<HTMLInputElement>('newPlanMonth').value;
  const operator = el<HTMLInputElement>('newPlanOperator').value.trim();
  const remark = el<HTMLTextAreaElement>('newPlanRemark').value.trim();
  if (!month || !operator) return alert('请填写月份和操作人');
  const plan = await api<UpdatePlan>('/api/update-plans', { method: 'POST', body: JSON.stringify({ month, operator, remark }) });
  for (const file of uploadedFiles) {
    const form = new FormData();
    form.append('sourceGroup', 'initial');
    form.append('file', file);
    await api(`/api/update-plans/${plan.id}/source-files`, { method: 'POST', body: form });
  }
  el('addPlanModal').classList.add('hidden');
  await renderMonthlyPage('');
}

async function renderMonthlyPage(filterMonth: string) {
  const data = await api<{ plans: UpdatePlan[] }>(`/api/update-plans${filterMonth ? `?month=${encodeURIComponent(filterMonth)}` : ''}`);
  updatePlans = data.plans;
  el('planTotalCount').textContent = String(updatePlans.length);
  el('planCompletedCount').textContent = String(updatePlans.filter((plan) => plan.status === '已完成').length);
  el('planInProgressCount').textContent = String(updatePlans.filter((plan) => plan.status === '进行中').length);
  el('planPendingCount').textContent = String(updatePlans.filter((plan) => plan.status === '待启动').length);

  const tbody = el('monthlyUpdateBody');
  if (updatePlans.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="table-empty-cell">暂无月度更新计划</td></tr>';
    return;
  }
  tbody.innerHTML = updatePlans
    .map(
      (plan, index) => `
      <tr>
        <td>${index + 1}</td>
        <td><strong>${escapeHtml(plan.monthLabel)}</strong><br><span class="text-muted" style="font-size:11px;">${escapeHtml(plan.month)}</span></td>
        <td>${escapeHtml(plan.operationTime)}</td>
        <td>${escapeHtml(plan.operator)}</td>
        <td><span class="status-badge ${statusClass(plan.status)}">${escapeHtml(plan.status)}</span></td>
        <td><div class="action-buttons">
          <button class="btn btn-primary" data-action="view" data-id="${plan.id}">查看详情</button>
          <button class="btn btn-secondary" data-action="edit" data-id="${plan.id}">编辑</button>
          <button class="btn btn-danger" data-action="delete" data-id="${plan.id}">删除</button>
        </div></td>
      </tr>`,
    )
    .join('');
  tbody.querySelectorAll<HTMLElement>('[data-action="view"]').forEach((button) => button.addEventListener('click', () => void openFileModal(Number(button.dataset.id))));
  tbody.querySelectorAll<HTMLElement>('[data-action="edit"]').forEach((button) => button.addEventListener('click', () => void editUpdatePlan(Number(button.dataset.id))));
  tbody.querySelectorAll<HTMLElement>('[data-action="delete"]').forEach((button) => button.addEventListener('click', () => void deleteUpdatePlan(Number(button.dataset.id))));
}

async function editUpdatePlan(id: number) {
  const plan = updatePlans.find((item) => item.id === id);
  if (!plan) return;
  const month = prompt('修改月份（格式：YYYY-MM）：', plan.month);
  if (month === null) return;
  const operator = prompt('修改操作人：', plan.operator);
  if (operator === null) return;
  await api(`/api/update-plans/${id}`, { method: 'PATCH', body: JSON.stringify({ month, operator }) });
  await renderMonthlyPage('');
}

async function deleteUpdatePlan(id: number) {
  const plan = updatePlans.find((item) => item.id === id);
  if (!plan || !confirm(`确定删除【${plan.monthLabel}】的更新计划吗？此操作不可撤销。`)) return;
  await api(`/api/update-plans/${id}`, { method: 'DELETE' });
  await renderMonthlyPage('');
}

async function openFileModal(planId: number) {
  currentPlan = updatePlans.find((plan) => plan.id === planId) ?? null;
  if (!currentPlan) return;
  currentFileList = await api<SourceChecklist>(`/api/update-plans/${planId}/checklist`);
  el('modalMonth').textContent = `${formatMonthCN(currentPlan.month)} (${currentPlan.monthLabel})`;
  el('modalOperator').textContent = currentPlan.operator;
  el('modalStatus').innerHTML = `<span class="status-badge ${statusClass(currentPlan.status)}">${escapeHtml(currentPlan.status)}</span>`;
  el('modalTitle').textContent = `【${currentPlan.monthLabel}】数据更新 - 文件检查`;
  renderSourceTables();
  el('fileCheckModal').classList.remove('hidden');
}

function closeFileModal() {
  el('fileCheckModal').classList.add('hidden');
  currentPlan = null;
  currentFileList = null;
}

function renderSourceTables() {
  if (!currentFileList) return;
  el('fixedValueBody').innerHTML = currentFileList.fixedValues
    .map(
      (item) => `
      <tr>
        <td style="text-align:left;">${escapeHtml(item.item)}</td>
        <td class="col-number">${formatNumber(item.value)}</td>
        <td>${item.action === 'edit' ? `<a href="javascript:void(0)" class="source-edit-link" data-table="fixed" data-id="${item.id}">edit</a>` : '<span class="source-empty-value">-</span>'}</td>
      </tr>`,
    )
    .join('');

  el('shareworksBody').innerHTML = currentFileList.shareworksData.map((item) => sourceMetricRow(item, 'shareworks')).join('');
  el('futuBody').innerHTML = currentFileList.futuData.map((item) => sourceMetricRow(item, 'futu')).join('');

  document.querySelectorAll<HTMLElement>('.source-edit-link').forEach((link) => {
    link.addEventListener('click', () => void editMetric(Number(link.dataset.id)));
  });
  document.querySelectorAll<HTMLElement>('.source-upload-btn').forEach((button) => {
    button.addEventListener('click', () => void uploadMetricFile(button.dataset.table ?? 'unknown', Number(button.dataset.id)));
  });
  document.querySelectorAll<HTMLElement>('.source-file-delete').forEach((button) => {
    button.addEventListener('click', () => void clearMetricFile(Number(button.dataset.id)));
  });
}

function sourceMetricRow(item: SourceChecklist['shareworksData'][number], table: 'shareworks' | 'futu'): string {
  const statusIcon =
    item.status === 'pass'
      ? '<span class="source-status-icon source-status-pass" title="Pass">&#10003;</span>'
      : item.status === 'warning'
        ? '<span class="source-status-icon source-status-warning" title="Warning">&#9888;</span>'
        : '<span class="source-empty-value">-</span>';
  const required = !item.isRequired
    ? '<span class="source-empty-value">-</span>'
    : item.isRequired === 'Required'
      ? '<span class="source-required-badge">Required</span>'
      : '<span class="source-optional-badge">Optional</span>';
  const uploaded =
    !item.uploadedFile || item.uploadedFile === 'Not uploaded'
      ? `<span class="source-not-uploaded">Not uploaded</span> ${item.fileName ? `<button class="source-upload-btn" data-table="${table}" data-id="${item.id}">Upload</button>` : ''}`
      : `<div class="source-file-actions"><a href="javascript:void(0)" class="source-file-link" title="${escapeHtml(item.uploadedFile)}">${escapeHtml(item.uploadedFile)}</a><button class="source-file-delete" data-id="${item.id}" title="Delete file">&times;</button></div>`;
  const label = table === 'shareworks' ? escapeHtml(item.item ?? '') : escapeHtml(item.metric ?? '');
  return `<tr>
    <td style="text-align:left;${item.fileName ? ' font-weight:600;' : ''}">${escapeHtml(item.fileName)}</td>
    <td>${required}</td>
    <td>${uploaded}</td>
    <td style="text-align:left;">${label || '<span class="source-empty-value">-</span>'}</td>
    <td style="text-align:center;">${statusIcon}</td>
    <td>${item.value === null || item.value === undefined ? '<span class="source-empty-value">-</span>' : `<span class="col-number">${formatNumber(item.value)}</span>`}</td>
    <td>${item.action === 'edit' ? `<a href="javascript:void(0)" class="source-edit-link" data-id="${item.id}">edit</a>` : '<span class="source-empty-value">-</span>'}</td>
  </tr>`;
}

async function editMetric(metricId: number) {
  if (!metricId) return;
  const current = findMetric(metricId);
  const next = prompt('Enter new value:', current?.value === null || current?.value === undefined ? '' : String(current.value));
  if (next === null) return;
  const value = Number(next);
  if (!Number.isFinite(value)) return alert('请输入有效数字');
  await api(`/api/source-metrics/${metricId}`, { method: 'PATCH', body: JSON.stringify({ value, status: 'pass' }) });
  if (currentPlan) {
    currentFileList = await api<SourceChecklist>(`/api/update-plans/${currentPlan.id}/checklist`);
    renderSourceTables();
  }
}

function findMetric(id: number) {
  if (!currentFileList) return undefined;
  return [...currentFileList.fixedValues, ...currentFileList.shareworksData, ...currentFileList.futuData].find((item) => item.id === id);
}

async function uploadMetricFile(sourceGroup: string, metricId: number) {
  if (!currentPlan || !metricId) return;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.xlsx,.xls,.csv';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append('sourceGroup', sourceGroup);
    form.append('metricId', String(metricId));
    form.append('file', file);
    await api(`/api/update-plans/${currentPlan?.id}/source-files`, { method: 'POST', body: form });
    currentFileList = await api<SourceChecklist>(`/api/update-plans/${currentPlan?.id}/checklist`);
    renderSourceTables();
  });
  input.click();
}

async function clearMetricFile(metricId: number) {
  await api(`/api/source-metrics/${metricId}`, { method: 'PATCH', body: JSON.stringify({ uploadedFile: 'Not uploaded', status: '' }) });
  if (currentPlan) {
    currentFileList = await api<SourceChecklist>(`/api/update-plans/${currentPlan.id}/checklist`);
    renderSourceTables();
  }
}

async function skipWarnings() {
  if (!currentFileList || !currentPlan) return;
  const warningIds = [...currentFileList.shareworksData, ...currentFileList.futuData].filter((item) => item.status === 'warning' && item.id).map((item) => item.id);
  await Promise.all(warningIds.map((id) => api(`/api/source-metrics/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'pass' }) })));
  currentFileList = await api<SourceChecklist>(`/api/update-plans/${currentPlan.id}/checklist`);
  renderSourceTables();
}

async function confirmUpdate() {
  if (!currentPlan || !currentFileList) return;
  const rows = [...currentFileList.shareworksData, ...currentFileList.futuData].filter((item) => item.status);
  const passCount = rows.filter((item) => item.status === 'pass').length;
  if (!confirm(`共 ${rows.length} 个数据项，${passCount} 个检查通过。\n确认无误，开始执行数据更新？`)) return;
  await api(`/api/update-plans/${currentPlan.id}/generate-snapshot`, { method: 'POST' });
  closeFileModal();
  await renderMonthlyPage('');
  await renderSummaryPage(currentMonth);
}

async function initHoldingsPage() {
  await renderHoldingsPage(currentMonth);
  el('btnSearchHoldings').addEventListener('click', searchHoldingsPage);
  el('btnHoldingsPrevPage').addEventListener('click', () => changeHoldingsPage(-1));
  el('btnHoldingsNextPage').addEventListener('click', () => changeHoldingsPage(1));
}

async function initEmployeesPage() {
  el('btnSearchEmployeesPage').addEventListener('click', searchEmployeesPage);
  el('btnAddEmployeesPage').addEventListener('click', () => openEmployeesPageModal());
  el('btnSubmitEmployeesPage').addEventListener('click', () => void submitEmployeesPage());
  el('btnEmployeesPrevPage').addEventListener('click', () => changeEmployeesPage(-1));
  el('btnEmployeesNextPage').addEventListener('click', () => changeEmployeesPage(1));
  await loadEmployeesPage();
}


function renderHoldingsPagination(page: number, totalPages: number, total: number) {
  const start = total === 0 ? 0 : (page - 1) * holdingsPageSize + 1;
  const end = Math.min(page * holdingsPageSize, total);
  el('holdingsPaginationSummary').textContent = total === 0 ? '0 records' : `Showing ${start}-${end} of ${total} records`;
  el('holdingsPaginationPage').textContent = `${total === 0 ? 0 : page} / ${Math.max(totalPages, 1)}`;
  el<HTMLButtonElement>('btnHoldingsPrevPage').disabled = page <= 1;
  el<HTMLButtonElement>('btnHoldingsNextPage').disabled = total === 0 || page >= totalPages;
}

function renderEmployeesPagination(page: number, totalPages: number, total: number) {
  const start = total === 0 ? 0 : (page - 1) * employeesPageSize + 1;
  const end = Math.min(page * employeesPageSize, total);
  el('employeesPaginationSummary').textContent = total === 0 ? '0 employees' : `Showing ${start}-${end} of ${total} employees`;
  el('employeesPaginationPage').textContent = `${total === 0 ? 0 : page} / ${Math.max(totalPages, 1)}`;
  el<HTMLButtonElement>('btnEmployeesPrevPage').disabled = page <= 1;
  el<HTMLButtonElement>('btnEmployeesNextPage').disabled = total === 0 || page >= totalPages;
}

function searchHoldingsPage() {
  holdingsPage = 1;
  void renderHoldingsPage(currentMonth);
}

function changeHoldingsPage(delta: number) {
  const currentPage = holdingsPage;
  const maxPage = Math.max(1, Math.ceil(holdingsTotal / holdingsPageSize));
  const nextPage = Math.min(Math.max(1, currentPage + delta), maxPage);
  if (nextPage === currentPage) return;
  holdingsPage = nextPage;
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

async function renderHoldingsPage(month: string) {
  const query = el<HTMLInputElement>('searchHolder').value.trim();
  const tag = el<HTMLInputElement>('filterHoldingsTag').value.trim();
  const grantType = el<HTMLSelectElement>('filterGrantType').value;
  const data = await api<PaginatedResult<Holding>>(
    `/api/holdings?month=${month}&query=${encodeURIComponent(query)}&grantType=${encodeURIComponent(grantType)}&tag=${encodeURIComponent(tag)}&page=${holdingsPage}&pageSize=${holdingsPageSize}`,
  );
  const items = data.holdings ?? [];
  holdingsPage = data.page;
  holdingsTotal = data.total;
  renderHoldingsPagination(data.page, data.totalPages, data.total);
  const tbody = el('holdingsBody');
  if (items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="25" style="text-align:center; padding:var(--space-10); color:var(--text-muted);">No matching records found</td></tr>';
    return;
  }
  tbody.innerHTML = items
    .map(
      (item, index) => `
      <tr>
        <td>${(data.page - 1) * data.pageSize + index + 1}</td>
        <td style="text-align:left; font-weight:var(--font-semibold);">${escapeHtml(item.employeeName)}</td>
        <td>${escapeHtml(item.employeeNumber)}</td>
        <td>${escapeHtml(item.userId)}</td>
        <td style="text-align:left;">${escapeHtml(formatTags(item.tags))}</td>
        <td>${escapeHtml(item.grantNumber)}</td>
        <td><span class="grant-type-badge ${getGrantTypeClass(String(item.incentiveType))}">${escapeHtml(item.incentiveType)}</span></td>
        <td>${escapeHtml(item.grantDate)}</td>
        <td class="col-number">${formatNumber(item.grantQuantity)}</td>
        <td class="col-number">${item.grantPriceUsd === null ? '-' : `$${Number(item.grantPriceUsd).toFixed(2)}`}</td>
        <td>${escapeHtml(item.expireDate)}</td>
        <td style="text-align:left;">${escapeHtml(item.planName)}</td>
        <td>${escapeHtml(item.conditionRule)}</td>
        <td>${escapeHtml(item.employeePortalVisibility)}</td>
        <td>${escapeHtml(item.taxRule)}</td>
        <td style="text-align:left;">${escapeHtml(item.vestingRuleName)}</td>
        <td>${escapeHtml(item.vestingStartDate)}</td>
        <td class="col-number">${formatNumber(item.vestedQuantity)}</td>
        <td class="col-number">${formatNumber(item.effectiveVestedQuantity)}</td>
        <td class="col-number">${formatNumber(item.unvestedQuantity)}</td>
        <td class="col-number">${formatNumber(item.exercisedQuantity)}</td>
        <td class="col-number">${formatNumber(item.pendingExerciseQuantity)}</td>
        <td class="col-number" style="font-weight:var(--font-semibold);">${formatNumber(item.outstandingQuantity)}</td>
        <td class="col-number">${formatNumber(item.sellableQuantity)}</td>
        <td>${escapeHtml(item.dataSource)}</td>
      </tr>`,
    )
    .join('');
}

async function loadEmployeesPage() {
  const query = el<HTMLInputElement>('searchEmployeesPage').value.trim();
  const tag = el<HTMLInputElement>('filterEmployeesPageTag').value.trim();
  const data = await api<PaginatedResult<Employee>>(
    `/api/employees?query=${encodeURIComponent(query)}&tag=${encodeURIComponent(tag)}&page=${employeesPage}&pageSize=${employeesPageSize}`,
  );
  employees = data.items ?? [];
  employeesPage = data.page;
  employeesTotal = data.total;
  renderEmployeesPagination(data.page, data.totalPages, data.total);
  renderEmployeesPageTable();
}

function renderEmployeesPageTable() {
  if (employees.length === 0) {
    el('employeesPageBody').innerHTML =
      '<tr><td colspan="7" class="table-empty-cell">No matching employees found</td></tr>';
    return;
  }
  el('employeesPageBody').innerHTML = employees
    .map(
      (item, index) => `
      <tr>
        <td>${(employeesPage - 1) * employeesPageSize + index + 1}</td>
        <td style="text-align:left; font-weight:600;">${escapeHtml(item.employeeName)}</td>
        <td>${escapeHtml(item.employeeNumber)}</td>
        <td>${escapeHtml(item.userId)}</td>
        <td style="text-align:left;">${escapeHtml(formatTags(item.tags))}</td>
        <td class="col-number">${formatNumber(item.grantCount)}</td>
        <td>
          <div class="action-buttons">
            <button class="btn btn-secondary btn-sm" data-action="edit-employee-page" data-id="${item.id}">编辑</button>
            <button class="btn btn-danger btn-sm" data-action="delete-employee-page" data-id="${item.id}">删除</button>
          </div>
        </td>
      </tr>`,
    )
    .join('');
  el('employeesPageBody')
    .querySelectorAll<HTMLElement>('[data-action="edit-employee-page"]')
    .forEach((button) => button.addEventListener('click', () => openEmployeesPageModal(Number(button.dataset.id))));
  el('employeesPageBody')
    .querySelectorAll<HTMLElement>('[data-action="delete-employee-page"]')
    .forEach((button) => button.addEventListener('click', () => void deleteEmployeesPage(Number(button.dataset.id))));
}

function openEmployeesPageModal(id?: number) {
  editingEmployeeId = id ?? null;
  const item = employees.find((row) => row.id === id);
  el('employeesPageModalTitle').textContent = item ? 'Edit Employee' : 'New Employee';
  el<HTMLInputElement>('employeesPageName').value = item?.employeeName ?? '';
  el<HTMLInputElement>('employeesPageNumber').value = item?.employeeNumber ?? '';
  el<HTMLInputElement>('employeesPageUserId').value = item?.userId ?? '';
  el<HTMLInputElement>('employeesPageTags').value = item?.tags.join(', ') ?? '';
  el('employeesPageModal').classList.remove('hidden');
}

async function submitEmployeesPage() {
  const employeeName = el<HTMLInputElement>('employeesPageName').value.trim();
  const employeeNumber = el<HTMLInputElement>('employeesPageNumber').value.trim();
  const userId = el<HTMLInputElement>('employeesPageUserId').value.trim();
  const tags = parseTagInput(el<HTMLInputElement>('employeesPageTags').value);
  if (!employeeName || !employeeNumber) return alert('请填写员工姓名和工号');

  const payload = { employeeName, employeeNumber, userId, tags };
  if (editingEmployeeId) {
    await api(`/api/employees/${editingEmployeeId}`, { method: 'PATCH', body: JSON.stringify(payload) });
  } else {
    await api('/api/employees', { method: 'POST', body: JSON.stringify(payload) });
  }
  el('employeesPageModal').classList.add('hidden');
  editingEmployeeId = null;
  await loadEmployeesPage();
}

async function deleteEmployeesPage(id: number) {
  const item = employees.find((row) => row.id === id);
  if (!item || !confirm(`确定删除员工【${item.employeeName}】吗？`)) return;
  await api(`/api/employees/${id}`, { method: 'DELETE' });
  await loadEmployeesPage();
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
  renderThemeCards();
  renderThemeSummary();
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
}

async function submitEmployee() {
  const name = el<HTMLInputElement>('newEmpName').value.trim();
  const empId = el<HTMLInputElement>('newEmpId').value.trim();
  if (!name || !empId) return alert('请填写员工姓名和身份ID');
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
  if (!item || !confirm(`确定删除员工【${item.name}】吗？`)) return;
  await api(`/api/settings/employee-mappings/${id}`, { method: 'DELETE' });
  await loadEmployees();
}

async function submitTrackedPlan() {
  const name = el<HTMLInputElement>('newPlanName').value.trim();
  if (!name) return alert('请填写计划名称');
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
  if (!item || !confirm(`确定删除计划【${item.name}】吗？`)) return;
  await api(`/api/settings/tracked-plans/${id}`, { method: 'DELETE' });
  await loadPlans();
}

async function submitShareholder() {
  const name = el<HTMLInputElement>('newShName').value.trim();
  const identity = el<HTMLInputElement>('newShId').value.trim();
  if (!name || !identity) return alert('请填写股东姓名和身份信息');
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
  if (!item || !confirm(`确定删除股东【${item.name}】吗？`)) return;
  await api(`/api/settings/shareholders/${id}`, { method: 'DELETE' });
  await loadShareholders();
}

function initFileUpload() {
  const dropzone = el('uploadDropzone');
  const fileInput = el<HTMLInputElement>('fileInput');
  el('dropzoneContent').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    if (fileInput.files) addFiles(fileInput.files);
    fileInput.value = '';
  });
  dropzone.addEventListener('dragover', (event) => {
    event.preventDefault();
    dropzone.classList.add('drag-over');
  });
  dropzone.addEventListener('dragleave', (event) => {
    event.preventDefault();
    dropzone.classList.remove('drag-over');
  });
  dropzone.addEventListener('drop', (event) => {
    event.preventDefault();
    dropzone.classList.remove('drag-over');
    if (event.dataTransfer?.files) addFiles(event.dataTransfer.files);
  });
}

function addFiles(fileList: FileList) {
  for (const file of Array.from(fileList)) {
    if (!uploadedFiles.some((existing) => existing.name === file.name && existing.size === file.size)) uploadedFiles.push(file);
  }
  renderUploadFileList();
}

function renderUploadFileList() {
  const container = el('uploadFileList');
  container.innerHTML = uploadedFiles
    .map((file, index) => {
      const ext = file.name.split('.').pop()?.toLowerCase() ?? 'file';
      return `<div class="upload-file-item">
        <div class="upload-file-icon ${escapeHtml(ext)}">${escapeHtml(ext.slice(0, 4))}</div>
        <div class="upload-file-info"><div class="upload-file-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</div><div class="upload-file-size">${formatFileSize(file.size)}</div></div>
        <button class="upload-file-remove" data-remove="${index}" title="Remove">x</button>
      </div>`;
    })
    .join('');
  container.querySelectorAll<HTMLElement>('[data-remove]').forEach((button) => {
    button.addEventListener('click', () => {
      uploadedFiles.splice(Number(button.dataset.remove), 1);
      renderUploadFileList();
    });
  });
}

function formatFileSize(bytes: number) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, index)).toFixed(index > 0 ? 1 : 0)} ${units[index]}`;
}

function exportData() {
  if (!currentSummary) return alert('当前月份没有可导出的摘要数据');
  let csv = '\ufeff';
  csv += `CapTable 股权数据 - ${formatMonthCN(currentMonth)}\n\n`;
  csv += '【流通股份对账】\n项目,截至日期,上月末,本月新增,本月末\n';
  csv += `${currentSummary.reconciliation.item},${currentSummary.eomDate},${currentSummary.reconciliation.lastMonth},${currentSummary.reconciliation.newShares},${currentSummary.reconciliation.eomBalance}\n\n`;
  csv += '【资本结构】\nDescription,股份,占比\n';
  currentSummary.capitalization.forEach((item) => {
    csv += `"${item.description}",${item.shares ?? ''},${item.percent ?? ''}\n`;
  });
  csv += `完全稀释总股份,${currentSummary.totalFullyDiluted},100%\n`;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `CapTable_${currentMonth}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

async function saveSummaryToFiles() {
  if (!currentSummary) {
    alert('当前月份没有可保存的摘要数据');
    return;
  }

  const button = el<HTMLButtonElement>('btnSaveSummaryToFiles');
  const previousLabel = button.innerHTML;
  button.disabled = true;
  button.textContent = 'Saving...';

  try {
    const result = await api<ProductFileDetail>(`/api/months/${currentMonth}/capitalization-summary-file`, {
      method: 'POST',
    });
    await filesPage.refreshProductFiles();
    alert(`已保存到 Files：${result.file.originalName}`);
  } catch (error) {
    alert((error as Error).message);
  } finally {
    button.disabled = false;
    button.innerHTML = previousLabel;
  }
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
}

function initLinkModal() {
  const close = () => el('linkDetailModal').classList.add('hidden');
  el('btnCloseLinkModal').addEventListener('click', close);
  el('btnCloseLinkModalFooter').addEventListener('click', close);
  el('linkDetailModal').addEventListener('click', (event) => {
    if (event.target === el('linkDetailModal')) close();
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  try {
    applyTheme();
    initSidebarToggle();
    applyInitialRouteBeforeReveal();
    initNavigation();
    initMonthPicker();
    await initSummaryPage();
    await initMonthlyPage();
    await filesPage.init();
    await workflowPage.init();
    await initHoldingsPage();
    await initEmployeesPage();
    await initSettingsPage();
    initLinkModal();
  } catch (error) {
    console.error(error);
    alert((error as Error).message);
  }
});

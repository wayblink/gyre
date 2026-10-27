import type { AppLanguage } from './i18n.js';
import { createTexts } from './texts.js';
import type { NotifyFn } from './uiFeedback.js';
import { paginationSummaryText, renderSortIndicators, sortQuery } from './tableSort.js';
import type {
  CancellationRecord,
  ExerciseRecord,
  Holding,
  SoldShare,
  WorkflowPageSourceBinding,
  WorkflowResultFileBinding,
  MergedExercise,
  MergedGrant,
  PaginatedResult,
  ShareworksExercise,
  ShareworksGrant,
} from '../shared/types.js';
import { edgePage, nextPageWithinBounds, pageCountOf, paginationView, renderPaginationControls } from './pagination.js';

/**
 * The three ESOP table pages: grant records (Futu / Shareworks / merged views), exercise records
 * (the same three views) and sold shares.
 *
 * They are one module rather than three because they share the view state, the sort state, the
 * pagination plumbing and — crucially — each other: the holdings page can switch the exercise page's
 * view and the sold-shares page re-renders the exercise table, so splitting them would only move
 * the coupling into a fourth module.
 */

export type GrantView = 'futu' | 'shareworks' | 'merge';
export type ExerciseView = 'futu' | 'shareworks' | 'merge';

export type EsopTablesDeps = {
  el: <T extends HTMLElement>(id: string) => T;
  api: <T>(url: string, options?: RequestInit) => Promise<T>;
  escapeHtml: (text: unknown) => string;
  formatNumber: (value: unknown) => string;
  formatCurrency: (value: number, currency?: 'USD' | 'CNY') => string;
  notify: NotifyFn;
  /** Employee labels are loaded by the employees page and shared with the table filters. */
  linkedBadge: (identities: unknown, lang: AppLanguage, escape: (text: unknown) => string) => string;

  grantTypeClass: (type: string) => string;
  setPageSourceFiles: (
    page: string,
    response: {
      sourceFiles?: string[];
      workflowSourceBindings?: WorkflowPageSourceBinding[];
      workflowResultFiles?: WorkflowResultFileBinding[];
      resultFiles?: string[];
      resultFileName?: string | null;
    },
  ) => void;
  localizeDom: () => void;
  getLanguage: () => AppLanguage;
};

export type EsopTablesHost = {
  getMonth: () => string;
  renderMonthPicker: (
    containerId: string,
    month: string,
    availabilityKey: 'hasCapTableData' | 'hasPlanSummaryData',
  ) => void;
  loadEmployeeLabels: () => Promise<void>;
};

export type EsopTables = {
  renderHoldings: (month: string) => Promise<void>;
  renderExercises: (options?: { autoSelectView?: boolean }) => Promise<void>;
  renderSoldShares: () => Promise<void>;
  renderCancellationRecords: () => Promise<void>;
  applyGrantView: () => void;
  applyExerciseView: () => void;
  /** Re-render the three tables' pagination controls for the current language. */
  applyLanguage: () => void;
  /** Sort a table by a column, re-rendering it. */
  toggleGrantSort: (by: 'name' | 'empNo') => void;
  toggleExerciseSort: (by: 'name' | 'empNo') => void;
  toggleSoldSharesSort: (by: 'name' | 'empNo') => void;
  toggleCancellationSort: (by: 'name' | 'empNo') => void;
  init: () => Promise<void>;
};

const PAGINATION_IDS = {
  holdings: {
    summary: 'holdingsPaginationSummary',
    page: 'holdingsPaginationPage',
    first: 'btnHoldingsFirstPage',
    prev: 'btnHoldingsPrevPage',
    next: 'btnHoldingsNextPage',
    last: 'btnHoldingsLastPage',
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
  cancellations: {
    summary: 'cancellationPaginationSummary',
    page: 'cancellationPaginationPage',
    first: 'btnCancellationsFirstPage',
    prev: 'btnCancellationsPrevPage',
    next: 'btnCancellationsNextPage',
    last: 'btnCancellationsLastPage',
  },
} as const;

export function formatCurrency(value: number, currency: 'USD' | 'CNY' = 'USD') {
  const symbol = currency === 'USD' ? '$' : '¥';
  return `${symbol}${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * What the 激励类型 / Grant Type filter should offer for the data on screen.
 *
 * The control used to be hardcoded to a single `Option` value and disabled on every view but Futu,
 * which read as "it just doesn't work". The values differ per view (Futu `激励类型`, Shareworks
 * `Grant Type` like `Options (NQ)`, the merged view a normalised field), so they come from the rows:
 * no values means nothing to filter and the control is hidden rather than rendered dead.
 */
export function grantTypeFilterModel(
  types: string[] | undefined | null,
  current: string,
): { options: string[]; selected: string; visible: boolean } {
  const options = [...new Set((types ?? []).map((type) => String(type ?? '').trim()).filter(Boolean))].sort(
    (left, right) => left.localeCompare(right),
  );
  const selected = options.includes(current) ? current : '';
  return { options, selected, visible: options.length > 1 };
}

/**
 * The message shown when a month has no rows in the current view and the page picks one that does.
 *
 * It names the table on purpose: the notice used to be a global toast, so two record pages announcing
 * the switch at the same time produced two identical-looking messages with no way to tell which table
 * each one was about.
 */
export function describeViewAutoSwitch(input: {
  tableLabel: string;
  fromLabel: string;
  toLabel: string;
  rowCount: number;
}): string {
  return `本月「${input.tableLabel}」没有「${input.fromLabel}」数据，已显示「${input.toLabel}」（${input.rowCount} 条）。`;
}

export function createEsopTables(deps: EsopTablesDeps, host: EsopTablesHost): EsopTables {
  const { el } = deps;
  const read = createTexts('main');
  const t = (key: Parameters<typeof read>[0]) => read(key, deps.getLanguage());

  let grantView: GrantView = 'futu';
  let exerciseView: ExerciseView = 'futu';
  let holdings = 1;
  let exercises = 1;
  let soldShares = 1;
  let holdingsTotal = 0;
  let exerciseTotal = 0;
  let soldSharesTotal = 0;
  let holdingsPageSize = 20;
  let exercisePageSize = 20;
  let soldSharesPageSize = 20;
  let grantSort = { by: '' as '' | 'name' | 'empNo', dir: 'asc' as 'asc' | 'desc' };
  let exerciseSort = { by: '' as '' | 'name' | 'empNo', dir: 'asc' as 'asc' | 'desc' };
  let soldSharesSort = { by: '' as '' | 'name' | 'empNo', dir: 'asc' as 'asc' | 'desc' };
  let cancellations = 1;
  let cancellationsTotal = 0;
  let cancellationsPageSize = 20;
  let cancellationSort = { by: '' as '' | 'name' | 'empNo', dir: 'asc' as 'asc' | 'desc' };

  function renderHoldingsPagination(page: number, totalPages: number, total: number) {
    const view = paginationView({ page, pageSize: holdingsPageSize, total, totalPages });
    renderPaginationControls(
      el,
      PAGINATION_IDS.holdings,
      view,
      paginationSummaryText(view.start, view.end, total, 'records', deps.getLanguage()),
    );
  }

  function renderExercisePagination(page: number, totalPages: number, total: number) {
    const view = paginationView({ page, pageSize: exercisePageSize, total, totalPages });
    renderPaginationControls(
      el,
      PAGINATION_IDS.exercises,
      view,
      paginationSummaryText(view.start, view.end, total, 'records', deps.getLanguage()),
    );
  }

  function renderSoldSharesPagination(page: number, totalPages: number, total: number) {
    const view = paginationView({ page, pageSize: soldSharesPageSize, total, totalPages });
    renderPaginationControls(
      el,
      PAGINATION_IDS.soldShares,
      view,
      paginationSummaryText(view.start, view.end, total, 'records', deps.getLanguage()),
    );
  }

  function renderCancellationsPagination(page: number, totalPages: number, total: number) {
    const view = paginationView({ page, pageSize: cancellationsPageSize, total, totalPages });
    renderPaginationControls(
      el,
      PAGINATION_IDS.cancellations,
      view,
      paginationSummaryText(view.start, view.end, total, 'records', deps.getLanguage()),
    );
  }

  function searchHoldingsPage() {
    holdings = 1;
    void renderHoldings(host.getMonth());
  }

  function searchExercises() {
    exercises = 1;
    void renderExerciseRecords();
  }

  function changeExercisePage(delta: number) {
    const next = nextPageWithinBounds(exerciseTotal, exercisePageSize, exercises, delta);
    if (next === null) return;
    exercises = next;
    void renderExerciseRecords();
  }

  function goToExercisePage(target: 'first' | 'last') {
    const next = edgePage(exerciseTotal, exercisePageSize, exercises, target);
    if (next === null) return;
    exercises = next;
    void renderExerciseRecords();
  }

  function changeExercisePageSize(size: number) {
    if (size === exercisePageSize) return;
    exercisePageSize = size;
    exercises = 1;
    void renderExerciseRecords();
  }

  function searchSoldShares() {
    soldShares = 1;
    void renderSoldShares();
  }

  function changeSoldSharesPage(delta: number) {
    const next = nextPageWithinBounds(soldSharesTotal, soldSharesPageSize, soldShares, delta);
    if (next === null) return;
    soldShares = next;
    void renderSoldShares();
  }

  function goToSoldSharesPage(target: 'first' | 'last') {
    const next = edgePage(soldSharesTotal, soldSharesPageSize, soldShares, target);
    if (next === null) return;
    soldShares = next;
    void renderSoldShares();
  }

  function changeSoldSharesPageSize(size: number) {
    if (size === soldSharesPageSize) return;
    soldSharesPageSize = size;
    soldShares = 1;
    void renderSoldShares();
  }

  function searchCancellations() {
    cancellations = 1;
    void renderCancellationRecords();
  }

  function changeCancellationsPage(delta: number) {
    const next = nextPageWithinBounds(cancellationsTotal, cancellationsPageSize, cancellations, delta);
    if (next === null) return;
    cancellations = next;
    void renderCancellationRecords();
  }

  function goToCancellationsPage(target: 'first' | 'last') {
    const next = edgePage(cancellationsTotal, cancellationsPageSize, cancellations, target);
    if (next === null) return;
    cancellations = next;
    void renderCancellationRecords();
  }

  function changeCancellationsPageSize(size: number) {
    if (size === cancellationsPageSize) return;
    cancellationsPageSize = size;
    cancellations = 1;
    void renderCancellationRecords();
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
      const active = button.dataset.grantView === grantView;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    (['futu', 'shareworks', 'merge'] as GrantView[]).forEach((view) => {
      deps.el(`grantPanel-${view}`).classList.toggle('hidden', view !== grantView);
    });
    deps.el('grantViewTitle').textContent = viewCopy[grantView].title;
    deps.el('grantViewSubtitle').textContent = viewCopy[grantView].subtitle;
    deps.el<HTMLSelectElement>('filterHoldingsTag').disabled = false;
    deps.localizeDom();
  }

  function applyExerciseView() {
    const viewCopy: Record<ExerciseView, { title: string; subtitle: string }> = {
      futu: {
        title: 'Futu Exercise Records',
        subtitle: t('rawFutuBciExercises'),
      },
      shareworks: {
        title: 'Shareworks Exec Option OS',
        subtitle: t('exerciseViewShareworksSubtitle'),
      },
      merge: {
        title: 'Merged Exercise Records',
        subtitle: t('exerciseViewMergeSubtitle'),
      },
    };
    document.querySelectorAll<HTMLButtonElement>('[data-exercise-view]').forEach((button) => {
      const active = button.dataset.exerciseView === exerciseView;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    (['futu', 'shareworks', 'merge'] as ExerciseView[]).forEach((view) => {
      deps.el(`exercisePanel-${view}`).classList.toggle('hidden', view !== exerciseView);
    });
    deps.el('exerciseViewTitle').textContent = viewCopy[exerciseView].title;
    deps.el('exerciseViewSubtitle').textContent = viewCopy[exerciseView].subtitle;
    // Grant Year filter is Futu-only (Shareworks/merge rows have no per-transaction exercise semantics).
    deps.el<HTMLSelectElement>('filterExerciseGrantYear').disabled = exerciseView !== 'futu';
    deps.localizeDom();
  }

  function changeHoldingsPage(delta: number) {
    const next = nextPageWithinBounds(holdingsTotal, holdingsPageSize, holdings, delta);
    if (next === null) return;
    holdings = next;
    void renderHoldings(host.getMonth());
  }

  function goToHoldingsPage(target: 'first' | 'last') {
    const next = edgePage(holdingsTotal, holdingsPageSize, holdings, target);
    if (next === null) return;
    holdings = next;
    void renderHoldings(host.getMonth());
  }

  function changeHoldingsPageSize(size: number) {
    if (size === holdingsPageSize) return;
    holdingsPageSize = size;
    holdings = 1;
    void renderHoldings(host.getMonth());
  }

  function renderShareworksGrants(items: ShareworksGrant[], data: PaginatedResult<ShareworksGrant>) {
    const tbody = deps.el('shareworksGrantBody');
    if (items.length === 0) {
      tbody.innerHTML = '<tr><td colspan="29" class="table-empty-cell">暂无符合条件的 Shareworks 记录</td></tr>';
      deps.localizeDom();
      return;
    }
    tbody.innerHTML = items
      .map(
        (item, index) => `
    <tr>
      <td>${(data.page - 1) * data.pageSize + index + 1}</td>
      <td>${deps.escapeHtml(item.employeeNumber)}${deps.linkedBadge((item as { linkedIdentities?: unknown }).linkedIdentities, deps.getLanguage(), deps.escapeHtml)}</td>
      <td>${deps.escapeHtml(item.lastName)}</td>
      <td>${deps.escapeHtml(item.firstName)}</td>
      <td>${deps.escapeHtml(item.middleName)}</td>
      <td style="text-align:left;">${deps.escapeHtml(item.planName)}</td>
      <td style="text-align:left;">${deps.escapeHtml(item.grantName)}</td>
      <td>${deps.escapeHtml(item.grantType)}</td>
      <td>${deps.escapeHtml(item.employeeGrantNumber)}</td>
      <td>${deps.escapeHtml(item.grantDate)}</td>
      <td>${deps.escapeHtml(item.vestingStartDate)}</td>
      <td>${deps.escapeHtml(item.serviceStartDate)}</td>
      <td>${deps.escapeHtml(item.originalVestingStartDate)}</td>
      <td>${deps.escapeHtml(item.expireDate)}</td>
      <td>${deps.escapeHtml(item.participantExpireDate)}</td>
      <td>${deps.escapeHtml(item.earliestExpireCancelDate)}</td>
      <td>${deps.escapeHtml(item.latestExpireCancelDate)}</td>
      <td class="col-number">${deps.formatNumber(item.sharesGranted)}</td>
      <td class="col-number">${item.exercisePricePerShare === null ? '-' : `$${Number(item.exercisePricePerShare).toFixed(2)}`}</td>
      <td>${deps.escapeHtml(item.vestingSchedule)}</td>
      <td>${deps.escapeHtml(item.earlyExerciseAllowed)}</td>
      <td class="col-number">${deps.formatNumber(item.sharesVested)}</td>
      <td class="col-number">${deps.formatNumber(item.sharesUnvested)}</td>
      <td class="col-number">${deps.formatNumber(item.sharesExercisedReleased)}</td>
      <td class="col-number">${deps.formatNumber(item.sharesSubjectToRepurchase)}</td>
      <td class="col-number">${deps.formatNumber(item.sharesCancelledExpired)}</td>
      <td class="col-number">${deps.formatNumber(item.sharesOutstanding)}</td>
      <td class="col-number">${deps.formatNumber(item.outstandingUnvested)}</td>
      <td class="col-number">${deps.formatNumber(item.outstandingVestedExercisable)}</td>
    </tr>`,
      )
      .join('');
    deps.localizeDom();
  }

  function renderMergedGrants(items: MergedGrant[], data: PaginatedResult<MergedGrant>) {
    const tbody = deps.el('mergedGrantBody');
    if (items.length === 0) {
      tbody.innerHTML = '<tr><td colspan="18" class="table-empty-cell">暂无符合条件的合并记录</td></tr>';
      deps.localizeDom();
      return;
    }
    tbody.innerHTML = items
      .map(
        (item, index) => `
    <tr>
      <td>${(data.page - 1) * data.pageSize + index + 1}</td>
      <td style="text-align:left; font-weight:var(--font-semibold);">${deps.escapeHtml(item.employeeName)}${deps.linkedBadge((item as { linkedIdentities?: unknown }).linkedIdentities, deps.getLanguage(), deps.escapeHtml)}</td>
      <td>${deps.escapeHtml(item.grantNumber)}</td>
      <td>${deps.escapeHtml(item.employeeNumber)}</td>
      <td>${deps.escapeHtml(item.incentiveType)}</td>
      <td>${deps.escapeHtml(item.grantDate)}</td>
      <td class="col-number">${deps.formatNumber(item.grantQuantity)}</td>
      <td class="col-number">${item.grantPrice === null ? '-' : `$${Number(item.grantPrice).toFixed(2)}`}</td>
      <td>${deps.escapeHtml(item.expireDate)}</td>
      <td style="text-align:left;">${deps.escapeHtml(item.planName)}</td>
      <td>${deps.escapeHtml(item.vestingRuleName)}</td>
      <td>${deps.escapeHtml(item.vestingStartDate)}</td>
      <td class="col-number">${deps.formatNumber(item.sharesVested)}</td>
      <td class="col-number">${deps.formatNumber(item.sharesUnvested)}</td>
      <td class="col-number">${deps.formatNumber(item.sharesExercisedReleased)}</td>
      <td class="col-number">${deps.formatNumber(item.sharesCancelledExpired)}</td>
      <td class="col-number">${deps.formatNumber(item.sharesOutstanding)}</td>
      <td><span class="grant-source-badge grant-source-badge--${item.source.toLowerCase()}">${deps.escapeHtml(item.source)}</span></td>
    </tr>`,
      )
      .join('');
    deps.localizeDom();
  }

  function grantViewLabel(view: GrantView): string {
    return view === 'shareworks' ? 'Shareworks 视图' : view === 'merge' ? '合并视图' : 'Futu 视图';
  }

  function exerciseViewLabel(view: ExerciseView): string {
    return view === 'shareworks' ? 'Shareworks 视图' : view === 'merge' ? '合并视图' : 'Futu 视图';
  }

  /**
   * The view switch is a persistent state change, so it is announced in place (above the table, with a
   * one-click way back) rather than through a toast that outlives nothing and explains nothing.
   */
  function showViewNotice(
    elementId: string,
    message: string,
    back: { backView: GrantView | ExerciseView; backLabel: string },
  ): void {
    const node = deps.el(elementId);
    node.innerHTML =
      `<span class="view-auto-switch__text">${deps.escapeHtml(message)}</span>` +
      `<button type="button" class="view-auto-switch__back" data-view-notice-back="${deps.escapeHtml(back.backView)}">回到 ${deps.escapeHtml(back.backLabel)}</button>`;
    node.classList.remove('hidden');
    deps.localizeDom();
  }

  function hideViewNotice(elementId: string): void {
    const node = deps.el(elementId);
    node.innerHTML = '';
    node.classList.add('hidden');
  }

  /**
   * Rebuild the type filter from the rows of the active view, and hide it when there is nothing to
   * choose between (one type, or none) instead of leaving a dead select on screen.
   */
  function syncGrantTypeOptions(types: string[] | undefined | null): void {
    const select = deps.el<HTMLSelectElement>('filterGrantType');
    const model = grantTypeFilterModel(types, select.value);
    select.innerHTML =
      `<option value="">${deps.escapeHtml(deps.getLanguage() === 'en-US' ? 'All Types' : '全部类型')}</option>` +
      model.options
        .map((type) => `<option value="${deps.escapeHtml(type)}">${deps.escapeHtml(type)}</option>`)
        .join('');
    select.value = model.selected;
    select.disabled = false;
    select.classList.toggle('hidden', !model.visible);
    deps.el('filterGrantTypeLabel').classList.toggle('hidden', !model.visible);
  }

  /**
   * A month's snapshot can exist in one view only — the Futu export and the Shareworks export are
   * different files. The month picker marks such a month as having data, so an empty default view
   * reads as a broken page; switch to a view that has rows and say why.
   *
   * Skipped while a search or tag filter is active: there the emptiness is the filter's doing.
   */
  async function autoSelectGrantView(month: string, query: string, tagId: string): Promise<boolean> {
    if (query.trim() || tagId.trim()) return false;
    const candidates = (['shareworks', 'merge'] as GrantView[]).filter((view) => view !== grantView);
    for (const view of candidates) {
      const total = await grantViewTotal(view, month);
      if (total <= 0) continue;
      const previousView = grantView;
      grantView = view;
      holdings = 1;
      applyGrantView();
      await renderHoldings(month, { autoSelectView: false });
      showViewNotice(
        'grantViewNotice',
        describeViewAutoSwitch({
          tableLabel: '授予记录',
          fromLabel: grantViewLabel(previousView),
          toLabel: grantViewLabel(view),
          rowCount: total,
        }),
        { backView: previousView, backLabel: grantViewLabel(previousView) },
      );
      return true;
    }
    return false;
  }

  async function autoSelectExerciseView(query: string, tagId: string): Promise<boolean> {
    if (query.trim() || tagId.trim()) return false;
    const month = host.getMonth();
    const candidates = (['shareworks', 'merge'] as ExerciseView[]).filter((view) => view !== exerciseView);
    for (const view of candidates) {
      const total = await exerciseViewTotal(view, month);
      if (total <= 0) continue;
      const previousView = exerciseView;
      exerciseView = view;
      exercises = 1;
      applyExerciseView();
      await renderExerciseRecords({ autoSelectView: false });
      showViewNotice(
        'exerciseViewNotice',
        describeViewAutoSwitch({
          tableLabel: '行权记录',
          fromLabel: exerciseViewLabel(previousView),
          toLabel: exerciseViewLabel(view),
          rowCount: total,
        }),
        { backView: previousView, backLabel: exerciseViewLabel(previousView) },
      );
      return true;
    }
    return false;
  }

  async function exerciseViewTotal(view: ExerciseView, month: string): Promise<number> {
    const monthParam = `month=${encodeURIComponent(month)}&pageSize=1`;
    const url =
      view === 'shareworks'
        ? `/api/exercises/shareworks?${monthParam}`
        : view === 'merge'
          ? `/api/exercises/merge?${monthParam}`
          : `/api/exercises?${monthParam}`;
    const data = await deps.api<{ total?: number }>(url);
    return Number(data.total ?? 0);
  }

  /** When the chosen view is empty but another one has rows, say so instead of looking broken. */
  async function grantEmptyHint(month: string): Promise<string> {
    for (const view of (['shareworks', 'merge'] as GrantView[]).filter((item) => item !== grantView)) {
      const total = await grantViewTotal(view, month);
      if (total > 0) return `本月「${grantViewLabel(view)}」有 ${total} 条记录，切换上方视图即可查看`;
    }
    return '';
  }

  async function exerciseEmptyHint(month: string): Promise<string> {
    for (const view of (['shareworks', 'merge'] as ExerciseView[]).filter((item) => item !== exerciseView)) {
      const total = await exerciseViewTotal(view, month);
      if (total > 0) return `本月「${exerciseViewLabel(view)}」有 ${total} 条记录，切换上方视图即可查看`;
    }
    return '';
  }

  async function grantViewTotal(view: GrantView, month: string): Promise<number> {
    const monthParam = `month=${encodeURIComponent(month)}&pageSize=1`;
    const url =
      view === 'shareworks'
        ? `/api/grants/shareworks?${monthParam}`
        : view === 'merge'
          ? `/api/grants/merge?${monthParam}`
          : `/api/holdings?${monthParam}`;
    const data = await deps.api<{ total?: number }>(url);
    return Number(data.total ?? 0);
  }

  async function renderHoldings(month: string, options: { autoSelectView?: boolean } = {}) {
    if (options.autoSelectView !== false) hideViewNotice('grantViewNotice');
    const query = deps.el<HTMLInputElement>('searchHolder').value.trim();
    const tagId = deps.el<HTMLSelectElement>('filterHoldingsTag').value;
    const grantType = deps.el<HTMLSelectElement>('filterGrantType').value;
    renderSortIndicators('#page-grant-record', grantSort);
    if (grantView === 'shareworks') {
      const data = await deps.api<PaginatedResult<ShareworksGrant>>(
        `/api/grants/shareworks?query=${encodeURIComponent(query)}&tagId=${encodeURIComponent(tagId)}&grantType=${encodeURIComponent(grantType)}&month=${encodeURIComponent(month)}&page=${holdings}&pageSize=${holdingsPageSize}${sortQuery(grantSort)}`,
      );
      deps.setPageSourceFiles('grant-record', data);
      syncGrantTypeOptions((data as { grantTypes?: string[] }).grantTypes);
      const items = data.items ?? [];
      holdings = data.page;
      holdingsTotal = data.total;
      renderHoldingsPagination(data.page, data.totalPages, data.total);
      renderShareworksGrants(items, data);
      deps.localizeDom();
      return;
    }
    if (grantView === 'merge') {
      const data = await deps.api<PaginatedResult<MergedGrant>>(
        `/api/grants/merge?query=${encodeURIComponent(query)}&tagId=${encodeURIComponent(tagId)}&grantType=${encodeURIComponent(grantType)}&month=${encodeURIComponent(month)}&page=${holdings}&pageSize=${holdingsPageSize}${sortQuery(grantSort)}`,
      );
      deps.setPageSourceFiles('grant-record', data);
      syncGrantTypeOptions((data as { grantTypes?: string[] }).grantTypes);
      const items = data.items ?? [];
      holdings = data.page;
      holdingsTotal = data.total;
      renderHoldingsPagination(data.page, data.totalPages, data.total);
      renderMergedGrants(items, data);
      deps.localizeDom();
      return;
    }
    const data = await deps.api<PaginatedResult<Holding>>(
      `/api/holdings?month=${month}&query=${encodeURIComponent(query)}&grantType=${encodeURIComponent(grantType)}&tagId=${encodeURIComponent(tagId)}&page=${holdings}&pageSize=${holdingsPageSize}${sortQuery(grantSort)}`,
    );
    deps.setPageSourceFiles('grant-record', data);
    syncGrantTypeOptions((data as { grantTypes?: string[] }).grantTypes);
    const items = data.holdings ?? [];
    holdings = data.page;
    holdingsTotal = data.total;
    renderHoldingsPagination(data.page, data.totalPages, data.total);
    const tbody = deps.el('holdingsBody');
    if (items.length === 0) {
      // The month may still have a snapshot on another view; show that instead of an empty page.
      // Only when the month drove the render: a user who picked an empty view stays there.
      if (options.autoSelectView !== false && (await autoSelectGrantView(month, query, tagId))) return;
      const hint = await grantEmptyHint(month);
      tbody.innerHTML = `<tr><td colspan="34" class="table-empty-cell">暂无符合条件的持仓记录${hint ? `<div class="table-empty-hint">${hint}</div>` : ''}</td></tr>`;
      deps.localizeDom();
      return;
    }
    tbody.innerHTML = items
      .map(
        (item, index) => `
    <tr>
      <td>${(data.page - 1) * data.pageSize + index + 1}</td>
      <td style="text-align:left; font-weight:var(--font-semibold);">${deps.escapeHtml(item.employeeName)}${deps.linkedBadge((item as { linkedIdentities?: unknown }).linkedIdentities, deps.getLanguage(), deps.escapeHtml)}</td>
      <td>${deps.escapeHtml(item.grantNumber)}</td>
      <td>${deps.escapeHtml(item.userId)}</td>
      <td>${deps.escapeHtml(item.employeeNumber)}</td>
      <td><span class="grant-type-badge ${deps.grantTypeClass(String(item.incentiveType))}">${deps.escapeHtml(item.incentiveType)}</span></td>
      <td>${deps.escapeHtml(item.grantDate)}</td>
      <td class="col-number">${deps.formatNumber(item.grantQuantity)}</td>
      <td class="col-number">${item.grantPriceUsd === null ? '-' : `$${Number(item.grantPriceUsd).toFixed(2)}`}</td>
      <td>${deps.escapeHtml(item.expireDate)}</td>
      <td style="text-align:left;">${deps.escapeHtml(item.planName)}</td>
      <td>${deps.escapeHtml(item.conditionRule)}</td>
      <td>${deps.escapeHtml(item.employeePortalVisibility)}</td>
      <td class="col-number">${item.closingPriceUsd === null ? '-' : `$${Number(item.closingPriceUsd).toFixed(2)}`}</td>
      <td>${deps.escapeHtml(item.withholdingCost)}</td>
      <td>${deps.escapeHtml(item.taxCalculation)}</td>
      <td>${deps.escapeHtml(item.taxWithholding)}</td>
      <td>${deps.escapeHtml(item.fxSettlement)}</td>
      <td>${deps.escapeHtml(item.taxRule)}</td>
      <td>${deps.escapeHtml(item.cancellationConfirmDate)}</td>
      <td>${deps.escapeHtml(item.dataSource)}</td>
      <td style="text-align:left;">${deps.escapeHtml(item.vestingRuleName)}</td>
      <td>${deps.escapeHtml(item.vestingStartDate)}</td>
      <td class="col-number">${deps.formatNumber(item.vestedQuantity)}</td>
      <td class="col-number">${deps.formatNumber(item.effectiveVestedQuantity)}</td>
      <td class="col-number">${deps.formatNumber(item.unvestedQuantity)}</td>
      <td class="col-number">${deps.formatNumber(item.vestedCancelledQuantity)}</td>
      <td class="col-number">${deps.formatNumber(item.unvestedCancelledQuantity)}</td>
      <td class="col-number">${deps.formatNumber(item.exercisedQuantity)}</td>
      <td class="col-number">${deps.formatNumber(item.pendingExerciseQuantity)}</td>
      <td class="col-number" style="font-weight:var(--font-semibold);">${deps.formatNumber(item.outstandingQuantity)}</td>
      <td class="col-number">${deps.formatNumber(item.sellableQuantity)}</td>
      <td class="grant-long-cell">${deps.escapeHtml(item.relatedSaleOrderNumber)}</td>
      <td>${deps.escapeHtml(item.agreementInfo)}</td>
    </tr>`,
      )
      .join('');
    deps.localizeDom();
  }
  async function renderExerciseRecords(options: { autoSelectView?: boolean } = {}) {
    if (options.autoSelectView !== false) hideViewNotice('exerciseViewNotice');
    const query = deps.el<HTMLInputElement>('searchExercises').value.trim();
    const tagId = deps.el<HTMLSelectElement>('filterExerciseTag').value;
    if (exerciseView === 'shareworks') {
      await renderShareworksExercises(query, tagId);
      return;
    }
    if (exerciseView === 'merge') {
      await renderMergedExercises(query, tagId);
      return;
    }
    const grantYear = deps.el<HTMLSelectElement>('filterExerciseGrantYear').value;
    renderSortIndicators('#exerciseTable', exerciseSort);
    const data = await deps.api<PaginatedResult<ExerciseRecord>>(
      `/api/exercises?query=${encodeURIComponent(query)}&tagId=${encodeURIComponent(tagId)}&grantYear=${encodeURIComponent(grantYear)}&month=${encodeURIComponent(host.getMonth())}&page=${exercises}&pageSize=${exercisePageSize}${sortQuery(exerciseSort)}`,
    );
    deps.setPageSourceFiles('exercise-record', data);
    const items = data.items ?? [];
    exercises = data.page;
    exerciseTotal = data.total;
    renderExercisePagination(data.page, data.totalPages, data.total);

    const tbody = deps.el('exerciseBody');
    if (items.length === 0) {
      if (options.autoSelectView !== false && (await autoSelectExerciseView(query, tagId))) return;
      const hint = await exerciseEmptyHint(host.getMonth());
      tbody.innerHTML = `<tr><td colspan="14" class="table-empty-cell">暂无符合条件的行权记录${hint ? `<div class="table-empty-hint">${hint}</div>` : ''}</td></tr>`;
      deps.localizeDom();
      return;
    }
    tbody.innerHTML = items
      .map(
        (item, index) => `
    <tr>
      <td>${(data.page - 1) * data.pageSize + index + 1}</td>
      <td style="text-align:left; font-weight:var(--font-semibold);">${deps.escapeHtml(item.name)}${deps.linkedBadge((item as { linkedIdentities?: unknown }).linkedIdentities, deps.getLanguage(), deps.escapeHtml)}</td>
      <td>${deps.escapeHtml(item.employeeNumber)}</td>
      <td>${deps.escapeHtml(item.futubullId)}</td>
      <td>${deps.escapeHtml(item.userId)}</td>
      <td>${deps.escapeHtml(item.grantNumber)}</td>
      <td>${deps.escapeHtml(item.grantDate)}</td>
      <td class="col-number">$${item.grantPriceUsd.toFixed(5)}</td>
      <td>${deps.escapeHtml(item.exerciseDate)}</td>
      <td class="col-number">${deps.formatNumber(item.orderedQuantity)}</td>
      <td class="col-number">${deps.formatNumber(item.exercisedQuantity)}</td>
      <td class="col-number">$${item.exerciseCostUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
      <td class="col-number">${deps.formatNumber(item.deductionSellingQuantity)}</td>
      <td class="col-number">${deps.formatNumber(item.dealtQuantity)}</td>
    </tr>`,
      )
      .join('');
    deps.localizeDom();
  }

  async function renderShareworksExercises(query: string, tagId: string) {
    const data = await deps.api<PaginatedResult<ShareworksExercise>>(
      `/api/exercises/shareworks?query=${encodeURIComponent(query)}&tagId=${encodeURIComponent(tagId)}&month=${encodeURIComponent(host.getMonth())}&page=${exercises}&pageSize=${exercisePageSize}`,
    );
    deps.setPageSourceFiles('exercise-record', data);
    const items = data.items ?? [];
    exercises = data.page;
    exerciseTotal = data.total;
    renderExercisePagination(data.page, data.totalPages, data.total);
    const tbody = deps.el('shareworksExerciseBody');
    if (items.length === 0) {
      tbody.innerHTML = '<tr><td colspan="23" class="table-empty-cell">暂无符合条件的 Shareworks 记录</td></tr>';
      deps.localizeDom();
      return;
    }
    tbody.innerHTML = items
      .map(
        (item, index) => `
    <tr>
      <td>${(data.page - 1) * data.pageSize + index + 1}</td>
      <td>${deps.escapeHtml(item.lastName)}${deps.linkedBadge((item as { linkedIdentities?: unknown }).linkedIdentities, deps.getLanguage(), deps.escapeHtml)}</td>
      <td>${deps.escapeHtml(item.firstName)}</td>
      <td>${deps.escapeHtml(item.middleName)}</td>
      <td style="text-align:left;">${deps.escapeHtml(item.planName)}</td>
      <td>${deps.escapeHtml(item.grantType)}</td>
      <td>${deps.escapeHtml(item.employeeGrantNumber)}</td>
      <td>${deps.escapeHtml(item.grantDate)}</td>
      <td class="col-number">${deps.formatNumber(item.sharesGranted)}</td>
      <td class="col-number">${item.exercisePricePerShare === null ? '-' : `$${Number(item.exercisePricePerShare).toFixed(2)}`}</td>
      <td>${deps.escapeHtml(item.vestingSchedule)}</td>
      <td>${deps.escapeHtml(item.vestingStartDate)}</td>
      <td>${deps.escapeHtml(item.originalVestingStartDate)}</td>
      <td>${deps.escapeHtml(item.expireDate)}</td>
      <td>${deps.escapeHtml(item.earlyExerciseAllowed)}</td>
      <td class="col-number">${deps.formatNumber(item.sharesVested)}</td>
      <td class="col-number">${deps.formatNumber(item.sharesUnvested)}</td>
      <td class="col-number">${deps.formatNumber(item.sharesExercisedReleased)}</td>
      <td class="col-number">${deps.formatNumber(item.sharesSubjectToRepurchase)}</td>
      <td class="col-number">${deps.formatNumber(item.sharesCancelledExpired)}</td>
      <td class="col-number">${deps.formatNumber(item.sharesOutstanding)}</td>
      <td class="col-number">${deps.formatNumber(item.outstandingVestedExercisable)}</td>
      <td class="col-number">${deps.formatNumber(item.outstandingUnvested)}</td>
    </tr>`,
      )
      .join('');
    deps.localizeDom();
  }

  async function renderMergedExercises(query: string, tagId: string) {
    const data = await deps.api<PaginatedResult<MergedExercise>>(
      `/api/exercises/merge?query=${encodeURIComponent(query)}&tagId=${encodeURIComponent(tagId)}&month=${encodeURIComponent(host.getMonth())}&page=${exercises}&pageSize=${exercisePageSize}`,
    );
    deps.setPageSourceFiles('exercise-record', data);
    const items = data.items ?? [];
    exercises = data.page;
    exerciseTotal = data.total;
    renderExercisePagination(data.page, data.totalPages, data.total);
    const tbody = deps.el('mergedExerciseBody');
    if (items.length === 0) {
      tbody.innerHTML = '<tr><td colspan="23" class="table-empty-cell">暂无符合条件的合并记录</td></tr>';
      deps.localizeDom();
      return;
    }
    tbody.innerHTML = items
      .map(
        (item, index) => `
    <tr>
      <td>${(data.page - 1) * data.pageSize + index + 1}</td>
      <td style="text-align:left; font-weight:var(--font-semibold);">${deps.escapeHtml(item.employeeName)}${deps.linkedBadge((item as { linkedIdentities?: unknown }).linkedIdentities, deps.getLanguage(), deps.escapeHtml)}</td>
      <td>${deps.escapeHtml(item.grantNumber)}</td>
      <td>${deps.escapeHtml(item.employeeNumber)}</td>
      <td><span class="grant-source-badge grant-source-badge--${item.source.toLowerCase()}">${deps.escapeHtml(item.source)}</span></td>
      <td>${deps.escapeHtml(item.grantDate)}</td>
      <td class="col-number">${item.grantPriceUsd === null ? '-' : `$${Number(item.grantPriceUsd).toFixed(5)}`}</td>
      <td>${deps.escapeHtml(item.exerciseDate)}</td>
      <td class="col-number">${deps.formatNumber(item.orderedQuantity)}</td>
      <td class="col-number">${deps.formatNumber(item.exercisedQuantity)}</td>
      <td class="col-number">${item.exerciseCostUsd === null ? '-' : `$${Number(item.exerciseCostUsd).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</td>
      <td class="col-number">${deps.formatNumber(item.deductionSellingQuantity)}</td>
      <td class="col-number">${deps.formatNumber(item.dealtQuantity)}</td>
      <td style="text-align:left;">${deps.escapeHtml(item.planName)}</td>
      <td>${deps.escapeHtml(item.grantType)}</td>
      <td>${deps.escapeHtml(item.vestingSchedule)}</td>
      <td>${deps.escapeHtml(item.vestingStartDate)}</td>
      <td>${deps.escapeHtml(item.expireDate)}</td>
      <td class="col-number">${deps.formatNumber(item.sharesGranted)}</td>
      <td class="col-number">${item.exercisePricePerShare === null ? '-' : `$${Number(item.exercisePricePerShare).toFixed(2)}`}</td>
      <td class="col-number">${deps.formatNumber(item.sharesVested)}</td>
      <td class="col-number">${deps.formatNumber(item.sharesUnvested)}</td>
      <td class="col-number">${deps.formatNumber(item.sharesExercisedReleased)}</td>
      <td class="col-number">${deps.formatNumber(item.sharesOutstanding)}</td>
    </tr>`,
      )
      .join('');
    deps.localizeDom();
  }

  async function renderSoldShares() {
    const query = deps.el<HTMLInputElement>('searchSoldShares').value.trim();
    const tagId = deps.el<HTMLSelectElement>('filterSoldSharesTag').value;
    const employmentStatus = deps.el<HTMLSelectElement>('filterSoldSharesEmploymentStatus').value;
    renderSortIndicators('#soldSharesTable', soldSharesSort);
    const data = await deps.api<PaginatedResult<SoldShare>>(
      `/api/sold-shares?query=${encodeURIComponent(query)}&tagId=${encodeURIComponent(tagId)}&employmentStatus=${encodeURIComponent(employmentStatus)}&month=${encodeURIComponent(host.getMonth())}&page=${soldShares}&pageSize=${soldSharesPageSize}${sortQuery(soldSharesSort)}`,
    );
    deps.setPageSourceFiles('sold-shares', data);
    const items = data.items ?? [];
    soldShares = data.page;
    soldSharesTotal = data.total;
    renderSoldSharesPagination(data.page, data.totalPages, data.total);

    const tbody = deps.el('soldSharesBody');
    if (items.length === 0) {
      tbody.innerHTML = '<tr><td colspan="20" class="table-empty-cell">暂无符合条件的出售记录</td></tr>';
      deps.localizeDom();
      return;
    }
    tbody.innerHTML = items
      .map(
        (item, index) => `
    <tr>
      <td>${(data.page - 1) * data.pageSize + index + 1}</td>
      <td style="text-align:left; font-weight:var(--font-semibold);">${deps.escapeHtml(item.name)}${deps.linkedBadge((item as { linkedIdentities?: unknown }).linkedIdentities, deps.getLanguage(), deps.escapeHtml)}</td>
      <td>${deps.escapeHtml(item.employeeNumber)}</td>
      <td>${deps.escapeHtml(item.futubullId)}</td>
      <td>${deps.escapeHtml(item.userId)}</td>
      <td>${deps.escapeHtml(item.employmentStatus)}</td>
      <td>${deps.escapeHtml(item.relatedPartyIdentity)}</td>
      <td>${deps.escapeHtml(item.capitalGainsTaxVisibility)}</td>
      <td class="col-number">${deps.formatNumber(item.soldQuantity)}</td>
      <td class="col-number">${deps.formatNumber(item.dealtQuantity)}</td>
      <td class="col-number">${deps.formatCurrency(item.dealAmountUsd)}</td>
      <td class="col-number">${deps.formatCurrency(item.taxableIncomeUsd)}</td>
      <td class="col-number">${deps.formatCurrency(item.taxPayableUsd)}</td>
      <td class="col-number">${deps.formatCurrency(item.transactionFeesUsd)}</td>
      <td class="col-number">${deps.formatCurrency(item.netDealValueUsd)}</td>
      <td class="col-number">${deps.formatCurrency(item.grantCostUsd)}</td>
      <td class="col-number">${deps.formatCurrency(item.exerciseVestingFeeUsd)}</td>
      <td class="col-number">${deps.formatCurrency(item.withholdingTaxUsd)}</td>
      <td class="col-number">${deps.formatCurrency(item.withholdingTaxCny, 'CNY')}</td>
      <td class="col-number">${deps.formatCurrency(item.cashNetProceedsUsd)}</td>
    </tr>`,
      )
      .join('');
    deps.localizeDom();
  }

  async function renderCancellationRecords() {
    const query = deps.el<HTMLInputElement>('searchCancellations').value.trim();
    const tagId = deps.el<HTMLSelectElement>('filterCancellationTag').value;
    const employmentStatus = deps.el<HTMLSelectElement>('filterCancellationEmploymentStatus').value;
    renderSortIndicators('#cancellationsTable', cancellationSort);
    const data = await deps.api<PaginatedResult<CancellationRecord>>(
      `/api/cancellation-records?query=${encodeURIComponent(query)}&tagId=${encodeURIComponent(tagId)}&employmentStatus=${encodeURIComponent(employmentStatus)}&month=${encodeURIComponent(host.getMonth())}&page=${cancellations}&pageSize=${cancellationsPageSize}${sortQuery(cancellationSort)}`,
    );
    deps.setPageSourceFiles('cancellation-record', data);
    const items = data.items ?? [];
    cancellations = data.page;
    cancellationsTotal = data.total;
    renderCancellationsPagination(data.page, data.totalPages, data.total);

    const tbody = deps.el('cancellationRecordsBody');
    if (items.length === 0) {
      tbody.innerHTML = '<tr><td colspan="17" class="table-empty-cell">暂无符合条件的取消记录</td></tr>';
      deps.localizeDom();
      return;
    }
    tbody.innerHTML = items
      .map(
        (item, index) => `
    <tr>
      <td>${(data.page - 1) * data.pageSize + index + 1}</td>
      <td style="text-align:left; font-weight:var(--font-semibold);">${deps.escapeHtml(item.name)}${deps.linkedBadge((item as { linkedIdentities?: unknown }).linkedIdentities, deps.getLanguage(), deps.escapeHtml)}</td>
      <td>${deps.escapeHtml(item.employeeNumber)}</td>
      <td>${deps.escapeHtml(item.employmentStatus)}</td>
      <td>${deps.escapeHtml(item.grantNumber)}</td>
      <td style="text-align:left;">${deps.escapeHtml(item.planName)}</td>
      <td>${deps.escapeHtml(item.incentiveType)}</td>
      <td>${deps.escapeHtml(item.grantDate)}</td>
      <td>${deps.escapeHtml(item.vestingDate)}</td>
      <td>${deps.escapeHtml(item.changeType)}</td>
      <td>${deps.escapeHtml(item.reason)}</td>
      <td class="col-number">${deps.formatNumber(item.quantity)}</td>
      <td>${deps.escapeHtml(item.changeDate)}</td>
      <td>${deps.escapeHtml(item.financialChangeDate)}</td>
      <td>${deps.escapeHtml(item.creationNumber)}</td>
      <td style="text-align:left;">${deps.escapeHtml(item.vestingRule)}</td>
      <td>${deps.escapeHtml(item.operator)}</td>
    </tr>`,
      )
      .join('');
    deps.localizeDom();
  }

  function nextSort(current: { by: '' | 'name' | 'empNo'; dir: 'asc' | 'desc' }, by: 'name' | 'empNo') {
    if (current.by !== by) return { by, dir: 'asc' as const };
    return { by, dir: current.dir === 'asc' ? ('desc' as const) : ('asc' as const) };
  }

  function toggleGrantSort(by: 'name' | 'empNo') {
    grantSort = nextSort(grantSort, by);
    holdings = 1;
    void renderHoldings(host.getMonth());
  }

  function toggleExerciseSort(by: 'name' | 'empNo') {
    exerciseSort = nextSort(exerciseSort, by);
    exercises = 1;
    void renderExerciseRecords();
  }

  function toggleSoldSharesSort(by: 'name' | 'empNo') {
    soldSharesSort = nextSort(soldSharesSort, by);
    soldShares = 1;
    void renderSoldShares();
  }

  function toggleCancellationSort(by: 'name' | 'empNo') {
    cancellationSort = nextSort(cancellationSort, by);
    cancellations = 1;
    void renderCancellationRecords();
  }

  async function initEsopTables() {
    await host.loadEmployeeLabels();

    // Grant record views + search + pagination.
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
        if (view === grantView) return;
        grantView = view;
        holdings = 1;
        applyGrantView();
        hideViewNotice('grantViewNotice');
        // An explicitly chosen view stays put even when this month has nothing on it.
        void renderHoldings(host.getMonth(), { autoSelectView: false });
      });
    });
    applyGrantView();

    deps.el('grantViewNotice').addEventListener('click', (event) => {
      const button = (event.target as HTMLElement | null)?.closest('[data-view-notice-back]') as HTMLElement | null;
      if (!button) return;
      const view = (button.dataset.viewNoticeBack ?? 'futu') as GrantView;
      grantView = view;
      holdings = 1;
      applyGrantView();
      hideViewNotice('grantViewNotice');
      void renderHoldings(host.getMonth(), { autoSelectView: false });
    });

    // Exercise record views + search + pagination.
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
    document.querySelectorAll<HTMLButtonElement>('[data-exercise-view]').forEach((button) => {
      button.addEventListener('click', () => {
        const view = button.dataset.exerciseView as ExerciseView;
        if (view === exerciseView) return;
        exerciseView = view;
        exercises = 1;
        applyExerciseView();
        hideViewNotice('exerciseViewNotice');
        // An explicitly chosen view stays put even when this month has nothing on it.
        void renderExerciseRecords({ autoSelectView: false });
      });
    });
    applyExerciseView();

    deps.el('exerciseViewNotice').addEventListener('click', (event) => {
      const button = (event.target as HTMLElement | null)?.closest('[data-view-notice-back]') as HTMLElement | null;
      if (!button) return;
      const view = (button.dataset.viewNoticeBack ?? 'futu') as ExerciseView;
      exerciseView = view;
      exercises = 1;
      applyExerciseView();
      hideViewNotice('exerciseViewNotice');
      void renderExerciseRecords({ autoSelectView: false });
    });

    // Sold shares + search + pagination.
    el('btnSearchCancellations').addEventListener('click', searchCancellations);
    el<HTMLSelectElement>('filterCancellationTag').addEventListener('change', searchCancellations);
    el('filterCancellationEmploymentStatus').addEventListener('change', searchCancellations);
    el('searchCancellations').addEventListener('keydown', (event) => {
      if ((event as KeyboardEvent).key === 'Enter') searchCancellations();
    });
    el('btnCancellationsFirstPage').addEventListener('click', () => goToCancellationsPage('first'));
    el('btnCancellationsPrevPage').addEventListener('click', () => changeCancellationsPage(-1));
    el('btnCancellationsNextPage').addEventListener('click', () => changeCancellationsPage(1));
    el('btnCancellationsLastPage').addEventListener('click', () => goToCancellationsPage('last'));
    el<HTMLSelectElement>('cancellationPageSizeSelect').addEventListener('change', (event) =>
      changeCancellationsPageSize(Number((event.target as HTMLSelectElement).value)),
    );

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

    await renderHoldings(host.getMonth());
    await renderExerciseRecords();
    await renderSoldShares();
    await renderCancellationRecords();
  }

  return {
    renderHoldings: renderHoldings,
    renderExercises: renderExerciseRecords,
    renderSoldShares,
    renderCancellationRecords,
    applyGrantView,
    applyExerciseView,
    toggleGrantSort,
    toggleExerciseSort,
    toggleSoldSharesSort,
    toggleCancellationSort,
    applyLanguage() {
      renderHoldingsPagination(holdings, pageCountOf(holdingsTotal, holdingsPageSize), holdingsTotal);
      renderExercisePagination(exercises, pageCountOf(exerciseTotal, exercisePageSize), exerciseTotal);
      renderSoldSharesPagination(soldShares, pageCountOf(soldSharesTotal, soldSharesPageSize), soldSharesTotal);
      renderCancellationsPagination(
        cancellations,
        pageCountOf(cancellationsTotal, cancellationsPageSize),
        cancellationsTotal,
      );
    },
    init: initEsopTables,
  };
}

import type { AppLanguage } from './i18n.js';
import { createTexts } from './texts.js';
import type { ConfirmActionFn, NotifyFn } from './uiFeedback.js';
import { csvRow } from './csv.js';
import {
  computeCapitalizationRowDeltas,
  findComparableRow,
  indexCapitalizationRows,
  normalizeCapitalizationRows,
  resolveBaselineMonth,
  type AvailableMonth,
  type CapitalizationDelta,
} from './summaryPage.js';
import type { ProductFileRecord, SummaryCapitalizationSource, SummarySnapshot } from '../shared/types.js';

/**
 * The CapTable summary page: month-over-month share capital reconciliation, the capitalization
 * table with its delta column, the per-month notes, and the CSV export.
 *
 * It is the page with the most derived state in main.ts — the loaded snapshot, the baseline month
 * used for deltas, and the capitalization source-file options — all of which only this page reads.
 */

export type CaptablePageDeps = {
  el: <T extends HTMLElement>(id: string) => T;
  api: <T>(url: string, options?: RequestInit) => Promise<T>;
  escapeHtml: (text: unknown) => string;
  formatNumber: (value: unknown) => string;
  notify: NotifyFn;
  confirmAction: ConfirmActionFn;
  productFileDisplayName: (file: ProductFileRecord) => string;
  getLanguage: () => AppLanguage;
};

export type CaptablePageHost = {
  /** The month the app is currently on; rendering a month moves the whole app to it. */
  getMonth: () => string;
  setMonth: (month: string) => void;
  fetchAvailableMonths: () => Promise<AvailableMonth[]>;
  renderMonthPicker: (
    containerId: string,
    month: string,
    availabilityKey: 'hasCapTableData' | 'hasPlanSummaryData',
  ) => void;
  setPageSourceFiles: (page: 'captable', files: string | null) => void;
  getCurrentMonthTextNode: () => HTMLElement;
  /** Clear the active page's source/result file labels. */
  resetActivePageSourceFile: () => void;
  /** Open the shared link-details modal. */
  openLinkModal: (key: string) => void;
  localizeDom: () => void;
};

export type CaptablePage = {
  render: (month: string) => Promise<void>;
  refreshSourceFileOptions: () => Promise<void>;
  exportCsv: () => void;
  /** Show the empty state for a month with no data yet. */
  renderEmpty: (message: string) => void;
  bindSourceFileControl: () => void;
};

function getEOMDate(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  const endDate = new Date(Date.UTC(year, month, 0));
  const mm = String(endDate.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(endDate.getUTCDate()).padStart(2, '0');
  return `${mm}/${dd}/${year}`;
}

const FIXED_CAPITALIZATION_SUMMARY_SHEET = 'Capitalization Summary';

function formatMonthCN(monthKey: string): string {
  const [year, month] = monthKey.split('-');
  const monthIndex = Number(month) - 1;
  const monthNames = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  const monthName = monthNames[monthIndex] ?? month;
  return `${monthName} ${year} / ${year}年${Number(month)}月`;
}

export function createCaptablePage(deps: CaptablePageDeps, host: CaptablePageHost): CaptablePage {
  const { el, escapeHtml } = deps;
  const read = createTexts('main');
  const t = (key: Parameters<typeof read>[0]) => read(key, deps.getLanguage());

  let summary: SummarySnapshot | null = null;
  let baselineCache: { month: string; data: SummarySnapshot | null } | null = null;
  let sourceFiles: ProductFileRecord[] = [];

  function renderEmptySummaryPage(message: string) {
    summary = null;
    host.resetActivePageSourceFile();
    host.getCurrentMonthTextNode().textContent = t('noSummaryData');
    el('eomDate').textContent = '-';
    el('reconciliationBody').innerHTML =
      `<tr><td colspan="5" class="table-empty-cell">${escapeHtml(message)}</td></tr>`;
    el('capitalizationBody').innerHTML =
      `<tr><td colspan="6" class="table-empty-cell">${escapeHtml(message)}</td></tr>`;
    applyCapitalizationSourceState(null);
    renderNotes([]);
    host.localizeDom();
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
    return `<td class="col-delta cap-delta--${delta.direction}">${CAPITALIZATION_DELTA_ICONS[delta.direction]}<span class="cap-delta__text">${deps.escapeHtml(delta.text)}</span></td>`;
  }

  /** Loads the baseline month used for month-over-month deltas. Never rejects: no baseline just means no deltas. */
  async function loadBaselineSummary(baselineMonth: string | null): Promise<SummarySnapshot | null> {
    if (!baselineMonth) return null;
    if (baselineCache?.month === baselineMonth) return baselineCache.data;
    try {
      const data = await deps.api<SummarySnapshot>(`/api/months/${baselineMonth}/summary`);
      baselineCache = { month: baselineMonth, data };
    } catch {
      baselineCache = { month: baselineMonth, data: null };
    }
    return baselineCache.data;
  }

  async function renderSummaryPage(month: string) {
    try {
      host.setMonth(month);
      host.renderMonthPicker('monthPicker', month, 'hasCapTableData');
      const availableMonths = await host.fetchAvailableMonths();
      const [data, baselineSummary] = await Promise.all([
        deps.api<SummarySnapshot>(`/api/months/${month}/summary`),
        loadBaselineSummary(
          resolveBaselineMonth(
            availableMonths.map((item) => item.month),
            month,
          ),
        ),
      ]);
      const capitalization = normalizeCapitalizationRows(data.capitalization, data.fixedValues?.seriesBPreferredStock);
      summary = { ...data, capitalization };
      host.setPageSourceFiles('captable', data.capitalizationSource?.fileName ?? t('defaultSnapshot'));
      host.getCurrentMonthTextNode().textContent = formatMonthCN(month);
      deps.el('eomDate').textContent = data.eomDate || getEOMDate(month);
      deps.el('reconciliationBody').innerHTML = `
    <tr>
      <td style="text-align:left; font-weight:600;">${deps.escapeHtml(data.reconciliation.item)}</td>
      <td>${deps.escapeHtml(data.eomDate || getEOMDate(month))}</td>
      <td class="highlight-number">${deps.formatNumber(data.reconciliation.lastMonth)}</td>
      <td class="highlight-number">${deps.formatNumber(data.reconciliation.newShares)}</td>
      <td class="highlight-number">${deps.formatNumber(data.reconciliation.eomBalance)}</td>
    </tr>`;

      const baselineIndex = indexCapitalizationRows(
        normalizeCapitalizationRows(
          baselineSummary?.capitalization ?? [],
          baselineSummary?.fixedValues?.seriesBPreferredStock,
        ),
      );
      const capBody = deps.el('capitalizationBody');
      capBody.innerHTML = capitalization
        .map((item) => {
          if (item.type === 'cat-header-blue' || item.type === 'cat-header-gray') {
            return `<tr class="cat-header-blue"><td></td><td colspan="5" style="text-align:left;">${deps.escapeHtml(item.description)}</td></tr>`;
          }
          const deltas = computeCapitalizationRowDeltas(item, findComparableRow(baselineIndex, item));
          if (item.type === 'cat-sub-label') {
            const sharesHtml =
              item.shares === undefined
                ? ''
                : item.highlightShares
                  ? `<span class="highlight-yellow">${deps.formatNumber(item.shares)}</span>`
                  : deps.formatNumber(item.shares);
            return `<tr class="cat-sub-label">
          <td></td><td style="text-align:left;">${deps.escapeHtml(item.description)}</td>
          <td class="col-number">${sharesHtml}</td>${renderCapitalizationDeltaCell(deltas.shares)}
          <td></td>${renderCapitalizationDeltaCell(deltas.percent)}
        </tr>`;
          }
          const percent = formatCapitalizationPercent(item.percent);
          const isTotalRow = isTotalFullyDilutedRow(item.description);
          return `<tr class="${isTotalRow ? 'total-row-blue' : 'cap-data-row'}">
        <td>${deps.escapeHtml(item.number ?? '')}</td>
        <td style="text-align:left;${isTotalRow ? ' font-weight:var(--font-bold);' : ''}">${deps.escapeHtml(item.description)}</td>
        <td class="col-number"${isTotalRow ? ' style="font-weight:var(--font-bold);"' : ''}>${deps.formatNumber(item.shares)}</td>${renderCapitalizationDeltaCell(deltas.shares)}
        <td class="col-percent"${isTotalRow ? ' style="font-weight:var(--font-bold);"' : ''}>${percent}</td>${renderCapitalizationDeltaCell(deltas.percent)}
      </tr>`;
        })
        .join('');
      applyCapitalizationSourceState(data.capitalizationSource ?? null);
      capBody.querySelectorAll<HTMLElement>('.link-blue').forEach((link) => {
        link.addEventListener('click', () => void host.openLinkModal(link.dataset.link ?? ''));
      });
      renderNotes(data.notes);
      host.localizeDom();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load summary data';
      if (/Month .* not found/i.test(message)) {
        renderEmptySummaryPage('暂无月度业务数据。请先创建 Monthly Update 或导入正式数据。');
        return;
      }
      summary = null;
      host.resetActivePageSourceFile();
      host.getCurrentMonthTextNode().textContent = t('noSummaryData');
      deps.el('eomDate').textContent = '-';
      deps.el('reconciliationBody').innerHTML =
        `<tr><td colspan="5" class="table-empty-cell">${deps.escapeHtml(message)}</td></tr>`;
      deps.el('capitalizationBody').innerHTML = '';
      applyCapitalizationSourceState(null);
      renderNotes([]);
      host.localizeDom();
    }
  }

  async function refreshSummarySourceFileOptions() {
    const data = await deps.api<{ files: ProductFileRecord[] }>('/api/files');
    sourceFiles = data.files;
    const select = deps.el<HTMLSelectElement>('capitalizationSourceFile');
    const currentValue = select.value;
    select.innerHTML = [
      `<option value="">${deps.escapeHtml(t('defaultSnapshot'))}</option>`,
      ...sourceFiles.map(
        (file) => `<option value="${file.id}">${deps.escapeHtml(deps.productFileDisplayName(file))}</option>`,
      ),
    ].join('');
    if (currentValue && sourceFiles.some((file) => String(file.id) === currentValue)) {
      select.value = currentValue;
    }
  }

  function applyCapitalizationSourceState(source: SummaryCapitalizationSource | null) {
    const select = deps.el<HTMLSelectElement>('capitalizationSourceFile');

    select.value = source?.fileId ? String(source.fileId) : '';
  }

  async function saveCapitalizationSource() {
    const select = deps.el<HTMLSelectElement>('capitalizationSourceFile');
    const targetMonth = summary?.month || deps.el<HTMLInputElement>('monthPicker').value || host.getMonth();

    select.disabled = true;

    try {
      await deps.api(`/api/months/${targetMonth}/capitalization-source`, {
        method: 'PUT',
        body: JSON.stringify({
          fileId: select.value ? Number(select.value) : null,
          sheetName: select.value ? FIXED_CAPITALIZATION_SUMMARY_SHEET : null,
        }),
      });
      baselineCache = null;
      await renderSummaryPage(targetMonth);
    } catch (error) {
      deps.notify((error as Error).message, { type: 'error' });
      baselineCache = null;
      await renderSummaryPage(targetMonth);
    } finally {
      select.disabled = false;
    }
  }

  function renderNotes(notes: SummarySnapshot['notes']) {
    const container = deps.el('notesContainer');
    if (!notes || notes.length === 0) {
      container.innerHTML = '<div class="note-empty">暂无备注，点击右上角添加备注按钮添加</div>';
      host.localizeDom();
      return;
    }
    container.innerHTML = notes
      .map(
        (note) => `
    <div class="note-item">
      <div class="note-header">
        <span class="note-time">${deps.escapeHtml(note.time)}</span>
        <div class="note-actions"><button class="note-action-btn" data-id="${note.id}" data-action="delete" title="删除">Delete</button></div>
      </div>
      <div class="note-content">${deps.escapeHtml(note.content)}</div>
    </div>`,
      )
      .join('');
    container.querySelectorAll<HTMLElement>('[data-action="delete"]').forEach((button) => {
      button.addEventListener('click', async () => {
        if (
          !(await deps.confirmAction('确定删除此备注吗？', { title: '删除备注', confirmText: '删除', tone: 'danger' }))
        )
          return;
        await deps.api(`/api/notes/${button.dataset.id}`, { method: 'DELETE' });
        await renderSummaryPage(host.getMonth());
      });
    });
    host.localizeDom();
  }

  function exportData() {
    if (!summary) {
      deps.notify('当前月份没有可导出的摘要数据', { type: 'warning' });
      return;
    }
    let csv = '\ufeff';
    csv += `${csvRow([`CapTable 股权数据 - ${formatMonthCN(host.getMonth())}`])}\n\n`;
    csv += `${csvRow(['【流通股份对账】'])}\n${csvRow(['项目', '截至日期', '上月末', '本月新增', '本月末'])}\n`;
    csv += `${csvRow([summary.reconciliation.item, summary.eomDate, summary.reconciliation.lastMonth, summary.reconciliation.newShares, summary.reconciliation.eomBalance])}\n\n`;
    csv += `${csvRow(['【资本结构】'])}\n${csvRow(['Description', '股份', '占比'])}\n`;
    summary.capitalization.forEach((item) => {
      csv += `${csvRow([item.description, item.shares, item.percent])}\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `CapTable_${host.getMonth()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
  /** Wire the capitalization source-file selector (its change handler saves the choice). */
  function bindSourceFileControl() {
    el<HTMLSelectElement>('capitalizationSourceFile').addEventListener('change', () => void saveCapitalizationSource());
  }

  return {
    bindSourceFileControl,
    render: renderSummaryPage,
    refreshSourceFileOptions: refreshSummarySourceFileOptions,
    exportCsv: exportData,
    renderEmpty: renderEmptySummaryPage,
  };
}

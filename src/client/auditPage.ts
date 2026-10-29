import type { AppLanguage } from './i18n.js';
import { createTexts } from './texts.js';
import type { NotifyFn } from './uiFeedback.js';
import type { AuditLogRecord } from '../shared/types.js';

/**
 * The audit page: who did what, when, and whether it stuck.
 *
 * The trail is written by one server hook for every mutating request (see src/server/audit.ts), so this
 * page is read-only by design — an audit log you can edit is not an audit log.
 */

export type AuditPageDeps = {
  el: <T extends HTMLElement>(id: string) => T;
  api: <T>(url: string, options?: RequestInit) => Promise<T>;
  escapeHtml: (text: unknown) => string;
  notify: NotifyFn;
  getLanguage: () => AppLanguage;
  formatDateTime: (value: string) => string;
};

export type AuditPageState = {
  page: number;
  pageSize: number;
  actor: string;
  action: string;
  entityType: string;
  status: '' | 'ok' | 'failed';
  from: string;
  to: string;
};

export type AuditPage = {
  render: () => Promise<void>;
  /** Re-render from the current filter inputs (search button / Enter). */
  applyFilters: () => Promise<void>;
  resetFilters: () => Promise<void>;
  goToPage: (page: number) => Promise<void>;
  currentPage: () => number;
  exportCsv: () => void;
  toggleDetail: (id: number) => void;
};

export const AUDIT_PAGE_SIZE = 50;

/**
 * Renders a stored action into the sentence an operator can read: the trail records
 * `POST /api/monthly-runs/:id/approvals`, not "triggered the monthly run" — that mapping lives here so
 * the text follows the UI language instead of being frozen in the database.
 */
export function describeAuditAction(
  record: Pick<AuditLogRecord, 'action' | 'summary' | 'method' | 'statusCode'>,
  t: (key: string) => string,
): string {
  const summary = record.summary ?? '';
  if (summary === 'auth.login') return t('auditActionLogin');
  if (summary === 'auth.login_failed') return t('auditActionLoginFailed');
  if (summary === 'auth.logout') return t('auditActionLogout');
  const method = record.method ?? record.action.split(' ')[0] ?? '';
  const path = record.action.replace(/^[A-Z]+ /, '');
  return `${method} ${path}`;
}

export function describeAuditResult(statusCode: number | null, t: (key: string) => string): string {
  if (statusCode === null) return t('auditResultUnknown');
  if (statusCode < 300) return t('auditResultOk');
  if (statusCode < 400) return t('auditResultRedirect');
  if (statusCode === 401 || statusCode === 403) return t('auditResultDenied');
  if (statusCode < 500) return t('auditResultRejected');
  return t('auditResultError');
}

export function createAuditPage(deps: AuditPageDeps): AuditPage {
  const { el, api, escapeHtml, notify } = deps;
  const read = createTexts('main');
  const t = (key: string) => read(key as Parameters<typeof read>[0], deps.getLanguage());

  const state: AuditPageState = {
    page: 1,
    pageSize: AUDIT_PAGE_SIZE,
    actor: '',
    action: '',
    entityType: '',
    status: '',
    from: '',
    to: '',
  };
  let items: AuditLogRecord[] = [];
  let total = 0;
  const expanded = new Set<number>();

  function queryString(): string {
    const params = new URLSearchParams({ page: String(state.page), pageSize: String(state.pageSize) });
    if (state.actor) params.set('actor', state.actor);
    if (state.action) params.set('action', state.action);
    if (state.entityType) params.set('entityType', state.entityType);
    if (state.status) params.set('status', state.status);
    if (state.from) params.set('from', state.from);
    if (state.to) params.set('to', state.to);
    return params.toString();
  }

  function readFilters() {
    state.actor = el<HTMLInputElement>('auditActorFilter').value.trim();
    state.action = el<HTMLInputElement>('auditActionFilter').value.trim();
    state.entityType = el<HTMLInputElement>('auditEntityFilter').value.trim();
    state.status = el<HTMLSelectElement>('auditStatusFilter').value as AuditPageState['status'];
    state.from = el<HTMLInputElement>('auditFromFilter').value;
    state.to = el<HTMLInputElement>('auditToFilter').value;
    state.page = 1;
  }

  function renderPagination() {
    const pages = Math.max(1, Math.ceil(total / state.pageSize));
    el('auditPageInfo').textContent = `${state.page} / ${pages} · ${total}`;
    el<HTMLButtonElement>('auditPrevPage').disabled = state.page <= 1;
    el<HTMLButtonElement>('auditNextPage').disabled = state.page >= pages;
  }

  function renderDetail(record: AuditLogRecord): string {
    if (!expanded.has(record.id)) return '';
    const payload = record.payload === null ? '—' : JSON.stringify(record.payload, null, 2);
    return `<tr class="audit-detail-row"><td colspan="7"><pre class="audit-detail">${escapeHtml(payload)}</pre>
      <div class="audit-detail-meta">${escapeHtml(record.path ?? '')}${record.userAgent ? ` · ${escapeHtml(record.userAgent)}` : ''}</div></td></tr>`;
  }

  async function render() {
    const data = await api<{ items: AuditLogRecord[]; total: number }>(`/api/audit-logs?${queryString()}`);
    items = data.items;
    total = data.total;
    const body = el('auditLogsBody');
    if (!items.length) {
      body.innerHTML = `<tr><td colspan="7" class="table-empty-cell">${escapeHtml(t('auditEmpty'))}</td></tr>`;
      renderPagination();
      return;
    }
    body.innerHTML = items
      .map(
        (record) => `
      <tr class="audit-row" data-audit-row="${record.id}">
        <td class="audit-time">${escapeHtml(deps.formatDateTime(record.createdAt))}</td>
        <td>${escapeHtml(record.actor)}${record.actorRole ? `<span class="audit-role">${escapeHtml(record.actorRole)}</span>` : ''}</td>
        <td>${escapeHtml(describeAuditAction(record, t))}</td>
        <td>${escapeHtml(record.entityType)}${record.entityId ? ` #${escapeHtml(record.entityId)}` : ''}</td>
        <td><span class="audit-result audit-result--${(record.statusCode ?? 0) < 400 ? 'ok' : 'failed'}">${escapeHtml(describeAuditResult(record.statusCode, t))}</span></td>
        <td class="col-number">${record.durationMs === null ? '—' : `${record.durationMs} ms`}</td>
        <td>${escapeHtml(record.ip ?? '—')}</td>
      </tr>
      ${renderDetail(record)}`,
      )
      .join('');
    renderPagination();
  }

  return {
    render,
    async applyFilters() {
      readFilters();
      await render();
    },
    async resetFilters() {
      for (const id of [
        'auditActorFilter',
        'auditActionFilter',
        'auditEntityFilter',
        'auditFromFilter',
        'auditToFilter',
      ]) {
        el<HTMLInputElement>(id).value = '';
      }
      el<HTMLSelectElement>('auditStatusFilter').value = '';
      state.actor = '';
      state.action = '';
      state.entityType = '';
      state.status = '';
      state.from = '';
      state.to = '';
      state.page = 1;
      expanded.clear();
      await render();
    },
    async goToPage(page: number) {
      state.page = Math.max(1, page);
      await render();
    },
    currentPage: () => state.page,
    exportCsv() {
      const params = new URLSearchParams(queryString());
      params.delete('page');
      params.delete('pageSize');
      window.open(`/api/audit-logs/export?${params.toString()}`, '_blank');
      notify(t('auditExportStarted'), { type: 'info' });
    },
    toggleDetail(id: number) {
      if (expanded.has(id)) expanded.delete(id);
      else expanded.add(id);
      void render();
    },
  };
}

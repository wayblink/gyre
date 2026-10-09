import type { AppLanguage } from './i18n.js';
import { createTexts } from './texts.js';
import type { ConfirmActionFn, NotifyFn } from './uiFeedback.js';
import type { FixedValueRecord } from '../shared/types.js';

/**
 * The Global Parameter page (list + create/edit/delete modals).
 *
 * Like the user-management page, this used to live at module level in main.ts with a single piece of
 * state (`editingFixedValueId`) that main's generic `[data-close]` handler had to know about in order
 * to reset it.
 */

export type FixedValuePageDeps = {
  el: <T extends HTMLElement>(id: string) => T;
  api: <T>(url: string, options?: RequestInit) => Promise<T>;
  escapeHtml: (text: unknown) => string;
  notify: NotifyFn;
  confirmAction: ConfirmActionFn;
  formatNumber: (value: number) => string;
  getLanguage: () => AppLanguage;
  isAdmin: () => boolean;
  /** Re-run the static DOM translation pass after rendering Chinese button copy. */
  localizeDom: () => void;
};

export type FixedValuePage = {
  render: () => Promise<void>;
  openCreateModal: () => void;
  submitCreate: () => Promise<void>;
  submitEdit: () => Promise<void>;
  /** Reset the in-progress edit when its modal is dismissed. */
  cancelEdit: () => void;
};

export function createFixedValuePage(deps: FixedValuePageDeps): FixedValuePage {
  const { el, api, escapeHtml, notify, confirmAction, formatNumber } = deps;
  const read = createTexts('main');
  const t = (key: Parameters<typeof read>[0]) => read(key, deps.getLanguage());

  let editingId: number | null = null;

  async function render() {
    const data = await api<{ items: FixedValueRecord[] }>('/api/global-parameters');
    if (data.items.length === 0) {
      el('fixedValuePageBody').innerHTML =
        '<tr><td colspan="6" class="table-empty-cell">暂无 Global Parameter 配置</td></tr>';
      deps.localizeDom();
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
            deps.isAdmin() && item.editable
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
      .forEach((button) => button.addEventListener('click', () => void edit(Number(button.dataset.id), data.items)));
    el('fixedValuePageBody')
      .querySelectorAll<HTMLElement>('[data-action="delete-fixed-value"]')
      .forEach((button) => button.addEventListener('click', () => void remove(Number(button.dataset.id), data.items)));
    deps.localizeDom();
  }

  async function edit(id: number, items: FixedValueRecord[]) {
    if (!deps.isAdmin()) return;
    const item = items.find((row) => row.id === id);
    if (!item) return;
    editingId = item.id;
    el<HTMLInputElement>('fixedValueEditKey').value = item.key;
    el<HTMLInputElement>('fixedValueEditLabel').value = item.label;
    el<HTMLInputElement>('fixedValueEditValue').value = String(item.value);
    el('fixedValueEditModal').classList.remove('hidden');
    el<HTMLInputElement>('fixedValueEditValue').focus();
  }

  async function submitEdit() {
    if (!deps.isAdmin() || editingId === null) return;
    const label = el<HTMLInputElement>('fixedValueEditLabel').value.trim();
    const rawValue = el<HTMLInputElement>('fixedValueEditValue').value.replace(/,/g, '').trim();
    const value = Number(rawValue);
    if (!label || !Number.isFinite(value)) {
      notify(t('fixedValueEditInvalid'), { type: 'warning' });
      return;
    }
    const submitButton = el<HTMLButtonElement>('btnSubmitFixedValueEdit');
    submitButton.disabled = true;
    try {
      await api(`/api/global-parameters/${editingId}`, {
        method: 'PATCH',
        body: JSON.stringify({ label, value }),
      });
      editingId = null;
      el('fixedValueEditModal').classList.add('hidden');
      await render();
      notify(t('fixedValueSaved'), { type: 'success' });
    } catch (error) {
      notify((error as Error).message, { type: 'error' });
    } finally {
      submitButton.disabled = false;
    }
  }

  function openCreateModal() {
    if (!deps.isAdmin()) return;
    el<HTMLInputElement>('fixedValueKey').value = '';
    el<HTMLInputElement>('fixedValueLabel').value = '';
    el<HTMLInputElement>('fixedValueValue').value = '';
    el('fixedValueModal').classList.remove('hidden');
    el<HTMLInputElement>('fixedValueKey').focus();
  }

  async function submitCreate() {
    if (!deps.isAdmin()) return;
    const key = el<HTMLInputElement>('fixedValueKey').value.trim();
    const label = el<HTMLInputElement>('fixedValueLabel').value.trim();
    const rawValue = el<HTMLInputElement>('fixedValueValue').value.replace(/,/g, '').trim();
    const value = Number(rawValue);
    if (!key || !label || !rawValue || !Number.isFinite(value)) {
      notify(t('fixedValueCreateInvalid'), { type: 'warning' });
      return;
    }

    const submitButton = el<HTMLButtonElement>('btnSubmitFixedValue');
    submitButton.disabled = true;
    try {
      await api('/api/global-parameters', {
        method: 'POST',
        body: JSON.stringify({ key, label, value }),
      });
      el('fixedValueModal').classList.add('hidden');
      await render();
      notify(t('fixedValueCreated'), { type: 'success' });
    } catch (error) {
      notify((error as Error).message, { type: 'error' });
    } finally {
      submitButton.disabled = false;
    }
  }

  async function remove(id: number, items: FixedValueRecord[]) {
    if (!deps.isAdmin()) return;
    const item = items.find((row) => row.id === id);
    if (!item) return;
    if (
      !(await confirmAction(t('fixedValueDeleteConfirm').replace('{label}', item.label), {
        title: t('deleteGlobalParameter'),
        confirmText: t('delete'),
        tone: 'danger',
      }))
    )
      return;

    try {
      await api(`/api/global-parameters/${id}`, { method: 'DELETE' });
      await render();
      notify(t('fixedValueDeleted'), { type: 'success' });
    } catch (error) {
      notify((error as Error).message, { type: 'error' });
    }
  }

  return {
    render,
    openCreateModal,
    submitCreate,
    submitEdit,
    cancelEdit() {
      editingId = null;
    },
  };
}

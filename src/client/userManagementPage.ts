import type { AppLanguage } from './i18n.js';
import type { ConfirmActionFn, NotifyFn } from './uiFeedback.js';
import { createTextFormatter, createTexts } from './texts.js';
import type { ManagedUser } from '../shared/types.js';

/**
 * The admin user-management page (list + create/edit modal).
 *
 * It owns the two pieces of state the page needs — the loaded user list and which user the modal is
 * editing — which used to live at module level in main.ts and forced main.ts's `applyLanguage()` to
 * reach into them to relabel the modal.
 */

export type UserManagementPageDeps = {
  el: <T extends HTMLElement>(id: string) => T;
  api: <T>(url: string, options?: RequestInit) => Promise<T>;
  escapeHtml: (text: unknown) => string;
  notify: NotifyFn;
  confirmAction: ConfirmActionFn;
  getLanguage: () => AppLanguage;
  formatDateTime: (value: string) => string;
  isAdmin: () => boolean;
  /** Where to send a non-admin who lands on this page. */
  redirectToDefaultPage: () => void | Promise<void>;
};

export type UserManagementPage = {
  /** Re-render the table and relabel the modal for the current language. */
  applyLanguage: () => void;
  load: () => Promise<void>;
  bindEvents: () => void;
};

const TABLE_COLUMN_KEYS = [
  'username',
  'displayName',
  'role',
  'status',
  'email',
  'contact',
  'lastLogin',
  'createdAt',
  'actions',
] as const;

export function createUserManagementPage(deps: UserManagementPageDeps): UserManagementPage {
  const { el, api, escapeHtml, notify, confirmAction, formatDateTime } = deps;
  const read = createTexts('main');
  const t = (key: Parameters<typeof read>[0]) => read(key, deps.getLanguage());
  const tp = createTextFormatter('main');

  let users: ManagedUser[] = [];
  let editingUserId: number | null = null;

  function statusLabel(user: ManagedUser): string {
    return user.isActive ? t('active') : t('inactive');
  }

  function renderTable() {
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
      if (TABLE_COLUMN_KEYS.includes(key as (typeof TABLE_COLUMN_KEYS)[number])) {
        node.textContent = headerLabels[key] ?? node.textContent ?? '';
      }
    });

    const body = el<HTMLTableSectionElement>('userManagementBody');
    if (!users.length) {
      body.innerHTML = `<tr><td colspan="9" class="table-empty-cell">${escapeHtml(t('noUsers'))}</td></tr>`;
      return;
    }
    body.innerHTML = users
      .map(
        (user) => `
    <tr data-managed-user-id="${user.id}">
      <td>${escapeHtml(user.username)}</td>
      <td>${escapeHtml(user.displayName)}</td>
      <td>${escapeHtml(user.role)}</td>
      <td>${escapeHtml(statusLabel(user))}</td>
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
      button.addEventListener('click', () => openModal(Number(button.dataset.editManagedUser)));
    });
    body.querySelectorAll<HTMLButtonElement>('[data-delete-managed-user]').forEach((button) => {
      button.addEventListener('click', () => void deleteUser(Number(button.dataset.deleteManagedUser)));
    });
  }

  /** Modal labels that depend on whether the modal is creating or editing. */
  function renderModalLabels() {
    el('managedUserModalTitle').textContent = editingUserId ? t('editUser') : t('createUser');
    el('managedUserModalSubtitle').textContent = editingUserId
      ? t('managedUserSubtitleEdit')
      : t('managedUserSubtitleCreate');
    const passwordLabel = document.querySelectorAll<HTMLElement>('#managedUserModal .form-group label')[5];
    if (passwordLabel) passwordLabel.textContent = editingUserId ? t('optionalPassword') : t('password');
    el('btnSubmitManagedUser').textContent = editingUserId ? t('save') : t('createUser');
  }

  function closeModal() {
    el('managedUserModal').classList.add('hidden');
    editingUserId = null;
  }

  function openModal(userId?: number) {
    const user = users.find((item) => item.id === userId) ?? null;
    editingUserId = user?.id ?? null;
    el<HTMLInputElement>('managedUserUsername').value = user?.username ?? '';
    el<HTMLInputElement>('managedUserDisplayName').value = user?.displayName ?? '';
    el<HTMLSelectElement>('managedUserRole').value = user?.role ?? 'user';
    el<HTMLInputElement>('managedUserEmail').value = user?.email ?? '';
    el<HTMLInputElement>('managedUserPhone').value = user?.phone ?? '';
    el<HTMLInputElement>('managedUserPassword').value = '';
    el<HTMLSelectElement>('managedUserIsActive').value = user?.isActive === false ? 'false' : 'true';
    renderModalLabels();
    el('managedUserModal').classList.remove('hidden');
  }

  async function submit() {
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
      notify(t('usernameAndDisplayNameRequired'), { type: 'warning' });
      return;
    }
    if (!editingUserId) {
      if (!password) {
        notify(t('newUserPasswordRequired'), { type: 'warning' });
        return;
      }
      payload.password = password;
    } else if (password) {
      payload.password = password;
    }

    try {
      const response = editingUserId
        ? await api<{ user: ManagedUser }>(`/api/admin/users/${editingUserId}`, {
            method: 'PATCH',
            body: JSON.stringify(payload),
          })
        : await api<{ user: ManagedUser }>('/api/admin/users', {
            method: 'POST',
            body: JSON.stringify(payload),
          });
      const index = users.findIndex((user) => user.id === response.user.id);
      users =
        index >= 0
          ? users.map((user) => (user.id === response.user.id ? response.user : user))
          : [...users, response.user];
      // Keep the list defined even if the server omitted it, so the next render cannot throw.
      users = users ?? [];
      closeModal();
      renderTable();
      notify(t('userSaved'), { type: 'success' });
    } catch (error) {
      notify((error as Error).message, { type: 'error' });
    }
  }

  async function deleteUser(userId: number) {
    const user = users.find((item) => item.id === userId);
    if (!user) return;
    const confirmed = await confirmAction(tp('confirmDeleteUser', { username: user.username }, deps.getLanguage()), {
      title: t('delete'),
      confirmText: t('delete'),
      tone: 'danger',
    });
    if (!confirmed) return;
    try {
      await api(`/api/admin/users/${userId}`, { method: 'DELETE' });
      users = users.filter((item) => item.id !== userId);
      renderTable();
      notify(t('userDeleted'), { type: 'success' });
    } catch (error) {
      notify((error as Error).message, { type: 'error' });
    }
  }

  return {
    applyLanguage() {
      renderTable();
      renderModalLabels();
    },
    async load() {
      if (!deps.isAdmin()) {
        await deps.redirectToDefaultPage();
        return;
      }
      const data = await api<{ users: ManagedUser[] }>('/api/admin/users');
      users = data.users ?? [];
      renderTable();
    },
    bindEvents() {
      el('btnOpenManagedUserModal').addEventListener('click', () => openModal());
      el('btnSubmitManagedUser').addEventListener('click', () => void submit());
      document.querySelectorAll<HTMLElement>('[data-close="managedUserModal"]').forEach((button) => {
        button.addEventListener('click', closeModal);
      });
      el('managedUserModal').addEventListener('click', (event) => {
        if (event.target === el('managedUserModal')) closeModal();
      });
    },
  };
}

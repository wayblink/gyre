import type { AppLanguage } from './i18n.js';
import { createTexts } from './texts.js';
import type { NotifyFn } from './uiFeedback.js';
import type { AccountProfile, AuthenticatedUser } from '../shared/types.js';

/**
 * The account page: the signed-in user's own profile and password.
 *
 * It is self-contained (one GET, one PATCH for the profile, one PATCH for the password) but it also
 * has to keep the app shell in sync when the profile changes, which is why it takes an
 * `onProfileSaved` callback instead of reaching into main.ts's auth state.
 */

export type AccountPageDeps = {
  el: <T extends HTMLElement>(id: string) => T;
  api: <T>(url: string, options?: RequestInit) => Promise<T>;
  notify: NotifyFn;
  getLanguage: () => AppLanguage;
  /** Called after a successful profile save so the shell re-renders the avatar and role gating. */
  onProfileSaved: (user: AuthenticatedUser) => void;
};

export type AccountPage = {
  load: () => Promise<void>;
  submitProfile: () => Promise<void>;
  submitPassword: () => Promise<void>;
  openPasswordModal: () => void;
  closePasswordModal: () => void;
};

const MIN_PASSWORD_LENGTH = 8;

export function createAccountPage(deps: AccountPageDeps): AccountPage {
  const { el, api, notify } = deps;
  const read = createTexts('main');
  const t = (key: Parameters<typeof read>[0]) => read(key, deps.getLanguage());

  function closePasswordModal() {
    el('accountPasswordModal').classList.add('hidden');
  }

  function resetPasswordForm() {
    el<HTMLInputElement>('accountCurrentPassword').value = '';
    el<HTMLInputElement>('accountNewPassword').value = '';
    el<HTMLInputElement>('accountConfirmNewPassword').value = '';
  }

  return {
    async load() {
      const data = await api<{ account: AccountProfile }>('/api/account');
      el<HTMLInputElement>('accountUsername').value = data.account.username;
      el<HTMLInputElement>('accountDisplayName').value = data.account.displayName;
      el<HTMLInputElement>('accountEmail').value = data.account.email ?? '';
      el<HTMLInputElement>('accountPhone').value = data.account.phone ?? '';
    },

    async submitProfile() {
      const payload = {
        username: el<HTMLInputElement>('accountUsername').value.trim(),
        displayName: el<HTMLInputElement>('accountDisplayName').value.trim(),
        email: el<HTMLInputElement>('accountEmail').value.trim() || null,
        phone: el<HTMLInputElement>('accountPhone').value.trim() || null,
      };
      if (!payload.username || !payload.displayName) {
        notify(t('accountNameRequired'), { type: 'warning' });
        return;
      }
      try {
        const data = await api<{ account: AccountProfile }>('/api/account', {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        deps.onProfileSaved(data.account);
        notify(t('accountSaved'), { type: 'success' });
      } catch (error) {
        notify((error as Error).message, { type: 'error' });
      }
    },

    async submitPassword() {
      const currentPassword = el<HTMLInputElement>('accountCurrentPassword').value;
      const newPassword = el<HTMLInputElement>('accountNewPassword').value;
      const confirmNewPassword = el<HTMLInputElement>('accountConfirmNewPassword').value;
      if (!currentPassword || !newPassword || !confirmNewPassword) {
        notify(t('accountPasswordIncomplete'), { type: 'warning' });
        return;
      }
      if (newPassword !== confirmNewPassword) {
        notify(t('accountPasswordMismatch'), { type: 'warning' });
        return;
      }
      if (newPassword.length < MIN_PASSWORD_LENGTH) {
        notify(t('accountPasswordTooShort'), { type: 'warning' });
        return;
      }
      try {
        await api('/api/account/password', {
          method: 'PATCH',
          body: JSON.stringify({ currentPassword, newPassword }),
        });
        resetPasswordForm();
        closePasswordModal();
        notify(t('accountPasswordUpdated'), { type: 'success' });
      } catch (error) {
        notify((error as Error).message, { type: 'error' });
      }
    },

    openPasswordModal() {
      resetPasswordForm();
      el('accountPasswordModal').classList.remove('hidden');
      el<HTMLInputElement>('accountCurrentPassword').focus();
    },

    closePasswordModal,
  };
}

export type AppNoticeType = 'info' | 'success' | 'warning' | 'error';

import { readStoredLanguage, translateStaticText } from './i18n.js';

export type NotifyOptions = {
  type?: AppNoticeType;
  durationMs?: number;
};

export type ConfirmActionOptions = {
  title?: string;
  confirmText?: string;
  cancelText?: string;
  tone?: 'default' | 'danger';
};

export type NotifyFn = (message: string, options?: NotifyOptions) => void;
export type ConfirmActionFn = (message: string, options?: ConfirmActionOptions) => Promise<boolean>;

const NOTICE_TITLES: Record<AppNoticeType, string> = {
  info: '提示',
  success: '完成',
  warning: '需要注意',
  error: '发生错误',
};

function getNoticeHost(): HTMLElement {
  const host = document.getElementById('appNoticeHost');
  if (!host) throw new Error('Missing element #appNoticeHost');
  return host;
}

function getConfirmElement<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
}

export function notify(message: string, options: NotifyOptions = {}) {
  const type = options.type ?? 'info';
  const language = readStoredLanguage();
  const durationMs = options.durationMs ?? (type === 'error' ? 5600 : 3600);
  const host = getNoticeHost();
  const notice = document.createElement('div');
  notice.className = `app-notice app-notice--${type}`;
  notice.setAttribute('role', type === 'error' ? 'alert' : 'status');
  notice.innerHTML = `
    <span class="app-notice__icon" aria-hidden="true"></span>
    <span class="app-notice__content">
      <strong>${translateStaticText(NOTICE_TITLES[type], language)}</strong>
      <span></span>
    </span>
    <button class="app-notice__close" type="button" aria-label="${translateStaticText('关闭通知', language)}">&times;</button>
  `;
  notice.querySelector('.app-notice__content span')!.textContent = translateStaticText(message, language);

  const close = () => {
    notice.classList.add('is-leaving');
    window.setTimeout(() => notice.remove(), 160);
  };
  notice.querySelector<HTMLButtonElement>('.app-notice__close')?.addEventListener('click', close);
  host.appendChild(notice);
  window.setTimeout(close, durationMs);
}

export function confirmAction(message: string, options: ConfirmActionOptions = {}): Promise<boolean> {
  const language = readStoredLanguage();
  const overlay = getConfirmElement('appConfirmOverlay');
  const dialog = getConfirmElement('appConfirmDialog');
  const title = getConfirmElement('appConfirmTitle');
  const body = getConfirmElement('appConfirmMessage');
  const confirmButton = getConfirmElement<HTMLButtonElement>('appConfirmAction');
  const cancelButton = getConfirmElement<HTMLButtonElement>('appConfirmCancel');
  const closeButton = getConfirmElement<HTMLButtonElement>('appConfirmClose');

  title.textContent = translateStaticText(options.title ?? '确认操作', language);
  body.textContent = translateStaticText(message, language);
  confirmButton.textContent = translateStaticText(options.confirmText ?? '确认', language);
  cancelButton.textContent = translateStaticText(options.cancelText ?? '取消', language);
  confirmButton.classList.toggle('btn-danger', options.tone === 'danger');
  confirmButton.classList.toggle('btn-primary', options.tone !== 'danger');

  overlay.classList.remove('hidden');
  dialog.focus();

  return new Promise((resolve) => {
    const cleanup = (result: boolean) => {
      overlay.classList.add('hidden');
      confirmButton.removeEventListener('click', onConfirm);
      cancelButton.removeEventListener('click', onCancel);
      closeButton.removeEventListener('click', onCancel);
      overlay.removeEventListener('click', onOverlayClick);
      document.removeEventListener('keydown', onKeydown);
      resolve(result);
    };
    const onConfirm = () => cleanup(true);
    const onCancel = () => cleanup(false);
    const onOverlayClick = (event: MouseEvent) => {
      if (event.target === overlay) cleanup(false);
    };
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cleanup(false);
    };

    confirmButton.addEventListener('click', onConfirm);
    cancelButton.addEventListener('click', onCancel);
    closeButton.addEventListener('click', onCancel);
    overlay.addEventListener('click', onOverlayClick);
    document.addEventListener('keydown', onKeydown);
  });
}

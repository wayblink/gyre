import { readStoredLanguage, translateRecord, type AppLanguage } from './i18n.js';

type LocalizedText = string | Record<AppLanguage, string>;

type UploadProgressOptions = {
  method?: 'POST' | 'PUT' | 'PATCH';
  fileName?: string;
  title?: LocalizedText;
  completedText?: LocalizedText;
};

export class UploadHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'UploadHttpError';
  }
}

const DEFAULT_TITLE = { 'zh-CN': '正在上传文件', 'en-US': 'Uploading file' };
const DEFAULT_STATUS = { 'zh-CN': '准备上传...', 'en-US': 'Preparing upload...' };
const UPLOADING_STATUS = { 'zh-CN': '正在上传...', 'en-US': 'Uploading...' };
const DEFAULT_COMPLETE = { 'zh-CN': '上传完成', 'en-US': 'Upload completed' };

function localize(copy: LocalizedText | undefined, fallback: Record<AppLanguage, string>): string {
  if (!copy) return translateRecord(fallback, readStoredLanguage());
  if (typeof copy === 'string') return copy;
  return translateRecord(copy, readStoredLanguage());
}

function getElement<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function setText(id: string, value: string) {
  const element = getElement(id);
  if (element) element.textContent = value;
}

function setProgress(value: number | null) {
  const progress = getElement<HTMLElement>('uploadProgressBar');
  const fill = getElement<HTMLElement>('uploadProgressFill');
  const percent = getElement('uploadProgressPercent');
  if (!progress || !fill || !percent) return;

  if (value === null) {
    progress.removeAttribute('aria-valuenow');
    progress.classList.add('upload-progress__track--indeterminate');
    fill.style.width = '45%';
    percent.textContent = '--';
    return;
  }

  const bounded = Math.max(0, Math.min(100, Math.round(value)));
  progress.setAttribute('aria-valuenow', String(bounded));
  progress.classList.remove('upload-progress__track--indeterminate');
  fill.style.width = `${bounded}%`;
  percent.textContent = `${bounded}%`;
}

function showUploadProgress(options: UploadProgressOptions) {
  const modal = getElement('uploadProgressModal');
  if (!modal) return;

  setText('uploadProgressTitle', localize(options.title, DEFAULT_TITLE));
  setText('uploadProgressFileName', options.fileName ?? '');
  setText('uploadProgressStatus', localize(undefined, DEFAULT_STATUS));
  setProgress(0);
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
}

function hideUploadProgress() {
  const modal = getElement('uploadProgressModal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
}

function parseUploadResponse<T>(xhr: XMLHttpRequest): T {
  if (!xhr.responseText) return undefined as T;
  return JSON.parse(xhr.responseText) as T;
}

function parseUploadError(xhr: XMLHttpRequest): { message: string; body: Record<string, unknown> } {
  if (xhr.responseText) {
    try {
      const body = JSON.parse(xhr.responseText) as Record<string, unknown>;
      return { message: String(body.error ?? body.message ?? xhr.statusText), body };
    } catch {
      return { message: xhr.responseText, body: {} };
    }
  }
  return { message: xhr.statusText || 'Upload failed', body: {} };
}

export function uploadFormDataWithProgress<T>(
  url: string,
  form: FormData,
  options: UploadProgressOptions = {},
): Promise<T> {
  showUploadProgress(options);

  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(options.method ?? 'POST', url);
    xhr.withCredentials = true;
    xhr.setRequestHeader('Accept', 'application/json');

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || event.total <= 0) {
        setProgress(null);
        setText('uploadProgressStatus', localize(undefined, UPLOADING_STATUS));
        return;
      }
      const percent = Math.round((event.loaded / event.total) * 100);
      setProgress(percent);
      setText('uploadProgressStatus', readStoredLanguage() === 'en-US' ? `Uploading ${percent}%` : `正在上传 ${percent}%`);
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        setProgress(100);
        setText('uploadProgressStatus', localize(options.completedText, DEFAULT_COMPLETE));
        window.setTimeout(hideUploadProgress, 300);
        try {
          resolve(parseUploadResponse<T>(xhr));
        } catch (error) {
          reject(error);
        }
        return;
      }

      hideUploadProgress();
      const parsed = parseUploadError(xhr);
      reject(new UploadHttpError(xhr.status === 401 ? '请先登录' : parsed.message, xhr.status, parsed.body));
    };

    xhr.onerror = () => {
      hideUploadProgress();
      reject(new Error('Upload failed due to a network error'));
    };

    xhr.onabort = () => {
      hideUploadProgress();
      reject(new Error('Upload cancelled'));
    };

    xhr.ontimeout = () => {
      hideUploadProgress();
      reject(new Error('Upload timed out'));
    };

    xhr.send(form);
  });
}

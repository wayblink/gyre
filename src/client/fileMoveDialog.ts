import type { ProductFileRecord } from '../shared/types.js';
import type { NotifyFn } from './uiFeedback.js';
import type { AppLanguage } from './i18n.js';
import { collectProductFileFolders, normalizeClientFolder, productFileFolder } from './fileTree.js';

type DomGetter = <T extends HTMLElement>(id: string) => T;

export type FileMoveDialogDeps = {
  el: DomGetter;
  api: <T>(url: string, options?: RequestInit) => Promise<T>;
  escapeHtml: (text: unknown) => string;
  getProductFiles: () => ProductFileRecord[];
  notify: NotifyFn;
  getLanguage?: () => AppLanguage;
};

export type FileMoveOutcome = {
  moved: number;
  rewrittenWorkflows: number;
  failures: Array<{ file: ProductFileRecord; message: string }>;
};

type MoveResponse = { file: ProductFileRecord; rewrittenWorkflows: number };

export function createFileMoveDialog({ el, api, escapeHtml, getProductFiles, notify, getLanguage }: FileMoveDialogDeps) {
  const text = {
    title: { 'zh-CN': '移动文件', 'en-US': 'Move files' },
    singleSubtitle: { 'zh-CN': '选择目标目录，或填写新的目录路径。', 'en-US': 'Pick a target folder, or enter a new folder path.' },
    multiSubtitle: { 'zh-CN': '所选文件会一起移动到目标目录。', 'en-US': 'The selected files are moved to the target folder together.' },
    newFolderLabel: { 'zh-CN': '或填写新目录路径', 'en-US': 'Or enter a new folder path' },
    cancel: { 'zh-CN': '取消', 'en-US': 'Cancel' },
    confirm: { 'zh-CN': '移动', 'en-US': 'Move' },
    invalidFolder: { 'zh-CN': '目录路径不合法', 'en-US': 'Invalid folder path' },
    pickFolder: { 'zh-CN': '请选择目标目录', 'en-US': 'Pick a target folder' },
    sameFolder: { 'zh-CN': '文件已经在该目录中', 'en-US': 'The files already live in that folder' },
    moved: { 'zh-CN': '个文件已移动到', 'en-US': 'file(s) moved to' },
    rewritten: { 'zh-CN': '个工作流的引用已同步更新', 'en-US': 'workflow(s) had their references updated' },
    failed: { 'zh-CN': '个文件移动失败', 'en-US': 'file(s) could not be moved' },
    moveFailed: { 'zh-CN': '移动文件失败', 'en-US': 'Failed to move the files' },
    selectedFiles: { 'zh-CN': '已选择', 'en-US': 'Selected' },
    files: { 'zh-CN': '个文件', 'en-US': 'files' },
  } satisfies Record<string, Record<AppLanguage, string>>;

  function tt(key: keyof typeof text): string {
    const language = getLanguage?.() ?? 'zh-CN';
    return text[key][language] ?? text[key]['zh-CN'];
  }

  let pending: ((outcome: FileMoveOutcome | null) => void) | null = null;
  let targetFiles: ProductFileRecord[] = [];
  let targetFolder = '';
  let moving = false;
  let bound = false;

  function overlay() {
    return el('fileMoveModal');
  }

  function open(fileIds: number[]): Promise<FileMoveOutcome | null> {
    if (pending) return Promise.resolve(null);
    const files = getProductFiles().filter((file) => fileIds.includes(file.id));
    if (!files.length) return Promise.resolve(null);
    bind();
    targetFiles = files;
    targetFolder = files.length === 1 ? productFileFolder(files[0]) : '';
    moving = false;
    el<HTMLInputElement>('fileMoveNewFolder').value = '';
    setError('');
    renderHeader();
    renderFolderList();
    overlay().classList.remove('hidden');
    return new Promise((resolve) => {
      pending = resolve;
    });
  }

  function settle(outcome: FileMoveOutcome | null) {
    const resolve = pending;
    pending = null;
    overlay().classList.add('hidden');
    resolve?.(outcome);
  }

  function bind() {
    if (bound) return;
    bound = true;
    el('btnCloseFileMoveModal').addEventListener('click', () => !moving && settle(null));
    el('btnCancelFileMoveModal').addEventListener('click', () => !moving && settle(null));
    overlay().addEventListener('click', (event) => {
      if (event.target === overlay() && !moving) settle(null);
    });
    el('btnConfirmFileMoveModal').addEventListener('click', () => void confirmMove());
  }

  function renderHeader() {
    el('fileMoveModalTitle').textContent = tt('title');
    el('fileMoveModalSubtitle').textContent = targetFiles.length === 1 ? tt('singleSubtitle') : tt('multiSubtitle');
    el('fileMoveNewFolderLabel').textContent = tt('newFolderLabel');
    el('btnCancelFileMoveModal').textContent = tt('cancel');
    el('btnConfirmFileMoveModal').textContent = tt('confirm');
    el('fileMoveModalFiles').innerHTML = targetFiles.length === 1
      ? `<div class="file-move__file">${escapeHtml(targetFiles[0].logicalPath ?? targetFiles[0].displayPath)}</div>`
      : `<div class="file-move__file">${escapeHtml(`${tt('selectedFiles')} ${targetFiles.length} ${tt('files')}`)}</div>`;
  }

  function renderFolderList() {
    const folders = collectProductFileFolders(getProductFiles());
    el('fileMoveFolderList').innerHTML = folders
      .map(
        (folder) => `<button
          class="workflow-file-picker__folder ${folder === targetFolder ? 'is-selected' : ''}"
          data-file-move-folder="${escapeHtml(folder)}"
          type="button"
        >${escapeHtml(folder)}</button>`,
      )
      .join('');
    el('fileMoveFolderList').querySelectorAll<HTMLElement>('[data-file-move-folder]').forEach((button) => {
      button.addEventListener('click', () => {
        targetFolder = button.dataset.fileMoveFolder ?? '';
        el<HTMLInputElement>('fileMoveNewFolder').value = '';
        setError('');
        renderFolderList();
      });
    });
  }

  function setError(message: string) {
    const target = el('fileMoveModalError');
    target.textContent = message;
    target.classList.toggle('hidden', !message);
  }

  async function confirmMove() {
    if (moving) return;
    const typedFolder = el<HTMLInputElement>('fileMoveNewFolder').value.trim();
    let folder: string;
    try {
      folder = typedFolder ? normalizeClientFolder(typedFolder) : targetFolder;
    } catch {
      setError(tt('invalidFolder'));
      return;
    }
    if (!typedFolder && !targetFolder && targetFiles.length > 1) {
      setError(tt('pickFolder'));
      return;
    }
    if (targetFiles.every((file) => productFileFolder(file) === folder)) {
      setError(tt('sameFolder'));
      return;
    }

    moving = true;
    el<HTMLButtonElement>('btnConfirmFileMoveModal').disabled = true;
    const outcome: FileMoveOutcome = { moved: 0, rewrittenWorkflows: 0, failures: [] };

    for (const file of targetFiles) {
      if (productFileFolder(file) === folder) continue;
      try {
        const response = await api<MoveResponse>(`/api/files/${file.id}/move`, {
          method: 'POST',
          body: JSON.stringify({ folder }),
        });
        outcome.moved += 1;
        outcome.rewrittenWorkflows += response.rewrittenWorkflows;
      } catch (error) {
        outcome.failures.push({ file, message: error instanceof Error ? error.message : tt('moveFailed') });
      }
    }

    moving = false;
    el<HTMLButtonElement>('btnConfirmFileMoveModal').disabled = false;

    if (!outcome.moved) {
      setError(outcome.failures[0]?.message ?? tt('moveFailed'));
      return;
    }

    const parts = [`${outcome.moved} ${tt('moved')} ${folder || 'input'}`];
    if (outcome.rewrittenWorkflows > 0) parts.push(`${outcome.rewrittenWorkflows} ${tt('rewritten')}`);
    if (outcome.failures.length > 0) parts.push(`${outcome.failures.length} ${tt('failed')}`);
    notify(parts.join('，'), { type: outcome.failures.length > 0 ? 'warning' : 'success' });
    settle(outcome);
  }

  return { open };
}

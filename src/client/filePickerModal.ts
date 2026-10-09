import type { ProductFileRecord } from '../shared/types.js';
import type { ConfirmActionFn, NotifyFn } from './uiFeedback.js';
import type { AppLanguage } from './i18n.js';
import { UploadHttpError, uploadFormDataWithProgress } from './uploadProgress.js';
import {
  buildProductFilesTree,
  collectProductFileFolders,
  compareProductFile,
  compareTreeNode,
  countTreeFiles,
  normalizeClientFolder,
  productFileFolder,
  productFileLogicalTreePath,
  type FileTreeNode,
} from './fileTree.js';

type DomGetter = <T extends HTMLElement>(id: string) => T;

export type FilePickerModalDeps = {
  el: DomGetter;
  api: <T>(url: string, options?: RequestInit) => Promise<T>;
  escapeHtml: (text: unknown) => string;
  formatFileSize: (bytes: number) => string;
  getProductFiles: () => ProductFileRecord[];
  refreshProductFiles: () => Promise<unknown>;
  notify: NotifyFn;
  confirmAction: ConfirmActionFn;
  getLanguage?: () => AppLanguage;
};

export type FilePickerOpenOptions = {
  titleKey?: 'title' | 'defaultFileTitle' | 'fileSourceTitle';
  currentFileId?: number | null;
  allowClear?: boolean;
  uploadFolderPrefix?: string;
};

export type FilePickerResult = { action: 'pick'; fileId: number } | { action: 'clear' };

type MoveResponse = { file: ProductFileRecord; rewrittenWorkflows: number };

const SEARCH_DEBOUNCE_MS = 120;

export function createFilePickerModal({
  el,
  api,
  escapeHtml,
  formatFileSize,
  getProductFiles,
  refreshProductFiles,
  notify,
  confirmAction,
  getLanguage,
}: FilePickerModalDeps) {
  const text = {
    title: { 'zh-CN': '选择文件', 'en-US': 'Select file' },
    defaultFileTitle: { 'zh-CN': '选择默认文件', 'en-US': 'Select default file' },
    fileSourceTitle: { 'zh-CN': '选择文件来源', 'en-US': 'Select file source' },
    subtitle: {
      'zh-CN': '点击选择文件，也可以上传新文件或把文件移动到其他目录。',
      'en-US': 'Click a file to select it. You can also upload a new file or move a file to another folder.',
    },
    searchPlaceholder: { 'zh-CN': '搜索文件…', 'en-US': 'Search files…' },
    upload: { 'zh-CN': '上传新文件', 'en-US': 'Upload' },
    move: { 'zh-CN': '移动', 'en-US': 'Move' },
    clear: { 'zh-CN': '不使用文件', 'en-US': 'No file' },
    cancel: { 'zh-CN': '取消', 'en-US': 'Cancel' },
    confirm: { 'zh-CN': '选择', 'en-US': 'Select' },
    moveTitle: { 'zh-CN': '移动到目录', 'en-US': 'Move to folder' },
    newFolderLabel: { 'zh-CN': '或填写新目录路径', 'en-US': 'Or enter a new folder path' },
    moveConfirm: { 'zh-CN': '确认移动', 'en-US': 'Move' },
    empty: { 'zh-CN': '暂无文件', 'en-US': 'No files' },
    noSearchResults: { 'zh-CN': '没有匹配的文件', 'en-US': 'No matching files' },
    invalidFolder: { 'zh-CN': '目录路径不合法', 'en-US': 'Invalid folder path' },
    sameFolder: { 'zh-CN': '文件已经在该目录中', 'en-US': 'The file already lives in that folder' },
    moved: { 'zh-CN': '文件已移动', 'en-US': 'File moved' },
    movedWorkflows: { 'zh-CN': '个工作流的引用已同步更新', 'en-US': 'workflow(s) had their references updated' },
    moveFailed: { 'zh-CN': '移动文件失败', 'en-US': 'Failed to move the file' },
    overwriteTitle: { 'zh-CN': '文件已存在', 'en-US': 'File already exists' },
    overwriteConfirm: { 'zh-CN': '覆盖', 'en-US': 'Overwrite' },
    uploadFailed: { 'zh-CN': '上传失败', 'en-US': 'Upload failed' },
    uploaded: { 'zh-CN': '文件已上传', 'en-US': 'File uploaded' },
  } satisfies Record<string, Record<AppLanguage, string>>;

  function tt(key: keyof typeof text): string {
    const language = getLanguage?.() ?? 'zh-CN';
    return text[key][language] ?? text[key]['zh-CN'];
  }

  let pending: ((result: FilePickerResult | null) => void) | null = null;
  let options: FilePickerOpenOptions = {};
  let highlightedFileId: number | null = null;
  let searchQuery = '';
  let searchTimer: number | null = null;
  let moveTargetFolder: string | null = null;
  let bound = false;
  // The picker opens with the full tree collapsed. Only folders explicitly opened by the
  // user are tracked, while an active search expands the tree so matching files remain visible.
  const expandedFolders = new Set<string>();

  function overlay() {
    return el('workflowFilePickerModal');
  }

  function open(nextOptions: FilePickerOpenOptions = {}): Promise<FilePickerResult | null> {
    if (pending) return Promise.resolve(null);
    bind();
    options = nextOptions;
    highlightedFileId = nextOptions.currentFileId ?? null;
    searchQuery = '';
    moveTargetFolder = null;
    expandedFolders.clear();
    el<HTMLInputElement>('workflowFilePickerSearch').value = '';
    applyStaticLabels();
    closeMovePanel();
    render();
    overlay().classList.remove('hidden');
    return new Promise<FilePickerResult | null>((resolve) => {
      pending = resolve;
    });
  }

  function settle(result: FilePickerResult | null) {
    const resolve = pending;
    pending = null;
    overlay().classList.add('hidden');
    closeMovePanel();
    resolve?.(result);
  }

  function bind() {
    if (bound) return;
    bound = true;
    el('btnCloseWorkflowFilePicker').addEventListener('click', () => settle(null));
    el('btnCancelWorkflowFilePicker').addEventListener('click', () => settle(null));
    overlay().addEventListener('click', (event) => {
      if (event.target === overlay()) settle(null);
    });
    el('btnConfirmWorkflowFilePicker').addEventListener('click', () => {
      if (highlightedFileId) settle({ action: 'pick', fileId: highlightedFileId });
    });
    el('btnWorkflowFilePickerClear').addEventListener('click', () => settle({ action: 'clear' }));
    el('btnWorkflowFilePickerUpload').addEventListener('click', () => void uploadFile());
    el('btnWorkflowFilePickerMove').addEventListener('click', () => openMovePanel());
    el('btnWorkflowFilePickerMoveCancel').addEventListener('click', () => closeMovePanel());
    el('btnWorkflowFilePickerMoveConfirm').addEventListener('click', () => void moveHighlightedFile());
    el<HTMLInputElement>('workflowFilePickerSearch').addEventListener('input', (event) => {
      const value = (event.target as HTMLInputElement).value;
      if (searchTimer) window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(() => {
        searchQuery = value.trim().toLowerCase();
        render();
      }, SEARCH_DEBOUNCE_MS);
    });
  }

  function applyStaticLabels() {
    el('workflowFilePickerTitle').textContent = tt(options.titleKey ?? 'title');
    el('workflowFilePickerSubtitle').textContent = tt('subtitle');
    el<HTMLInputElement>('workflowFilePickerSearch').placeholder = tt('searchPlaceholder');
    el('btnWorkflowFilePickerUpload').textContent = tt('upload');
    el('btnWorkflowFilePickerMove').textContent = tt('move');
    el('btnWorkflowFilePickerClear').textContent = tt('clear');
    el('btnWorkflowFilePickerClear').classList.toggle('hidden', !options.allowClear);
    el('btnCancelWorkflowFilePicker').textContent = tt('cancel');
    el('btnConfirmWorkflowFilePicker').textContent = tt('confirm');
    el('workflowFilePickerMoveTitle').textContent = tt('moveTitle');
    el('workflowFilePickerNewFolderLabel').textContent = tt('newFolderLabel');
    el('btnWorkflowFilePickerMoveCancel').textContent = tt('cancel');
    el('btnWorkflowFilePickerMoveConfirm').textContent = tt('moveConfirm');
  }

  function visibleFiles(): ProductFileRecord[] {
    const files = getProductFiles();
    if (!searchQuery) return [...files];
    return files.filter((file) => {
      const haystack = [file.displayName, file.originalName, productFileLogicalTreePath(file)].join(' ').toLowerCase();
      return haystack.includes(searchQuery);
    });
  }

  function fileIcon(file: ProductFileRecord) {
    const extension = (productFileLogicalTreePath(file).split('.').pop() ?? '').toLowerCase();
    if (extension === 'xlsx' || extension === 'xls' || extension === 'xlsm') {
      return { className: 'workbook-file-icon--excel', label: 'XLS' };
    }
    if (extension === 'csv') return { className: 'workbook-file-icon--csv', label: 'CSV' };
    return { className: 'workbook-file-icon--generic', label: 'FILE' };
  }

  function renderDirectory(node: FileTreeNode, depth: number): string {
    const collapsed = !searchQuery && !expandedFolders.has(node.path);
    const children = collapsed
      ? ''
      : [
          ...Array.from(node.children.values())
            .sort(compareTreeNode)
            .map((child) => renderDirectory(child, depth + 1)),
          ...[...node.files].sort(compareProductFile).map((file) => renderFile(file, depth + 1)),
        ].join('');
    return `
      <button
        class="workbook-tree__dir ${collapsed ? 'is-collapsed' : 'is-expanded'}"
        data-picker-dir-path="${escapeHtml(node.path)}"
        type="button"
        aria-expanded="${collapsed ? 'false' : 'true'}"
        title="${escapeHtml(node.path)}"
        style="--tree-depth: ${depth}"
      >
        <span class="workbook-tree__twisty" aria-hidden="true">▸</span>
        <span class="workbook-tree__folder-icon" aria-hidden="true"></span>
        <span class="workbook-tree__dir-main">
          <span class="workbook-tree__dir-name">${escapeHtml(node.name)}</span>
          <span class="workbook-tree__dir-path">${escapeHtml(node.path)}</span>
        </span>
        <span class="workbook-tree__dir-count">${countTreeFiles(node)}</span>
      </button>
      ${children}`;
  }

  function renderFile(file: ProductFileRecord, depth: number): string {
    const logicalPath = productFileLogicalTreePath(file);
    const icon = fileIcon(file);
    return `
      <div
        class="workbook-tree__file workflow-file-picker__file ${file.id === highlightedFileId ? 'is-active' : ''}"
        data-picker-file-id="${file.id}"
        role="button"
        tabindex="0"
        title="${escapeHtml(logicalPath)}"
        style="--tree-depth: ${depth}"
      >
        <span class="workbook-file-icon workbook-tree__file-icon ${icon.className}" aria-hidden="true">${escapeHtml(icon.label)}</span>
        <div class="workbook-tree__file-name">${escapeHtml(file.displayName || file.originalName)}</div>
        <div class="workbook-tree__file-path">${escapeHtml(logicalPath)}</div>
        <div class="workbook-tree__file-meta">${formatFileSize(file.fileSizeBytes)} · ${file.workbookSheetCount} sheets · #${file.id}</div>
      </div>`;
  }

  function render() {
    const files = visibleFiles();
    if (highlightedFileId && !files.some((file) => file.id === highlightedFileId) && !searchQuery) {
      highlightedFileId = null;
    }
    const root = buildProductFilesTree(files, productFileLogicalTreePath);
    const content = [
      ...Array.from(root.children.values())
        .sort(compareTreeNode)
        .map((node) => renderDirectory(node, 0)),
      ...[...root.files].sort(compareProductFile).map((file) => renderFile(file, 0)),
    ].join('');
    const emptyMessage = searchQuery ? tt('noSearchResults') : tt('empty');
    const container = el('workflowFilePickerTree');
    container.innerHTML = content || `<div class="workbook-list__empty">${escapeHtml(emptyMessage)}</div>`;

    container.querySelectorAll<HTMLElement>('[data-picker-dir-path]').forEach((button) => {
      button.addEventListener('click', () => {
        const path = button.dataset.pickerDirPath ?? '';
        if (!path) return;
        if (expandedFolders.has(path)) expandedFolders.delete(path);
        else expandedFolders.add(path);
        render();
      });
    });

    container.querySelectorAll<HTMLElement>('[data-picker-file-id]').forEach((row) => {
      const fileId = Number(row.dataset.pickerFileId);
      row.addEventListener('click', () => {
        highlightedFileId = fileId;
        render();
      });
      row.addEventListener('dblclick', () => settle({ action: 'pick', fileId }));
      row.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        if (event.key === 'Enter' && highlightedFileId === fileId) {
          settle({ action: 'pick', fileId });
          return;
        }
        highlightedFileId = fileId;
        render();
      });
    });

    syncActionState();
    const active = container.querySelector<HTMLElement>('.workflow-file-picker__file.is-active');
    active?.scrollIntoView({ block: 'nearest' });
  }

  function syncActionState() {
    const hasHighlight = Boolean(highlightedFileId && getProductFiles().some((file) => file.id === highlightedFileId));
    el<HTMLButtonElement>('btnConfirmWorkflowFilePicker').disabled = !hasHighlight;
    el<HTMLButtonElement>('btnWorkflowFilePickerMove').disabled = !hasHighlight;
  }

  function highlightedFile(): ProductFileRecord | null {
    if (!highlightedFileId) return null;
    return getProductFiles().find((file) => file.id === highlightedFileId) ?? null;
  }

  function openMovePanel() {
    const file = highlightedFile();
    if (!file) return;
    moveTargetFolder = productFileFolder(file);
    el<HTMLInputElement>('workflowFilePickerNewFolder').value = '';
    setMoveError('');
    renderFolderList();
    el('workflowFilePickerMovePanel').classList.remove('hidden');
  }

  function closeMovePanel() {
    el('workflowFilePickerMovePanel').classList.add('hidden');
    setMoveError('');
  }

  function setMoveError(message: string) {
    const target = el('workflowFilePickerMoveError');
    target.textContent = message;
    target.classList.toggle('hidden', !message);
  }

  function renderFolderList() {
    const folders = collectProductFileFolders(getProductFiles());
    const container = el('workflowFilePickerFolderList');
    container.innerHTML = folders
      .map(
        (folder) => `<button
          class="workflow-file-picker__folder ${folder === moveTargetFolder ? 'is-selected' : ''}"
          data-picker-folder="${escapeHtml(folder)}"
          type="button"
        >${escapeHtml(folder)}</button>`,
      )
      .join('');
    container.querySelectorAll<HTMLElement>('[data-picker-folder]').forEach((button) => {
      button.addEventListener('click', () => {
        moveTargetFolder = button.dataset.pickerFolder ?? '';
        el<HTMLInputElement>('workflowFilePickerNewFolder').value = '';
        setMoveError('');
        renderFolderList();
      });
    });
  }

  async function moveHighlightedFile() {
    const file = highlightedFile();
    if (!file) return;
    const typedFolder = el<HTMLInputElement>('workflowFilePickerNewFolder').value.trim();
    let folder: string;
    try {
      folder = typedFolder ? normalizeClientFolder(typedFolder) : (moveTargetFolder ?? '');
    } catch {
      setMoveError(tt('invalidFolder'));
      return;
    }
    if (folder === productFileFolder(file)) {
      setMoveError(tt('sameFolder'));
      return;
    }

    try {
      const response = await api<MoveResponse>(`/api/files/${file.id}/move`, {
        method: 'POST',
        body: JSON.stringify({ folder }),
      });
      await refreshProductFiles();
      highlightedFileId = response.file.id;
      closeMovePanel();
      render();
      const workflowsNote =
        response.rewrittenWorkflows > 0 ? `，${response.rewrittenWorkflows} ${tt('movedWorkflows')}` : '';
      notify(`${tt('moved')}: ${response.file.displayPath}${workflowsNote}`, { type: 'success' });
    } catch (error) {
      setMoveError(error instanceof Error ? error.message : tt('moveFailed'));
    }
  }

  async function uploadFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xls,.csv';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return;
      void uploadSelectedFile(file);
    });
    input.click();
  }

  async function uploadSelectedFile(file: File) {
    const folderPrefix = options.uploadFolderPrefix ?? 'input';
    const upload = (overwrite: boolean) => {
      const form = new FormData();
      form.append('file', file);
      form.append('uploadedBy', 'Administrator');
      form.append('folderPrefix', folderPrefix);
      if (overwrite) form.append('conflictPolicy', 'overwrite');
      return uploadFormDataWithProgress<{ file: ProductFileRecord }>('/api/files/upload', form, {
        fileName: file.name,
        title: { 'zh-CN': '正在上传文件', 'en-US': 'Uploading file' },
      });
    };

    try {
      let data: { file: ProductFileRecord };
      try {
        data = await upload(false);
      } catch (error) {
        if (!(error instanceof UploadHttpError) || error.status !== 409) throw error;
        const confirmed = await confirmAction(`同一目录中已存在“${file.name}”，是否覆盖？`, {
          title: tt('overwriteTitle'),
          confirmText: tt('overwriteConfirm'),
          tone: 'danger',
        });
        if (!confirmed) return;
        data = await upload(true);
      }
      await refreshProductFiles();
      highlightedFileId = data.file.id;
      render();
      notify(`${tt('uploaded')}: ${data.file.displayPath}`, { type: 'success' });
    } catch (error) {
      notify(error instanceof Error ? error.message : tt('uploadFailed'), { type: 'error' });
    }
  }

  return { open };
}

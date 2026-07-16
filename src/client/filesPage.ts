import type { ProductFileDetail, ProductFileRecord } from '../shared/types.js';
import type { ConfirmActionFn, NotifyFn } from './uiFeedback.js';
import { createWorkbookViewer } from './univer/createWorkbookViewer.js';
import { bufferToUniverWorkbook } from './univer/xlsxToUniver.js';
import type { AppLanguage } from './i18n.js';
import * as XLSX from 'xlsx';

type DomGetter = <T extends HTMLElement>(id: string) => T;

type FilesPageDeps = {
  el: DomGetter;
  api: <T>(url: string, options?: RequestInit) => Promise<T>;
  apiBinary: (url: string, options?: RequestInit) => Promise<ArrayBuffer>;
  escapeHtml: (text: unknown) => string;
  formatDateTime: (value: string) => string;
  formatFileSize: (bytes: number) => string;
  notify: NotifyFn;
  confirmAction: ConfirmActionFn;
  getLanguage?: () => AppLanguage;
};

const FILES_LEFT_MIN = 200;
const FILES_LEFT_MAX = 480;
const FILES_LEFT_DEFAULT = FILES_LEFT_MAX;
const FILES_LEFT_COLLAPSED_WIDTH = 28;
const FILES_MOBILE_MEDIA = '(max-width: 768px)';

type FilesViewMode = 'list' | 'tree';

type FileTreeNode = {
  name: string;
  path: string;
  children: Map<string, FileTreeNode>;
  files: ProductFileRecord[];
};

export function createFilesPage({ el, api, apiBinary, escapeHtml, formatDateTime, formatFileSize, notify, confirmAction, getLanguage }: FilesPageDeps) {
  let productFiles: ProductFileRecord[] = [];
  let currentProductFileDetail: ProductFileDetail | null = null;
  let workbookViewer: { dispose: () => void; exportXlsxBlob: () => Blob | null } | null = null;
  let selectedProductFileId: number | null = null;
  let productFileLoadError: string | null = null;
  let productFileLoading = false;
  let productFileSaving = false;
  let openProductFileRequestId = 0;
  let filesLeftWidth = FILES_LEFT_DEFAULT;
  let filesLeftCollapsed = false;
  let editingProductFileId: number | null = null;
  let editingProductFileName = '';
  let renamingProductFileId: number | null = null;
  let filesViewMode: FilesViewMode = 'tree';
  let filesSearchQuery = '';
  let filesViewControlsBound = false;
  let filesSearchBound = false;
  const collapsedTreeDirectoryPaths = new Set<string>();
  const text = {
    count: { 'zh-CN': '个', 'en-US': 'items' },
    chooseFile: { 'zh-CN': '选择左侧文件后可在页面内查看完整 Excel 工作簿。', 'en-US': 'Select a file on the left to view the full Excel workbook here.' },
    noFiles: { 'zh-CN': '尚未上传任何文件', 'en-US': 'No files uploaded yet' },
    noSearchResults: { 'zh-CN': '没有匹配的文件', 'en-US': 'No matching files' },
    listView: { 'zh-CN': '列表视图', 'en-US': 'List view' },
    treeView: { 'zh-CN': '树状视图', 'en-US': 'Tree view' },
    switchToListView: { 'zh-CN': '切换到列表视图', 'en-US': 'Switch to list view' },
    switchToTreeView: { 'zh-CN': '切换到树状视图', 'en-US': 'Switch to tree view' },
    editFileName: { 'zh-CN': '编辑文件名', 'en-US': 'Edit file name' },
    deleteFile: { 'zh-CN': '删除文件', 'en-US': 'Delete file' },
    fileName: { 'zh-CN': '文件名', 'en-US': 'File name' },
    saving: { 'zh-CN': '保存中...', 'en-US': 'Saving...' },
    save: { 'zh-CN': '保存', 'en-US': 'Save' },
    cancel: { 'zh-CN': '取消', 'en-US': 'Cancel' },
    loading: { 'zh-CN': '加载中...', 'en-US': 'Loading...' },
    loadingFile: { 'zh-CN': '正在加载文件...', 'en-US': 'Loading file...' },
    fileLoadFailed: { 'zh-CN': '文件加载失败', 'en-US': 'Failed to load file' },
    cannotOpenFile: { 'zh-CN': '无法打开该文件：', 'en-US': 'Cannot open this file: ' },
    exportUnavailable: { 'zh-CN': '当前工作簿无法导出', 'en-US': 'The current workbook cannot be exported' },
    saveFailed: { 'zh-CN': '保存失败', 'en-US': 'Save failed' },
    deleteTitle: { 'zh-CN': '删除文件', 'en-US': 'Delete file' },
    deleteConfirm: { 'zh-CN': '确定删除文件', 'en-US': 'Delete file' },
    deleteConfirmSuffix: { 'zh-CN': '吗？', 'en-US': '?' },
    emptyFileName: { 'zh-CN': '文件名不能为空', 'en-US': 'File name cannot be empty' },
    renameFailed: { 'zh-CN': '修改文件名失败', 'en-US': 'Failed to rename file' },
  } satisfies Record<string, Record<AppLanguage, string>>;

  function lang(): AppLanguage {
    return getLanguage?.() ?? 'zh-CN';
  }

  function tt(key: keyof typeof text): string {
    return text[key][lang()] ?? text[key]['zh-CN'];
  }

  bindFilesViewModeControls();

  async function init() {
    el('btnCreateProductFile').addEventListener('click', () => void createProductFile());
    el('btnUploadProductFile').addEventListener('click', () => void uploadProductFile());
    el('btnRefreshFiles').addEventListener('click', () => void loadProductFiles());
    bindFilesViewModeControls();
    bindFilesSearchControl();
    el('btnCollapseFilesPane').addEventListener('click', () => setFilesPaneCollapsed(true));
    el('filesCollapsedRail').addEventListener('click', () => setFilesPaneCollapsed(false));
    initFilesWorkspaceResize();
    applyFilesWorkspaceLayout();
    updateFilesViewModeControls();
    updateFileActionState();
    await loadProductFiles();
  }

  function getProductFiles() {
    return productFiles;
  }

  async function uploadWorkbookBuffer(fileName: string, buffer: BlobPart) {
    const form = new FormData();
    form.append(
      'file',
      new File([buffer], fileName, {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
    );
    form.append('uploadedBy', 'Administrator');
    const data = await api<{ file: ProductFileRecord }>('/api/files/upload', { method: 'POST', body: form });
    await loadProductFiles(data.file.id);
  }

  async function loadProductFiles(selectedId?: number) {
    const data = await api<{ files: ProductFileRecord[] }>('/api/files');
    productFiles = data.files;
    el('filesCountBadge').textContent = `${productFiles.length} ${tt('count')}`;

    if (productFiles.length === 0) {
      selectedProductFileId = null;
      currentProductFileDetail = null;
      productFileLoadError = null;
      productFileLoading = false;
      productFileSaving = false;
      disposeWorkbookViewer();
      renderProductFilesList();
      updateFileActionState();
      el('fileBrowserEmpty').classList.remove('hidden');
      el('productWorkbookViewer').classList.add('hidden');
      el('fileBrowserEmpty').textContent = tt('chooseFile');
      return;
    }

    const targetId = selectedId ?? selectedProductFileId ?? currentProductFileDetail?.file.id ?? productFiles[0]?.id;
    renderProductFilesList();
    updateFileActionState();
    if (targetId) {
      await openProductFile(targetId);
    }
  }

  async function createProductFile() {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([[]]);
    XLSX.utils.book_append_sheet(workbook, sheet, 'Sheet1');
    const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as BlobPart;
    await uploadWorkbookBuffer('New Workbook.xlsx', buffer);
  }

  function renderProductFilesList() {
    const container = el('productFilesList');
    const filteredFiles = getFilteredProductFiles();
    container.classList.toggle('workbook-list__items--tree', filesViewMode === 'tree');
    updateFilesViewModeControls();
    if (productFiles.length === 0) {
      container.innerHTML = `<div class="workbook-list__empty">${escapeHtml(tt('noFiles'))}</div>`;
      return;
    }
    if (filteredFiles.length === 0) {
      container.innerHTML = `<div class="workbook-list__empty">${escapeHtml(tt('noSearchResults'))}</div>`;
      return;
    }

    if (filesViewMode === 'tree') {
      renderProductFilesTree(container, filteredFiles);
      bindProductFilesBrowserInteractions(container);
      return;
    }

    container.innerHTML = filteredFiles
      .map(
        (file) => {
          const displayPath = getProductFileDisplayPath(file);
          const icon = getProductFileIcon(file);
          return `
        <div
          class="workbook-item ${selectedProductFileId === file.id ? 'is-active' : ''} ${productFileLoading && selectedProductFileId === file.id ? 'is-loading' : ''}"
          data-file-id="${file.id}"
          role="button"
          tabindex="0"
          title="${escapeHtml(displayPath)}"
        >
          <button class="workbook-item__edit" data-edit-file-id="${file.id}" type="button" aria-label="${escapeHtml(tt('editFileName'))}" title="${escapeHtml(tt('editFileName'))}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 20h9"></path>
              <path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4Z"></path>
            </svg>
          </button>
          <button class="workbook-item__delete" data-delete-file-id="${file.id}" type="button" aria-label="${escapeHtml(tt('deleteFile'))}" title="${escapeHtml(tt('deleteFile'))}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M3 6h18"></path>
              <path d="M8 6V4h8v2"></path>
              <path d="M19 6l-1 14H6L5 6"></path>
              <path d="M10 11v6"></path>
              <path d="M14 11v6"></path>
            </svg>
          </button>
          <span class="workbook-file-icon workbook-item__file-icon ${icon.className}" aria-hidden="true">${escapeHtml(icon.label)}</span>
          ${
            editingProductFileId === file.id
              ? `<div class="workbook-item__rename">
                  <input
                    class="workbook-item__rename-input"
                    data-rename-input-file-id="${file.id}"
                    type="text"
                    value="${escapeHtml(editingProductFileName)}"
                    maxlength="255"
                    aria-label="${escapeHtml(tt('fileName'))}"
                  />
                  <div class="workbook-item__rename-actions">
                    <button class="workbook-item__rename-btn workbook-item__rename-btn--primary" data-save-file-id="${file.id}" type="button" ${
                      renamingProductFileId === file.id ? 'disabled' : ''
                    }>${escapeHtml(renamingProductFileId === file.id ? tt('saving') : tt('save'))}</button>
                    <button class="workbook-item__rename-btn" data-cancel-file-id="${file.id}" type="button" ${
                      renamingProductFileId === file.id ? 'disabled' : ''
                    }>${escapeHtml(tt('cancel'))}</button>
                  </div>
                </div>`
              : `<div class="workbook-item__name">${escapeHtml(getProductFileDisplayName(file))}</div>`
          }
          <div class="workbook-item__path">${escapeHtml(displayPath)}</div>
          <div class="workbook-item__meta">${formatFileSize(file.fileSizeBytes)} · ${file.workbookSheetCount} sheets · ${escapeHtml(formatDateTime(file.createdAt))}</div>
          ${
            productFileLoadError && selectedProductFileId === file.id
              ? `<div class="workbook-item__status workbook-item__status--error">${escapeHtml(productFileLoadError)}</div>`
              : productFileLoading && selectedProductFileId === file.id
                ? `<div class="workbook-item__status">${escapeHtml(tt('loading'))}</div>`
                : productFileSaving && selectedProductFileId === file.id
                  ? `<div class="workbook-item__status">${escapeHtml(tt('saving'))}</div>`
                : ''
          }
        </div>`;
        },
      )
      .join('');

    bindProductFilesBrowserInteractions(container);
  }

  function bindProductFilesBrowserInteractions(container: HTMLElement) {
    container.querySelectorAll<HTMLElement>('[data-file-id]').forEach((button) => {
      button.addEventListener('click', () => void openProductFile(Number(button.dataset.fileId)));
      button.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          void openProductFile(Number(button.dataset.fileId));
        }
      });
    });

    container.querySelectorAll<HTMLElement>('[data-edit-file-id]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        startRenamingProductFile(Number(button.dataset.editFileId));
      });
    });

    container.querySelectorAll<HTMLInputElement>('[data-rename-input-file-id]').forEach((input) => {
      input.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      input.addEventListener('input', () => {
        editingProductFileName = input.value;
      });
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          event.stopPropagation();
          void commitRenamingProductFile(Number(input.dataset.renameInputFileId));
        } else if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          cancelRenamingProductFile();
        }
      });
    });

    container.querySelectorAll<HTMLElement>('[data-save-file-id]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        void commitRenamingProductFile(Number(button.dataset.saveFileId));
      });
    });

    container.querySelectorAll<HTMLElement>('[data-cancel-file-id]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        cancelRenamingProductFile();
      });
    });

    container.querySelectorAll<HTMLElement>('[data-delete-file-id]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        void deleteProductFile(Number(button.dataset.deleteFileId));
      });
    });

    container.querySelectorAll<HTMLElement>('[data-tree-dir-path]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleTreeDirectory(String(button.dataset.treeDirPath ?? ''));
      });
      button.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          event.stopPropagation();
          toggleTreeDirectory(String(button.dataset.treeDirPath ?? ''));
        }
      });
    });

    if (editingProductFileId !== null) {
      const input = container.querySelector<HTMLInputElement>(`[data-rename-input-file-id="${editingProductFileId}"]`);
      if (input && document.activeElement !== input) {
        input.focus();
        input.select();
      }
    }
  }

  function setFilesViewMode(mode: FilesViewMode) {
    if (filesViewMode === mode) return;
    filesViewMode = mode;
    editingProductFileId = null;
    editingProductFileName = '';
    renamingProductFileId = null;
    renderProductFilesList();
  }

  function updateFilesViewModeControls() {
    const toggle = el<HTMLButtonElement>('btnFilesViewToggle');
    const showList = filesViewMode === 'tree';
    toggle.setAttribute('aria-label', showList ? tt('switchToListView') : tt('switchToTreeView'));
    toggle.setAttribute('title', showList ? tt('switchToListView') : tt('switchToTreeView'));
    toggle.innerHTML = showList
      ? `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M4 5h16"></path>
          <path d="M4 12h16"></path>
          <path d="M4 19h16"></path>
          <path d="M4 5h.01"></path>
          <path d="M4 12h.01"></path>
          <path d="M4 19h.01"></path>
        </svg>
      `
      : `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M4 7h6l2 2h8v9H4z"></path>
          <path d="M10 9v9"></path>
          <path d="M10 14h4"></path>
        </svg>
      `;
  }

  function bindFilesViewModeControls() {
    if (filesViewControlsBound) return;
    el('btnFilesViewToggle').addEventListener('click', () => {
      setFilesViewMode(filesViewMode === 'tree' ? 'list' : 'tree');
    });
    filesViewControlsBound = true;
  }

  function bindFilesSearchControl() {
    if (filesSearchBound) return;
    const input = el<HTMLInputElement>('filesBrowserSearch');
    input.addEventListener('input', () => {
      filesSearchQuery = input.value.trim().toLowerCase();
      renderProductFilesList();
    });
    filesSearchBound = true;
  }

  function toggleTreeDirectory(path: string) {
    if (!path) return;
    if (collapsedTreeDirectoryPaths.has(path)) {
      collapsedTreeDirectoryPaths.delete(path);
    } else {
      collapsedTreeDirectoryPaths.add(path);
    }
    renderProductFilesList();
  }

  function getProductFileDisplayPath(file: ProductFileRecord) {
    return (file.displayPath || file.storedName || file.originalName).replace(/\\/g, '/');
  }

  function getProductFileDisplayName(file: ProductFileRecord) {
    return file.displayName || file.originalName;
  }

  function getFilteredProductFiles() {
    if (!filesSearchQuery) return [...productFiles];
    return productFiles.filter((file) => {
      const searchableText = [
        getProductFileDisplayName(file),
        getProductFileDisplayPath(file),
        file.originalName,
        file.storedName,
        file.displayName,
      ]
        .join(' ')
        .toLowerCase();
      return searchableText.includes(filesSearchQuery);
    });
  }

  function getProductFileExtension(file: ProductFileRecord) {
    const path = getProductFileDisplayPath(file);
    const name = path.split('/').pop() || getProductFileDisplayName(file);
    const match = name.match(/\.([^.]+)$/);
    return (match?.[1] ?? '').toLowerCase();
  }

  function getProductFileIcon(file: ProductFileRecord) {
    const extension = getProductFileExtension(file);
    if (extension === 'xlsx' || extension === 'xls' || extension === 'xlsm') {
      return { className: 'workbook-file-icon--excel', label: 'XLS' };
    }
    if (extension === 'csv') {
      return { className: 'workbook-file-icon--csv', label: 'CSV' };
    }
    return { className: 'workbook-file-icon--generic', label: 'FILE' };
  }

  function createFileTreeNode(name: string, path: string): FileTreeNode {
    return {
      name,
      path,
      children: new Map(),
      files: [],
    };
  }

  function buildProductFilesTree(files: ProductFileRecord[]) {
    const root = createFileTreeNode('', '');

    files.forEach((file) => {
      const displayPath = getProductFileDisplayPath(file);
      const segments = displayPath.split('/').map((segment) => segment.trim()).filter(Boolean);
      const directorySegments = segments.length > 1 ? segments.slice(0, -1) : [];
      let current = root;

      directorySegments.forEach((segment) => {
        const childPath = current.path ? `${current.path}/${segment}` : segment;
        let child = current.children.get(segment);
        if (!child) {
          child = createFileTreeNode(segment, childPath);
          current.children.set(segment, child);
        }
        current = child;
      });

      current.files.push(file);
    });

    return root;
  }

  function renderProductFilesTree(container: HTMLElement, files: ProductFileRecord[]) {
    const root = buildProductFilesTree(files);
    const content = [
      ...Array.from(root.children.values())
        .sort(compareTreeNode)
        .map((node) => renderTreeDirectory(node, 0)),
      ...root.files.sort(compareProductFile).map((file) => renderTreeFile(file, 0)),
    ].join('');

    container.innerHTML = content || `<div class="workbook-list__empty">${escapeHtml(tt('noFiles'))}</div>`;
  }

  function renderTreeDirectory(node: FileTreeNode, depth: number): string {
    const collapsed = collapsedTreeDirectoryPaths.has(node.path);
    const childCount = countTreeFiles(node);
    const childDirectories = collapsed
      ? ''
      : Array.from(node.children.values()).sort(compareTreeNode).map((child) => renderTreeDirectory(child, depth + 1)).join('');
    const childFiles = collapsed ? '' : node.files.sort(compareProductFile).map((file) => renderTreeFile(file, depth + 1)).join('');
    return `
      <button
        class="workbook-tree__dir ${collapsed ? 'is-collapsed' : 'is-expanded'}"
        data-tree-dir-path="${escapeHtml(node.path)}"
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
        <span class="workbook-tree__dir-count">${childCount}</span>
      </button>
      ${childDirectories}
      ${childFiles}
    `;
  }

  function countTreeFiles(node: FileTreeNode): number {
    return node.files.length + Array.from(node.children.values()).reduce((total, child) => total + countTreeFiles(child), 0);
  }

  function renderTreeFile(file: ProductFileRecord, depth: number): string {
    const displayPath = getProductFileDisplayPath(file);
    const icon = getProductFileIcon(file);
    return `
      <div
        class="workbook-tree__file ${selectedProductFileId === file.id ? 'is-active' : ''} ${productFileLoading && selectedProductFileId === file.id ? 'is-loading' : ''}"
        data-file-id="${file.id}"
        role="button"
        tabindex="0"
        title="${escapeHtml(displayPath)}"
        style="--tree-depth: ${depth}"
      >
        <span class="workbook-file-icon workbook-tree__file-icon ${icon.className}" aria-hidden="true">${escapeHtml(icon.label)}</span>
        <button class="workbook-tree__delete" data-delete-file-id="${file.id}" type="button" aria-label="${escapeHtml(tt('deleteFile'))}" title="${escapeHtml(tt('deleteFile'))}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M3 6h18"></path>
            <path d="M8 6V4h8v2"></path>
            <path d="M19 6l-1 14H6L5 6"></path>
            <path d="M10 11v6"></path>
            <path d="M14 11v6"></path>
          </svg>
        </button>
        <div class="workbook-tree__file-name">${escapeHtml(getProductFileDisplayName(file))}</div>
        <div class="workbook-tree__file-path">${escapeHtml(displayPath)}</div>
        <div class="workbook-tree__file-meta">${formatFileSize(file.fileSizeBytes)} · ${file.workbookSheetCount} sheets</div>
        ${
          productFileLoadError && selectedProductFileId === file.id
            ? `<div class="workbook-item__status workbook-item__status--error">${escapeHtml(productFileLoadError)}</div>`
            : productFileLoading && selectedProductFileId === file.id
              ? `<div class="workbook-item__status">${escapeHtml(tt('loading'))}</div>`
              : productFileSaving && selectedProductFileId === file.id
                ? `<div class="workbook-item__status">${escapeHtml(tt('saving'))}</div>`
                : ''
        }
      </div>
    `;
  }

  function compareTreeNode(a: FileTreeNode, b: FileTreeNode) {
    return a.name.localeCompare(b.name, 'zh-Hans-CN');
  }

  function compareProductFile(a: ProductFileRecord, b: ProductFileRecord) {
    return getProductFileDisplayPath(a).localeCompare(getProductFileDisplayPath(b), 'zh-Hans-CN');
  }

  async function uploadProductFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xls,.csv';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      await uploadWorkbookBuffer(file.name, await file.arrayBuffer());
    });
    input.click();
  }

  async function openProductFile(fileId: number) {
    const requestId = ++openProductFileRequestId;
    selectedProductFileId = fileId;
    productFileLoading = true;
    productFileLoadError = null;
    renderProductFilesList();
    updateFileActionState();
    renderFileBrowserMessage(tt('loadingFile'));

    try {
      const detail = await api<ProductFileDetail>(`/api/files/${fileId}`);
      const workbookBuffer = await apiBinary(`/api/files/${fileId}/content`);
      if (requestId !== openProductFileRequestId) return;

      currentProductFileDetail = detail;
      productFileLoading = false;
      productFileLoadError = null;
      renderProductFilesList();
      updateFileActionState();
      renderProductFileDetail();
      renderWorkbookViewer(workbookBuffer, detail);
    } catch (error) {
      if (requestId !== openProductFileRequestId) return;

      currentProductFileDetail = null;
      productFileLoading = false;
      productFileLoadError = error instanceof Error ? error.message : tt('fileLoadFailed');
      disposeWorkbookViewer();
      renderProductFilesList();
      updateFileActionState();
      renderFileBrowserMessage(`${tt('cannotOpenFile')}${productFileLoadError}`);
    }
  }

  function renderProductFileDetail() {
    if (!currentProductFileDetail) {
      renderFileBrowserMessage(tt('chooseFile'));
      return;
    }
    el('fileBrowserEmpty').classList.add('hidden');
    el('productWorkbookViewer').classList.remove('hidden');
  }

  function renderWorkbookViewer(workbookBuffer: ArrayBuffer, detail: ProductFileDetail) {
    disposeWorkbookViewer();

    const workbookData = bufferToUniverWorkbook(workbookBuffer, detail.file.originalName);
    const host = el('productWorkbookViewer');
    host.classList.remove('hidden');
    host.innerHTML = '';
    const mount = document.createElement('div');
    mount.className = 'univer-mount';
    host.appendChild(mount);

    workbookViewer = createWorkbookViewer({
      container: mount,
      workbookData,
    });
    updateFileActionState();
  }

  async function saveCurrentProductFile() {
    if (!currentProductFileDetail || !workbookViewer || productFileSaving) return;

    const blob = workbookViewer.exportXlsxBlob();
    if (!blob) {
      notify(tt('exportUnavailable'), { type: 'warning' });
      return;
    }

    const form = new FormData();
    form.append(
      'file',
      new File([blob], currentProductFileDetail.file.originalName, {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
    );
    form.append('uploadedBy', 'Administrator');

    productFileSaving = true;
    productFileLoadError = null;
    renderProductFilesList();
    updateFileActionState();

    try {
      await api(`/api/files/${currentProductFileDetail.file.id}/content`, {
        method: 'PUT',
        body: form,
      });
      productFileSaving = false;
      renderProductFilesList();
      updateFileActionState();
      await openProductFile(currentProductFileDetail.file.id);
    } catch (error) {
      productFileSaving = false;
      productFileLoadError = error instanceof Error ? error.message : tt('saveFailed');
      renderProductFilesList();
      updateFileActionState();
      notify(productFileLoadError, { type: 'error' });
    }
  }

  async function deleteProductFile(fileId: number) {
    const file = productFiles.find((item) => item.id === fileId);
    if (!file) return;
    if (!(await confirmAction(`${tt('deleteConfirm')} ${getProductFileDisplayName(file)} ${tt('deleteConfirmSuffix')}`, { title: tt('deleteTitle'), confirmText: tt('deleteFile'), tone: 'danger' }))) return;

    await api(`/api/files/${fileId}`, { method: 'DELETE' });

    if (currentProductFileDetail?.file.id === fileId) {
      currentProductFileDetail = null;
      disposeWorkbookViewer();
    }
    if (selectedProductFileId === fileId) {
      selectedProductFileId = null;
      productFileLoadError = null;
      productFileLoading = false;
      productFileSaving = false;
    }

    const nextFile = productFiles.find((item) => item.id !== fileId);
    await loadProductFiles(nextFile?.id);
  }

  function startRenamingProductFile(fileId: number) {
    const file = productFiles.find((item) => item.id === fileId);
    if (!file) return;
    editingProductFileId = fileId;
    editingProductFileName = file.originalName;
    renderProductFilesList();
  }

  function cancelRenamingProductFile() {
    editingProductFileId = null;
    editingProductFileName = '';
    renamingProductFileId = null;
    renderProductFilesList();
  }

  async function commitRenamingProductFile(fileId: number) {
    const file = productFiles.find((item) => item.id === fileId);
    if (!file || renamingProductFileId === fileId) return;
    const nextName = editingProductFileName.trim();
    if (!nextName) {
      notify(tt('emptyFileName'), { type: 'warning' });
      return;
    }
    if (nextName === file.originalName) {
      cancelRenamingProductFile();
      return;
    }

    renamingProductFileId = fileId;
    renderProductFilesList();

    try {
      const updated = await api<{ file: ProductFileRecord }>(`/api/files/${fileId}`, {
        method: 'PATCH',
        body: JSON.stringify({ originalName: nextName }),
      });
      productFiles = productFiles.map((item) => (item.id === fileId ? updated.file : item));
      if (currentProductFileDetail?.file.id === fileId) {
        currentProductFileDetail = {
          ...currentProductFileDetail,
          file: updated.file,
        };
      }
      editingProductFileId = null;
      editingProductFileName = '';
      renamingProductFileId = null;
      renderProductFilesList();
      updateFileActionState();
    } catch (error) {
      renamingProductFileId = null;
      renderProductFilesList();
      notify(error instanceof Error ? error.message : tt('renameFailed'), { type: 'error' });
    }
  }

  function renderFileBrowserMessage(message: string) {
    const empty = el('fileBrowserEmpty');
    const viewer = el('productWorkbookViewer');
    empty.textContent = message;
    empty.classList.remove('hidden');
    viewer.classList.add('hidden');
  }

  function disposeWorkbookViewer() {
    workbookViewer?.dispose();
    workbookViewer = null;
    updateFileActionState();
    const host = document.getElementById('productWorkbookViewer');
    if (host) host.innerHTML = '';
  }

  function updateFileActionState() {
    const saveButton = document.getElementById('btnSaveProductFile') as HTMLButtonElement | null;
    if (!saveButton) return;
    const disabled = !currentProductFileDetail || !workbookViewer || productFileLoading || productFileSaving;
    saveButton.disabled = disabled;
    saveButton.textContent = productFileSaving ? tt('saving') : tt('save');
  }

  function applyFilesWorkspaceLayout() {
    const workspace = el('filesWorkspace');
    const leftPane = el('filesLeftPane');
    const rail = el('filesCollapsedRail');
    const divider = el('filesWorkspaceDivider');
    if (window.matchMedia(FILES_MOBILE_MEDIA).matches) {
      workspace.style.gridTemplateColumns = '';
      leftPane.classList.remove('hidden');
      rail.classList.add('hidden');
      divider.classList.add('divider--disabled');
      return;
    }
    workspace.style.gridTemplateColumns = filesLeftCollapsed
      ? `${FILES_LEFT_COLLAPSED_WIDTH}px 6px minmax(0, 1fr)`
      : `${filesLeftWidth}px 6px minmax(0, 1fr)`;
    leftPane.classList.toggle('hidden', filesLeftCollapsed);
    rail.classList.toggle('hidden', !filesLeftCollapsed);
    divider.classList.toggle('divider--disabled', filesLeftCollapsed);
  }

  function setFilesPaneCollapsed(collapsed: boolean) {
    filesLeftCollapsed = collapsed;
    applyFilesWorkspaceLayout();
  }

  function initFilesWorkspaceResize() {
    const divider = el('filesWorkspaceDivider');
    window.matchMedia(FILES_MOBILE_MEDIA).addEventListener('change', applyFilesWorkspaceLayout);
    divider.addEventListener('pointerdown', (event: PointerEvent) => {
      if (window.matchMedia(FILES_MOBILE_MEDIA).matches) return;
      if (filesLeftCollapsed) return;
      event.preventDefault();
      const target = event.currentTarget as HTMLElement;
      target.setPointerCapture(event.pointerId);
      let lastX = event.clientX;

      const handleMove = (moveEvent: PointerEvent) => {
        const delta = moveEvent.clientX - lastX;
        lastX = moveEvent.clientX;
        filesLeftWidth = Math.max(FILES_LEFT_MIN, Math.min(FILES_LEFT_MAX, filesLeftWidth + delta));
        applyFilesWorkspaceLayout();
      };

      const handleUp = (upEvent: PointerEvent) => {
        target.releasePointerCapture(upEvent.pointerId);
        target.removeEventListener('pointermove', handleMove);
        target.removeEventListener('pointerup', handleUp);
        target.removeEventListener('pointercancel', handleUp);
      };

      target.addEventListener('pointermove', handleMove);
      target.addEventListener('pointerup', handleUp);
      target.addEventListener('pointercancel', handleUp);
    });
  }

  return {
    init,
    getProductFiles,
    refreshProductFiles: loadProductFiles,
    applyLanguage() {
      el('filesCountBadge').textContent = `${productFiles.length} ${tt('count')}`;
      renderProductFilesList();
      updateFileActionState();
      if (!currentProductFileDetail && !productFileLoading && !productFileLoadError) {
        renderFileBrowserMessage(tt('chooseFile'));
      }
    },
  };
}

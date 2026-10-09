import type { ProductFileDetail, ProductFileRecord } from '../shared/types.js';
import type { ConfirmActionFn, NotifyFn } from './uiFeedback.js';
import type { AppLanguage } from './i18n.js';
import { UploadHttpError, uploadFormDataWithProgress } from './uploadProgress.js';
import { createFileMoveDialog } from './fileMoveDialog.js';
import {
  buildProductFilesTree,
  compareProductFile,
  compareTreeNode,
  countTreeFiles,
  productFileTreePath,
  type FileTreeNode,
} from './fileTree.js';

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

type WorkbookViewer = {
  dispose: () => void;
  exportXlsxBlob: () => Blob | null;
};

export function createFilesPage({
  el,
  api,
  apiBinary,
  escapeHtml,
  formatDateTime,
  formatFileSize,
  notify,
  confirmAction,
  getLanguage,
}: FilesPageDeps) {
  const fileMoveDialog = createFileMoveDialog({
    el,
    api,
    escapeHtml,
    getProductFiles: () => productFiles,
    notify,
    getLanguage,
  });
  let productFiles: ProductFileRecord[] = [];
  let currentProductFileDetail: ProductFileDetail | null = null;
  let currentWorkbookBuffer: ArrayBuffer | null = null;
  let workbookViewer: WorkbookViewer | null = null;
  let selectedProductFileId: number | null = null;
  let productFileLoadError: string | null = null;
  let productFileLoading = false;
  let productFileSaving = false;
  let productFileEditing = false;
  let openProductFileRequestId = 0;
  let filesLeftWidth = FILES_LEFT_DEFAULT;
  let filesLeftCollapsed = false;
  let editingProductFileId: number | null = null;
  let editingProductFileName = '';
  let renamingProductFileId: number | null = null;
  let filesViewMode: FilesViewMode = 'tree';
  let filesSearchQuery = '';
  let selectedProductFileIds = new Set<number>();
  let filesViewControlsBound = false;
  let filesSearchBound = false;
  const collapsedTreeDirectoryPaths = new Set<string>();
  const text = {
    count: { 'zh-CN': '个', 'en-US': 'items' },
    chooseFile: {
      'zh-CN': '选择左侧文件后可在页面内查看完整 Excel 工作簿。',
      'en-US': 'Select a file on the left to view the full Excel workbook here.',
    },
    noFiles: { 'zh-CN': '尚未上传任何文件', 'en-US': 'No files uploaded yet' },
    noSearchResults: { 'zh-CN': '没有匹配的文件', 'en-US': 'No matching files' },
    listView: { 'zh-CN': '列表视图', 'en-US': 'List view' },
    treeView: { 'zh-CN': '树状视图', 'en-US': 'Tree view' },
    switchToListView: { 'zh-CN': '切换到列表视图', 'en-US': 'Switch to list view' },
    switchToTreeView: { 'zh-CN': '切换到树状视图', 'en-US': 'Switch to tree view' },
    editFileName: { 'zh-CN': '编辑文件名', 'en-US': 'Edit file name' },
    downloadFile: { 'zh-CN': '下载文件', 'en-US': 'Download file' },
    deleteFile: { 'zh-CN': '删除文件', 'en-US': 'Delete file' },
    deleteSelectedFiles: { 'zh-CN': '批量删除', 'en-US': 'Delete selected' },
    moveFile: { 'zh-CN': '移动到其他目录', 'en-US': 'Move to another folder' },
    moveSelectedFiles: { 'zh-CN': '批量移动', 'en-US': 'Move selected' },
    selectedFiles: { 'zh-CN': '已选择', 'en-US': 'selected' },
    selectAllFiles: { 'zh-CN': '全选文件', 'en-US': 'Select all files' },
    deleteSelectedConfirm: {
      'zh-CN': '确定删除选中的文件吗？此操作不可撤销。',
      'en-US': 'Delete the selected files? This action cannot be undone.',
    },
    fileName: { 'zh-CN': '文件名', 'en-US': 'File name' },
    saving: { 'zh-CN': '保存中...', 'en-US': 'Saving...' },
    save: { 'zh-CN': '保存', 'en-US': 'Save' },
    edit: { 'zh-CN': '编辑', 'en-US': 'Edit' },
    cancel: { 'zh-CN': '取消', 'en-US': 'Cancel' },
    readOnlyMode: { 'zh-CN': '只读预览', 'en-US': 'Read-only preview' },
    editingMode: { 'zh-CN': '编辑中', 'en-US': 'Editing' },
    readOnlyHint: {
      'zh-CN': '预览状态不可编辑，点击「编辑」后可修改',
      'en-US': 'Preview is read-only; click Edit to make changes',
    },
    discardEditTitle: { 'zh-CN': '放弃编辑', 'en-US': 'Discard changes' },
    discardEditConfirm: { 'zh-CN': '确定放弃未保存的修改吗？', 'en-US': 'Discard unsaved changes?' },
    discardEdit: { 'zh-CN': '放弃修改', 'en-US': 'Discard' },
    saved: { 'zh-CN': '文件已保存', 'en-US': 'File saved' },
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
    updatedAt: { 'zh-CN': '更新时间', 'en-US': 'Updated' },
    createdAt: { 'zh-CN': '创建时间', 'en-US': 'Created' },
  } satisfies Record<string, Record<AppLanguage, string>>;

  function lang(): AppLanguage {
    return getLanguage?.() ?? 'zh-CN';
  }

  function tt(key: keyof typeof text): string {
    return text[key][lang()] ?? text[key]['zh-CN'];
  }

  function isFilesPageActive(): boolean {
    return el('page-files').classList.contains('active');
  }

  bindFilesViewModeControls();

  async function init() {
    el('btnCreateProductFile').addEventListener('click', () => void createProductFile());
    el('btnUploadProductFile').addEventListener('click', () => void uploadProductFile());
    el('btnRefreshFiles').addEventListener('click', () => void loadProductFiles());
    el('btnEditProductFile').addEventListener('click', () => enterProductFileEditing());
    el('btnSaveProductFile').addEventListener('click', () => void saveCurrentProductFile());
    el('btnCancelProductFileEdit').addEventListener('click', () => void cancelProductFileEditing());
    bindFilesViewModeControls();
    bindFilesSearchControl();
    el('btnCollapseFilesPane').addEventListener('click', () => setFilesPaneCollapsed(true));
    el('filesCollapsedRail').addEventListener('click', () => setFilesPaneCollapsed(false));
    initFilesWorkspaceResize();
    applyFilesWorkspaceLayout();
    updateFilesViewModeControls();
    bindBulkDeleteControls();
    await loadProductFiles();
  }

  function getProductFiles() {
    return productFiles;
  }

  async function uploadWorkbookFile(file: File) {
    const upload = (overwrite = false) => {
      const form = new FormData();
      form.append('file', file);
      form.append('uploadedBy', 'Administrator');
      if (overwrite) form.append('conflictPolicy', 'overwrite');
      return uploadFormDataWithProgress<{ file: ProductFileRecord }>('/api/files/upload', form, {
        fileName: file.name,
        title: { 'zh-CN': '正在上传文件', 'en-US': 'Uploading file' },
      });
    };
    let data;
    try {
      data = await upload();
    } catch (error) {
      if (!(error instanceof UploadHttpError) || error.status !== 409) throw error;
      const confirmed = await confirmAction(`同一文件夹中已存在“${file.name}”，是否覆盖？`, {
        title: '文件已存在',
        confirmText: '覆盖',
        tone: 'danger',
      });
      if (!confirmed) return;
      data = await upload(true);
    }
    await loadProductFiles(data.file.id);
  }

  async function uploadWorkbookBuffer(fileName: string, buffer: BlobPart) {
    await uploadWorkbookFile(
      new File([buffer], fileName, {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
    );
  }

  async function loadProductFiles(selectedId?: number) {
    const data = await api<{ files: ProductFileRecord[] }>('/api/files');
    productFiles = data.files;
    selectedProductFileIds = new Set(
      [...selectedProductFileIds].filter((id) => productFiles.some((file) => file.id === id)),
    );
    el('filesCountBadge').textContent = `${productFiles.length} ${tt('count')}`;

    if (productFiles.length === 0) {
      selectedProductFileIds.clear();
      currentProductFileDetail = null;
      currentWorkbookBuffer = null;
      productFileLoadError = null;
      productFileLoading = false;
      productFileSaving = false;
      productFileEditing = false;
      disposeWorkbookViewer();
      renderProductFilesList();
      updateFileActionState();
      el('fileBrowserEmpty').classList.remove('hidden');
      el('productWorkbookViewer').classList.add('hidden');
      el('fileBrowserEmpty').textContent = tt('chooseFile');
      return;
    }

    const targetId = selectedId ?? selectedProductFileId ?? currentProductFileDetail?.file.id ?? productFiles[0]?.id;
    if (!isFilesPageActive()) {
      if (targetId) selectedProductFileId = targetId;
      renderProductFilesList();
      updateFileActionState();
      return;
    }
    renderProductFilesList();
    updateFileActionState();
    if (targetId) {
      await openProductFile(targetId);
    }
  }

  async function createProductFile() {
    const XLSX = await import('xlsx');
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
    const selectAll = el<HTMLInputElement>('filesSelectAll');
    selectAll.checked = filteredFiles.length > 0 && filteredFiles.every((file) => selectedProductFileIds.has(file.id));
    selectAll.indeterminate = filteredFiles.some((file) => selectedProductFileIds.has(file.id)) && !selectAll.checked;
    selectAll.disabled = filteredFiles.length === 0;
    updateBulkDeleteControls();

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
      .map((file) => {
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
          <input class="workbook-item__select" data-select-file-id="${file.id}" type="checkbox" aria-label="${escapeHtml(getProductFileDisplayName(file))}" ${selectedProductFileIds.has(file.id) ? 'checked' : ''} />
          <button class="workbook-item__edit" data-edit-file-id="${file.id}" type="button" aria-label="${escapeHtml(tt('editFileName'))}" title="${escapeHtml(tt('editFileName'))}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 20h9"></path>
              <path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4Z"></path>
            </svg>
          </button>
          <button class="workbook-item__move" data-move-file-id="${file.id}" type="button" aria-label="${escapeHtml(tt('moveFile'))}" title="${escapeHtml(tt('moveFile'))}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M3 7h5l2 2h11v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z"></path>
              <path d="M12 12v6"></path>
              <path d="m9.5 14.5 2.5-2.5 2.5 2.5"></path>
            </svg>
          </button>
          <button class="workbook-item__download" data-download-file-id="${file.id}" type="button" aria-label="${escapeHtml(tt('downloadFile'))}" title="${escapeHtml(tt('downloadFile'))}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 3v12"></path>
              <path d="m7 10 5 5 5-5"></path>
              <path d="M5 21h14"></path>
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
          <div class="workbook-item__meta">${formatFileSize(file.fileSizeBytes)} · ${file.workbookSheetCount} sheets · ${tt('updatedAt')} ${escapeHtml(formatDateTime(file.createdAt))}</div>
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
      })
      .join('');

    bindProductFilesBrowserInteractions(container);
  }

  function bindProductFilesBrowserInteractions(container: HTMLElement) {
    container.querySelectorAll<HTMLElement>('[data-file-id]').forEach((button) => {
      button.addEventListener('click', (event) => {
        if ((event.target as HTMLElement).closest('[data-select-file-id]')) return;
        void openProductFile(Number(button.dataset.fileId));
      });
      button.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          void openProductFile(Number(button.dataset.fileId));
        }
      });
    });

    container.querySelectorAll<HTMLInputElement>('[data-select-file-id]').forEach((checkbox) => {
      checkbox.addEventListener('click', (event) => event.stopPropagation());
      checkbox.addEventListener('change', () => {
        const fileId = Number(checkbox.dataset.selectFileId);
        if (checkbox.checked) selectedProductFileIds.add(fileId);
        else selectedProductFileIds.delete(fileId);
        updateBulkDeleteControls();
        renderProductFilesList();
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

    container.querySelectorAll<HTMLElement>('[data-move-file-id]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        void moveProductFiles([Number(button.dataset.moveFileId)]);
      });
    });

    container.querySelectorAll<HTMLElement>('[data-download-file-id]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        downloadProductFile(Number(button.dataset.downloadFileId));
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

  function updateBulkDeleteControls() {
    const button = el<HTMLButtonElement>('btnDeleteSelectedFiles');
    const count = selectedProductFileIds.size;
    button.disabled = count === 0;
    button.textContent = count > 0 ? `${tt('deleteSelectedFiles')} (${count})` : tt('deleteSelectedFiles');
    const moveButton = el<HTMLButtonElement>('btnMoveSelectedFiles');
    moveButton.disabled = count === 0;
    moveButton.textContent = count > 0 ? `${tt('moveSelectedFiles')} (${count})` : tt('moveSelectedFiles');
    const selectAll = el<HTMLInputElement>('filesSelectAll');
    if (selectAll) selectAll.setAttribute('aria-label', tt('selectAllFiles'));
  }

  function bindBulkDeleteControls() {
    const selectAll = el<HTMLInputElement>('filesSelectAll');
    selectAll.addEventListener('change', () => {
      const visibleFiles = getFilteredProductFiles();
      visibleFiles.forEach((file) =>
        selectAll.checked ? selectedProductFileIds.add(file.id) : selectedProductFileIds.delete(file.id),
      );
      renderProductFilesList();
    });
    el('btnDeleteSelectedFiles').addEventListener('click', () => void deleteSelectedProductFiles());
    el('btnMoveSelectedFiles').addEventListener('click', () => void moveProductFiles([...selectedProductFileIds]));
  }

  async function moveProductFiles(fileIds: number[]) {
    const ids = fileIds.filter((id) => productFiles.some((file) => file.id === id));
    if (!ids.length) return;
    const outcome = await fileMoveDialog.open(ids);
    if (!outcome?.moved) return;
    await loadProductFiles(selectedProductFileId ?? undefined);
  }

  async function deleteSelectedProductFiles() {
    const ids = [...selectedProductFileIds].filter((id) => productFiles.some((file) => file.id === id));
    if (!ids.length) return;
    if (
      !(await confirmAction(tt('deleteSelectedConfirm'), {
        title: tt('deleteTitle'),
        confirmText: tt('deleteSelectedFiles'),
        tone: 'danger',
      }))
    )
      return;
    await api('/api/files', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    if (currentProductFileDetail && ids.includes(currentProductFileDetail.file.id)) {
      currentProductFileDetail = null;
      currentWorkbookBuffer = null;
      productFileEditing = false;
      selectedProductFileId = null;
      disposeWorkbookViewer();
    }
    selectedProductFileIds.clear();
    await loadProductFiles();
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
    return productFileTreePath(file);
  }

  function getProductFileDisplayName(file: ProductFileRecord) {
    return file.displayName || file.originalName;
  }

  function downloadProductFile(fileId: number) {
    const file = productFiles.find((item) => item.id === fileId);
    if (!file) return;
    const link = document.createElement('a');
    link.href = `/api/files/${fileId}/content`;
    link.download = getProductFileDisplayName(file);
    link.rel = 'noopener';
    document.body.append(link);
    link.click();
    link.remove();
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
      : Array.from(node.children.values())
          .sort(compareTreeNode)
          .map((child) => renderTreeDirectory(child, depth + 1))
          .join('');
    const childFiles = collapsed
      ? ''
      : node.files
          .sort(compareProductFile)
          .map((file) => renderTreeFile(file, depth + 1))
          .join('');
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
        <input class="workbook-tree__select" data-select-file-id="${file.id}" type="checkbox" aria-label="${escapeHtml(getProductFileDisplayName(file))}" ${selectedProductFileIds.has(file.id) ? 'checked' : ''} />
        <span class="workbook-file-icon workbook-tree__file-icon ${icon.className}" aria-hidden="true">${escapeHtml(icon.label)}</span>
        <button class="workbook-tree__move" data-move-file-id="${file.id}" type="button" aria-label="${escapeHtml(tt('moveFile'))}" title="${escapeHtml(tt('moveFile'))}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M3 7h5l2 2h11v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z"></path>
              <path d="M12 12v6"></path>
              <path d="m9.5 14.5 2.5-2.5 2.5 2.5"></path>
            </svg>
        </button>
        <button class="workbook-tree__download" data-download-file-id="${file.id}" type="button" aria-label="${escapeHtml(tt('downloadFile'))}" title="${escapeHtml(tt('downloadFile'))}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 3v12"></path>
            <path d="m7 10 5 5 5-5"></path>
            <path d="M5 21h14"></path>
          </svg>
        </button>
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
        <div class="workbook-tree__file-meta">${formatFileSize(file.fileSizeBytes)} · ${file.workbookSheetCount} sheets · ${tt('updatedAt')} ${escapeHtml(formatDateTime(file.createdAt))}</div>
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

  async function uploadProductFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xls,.csv';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      await uploadWorkbookFile(file);
    });
    input.click();
  }

  async function openProductFile(fileId: number) {
    if (productFileEditing && !(await confirmDiscardEditing())) return;
    const requestId = ++openProductFileRequestId;
    selectedProductFileId = fileId;
    productFileLoading = true;
    productFileLoadError = null;
    productFileEditing = false;
    renderProductFilesList();
    updateFileActionState();
    renderFileBrowserMessage(tt('loadingFile'));

    try {
      const detail = await api<ProductFileDetail>(`/api/files/${fileId}`);
      const workbookBuffer = await apiBinary(`/api/files/${fileId}/content`);
      if (requestId !== openProductFileRequestId) return;

      currentProductFileDetail = detail;
      currentWorkbookBuffer = workbookBuffer;
      productFileLoading = false;
      productFileLoadError = null;
      renderProductFilesList();
      updateFileActionState();
      renderProductFileDetail();
      await renderWorkbookViewer(workbookBuffer, detail);
    } catch (error) {
      if (requestId !== openProductFileRequestId) return;

      currentProductFileDetail = null;
      currentWorkbookBuffer = null;
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

  async function renderWorkbookViewer(workbookBuffer: ArrayBuffer, detail: ProductFileDetail) {
    disposeWorkbookViewer();

    // Excel parsing and Univer are only needed after a file is opened.
    const [{ bufferToUniverWorkbook }, { createWorkbookViewer }] = await Promise.all([
      import('./univer/xlsxToUniver.js'),
      import('./univer/createWorkbookViewer.js'),
    ]);

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
      readOnly: !productFileEditing,
    });
    updateFileActionState();
  }

  async function enterProductFileEditing() {
    if (!currentProductFileDetail || !currentWorkbookBuffer || productFileEditing) return;
    if (productFileLoading || productFileSaving) return;
    productFileEditing = true;
    await renderWorkbookViewer(currentWorkbookBuffer, currentProductFileDetail);
  }

  function confirmDiscardEditing() {
    return confirmAction(tt('discardEditConfirm'), {
      title: tt('discardEditTitle'),
      confirmText: tt('discardEdit'),
      tone: 'danger',
    });
  }

  async function cancelProductFileEditing() {
    if (!productFileEditing || productFileSaving) return;
    if (!(await confirmDiscardEditing())) return;
    productFileEditing = false;
    if (!currentProductFileDetail || !currentWorkbookBuffer) {
      updateFileActionState();
      return;
    }
    await renderWorkbookViewer(currentWorkbookBuffer, currentProductFileDetail);
  }

  async function saveCurrentProductFile() {
    if (!currentProductFileDetail || !workbookViewer || productFileSaving || !productFileEditing) return;

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
      await uploadFormDataWithProgress(`/api/files/${currentProductFileDetail.file.id}/content`, form, {
        method: 'PUT',
        fileName: currentProductFileDetail.file.originalName,
        title: { 'zh-CN': '正在保存文件', 'en-US': 'Saving file' },
        completedText: { 'zh-CN': '保存完成', 'en-US': 'Save completed' },
      });
      productFileSaving = false;
      productFileEditing = false;
      renderProductFilesList();
      updateFileActionState();
      notify(tt('saved'), { type: 'success' });
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
    if (
      !(await confirmAction(`${tt('deleteConfirm')} ${getProductFileDisplayName(file)} ${tt('deleteConfirmSuffix')}`, {
        title: tt('deleteTitle'),
        confirmText: tt('deleteFile'),
        tone: 'danger',
      }))
    )
      return;

    await api(`/api/files/${fileId}`, { method: 'DELETE' });

    if (currentProductFileDetail?.file.id === fileId) {
      currentProductFileDetail = null;
      currentWorkbookBuffer = null;
      productFileEditing = false;
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
    document.getElementById('filesViewerToolbar')?.classList.add('hidden');
  }

  function disposeWorkbookViewer() {
    workbookViewer?.dispose();
    workbookViewer = null;
    updateFileActionState();
    const host = document.getElementById('productWorkbookViewer');
    if (host) host.innerHTML = '';
  }

  function updateFileActionState() {
    const toolbar = document.getElementById('filesViewerToolbar');
    const nameLabel = document.getElementById('filesViewerFileName');
    const badge = document.getElementById('filesViewerModeBadge');
    const editButton = document.getElementById('btnEditProductFile') as HTMLButtonElement | null;
    const saveButton = document.getElementById('btnSaveProductFile') as HTMLButtonElement | null;
    const cancelButton = document.getElementById('btnCancelProductFileEdit') as HTMLButtonElement | null;
    if (!toolbar || !nameLabel || !badge || !editButton || !saveButton || !cancelButton) return;

    const hasWorkbook = Boolean(currentProductFileDetail && workbookViewer);
    toolbar.classList.toggle('hidden', !hasWorkbook);
    if (!hasWorkbook) return;

    const file = currentProductFileDetail!.file;
    nameLabel.textContent = getProductFileDisplayName(file);
    nameLabel.setAttribute('title', getProductFileDisplayPath(file));
    badge.textContent = productFileEditing ? tt('editingMode') : tt('readOnlyMode');
    badge.classList.toggle('files-viewer-toolbar__badge--editing', productFileEditing);
    badge.setAttribute('title', productFileEditing ? tt('editingMode') : tt('readOnlyHint'));

    editButton.textContent = tt('edit');
    editButton.classList.toggle('hidden', productFileEditing);
    editButton.disabled = productFileLoading || productFileSaving;

    saveButton.textContent = productFileSaving ? tt('saving') : tt('save');
    saveButton.classList.toggle('hidden', !productFileEditing);
    saveButton.disabled = productFileLoading || productFileSaving;

    cancelButton.textContent = tt('cancel');
    cancelButton.classList.toggle('hidden', !productFileEditing);
    cancelButton.disabled = productFileSaving;
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

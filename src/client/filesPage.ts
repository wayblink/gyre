import type { ProductFileDetail, ProductFileRecord } from '../shared/types.js';
import type { ConfirmActionFn, NotifyFn } from './uiFeedback.js';
import { createWorkbookViewer } from './univer/createWorkbookViewer.js';
import { bufferToUniverWorkbook } from './univer/xlsxToUniver.js';

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
};

const FILES_LEFT_MIN = 200;
const FILES_LEFT_MAX = 480;
const FILES_LEFT_DEFAULT = 280;
const FILES_LEFT_COLLAPSED_WIDTH = 28;
const FILES_MOBILE_MEDIA = '(max-width: 768px)';

export function createFilesPage({ el, api, apiBinary, escapeHtml, formatDateTime, formatFileSize, notify, confirmAction }: FilesPageDeps) {
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

  async function init() {
    el('btnUploadProductFile').addEventListener('click', () => void uploadProductFile());
    el('btnRefreshFiles').addEventListener('click', () => void loadProductFiles());
    el('btnSaveProductFile').addEventListener('click', () => void saveCurrentProductFile());
    el('btnCollapseFilesPane').addEventListener('click', () => setFilesPaneCollapsed(true));
    el('filesCollapsedRail').addEventListener('click', () => setFilesPaneCollapsed(false));
    initFilesWorkspaceResize();
    applyFilesWorkspaceLayout();
    updateFileActionState();
    await loadProductFiles();
  }

  function getProductFiles() {
    return productFiles;
  }

  async function loadProductFiles(selectedId?: number) {
    const data = await api<{ files: ProductFileRecord[] }>('/api/files');
    productFiles = data.files;
    el('filesCountBadge').textContent = `${productFiles.length} 个`;

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
      el('fileBrowserEmpty').textContent = '选择左侧文件后可在页面内查看完整 Excel 工作簿。';
      return;
    }

    const targetId = selectedId ?? selectedProductFileId ?? currentProductFileDetail?.file.id ?? productFiles[0]?.id;
    renderProductFilesList();
    updateFileActionState();
    if (targetId) {
      await openProductFile(targetId);
    }
  }

  function renderProductFilesList() {
    const container = el('productFilesList');
    if (productFiles.length === 0) {
      container.innerHTML = '<div class="workbook-list__empty">尚未上传任何文件</div>';
      return;
    }

    container.innerHTML = productFiles
      .map(
        (file) => `
        <div
          class="workbook-item ${selectedProductFileId === file.id ? 'is-active' : ''} ${productFileLoading && selectedProductFileId === file.id ? 'is-loading' : ''}"
          data-file-id="${file.id}"
          role="button"
          tabindex="0"
          title="${escapeHtml(file.originalName)}"
        >
          <button class="workbook-item__edit" data-edit-file-id="${file.id}" type="button" aria-label="编辑文件名" title="编辑文件名">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 20h9"></path>
              <path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4Z"></path>
            </svg>
          </button>
          <button class="workbook-item__delete" data-delete-file-id="${file.id}" type="button" aria-label="删除文件" title="删除文件">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M3 6h18"></path>
              <path d="M8 6V4h8v2"></path>
              <path d="M19 6l-1 14H6L5 6"></path>
              <path d="M10 11v6"></path>
              <path d="M14 11v6"></path>
            </svg>
          </button>
          ${
            editingProductFileId === file.id
              ? `<div class="workbook-item__rename">
                  <input
                    class="workbook-item__rename-input"
                    data-rename-input-file-id="${file.id}"
                    type="text"
                    value="${escapeHtml(editingProductFileName)}"
                    maxlength="255"
                    aria-label="文件名"
                  />
                  <div class="workbook-item__rename-actions">
                    <button class="workbook-item__rename-btn workbook-item__rename-btn--primary" data-save-file-id="${file.id}" type="button" ${
                      renamingProductFileId === file.id ? 'disabled' : ''
                    }>${renamingProductFileId === file.id ? '保存中...' : '保存'}</button>
                    <button class="workbook-item__rename-btn" data-cancel-file-id="${file.id}" type="button" ${
                      renamingProductFileId === file.id ? 'disabled' : ''
                    }>取消</button>
                  </div>
                </div>`
              : `<div class="workbook-item__name">${escapeHtml(file.originalName)}</div>`
          }
          <div class="workbook-item__meta">${formatFileSize(file.fileSizeBytes)} · ${file.workbookSheetCount} sheets · ${escapeHtml(formatDateTime(file.createdAt))}</div>
          ${
            productFileLoadError && selectedProductFileId === file.id
              ? `<div class="workbook-item__status workbook-item__status--error">${escapeHtml(productFileLoadError)}</div>`
              : productFileLoading && selectedProductFileId === file.id
                ? '<div class="workbook-item__status">加载中...</div>'
                : productFileSaving && selectedProductFileId === file.id
                  ? '<div class="workbook-item__status">保存中...</div>'
                : ''
          }
        </div>`,
      )
      .join('');

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

    if (editingProductFileId !== null) {
      const input = container.querySelector<HTMLInputElement>(`[data-rename-input-file-id="${editingProductFileId}"]`);
      if (input && document.activeElement !== input) {
        input.focus();
        input.select();
      }
    }
  }

  async function uploadProductFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xls,.csv';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      const form = new FormData();
      form.append('file', file);
      form.append('uploadedBy', 'Administrator');
      const data = await api<{ file: ProductFileRecord }>('/api/files/upload', { method: 'POST', body: form });
      await loadProductFiles(data.file.id);
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
    renderFileBrowserMessage('正在加载文件...');

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
      productFileLoadError = error instanceof Error ? error.message : '文件加载失败';
      disposeWorkbookViewer();
      renderProductFilesList();
      updateFileActionState();
      renderFileBrowserMessage(`无法打开该文件：${productFileLoadError}`);
    }
  }

  function renderProductFileDetail() {
    if (!currentProductFileDetail) {
      renderFileBrowserMessage('选择左侧文件后可在页面内查看完整 Excel 工作簿。');
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
      notify('当前工作簿无法导出', { type: 'warning' });
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
      productFileLoadError = error instanceof Error ? error.message : '保存失败';
      renderProductFilesList();
      updateFileActionState();
      notify(productFileLoadError, { type: 'error' });
    }
  }

  async function deleteProductFile(fileId: number) {
    const file = productFiles.find((item) => item.id === fileId);
    if (!file) return;
    if (!(await confirmAction(`确定删除文件 ${file.originalName} 吗？`, { title: '删除文件', confirmText: '删除', tone: 'danger' }))) return;

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
      notify('文件名不能为空', { type: 'warning' });
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
      notify(error instanceof Error ? error.message : '修改文件名失败', { type: 'error' });
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
    const saveButton = el<HTMLButtonElement>('btnSaveProductFile');
    const disabled = !currentProductFileDetail || !workbookViewer || productFileLoading || productFileSaving;
    saveButton.disabled = disabled;
    saveButton.textContent = productFileSaving ? '保存中...' : '保存';
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
  };
}

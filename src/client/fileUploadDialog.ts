import type { ProductFileSummary } from '../shared/types.js';
import type { AppLanguage } from './i18n.js';
import { createTexts, type TextKey } from './texts.js';
import { buildProductFileFolderTree, inputUploadFolder, type FolderTreeNode } from './fileTree.js';
import { renderFolderTreePicker } from './folderTreePicker.js';

const t = createTexts('fileUpload');

type DomGetter = <T extends HTMLElement>(id: string) => T;

export type FileUploadDialogDeps = {
  el: DomGetter;
  escapeHtml: (text: unknown) => string;
  getProductFiles: () => ProductFileSummary[];
  getLanguage?: () => AppLanguage;
};

/**
 * Asks where an upload should land before it starts.
 *
 * Uploads are stored under `input/` (the server normalises any path with `inputStorageFolderPrefix`),
 * so the tree only offers that subtree plus a free-text path for a new folder.
 */
export function createFileUploadDialog({ el, escapeHtml, getProductFiles, getLanguage }: FileUploadDialogDeps) {
  const tt = (key: TextKey<'fileUpload'>) => t(key, getLanguage?.() ?? 'zh-CN');

  let pending: ((folder: string | null) => void) | null = null;
  let fileName = '';
  let selectedFolder = 'input';
  let expandedFolderPaths = new Set<string>(['input']);
  let bound = false;

  function overlay() {
    return el('fileUploadModal');
  }

  function open(file: File): Promise<string | null> {
    if (pending) return Promise.resolve(null);
    bind();
    fileName = file.name;
    selectedFolder = 'input';
    expandedFolderPaths = new Set(['input']);
    el<HTMLInputElement>('fileUploadNewFolder').value = '';
    setError('');
    renderHeader();
    overlay().classList.remove('hidden');
    // The tree is rendered once the dialog is visible, otherwise the reveal measures a hidden container.
    renderFolderTree({ revealSelected: true });
    return new Promise((resolve) => {
      pending = resolve;
    });
  }

  function settle(folder: string | null) {
    const resolve = pending;
    pending = null;
    overlay().classList.add('hidden');
    resolve?.(folder);
  }

  function bind() {
    if (bound) return;
    bound = true;
    el('btnCloseFileUploadModal').addEventListener('click', () => settle(null));
    el('btnCancelFileUploadModal').addEventListener('click', () => settle(null));
    overlay().addEventListener('click', (event) => {
      if (event.target === overlay()) settle(null);
    });
    el<HTMLInputElement>('fileUploadNewFolder').addEventListener('input', () => setError(''));
    el('btnConfirmFileUploadModal').addEventListener('click', () => confirmFolder());
  }

  function renderHeader() {
    el('fileUploadModalTitle').textContent = tt('title');
    el('fileUploadModalSubtitle').textContent = tt('subtitle');
    el('fileUploadModalFile').textContent = fileName;
    el('fileUploadNewFolderLabel').textContent = tt('newFolderLabel');
    el('btnCancelFileUploadModal').textContent = tt('cancel');
    el('btnConfirmFileUploadModal').textContent = tt('confirm');
  }

  function inputSubtree(): FolderTreeNode[] {
    const input = buildProductFileFolderTree(getProductFiles()).find((node) => node.path === 'input');
    return input ? [input] : [{ name: 'input', path: 'input', children: [] }];
  }

  function renderFolderTree(options: { revealSelected?: boolean } = {}) {
    renderFolderTreePicker({
      container: el('fileUploadFolderList'),
      nodes: inputSubtree(),
      selectedPath: selectedFolder,
      expandedPaths: expandedFolderPaths,
      escapeHtml,
      onSelect: (path) => {
        selectedFolder = path;
        el<HTMLInputElement>('fileUploadNewFolder').value = '';
        setError('');
        renderFolderTree();
      },
      onToggle: (path) => {
        if (expandedFolderPaths.has(path)) expandedFolderPaths.delete(path);
        else expandedFolderPaths.add(path);
        renderFolderTree();
      },
      revealSelected: options.revealSelected,
    });
  }

  function setError(message: string) {
    const target = el('fileUploadModalError');
    target.textContent = message;
    target.classList.toggle('hidden', !message);
  }

  function confirmFolder() {
    const typed = el<HTMLInputElement>('fileUploadNewFolder').value.trim();
    let folder: string;
    try {
      folder = inputUploadFolder(typed || selectedFolder);
    } catch {
      setError(tt('invalidFolder'));
      return;
    }
    settle(folder);
  }

  return { open };
}

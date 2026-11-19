import type { FolderTreeNode } from './fileTree.js';

/**
 * The folder tree shared by the move-files dialog and the upload dialog.
 *
 * The caller owns the selection and the expanded set; this module only renders the rows and wires
 * the two gestures: a row click selects that folder, the twisty opens/closes it.
 */
export type FolderTreePickerOptions = {
  container: HTMLElement;
  nodes: FolderTreeNode[];
  selectedPath: string;
  expandedPaths: ReadonlySet<string>;
  escapeHtml: (value: unknown) => string;
  onSelect: (path: string) => void;
  onToggle: (path: string) => void;
  /** Centre the selected row; needed the first time the container becomes visible. */
  revealSelected?: boolean;
};

export function folderAncestors(folder: string): string[] {
  const segments = folder.split('/').filter(Boolean);
  return segments.map((_, index) => segments.slice(0, index + 1).join('/'));
}

export function renderFolderTreePicker(options: FolderTreePickerOptions): void {
  const { container, nodes, escapeHtml, onSelect, onToggle } = options;
  const scrollTop = container.scrollTop;
  container.innerHTML = nodes.map((node) => renderFolderNode(node, 0, options)).join('');
  container.scrollTop = scrollTop;

  container.querySelectorAll<HTMLElement>('[data-folder-tree-toggle]').forEach((twisty) => {
    twisty.addEventListener('click', (event) => {
      event.stopPropagation();
      onToggle(twisty.dataset.folderTreeToggle ?? '');
    });
  });
  container.querySelectorAll<HTMLElement>('[data-folder-tree-dir]').forEach((row) => {
    row.addEventListener('click', () => onSelect(row.dataset.folderTreeDir ?? ''));
  });

  if (options.revealSelected) revealSelectedFolder(container);
}

/** `scrollIntoView` does not move this grid container, so the selected row is centred by hand. */
export function revealSelectedFolder(container: HTMLElement): void {
  const selected = container.querySelector<HTMLElement>('[data-folder-tree-dir].is-selected');
  if (!selected) return;
  const containerRect = container.getBoundingClientRect();
  const rowRect = selected.getBoundingClientRect();
  if (rowRect.top >= containerRect.top && rowRect.bottom <= containerRect.bottom) return;
  container.scrollTop += rowRect.top - containerRect.top - (containerRect.height - rowRect.height) / 2;
}

function renderFolderNode(node: FolderTreeNode, depth: number, options: FolderTreePickerOptions): string {
  const expanded = options.expandedPaths.has(node.path);
  const hasChildren = node.children.length > 0;
  const selected = node.path === options.selectedPath;
  const children =
    expanded && hasChildren ? node.children.map((child) => renderFolderNode(child, depth + 1, options)).join('') : '';
  return `
      <button
        class="workbook-tree__dir folder-tree__dir ${expanded ? 'is-expanded' : 'is-collapsed'} ${selected ? 'is-selected' : ''}"
        data-folder-tree-dir="${options.escapeHtml(node.path)}"
        type="button"
        aria-expanded="${expanded ? 'true' : 'false'}"
        title="${options.escapeHtml(node.path)}"
        style="--tree-depth: ${depth}"
      >
        <span class="workbook-tree__twisty ${hasChildren ? '' : 'is-leaf'}" data-folder-tree-toggle="${options.escapeHtml(node.path)}" aria-hidden="true">▸</span>
        <span class="workbook-tree__folder-icon" aria-hidden="true"></span>
        <span class="workbook-tree__dir-main">
          <span class="workbook-tree__dir-name">${options.escapeHtml(node.name)}</span>
          <span class="workbook-tree__dir-path">${options.escapeHtml(node.path)}</span>
        </span>
      </button>
      ${children}
    `;
}

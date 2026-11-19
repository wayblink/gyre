import type { ProductFileSummary } from '../shared/types.js';

export type FileTreeNode = {
  name: string;
  path: string;
  children: Map<string, FileTreeNode>;
  files: ProductFileSummary[];
};

export type ProductFilePathResolver = (file: ProductFileSummary) => string;

export function productFileTreePath(file: ProductFileSummary): string {
  return (file.displayPath || file.originalName).replace(/\\/g, '/');
}

/** Runtime and task file references are keyed by logicalPath, so the picker groups by it. */
export function productFileLogicalTreePath(file: ProductFileSummary): string {
  return (file.logicalPath || file.displayPath || file.originalName).replace(/\\/g, '/');
}

/**
 * Directory paths from the root down to the file's folder, e.g. `input/2026-06` → ['input', 'input/2026-06'].
 *
 * Jumping to a file (from the Monthly Update input list) has to open exactly these folders, otherwise the
 * row exists in the tree but is not rendered.
 */
export function fileAncestorDirectories(filePath: string): string[] {
  const segments = filePath
    .replace(/\\/g, '/')
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);
  const directories: string[] = [];
  let current = '';
  for (const segment of segments.slice(0, -1)) {
    current = current ? `${current}/${segment}` : segment;
    directories.push(current);
  }
  return directories;
}

export function createFileTreeNode(name: string, path: string): FileTreeNode {
  return {
    name,
    path,
    children: new Map(),
    files: [],
  };
}

export function buildProductFilesTree(
  files: ReadonlyArray<ProductFileSummary>,
  pathOf: ProductFilePathResolver = productFileTreePath,
): FileTreeNode {
  const root = createFileTreeNode('', '');

  files.forEach((file) => {
    const segments = pathOf(file)
      .split('/')
      .map((segment) => segment.trim())
      .filter(Boolean);
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

export function countTreeFiles(node: FileTreeNode): number {
  return (
    node.files.length + Array.from(node.children.values()).reduce((total, child) => total + countTreeFiles(child), 0)
  );
}

export function compareTreeNode(a: FileTreeNode, b: FileTreeNode): number {
  return a.name.localeCompare(b.name, 'zh-Hans-CN');
}

export function compareProductFile(a: ProductFileSummary, b: ProductFileSummary): number {
  return productFileTreePath(a).localeCompare(productFileTreePath(b), 'zh-Hans-CN');
}

/** Every folder (including ancestors) that files live in, so a move target can be picked from a list. */
export function collectProductFileFolders(
  files: ReadonlyArray<ProductFileSummary>,
  pathOf: ProductFilePathResolver = productFileLogicalTreePath,
): string[] {
  const folders = new Set<string>(['input', 'control_book']);
  files.forEach((file) => {
    const segments = pathOf(file)
      .split('/')
      .map((segment) => segment.trim())
      .filter(Boolean);
    segments.slice(0, -1).forEach((segment, index, directorySegments) => {
      folders.add(directorySegments.slice(0, index + 1).join('/'));
    });
  });
  return Array.from(folders).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
}

export type FolderTreeNode = {
  name: string;
  path: string;
  children: FolderTreeNode[];
};

/**
 * Directory-only tree for the "move file" target picker.
 *
 * The flat folder list (`collectProductFileFolders`) forced the operator to read `input/2026-08` as a
 * string; this keeps the same logical folders but nests them so the dialog reads like the file tree.
 * `input` and `control_book` stay listed even when empty, otherwise a file could not be moved back
 * into them before the first upload.
 */
export function buildProductFileFolderTree(files: ReadonlyArray<ProductFileSummary>): FolderTreeNode[] {
  const root: FolderTreeNode = { name: '', path: '', children: [] };

  const ensureDirectory = (path: string) => {
    let parent = root;
    let current = '';
    path
      .split('/')
      .filter(Boolean)
      .forEach((segment) => {
        current = current ? `${current}/${segment}` : segment;
        let child = parent.children.find((entry) => entry.name === segment);
        if (!child) {
          child = { name: segment, path: current, children: [] };
          parent.children.push(child);
        }
        parent = child;
      });
  };

  ['input', 'control_book'].forEach(ensureDirectory);
  files.forEach((file) => {
    const segments = productFileLogicalTreePath(file).split('/').filter(Boolean);
    if (segments.length > 1) ensureDirectory(segments.slice(0, -1).join('/'));
  });

  const sortNodes = (nodes: FolderTreeNode[]) => {
    nodes.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
    nodes.forEach((node) => sortNodes(node.children));
  };
  sortNodes(root.children);

  return root.children;
}

export function productFileFolder(file: ProductFileSummary): string {
  const segments = productFileLogicalTreePath(file).split('/').filter(Boolean);
  return segments.slice(0, -1).join('/');
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

/** Client-side mirror of normalizeProductFolder in src/server/fileIdentity.ts; the server re-normalizes anyway. */
export function normalizeClientFolder(value: string): string {
  const raw = String(value ?? '')
    .normalize('NFC')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '');
  if (!raw) return '';
  const segments = raw.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..' || hasControlCharacter(segment))) {
    throw new Error('Invalid folder path');
  }
  return segments.join('/');
}

/**
 * Client mirror of `inputStorageFolderPrefix` in src/server/routes/support.ts: uploads always live under
 * `input/`, so `2026-08` and `input/2026-08` both mean `input/2026-08`, and an empty path means `input`.
 */
export function inputUploadFolder(value: string): string {
  const normalized = normalizeClientFolder(value);
  if (!normalized) return 'input';
  if (normalized === 'input' || normalized.startsWith('input/')) return normalized;
  return `input/${normalized}`;
}

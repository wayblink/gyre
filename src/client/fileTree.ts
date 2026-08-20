import type { ProductFileRecord } from '../shared/types.js';

export type FileTreeNode = {
  name: string;
  path: string;
  children: Map<string, FileTreeNode>;
  files: ProductFileRecord[];
};

export type ProductFilePathResolver = (file: ProductFileRecord) => string;

export function productFileTreePath(file: ProductFileRecord): string {
  return (file.displayPath || file.storedName || file.originalName).replace(/\\/g, '/');
}

/** Runtime and task file references are keyed by logicalPath, so the picker groups by it. */
export function productFileLogicalTreePath(file: ProductFileRecord): string {
  return (file.logicalPath || file.displayPath || file.storedName || file.originalName).replace(/\\/g, '/');
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
  files: ReadonlyArray<ProductFileRecord>,
  pathOf: ProductFilePathResolver = productFileTreePath,
): FileTreeNode {
  const root = createFileTreeNode('', '');

  files.forEach((file) => {
    const segments = pathOf(file).split('/').map((segment) => segment.trim()).filter(Boolean);
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
  return node.files.length + Array.from(node.children.values()).reduce((total, child) => total + countTreeFiles(child), 0);
}

export function compareTreeNode(a: FileTreeNode, b: FileTreeNode): number {
  return a.name.localeCompare(b.name, 'zh-Hans-CN');
}

export function compareProductFile(a: ProductFileRecord, b: ProductFileRecord): number {
  return productFileTreePath(a).localeCompare(productFileTreePath(b), 'zh-Hans-CN');
}

/** Every folder (including ancestors) that files live in, so a move target can be picked from a list. */
export function collectProductFileFolders(
  files: ReadonlyArray<ProductFileRecord>,
  pathOf: ProductFilePathResolver = productFileLogicalTreePath,
): string[] {
  const folders = new Set<string>(['input']);
  files.forEach((file) => {
    const segments = pathOf(file).split('/').map((segment) => segment.trim()).filter(Boolean);
    segments.slice(0, -1).forEach((segment, index, directorySegments) => {
      folders.add(directorySegments.slice(0, index + 1).join('/'));
    });
  });
  return Array.from(folders).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
}

export function productFileFolder(file: ProductFileRecord): string {
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
  const raw = String(value ?? '').normalize('NFC').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!raw) return '';
  const segments = raw.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..' || hasControlCharacter(segment))) {
    throw new Error('Invalid folder path');
  }
  return segments.join('/');
}

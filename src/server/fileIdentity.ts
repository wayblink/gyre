import path from 'node:path';

function normalizedText(value: string): string {
  return value.normalize('NFC');
}

export function normalizeProductFileName(value: string): string {
  const name = normalizedText(String(value ?? '').trim());
  if (!name || name === '.' || name === '..' || /[\0/\\]/.test(name) || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new Error('Invalid file name');
  }
  if (path.posix.basename(name) !== name) throw new Error('Invalid file name');
  return name;
}

export function normalizeProductFolder(value?: string): string {
  const raw = normalizedText(String(value ?? '').trim()).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!raw) return '';
  const segments = raw.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..' || /[\0\u0000-\u001f\u007f]/.test(segment))) {
    throw new Error('Invalid folder path');
  }
  return segments.join('/');
}

export function canonicalProductFilePath(folder: string | undefined, fileName: string): string {
  return [normalizeProductFolder(folder), normalizeProductFileName(fileName)].filter(Boolean).join('/');
}

export function productFileCollisionKey(logicalPath: string): string {
  return normalizedText(normalizeProductFolder(logicalPath)).toLocaleLowerCase('en-US');
}

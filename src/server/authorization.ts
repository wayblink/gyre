const FILE_WRITE_METHODS = new Set(['PATCH', 'PUT', 'DELETE']);

export function requiresAdminRole(method: string, rawUrl: string): boolean {
  const normalizedMethod = method.toUpperCase();
  const pathname = rawUrl.split('?', 1)[0] || '/';

  if (pathname === '/api/workflows' || pathname.startsWith('/api/workflows/')) {
    return true;
  }

  // The audit trail is who-did-what across the whole system; only admins read it.
  if (pathname === '/api/audit-logs' || pathname.startsWith('/api/audit-logs/')) return true;

  if (pathname.startsWith('/api/workflow-runs/')) {
    if (normalizedMethod !== 'POST') return false;
    return /\/(?:cancel|retry-unfinished)$/.test(pathname) || /\/steps\/[^/]+\/execute$/.test(pathname);
  }

  if (pathname === '/api/files' && normalizedMethod === 'DELETE') return true;
  if (!pathname.startsWith('/api/files/')) return false;
  if (pathname === '/api/files/upload') return false;
  if (normalizedMethod === 'POST' && /\/move$/.test(pathname)) return true;
  return FILE_WRITE_METHODS.has(normalizedMethod);
}

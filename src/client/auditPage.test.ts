import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { AUDIT_PAGE_SIZE, describeAuditAction, describeAuditResult } from './auditPage.js';

/**
 * The audit page answers "who did what, and did it stick". These checks cover the two things that make
 * that readable — turning a stored `METHOD /api/...` into a sentence in the UI language — plus the
 * page being wired, admin-only and read-only.
 */

const t = (key: string) => key;

test('a stored route action is shown without leaking ids into the wording', () => {
  const action = describeAuditAction(
    { action: 'PUT /api/monthly-runs/instance', summary: null, method: 'PUT', statusCode: 200 },
    t,
  );
  assert.equal(action, 'PUT /api/monthly-runs/instance');
});

test('authentication events read as words, not as URLs', () => {
  for (const [summary, expected] of [
    ['auth.login', 'auditActionLogin'],
    ['auth.login_failed', 'auditActionLoginFailed'],
    ['auth.logout', 'auditActionLogout'],
  ] as const) {
    assert.equal(describeAuditAction({ action: 'auth.login', summary, method: 'POST', statusCode: 200 }, t), expected);
  }
});

test('results are grouped for reading, with the failure cases kept apart', () => {
  assert.equal(describeAuditResult(200, t), 'auditResultOk');
  assert.equal(describeAuditResult(302, t), 'auditResultRedirect');
  assert.equal(describeAuditResult(401, t), 'auditResultDenied');
  assert.equal(describeAuditResult(403, t), 'auditResultDenied');
  assert.equal(describeAuditResult(409, t), 'auditResultRejected');
  assert.equal(describeAuditResult(500, t), 'auditResultError');
  assert.equal(describeAuditResult(null, t), 'auditResultUnknown');
});

test('the page is wired into the app, admin-only and read-only', () => {
  const mainSource = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const authorization = readFileSync(new URL('../server/authorization.ts', import.meta.url), 'utf8');
  const appSource = readFileSync(new URL('../server/app.ts', import.meta.url), 'utf8');

  assert.match(html, /<section class="page-section" id="page-audit-logs">/);
  assert.match(html, /<div class="nav-item" data-page="audit-logs">/);
  // The nav entry lives in the Admin Only group, next to Workflow / User Management.
  const adminGroup = html.match(/<div class="nav-dev-tools hidden">[\s\S]*?<\/div>\s*<\/nav>/)?.[0] ?? '';
  assert.match(adminGroup, /data-page="audit-logs"/);

  assert.match(mainSource, /'audit-logs': '审计日志'/);
  assert.match(mainSource, /if \(page === 'audit-logs'\)/);
  assert.match(mainSource, /auditPage\.render\(\)/);
  assert.match(appSource, /'audit-logs',\s*\n\] as const;/);

  // Admin-only at the HTTP layer too: the page is not the only door.
  assert.match(authorization, /pathname === '\/api\/audit-logs' \|\| pathname\.startsWith\('\/api\/audit-logs\/'\)/);
});

test('the page offers no way to edit or delete an entry', () => {
  const page = readFileSync(new URL('./auditPage.ts', import.meta.url), 'utf8');
  // An audit log you can rewrite is not an audit log.
  assert.doesNotMatch(page, /method: 'DELETE'/);
  assert.doesNotMatch(page, /method: 'PUT'/);
  assert.doesNotMatch(page, /method: 'PATCH'/);
  assert.equal(AUDIT_PAGE_SIZE, 50);
});

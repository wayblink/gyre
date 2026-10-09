import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { installDom, installFetch, type FetchStub } from '../../test/dom-env.mjs';

/**
 * Boot smoke test for the client shell.
 *
 * main.ts is a ~4k-line module whose top level wires every page together; before the route modules
 * were extracted there was no way to execute any of it. These tests boot the real module in jsdom and
 * drive the public page APIs, which is the safety net for splitting main.ts further.
 */

const INDEX_HTML = readFileSync(path.join(process.cwd(), 'index.html'), 'utf8');

function installAppDom() {
  const { window } = installDom({ url: 'http://localhost/captable' });
  window.document.documentElement.innerHTML = INDEX_HTML.slice(
    INDEX_HTML.indexOf('<body'),
    INDEX_HTML.lastIndexOf('</body>'),
  );
  // jsdom does not implement layout; the app only reads these for class toggles.
  return window;
}

const API_STUBS: FetchStub[] = [
  {
    match: /\/api\/auth\/status$/,
    respond: {
      authenticated: true,
      bootstrapRequired: false,
      user: { id: 1, username: 'admin', display_name: 'Admin', role: 'admin' },
    },
  },
  {
    match: /\/api\/months$/,
    respond: { months: [{ month: '2026-09', hasCapTableData: true, hasPlanSummaryData: false }] },
  },
  { match: /\/api\/files$/, respond: { files: [] } },
  { match: /\/api\/esop-workflows$/, respond: { items: [] } },
  { match: /\/api\/data-management-workflows$/, respond: { items: [] } },
  {
    match: /\/api\/monthly-runs\/source-config$/,
    respond: {
      workflowCode: 'gyre-captable-summary-v2',
      workflowName: 'CapTable Summary',
      workflowVersion: 17,
      sources: [],
      fixedValues: [],
    },
  },
  {
    // Anchored on the query string: `/api/monthly-runs/instances` must not match this stub.
    match: /\/api\/monthly-runs\/instance\?/,
    respond: {
      instance: {
        id: 1,
        monthKey: '2026-09',
        operator: 'Administrator',
        status: 'pending',
        sources: {},
        fixedValues: {},
      },
    },
  },
  { match: /\/api\/monthly-runs$/, respond: { items: [], total: 0 } },
  { match: /\/api\/employee-labels$/, respond: { items: [] } },
  { match: /\/api\/global-parameters$/, respond: { items: [] } },
  { match: /\/api\/fixed-values$/, respond: { items: [] } },
  { match: /\/api\/settings\//, respond: { items: [] } },
  { match: /\/api\/admin\/users$/, respond: { items: [] } },
  {
    match: /\/api\/account$/,
    respond: { account: { id: 1, username: 'admin', displayName: 'Admin', email: null, phone: null } },
  },
];

/**
 * main.ts waits for DOMContentLoaded, which jsdom has already fired by the time a test imports it,
 * so the event is dispatched by hand. Returns after the app's queued async work has settled.
 */
/**
 * Kitchen-sink shape for endpoints the boot path touches but the test does not assert on: every
 * collection key the client reads, so a missing stub cannot crash initialization.
 */
const FALLBACK = {
  items: [],
  files: [],
  operators: [],
  workflows: [],
  months: [],
  rows: [],
  notes: [],
  users: [],
  links: [],
  history: [],
  plans: [],
  resultFiles: [],
  workflowSourceBindings: [],
  sources: [],
  total: 0,
  page: 1,
  pageSize: 20,
  totalPages: 1,
  totals: { inTotal: 0, cancelled: 0, outTotal: 0, planCount: 0, granted: 0, exercised: 0, outstanding: 0 },
};

let bootCount = 0;

async function bootApp(stubs = API_STUBS, settleMs = 250) {
  const window = installAppDom();
  installFetch(stubs, { fallback: FALLBACK });
  // A cache-busting query re-executes main.ts for each test: the module wires itself to the DOM
  // that exists when it is imported, so every test needs a fresh instance.
  bootCount += 1;
  await import(`./main.js?boot=${bootCount}`);
  window.document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, settleMs));
  return window;
}

test('the client shell boots and renders the navigation for the signed-in admin', async () => {
  const window = await bootApp();
  const doc = window.document;
  assert.equal(doc.documentElement.lang, 'zh-CN');
  // Nav items come from pageTitles, so a boot failure shows up as an empty sidebar.
  const navItems = [...doc.querySelectorAll('.nav-item[data-page]')];
  assert.ok(navItems.length >= 10, `expected the full sidebar, got ${navItems.length}`);
  assert.ok(
    navItems.some((item) => item.getAttribute('data-page') === 'monthly'),
    'monthly nav item missing',
  );
  assert.ok(navItems.some((item) => item.getAttribute('data-page') === 'workflow'));
  // The auth shell must be hidden once a session exists.
  assert.ok(doc.getElementById('authShell')?.classList.contains('hidden'));
});

test('switching pages activates the matching page container', async () => {
  const window = await bootApp();
  const doc = window.document;
  const monthlyNav = [...doc.querySelectorAll<HTMLButtonElement>('.nav-item[data-page]')].find(
    (item) => item.getAttribute('data-page') === 'monthly',
  );
  assert.ok(monthlyNav, 'monthly nav item missing');
  monthlyNav.click();
  await new Promise((resolve) => setTimeout(resolve, 120));

  // Pages are shown/hidden with the `active` class (see activatePage in main.ts).
  assert.ok(doc.getElementById('page-monthly')?.classList.contains('active'), 'monthly page must become active');
  assert.ok(
    !doc.getElementById('page-captable')?.classList.contains('active'),
    'the previous page must be deactivated',
  );
  assert.equal(window.location.pathname, '/monthly');
  // The monthly page is the entry point for the monthly run workspace.
  assert.ok(doc.getElementById('monthlyRunMonth'), 'monthly run workspace must be mounted');
});

test('the monthly run page renders its source table from the workflow definition', async () => {
  const window = await bootApp([
    ...API_STUBS,
    {
      match: /\/api\/monthly-runs\/source-config$/,
      respond: {
        workflowCode: 'gyre-captable-summary-v2',
        workflowName: 'CapTable Summary',
        workflowVersion: 17,
        sources: [
          {
            sourceKey: 'incremental_control_book',
            sourceGroup: 'shareworks',
            taskId: 'extract_incremental_control_book',
            label: 'Control Book Detail update',
            description: '',
            required: true,
            hidden: false,
            allowSheetNameOverride: false,
            order: 2,
          },
        ],
        fixedValues: [],
      },
    },
  ]);

  const rows = window.document.querySelectorAll('#monthlyRunSourcesBody tr');
  assert.equal(rows.length, 1, 'one source row expected');
  assert.match(rows[0].textContent ?? '', /Control Book Detail update/);
  // No version mismatch banner for the pinned version.
  assert.doesNotMatch(window.document.getElementById('monthlyRunSourceInfo')?.textContent ?? '', /版本不匹配/);
});

test('a stale workflow definition version blocks the monthly page with a bilingual error', async () => {
  const window = await bootApp([
    ...API_STUBS,
    {
      match: /\/api\/monthly-runs\/source-config$/,
      respond: {
        workflowCode: 'gyre-captable-summary-v2',
        workflowName: 'CapTable Summary',
        workflowVersion: 18,
        sources: [],
        fixedValues: [],
      },
    },
  ]);

  const info = window.document.getElementById('monthlyRunSourceInfo');
  assert.match(info?.textContent ?? '', /月度更新工作流版本不匹配/);
  assert.match(info?.textContent ?? '', /v17/);
  assert.match(info?.textContent ?? '', /v18/);
  // The source table must not render inputs for a definition this page does not know.
  assert.match(window.document.querySelector('#monthlyRunSourcesBody tr')?.textContent ?? '', /版本不匹配/);
});

test('the workflow update modal opens for a workflow-backed page', async () => {
  const window = await bootApp(
    [
      ...API_STUBS,
      {
        match: /\/api\/esop-workflows$/,
        respond: {
          items: [
            {
              pageKey: 'grant-record',
              workflowCode: 'esop-grant-record-sync',
              workflowName: 'Grant Record Sync',
              sources: [{ sourceKey: 'futu_grants', label: 'Futu Grants', sheet: null }],
              resultFiles: [],
            },
          ],
        },
      },
    ],
    60,
  );

  const button = window.document.querySelector<HTMLButtonElement>('[data-workflow-update-page="grant-record"]');
  assert.ok(button, 'grant-record update button missing');
  button.click();
  await new Promise((resolve) => setTimeout(resolve, 60));

  const modal = window.document.getElementById('workflowUpdateModal');
  assert.ok(!modal?.classList.contains('hidden'), 'the update modal must open');
  assert.match(window.document.getElementById('workflowUpdateSourceList')?.textContent ?? '', /Futu Grants/);
});

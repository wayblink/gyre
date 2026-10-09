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
let lastRequests: Array<{ url: string; method: string }> = [];

async function bootApp(stubs = API_STUBS, settleMs = 250) {
  const window = installAppDom();
  lastRequests = installFetch(stubs, { fallback: FALLBACK }).calls;
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

const GRANT_RECORD_CONFIG = {
  items: [
    {
      pageKey: 'grant-record',
      workflowCode: 'esop-grant-record-sync',
      workflowName: 'Grant Record Sync',
      description: 'Sync grants',
      sources: [{ sourceKey: 'futu_grants', label: 'Futu Grants', sheet: null }],
      resultFiles: [],
    },
  ],
};

const PRODUCT_FILE = {
  id: 501,
  originalName: 'grants.xlsx',
  displayName: 'grants.xlsx',
  storedName: 'grants-stored.xlsx',
  displayPath: '/Futu/grants.xlsx',
  fileExt: '.xlsx',
  fileSizeBytes: 2048,
  mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  checksum: 'c'.repeat(64),
  storageBackend: 'local',
  workbookSheetCount: 2,
  workbookRowCount: 100,
  uploadedBy: 'Admin',
  createdAt: '2026-09-01T00:00:00.000Z',
};

test('the workflow update modal refuses to run while a source file is missing', async () => {
  const window = await bootApp([...API_STUBS, { match: /\/api\/esop-workflows$/, respond: GRANT_RECORD_CONFIG }], 80);
  const doc = window.document;

  doc.querySelector<HTMLButtonElement>('[data-workflow-update-page="grant-record"]')?.click();
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.ok(
    doc.querySelector('[data-workflow-update-file-pick="futu_grants"]'),
    'the modal should list the workflow source',
  );

  doc.querySelector<HTMLButtonElement>('#btnConfirmWorkflowUpdate')?.click();
  await new Promise((resolve) => setTimeout(resolve, 40));

  assert.ok(!lastRequests.some((request) => request.url.includes('/runs')), 'must not start a run');
  assert.ok(!doc.getElementById('workflowUpdateModal')?.classList.contains('hidden'), 'the modal stays open');
});

test('the workflow update modal runs the page workflow and reports progress', async () => {
  const window = await bootApp(
    [
      ...API_STUBS,
      { match: /\/api\/esop-workflows$/, respond: GRANT_RECORD_CONFIG },
      { match: /\/api\/files$/, respond: { files: [PRODUCT_FILE] } },
      {
        match: /\/api\/esop-workflows\/grant-record\/runs$/,
        respond: { run: { id: 77, status: 'running', steps: [] } },
      },
      {
        match: /\/api\/workflow-runs\/77$/,
        respond: { id: 77, status: 'completed', steps: [], tasksSnapshot: [] },
      },
    ],
    80,
  );
  const doc = window.document;

  doc.querySelector<HTMLButtonElement>('[data-workflow-update-page="grant-record"]')?.click();
  await new Promise((resolve) => setTimeout(resolve, 60));
  doc.querySelector<HTMLButtonElement>('[data-workflow-update-file-pick="futu_grants"]')?.click();
  await new Promise((resolve) => setTimeout(resolve, 80));

  // The file picker is a real DOM modal: expand the folder that holds the file, highlight the row,
  // then confirm the selection.
  doc.querySelector<HTMLElement>('[data-picker-dir-path="Futu"]')?.click();
  doc.querySelector<HTMLElement>('[data-picker-file-id="501"]')?.click();
  doc.querySelector<HTMLButtonElement>('#btnConfirmWorkflowFilePicker')?.click();
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.match(
    doc.getElementById('workflowUpdateStatus')?.textContent ?? '',
    /grants\.xlsx/,
    'the picked file should be echoed back into the modal',
  );

  doc.querySelector<HTMLButtonElement>('#btnConfirmWorkflowUpdate')?.click();
  await new Promise((resolve) => setTimeout(resolve, 1500));

  const runRequest = lastRequests.find(
    (request) => request.method === 'POST' && request.url.includes('/api/esop-workflows/grant-record/runs'),
  );
  assert.ok(runRequest, 'the workflow run should be started');
  assert.match(
    doc.getElementById('workflowUpdateStatus')?.textContent ?? '',
    /完成|completed/i,
    'the modal should report the finished run',
  );
  assert.ok(doc.getElementById('workflowUpdateModal')?.classList.contains('hidden'), 'the modal closes on success');
});

const WORKFLOW_STUBS: FetchStub[] = [
  { match: /\/api\/workflows$/, respond: { items: [], total: 0 } },
  { match: /\/api\/operators$/, respond: { items: [] } },
  { match: /\/api\/workflow-runs$/, respond: { items: [], total: 0 } },
  { match: /\/api\/files$/, respond: { files: [] } },
];

test('the workflow page boots and renders an empty canvas state', async () => {
  const window = await bootApp([...API_STUBS, ...WORKFLOW_STUBS], 120);
  const doc = window.document;

  doc.querySelector<HTMLButtonElement>('.nav-item[data-page="workflow"]')?.click();
  await new Promise((resolve) => setTimeout(resolve, 250));

  assert.ok(doc.getElementById('page-workflow')?.classList.contains('active'), 'workflow page not active');
  assert.ok(
    lastRequests.some((request) => request.url.includes('/api/workflows')),
    'the workflow page should load its workflow list',
  );
  // The canvas shell must exist even with no workflows selected.
  assert.ok(doc.getElementById('workflowDag'), 'workflow canvas missing');
  assert.ok(doc.getElementById('workflowRunPanel'), 'workflow run panel missing');
  assert.ok(doc.getElementById('workflowTaskEditor'), 'task editor missing');
  // The operator palette is grouped by category, so an empty list must not throw.
  assert.ok(doc.getElementById('workflowOperators'), 'operator palette missing');
});

const WORKFLOW_WITH_TASKS = {
  items: [
    {
      id: 9,
      code: 'demo-dag',
      name: 'Demo DAG',
      description: 'two tasks, one edge',
      status: 'draft',
      version: 1,
      runtimeParamsSchema: { parameters: [], inputFiles: [] },
      runtimeParamsDefaults: {},
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
      tasks: [
        {
          id: 'load',
          name: 'Load grants',
          operatorCode: 'read_excel',
          operatorVersion: '1.0.0',
          description: '',
          x: 40,
          y: 40,
          params: {},
          inputs: { grants: { from: '', slot: '' } },
          dependsOn: [],
        },
        {
          id: 'transform',
          name: 'Transform grants',
          operatorCode: 'sql_transform',
          operatorVersion: '1.0.0',
          description: '',
          x: 360,
          y: 120,
          params: {},
          inputs: { source: { from: 'load', slot: 'output' } },
          dependsOn: ['load'],
        },
      ],
    },
  ],
  total: 1,
};

test('the workflow page renders the DAG nodes and the dependency edge', async () => {
  const window = await bootApp(
    [
      ...API_STUBS,
      ...WORKFLOW_STUBS,
      { match: /\/api\/workflows$/, respond: WORKFLOW_WITH_TASKS },
      { match: /\/api\/operators$/, respond: { items: [] } },
    ],
    120,
  );
  const doc = window.document;

  doc.querySelector<HTMLButtonElement>('.nav-item[data-page="workflow"]')?.click();
  await new Promise((resolve) => setTimeout(resolve, 350));

  const nodes = [...doc.querySelectorAll('.workflow-node[data-task-id]')];
  assert.ok(doc.querySelector('.workflow-dag__edges'), 'edge layer missing');
  assert.deepEqual(
    nodes.map((node) => node.getAttribute('data-task-id')).sort(),
    ['load', 'transform'],
    'both tasks should render as DAG nodes',
  );
  // Selecting a node drives the inspector.
  nodes
    .find((node) => node.getAttribute('data-task-id') === 'transform')
    ?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.ok(
    doc.querySelector('.workflow-node[data-task-id="transform"]')?.classList.contains('is-active'),
    'clicking a node should activate it',
  );
  // The data binding must render as an edge between the two handles (jsdom has no layout, so the
  // path is degenerate — what matters is that the edge exists and names the target slot).
  const edges = [...doc.querySelectorAll('.workflow-dag__edges .workflow-edge')];
  assert.equal(edges.length, 1, `expected one data edge, got ${edges.length}`);
  assert.equal(edges[0].getAttribute('data-edge-target-task-id'), 'transform');
  assert.equal(edges[0].getAttribute('data-edge-target-slot'), 'source');
  assert.match(edges[0].querySelector('.workflow-edge__path')?.getAttribute('d') ?? '', /^M /);
});

test('switching the UI language re-labels the shell', async () => {
  const window = await bootApp();
  const doc = window.document;

  const navText = () => doc.querySelector('.nav-item[data-page="grant-record"] .nav-text')?.textContent ?? '';
  const searchButton = () => doc.getElementById('btnSearchHoldings')?.textContent ?? '';
  const paginationLabel = () => doc.querySelector('.pagination-size-label-text')?.textContent ?? '';

  assert.equal(doc.documentElement.lang, 'zh-CN');
  const zhNav = navText();
  const zhSearch = searchButton();
  const zhRows = paginationLabel();
  assert.ok(zhNav.length > 0 && zhSearch.length > 0, 'Chinese labels should render');

  doc.querySelector<HTMLButtonElement>('[data-language="en-US"]')?.click();
  await new Promise((resolve) => setTimeout(resolve, 120));

  assert.equal(doc.documentElement.lang, 'en-US');
  assert.notEqual(navText(), zhNav, 'nav labels should switch');
  assert.notEqual(searchButton(), zhSearch, 'button labels should switch');
  assert.notEqual(paginationLabel(), zhRows, 'pagination labels should switch');
});

const ADMIN_USERS = {
  users: [
    {
      id: 1,
      username: 'admin',
      displayName: 'Admin',
      role: 'admin',
      isActive: true,
      lastLoginAt: '2026-10-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      email: 'admin@example.com',
      phone: null,
    },
    {
      id: 2,
      username: 'viewer',
      displayName: 'Viewer',
      role: 'user',
      isActive: false,
      lastLoginAt: null,
      createdAt: '2026-02-01T00:00:00.000Z',
      email: null,
      phone: null,
    },
  ],
};

test('the user management page renders its table and opens the edit modal', async () => {
  const window = await bootApp([...API_STUBS, { match: /\/api\/admin\/users$/, respond: ADMIN_USERS }], 120);
  const doc = window.document;

  doc.querySelector<HTMLButtonElement>('.nav-item[data-page="user-management"]')?.click();
  await new Promise((resolve) => setTimeout(resolve, 250));

  const rows = [...doc.querySelectorAll('#userManagementBody tr[data-managed-user-id]')];
  assert.deepEqual(
    rows.map((row) => row.getAttribute('data-managed-user-id')),
    ['1', '2'],
    'both users should render',
  );
  assert.ok(rows[1].textContent?.includes('停用'), 'an inactive user should be labelled as such');
  assert.ok(doc.querySelector('[data-edit-managed-user="1"]'), 'edit button missing');

  // Editing prefills the modal and switches its title to the edit copy.
  doc.querySelector<HTMLButtonElement>('[data-edit-managed-user="1"]')?.click();
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.ok(!doc.getElementById('managedUserModal')?.classList.contains('hidden'), 'modal should open');
  assert.equal(doc.getElementById('managedUserModalTitle')?.textContent, '编辑用户');
  assert.equal((doc.getElementById('managedUserUsername') as HTMLInputElement | null)?.value, 'admin');

  // Creating resets it back to the create copy.
  doc.querySelector<HTMLButtonElement>('[data-close="managedUserModal"]')?.click();
  doc.querySelector<HTMLButtonElement>('#btnOpenManagedUserModal')?.click();
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(doc.getElementById('managedUserModalTitle')?.textContent, '创建用户');
  assert.equal((doc.getElementById('managedUserUsername') as HTMLInputElement | null)?.value, '');
});

test('switching the language relabels the user management table and modal', async () => {
  const window = await bootApp([...API_STUBS, { match: /\/api\/admin\/users$/, respond: ADMIN_USERS }], 120);
  const doc = window.document;

  doc.querySelector<HTMLButtonElement>('.nav-item[data-page="user-management"]')?.click();
  await new Promise((resolve) => setTimeout(resolve, 200));
  const zhHeader = doc.querySelector('[data-user-management-label="username"]')?.textContent;

  doc.querySelector<HTMLButtonElement>('[data-language="en-US"]')?.click();
  await new Promise((resolve) => setTimeout(resolve, 150));

  assert.notEqual(
    doc.querySelector('[data-user-management-label="username"]')?.textContent,
    zhHeader,
    'table headers should switch language',
  );
  assert.equal(doc.querySelector('[data-user-management-label="username"]')?.textContent, 'Username');
  // Rows re-render too, so a status label follows the language.
  assert.ok(
    [...doc.querySelectorAll('#userManagementBody tr')].some((row) => row.textContent?.includes('Inactive')),
    'status labels should switch language',
  );
});

const GLOBAL_PARAMETERS = {
  items: [
    {
      id: 5,
      key: 'optionsOutstandingCullgen',
      label: 'Options Outstanding - Cullgen',
      value: 4156815,
      updatedAt: '2026-09-01T00:00:00.000Z',
      updatedBy: 'Administrator',
      editable: true,
    },
  ],
};

test('the global parameter page renders its rows and gates the edit controls on the admin role', async () => {
  const window = await bootApp([...API_STUBS, { match: /\/api\/global-parameters$/, respond: GLOBAL_PARAMETERS }], 120);
  const doc = window.document;

  // The page has no sidebar entry, so it is reached by URL: a location change drives
  // syncPageFromLocation() -> activatePage('fixed-value') -> fixedValuePage.render().
  window.history.pushState(null, '', '/fixed-value');
  window.dispatchEvent(new window.Event('popstate'));
  await new Promise((resolve) => setTimeout(resolve, 250));

  assert.ok(
    lastRequests.some((request) => request.url.includes('/api/global-parameters')),
    'activating the page should load the parameters',
  );
  assert.ok(doc.getElementById('page-fixed-value')?.classList.contains('active'), 'page not activated');
  const row = doc.querySelector('#fixedValuePageBody tr');
  assert.ok(row, 'the parameter row should render');
  assert.ok(row.textContent?.includes('optionsOutstandingCullgen'), 'the key should render');
  assert.ok(row.textContent?.includes('4,156,815'), 'the value should be formatted');

  // The signed-in user is an admin, so the row actions are rendered.
  assert.ok(doc.querySelector('[data-action="edit-fixed-value"][data-id="5"]'), 'edit button missing');
  assert.ok(doc.querySelector('[data-action="delete-fixed-value"][data-id="5"]'), 'delete button missing');
  assert.ok(doc.getElementById('btnAddFixedValue'), 'add button missing');

  // Editing prefills the modal from the row.
  doc.querySelector<HTMLButtonElement>('[data-action="edit-fixed-value"][data-id="5"]')?.click();
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.ok(!doc.getElementById('fixedValueEditModal')?.classList.contains('hidden'), 'edit modal should open');
  assert.equal(
    (doc.getElementById('fixedValueEditLabel') as HTMLInputElement | null)?.value,
    'Options Outstanding - Cullgen',
  );
  assert.equal((doc.getElementById('fixedValueEditValue') as HTMLInputElement | null)?.value, '4156815');
});

const HOLDERS_PAGE = {
  summary: { asOfDate: '2026-09-30', fullyDiluted: 1000, commonStockOs: 500 },
  items: [
    {
      rowType: 'holder',
      name: 'GNI Group Ltd.',
      commonStock: 100,
      totalCses: 200,
      pctOfClass: 0.2,
      pctFullyDiluted: 0.3,
    },
    { rowType: 'holder', name: 'Songjiang Ma', commonStock: 50, totalCses: 80, pctOfClass: 0.1, pctFullyDiluted: 0.13 },
    { rowType: 'total', name: 'Total', commonStock: 150, totalCses: 280, pctOfClass: 0.3, pctFullyDiluted: 0.43 },
  ],
  workflowSourceBindings: [],
  workflowResultFiles: [],
};

const HOLDER_FIXED_VALUES = {
  items: [
    {
      id: 11,
      key: 'fivePercentHoldersGniCommonStock',
      label: 'GNI Common Stock',
      value: 100,
      updatedBy: 'Administrator',
    },
    { id: 12, key: 'fivePercentHoldersGniTotalCses', label: 'GNI Total CSEs', value: 200, updatedBy: 'Administrator' },
    {
      id: 13,
      key: 'fivePercentHoldersSongjiangMaCommonStock',
      label: 'Ma Common Stock',
      value: 50,
      updatedBy: 'Administrator',
    },
    {
      id: 14,
      key: 'fivePercentHoldersSongjiangMaTotalCses',
      label: 'Ma Total CSEs',
      value: 80,
      updatedBy: 'Administrator',
    },
  ],
};

test('the 5% holders page swaps its numbers for inline inputs in edit mode', async () => {
  const window = await bootApp(
    [
      ...API_STUBS,
      { match: /\/api\/five-percent-holders$/, respond: HOLDERS_PAGE },
      { match: /\/api\/five-percent-holders\/fixed-values$/, respond: HOLDER_FIXED_VALUES },
    ],
    120,
  );
  const doc = window.document;

  doc.querySelector<HTMLButtonElement>('.nav-item[data-page="five-percent-holders"]')?.click();
  await new Promise((resolve) => setTimeout(resolve, 250));

  // Read mode renders plain numbers, and the action button says Update.
  assert.ok(!doc.querySelector('[data-five-percent-fixed-value-key]'), 'no inputs expected outside edit mode');
  const updateButton = doc.querySelector<HTMLButtonElement>('[data-workflow-update-page="five-percent-holders"]');
  assert.equal(updateButton?.querySelector('[data-workflow-action-label]')?.textContent, '更新');
  assert.ok(doc.getElementById('btnCancelFivePercentHoldersEdit')?.classList.contains('hidden'), 'cancel hidden');

  // First click enters edit mode: the four holder numbers become inputs.
  updateButton?.click();
  await new Promise((resolve) => setTimeout(resolve, 200));
  const inputs = [...doc.querySelectorAll<HTMLInputElement>('[data-five-percent-fixed-value-key]')];
  assert.equal(inputs.length, 4, `expected four inline inputs, got ${inputs.length}`);
  assert.deepEqual(
    inputs.map((input) => input.value),
    ['100', '200', '50', '80'],
  );
  assert.equal(
    updateButton?.querySelector('[data-workflow-action-label]')?.textContent,
    '确认并运行',
    'the button should switch to Confirm & Run',
  );
  assert.ok(!doc.getElementById('btnCancelFivePercentHoldersEdit')?.classList.contains('hidden'), 'cancel visible');

  // Cancel leaves edit mode without persisting anything.
  doc.getElementById('btnCancelFivePercentHoldersEdit')?.click();
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.ok(!doc.querySelector('[data-five-percent-fixed-value-key]'), 'inputs should be gone after cancel');
  assert.equal(
    doc.querySelector('[data-workflow-update-page="five-percent-holders"] [data-workflow-action-label]')?.textContent,
    '更新',
  );
  assert.ok(
    !lastRequests.some((request) => request.method === 'POST' && request.url.includes('/api/fixed-values')),
    'cancelling must not persist anything',
  );
});

test('the workflow runtime parameter panel renders its groups and file pickers', async () => {
  const window = await bootApp(
    [
      ...API_STUBS,
      ...WORKFLOW_STUBS,
      { match: /\/api\/workflows$/, respond: WORKFLOW_WITH_TASKS },
      { match: /\/api\/operators$/, respond: { items: [] } },
      {
        // Give the workflow a runtime schema so the panel has something to render.
        match: /\/api\/workflows$/,
        respond: {
          items: [
            {
              ...WORKFLOW_WITH_TASKS.items[0],
              runtimeParamsSchema: {
                sheetName: { type: 'string', label: 'Sheet' },
                pageSize: { type: 'number', label: 'Page size' },
                strict: { type: 'boolean', label: 'Strict' },
                fileRefs: {
                  type: 'object',
                  label: 'Files',
                  properties: {
                    grants: { type: 'object', label: 'Grants file' },
                  },
                },
              },
              runtimeParamsDefaults: { sheetName: 'Grants', pageSize: 50, strict: true },
            },
          ],
          total: 1,
        },
      },
    ],
    120,
  );
  const doc = window.document;

  doc.querySelector<HTMLButtonElement>('.nav-item[data-page="workflow"]')?.click();
  await new Promise((resolve) => setTimeout(resolve, 350));

  const summary = doc.getElementById('workflowRuntimeParamsSummary');
  assert.ok(summary, 'runtime params summary missing');
  assert.ok(!summary.classList.contains('hidden'), 'the panel should be visible');
  // One control per parameter, typed by its schema entry.
  const controls = [...doc.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-runtime-default-path]')];
  assert.deepEqual(controls.map((control) => control.dataset.runtimeDefaultType).sort(), [
    'boolean',
    'fileRef',
    'number',
    'string',
  ]);
  assert.equal(
    (controls.find((control) => control.dataset.runtimeDefaultType === 'string') as HTMLInputElement)?.value,
    'Grants',
    'the default value should be prefilled',
  );
  // The raw JSON view carries both halves.
  assert.match(doc.querySelector('[data-workflow-runtime-json="schema"]')?.textContent ?? '', /"sheetName"/);
  assert.match(doc.querySelector('[data-workflow-runtime-json="defaults"]')?.textContent ?? '', /"pageSize": 50/);
  // The fileRef parameter renders the picker trigger, not a bare hidden input only.
  assert.ok(doc.querySelector('[data-file-pick-open]'), 'file pick trigger missing');
});

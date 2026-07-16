import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../css/style.css', import.meta.url), 'utf8');
const filesPageSource = readFileSync(new URL('./filesPage.ts', import.meta.url), 'utf8');
const docsPageSource = readFileSync(new URL('./docsPage.ts', import.meta.url), 'utf8');

function pageLabel(page: string): string {
  const match = html.match(new RegExp(`<div class="nav-item[^"]*" data-page="${page}"[\\s\\S]*?<span class="nav-text">([^<]+)</span>`));
  return match?.[1]?.trim() ?? '';
}

function pagePosition(page: string): number {
  return html.indexOf(`data-page="${page}"`);
}

function pageSection(page: string, nextPage?: string): string {
  const endPattern = nextPage
    ? `id="page-${nextPage}"`
    : '<section class="page-section" id="page-docs">';
  return html.match(new RegExp(`id="page-${page}"[\\s\\S]*?${endPattern}`))?.[0] ?? '';
}

test('primary navigation follows the product menu layout before dev tools', () => {
  const expectedPages = [
    'captable',
    'monthly',
    'esop-detail',
    'grant-record',
    'exercise-record',
    'sold-shares',
    'transfer-plan',
    'employee-management',
    'plan-summary',
    'five-percent-holders',
    'fixed-value',
  ];

  assert.deepEqual(
    expectedPages.map((page) => pageLabel(page)),
    [
      'Captable',
      '月度更新',
      'ESOP Detail',
      'Grant Record',
      'Exercise to Date',
      'Sold Shares',
      '2025 Transfer to Futu',
      'Employee Management',
      'Plan Summary',
      '5% Holders',
      'Global Parameter',
    ],
  );

  const positions = expectedPages.map((page) => pagePosition(page));
  assert.equal(positions.every((position) => position >= 0), true);
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);

  assert.equal(pagePosition('summary'), -1);

  const firstDevTool = Math.min(pagePosition('files'), pagePosition('workflow'));
  assert.equal(positions.every((position) => position < firstDevTool), true);
});

test('captable is the renamed Summary page and new product pages have matching sections', () => {
  [
    'captable',
    'esop-detail',
    'grant-record',
    'exercise-record',
    'sold-shares',
    'transfer-plan',
    'employee-management',
    'plan-summary',
    'five-percent-holders',
    'fixed-value',
  ].forEach((page) => {
    assert.match(html, new RegExp(`<section class="[^"]*page-section[^"]*" id="page-${page}">`));
  });

  assert.match(html, /id="page-captable"[\s\S]*股本对账/);
  assert.match(html, /id="page-captable"[\s\S]*股权结构汇总/);
  assert.doesNotMatch(html, /id="page-summary"/);
});

test('new product pages expose real data containers instead of placeholder-only shells', () => {
  assert.match(html, /id="page-grant-record"[\s\S]*id="grantTable-futu"/);
  assert.match(html, /id="page-grant-record"[\s\S]*id="holdingsBody"/);
  assert.match(html, /id="page-employee-management"[\s\S]*id="employeesPageTable"/);
  assert.match(html, /id="page-employee-management"[\s\S]*id="employeesPageBody"/);
  const employeePage = html.match(/id="page-employee-management"[\s\S]*?id="page-plan-summary"/)?.[0] ?? '';
  assert.match(employeePage, /id="employeesSourceFilesName"/);
  assert.doesNotMatch(employeePage, /id="employeesResultFileName"/);
  assert.doesNotMatch(employeePage, /Employee master records summarized from ESOP detail/);
  assert.match(employeePage, /id="filterEmployeesPageTag"[\s\S]*All Tags/);
  assert.match(employeePage, /class="card-header"[\s\S]*class="btn btn-warning" id="btnManageEmployeeLabels"[\s\S]*id="btnAddEmployeesPage"[\s\S]*id="employeesPageTable"/);
  assert.match(employeePage, /名称或颜色变更会自动影响所有员工/);
  assert.match(employeePage, /id="employeeLabelsTable"/);
  assert.match(employeePage, /id="employeeLabelsBody"/);
  assert.match(employeePage, /id="btnAddEmployeeLabel"/);
  assert.match(employeePage, /id="employeeLabelManagementModal"/);
  assert.match(employeePage, /id="employeeLabelColor"/);
  assert.match(employeePage, /id="employeeLabelColorPreview"/);
  assert.match(employeePage, /id="employeesPageSelectedLabels"/);
  assert.match(employeePage, /id="btnOpenEmployeeLabelPicker"[\s\S]*Add/);
  assert.match(employeePage, /id="employeeLabelPickerMenu"/);
  assert.doesNotMatch(employeePage, /id="employeesPageTags"[^>]*multiple/);
  assert.match(employeePage, /id="employeeLabelModal"/);
  assert.match(html, /id="page-plan-summary"[\s\S]*id="planSummaryBody"/);
  assert.match(html, /id="page-five-percent-holders"[\s\S]*id="fivePercentHoldersBody"/);
  const monthlyRunPage = html.match(/id="page-monthlyrun"[\s\S]*?<div class="modal-overlay hidden" id="monthlyRunSourceModal"/)?.[0] ?? '';
  assert.match(monthlyRunPage, /来自 Shareworks 的输入表[\s\S]*id="shareworksBody"[\s\S]*来自 Futu 的输入表[\s\S]*id="futuBody"[\s\S]*Previous Capitalization Summary[\s\S]*id="previousCapitalizationSummaryBody"/);
  const shareworksSection = monthlyRunPage.match(/<div class="source-table-title">来自 Shareworks 的输入表<\/div>[\s\S]*?<tbody id="shareworksBody"><\/tbody>/)?.[0] ?? '';
  assert.doesNotMatch(shareworksSection, /Previous Capitalization Summary/);
  assert.match(html, /id="page-fixed-value"[\s\S]*id="fixedValuePageBody"/);
  assert.doesNotMatch(html, /id="page-grant-record"[\s\S]*待接入[\s\S]*id="page-exercise-record"/);
});

test('Grant Record exposes Futu, Shareworks, and Merge tabs with source-specific tables', () => {
  const grantPage = html.match(/id="page-grant-record"[\s\S]*?id="page-exercise-record"/)?.[0] ?? '';

  for (const view of ['futu', 'shareworks', 'merge']) {
    assert.match(grantPage, new RegExp(`data-grant-view="${view}"`));
    assert.match(grantPage, new RegExp(`id="grantPanel-${view}"`));
    assert.match(grantPage, new RegExp(`id="grantTable-${view}"`));
  }

  assert.match(grantPage, /Employee Portal Visibility/);
  assert.doesNotMatch(grantPage, /Cost Center/);
  assert.doesNotMatch(grantPage, /Participant Type @ Report Date/);
  assert.match(grantPage, /Shares Cancelled\/Expired/);
  assert.match(grantPage, /Data Source/);
  assert.match(grantPage, /id="holdingsPageSizeSelect"/);
  assert.match(grantPage, /id="btnHoldingsFirstPage"/);
  assert.match(grantPage, /id="btnHoldingsLastPage"/);
});

test('Exercise to Date exposes file-backed filters, table, and pagination', () => {
  const exercisePage = html.match(/id="page-exercise-record"[\s\S]*?id="page-sold-shares"/)?.[0] ?? '';

  assert.match(exercisePage, /id="searchExercises"/);
  assert.match(exercisePage, /id="filterExerciseGrantYear"/);
  assert.match(exercisePage, /id="exerciseTable"/);
  assert.match(exercisePage, /id="exerciseBody"/);
  assert.match(exercisePage, /Futubull ID/);
  assert.match(exercisePage, /Exercise Cost \(USD\)/);
  assert.match(exercisePage, /Deduction\/Selling Qty\./);
  assert.match(exercisePage, /id="exercisePaginationSummary"/);
  assert.match(exercisePage, /id="exercisePageSizeSelect"/);
  assert.match(exercisePage, /id="btnExercisesFirstPage"/);
  assert.match(exercisePage, /id="btnExercisesPrevPage"/);
  assert.match(exercisePage, /id="btnExercisesNextPage"/);
  assert.match(exercisePage, /id="btnExercisesLastPage"/);
});

test('Sold Shares exposes file-backed filters, nineteen-column table, and pagination', () => {
  const soldSharesPage = html.match(/id="page-sold-shares"[\s\S]*?id="page-transfer-plan"/)?.[0] ?? '';

  assert.match(soldSharesPage, /id="searchSoldShares"/);
  assert.match(soldSharesPage, /id="filterSoldSharesEmploymentStatus"/);
  assert.match(soldSharesPage, /id="soldSharesTable"/);
  assert.match(soldSharesPage, /id="soldSharesBody"/);
  assert.match(soldSharesPage, /Futubull ID/);
  assert.match(soldSharesPage, /Deal Amount \(USD\)/);
  assert.match(soldSharesPage, /Withholding Tax \(CNY\)/);
  assert.match(soldSharesPage, /Cash Net Proceeds \(USD\)/);
  assert.match(soldSharesPage, /id="soldSharesPaginationSummary"/);
  assert.match(soldSharesPage, /id="soldSharesPageSizeSelect"/);
  assert.match(soldSharesPage, /id="btnSoldSharesFirstPage"/);
  assert.match(soldSharesPage, /id="btnSoldSharesPrevPage"/);
  assert.match(soldSharesPage, /id="btnSoldSharesNextPage"/);
  assert.match(soldSharesPage, /id="btnSoldSharesLastPage"/);
});

test('Transfer to Futu exposes file-backed monthly summary, cancellation editing, and workbook actions', () => {
  const transferPage = html.match(/id="page-transfer-plan"[\s\S]*?id="page-employee-management"/)?.[0] ?? '';

  assert.match(transferPage, /2025 BC Subplan Transfer\.xlsx/);
  assert.match(transferPage, /id="transferPlanSummaryTable"/);
  assert.match(transferPage, /id="transferPlanSummaryHead"/);
  assert.match(transferPage, /id="transferPlanSummaryBody"/);
  assert.match(transferPage, /Options cancelled\/forfeited/);
  assert.match(transferPage, /data-transfer-cancelled/);
  assert.doesNotMatch(transferPage, /id="btnImportTransferPlan"/);
  assert.doesNotMatch(transferPage, /id="btnExportTransferPlan"/);
  assert.doesNotMatch(transferPage, /id="transferPlanFileInput"/);
  assert.match(transferPage, /id="btnToggleTransferPlanTableView"[\s\S]*<svg/);
});

test('workflow-backed product pages expose update actions and shared update modal', () => {
  for (const page of [
    'grant-record',
    'exercise-record',
    'sold-shares',
    'transfer-plan',
    'plan-summary',
    'five-percent-holders',
  ]) {
    assert.match(html, new RegExp(`data-workflow-update-page="${page}"`));
    assert.match(html, new RegExp(`data-workflow-export-page="${page}"`));
  }

  assert.match(html, /id="workflowUpdateModal"/);
  assert.match(html, /id="workflowUpdateModalTitle"/);
  assert.match(html, /id="workflowUpdateModalSubtitle"/);
  assert.match(html, /id="workflowUpdateSourceList"/);
  assert.match(html, /id="workflowUpdateStatus"/);
  assert.match(html, /id="btnCancelWorkflowUpdateModal"/);
  assert.match(html, /id="btnConfirmWorkflowUpdate"/);
});

test('workflow update and export actions live in table card headers, not hero file metrics', () => {
  const workflowPages = [
    ['grant-record', 'exercise-record'],
    ['exercise-record', 'sold-shares'],
    ['sold-shares', 'transfer-plan'],
    ['transfer-plan', 'employee-management'],
    ['plan-summary', 'five-percent-holders'],
    ['five-percent-holders', 'fixed-value'],
  ] as const;

  for (const [page, nextPage] of workflowPages) {
    const section = pageSection(page, nextPage);
    const heroMetrics = section.match(/product-page-hero__metrics[\s\S]*?<\/div>\s*<\/div>/)?.[0] ?? '';
    assert.doesNotMatch(heroMetrics, new RegExp(`data-workflow-update-page="${page}"`));
    assert.doesNotMatch(heroMetrics, new RegExp(`data-workflow-export-page="${page}"`));
    assert.match(
      section,
      new RegExp(`(?:card-header-actions product-table-actions|transfer-plan-actions)[\\s\\S]*data-workflow-update-page="${page}"[\\s\\S]*data-workflow-export-page="${page}"`),
    );
  }
});

test('ESOP Detail hero cards link to their corresponding pages', () => {
  const esopDetailPage = pageSection('esop-detail', 'grant-record');
  assert.match(esopDetailPage, /<a class="product-card product-card--link" href="\/grant-record" aria-label="进入授予记录页面">/);
  assert.match(esopDetailPage, /<a class="product-card product-card--link" href="\/exercise-record" aria-label="进入行权记录页面">/);
  assert.match(esopDetailPage, /<a class="product-card product-card--link" href="\/sold-shares" aria-label="进入卖出记录页面">/);
  assert.match(esopDetailPage, /<a class="product-card product-card--link" href="\/transfer-plan" aria-label="进入 2025 年计划页面">/);
});

test('monthly update page keeps create action in the plan table header without month search controls', () => {
  const monthlyPage = pageSection('monthly', 'monthlyrun');
  assert.doesNotMatch(monthlyPage, /id="monthPickerMonthly"/);
  assert.doesNotMatch(monthlyPage, /id="btnSearchMonthly"/);
  assert.match(monthlyPage, /class="card-header"[\s\S]*id="btnAddUpdate"[\s\S]*id="monthlyUpdateTable"/);
});

test('CapTable ownership summary exposes an Update button that links to Monthly Update', () => {
  const captablePage = pageSection('captable', 'monthly');
  const ownershipSummaryCard = captablePage.match(/<div class="card">\s*<div class="card-header">[\s\S]*?股权结构汇总[\s\S]*?<\/div>\s*<\/div>/)?.[0] ?? '';
  assert.match(ownershipSummaryCard, /id="btnOpenMonthlyUpdateFromCapTable"/);
  assert.match(ownershipSummaryCard, /<button class="btn btn-primary btn-sm" id="btnOpenMonthlyUpdateFromCapTable" type="button">[\s\S]*Update[\s\S]*<\/button>/);
  assert.doesNotMatch(ownershipSummaryCard, /data-workflow-update-page=/);
});

test('workflow editor toolbar exposes export alongside execute save and delete', () => {
  const workflowPage = html.slice(html.indexOf('id="page-workflow"'));
  assert.match(workflowPage, /id="btnExecuteWorkflow"/);
  assert.match(workflowPage, /id="btnExportWorkflow"[\s\S]*<svg[\s\S]*?<span>Export<\/span>/);
  assert.match(workflowPage, /id="btnSaveWorkflow"/);
  assert.match(workflowPage, /id="btnDeleteWorkflow"/);
});

test('workflow list cards do not shrink when the list overflows', () => {
  assert.match(css, /\.workflow-list__item\s*\{[\s\S]*flex:\s*0\s+0\s+auto;/);
});

test('settings and docs move to the top bar beside the user avatar as icon buttons', () => {
  const topBar = html.match(/<header class="top-bar">[\s\S]*?<div class="user-info">/)?.[0] ?? '';
  assert.match(topBar, /<div class="top-bar__actions">[\s\S]*data-page="docs"[\s\S]*data-page="settings"/);
  assert.match(topBar, /class="nav-item nav-item--topbar nav-item--topbar-icon-only" data-page="docs"/);
  assert.match(topBar, /class="nav-item nav-item--topbar nav-item--topbar-icon-only" data-page="settings"/);
  assert.doesNotMatch(html, /sidebar-footer/);
  assert.doesNotMatch(html, /nav-item--footer/);
});

test('Docs page removes the duplicate hero and ships bilingual product documentation', () => {
  const docsPage = pageSection('docs', 'captable');
  assert.doesNotMatch(docsPage, /product-page-hero/);
  assert.match(docsPage, /id="docNav"/);
  assert.match(docsPage, /id="docContent"/);
  assert.match(docsPageSource, /const DOC_PAGES_ZH/);
  assert.match(docsPageSource, /const DOC_PAGES_EN/);
  assert.match(docsPageSource, /月度更新与运行/);
  assert.match(docsPageSource, /Monthly Updates and Runs/);
  // The rewrite embeds real screenshots and drops the old "screenshot suggestion" placeholders.
  assert.doesNotMatch(docsPageSource, /截图建议/);
  assert.doesNotMatch(docsPageSource, /Screenshot suggestion/);
  assert.match(docsPageSource, /!\[[^\]]*\]\(\/guide\/[a-z-]+\.png\)/);
  assert.match(docsPageSource, /!\[[^\]]*\]\(\/guide\/en\/[a-z-]+\.png\)/);
});

test('admin-only tools are gated by role and labelled "Admin Only"', () => {
  const mainSource = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');

  // The sidebar section starts hidden (revealed only for admins) and is labelled "Admin Only".
  assert.match(html, /<div class="nav-dev-tools hidden">/);
  assert.match(html, /<div class="nav-section-label">Admin Only<\/div>/);
  assert.doesNotMatch(html, /开发工具/);

  // The localized label renders as 仅管理员 / Admin Only.
  assert.match(mainSource, /devTools:\s*\{\s*'zh-CN':\s*'仅管理员',\s*'en-US':\s*'Admin Only'\s*\}/);

  // Files, Workflow, and User Management stay admin-only pages, hidden from regular users.
  assert.match(mainSource, /adminOnlyPages\s*=\s*new Set<PageKey>\(\['files',\s*'workflow',\s*'user-management'\]\)/);
  assert.match(mainSource, /function applyRoleVisibility\(\)/);

  // The manual filters admin-only doc pages by role.
  assert.match(docsPageSource, /adminOnly:\s*true/);
  assert.match(docsPageSource, /export function visibleDocPages/);
});

test('Files page uses Browser tree view by default with file search control', () => {
  const filesPage = pageSection('files', 'workflow');
  assert.match(filesPage, /<h2[^>]*data-no-static-translate[^>]*>Browser<\/h2>/);
  assert.match(filesPage, /id="filesBrowserSearch"/);
  assert.match(filesPage, /placeholder="搜索文件\.\.\."/);
  assert.match(filesPage, /id="btnCreateProductFile">New<\/button>/);
  assert.match(filesPage, /id="btnRefreshFiles">Refresh<\/button>/);
  assert.match(filesPage, /id="btnUploadProductFile">Upload<\/button>/);
  assert.doesNotMatch(filesPage, /id="btnSaveProductFile"/);
  assert.match(filesPage, /id="btnFilesViewToggle"[\s\S]*id="btnRefreshFiles"[\s\S]*id="btnUploadProductFile"/);
  assert.match(filesPage, /id="btnFilesViewToggle"/);
  assert.doesNotMatch(filesPage, /id="btnFilesViewList"/);
  assert.doesNotMatch(filesPage, /id="btnFilesViewTree"/);
  assert.match(filesPage, /workbook-list__view-switch[\s\S]*btnFilesViewToggle/);
  assert.match(filesPageSource, /workbook-tree__delete/);
});

test('Files Browser list shows a stable right-side scrollbar', () => {
  assert.doesNotMatch(css, /--files-panel-height/);
  assert.match(css, /\.workspace--embedded\s*\{[\s\S]*height:\s*100%;/);
  assert.match(css, /\.workspace--embedded\s*\{[\s\S]*max-height:\s*100%;/);
  assert.match(css, /\.workspace--embedded\s*\{[\s\S]*overflow:\s*hidden;/);
  assert.match(css, /\.workbook-list__items\s*\{[\s\S]*overflow-y:\s*scroll;/);
  assert.match(css, /\.workbook-list__items\s*\{[\s\S]*height:\s*0;/);
  assert.match(css, /\.workbook-item\s*\{[\s\S]*flex:\s*0\s+0\s+auto;/);
  assert.match(css, /\.workbook-tree__file\s*\{[\s\S]*flex:\s*0\s+0\s+auto;/);
  assert.match(css, /\.workbook-list__items::-webkit-scrollbar/);
});

test('Files and Workflow use flex-propagated viewport height instead of fixed viewport offsets', () => {
  assert.match(css, /body\s*\{[\s\S]*height:\s*100dvh;/);
  assert.match(css, /\.app-container\s*\{[\s\S]*height:\s*100dvh;/);
  assert.match(css, /\.main-content\s*\{[\s\S]*height:\s*100dvh;/);
  assert.match(css, /\.page-container:has\(#page-files\.page-section\.active\),\s*\.page-container:has\(#page-workflow\.page-section\.active\)\s*\{[\s\S]*overflow:\s*hidden;/);
  assert.doesNotMatch(css, /--workflow-panel-height/);
  assert.match(css, /\.workflow-page\s*\{[\s\S]*height:\s*100%;/);
  assert.match(css, /\.workflow-sidebar,\s*\.workflow-canvas,\s*\.workflow-inspector\s*\{[\s\S]*height:\s*100%;/);
});

test('workflow sidebar includes a search input matching the Files search control', () => {
  const workflowPage = html.slice(html.indexOf('id="page-workflow"'));
  assert.match(workflowPage, /id="workflowSearchInput"/);
  assert.match(workflowPage, /placeholder="搜索工作流\.\.\."/);
});

test('ResultFile labels are removed from all visible pages', () => {
  for (const [page, nextPage] of [
    ['grant-record', 'exercise-record'],
    ['exercise-record', 'sold-shares'],
    ['sold-shares', 'transfer-plan'],
    ['transfer-plan', 'employee-management'],
    ['plan-summary', 'five-percent-holders'],
    ['five-percent-holders', 'fixed-value'],
    ['captable', 'monthly'],
  ] as const) {
    const section = pageSection(page, nextPage);
    assert.doesNotMatch(section, /ResultFile/);
    assert.doesNotMatch(section, /product-table-result-file/);
    assert.doesNotMatch(section, /data-page-result-file-name/);
  }
});

test('workflow update and export actions include svg icons and stable labels', () => {
  for (const page of [
    'grant-record',
    'exercise-record',
    'sold-shares',
    'transfer-plan',
    'plan-summary',
    'five-percent-holders',
  ]) {
    assert.match(
      html,
      new RegExp(`data-workflow-update-page="${page}"[\\s\\S]*?<svg[\\s\\S]*?<span data-workflow-action-label>Update</span>`),
    );
    assert.match(
      html,
      new RegExp(`data-workflow-export-page="${page}"[\\s\\S]*?<svg[\\s\\S]*?<span data-workflow-action-label>Export</span>`),
    );
  }
});

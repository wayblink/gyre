import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../css/style.css', import.meta.url), 'utf8');
const filesPageSource = readFileSync(new URL('./filesPage.ts', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
const textsSource = readFileSync(new URL('./texts.ts', import.meta.url), 'utf8');
const esopTablesSource = readFileSync(new URL('./esopTables.ts', import.meta.url), 'utf8');
const tableSortSource = readFileSync(new URL('./tableSort.ts', import.meta.url), 'utf8');
const monthlyRunPageSource = readFileSync(new URL('./monthlyRunPage.ts', import.meta.url), 'utf8');
const uploadProgressSource = readFileSync(new URL('./uploadProgress.ts', import.meta.url), 'utf8');
const workbookViewerSource = readFileSync(new URL('./univer/createWorkbookViewer.ts', import.meta.url), 'utf8');
const docsPageSource = readFileSync(new URL('./docsPage.ts', import.meta.url), 'utf8');
const filePickerSource = readFileSync(new URL('./filePickerModal.ts', import.meta.url), 'utf8');
/** The workflow-update modal moved out of main.ts into its own module. */
const workflowUpdateModalSource = readFileSync(new URL('./workflowUpdateModal.ts', import.meta.url), 'utf8');
const grantRecordWorkflow = JSON.parse(
  readFileSync(new URL('../../database/workflows/esop-grant-record-sync.json', import.meta.url), 'utf8'),
) as {
  version: number;
  tasks: Array<{
    id: string;
    params?: { sheetName?: string; headerRow?: number };
    inputs?: Record<string, { guards?: Array<{ type?: string; params?: { expectedColumns?: string } }> }>;
  }>;
  runtimeParamsSchema: { fileRefs: { properties: Record<string, { label?: string }> } };
  runtimeParamsDefaults: { fileRefs: { shareworks_grants: { key: string } } };
};

function pageLabel(page: string): string {
  const match = html.match(
    new RegExp(`<div class="nav-item[^"]*" data-page="${page}"[\\s\\S]*?<span class="nav-text">([^<]+)</span>`),
  );
  return match?.[1]?.trim() ?? '';
}

function pagePosition(page: string): number {
  return html.indexOf(`data-page="${page}"`);
}

function pageSection(page: string, nextPage?: string): string {
  const endPattern = nextPage ? `id="page-${nextPage}"` : '<section class="page-section" id="page-docs">';
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
    'cancellation-record',
    'transfer-plan',
    'employee-management',
    'plan-summary',
    'five-percent-holders',
  ];

  assert.deepEqual(
    expectedPages.map((page) => pageLabel(page)),
    [
      'Captable',
      '月度更新',
      'ESOP Detail',
      'Grant Record',
      'Exercise Record',
      'Sold Shares',
      'Cancellation Records',
      '2025 Transfer to Futu',
      'Employee Management',
      'Plan Summary',
      '5% Holders',
    ],
  );

  const positions = expectedPages.map((page) => pagePosition(page));
  assert.equal(
    positions.every((position) => position >= 0),
    true,
  );
  assert.deepEqual(
    [...positions].sort((a, b) => a - b),
    positions,
  );

  assert.equal(pagePosition('summary'), -1);

  const firstDevTool = Math.min(pagePosition('files'), pagePosition('workflow'));
  assert.equal(
    positions.every((position) => position < firstDevTool),
    true,
  );
});

test('captable is the renamed Summary page and new product pages have matching sections', () => {
  [
    'captable',
    'esop-detail',
    'grant-record',
    'exercise-record',
    'sold-shares',
    'cancellation-record',
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

test('Plan Summary is a month-scoped monthly output page', () => {
  const planSummaryPage = pageSection('plan-summary', 'five-percent-holders');
  assert.match(planSummaryPage, /id="planSummaryMonthPicker"/);
  assert.match(planSummaryPage, /data-page-file-label="result-file"/);
  assert.match(mainSource, /function renderPlanSummaryPage\(month: string\)/);
  assert.match(mainSource, /\/api\/plan-summary\?month=\$\{encodeURIComponent\(month\)\}/);
  assert.match(mainSource, /planSummaryMonthPicker.*addEventListener\('change'/s);
});

test('files page defers workbook mounting until the page is visible', () => {
  assert.match(filesPageSource, /function isFilesPageActive\(\)/);
  assert.match(
    filesPageSource,
    /if \(!isFilesPageActive\(\)\) \{[\s\S]*?selectedProductFileId = targetId;[\s\S]*?return;/,
  );
});

test('capitalization summary shows month-over-month change beside each value', () => {
  const capitalizationHead = html.match(/id="capitalizationTable"[\s\S]*?<\/thead>/)?.[0] ?? '';

  // The change columns share the header of the value they follow, so the table reads as 4 columns.
  assert.match(capitalizationHead, /<th class="col-number" colspan="2">Common Shares Equivalent<\/th>/);
  assert.match(capitalizationHead, /<th class="col-percent" colspan="2">% of fully diluted<\/th>/);

  const captablePageSource = readFileSync(new URL('./captablePage.ts', import.meta.url), 'utf8');
  assert.match(captablePageSource, /computeCapitalizationRowDeltas\(item, findComparableRow\(baselineIndex, item\)\)/);
  assert.match(captablePageSource, /renderCapitalizationDeltaCell\(deltas\.shares\)/);
  assert.match(captablePageSource, /renderCapitalizationDeltaCell\(deltas\.percent\)/);
  assert.match(captablePageSource, /<td class="col-delta cap-delta--flat">–<\/td>/);
  assert.match(captablePageSource, /colspan="5" style="text-align:left;"/);
  assert.match(captablePageSource, /`<tr><td colspan="6" class="table-empty-cell">/);
  assert.match(captablePageSource, /export function createCaptablePage/);

  assert.match(css, /\.cap-delta--up\s*\{\s*color: var\(--success-600\);/);
  assert.match(css, /\.cap-delta--down\s*\{\s*color: var\(--danger-600\);/);
  assert.match(css, /\.cap-delta--flat\s*\{/);
  assert.match(css, /\.col-delta\s*\{/);
});

test('workflow editor picks files through a tree picker that can upload and move files', () => {
  const workflowPageSource = readFileSync(new URL('./workflowPage.ts', import.meta.url), 'utf8');
  const filePickerModalSource = readFileSync(new URL('./filePickerModal.ts', import.meta.url), 'utf8');
  const pickerModal = html.match(/id="workflowFilePickerModal"[\s\S]*?<!-- User Management Page -->/)?.[0] ?? '';

  assert.match(pickerModal, /class="modal-container modal-large workflow-file-picker-modal"/);
  assert.match(pickerModal, /id="workflowFilePickerTree"/);
  assert.match(pickerModal, /id="btnWorkflowFilePickerUpload"/);
  assert.match(pickerModal, /id="btnWorkflowFilePickerMove"/);
  assert.match(pickerModal, /id="workflowFilePickerFolderList"/);
  assert.match(pickerModal, /id="workflowFilePickerNewFolder"/);
  assert.match(pickerModal, /id="btnConfirmWorkflowFilePicker"/);

  // The real select stays in the DOM (hidden) so the existing encode/decode + sync path keeps working.
  const fileRow =
    html.match(
      /id="workflowStructuredFileRow"[\s\S]*?<\/div>\s*<div class="workflow-structured__row" id="workflowStructuredSheetRow"/,
    )?.[0] ?? '';
  assert.match(fileRow, /<select id="workflowPreviewFileId" class="search-input workflow-select hidden">/);
  assert.match(fileRow, /id="workflowPreviewFilePickTrigger"/);

  assert.match(workflowPageSource, /createFilePickerModal\(/);
  // The runtime-parameters panel renders the hidden fileRef control and drives the picker itself.
  const runtimePanelSource = readFileSync(new URL('./workflow/runtimeParamsPanel.ts', import.meta.url), 'utf8');
  assert.match(runtimePanelSource, /data-file-pick-open/);
  assert.match(
    runtimePanelSource,
    /type="hidden" class="workflow-runtime-summary__control"[^`]*data-runtime-default-type="fileRef"/,
  );
  assert.match(runtimePanelSource, /control\.dispatchEvent\(new Event\('change', \{ bubbles: true \}\)\)/);
  assert.match(
    filePickerModalSource,
    /uploadFormDataWithProgress<\{ file: ProductFileRecord \}>\('\/api\/files\/upload'/,
  );
  assert.match(filePickerModalSource, /\/api\/files\/\$\{file\.id\}\/move/);

  assert.match(css, /\.workflow-file-picker__tree\s*\{/);
  assert.match(css, /\.modal-container\.workflow-file-picker-modal\s*\{[\s\S]*height: min\(88vh, 940px\);/);
  assert.match(css, /\.workflow-runtime-summary__filepick-trigger\s*\{/);
  assert.match(
    css,
    /\.workflow-operator-picker-modal,\s*\n\s*\.workflow-file-picker-modal,\s*\n\s*\.file-move-modal\s*\{/,
  );
});

test('files browser can move single files and selections to another folder', () => {
  const filesPageSourceLocal = readFileSync(new URL('./filesPage.ts', import.meta.url), 'utf8');
  const moveDialogSource = readFileSync(new URL('./fileMoveDialog.ts', import.meta.url), 'utf8');
  const moveModal = html.match(/id="fileMoveModal"[\s\S]*?id="workflowFilePickerModal"/)?.[0] ?? '';

  assert.match(moveModal, /id="fileMoveFolderList"/);
  assert.match(moveModal, /id="fileMoveNewFolder"/);
  assert.match(moveModal, /id="btnConfirmFileMoveModal"/);
  assert.match(html, /id="btnMoveSelectedFiles"/);

  assert.match(filesPageSourceLocal, /createFileMoveDialog\(/);
  assert.match(filesPageSourceLocal, /data-move-file-id="\$\{file\.id\}"/);
  assert.match(filesPageSourceLocal, /data-download-file-id="\$\{file\.id\}"/);
  assert.match(filesPageSourceLocal, /workbook-tree__move/);
  assert.match(filesPageSourceLocal, /workbook-tree__download/);
  assert.match(filesPageSourceLocal, /downloadProductFile\(Number\(button\.dataset\.downloadFileId\)\)/);
  assert.match(filesPageSourceLocal, /\/api\/files\/\$\{fileId\}\/content/);
  assert.match(filesPageSourceLocal, /moveProductFiles\(\[\.\.\.selectedProductFileIds\]\)/);
  assert.match(moveDialogSource, /\/api\/files\/\$\{file\.id\}\/move/);

  // The row icons sit side by side instead of stacking on top of each other.
  assert.match(css, /\.workbook-item__delete\s*\{[\s\S]*?right: 8px;/);
  assert.match(css, /\.workbook-item__edit\s*\{[\s\S]*?right: 34px;/);
  assert.match(css, /\.workbook-item__move\s*\{[\s\S]*?right: 60px;/);
  assert.match(css, /\.workbook-item__download\s*\{[\s\S]*?right: 86px;/);
  assert.match(css, /\.workbook-tree__move\s*\{[\s\S]*?right: 34px;/);
  assert.match(css, /\.workbook-tree__download\s*\{[\s\S]*?right: 60px;/);
});

test('moving a product file repoints workflow references stored by logical path', () => {
  const serverSource = readFileSync(new URL('../server/routes/files.ts', import.meta.url), 'utf8');
  assert.match(serverSource, /app\.post\('\/api\/files\/:id\/move'/);
  assert.match(serverSource, /rewriteProductFileKeyInWorkflows\(tx, oldLogicalPath, logicalPath\)/);
  assert.match(serverSource, /code: 'FILE_ALREADY_EXISTS'/);
  assert.match(serverSource, /set tasks_json = \$2::jsonb,\s*\n\s*runtime_params_defaults_json = \$3::jsonb/);
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
  assert.match(
    employeePage,
    /class="card-header"[\s\S]*class="btn btn-warning" id="btnManageEmployeeLabels"[\s\S]*data-workflow-update-page="employee-management"[\s\S]*id="btnAddEmployeesPage"[\s\S]*id="employeesPageTable"/,
  );
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
  const monthlyRunPage =
    html.match(/id="page-monthlyrun"[\s\S]*?<div class="modal-overlay hidden" id="monthlyRunSourceModal"/)?.[0] ?? '';
  // Input Configuration is one flat table: no per-source-group sections or title bars.
  assert.match(monthlyRunPage, /<tbody id="monthlyRunSourcesBody"><\/tbody>/);
  assert.doesNotMatch(monthlyRunPage, /source-table-title/);
  assert.doesNotMatch(monthlyRunPage, /来自 Shareworks 的输入表|来自 Futu 的输入表/);
  assert.doesNotMatch(monthlyRunPage, /id="shareworksBody"|id="futuBody"|id="previousCapitalizationSummaryBody"/);
  assert.equal(monthlyRunPage.match(/<table class="source-table source-table--inputs"/g)?.length, 1);
  assert.doesNotMatch(monthlyRunPage, /bcSubplanTransferOverride|transferDecision/);
  assert.match(monthlyRunPage, /id="monthlyRunInputCard"[\s\S]*id="btnToggleMonthlyRunInput"/);
  assert.match(html, /id="page-fixed-value"[\s\S]*id="fixedValuePageBody"/);
  assert.doesNotMatch(html, /id="page-grant-record"[\s\S]*待接入[\s\S]*id="page-exercise-record"/);
});

test('file uploads use a shared visible progress dialog', () => {
  const sourceActionSection =
    css.match(
      /\/\* ============ 27\. File Action Buttons \(Source Tables\) ============ \*\/[\s\S]*?\/\* ============================================================\s+Link Detail Modal - Table Styles \*\//,
    )?.[0] ?? '';

  assert.match(html, /id="uploadProgressModal"[\s\S]*role="dialog"[\s\S]*id="uploadProgressTitle"/);
  assert.match(html, /id="uploadProgressBar"[^>]*role="progressbar"[^>]*aria-valuemin="0"[^>]*aria-valuemax="100"/);
  assert.match(html, /id="uploadProgressFill"/);
  assert.match(html, /id="uploadProgressPercent"/);
  assert.match(html, /id="uploadProgressStatus"/);
  assert.match(css, /\.upload-progress__track\s*\{[\s\S]*overflow:\s*hidden;/);
  assert.match(css, /\.upload-progress__track--indeterminate \.upload-progress__fill/);
  assert.match(css, /\.source-uploaded-cell\s*\{/);
  assert.match(css, /\.source-file-link__text\s*\{/);
  assert.match(css, /\.source-file-copy\s*\{/);
  assert.doesNotMatch(sourceActionSection, /word-break:\s*break-all;/);

  assert.match(uploadProgressSource, /new XMLHttpRequest\(\)/);
  assert.match(uploadProgressSource, /xhr\.upload\.onprogress/);
  assert.match(filesPageSource, /uploadFormDataWithProgress<\{ file: ProductFileRecord \}>\('\/api\/files\/upload'/);
  assert.match(
    filesPageSource,
    /uploadFormDataWithProgress\(`\/api\/files\/\$\{currentProductFileDetail\.file\.id\}\/content`, form,/,
  );
  assert.match(filePickerSource, /uploadFormDataWithProgress<\{ file: ProductFileRecord \}>\('\/api\/files\/upload'/);
  // The transfer-plan page no longer owns a local file input (its import runs through the shared
  // workflow update modal), so main.ts itself must not grow an ad-hoc upload call site.
  assert.doesNotMatch(mainSource, /uploadFormDataWithProgress/);
  assert.match(
    monthlyRunPageSource,
    /uploadFormDataWithProgress<\{ file: ProductFileRecord \}>\('\/api\/files\/upload'/,
  );
  assert.match(monthlyRunPageSource, /renderUploadedFileCell\(file\)/);
  assert.match(monthlyRunPageSource, /\.source-file-link\[data-source-file-preview\]/);
  assert.match(monthlyRunPageSource, /\.source-file-copy\[data-source-file-copy\]/);
  assert.doesNotMatch(monthlyRunPageSource, /data-business-source-preview/);
  assert.match(monthlyRunPageSource, /openProductFile\(fileId\)/);
});

test('files viewer opens read-only and exposes edit/save/cancel controls', () => {
  const filesPageMarkup = html.match(/<section class="sheet-card">[\s\S]*?<\/section>/)?.[0] ?? '';

  assert.match(filesPageMarkup, /id="filesViewerToolbar"/);
  assert.match(filesPageMarkup, /id="filesViewerModeBadge"/);
  assert.match(filesPageMarkup, /id="btnEditProductFile"/);
  assert.match(filesPageMarkup, /id="btnSaveProductFile"/);
  assert.match(filesPageMarkup, /id="btnCancelProductFileEdit"/);
  assert.match(css, /\.files-viewer-toolbar\s*\{/);

  assert.match(filesPageSource, /readOnly: !productFileEditing/);
  assert.match(filesPageSource, /productFileEditing = false;/);
  assert.match(filesPageSource, /!productFileEditing\) return;/);
  assert.match(workbookViewerSource, /readOnly = false/);
  assert.match(workbookViewerSource, /setReadOnly\(\)/);
});

test('monthly run uploaded time uses the yyyy-MM-dd HH:mm:ss format', () => {
  assert.match(
    monthlyRunPageSource,
    /const day = `\$\{date\.getFullYear\(\)\}-\$\{pad\(date\.getMonth\(\) \+ 1\)\}-\$\{pad\(date\.getDate\(\)\)\}`/,
  );
  assert.match(
    monthlyRunPageSource,
    /\$\{day\} \$\{pad\(date\.getHours\(\)\)\}:\$\{pad\(date\.getMinutes\(\)\)\}:\$\{pad\(date\.getSeconds\(\)\)\}/,
  );
  assert.doesNotMatch(monthlyRunPageSource, /formatCompactTimestamp/);
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
  assert.match(grantPage, /<select id="filterHoldingsTag"/);
  assert.match(grantPage, /id="holdingsPageSizeSelect"/);
  assert.match(grantPage, /id="btnHoldingsFirstPage"/);
  assert.match(grantPage, /id="btnHoldingsLastPage"/);
});

test('Grant Record workflow uses the Shareworks source workbook contract', () => {
  const extract = grantRecordWorkflow.tasks.find((task) => task.id === 'extract_shareworks_grants');
  const project = grantRecordWorkflow.tasks.find((task) => task.id === 'project_shareworks_grants_columns');
  const schemaGuard = project?.inputs?.input1?.guards?.find((guard) => guard.type === 'dataframe.schema.assert');

  assert.equal(grantRecordWorkflow.version, 2);
  assert.equal(extract?.params?.sheetName, 'Personnel Summary (Options OS D');
  assert.equal(extract?.params?.headerRow, 2);
  assert.match(schemaGuard?.params?.expectedColumns ?? '', /Employee Number/);
  assert.match(schemaGuard?.params?.expectedColumns ?? '', /Shares Outstanding/);
  assert.match(
    grantRecordWorkflow.runtimeParamsSchema.fileRefs.properties.shareworks_grants.label ?? '',
    /source workbook/i,
  );
  assert.match(grantRecordWorkflow.runtimeParamsDefaults.fileRefs.shareworks_grants.key, /2026\/06-26\//);
});

test('Grant Record employee tag filter is wired through label ids for every grant source', () => {
  const mainSource = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
  const serverSource = readFileSync(new URL('../server/routes/dataPages.ts', import.meta.url), 'utf8');

  assert.match(html, /id="filterHoldingsTag"/);
  assert.match(mainSource, /renderEmployeeLabelFilter\('filterHoldingsTag'\)/);
  assert.match(esopTablesSource, /filterHoldingsTag'\)\.addEventListener\('change', searchHoldingsPage\)/);
  assert.match(esopTablesSource, /\/api\/grants\/shareworks\?query=.*tagId=/);
  assert.match(esopTablesSource, /\/api\/grants\/merge\?query=.*tagId=/);
  assert.match(esopTablesSource, /\/api\/holdings\?month=.*tagId=/);

  // The label map itself lives in routes/support.ts; every grant source must resolve it.
  const supportSource = readFileSync(new URL('../server/routes/support.ts', import.meta.url), 'utf8');
  assert.match(supportSource, /async function employeeLabelsByNumber\(db: AppDb\)/);
  assert.match(supportSource, /coalesce\(e\.merged_into_id, e\.id\) as canonical_employee_id/);
  for (const apiPath of ['/api/holdings', '/api/grants/shareworks', '/api/grants/merge']) {
    assert.match(serverSource, new RegExp(`app\\.get\\('${apiPath.replace(/\//g, '\\/')}'`));
  }
  assert.match(serverSource, /employeeLabelsByNumber\(db\)/);
  assert.match(serverSource, /labelIdFilter && !row\.labelIds\.includes\(labelIdFilter\)/);
  assert.doesNotMatch(serverSource, /const shareworksRows =\s*normalizedTag === ''/);
});

test('Exercise and Sold Shares employee tag filters are wired through label ids', () => {
  const mainSource = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
  const serverSource = readFileSync(new URL('../server/routes/dataPages.ts', import.meta.url), 'utf8');

  assert.match(html, /id="filterExerciseTag"/);
  assert.match(html, /id="filterSoldSharesTag"/);
  assert.match(mainSource, /renderEmployeeLabelFilter\('filterExerciseTag'\)/);
  assert.match(mainSource, /renderEmployeeLabelFilter\('filterSoldSharesTag'\)/);
  assert.match(esopTablesSource, /filterExerciseTag'\)\.addEventListener\('change', searchExercises\)/);
  assert.match(esopTablesSource, /filterSoldSharesTag'\)\.addEventListener\('change', searchSoldShares\)/);
  assert.match(esopTablesSource, /\/api\/exercises\?query=.*tagId=/);
  assert.match(esopTablesSource, /\/api\/sold-shares\?query=.*tagId=/);

  assert.match(serverSource, /app\.get\('\/api\/exercises'/);
  assert.match(serverSource, /const employeeNumber = textValue\(row\['Employee No\.'\]\) \?\? '';/);
  assert.match(serverSource, /app\.get\('\/api\/sold-shares'/);
  assert.match(serverSource, /const employeeNumber = textValue\(row\['工号'\]\) \?\? '';/);
});

test('Exercise Record exposes file-backed filters, table, and pagination', () => {
  const exercisePage = html.match(/id="page-exercise-record"[\s\S]*?id="page-sold-shares"/)?.[0] ?? '';

  assert.match(exercisePage, /id="searchExercises"/);
  assert.match(exercisePage, /id="filterExerciseTag"/);
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

test('Exercise Record exposes Futu / Shareworks / Merge source tabs like Grant Record', () => {
  const serverSource = readFileSync(new URL('../server/routes/dataPages.ts', import.meta.url), 'utf8');
  const exercisePage = html.match(/id="page-exercise-record"[\s\S]*?id="page-sold-shares"/)?.[0] ?? '';

  // DOM: three sub-tabs + three panels, each with its own table body.
  assert.match(exercisePage, /exercise-view-tabs/);
  assert.match(exercisePage, /data-exercise-view="futu"/);
  assert.match(exercisePage, /data-exercise-view="shareworks"/);
  assert.match(exercisePage, /data-exercise-view="merge"/);
  assert.match(exercisePage, /id="exercisePanel-futu"/);
  assert.match(exercisePage, /id="exercisePanel-shareworks"/);
  assert.match(exercisePage, /id="exercisePanel-merge"/);
  assert.match(exercisePage, /id="exerciseTable"/); // futu panel keeps the existing table
  assert.match(exercisePage, /id="shareworksExerciseBody"/);
  assert.match(exercisePage, /id="mergedExerciseBody"/);
  // Shareworks tab shows the full 22-column Exec Option OS contract.
  assert.match(exercisePage, /Shares Exercised \/ Released/);
  assert.match(exercisePage, /Outstanding Vested\/Exercisable/);
  // Merge tab carries a data-source badge column.
  assert.match(exercisePage, /Data Source/);

  // main.ts: view state, dispatcher, per-view renderers, tab binding.
  assert.match(esopTablesSource, /exerciseView/);
  assert.match(esopTablesSource, /function applyExerciseView\(\)/);
  assert.match(esopTablesSource, /function renderShareworksExercises\(/);
  assert.match(esopTablesSource, /function renderMergedExercises\(/);
  assert.match(esopTablesSource, /data-exercise-view/);
  assert.match(esopTablesSource, /\/api\/exercises\/shareworks\?/);
  assert.match(esopTablesSource, /\/api\/exercises\/merge\?/);
  assert.match(esopTablesSource, /grant-source-badge--\$\{item\.source\.toLowerCase\(\)\}/);

  // server.ts: two new routes + the Shareworks exercise row mapper + name→工号 lookup.
  assert.match(serverSource, /app\.get\('\/api\/exercises\/shareworks'/);
  assert.match(serverSource, /app\.get\('\/api\/exercises\/merge'/);
  assert.match(serverSource, /function shareworksExerciseFromWorkflowRow\(/);
  const employeesSource = readFileSync(new URL('../server/routes/employees.ts', import.meta.url), 'utf8');
  assert.match(employeesSource, /async function employeeNumberByName\(db: RouteContext\['db'\]\)/);
  assert.match(serverSource, /employeeNumberByName\(db\)/);
  assert.match(serverSource, /taskId: 'persist_exercise_record_shareworks_file'/);

  // Workflow definition (DB-owned, exported to seed JSON) carries the Shareworks source + tasks.
  const exerciseSeed = readFileSync(
    new URL('../../database/workflows/esop-exercise-record-sync.json', import.meta.url),
    'utf8',
  );
  assert.match(exerciseSeed, /"shareworks_exercises"/);
  assert.match(exerciseSeed, /"extract_shareworks_exec"/);
  assert.match(exerciseSeed, /"persist_exercise_record_shareworks_file"/);
  assert.match(exerciseSeed, /"Executive Awards OS Only"/);
  assert.match(exerciseSeed, /"sheetName": "行权汇总数据"/);
  assert.match(exerciseSeed, /"id": "project_futu_exercise_summary"/);
  assert.match(exerciseSeed, /\[行权成功数量\]/);
  assert.match(exerciseSeed, /as \[Exercised Qty\]/);
});

test('Sold Shares exposes file-backed filters, nineteen-column table, and pagination', () => {
  const soldSharesPage = html.match(/id="page-sold-shares"[\s\S]*?id="page-transfer-plan"/)?.[0] ?? '';

  assert.match(soldSharesPage, /id="searchSoldShares"/);
  assert.match(soldSharesPage, /id="filterSoldSharesTag"/);
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

test('Sold Shares workflow reads the Futu source workbook summary sheet', () => {
  const soldSharesWorkflow = readFileSync(
    new URL('../../database/workflows/esop-sold-shares-sync.json', import.meta.url),
    'utf8',
  );

  assert.match(soldSharesWorkflow, /"version": 3/);
  assert.match(soldSharesWorkflow, /sheet\.optional-range\.extract/);
  assert.match(soldSharesWorkflow, /"month"/);
  assert.match(soldSharesWorkflow, /"sheetName": "出售汇总数据"/);
  assert.match(soldSharesWorkflow, /Futu employee sold-share source workbook/);
  assert.match(soldSharesWorkflow, /出售汇总数据 Sheet/);
  assert.match(soldSharesWorkflow, /"sourceKey": "futu_sold_shares"/);
});

test('Transfer to Futu exposes file-backed monthly summary, cancellation editing, and workbook actions', () => {
  const transferPage = html.match(/id="page-transfer-plan"[\s\S]*?id="page-employee-management"/)?.[0] ?? '';

  assert.match(transferPage, /2025 BC Subplan Transfer\.xlsx/);
  assert.match(transferPage, /id="transferPlanSummaryTable"/);
  assert.match(transferPage, /id="transferPlanSummaryHead"/);
  assert.match(transferPage, /id="transferPlanSummaryBody"/);
  assert.match(transferPage, /id="btnEditTransferPlan"/);
  assert.match(transferPage, /id="btnSaveTransferPlanEdit"[\s\S]*Confirm &amp; Run/);
  assert.match(transferPage, /id="btnCancelTransferPlanEdit"/);
  assert.match(transferPage, /Options cancelled\/forfeited/);
  assert.match(transferPage, /data-transfer-cancelled/);
  assert.doesNotMatch(transferPage, /id="btnImportTransferPlan"/);
  assert.doesNotMatch(transferPage, /id="btnExportTransferPlan"/);
  assert.doesNotMatch(transferPage, /id="transferPlanFileInput"/);
  assert.match(transferPage, /id="btnToggleTransferPlanTableView"[\s\S]*<svg/);
  assert.match(
    transferPage,
    /id="btnToggleTransferPlanTableView"[\s\S]*<rect x="6" y="3" width="8" height="14" rx="2"/,
  );
  assert.match(transferPage, /id="btnToggleTransferPlanTableView"[\s\S]*v-3\.1h3\.1/);
  // The page controller owns the edit mode and hides the workflow actions while editing.
  const transferPlanPageSource = readFileSync(new URL('./transferPlanPage.ts', import.meta.url), 'utf8');
  assert.match(
    transferPlanPageSource,
    /\[data-workflow-update-page="transfer-plan"\], \[data-workflow-export-page="transfer-plan"\]/,
  );
  assert.match(transferPlanPageSource, /button\.classList\.toggle\('hidden', editMode\)/);
  assert.match(transferPlanPageSource, /export function createTransferPlanPage/);
  assert.match(mainSource, /transferPlanPage\.saveEdit\(\)/);
});

test('workflow-backed product pages expose update actions and shared update modal', () => {
  for (const page of [
    'grant-record',
    'exercise-record',
    'sold-shares',
    'cancellation-record',
    'transfer-plan',
    'five-percent-holders',
  ]) {
    assert.match(html, new RegExp(`data-workflow-update-page="${page}"`));
    assert.match(html, new RegExp(`data-workflow-export-page="${page}"`));
  }
  assert.match(html, /id="page-employee-management"[\s\S]*data-workflow-update-page="employee-management"/);
  assert.doesNotMatch(
    html.match(/id="page-employee-management"[\s\S]*?id="page-plan-summary"/)?.[0] ?? '',
    /data-workflow-export-page="employee-management"/,
  );

  assert.match(html, /id="workflowUpdateModal"/);
  assert.match(html, /id="workflowUpdateModalTitle"/);
  assert.match(html, /id="workflowUpdateModalSubtitle"/);
  assert.match(html, /id="workflowUpdateSourceList"/);
  assert.match(html, /id="workflowUpdateStatus"/);
  assert.match(html, /id="workflowUpdateProgress"/);
  assert.match(
    html,
    /id="workflowUpdateProgressBar"[^>]*role="progressbar"[^>]*aria-valuemin="0"[^>]*aria-valuemax="100"/,
  );
  assert.match(html, /id="btnCancelWorkflowUpdateModal"/);
  assert.match(html, /id="btnConfirmWorkflowUpdate"/);
});

test('workflow update modal picks input files through the shared tree file picker', () => {
  const mainSource = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');

  // main.ts must instantiate the shared tree picker (same component the Files Center / Workflow page use).
  assert.match(mainSource, /createFilePickerModal\(\{/);
  assert.match(mainSource, /import \{ createFilePickerModal \} from ['"]\.\/filePickerModal\.js['"]/);

  // The source card must render a trigger that opens the tree picker, not a native <select>.
  assert.match(workflowUpdateModalSource, /data-workflow-update-file-pick=/);
  assert.doesNotMatch(workflowUpdateModalSource, /data-workflow-update-file-select=/);
  assert.doesNotMatch(workflowUpdateModalSource, /function workflowUpdateFileOptions\(/);

  // Opening the picker and writing the result back into the selection state.
  assert.match(workflowUpdateModalSource, /titleKey: 'fileSourceTitle'/);
  assert.match(workflowUpdateModalSource, /deps\.openFilePicker\(\{/);
  assert.match(
    workflowUpdateModalSource,
    /selectedFiles\[sourceKey\] = result\.action === 'pick' \? result\.fileId : null;/,
  );
  assert.match(workflowUpdateModalSource, /renderSources\(\)/);

  // Sanity: the shared picker really is a folder-grouped, expandable tree.
  assert.match(filePickerSource, /buildProductFilesTree\(/);
  assert.match(filePickerSource, /workbook-tree__dir/);
  assert.match(filePickerSource, /const expandedFolders = new Set<string>\(\)/);
  assert.match(filePickerSource, /!searchQuery && !expandedFolders\.has\(node\.path\)/);
  assert.match(filePickerSource, /expandedFolders\.clear\(\)/);
});

test('workflow update modal gives the sheet input the shared form-control structure', () => {
  const cssSource = readFileSync(new URL('../../css/style.css', import.meta.url), 'utf8');

  assert.match(workflowUpdateModalSource, /workflow-update-source-card__sheet-label/);
  assert.match(workflowUpdateModalSource, /workflow-update-source-card__sheet-input/);
  assert.match(cssSource, /\.workflow-update-source-card__sheet-input\s*\{/);
  assert.match(cssSource, /\.workflow-update-source-card__sheet-input:focus\s*\{/);
});

test('plan summary update modal explains the non-zero Outstanding filter', () => {
  const workflowSource = readFileSync(
    new URL('../../database/workflows/plan-summary-sync.json', import.meta.url),
    'utf8',
  );
  const optionSummarySource = readFileSync(
    new URL('../../database/workflows/option-plans-summary-values.json', import.meta.url),
    'utf8',
  );

  assert.match(textsSource, /only plans with non-zero Outstanding are shown/);
  assert.match(textsSource, /仅显示 Outstanding 不为 0 的计划/);
  assert.match(workflowSource, /having sum\(case when \[key\] = 'Awards Outstanding'/);
  assert.match(workflowSource, /Outstanding 不为 0/);
  assert.match(optionSummarySource, /coalesce\(lookup\.sorting,.*coalesce\(base\.sorting/);
  assert.match(optionSummarySource, /lookup\.\[key\] not in/);
  assert.doesNotMatch(optionSummarySource, /limit 1 offset 1/);
});

test('workflow update modal renders run progress while polling workflow status', () => {
  const cssSource = readFileSync(new URL('../../css/style.css', import.meta.url), 'utf8');

  assert.match(workflowUpdateModalSource, /function renderProgress\(run: WorkflowRunRecord\)/);
  assert.match(workflowUpdateModalSource, /pollRunUntilFinished\(runId, renderProgress\)/);
  assert.match(workflowUpdateModalSource, /function openProgressModal/);
  assert.match(workflowUpdateModalSource, /closeLocked = true;/);
  assert.match(workflowUpdateModalSource, /workflowUpdateProgressFill/);
  assert.match(workflowUpdateModalSource, /reachedStepStatuses/);
  assert.match(cssSource, /\.workflow-update-progress__track/);
  assert.match(cssSource, /\.workflow-update-progress\.is-error/);
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
    if (page === 'plan-summary') {
      assert.match(
        section,
        /card-header-actions product-table-actions[\s\S]*id="btnOpenMonthlyUpdateFromPlanSummary"[\s\S]*data-workflow-export-page="plan-summary"/,
      );
    } else {
      assert.match(
        section,
        new RegExp(
          `(?:card-header-actions product-table-actions|transfer-plan-actions)[\\s\\S]*data-workflow-update-page="${page}"[\\s\\S]*data-workflow-export-page="${page}"`,
        ),
      );
    }
  }

  const employeeSection = pageSection('employee-management', 'plan-summary');
  const employeeHeroMetrics = employeeSection.match(/product-page-hero__metrics[\s\S]*?<\/div>\s*<\/div>/)?.[0] ?? '';
  assert.doesNotMatch(employeeHeroMetrics, /data-workflow-update-page="employee-management"/);
  assert.match(
    employeeSection,
    /card-header-actions employee-management-actions[\s\S]*id="btnManageEmployeeLabels"[\s\S]*data-workflow-update-page="employee-management"[\s\S]*id="btnAddEmployeesPage"/,
  );
});

test('ESOP Detail hero cards link to their corresponding pages', () => {
  const esopDetailPage = pageSection('esop-detail', 'grant-record');
  assert.match(
    esopDetailPage,
    /<a class="product-card product-card--link" href="\/grant-record" aria-label="进入授予记录页面">/,
  );
  assert.match(
    esopDetailPage,
    /<a class="product-card product-card--link" href="\/exercise-record" aria-label="进入行权记录页面">/,
  );
  assert.match(
    esopDetailPage,
    /<a class="product-card product-card--link" href="\/sold-shares" aria-label="进入卖出记录页面">/,
  );
  assert.match(
    esopDetailPage,
    /<a class="product-card product-card--link" href="\/transfer-plan" aria-label="进入 2025 年计划页面">/,
  );
});

test('monthly update page keeps create action in the plan table header without month search controls', () => {
  const monthlyPage = pageSection('monthly', 'monthlyrun');
  assert.doesNotMatch(monthlyPage, /id="monthPickerMonthly"/);
  assert.doesNotMatch(monthlyPage, /id="btnSearchMonthly"/);
  assert.match(monthlyPage, /class="card-header"[\s\S]*id="btnAddUpdate"[\s\S]*id="monthlyUpdateTable"/);
});

test('CapTable ownership summary exposes an Update button that links to Monthly Update', () => {
  const captablePage = pageSection('captable', 'monthly');
  const ownershipSummaryCard =
    captablePage.match(
      /<div class="card">\s*<div class="card-header">[\s\S]*?股权结构汇总[\s\S]*?<\/div>\s*<\/div>/,
    )?.[0] ?? '';
  assert.match(ownershipSummaryCard, /id="btnOpenMonthlyUpdateFromCapTable"/);
  assert.match(
    ownershipSummaryCard,
    /<button class="btn btn-primary btn-sm" id="btnOpenMonthlyUpdateFromCapTable" type="button">[\s\S]*Update[\s\S]*<\/button>/,
  );
  assert.doesNotMatch(ownershipSummaryCard, /data-workflow-update-page=/);
});

test('workflow editor toolbar exposes export alongside execute save and delete', () => {
  const workflowPage = html.slice(html.indexOf('id="page-workflow"'));
  const workflowSource = readFileSync(new URL('./workflowPage.ts', import.meta.url), 'utf8');
  assert.match(workflowPage, /id="btnExecuteWorkflow"/);
  assert.match(workflowPage, /id="btnExportWorkflow"[\s\S]*<svg[\s\S]*?<span>Export<\/span>/);
  assert.match(workflowPage, /id="btnSaveWorkflow"/);
  assert.match(workflowPage, /id="btnDeleteWorkflow"/);
  assert.match(workflowPage, /id="workflowVersionBadge"[\s\S]*aria-label="工作流版本"/);
  assert.match(workflowSource, /v\$\{escapeHtml\(workflow\.version\)\}/);
  assert.match(workflowSource, /workflowVersionBadge\.textContent = workflow \? `v\$\{workflow\.version\}` : '';/);
});

test('workflow task editor exposes a taller SQL editor with normalization controls', () => {
  const sqlFormatSource = readFileSync(new URL('./workflow/sqlFormat.ts', import.meta.url), 'utf8');

  assert.match(html, /id="btnNormalizeWorkflowSql"[\s\S]*规范化 SQL/);
  assert.match(html, /id="workflowSqlInput" class="workflow-code-input workflow-code-input--sql"/);
  assert.match(html, /id="btnNormalizeWorkflowSqlFullscreen"[\s\S]*规范化 SQL/);
  assert.match(css, /\.workflow-code-input--sql\s*\{[\s\S]*min-height:\s*260px;/);
  assert.match(sqlFormatSource, /function formatSqlExpressionList/);
  assert.match(sqlFormatSource, /function splitSqlTopLevelList/);
  assert.match(sqlFormatSource, /function formatSqlCondition/);
});

test('workflow runtime parameter controls are synchronized before save and execute', () => {
  const workflowSource = readFileSync(new URL('./workflowPage.ts', import.meta.url), 'utf8');
  const runtimeDefaultsSource = readFileSync(new URL('./workflow/runtimeDefaults.ts', import.meta.url), 'utf8');

  assert.match(workflowSource, /function syncVisibleRuntimeDefaultsToWorkflow\(workflow: WorkflowDefinition\)/);
  assert.match(
    workflowSource,
    /async function executeWorkflow\(\)[\s\S]*?syncVisibleRuntimeDefaultsToWorkflow\(workflow\);[\s\S]*?persistWorkflowDefinition\(workflow/,
  );
  assert.match(
    workflowSource,
    /async function saveWorkflow\(\)[\s\S]*?workflow\.name = name;[\s\S]*?syncVisibleRuntimeDefaultsToWorkflow\(workflow\);/,
  );
  assert.match(runtimeDefaultsSource, /const sameFile = existing\.key === nextFileKey/);
  assert.match(runtimeDefaultsSource, /\.\.\.\(sameFile \? existing : \{\}\)/);
  assert.match(workflowSource, /expectedUpdatedAt: workflow\.updatedAt/);
  assert.match(workflowSource, /if \(isWorkflowPersisting\) throw new Error\('工作流配置正在保存，请稍候'\)/);
  assert.doesNotMatch(workflowSource, /sanitizeWorkflowFileReferences/);
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

  // The localized label renders as 仅管理员 / Admin Only (in the merged translation table).
  assert.match(textsSource, /devTools:\s*\{\s*'zh-CN':\s*'仅管理员',\s*'en-US':\s*'Admin Only'\s*\}/);

  // Files, Workflow, and User Management stay admin-only pages, hidden from regular users.
  assert.match(mainSource, /adminOnlyPages\s*=\s*new Set<PageKey>\(\['files',\s*'workflow',\s*'user-management'\]\)/);
  assert.match(mainSource, /function applyRoleVisibility\(\)/);

  // The manual filters admin-only doc pages by role.
  assert.match(docsPageSource, /adminOnly:\s*true/);
  assert.match(docsPageSource, /export function visibleDocPages/);
});

test('Global Parameter exposes administrator-only create and delete controls', () => {
  const fixedValuePage = pageSection('fixed-value', 'docs');
  const mainSource = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
  const serverSource = readFileSync(new URL('../server/routes/parameters.ts', import.meta.url), 'utf8');

  assert.match(fixedValuePage, /<h2>Global Parameter<\/h2>/);
  assert.match(fixedValuePage, /<h3 class="card-title">参数<\/h3>/);
  assert.match(fixedValuePage, /<th>参数解释<\/th>/);
  assert.doesNotMatch(fixedValuePage, /<th>Effective From<\/th>/);
  assert.doesNotMatch(fixedValuePage, /id="fixedValueEffectiveFrom"/);
  assert.doesNotMatch(fixedValuePage, /管理员可维护/);
  assert.match(textsSource, /'fixed-value':\s*\{\s*'zh-CN':\s*'全局参数',\s*'en-US':\s*'Global Parameter'\s*\}/);
  assert.match(fixedValuePage, /id="btnAddFixedValue"/);
  assert.match(fixedValuePage, /data-admin-only="true"/);
  // The page owns its own admin gating, create/edit/delete modals and rendering.
  const fixedValuePageSource = readFileSync(new URL('./fixedValuePage.ts', import.meta.url), 'utf8');
  assert.match(fixedValuePageSource, /data-action="delete-fixed-value"/);
  assert.match(fixedValuePageSource, /if \(!deps\.isAdmin\(\)\) return/);
  assert.match(fixedValuePageSource, /method: 'DELETE'/);
  assert.match(fixedValuePageSource, /editingId = null;/);
  // main.ts wires the buttons and the page activation.
  assert.match(mainSource, /fixedValuePage\.render\(\)/);
  assert.match(mainSource, /fixedValuePage\.cancelEdit\(\)/);
  assert.match(mainSource, /if \(page === 'fixed-value'\) \{/);
  assert.match(serverSource, /app\.post\('\/api\/global-parameters'/);
  assert.match(serverSource, /app\.delete\('\/api\/global-parameters\/:id'/);
  assert.match(serverSource, /requireAdminUser\(request as typeof request & RequestWithAuth, reply\)/);
});

test('Files page uses Browser tree view by default with file search control', () => {
  const filesPage = pageSection('files', 'workflow');
  assert.match(filesPage, /<h2[^>]*data-no-static-translate[^>]*>Browser<\/h2>/);
  assert.match(filesPage, /id="filesBrowserSearch"/);
  assert.match(filesPage, /placeholder="搜索文件\.\.\."/);
  assert.match(filesPage, /id="btnCreateProductFile">New<\/button>/);
  assert.match(filesPage, /id="btnRefreshFiles">Refresh<\/button>/);
  assert.match(filesPage, /id="btnUploadProductFile">Upload<\/button>/);
  assert.match(filesPage, /id="filesSelectAll"/);
  assert.match(filesPage, /id="btnDeleteSelectedFiles"/);
  const filesBrowserActions = filesPage.match(/<div class="workbook-list__actions">[\s\S]*?<\/div>/)?.[0] ?? '';
  assert.doesNotMatch(filesBrowserActions, /id="btnSaveProductFile"/);
  assert.match(filesPage, /id="filesViewerToolbar"[\s\S]*id="btnSaveProductFile"/);
  assert.match(filesPage, /id="btnFilesViewToggle"[\s\S]*id="btnRefreshFiles"[\s\S]*id="btnUploadProductFile"/);
  assert.match(filesPage, /id="btnFilesViewToggle"/);
  assert.doesNotMatch(filesPage, /id="btnFilesViewList"/);
  assert.doesNotMatch(filesPage, /id="btnFilesViewTree"/);
  assert.match(filesPage, /workbook-list__view-switch[\s\S]*btnFilesViewToggle/);
  assert.match(filesPageSource, /workbook-tree__delete/);
  assert.match(filesPageSource, /workbook-tree__select/);
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
  assert.match(
    css,
    /\.page-container:has\(#page-files\.page-section\.active\),\s*\.page-container:has\(#page-workflow\.page-section\.active\)\s*\{[\s\S]*overflow:\s*hidden;/,
  );
  assert.doesNotMatch(css, /--workflow-panel-height/);
  assert.match(css, /\.workflow-page\s*\{[\s\S]*height:\s*100%;/);
  assert.match(css, /\.workflow-sidebar,\s*\.workflow-canvas,\s*\.workflow-inspector\s*\{[\s\S]*height:\s*100%;/);
});

test('workflow middle column scrolls runtime params, execution, and canvas with one scrollbar', () => {
  // The middle column owns a single vertical scrollbar instead of clipping its content.
  assert.match(css, /\.workflow-canvas\s*\{[^}]*overflow-y:\s*auto;[^}]*\}/);
  assert.match(css, /\.workflow-canvas\s*\{[^}]*overflow-x:\s*hidden;[^}]*\}/);
  assert.doesNotMatch(css, /\.workflow-canvas\s*\{[^}]*overflow:\s*hidden;[^}]*\}/);
  // Header and execution panel keep their natural height so they scroll instead of compressing.
  assert.match(
    css,
    /\.workflow-canvas > \.workflow-toolbar,\s*\.workflow-canvas > \.workflow-run-panel\s*\{[^}]*flex:\s*0\s+0\s+auto;/,
  );
  // The canvas fills leftover space but never collapses, so it participates in the shared scroll.
  assert.match(css, /\.workflow-dag-shell\s*\{[^}]*flex:\s*1\s+1\s+auto;[^}]*min-height:\s*520px;/);
});

test('workflow sidebar includes a search input matching the Files search control', () => {
  const workflowPage = html.slice(html.indexOf('id="page-workflow"'));
  assert.match(workflowPage, /id="workflowSearchInput"/);
  assert.match(workflowPage, /placeholder="搜索工作流\.\.\."/);
});

test('result file labels are exposed only for monthly output pages', () => {
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
    if (page === 'plan-summary') {
      assert.match(section, /data-page-result-file-name/);
    } else {
      assert.doesNotMatch(section, /ResultFile/);
      assert.doesNotMatch(section, /product-table-result-file/);
      assert.doesNotMatch(section, /data-page-result-file-name/);
    }
  }
});

test('workflow update and export actions include svg icons and stable labels', () => {
  for (const page of ['grant-record', 'exercise-record', 'sold-shares', 'transfer-plan', 'five-percent-holders']) {
    assert.match(
      html,
      new RegExp(
        `data-workflow-update-page="${page}"[\\s\\S]*?<svg[\\s\\S]*?<span data-workflow-action-label>Update</span>`,
      ),
    );
    assert.match(
      html,
      new RegExp(
        `data-workflow-export-page="${page}"[\\s\\S]*?<svg[\\s\\S]*?<span data-workflow-action-label>Export</span>`,
      ),
    );
  }
  assert.match(
    html,
    /data-workflow-update-page="employee-management"[\s\S]*?<svg[\s\S]*?<span data-workflow-action-label>Update<\/span>/,
  );
  assert.match(html, /id="btnManageEmployeeLabels"[\s\S]*?<svg[\s\S]*?<span>标签管理<\/span>/);
  assert.match(html, /id="btnAddEmployeesPage"[\s\S]*?<svg[\s\S]*?<span>New Employee<\/span>/);
});

test('Employee Management update runs the employee data-management workflow and exposes failures', () => {
  const mainSource = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
  const serverSource = readFileSync(new URL('../server/routes/dataPages.ts', import.meta.url), 'utf8');

  assert.match(workflowUpdateModalSource, /'employee-management': 'data-management'/);
  assert.match(workflowUpdateModalSource, /page === 'employee-management' \? 'employee' : page/);
  assert.match(mainSource, /else if \(page === 'employee-management'\) \{\s*await loadEmployeesPage\(\);/);
  assert.match(workflowUpdateModalSource, /statusMessage\('failed', \(error as Error\)\.message\)/);
  const employeesSource2 = readFileSync(new URL('../server/routes/employees.ts', import.meta.url), 'utf8');
  assert.match(employeesSource2, /latestWorkflowInputSourceBindings\(db, 'employee-import'\)/);
  assert.match(serverSource, /workflowSourceBindings: inputSourceBindings/);
});

test('workflow action labels are localized by language state', () => {
  const mainSource = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
  assert.match(textsSource, /update: \{ 'zh-CN': '更新', 'en-US': 'Update' \}/);
  assert.match(textsSource, /confirmAndRun: \{ 'zh-CN': '确认并运行', 'en-US': 'Confirm & Run' \}/);
  assert.match(mainSource, /function syncWorkflowActionLabels\(\)/);
  assert.match(mainSource, /label\.textContent = t\('update'\)/);
  assert.match(mainSource, /label\.textContent = t\('export'\)/);
  // The 5% holders page overrides the generic label while it is in edit mode.
  assert.match(mainSource, /fivePercentHoldersPage\.isEditMode\(\)/);
  assert.match(mainSource, /label\.textContent = t\('confirmAndRun'\);/);
});

test('Employee Management deactivate action uses danger styling', () => {
  const mainSource = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
  assert.match(mainSource, /const toggleButtonClass = item\.active \? 'btn-danger' : 'btn-secondary'/);
  assert.doesNotMatch(mainSource, /btn-warning btn-sm" data-action="toggle-employee-page"/);
});

test('5% Holders edit mode exposes localized Confirm & Run and Cancel actions', () => {
  const mainSource = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
  const holdersSection = pageSection('five-percent-holders', 'fixed-value');
  const holdersPageSource = readFileSync(new URL('./fivePercentHoldersPage.ts', import.meta.url), 'utf8');

  assert.match(holdersSection, /data-workflow-update-page="five-percent-holders"/);
  assert.match(holdersSection, /id="btnCancelFivePercentHoldersEdit"[\s\S]*<span>Cancel<\/span>/);

  // The page owns the edit mode and its button labels.
  assert.match(holdersPageSource, /const text = editMode \? t\('confirmAndRun'\) : t\('update'\)/);
  assert.match(holdersPageSource, /cancel\.classList\.toggle\('hidden', !editMode\)/);
  assert.match(holdersPageSource, /cancel\.textContent = t\('cancel'\)/);
  assert.match(holdersPageSource, /async cancelEdit\(\)/);
  assert.match(holdersPageSource, /editMode = false;\s*await render\(\);/);
  assert.match(holdersPageSource, /if \(saving \|\| !editMode\) return;/);
  // Leaving edit mode discards the drafts rather than persisting them.
  assert.doesNotMatch(holdersPageSource, /cancelEdit[\s\S]{0,200}api\(/);

  // main.ts only wires the button and asks the page whether it is editing.
  assert.match(
    mainSource,
    /btnCancelFivePercentHoldersEdit'\)\.addEventListener\('click', \(\) => void fivePercentHoldersPage\.cancelEdit\(\)\)/,
  );
  assert.match(mainSource, /fivePercentHoldersPage\.isEditMode\(\)/);
});

test('Global Parameter editing uses the application modal instead of a browser prompt', () => {
  const fixedValueSection = pageSection('fixed-value', 'docs');
  const serverSource = readFileSync(new URL('../server/routes/parameters.ts', import.meta.url), 'utf8');

  assert.match(fixedValueSection, /id="fixedValueEditModal"[\s\S]*class="modal-container global-parameter-modal"/);
  assert.match(fixedValueSection, /id="fixedValueEditKey"[^>]*readonly/);
  assert.match(fixedValueSection, /id="fixedValueEditLabel"[^>]*autocomplete="off"/);
  assert.match(fixedValueSection, /id="fixedValueEditValue"[^>]*inputmode="decimal"/);
  assert.doesNotMatch(fixedValueSection, /id="fixedValueEditEffectiveFrom"/);
  assert.match(fixedValueSection, /id="btnSubmitFixedValueEdit"/);
  assert.match(fixedValueSection, /data-close="fixedValueEditModal"/);
  const fixedValuePageSource = readFileSync(new URL('./fixedValuePage.ts', import.meta.url), 'utf8');
  const fixedValueEditSource =
    fixedValuePageSource.match(/async function edit\([\s\S]*?async function submitEdit/)?.[0] ?? '';
  assert.doesNotMatch(fixedValueEditSource, /\bprompt\(/);
  assert.match(fixedValuePageSource, /let editingId: number \| null = null;/);
  assert.match(fixedValuePageSource, /el<HTMLInputElement>\('fixedValueEditKey'\)\.value = item\.key;/);
  assert.match(fixedValuePageSource, /body: JSON\.stringify\(\{ label, value \}\)/);
  assert.match(serverSource, /set label = coalesce\(\$1, label\),[\s\S]*value = \$2/);
  assert.match(serverSource, /updatedByFromRequest\(request as typeof request & RequestWithAuth\)/);
  assert.match(fixedValuePageSource, /el\('fixedValueEditModal'\)\.classList\.remove\('hidden'\)/);
  assert.match(fixedValuePageSource, /async function submitEdit\(\)/);
  assert.match(fixedValuePageSource, /`\/api\/global-parameters\/\$\{editingId\}`/);
  assert.match(
    mainSource,
    /btnSubmitFixedValueEdit'\)\.addEventListener\('click', \(\) => void fixedValuePage\.submitEdit\(\)\)/,
  );
});

test('page size selectors survive language switches because only the label text is translated', () => {
  // Each paginated table keeps its <select> inside the .pagination-size-label element, so
  // writing textContent onto that label deletes the control. Only the inner span may be rewritten.
  // Listed in document order: the cancellation-records section sits before grant-record.
  const sizeSelects = [
    'cancellationPageSizeSelect',
    'holdingsPageSizeSelect',
    'exercisePageSizeSelect',
    'soldSharesPageSizeSelect',
    'employeesPageSizeSelect',
  ];
  const labels = html.match(/<label class="pagination-size-label">[\s\S]*?<\/label>/g) ?? [];
  assert.equal(labels.length, sizeSelects.length);
  labels.forEach((label, index) => {
    assert.match(label, /<span class="pagination-size-label-text">Rows<\/span>/);
    assert.match(label, new RegExp(`id="${sizeSelects[index]}"`));
  });

  assert.match(mainSource, /kind: 'allText', selector: '\.pagination-size-label-text', key: 'rows'/);
  assert.doesNotMatch(mainSource, /selector: '\.pagination-size-label'/);
  assert.doesNotMatch(mainSource, /setAllText\('\.pagination-size-label',/);
  assert.doesNotMatch(mainSource, /setText\('\.pagination-size-label',/);
});

test('pagination summaries are localized and refresh when the language changes', () => {
  // The three ESOP tables live in esopTables.ts; the employee table is still in main.ts.
  for (const name of ['renderHoldingsPagination', 'renderExercisePagination', 'renderSoldSharesPagination']) {
    const body = esopTablesSource.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`))?.[0] ?? '';
    assert.ok(body, `${name} not found`);
    assert.match(body, /paginationSummaryText\(/);
    assert.doesNotMatch(body, /Showing /);
  }
  const employeesBody =
    mainSource.match(new RegExp('function renderEmployeesPagination\\([\\s\\S]*?\\n\\}'))?.[0] ?? '';
  assert.ok(employeesBody, 'renderEmployeesPagination not found');
  assert.match(employeesBody, /paginationSummaryText\(/);
  assert.doesNotMatch(employeesBody, /Showing /);

  assert.match(tableSortSource, /function paginationSummaryText\(/);
  assert.match(textsSource, /paginationSummaryRecords: \{[\s\S]*?条记录/);
  assert.match(textsSource, /paginationSummaryEmployees: \{[\s\S]*?名员工/);

  // A language switch only calls applyLanguage(), so the summaries must be re-rendered there
  // or they keep the previous language until the next data load.
  const applyLanguageBody = mainSource.match(/function applyLanguage\(\)[\s\S]*?\n\}/)?.[0] ?? '';
  assert.match(applyLanguageBody, /renderEmployeesPagination\(/);
  // The three ESOP tables live in esopTables.ts and re-render through their own applyLanguage().
  assert.match(esopTablesSource, /applyLanguage\(\) \{/);
  for (const name of ['renderHoldingsPagination', 'renderExercisePagination', 'renderSoldSharesPagination']) {
    assert.match(esopTablesSource, new RegExp(`${name}\\(`));
  }
});

test('main.ts renders every bilingual string through the translation table', () => {
  const source = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');

  // Inline `currentLanguage === 'zh-CN' ? ... : ...` ternaries bypass the translation table: the
  // string is invisible to translators and to any future i18n tooling. Every bilingual string must
  // go through t()/tp(). The pattern allows whitespace (including newlines) before the `?`, which
  // prettier inserts for nested ternaries — without it a wrapped ternary slips through.
  assert.doesNotMatch(source, /currentLanguage === 'zh-CN'\s*\?/);
  assert.doesNotMatch(source, /currentLanguage === 'en-US'\s*\?/);
  assert.doesNotMatch(source, /lang\(\) === 'zh-CN'\s*\?/);
  assert.doesNotMatch(source, /lang\(\) === 'en-US'\s*\?/);

  // The table stays the single source of truth (now the merged table in texts.ts), and messages
  // carrying a value use tp().
  assert.match(textsSource, /export const TEXTS = \{/);
  assert.match(textsSource, /confirmDeleteUser: \{ 'zh-CN': '确定删除用户【\{username\}】吗？'/);
  assert.match(source, /const t = \(key: UiTextKey\) => texts\(key, currentLanguage\)/);
  // Parameterized messages go through the shared formatter in texts.ts.
  // Interpolated messages go through createTextFormatter() in texts.ts; the pagination summary
  // moved into tableSort.ts and is the only main.ts neighbour that still interpolates a value.
  assert.match(textsSource, /export function createTextFormatter/);
  assert.match(tableSortSource, /createTextFormatter\('main'\)/);
  assert.doesNotMatch(tableSortSource, /\+ start \+/);

  // applyLanguage() is now data-driven: a declarative binding table plus an imperative tail that
  // only handles state-dependent labels, and neither may fall back to inline ternaries.
  const applyLanguage = source.match(/function applyLanguage\(\)[\s\S]*?\n\}/)?.[0] ?? '';
  assert.doesNotMatch(applyLanguage, /=== 'zh-CN'/);
  assert.match(source, /function applyLanguageBindings\(\)/);
  assert.match(source, /\{ kind: 'button', id: 'btnEditTransferPlan', key: 'edit' \}/);
  assert.match(source, /kind: 'allText', selector: '\.pagination-size-label-text', key: 'rows'/);
});

test('Cancellation Records exposes file-backed filters, table, and pagination', () => {
  const cancellationPage = html.match(/id="page-cancellation-record"[\s\S]*?id="page-grant-record"/)?.[0] ?? '';

  assert.match(cancellationPage, /id="searchCancellations"/);
  assert.match(cancellationPage, /id="filterCancellationTag"/);
  assert.match(cancellationPage, /id="filterCancellationEmploymentStatus"/);
  assert.match(cancellationPage, /id="cancellationsTable"/);
  assert.match(cancellationPage, /id="cancellationRecordsBody"/);
  assert.match(cancellationPage, /Grant No\./);
  assert.match(cancellationPage, /Change Type/);
  assert.match(cancellationPage, /Creation No\./);
  assert.match(cancellationPage, /Vesting Rule/);
  assert.match(cancellationPage, /id="cancellationPaginationSummary"/);
  assert.match(cancellationPage, /id="cancellationPageSizeSelect"/);
  assert.match(cancellationPage, /id="btnCancellationsFirstPage"/);
  assert.match(cancellationPage, /id="btnCancellationsPrevPage"/);
  assert.match(cancellationPage, /id="btnCancellationsNextPage"/);
  assert.match(cancellationPage, /id="btnCancellationsLastPage"/);
});

test('Cancellation Records workflow reads the cancel-and-restore detail sheet', () => {
  const cancellationWorkflow = readFileSync(
    new URL('../../database/workflows/esop-cancellation-record-sync.json', import.meta.url),
    'utf8',
  );

  assert.match(cancellationWorkflow, /"code": "esop-cancellation-record-sync"/);
  assert.match(cancellationWorkflow, /"sheetName": "取消与恢复明细"/);
  assert.match(cancellationWorkflow, /"sourceKey": "cancellation_report"/);
  assert.match(cancellationWorkflow, /"folderPrefix": "output\/cancellation-record"/);
  // Three-step shape, same as the other ESOP sync workflows. The extract is the *optional* one so a
  // missing monthly input yields an empty snapshot instead of failing the monthly run.
  assert.match(cancellationWorkflow, /sheet\.optional-range\.extract/);
  assert.match(cancellationWorkflow, /"month"/);
  assert.match(cancellationWorkflow, /"fileNameSuffix"/);
  assert.match(cancellationWorkflow, /sql\.compute/);
  assert.match(cancellationWorkflow, /dataframe\.persist\.excel/);
});

test('Cancellation Records is wired through the ESOP page registry and API', () => {
  const workflowDefinitions = readFileSync(
    new URL('../server/esopWorkflow/workflowDefinitions.ts', import.meta.url),
    'utf8',
  );
  const serverSource = readFileSync(new URL('../server/routes/dataPages.ts', import.meta.url), 'utf8');
  const appSource = readFileSync(new URL('../server/app.ts', import.meta.url), 'utf8');
  const esopTablesSource = readFileSync(new URL('./esopTables.ts', import.meta.url), 'utf8');
  const mainSource = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');

  assert.match(
    workflowDefinitions,
    /'cancellation-record': \{ pageKey: 'cancellation-record', workflowCode: 'esop-cancellation-record-sync' \}/,
  );
  assert.match(serverSource, /'cancellation-record',/);
  assert.match(serverSource, /app\.get\('\/api\/cancellation-records'/);
  assert.match(appSource, /'cancellation-record',/);
  assert.match(esopTablesSource, /\/api\/cancellation-records\?query=.*tagId=/);
  assert.match(esopTablesSource, /filterCancellationTag'\)\.addEventListener\('change', searchCancellations\)/);
  assert.match(mainSource, /esopTables\.renderCancellationRecords\(\)/);
});

test('record pages are month-scoped: snapshot key, picker, and per-month artifact lookup', () => {
  const serverSource = readFileSync(new URL('../server/routes/dataPages.ts', import.meta.url), 'utf8');
  const monthsSource = readFileSync(new URL('../server/routes/months.ts', import.meta.url), 'utf8');
  const serviceSource = readFileSync(new URL('../server/esopWorkflow/service.ts', import.meta.url), 'utf8');
  const modalSource = readFileSync(new URL('./workflowUpdateModal.ts', import.meta.url), 'utf8');
  const esopTablesSource = readFileSync(new URL('./esopTables.ts', import.meta.url), 'utf8');
  const mainSource = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');

  // The run is tagged with the snapshot key and the persist task suffixes the file name with it.
  assert.match(serverSource, /month: z\s*\n\s*\.string\(\)\s*\n\s*\.regex\(\/\^\\d\{4\}-\\d\{2\}\$\/\)/);
  assert.match(serviceSource, /monthUnderscore: month\.replace\('-', '_'\)/);

  // Every record API resolves its artifact for the requested month: exercises (futu), shareworks,
  // the merge view (two artifacts), sold-shares, cancellation — plus the pre-existing plan-summary.
  assert.equal((serverSource.match(/month: requestedMonth \|\| null/g) ?? []).length, 7);

  // Months advertise which pages have a snapshot; an empty snapshot does not count.
  for (const flag of ['hasExerciseData', 'hasSoldSharesData', 'hasCancellationData']) {
    assert.match(monthsSource, new RegExp(`as "${flag}"`));
  }
  assert.equal((monthsSource.match(/file\.workbook_row_count > 0/g) ?? []).length, 3);

  // The UI sends the selected month, and only the month-scoped pages send it on update.
  assert.equal((esopTablesSource.match(/month=\$\{encodeURIComponent\(host\.getMonth\(\)\)\}/g) ?? []).length, 5);
  assert.match(modalSource, /const MONTH_SCOPED_PAGES = new Set<WorkflowUpdatePageKey>\(\[/);
  assert.match(modalSource, /MONTH_SCOPED_PAGES\.has\(page\) \? deps\.getMonth\?\.\(\)/);
  for (const picker of ['exerciseMonthPicker', 'soldSharesMonthPicker', 'cancellationMonthPicker']) {
    assert.match(html, new RegExp(`id="${picker}"`));
    assert.match(mainSource, new RegExp(`pickerId: '${picker}'`));
  }
});

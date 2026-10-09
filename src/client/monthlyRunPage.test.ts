import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  getMonthlyRunFileCandidatesForSource,
  getMonthlyRunModalSourceDefinitions,
  getMonthlyRunSourceSheetControlModel,
  getMonthlyRunVisibleSources,
  getMonthlyRunSheetNameOptions,
  getMonthlyRunWarningTaskIds,
  isRunPanelStaleForMonth,
  MONTHLY_FIXED_VALUE_DEFS,
  MONTHLY_WORKFLOW_VERSION,
  monthlyWorkflowVersionMismatch,
  resolveMonthlyRunPreviewFileId,
  retainAvailableSourceBindings,
} from './monthlyRunPage.js';

const MONTHLY_FIXED_VALUE_KEYS = MONTHLY_FIXED_VALUE_DEFS.map((def) => def.key);

test('monthly source file candidates prefer files matching the configured input source', () => {
  const files = [
    { id: 63, originalName: '02-6-2026_14-55-05_MDT_!Cap_Table_-_Options_OS_Detail_by_Plan_(Pers._Summary_OS_only).xlsx', displayName: '' },
    { id: 61, originalName: '09-7-2026_12-05-18_MDT_Clone_Of_!Gyre_Option_Plans_Summary_SL.xlsx', displayName: '' },
    { id: 64, originalName: '!!Gyre Cap Table 05.31.26【新】.xlsx', displayName: '' },
  ] as const;

  assert.deepEqual(
    getMonthlyRunFileCandidatesForSource('option_plans_summary', files, null).map((file) => file.id),
    [61, 64],
  );
  assert.deepEqual(
    getMonthlyRunFileCandidatesForSource('option_plans_summary', files, 63).map((file) => file.id),
    [61, 64, 63],
  );
});

test('monthly source file candidates keep the current logical file even when its id changed after overwrite', () => {
  const files = [
    { id: 72, originalName: 'shared-workbook.xlsx', displayName: '', logicalPath: 'input/2026-08/shared-workbook.xlsx' },
    { id: 61, originalName: '09-7-2026_12-05-18_MDT_Clone_Of_!Gyre_Option_Plans_Summary_SL.xlsx', displayName: '', logicalPath: 'input/2026-08/options.xlsx' },
  ] as const;

  assert.deepEqual(
    getMonthlyRunFileCandidatesForSource('option_plans_summary', files, 70, 'input/2026-08/shared-workbook.xlsx').map((file) => file.id),
    [61, 72],
  );
});

test('monthly source candidates are limited to the current month input folder', () => {
  const files = [
    { id: 1, originalName: 'EQ Control Book.xlsx', displayName: '', logicalPath: 'input/2026-02/EQ Control Book.xlsx' },
    { id: 2, originalName: 'Control_Books_Detail_Data.xlsx', displayName: '', logicalPath: 'input/2026-02/Control_Books_Detail_Data.xlsx' },
    { id: 3, originalName: 'Control_Books_Detail_Data_prev.xlsx', displayName: '', logicalPath: 'input/2026-01/Control_Books_Detail_Data_prev.xlsx' },
  ] as const;

  // Current month + name-matched only: the historical-month file (id 3) is excluded.
  assert.deepEqual(
    getMonthlyRunFileCandidatesForSource('incremental_control_book', files, null, null, '2026-02').map((file) => file.id),
    [2],
  );
});

test('Control Book Summary candidates come from the control_book folder, not the month input folder', () => {
  const files = [
    { id: 1, originalName: 'EQ_Control_Book_Base_2026_01.xlsx', displayName: '', logicalPath: 'control_book/EQ_Control_Book_Base_2026_01.xlsx' },
    { id: 2, originalName: 'EQ Control Book.xlsx', displayName: '', logicalPath: 'input/2026-02/EQ Control Book.xlsx' },
  ] as const;

  assert.deepEqual(
    getMonthlyRunFileCandidatesForSource('base_control_book', files, null, null, '2026-02').map((file) => file.id),
    [1],
  );
});

test('Base Futu BCI Exercises candidates come from futu_exercises dated archives, not output/ or the month input folder', () => {
  const files = [
    { id: 10, originalName: 'Futu_Exercises_Base.xlsx', displayName: '', logicalPath: 'output/futu-exercises/Futu_Exercises_Base.xlsx' },
    { id: 11, originalName: 'Futu_Exercises_Base_2026_08.xlsx', displayName: '', logicalPath: 'futu_exercises/Futu_Exercises_Base_2026_08.xlsx' },
    { id: 12, originalName: 'Futu_Exercises_Base_2026_09.xlsx', displayName: '', logicalPath: 'futu_exercises/Futu_Exercises_Base_2026_09.xlsx' },
    { id: 13, originalName: 'Control_Books_Detail_Data.xlsx', displayName: '', logicalPath: 'input/2026-09/Control_Books_Detail_Data.xlsx' },
    { id: 14, originalName: 'Gyre Therapeutics员工行权记录.xlsx', displayName: '', logicalPath: 'input/2026-09/Gyre Therapeutics员工行权记录.xlsx' },
  ] as const;

  assert.deepEqual(
    getMonthlyRunFileCandidatesForSource('base_futu_exercises', files, null, null, '2026-09').map((file) => file.id),
    [11, 12],
  );
});

test('monthly source candidates always keep the configured file even from a historical month', () => {
  const files = [
    { id: 2, originalName: 'Control_Books_Detail_Data.xlsx', displayName: '', logicalPath: 'input/2026-02/Control_Books_Detail_Data.xlsx' },
    { id: 9, originalName: 'Control_Books_Detail_Data_prev.xlsx', displayName: '', logicalPath: 'input/2026-01/Control_Books_Detail_Data_prev.xlsx' },
  ] as const;

  assert.deepEqual(
    getMonthlyRunFileCandidatesForSource(
      'incremental_control_book',
      files,
      9,
      'input/2026-01/Control_Books_Detail_Data_prev.xlsx',
      '2026-02',
    ).map((file) => file.id),
    [2, 9],
  );
});

test('monthly source update modal can be scoped to a single input source', () => {
  const sources = [
    { sourceGroup: 'shareworks', sourceKey: 'control_book', taskId: 'extract_control_book', label: 'EQ Control Book', description: '', required: true },
    { sourceGroup: 'shareworks', sourceKey: 'option_plans_summary', taskId: 'extract_option_plans', label: 'Gyre Option Plans Summary SL', description: '', required: true },
  ] as const;

  assert.deepEqual(
    getMonthlyRunModalSourceDefinitions(sources, 'option_plans_summary').map((source) => source.sourceKey),
    ['option_plans_summary'],
  );
  assert.deepEqual(
    getMonthlyRunModalSourceDefinitions(sources).map((source) => source.sourceKey),
    ['control_book', 'option_plans_summary'],
  );
});

test('monthly run page exposes a sheet selector for an overridable configured input source', () => {
  assert.deepEqual(
    getMonthlyRunSourceSheetControlModel({
      allowSheetNameOverride: true,
      binding: { fileId: 64, sheetName: '2025 BC Subplan Transfer' },
      defaultSheetName: 'Vesting Schedule',
      sheets: [
        { sheetName: 'Summary', rowCount: 10, columns: [] },
        { sheetName: '2025 BC Subplan Transfer', rowCount: 30, columns: ['Employee ID'] },
      ],
    }),
    {
      fileId: 64,
      selectedSheetName: '2025 BC Subplan Transfer',
      options: ['Summary', '2025 BC Subplan Transfer'],
    },
  );

  assert.equal(
    getMonthlyRunSourceSheetControlModel({
      allowSheetNameOverride: false,
      binding: { fileId: 64, sheetName: 'Summary' },
      defaultSheetName: null,
      sheets: [],
    }),
    null,
  );
});

test('monthly input bindings survive while the product file list is still loading', () => {
  const bindings = {
    control_book: { fileId: 4 },
    summary_source: { fileId: 4 },
    futu_exercises: { fileId: 4 },
    option_plans_summary: { fileId: 4 },
  };

  assert.deepEqual(retainAvailableSourceBindings(bindings, []), bindings);
});

test('monthly run warning task ids are derived from warning steps', () => {
  assert.deepEqual(
    getMonthlyRunWarningTaskIds({
      steps: [
        { taskId: 'load', status: 'completed' },
        { taskId: 'guard', status: 'warning' },
        { taskId: 'persist', status: 'failed' },
      ] as never,
    }),
    ['guard'],
  );
});

test('monthly run preview prefers the current run file artifact', () => {
  assert.equal(
    resolveMonthlyRunPreviewFileId(
      {
        artifacts: [
          { artifactType: 'json', fileId: 99 },
          { artifactType: 'file', fileId: 12 },
        ] as never,
      },
      { latestOutputFileId: 34 },
    ),
    12,
  );
});

test('monthly run preview falls back to the latest output file', () => {
  assert.equal(resolveMonthlyRunPreviewFileId({ artifacts: [] as never }, { latestOutputFileId: 34 }), 34);
});

test('monthly run preview stays empty when no file is available', () => {
  assert.equal(resolveMonthlyRunPreviewFileId({ artifacts: [] as never }, { latestOutputFileId: null }), null);
});

test('run panel state is dropped once the selected month moves away from the run it belongs to', () => {
  // Nothing held yet: there is no stale state to drop.
  assert.equal(isRunPanelStaleForMonth(null, '2026-03'), false);
  // Same month: the run on screen belongs here.
  assert.equal(isRunPanelStaleForMonth('2026-03', '2026-03'), false);
  // Different month: 2026-02's run must not stay on screen while 2026-03 is selected.
  assert.equal(isRunPanelStaleForMonth('2026-02', '2026-03'), true);
  // Month cleared: nothing is selected, so a month-scoped run cannot belong to it.
  assert.equal(isRunPanelStaleForMonth('2026-02', ''), true);
});

test('monthly run page clears month-scoped run state on month change and on activation', () => {
  const source = readFileSync(new URL('./monthlyRunPage.ts', import.meta.url), 'utf8');

  // The run panel state must be tagged with the month it belongs to.
  assert.match(source, /let activeRunMonth: string \| null = null;/);
  assert.match(source, /function discardRunStateForOtherMonth\(\)/);

  // Switching the month picker must drop the previous month's run and repaint the panel.
  const changeHandler = source.match(/addEventListener\('change', \(\) => \{[\s\S]*?\n {4}\}\);/)?.[0] ?? '';
  assert.match(changeHandler, /discardRunStateForOtherMonth\(\)/);
  assert.match(changeHandler, /renderRunPanel\(\)/);

  // openForMonth()/SPA re-activation go through onActivate, which must drop it before
  // reloading the month-scoped history and then repaint.
  const onActivate = source.match(/async function onActivate\(\)[\s\S]*?\n {2}\}/)?.[0] ?? '';
  assert.match(onActivate, /discardRunStateForOtherMonth\(\)/);
  assert.match(onActivate, /renderRunPanel\(\)/);
  assert.ok(
    onActivate.indexOf('discardRunStateForOtherMonth()') < onActivate.indexOf('refreshHistory()'),
    'run state must be dropped before the history reload renders its selection',
  );

  // An in-flight poll must not repaint another month's panel after the user switches months.
  for (const poll of source.match(/onUpdate: \(run\) => \{[\s\S]*?\n {8}\},/g) ?? []) {
    assert.match(poll, /activeRunMonth !== month/);
  }
});

test('input configuration renders one flat source list: hidden dropped, group ignored, DB order kept', () => {
  // The server already sorts by the DB `order` field and strips it, so the incoming array order
  // is authoritative. The UI must not re-group or re-sort by sourceGroup.
  const sources = [
    { sourceKey: 'base_control_book', sourceGroup: 'shareworks', hidden: false },
    { sourceKey: 'incremental_control_book', sourceGroup: 'shareworks', hidden: false },
    { sourceKey: 'previous_capitalization_summary', sourceGroup: 'shareworks', hidden: true },
    { sourceKey: 'option_plans_summary', sourceGroup: 'shareworks', hidden: false },
    { sourceKey: 'futu_exercises', sourceGroup: 'futu', hidden: false },
    { sourceKey: 'options_os_detail_by_plan', sourceGroup: 'shareworks', hidden: true },
  ] as const;

  assert.deepEqual(getMonthlyRunVisibleSources(sources).map((source) => source.sourceKey), [
    'base_control_book',
    'incremental_control_book',
    'option_plans_summary',
    'futu_exercises',
  ]);
});

test('monthly input rows expose an accessible purpose help icon and bilingual source purpose', () => {
  const source = readFileSync(new URL('./monthlyRunPage.ts', import.meta.url), 'utf8');
  assert.match(source, /data-source-help/);
  assert.match(source, /data-source-help-popover/);
  assert.match(source, /sourcePurposeEnglish/);
  assert.match(source, /fileNameHelpHint/);
  assert.match(source, /requiredHelpHint/);
  assert.match(source, /data-required-help-header-popover/);
});

test('monthly update treats optional sources as non-blocking and explains warning behavior', () => {
  const source = readFileSync(new URL('./monthlyRunPage.ts', import.meta.url), 'utf8');

  // Required checks remain data-driven: an optional source can be absent while required
  // sources still block saving and running.
  assert.match(source, /source\.required && !draftSources\[source\.sourceKey\]\?\.fileId/);
  assert.match(source, /if \(source\.required && !binding\?\.fileId\) return false/);
  assert.match(source, /optionalNotConfigured/);
  assert.match(source, /optionalSourceHint/);
  assert.match(source, /未提供时运行会产生 warning/);
});

test('monthly constants are rendered on the main Monthly Update page and saved row by row', () => {
  const source = readFileSync(new URL('./monthlyRunPage.ts', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const main = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');

  // The host block lives on the Monthly Update page itself, below the source table, so admins
  // can review the 5 monthly constants without opening the source modal.
  assert.match(html, /<div class="card monthly-run-constants-card" id="monthlyRunConstantsBlock">/);
  assert.doesNotMatch(html, /id="monthlyRunSourceConstantsBlock"/);
  assert.match(source, /function renderMonthlyConstants\(\)/);

  // Rendering must happen after the instance is loaded: renderBusinessDefinedInputConfiguration
  // is the shared repaint path (called by refreshInstance once currentInstance is set).
  const render = source.match(/function renderBusinessDefinedInputConfiguration\(\)[\s\S]*?\n  \}/)?.[0] ?? '';
  assert.match(render, /renderMonthlyConstants\(\);/);

  const sourceModal = source.match(/function renderSourceModal\(\)[\s\S]*?\n  \}/)?.[0] ?? '';
  assert.doesNotMatch(sourceModal, /monthlyRunSourceConstantsBlock|data-fixed-value/);

  // All 5 keys get their own input, addressed by data-const-key, prefilled from the instance.
  const block = source.match(/function renderMonthlyConstants\(\)[\s\S]*?\n  \}/)?.[0] ?? '';
  for (const key of MONTHLY_FIXED_VALUE_KEYS) {
    assert.match(block, new RegExp(`data-const-key="\\$\\{escapeHtml\\(def\\.key\\)\\}"`));
  }
  assert.match(block, /MONTHLY_FIXED_VALUE_DEFS\.map\(/);
  assert.match(block, /fv\[def\.key\]/);

  // Constants use the same table treatment as Input Configuration, with a header and per-row actions.
  assert.match(block, /monthly-run-constants__table/);
  assert.match(block, /monthlyConstantName/);
  assert.match(block, /monthlyConstantValue/);
  assert.match(block, /monthlyConstantActions/);
  assert.match(block, /data-constant-edit/);
  assert.match(block, /data-constant-save/);
  assert.match(block, /data-constant-cancel/);
  assert.doesNotMatch(block, /btnSaveMonthlyConstants/);
  assert.match(block, /data-constant-help/);
  assert.match(block, /data-constant-help-popover/);
  assert.match(block, /monthly-run-constants-toggle/);
  assert.match(block, /monthlyConstantsCollapsed/);
  assert.doesNotMatch(block, /monthlyConstantsHint/);
  assert.doesNotMatch(block, /monthly-run-constants__desc/);
  assert.match(block, /card-title monthly-run-constants__title/);
  assert.match(html, /monthly-run-topbar-month/);
  assert.doesNotMatch(main, /\$\{pageTitleFor\('monthly'\)\} \/ \$\{pageTitleFor\('monthlyrun'\)\}/);

  // Each variable carries a bilingual business explanation rendered under it.
  assert.match(block, /def\.description\[lang\(\)\]/);
  assert.match(block, /data-constant-help-popover/);
  for (const def of MONTHLY_FIXED_VALUE_DEFS) {
    assert.ok(def.description['zh-CN'].length > 0, `${def.key} missing zh-CN description`);
    assert.ok(def.description['en-US'].length > 0, `${def.key} missing en-US description`);
  }

  // Each row saves only its own parsed value; blank/non-numeric values are rejected.
  assert.match(block, /Number\.isFinite\(parsed\)/);
  assert.match(block, /saveInstance\(\{ fixedValues: \{ \[key\]: parsed \} \}\)/);

  // Inputs and actions use the same table treatment as the source configuration.
  const stylesheet = readFileSync(new URL('../../css/style.css', import.meta.url), 'utf8');
  assert.match(stylesheet, /\.monthly-run-constants__table-wrap\s*\{/);
  assert.match(stylesheet, /\.monthly-run-constants__actions\s*\{/);
  assert.match(stylesheet, /\.monthly-run-constants__help\s*\{/);
  assert.match(stylesheet, /\.monthly-run-constants-toggle\s*\{/);
  assert.match(stylesheet, /\.monthly-run-constants-card\.is-collapsed \.monthly-run-constants-toggle svg/);
  const inputStyles = stylesheet.match(/\.monthly-run-constants__input\s*\{[\s\S]*?\}/)?.[0] ?? '';
  assert.match(inputStyles, /font-size:\s*var\(--text-md\)/);

  // The UI key set must stay in sync with the server's per-month columns: each camelCase UI key
  // is one monthly_run_instances column, so a drift here would silently drop a constant on save.
  const store = readFileSync(new URL('../server/monthlyRun/instanceStore.ts', import.meta.url), 'utf8');
  const storeKeys = store.match(/const MONTHLY_RUNTIME_FIXED_VALUE_KEYS = \{[\s\S]*?\} as const;/)?.[0] ?? '';
  const storeColumnKeys = [...storeKeys.matchAll(/^\s+\w+: '([a-z0-9_]+)',$/gm)].map((match) => match[1]);
  assert.equal(storeColumnKeys.length, MONTHLY_FIXED_VALUE_KEYS.length);
  // camelCase -> column is not a mechanical transform (gyre2023ChinaSubplanTotal ->
  // gyre_2023_china_subplan_total), so only the set is compared, not the order.
  assert.deepEqual([...storeColumnKeys].sort(), [
    'cullgen_common_stock',
    'gyre_2023_china_subplan_total',
    'options_available_cullgen',
    'options_outstanding_cullgen',
    'warrants_convertible_preferred',
  ]);

  assert.equal(MONTHLY_FIXED_VALUE_DEFS.length, 5);
  assert.equal(MONTHLY_FIXED_VALUE_DEFS.some((definition) => definition.key === 'seriesBPreferredStock'), false);
});

test('monthly page pins the monthly workflow definition version and rejects a mismatch', () => {
  // The definition itself stays in the DB (CLAUDE.md); the page only pins the version it renders
  // inputs for. A DB definition edited without bumping this constant must fail loudly.
  const seed = JSON.parse(readFileSync(
    path.join(process.cwd(), 'database', 'workflows', 'gyre-captable-summary-v2.json'),
    'utf8',
  )) as { version: number };
  assert.equal(MONTHLY_WORKFLOW_VERSION, seed.version);
  assert.ok(MONTHLY_WORKFLOW_VERSION > 0);

  assert.equal(monthlyWorkflowVersionMismatch(MONTHLY_WORKFLOW_VERSION), null);
  assert.equal(monthlyWorkflowVersionMismatch(String(MONTHLY_WORKFLOW_VERSION)), null);
  assert.deepEqual(monthlyWorkflowVersionMismatch(MONTHLY_WORKFLOW_VERSION + 1), {
    expected: MONTHLY_WORKFLOW_VERSION,
    actual: MONTHLY_WORKFLOW_VERSION + 1,
  });
  assert.deepEqual(monthlyWorkflowVersionMismatch(MONTHLY_WORKFLOW_VERSION - 1), {
    expected: MONTHLY_WORKFLOW_VERSION,
    actual: MONTHLY_WORKFLOW_VERSION - 1,
  });
  // A missing/unknown version can never be confirmed to match.
  assert.deepEqual(monthlyWorkflowVersionMismatch(undefined), { expected: MONTHLY_WORKFLOW_VERSION, actual: 0 });
});

test('monthly page blocks rendering and execution while the workflow version is out of sync', () => {
  const source = readFileSync(new URL('./monthlyRunPage.ts', import.meta.url), 'utf8');

  // The API reports the DB definition version; the page compares it against its pinned version.
  const refresh = source.match(/async function refreshSourceConfig\(\)[\s\S]*?\n  \}/)?.[0] ?? '';
  assert.match(refresh, /monthlyWorkflowVersionMismatch\(data\.workflowVersion\)/);
  assert.match(refresh, /sourceDefinitions = workflowVersionMismatch \? \[\] : data\.sources;/);
  assert.match(refresh, /notify\(formatWorkflowVersionMismatch\(workflowVersionMismatch\), \{ type: 'error' \}\)/);

  // No source rows are rendered for a definition this page does not know.
  const rows = source.match(/function renderBusinessDefinedSourceRows\(\)[\s\S]*?\n  \}/)?.[0] ?? '';
  assert.match(rows, /if \(workflowVersionMismatch\) \{/);

  // Execution is blocked instead of running against unknown inputs, and the pinned version is
  // sent along so the server can reject a stale client too.
  const trigger = source.match(/async function triggerMonthlyRun\(\)[\s\S]*?\n  \}/)?.[0] ?? '';
  assert.ok(
    trigger.indexOf('if (workflowVersionMismatch)') < trigger.indexOf("api<MonthlyRunTriggerResponse>('/api/monthly-runs'"),
    'the version guard must run before the run is submitted',
  );
  assert.match(trigger, /expectedWorkflowVersion: MONTHLY_WORKFLOW_VERSION/);

  assert.match(source, /workflowVersionMismatch: \{/);
  assert.match(source, /let workflowVersionMismatch: \{ expected: number; actual: number \} \| null = null;/);
});

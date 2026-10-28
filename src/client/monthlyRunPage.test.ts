import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  MONTHLY_FIXED_VALUE_DEFS,
  MONTHLY_WORKFLOW_VERSION,
  applyDefaultSourceSheets,
  findIncompleteMonthlySource,
  getMonthlyRunFileCandidatesForSource,
  getMonthlyRunModalSourceDefinitions,
  getMonthlyRunSourceSheetControlModel,
  getMonthlyRunVisibleSources,
  getMonthlyRunWarningTaskIds,
  getMonthlyRunReviewActions,
  isMonthlyRunHistoryDeletable,
  isRunExecuting,
  isRunPanelStaleForMonth,
  monthlyRunSourceFolders,
  monthlyWorkflowVersionMismatch,
  parseMonthlyConstantValue,
  resolveMonthlyRunPreviewFileId,
  retainAvailableSourceBindings,
  sourceFileNameBody,
  sourceFileNameTrigger,
  sourcePurposeEnglish,
} from './monthlyRunPage.js';

const MONTHLY_FIXED_VALUE_KEYS = MONTHLY_FIXED_VALUE_DEFS.map((def) => def.key);

test('monthly source file candidates prefer files matching the configured input source', () => {
  const files = [
    {
      id: 63,
      originalName: '02-6-2026_14-55-05_MDT_!Cap_Table_-_Options_OS_Detail_by_Plan_(Pers._Summary_OS_only).xlsx',
      displayName: '',
    },
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
    {
      id: 72,
      originalName: 'shared-workbook.xlsx',
      displayName: '',
      logicalPath: 'input/2026-08/shared-workbook.xlsx',
    },
    {
      id: 61,
      originalName: '09-7-2026_12-05-18_MDT_Clone_Of_!Gyre_Option_Plans_Summary_SL.xlsx',
      displayName: '',
      logicalPath: 'input/2026-08/options.xlsx',
    },
  ] as const;

  assert.deepEqual(
    getMonthlyRunFileCandidatesForSource('option_plans_summary', files, 70, 'input/2026-08/shared-workbook.xlsx').map(
      (file) => file.id,
    ),
    [61, 72],
  );
});

test('monthly source candidates are limited to the current month input folder', () => {
  const files = [
    { id: 1, originalName: 'EQ Control Book.xlsx', displayName: '', logicalPath: 'input/2026-02/EQ Control Book.xlsx' },
    {
      id: 2,
      originalName: 'Control_Books_Detail_Data.xlsx',
      displayName: '',
      logicalPath: 'input/2026-02/Control_Books_Detail_Data.xlsx',
    },
    {
      id: 3,
      originalName: 'Control_Books_Detail_Data_prev.xlsx',
      displayName: '',
      logicalPath: 'input/2026-01/Control_Books_Detail_Data_prev.xlsx',
    },
  ] as const;

  // Current month + name-matched only: the historical-month file (id 3) is excluded.
  assert.deepEqual(
    getMonthlyRunFileCandidatesForSource('incremental_control_book', files, null, null, '2026-02').map(
      (file) => file.id,
    ),
    [2],
  );
});

test('Control Book Summary candidates come from the control_book folder, not the month input folder', () => {
  const files = [
    {
      id: 1,
      originalName: 'EQ_Control_Book_Base_2026_01.xlsx',
      displayName: '',
      logicalPath: 'control_book/EQ_Control_Book_Base_2026_01.xlsx',
    },
    { id: 2, originalName: 'EQ Control Book.xlsx', displayName: '', logicalPath: 'input/2026-02/EQ Control Book.xlsx' },
  ] as const;

  assert.deepEqual(
    getMonthlyRunFileCandidatesForSource('base_control_book', files, null, null, '2026-02').map((file) => file.id),
    [1],
  );
});

test('Base Futu BCI Exercises candidates come from futu_exercises dated archives, not output/ or the month input folder', () => {
  const files = [
    {
      id: 10,
      originalName: 'Futu_Exercises_Base.xlsx',
      displayName: '',
      logicalPath: 'output/futu-exercises/Futu_Exercises_Base.xlsx',
    },
    {
      id: 11,
      originalName: 'Futu_Exercises_Base_2026_08.xlsx',
      displayName: '',
      logicalPath: 'futu_exercises/Futu_Exercises_Base_2026_08.xlsx',
    },
    {
      id: 12,
      originalName: 'Futu_Exercises_Base_2026_09.xlsx',
      displayName: '',
      logicalPath: 'futu_exercises/Futu_Exercises_Base_2026_09.xlsx',
    },
    {
      id: 13,
      originalName: 'Control_Books_Detail_Data.xlsx',
      displayName: '',
      logicalPath: 'input/2026-09/Control_Books_Detail_Data.xlsx',
    },
    {
      id: 14,
      originalName: 'Gyre Therapeutics员工行权记录.xlsx',
      displayName: '',
      logicalPath: 'input/2026-09/Gyre Therapeutics员工行权记录.xlsx',
    },
  ] as const;

  assert.deepEqual(
    getMonthlyRunFileCandidatesForSource('base_futu_exercises', files, null, null, '2026-09').map((file) => file.id),
    [11, 12],
  );
});

test('Cancel & Restore Summary candidates come from the cancel_restore folder, not the month input folder', () => {
  const files = [
    {
      id: 20,
      originalName: 'Gyre_Therapeutics_Cancel_Restore_Base_2026_06.xlsx',
      displayName: '',
      logicalPath: 'cancel_restore/Gyre_Therapeutics_Cancel_Restore_Base_2026_06.xlsx',
    },
    {
      id: 21,
      originalName: 'Gyre Therapeutics取消与恢复报表.xlsx',
      displayName: '',
      logicalPath: 'input/2026-06/Gyre Therapeutics取消与恢复报表.xlsx',
    },
    {
      id: 22,
      originalName: 'Control_Books_Detail_Data.xlsx',
      displayName: '',
      logicalPath: 'input/2026-06/Control_Books_Detail_Data.xlsx',
    },
  ] as const;

  // The raw monthly export (21) must not be offered as the base; only the merged base is.
  assert.deepEqual(
    getMonthlyRunFileCandidatesForSource('base_cancel_restore_report', files, null, null, '2026-06').map(
      (file) => file.id,
    ),
    [20],
  );
});

test('a base source keeps its dedicated folder regardless of the month being viewed', () => {
  assert.deepEqual(monthlyRunSourceFolders('base_cancel_restore_report', '2026-01'), ['cancel_restore/']);
  assert.deepEqual(monthlyRunSourceFolders('base_control_book', '2026-01'), ['control_book/']);
  assert.deepEqual(monthlyRunSourceFolders('base_futu_exercises', '2026-01'), ['futu_exercises/']);
  // Non-base sources stay on the month folder, and an unparseable month leaves them unscoped.
  assert.deepEqual(monthlyRunSourceFolders('incremental_cancel_restore_report', '2026-06'), ['input/2026-06/']);
  assert.deepEqual(monthlyRunSourceFolders('incremental_control_book', 'not-a-month'), []);
});

test('a base picker never reaches into the input/ twin of its dedicated folder', () => {
  // Regression: uploads are normalised under input/, so mis-filed copies pile up there — a raw
  // cancel/restore report at input/cancel_restore/ and duplicate Futu bases at
  // input/futu_exercises/. Neither belongs in a base picker.
  const files = [
    {
      id: 20,
      originalName: 'Gyre_Therapeutics_Cancel_Restore_Base_2026_06.xlsx',
      displayName: '',
      logicalPath: 'cancel_restore/Gyre_Therapeutics_Cancel_Restore_Base_2026_06.xlsx',
    },
    {
      id: 21,
      originalName: 'Gyre Therapeutics取消与恢复报表.xlsx',
      displayName: '',
      logicalPath: 'input/cancel_restore/Gyre Therapeutics取消与恢复报表.xlsx',
    },
    {
      id: 22,
      originalName: 'Gyre Therapeutics取消与恢复报表.xlsx',
      displayName: '',
      logicalPath: 'input/2026-06/Gyre Therapeutics取消与恢复报表.xlsx',
    },
  ] as const;

  assert.deepEqual(
    getMonthlyRunFileCandidatesForSource('base_cancel_restore_report', files, null, null, '2026-06').map(
      (file) => file.id,
    ),
    [20],
  );

  const futuFiles = [
    {
      id: 30,
      originalName: 'Futu_Exercises_Base_2026_06.xlsx',
      displayName: '',
      logicalPath: 'futu_exercises/Futu_Exercises_Base_2026_06.xlsx',
    },
    {
      id: 31,
      originalName: 'Futu_Exercises_Base_2026_06.xlsx',
      displayName: '',
      logicalPath: 'input/futu_exercises/Futu_Exercises_Base_2026_06.xlsx',
    },
  ] as const;

  assert.deepEqual(
    getMonthlyRunFileCandidatesForSource('base_futu_exercises', futuFiles, null, null, '2026-06').map(
      (file) => file.id,
    ),
    [30],
  );
});
test('monthly source candidates always keep the configured file even from a historical month', () => {
  const files = [
    {
      id: 2,
      originalName: 'Control_Books_Detail_Data.xlsx',
      displayName: '',
      logicalPath: 'input/2026-02/Control_Books_Detail_Data.xlsx',
    },
    {
      id: 9,
      originalName: 'Control_Books_Detail_Data_prev.xlsx',
      displayName: '',
      logicalPath: 'input/2026-01/Control_Books_Detail_Data_prev.xlsx',
    },
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
    {
      sourceGroup: 'shareworks',
      sourceKey: 'control_book',
      taskId: 'extract_control_book',
      label: 'EQ Control Book',
      description: '',
      required: true,
    },
    {
      sourceGroup: 'shareworks',
      sourceKey: 'option_plans_summary',
      taskId: 'extract_option_plans',
      label: 'Gyre Option Plans Summary SL',
      description: '',
      required: true,
    },
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

const SHEET_SOURCE = {
  sourceKey: 'incremental_futu_exercises',
  label: 'Futu Exercise Monthly Update',
  required: true,
  allowSheetNameOverride: true,
  defaultSheetName: '行权明细数据',
};

test('applyDefaultSourceSheets backfills the configured default into a sheetless binding', () => {
  assert.deepEqual(
    applyDefaultSourceSheets([SHEET_SOURCE], { incremental_futu_exercises: { fileId: 162, sheetName: null } }),
    { incremental_futu_exercises: { fileId: 162, sheetName: '行权明细数据' } },
  );
  // A sheet the operator picked wins over the default.
  assert.deepEqual(
    applyDefaultSourceSheets([SHEET_SOURCE], {
      incremental_futu_exercises: { fileId: 162, sheetName: '行权汇总数据' },
    }),
    { incremental_futu_exercises: { fileId: 162, sheetName: '行权汇总数据' } },
  );
  // A source with no default is left alone rather than gaining an empty string.
  assert.deepEqual(
    applyDefaultSourceSheets([{ ...SHEET_SOURCE, defaultSheetName: null }], {
      incremental_futu_exercises: { fileId: 162, sheetName: null },
    }),
    { incremental_futu_exercises: { fileId: 162, sheetName: null } },
  );
});

test('findIncompleteMonthlySource names the offending source and what it is missing', () => {
  // The old guard answered with a bare "complete source configuration", which says nothing about
  // which of ten inputs is at fault.
  assert.deepEqual(findIncompleteMonthlySource([SHEET_SOURCE], {}), {
    sourceKey: 'incremental_futu_exercises',
    label: 'Futu Exercise Monthly Update',
    missing: 'file',
  });
  // A source with a configured default never blocks on a missing sheet: the default is the answer.
  assert.equal(
    findIncompleteMonthlySource([SHEET_SOURCE], { incremental_futu_exercises: { fileId: 162, sheetName: null } }),
    null,
  );
  // Only a source with nothing to fall back to needs the operator to pick one.
  assert.deepEqual(
    findIncompleteMonthlySource([{ ...SHEET_SOURCE, defaultSheetName: null }], {
      incremental_futu_exercises: { fileId: 162, sheetName: null },
    }),
    { sourceKey: 'incremental_futu_exercises', label: 'Futu Exercise Monthly Update', missing: 'sheet' },
  );
  // A picked sheet wins over the default.
  assert.equal(
    findIncompleteMonthlySource([SHEET_SOURCE], {
      incremental_futu_exercises: { fileId: 162, sheetName: '行权汇总数据' },
    }),
    null,
  );
  // An unbound optional source is not a blocker.
  assert.equal(findIncompleteMonthlySource([{ ...SHEET_SOURCE, required: false }], {}), null);
});

test('a monthly source with a default sheet is never blocked for lacking one', () => {
  // End-to-end shape of the reported failure: a binding saved before the source declared
  // allowSheetNameOverride, so the run button refused even though the workflow would have run.
  const bindings = applyDefaultSourceSheets([SHEET_SOURCE], {
    incremental_futu_exercises: { fileId: 162, sheetName: null },
  });
  assert.equal(findIncompleteMonthlySource([SHEET_SOURCE], bindings), null);
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

test('the monthly sheet selector preselects the configured default sheet', () => {
  // A freshly bound source has no saved sheet yet, so the selector must show the workflow's own
  // default rather than silently picking the first sheet in the workbook.
  assert.deepEqual(
    getMonthlyRunSourceSheetControlModel({
      allowSheetNameOverride: true,
      binding: { fileId: 64, sheetName: null },
      defaultSheetName: '行权明细数据',
      sheets: [
        { sheetName: '行权汇总数据', rowCount: 10, columns: [] },
        { sheetName: '行权明细数据', rowCount: 30, columns: ['Exercise Order No.'] },
      ],
    }),
    {
      fileId: 64,
      selectedSheetName: '行权明细数据',
      options: ['行权汇总数据', '行权明细数据'],
    },
  );

  // A default that is not in the workbook still shows, so the operator sees what the workflow would
  // have used instead of an unexplained first-sheet selection.
  assert.deepEqual(
    getMonthlyRunSourceSheetControlModel({
      allowSheetNameOverride: true,
      binding: { fileId: 64, sheetName: null },
      defaultSheetName: '27591',
      sheets: [{ sheetName: 'CB Details Sort By Process Date', rowCount: 10, columns: [] }],
    }),
    {
      fileId: 64,
      selectedSheetName: '27591',
      options: ['27591', 'CB Details Sort By Process Date'],
    },
  );

  // No file bound yet: no selector at all.
  assert.equal(
    getMonthlyRunSourceSheetControlModel({
      allowSheetNameOverride: true,
      binding: null,
      defaultSheetName: '行权明细数据',
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

  assert.deepEqual(
    getMonthlyRunVisibleSources(sources).map((source) => source.sourceKey),
    ['base_control_book', 'incremental_control_book', 'option_plans_summary', 'futu_exercises'],
  );
});

test('monthly input rows state requiredness and purpose in one column, without a per-row help icon', () => {
  const source = readFileSync(new URL('./monthlyRunPage.ts', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

  // The "Is required" column became the Notes column carrying badge + purpose together.
  assert.match(html, /data-description-column-label/);
  assert.doesNotMatch(html, /Is required/);
  assert.match(source, /source-description-cell/);
  assert.match(source, /source-purpose/);

  // The purpose text renders inline, and the per-row question mark that used to hide it is gone.
  assert.match(source, /sourcePurposeEnglish/);
  assert.doesNotMatch(source, /data-source-help/);
  assert.doesNotMatch(source, /data-source-help-popover/);

  // The badge legend stays, explaining what Required / Optional · Inherit and friends mean.
  assert.match(source, /requiredHelpHint/);
  assert.match(source, /data-required-help-header-popover/);
});

test('monthly update treats optional sources as non-blocking and explains warning behavior', () => {
  const source = readFileSync(new URL('./monthlyRunPage.ts', import.meta.url), 'utf8');
  // The copy now lives in the merged translation table.
  const texts = readFileSync(new URL('./texts.ts', import.meta.url), 'utf8');

  // Required checks remain data-driven: an optional source can be absent while required
  // sources still block saving and running.
  assert.match(source, /export function findIncompleteMonthlySource</);
  assert.match(source, /if \(source\.required && !binding\?\.fileId\)/);
  // One guard, two callers: the modal's save and the run button must not drift apart.
  // One definition plus the two call sites (modal save, run button).
  assert.equal(source.match(/findIncompleteMonthlySource</g)?.length, 1);
  assert.equal(source.match(/findIncompleteMonthlySource\(/g)?.length, 2);
  assert.match(source, /optionalNotConfigured/);
  assert.match(source, /optionalSourceHint/);
  assert.match(texts, /未提供时运行会产生 warning/);
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
  const render = source.match(/function renderBusinessDefinedInputConfiguration\(\)[\s\S]*?\n {2}\}/)?.[0] ?? '';
  assert.match(render, /renderMonthlyConstants\(\);/);

  const sourceModal = source.match(/function renderSourceModal\(\)[\s\S]*?\n {2}\}/)?.[0] ?? '';
  assert.doesNotMatch(sourceModal, /monthlyRunSourceConstantsBlock|data-fixed-value/);

  // All 5 keys get their own input, addressed by data-const-key, prefilled from the instance.
  const block = source.match(/function renderMonthlyConstants\(\)[\s\S]*?\n {2}\}/)?.[0] ?? '';
  for (const _key of MONTHLY_FIXED_VALUE_KEYS) {
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

  // Each row saves only its own parsed value; blank, non-numeric and 0 are rejected.
  assert.match(block, /parseMonthlyConstantValue\(input\.value\)/);
  assert.match(block, /monthlyConstantInvalid/);
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
  assert.equal(
    MONTHLY_FIXED_VALUE_DEFS.some((definition) => definition.key === 'seriesBPreferredStock'),
    false,
  );
});

test('a monthly constant accepts 0, because 0 is a real value for some months', () => {
  // Cullgen common stock is 0 for every month before the 2026-05 merger; refusing 0 here forced operators
  // to invent a number the business does not have.
  assert.equal(parseMonthlyConstantValue('0'), 0);
  assert.equal(parseMonthlyConstantValue('0.0'), 0);
  assert.equal(parseMonthlyConstantValue('14,450,527'), 14_450_527);
  assert.equal(parseMonthlyConstantValue(' 14450527 '), 14_450_527);
  assert.equal(parseMonthlyConstantValue(''), null);
  assert.equal(parseMonthlyConstantValue('   '), null);
  assert.equal(parseMonthlyConstantValue('-1'), null);
  assert.equal(parseMonthlyConstantValue('abc'), null);
});

test('monthly page pins the monthly workflow definition version and rejects a mismatch', () => {
  // The definition itself stays in the DB (CLAUDE.md); the page only pins the version it renders
  // inputs for. A DB definition edited without bumping this constant must fail loudly.
  const seed = JSON.parse(
    readFileSync(path.join(process.cwd(), 'database', 'workflows', 'gyre-captable-summary-v2.json'), 'utf8'),
  ) as { version: number };
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
  const refresh = source.match(/async function refreshSourceConfig\(\)[\s\S]*?\n {2}\}/)?.[0] ?? '';
  assert.match(refresh, /monthlyWorkflowVersionMismatch\(data\.workflowVersion\)/);
  assert.match(refresh, /sourceDefinitions = workflowVersionMismatch \? \[\] : data\.sources;/);
  assert.match(refresh, /notify\(formatWorkflowVersionMismatch\(workflowVersionMismatch\), \{ type: 'error' \}\)/);

  // No source rows are rendered for a definition this page does not know.
  const rows = source.match(/function renderBusinessDefinedSourceRows\(\)[\s\S]*?\n {2}\}/)?.[0] ?? '';
  assert.match(rows, /if \(workflowVersionMismatch\) \{/);

  // Execution is blocked instead of running against unknown inputs, and the pinned version is
  // sent along so the server can reject a stale client too.
  const trigger = source.match(/async function triggerMonthlyRun\(\)[\s\S]*?\n {2}\}/)?.[0] ?? '';
  assert.ok(
    trigger.indexOf('if (workflowVersionMismatch)') <
      trigger.indexOf("api<MonthlyRunTriggerResponse>('/api/monthly-runs'"),
    'the version guard must run before the run is submitted',
  );
  assert.match(trigger, /expectedWorkflowVersion: MONTHLY_WORKFLOW_VERSION/);

  assert.match(source, /workflowVersionMismatch: \{/);
  assert.match(source, /let workflowVersionMismatch: \{ expected: number; actual: number \} \| null = null;/);
});

test('an input row keeps the file-name pattern collapsed behind an icon until asked for', () => {
  const t = (key: 'fileTemplateLabel') => (key === 'fileTemplateLabel' ? 'File name pattern' : key);
  const source = {
    sourceKey: 'incremental_control_book',
    sourceGroup: 'shareworks' as const,
    taskId: 'invoke_control_book_merge',
    label: 'Control Book Detail update',
    description: 'desc',
    required: true,
    fileTemplate: 'Control_Books_Detail_Data_DD.MM.YYYY_HH.mm.xlsx',
  };

  const trigger = sourceFileNameTrigger(source, t);
  const body = sourceFileNameBody(source, t);

  // Collapsed: only an icon button shows, and it belongs in the badge column.
  assert.match(trigger, /data-source-template-toggle="incremental_control_book"/);
  assert.match(trigger, /<svg/, 'the trigger is an icon, not text');
  assert.match(trigger, /aria-expanded="false"/);
  assert.doesNotMatch(trigger, /source-file-template__pattern/);
  // Still discoverable for screen readers, which cannot click.
  assert.match(trigger, /aria-label="File name pattern: Control_Books_Detail_Data_DD\.MM\.YYYY_HH\.mm\.xlsx"/);

  // The pattern travels with the row so the toggle can reveal it without another request.
  assert.match(body, /class="source-file-template__body hidden"/);
  assert.match(body, /data-source-template-body="incremental_control_book"/);
  assert.match(
    body,
    /<code class="source-file-template__pattern">Control_Books_Detail_Data_DD\.MM\.YYYY_HH\.mm\.xlsx<\/code>/,
  );

  // Sources the system carries over have no template, so nothing is rendered for them: the badge
  // already says the file is inherited and they must not look like something to go and upload.
  assert.equal(sourceFileNameTrigger({ ...source, fileTemplate: undefined }, t), '');
  assert.equal(sourceFileNameBody({ ...source, fileTemplate: undefined }, t), '');
  assert.equal(sourceFileNameTrigger({ ...source, fileTemplate: '   ' }, t), '');
  assert.equal(sourceFileNameBody({ ...source, fileTemplate: '   ' }, t), '');
});

test('every monthly input has an English purpose, so the English UI never falls back to Chinese', () => {
  const workflow = JSON.parse(
    readFileSync(path.join(process.cwd(), 'database/workflows/gyre-captable-summary-v2.json'), 'utf8'),
  ) as { runtimeParamsSchema: { fileRefs: { properties: Record<string, unknown> } } };

  // `sourceDescription` falls back to the DB description, which is Chinese-only, so a source
  // missing from this map silently renders Chinese text in the English UI.
  const missing = Object.keys(workflow.runtimeParamsSchema.fileRefs.properties).filter(
    (sourceKey) => !sourcePurposeEnglish[sourceKey]?.trim(),
  );
  assert.deepEqual(missing, []);
});

test('a run parked waiting for review is deletable; only a genuinely executing run is locked', () => {
  // The server ends a `waiting_approval` run (cancelRun -> skipped) before deleting it, and the
  // operator asking to delete a "需复核" row means "throw this away" — greying the button out left
  // those rows stranded, because the only other endings (继续/跳过) advance the workflow.
  assert.equal(isMonthlyRunHistoryDeletable('waiting_approval'), true);
  assert.equal(isMonthlyRunHistoryDeletable('completed'), true);
  assert.equal(isMonthlyRunHistoryDeletable('completed_with_warnings'), true);
  assert.equal(isMonthlyRunHistoryDeletable('failed'), true);
  assert.equal(isMonthlyRunHistoryDeletable('skipped'), true);
  assert.equal(isMonthlyRunHistoryDeletable('running'), false);
  assert.equal(isMonthlyRunHistoryDeletable('pending'), false);
});

test('review decisions list each pending task once and stay locked while the page is still finishing', () => {
  // The buttons turn visible the moment a poll reports `waiting_approval`, but `isRunning` stays
  // true until the trigger path finished refreshing files/history. A click in that window used to be
  // dropped by `approveActiveRun` with no feedback at all — the panel now renders them disabled.
  const run = {
    approvals: [
      { taskId: 'calc_control_book_metrics', status: 'pending' },
      { taskId: 'calc_control_book_metrics', status: 'pending' },
      { taskId: 'calc_option_metrics', status: 'approved' },
    ],
  } as unknown as Parameters<typeof getMonthlyRunReviewActions>[0];

  assert.deepEqual(getMonthlyRunReviewActions(run, false), {
    pendingTaskIds: ['calc_control_book_metrics'],
    isSubmitting: false,
  });
  assert.deepEqual(getMonthlyRunReviewActions(run, true), {
    pendingTaskIds: ['calc_control_book_metrics'],
    isSubmitting: true,
  });
  assert.deepEqual(getMonthlyRunReviewActions(null, false), { pendingTaskIds: [], isSubmitting: false });
});

test('the review decision sits on the waiting task row, not only at the bottom of a long task list', () => {
  const source = readFileSync(new URL('./monthlyRunPage.ts', import.meta.url), 'utf8');
  const texts = readFileSync(new URL('./texts.ts', import.meta.url), 'utf8');

  // A "需复核" row must offer the decision itself: with 20+ nodes the footer buttons are off-screen.
  assert.match(source, /data-review-decision="approved"/);
  assert.match(source, /data-review-decision="skipped"/);

  // Only an in-flight submit disables the buttons, and it says so instead of swallowing the click.
  assert.match(source, /continueButton\.disabled = review\.isSubmitting/);
  assert.match(source, /skipButton\.disabled = review\.isSubmitting/);
  assert.match(texts, /reviewSubmitting/);
  assert.match(texts, /reviewAndContinue/);
});

test('a human approval is never gated by the page’s own background work', () => {
  // The buttons turn visible the moment a poll reports `waiting_approval`, which can happen while
  // `triggerMonthlyRun` is still refreshing files/history/plan status. Gating the decision on that
  // `isRunning` flag made the click a no-op ("复核 = 人工通过，为什么点不动"), so the only thing the
  // buttons may wait on is the approval POST itself.
  const source = readFileSync(new URL('./monthlyRunPage.ts', import.meta.url), 'utf8');

  assert.match(source, /let isSubmittingReview = false;/);
  assert.match(source, /continueButton\.disabled = review\.isSubmitting;/);
  assert.match(source, /skipButton\.disabled = review\.isSubmitting;/);
  // approveActiveRun must not consult the run-polling flag when deciding whether to send.
  const approve = source.match(/async function approveActiveRun\([\s\S]*?\n {2}\}\n/)?.[0] ?? '';
  assert.doesNotMatch(approve, /if \(isRunning\)/);
  assert.match(approve, /getMonthlyRunReviewActions\(activeRun, isSubmittingReview\)/);
});

test('a failed background refresh cannot strand the panel in its disabled state', () => {
  // `finally { isRunning = false; await refreshHistory(); ... renderRunPanel(); }` painted the DOM
  // only after two more network calls: one 401/500/网络抖动 and the last rendered state (buttons
  // disabled, "正在收尾上一步") stayed on screen forever, because polling had already stopped.
  const source = readFileSync(new URL('./monthlyRunPage.ts', import.meta.url), 'utf8');

  const finallyBlock = source
    .match(/async function triggerMonthlyRun\([\s\S]*?\n {2}\}\n/)![0]
    .match(/\} finally \{[\s\S]*?\n {4}\}/)![0];
  const renderIndex = finallyBlock.indexOf('renderRunPanel(');
  const awaitIndex = finallyBlock.indexOf('await ');
  assert.ok(renderIndex > -1, 'the finally block must repaint the panel');
  assert.ok(awaitIndex === -1 || renderIndex < awaitIndex, 'repaint before any await');

  // Background refreshes are best-effort: a rejection is reported, never swallowed into a stale DOM.
  const refresh = source.match(/async function refreshAfterRun\([\s\S]*?\n {2}\}\n/)?.[0] ?? '';
  assert.match(refresh, /try \{/);
  assert.match(refresh, /refreshHistory\(\)/);
  assert.match(refresh, /catch/);
  assert.match(source, /await refreshAfterRun\(/);

  // And the same for the approval path: the panel is repainted as soon as the decision is accepted.
  const approve = source.match(/async function approveActiveRun\([\s\S]*?\n {2}\}\n/)?.[0] ?? '';
  const approveRender = approve.indexOf('isSubmittingReview = false;');
  assert.ok(approveRender > -1, 'the approval path must clear the submit lock explicitly');
  assert.match(approve, /await refreshAfterRun\(/);
});

test('the panel keeps following a live run instead of freezing until a reload', () => {
  // Without a follower the panel only moved when *it* started the run or owned a poll loop. A run
  // parked in `waiting_approval` has neither, so a decision taken in another tab (or a poll that died
  // on one bad request) left an old frame on screen and the operator had to reload to see the truth.
  const source = readFileSync(new URL('./monthlyRunPage.ts', import.meta.url), 'utf8');
  const texts = readFileSync(new URL('./texts.ts', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

  const follow = source.match(/function followRun\([\s\S]*?\n {2}\}\n/)?.[0] ?? '';
  assert.match(follow, /isRunExecuting\(fresh\)/);
  assert.match(follow, /followingRuns\.get\(runId\)/, 'one follower per run, not one per render');
  // A transient request failure must not end the follow: keep trying instead of giving up.
  assert.match(follow, /catch \{\s*\n\s*continue;/);
  assert.match(source, /void followRun\(run\.id\);/, 'opening the panel starts following it');

  // A run parked **with a pending approval** has nothing to poll for (only a human moves it), so the
  // panel waits for the tab to come back instead of leaving a timer running for hours.
  const runWith = (status: string, approvals: Array<{ status: string }>) =>
    ({ status, approvals }) as unknown as Parameters<typeof isRunExecuting>[0];
  assert.equal(isRunExecuting(runWith('waiting_approval', [{ status: 'pending' }])), false);
  // But once the decision is made the run is being resumed, and a transient `waiting_approval` frame
  // must not stop the panel — that is how it used to freeze at "12 / 23 需复核" until a reload.
  assert.equal(isRunExecuting(runWith('waiting_approval', [{ status: 'approved' }])), true);
  assert.equal(isRunExecuting(runWith('waiting_approval', [])), true);
  assert.equal(isRunExecuting(runWith('running', [])), true);
  assert.equal(isRunExecuting(runWith('completed', [])), false);
  assert.equal(isRunExecuting(runWith('completed_with_warnings', [])), false);
  assert.equal(isRunExecuting(runWith('failed', [])), false);
  assert.match(source, /addEventListener\('visibilitychange'/);
  assert.match(source, /window\.addEventListener\('focus'/);

  // The operator must never be told to refresh a state the page can follow itself.
  assert.doesNotMatch(texts, /刷新运行状态失败/);
  assert.doesNotMatch(texts, /请刷新|点击刷新|use Refresh/i);
  assert.doesNotMatch(html, /btnMonthlyRunRefreshRun/);

  // Background refreshes retry silently instead of surfacing a "please retry" prompt.
  const refresh = source.match(/async function refreshAfterRun\(\)[\s\S]*?\n {2}\}\n/)?.[0] ?? '';
  assert.match(refresh, /catch \{/);
  assert.match(refresh, /attempt/);
  assert.doesNotMatch(refresh, /notify\(/);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getMonthlyRunFileCandidatesForSource,
  getMonthlyRunModalSourceDefinitions,
  getBcSubplanCancelledAdjustmentInfo,
  getMonthlyRunSourceSheetControlModel,
  getMonthlyRunSheetNameOptions,
  getMonthlyRunWarningTaskIds,
  resolveMonthlyRunPreviewFileId,
  retainAvailableSourceBindings,
} from './monthlyRunPage.js';

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
  assert.deepEqual(
    getMonthlyRunFileCandidatesForSource('bc_subplan_transfer', files, null).map((file) => file.id),
    [63, 61, 64],
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

test('monthly source update modal can be scoped to a single input source', () => {
  const sources = [
    { sourceGroup: 'shareworks', sourceKey: 'control_book', taskId: 'extract_control_book', label: 'EQ Control Book', description: '', required: true },
    { sourceGroup: 'shareworks', sourceKey: 'option_plans_summary', taskId: 'extract_option_plans', label: 'Gyre Option Plans Summary SL', description: '', required: true },
    { sourceGroup: 'shareworks', sourceKey: 'bc_subplan_transfer', taskId: 'extract_bc_subplan_transfer', label: '2025 BC Subplan Transfer', description: '', required: true },
  ] as const;

  assert.deepEqual(
    getMonthlyRunModalSourceDefinitions(sources, 'option_plans_summary').map((source) => source.sourceKey),
    ['option_plans_summary'],
  );
  assert.deepEqual(
    getMonthlyRunModalSourceDefinitions(sources).map((source) => source.sourceKey),
    ['control_book', 'option_plans_summary', 'bc_subplan_transfer'],
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

test('monthly run sheet override options come from the selected workbook sheets', () => {
  assert.deepEqual(
    getMonthlyRunSheetNameOptions({
      bindingSheetName: '2025 BC Subplan Transfer',
      defaultSheetName: 'Vesting Schedule',
      sheets: [
        { sheetName: 'Summary', rowCount: 10, columns: [] },
        { sheetName: '2025 BC Subplan Transfer', rowCount: 30, columns: ['行标签', '总计'] },
      ],
    }),
    {
      selectedSheetName: '2025 BC Subplan Transfer',
      options: ['Summary', '2025 BC Subplan Transfer'],
    },
  );
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

test('monthly run detects BC Subplan cancelled adjustment info from option metrics output', () => {
  const info = getBcSubplanCancelledAdjustmentInfo({
    id: 42,
    steps: [
      {
        taskId: 'calc_option_metrics',
        status: 'completed',
        result: {
          kind: 'dataframe',
          dataFrame: {
            columns: ['total_options_outstanding', 'bc_subplan_cancelled_adjustment'],
            rows: [{ total_options_outstanding: 14_386_058, bc_subplan_cancelled_adjustment: 28_170 }],
            index: [0],
            matrix: [[14_386_058, 28_170]],
            range: { sheetName: 'Calc Option Plan Metrics', a1Range: 'A1:B2' },
          },
        },
      },
    ] as never,
  });

  assert.equal(info?.key, '42:calc_option_metrics:bc-subplan-cancelled-adjustment');
  assert.match(info?.message ?? '', /GYRE 2025 BC Subplan 的 Cancelled 为 0/);
  assert.match(info?.message ?? '', /2025 BC Subplan Transfer/);
});

test('monthly run does not show BC Subplan adjustment info when no transfer adjustment is used', () => {
  assert.equal(
    getBcSubplanCancelledAdjustmentInfo({
      id: 42,
      steps: [
        {
          taskId: 'calc_option_metrics',
          status: 'completed',
          result: {
            kind: 'dataframe',
            dataFrame: {
              columns: ['bc_subplan_cancelled_adjustment'],
              rows: [{ bc_subplan_cancelled_adjustment: 0 }],
              index: [0],
              matrix: [[0]],
              range: { sheetName: 'Calc Option Plan Metrics', a1Range: 'A1:A2' },
            },
          },
        },
      ] as never,
    }),
    null,
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

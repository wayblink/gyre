import assert from 'node:assert/strict';
import test from 'node:test';
import { rowsToDataFrame } from '../excel.js';
import { dataframePersistExcelOperator } from '../workflow/operators/dataframePersistExcel.js';
import { executeSqlDataFrameQuery } from '../workflow/operators/sqlUtils.js';
import {
  buildMonthlyCapitalizationSummarySql,
  buildMonthlyRuntimeParameters,
  buildMonthlyWorkflowSeedDefinition,
  buildMonthlyWorkflowTasks,
  MONTHLY_RUNTIME_OPTIONS_AVAILABLE_CULLGEN,
  MONTHLY_RUNTIME_OPTIONS_OUTSTANDING_CULLGEN,
  MONTHLY_SUMMARY_COLUMNS,
  MONTHLY_SUMMARY_TOTAL_FULLY_DILUTED,
} from './workflowDefinition.js';
import { resolveWorkflowRuntimeConfiguration } from '../workflow/runtimeParameters.js';

const metricFrames = {
  control_metrics: rowsToDataFrame(
    [
      {
        eom_eq_balance_os: 111_488_849,
        bc_subplan_transfer_control_book: 695_165,
      },
    ],
    { sheetName: 'control_metrics', a1Range: '' },
  ),
  futu_metrics: rowsToDataFrame(
    [
      {
        futu_exercised_qty: 2_938_523,
        bci_shares_held_by_futu: 4_876_873,
      },
    ],
    { sheetName: 'futu_metrics', a1Range: '' },
  ),
  option_metrics: rowsToDataFrame(
    [
      {
        total_options_available: 3_639_230,
        total_options_outstanding: 14_386_058,
      },
    ],
    { sheetName: 'option_metrics', a1Range: '' },
  ),
  business_inputs: rowsToDataFrame(
    [
      {
        eom_eq_balance_os: 111_488_849,
        cullgen_common_stock: 14_450_527,
        gyre_2023_china_subplan_total: 7_815_396,
        bc_subplan_transfer_summary: 695_164,
        warrants_for_convertible_preferred_stock: 540_666,
        options_outstanding_cullgen: 4_156_815,
        options_available_cullgen: 10_994,
        total_fully_diluted: 133_527_448,
      },
    ],
    { sheetName: 'business_inputs', a1Range: '' },
  ),
};

test('monthly capitalization summary workflow SQL matches expected workbook structure', async () => {
  const task = buildMonthlyWorkflowTasks().find((item) => item.id === 'build_capitalization_summary');
  assert.ok(task);

  const result = await executeSqlDataFrameQuery(task, { rowsToDataFrame } as never, async (slot) => {
    const frame = metricFrames[slot as keyof typeof metricFrames];
    if (!frame) throw new Error(`Unexpected input slot ${slot}`);
    return frame;
  });

  assert.deepEqual(result.dataFrame.columns, MONTHLY_SUMMARY_COLUMNS);
  assert.equal(result.dataFrame.columns.includes('Formula'), false);
  assert.equal(result.dataFrame.rows.length, 13);

  assert.deepEqual(
    result.dataFrame.rows.map((row) => row.Description),
    [
      'Issued Shares -Equity Asset Class',
      'Asset Class Summary: EOM',
      'Common Shares OS',
      'Cullgen common stock',
      'BCI Shares Held by Futu',
      '2025 BC Subplan shares transferred to Futu',
      'Derivative Equity Incentives',
      'Warrants for Convertible Preferred Stock',
      'Options Outstanding- Gyre',
      'Options Available- Gyre',
      'Options Outstanding- Cullgen',
      'Options Available- Cullgen',
      'Total Fully Diluted Shares Outstand',
    ],
  );

  const commonShares = result.dataFrame.rows.find((row) => row.Description === 'Common Shares OS');
  const transfer = result.dataFrame.rows.find((row) => row.Description === '2025 BC Subplan shares transferred to Futu');
  const optionsOutstanding = result.dataFrame.rows.find((row) => row.Description === 'Options Outstanding- Gyre');
  const total = result.dataFrame.rows.find((row) => row.Description === 'Total Fully Diluted Shares Outstand');

  assert.equal(commonShares?.['Common Shares Equivalent'], 91_466_285);
  assert.equal(transfer?.['Common Shares Equivalent'], 695_164);
  assert.equal(optionsOutstanding?.['Common Shares Equivalent'], 13_690_894);
  assert.equal(total?.['Common Shares Equivalent'], MONTHLY_SUMMARY_TOTAL_FULLY_DILUTED);
  assert.equal(total?.['% of fully diluted'], 1);
});

test('monthly workflow exposes source extraction and business input calculation before summary build', () => {
  const tasks = buildMonthlyWorkflowTasks();
  const controlExtract = tasks.find((item) => item.id === 'extract_control_book');
  const summaryExtract = tasks.find((item) => item.id === 'extract_cap_table_summary');
  const optionExtract = tasks.find((item) => item.id === 'extract_option_plans');
  const optionMetrics = tasks.find((item) => item.id === 'calc_option_metrics');
  const sourceMetrics = tasks.find((item) => item.id === 'calc_cap_table_summary_source_metrics');
  const businessInputs = tasks.find((item) => item.id === 'calc_business_inputs');
  const summaryBuild = tasks.find((item) => item.id === 'build_capitalization_summary');
  const summaryFileRef = summaryExtract?.params.fileRef as Record<string, unknown> | undefined;

  assert.equal(controlExtract?.operatorCode, 'sheet.range.extract');
  assert.equal(controlExtract?.params.sheetName, 'EQ Control Book');
  assert.equal(controlExtract?.params.range, 'A9:L');
  assert.equal(controlExtract?.params.dropTrailingEmptyRows, true);
  assert.equal(summaryExtract?.operatorCode, 'sheet.range.extract');
  assert.equal(summaryExtract?.params.sheetName, 'Detailed Cap Table');
  assert.equal(summaryFileRef?.$fromRuntime, 'fileRefs.summary_source');
  assert.equal(summaryFileRef?.$type, 'object');
  assert.deepEqual(summaryFileRef?.$default, { provider: 'product-files', id: 7 });
  assert.equal(optionExtract?.operatorCode, 'sheet.sections.extract');
  assert.equal(optionExtract?.params.sheetName, 'Option Plans Summary');
  assert.equal(optionExtract?.params.splitByColumn, undefined);
  assert.equal(Array.isArray(optionExtract?.params.sections) ? optionExtract.params.sections.length : 0, 6);
  assert.equal(String(optionMetrics?.params.sql ?? '').includes('- 28170'), false);
  assert.equal(sourceMetrics?.inputs.summary_source?.from, 'extract_cap_table_summary');
  assert.equal(businessInputs?.inputs.summary_source?.from, 'calc_cap_table_summary_source_metrics');
  assert.equal(summaryBuild?.inputs.business_inputs?.from, 'calc_business_inputs');
  assert.ok(!buildMonthlyCapitalizationSummarySql.includes('14450527'));
  assert.ok(!buildMonthlyCapitalizationSummarySql.includes('4156815'));
  assert.ok(!buildMonthlyCapitalizationSummarySql.includes('10994'));
  assert.ok(!buildMonthlyCapitalizationSummarySql.includes(' as Formula'));
});

test('monthly control book metrics extract Futu SubPlan total from source rows instead of hardcoding it', () => {
  const task = buildMonthlyWorkflowTasks().find((item) => item.id === 'calc_control_book_metrics');
  const sql = String(task?.params.sql ?? '');

  assert.ok(sql.includes("Comment] = 'Equity Inc.Sub-Pl. Futu Network Technology'"));
  assert.ok(!sql.includes('7815396 as gyre_2023_china_subplan_total'));
});

test('monthly control book metrics uses last non-empty issued outstanding row instead of max value', async () => {
  const task = buildMonthlyWorkflowTasks().find((item) => item.id === 'calc_control_book_metrics');
  assert.ok(task);

  const result = await executeSqlDataFrameQuery(task, { rowsToDataFrame } as never, async (slot) => {
    if (slot !== 'control_book') throw new Error(`Unexpected input slot ${slot}`);
    return rowsToDataFrame(
      [
        {
          'Issued & Outstanding': 100,
          'Shares Issued': 10,
          Comment: 'Opening',
          'Trans. Type': 'Other',
        },
        {
          'Issued & Outstanding': 300,
          'Shares Issued': 20,
          Comment: 'Peak',
          'Trans. Type': 'Other',
        },
        {
          'Issued & Outstanding': 250,
          'Shares Issued': 30,
          Comment: 'Closing',
          'Trans. Type': 'Other',
        },
      ],
      { sheetName: 'EQ Control Book', a1Range: 'A9:L11' },
    );
  });

  assert.equal(result.dataFrame.rows[0].eom_eq_balance_os, 250);
});

test('monthly workflow seed definition derives runtime parameters without business-required semantics', () => {
  const workflow = buildMonthlyWorkflowSeedDefinition();
  const persistTask = workflow.tasks.find((item) => item.id === 'persist_capitalization_summary');
  const businessInputsTask = workflow.tasks.find((item) => item.id === 'calc_business_inputs');
  const businessInputConstants = businessInputsTask?.params.constants as Record<string, Record<string, unknown>> | undefined;

  assert.deepEqual(persistTask?.params.fileNamePrefix, { $fromRuntime: 'month' });
  assert.equal(persistTask?.params.fileName, 'Capitalization_Table_Summary_View.xlsx');
  assert.equal(workflow.runtimeParamsSchema.month?.label, 'Month');
  assert.notEqual(workflow.runtimeParamsSchema.month?.required, true);
  assert.equal(workflow.runtimeParamsSchema.fixedValues?.type, 'object');
  assert.equal(workflow.runtimeParamsSchema.fixedValues?.properties?.optionsOutstandingCullgen?.type, 'number');
  assert.equal(workflow.runtimeParamsSchema.fixedValues?.properties?.optionsAvailableCullgen?.type, 'number');
  assert.notEqual(workflow.runtimeParamsSchema.fixedValues?.required, true);
  assert.notEqual(workflow.runtimeParamsSchema.fixedValues?.properties?.optionsOutstandingCullgen?.required, true);
  assert.notEqual(workflow.runtimeParamsSchema.fixedValues?.properties?.optionsAvailableCullgen?.required, true);
  assert.notEqual(workflow.runtimeParamsSchema.fileRefs?.required, true);
  assert.notEqual(workflow.runtimeParamsSchema.fileRefs?.properties?.control_book?.required, true);
  assert.notEqual(workflow.runtimeParamsSchema.fileRefs?.properties?.summary_source?.required, true);
  assert.equal(
    (workflow.runtimeParamsDefaults.fixedValues as Record<string, unknown>).optionsOutstandingCullgen,
    MONTHLY_RUNTIME_OPTIONS_OUTSTANDING_CULLGEN,
  );
  assert.equal(
    (workflow.runtimeParamsDefaults.fixedValues as Record<string, unknown>).optionsAvailableCullgen,
    MONTHLY_RUNTIME_OPTIONS_AVAILABLE_CULLGEN,
  );
  assert.equal(
    businessInputConstants?.optionsOutstandingCullgen?.$fromRuntime,
    'fixedValues.optionsOutstandingCullgen',
  );
  assert.equal(businessInputConstants?.optionsOutstandingCullgen?.$type, 'number');
  assert.equal(businessInputConstants?.optionsOutstandingCullgen?.$default, MONTHLY_RUNTIME_OPTIONS_OUTSTANDING_CULLGEN);
  assert.equal(
    businessInputConstants?.optionsAvailableCullgen?.$fromRuntime,
    'fixedValues.optionsAvailableCullgen',
  );
  assert.equal(businessInputConstants?.optionsAvailableCullgen?.$type, 'number');
  assert.equal(businessInputConstants?.optionsAvailableCullgen?.$default, MONTHLY_RUNTIME_OPTIONS_AVAILABLE_CULLGEN);
  assert.match(String(workflow.runtimeParamsDefaults.month ?? ''), /^\d{4}-\d{2}$/);
});

test('monthly workflow defaults use independent source workbooks for required inputs', () => {
  const workflow = buildMonthlyWorkflowSeedDefinition();

  assert.deepEqual(workflow.runtimeParamsDefaults.fileRefs, {
    control_book: { provider: 'product-files', id: 53 },
    futu_exercises: { provider: 'product-files', id: 54 },
    option_plans: { provider: 'product-files', id: 55 },
    summary_source: { provider: 'product-files', id: 7 },
  });
});

test('monthly runtime parameter builder keeps defaults when optional override keys are undefined', () => {
  const runtimeParameters = buildMonthlyRuntimeParameters({
    month: '2026-06',
    fixedValues: undefined,
  });

  assert.equal(runtimeParameters.month, '2026-06');
  assert.deepEqual(runtimeParameters.fixedValues, {
    optionsOutstandingCullgen: MONTHLY_RUNTIME_OPTIONS_OUTSTANDING_CULLGEN,
    optionsAvailableCullgen: MONTHLY_RUNTIME_OPTIONS_AVAILABLE_CULLGEN,
  });
});

test('monthly business inputs resolves configurable Cullgen option constants from runtime parameters', async () => {
  const workflow = buildMonthlyWorkflowSeedDefinition();
  const resolved = resolveWorkflowRuntimeConfiguration({
    tasks: workflow.tasks,
    runtimeParamsSchema: workflow.runtimeParamsSchema,
    runtimeParamsDefaults: workflow.runtimeParamsDefaults,
    runtimeParameters: {
      fixedValues: {
        optionsOutstandingCullgen: 10,
        optionsAvailableCullgen: 5,
      },
    },
  });
  const task = resolved.tasks.find((item) => item.id === 'calc_business_inputs');
  assert.ok(task);

  assert.equal(String(task.params.sql).includes('4156815'), false);
  assert.equal(String(task.params.sql).includes('10994'), false);
  assert.deepEqual(task.params.constants, {
    optionsOutstandingCullgen: 10,
    optionsAvailableCullgen: 5,
  });

  const result = await executeSqlDataFrameQuery(task, { rowsToDataFrame } as never, async (slot) => {
    if (slot === 'control_metrics') {
      return rowsToDataFrame(
        [
          {
            eom_eq_balance_os: 100,
            cullgen_common_stock: 20,
            gyre_2023_china_subplan_total: 30,
          },
        ],
        { sheetName: 'control_metrics', a1Range: '' },
      );
    }
    if (slot === 'summary_source') {
      return rowsToDataFrame(
        [
          {
            bc_subplan_transfer_summary: 3,
            warrants_for_convertible_preferred_stock: 2,
            source_total_fully_diluted: 1000,
          },
        ],
        { sheetName: 'summary_source', a1Range: '' },
      );
    }
    throw new Error(`Unexpected input slot ${slot}`);
  });

  assert.equal(result.dataFrame.rows[0].options_outstanding_cullgen, 10);
  assert.equal(result.dataFrame.rows[0].options_available_cullgen, 5);
  assert.equal(result.dataFrame.rows[0].total_fully_diluted, 1015);
});

test('persist excel operator prefixes output filename with resolved month constant', async () => {
  const task = buildMonthlyWorkflowTasks().find((item) => item.id === 'persist_capitalization_summary');
  assert.ok(task);
  task.params.fileNamePrefix = '2026-05';

  const preview = await dataframePersistExcelOperator.preview?.({
    task,
    executed: new Map(),
    taskMap: new Map([[task.id, task]]),
    runtime: {} as never,
    executeTask: async () => metricFrames.business_inputs,
    resolveInputDataFrame: async () => metricFrames.business_inputs,
  });

  assert.equal(preview?.kind, 'file-plan');
  assert.equal(preview?.fileName, '2026-05-Capitalization_Table_Summary_View.xlsx');
});

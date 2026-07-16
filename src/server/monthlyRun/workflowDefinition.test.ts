import assert from 'node:assert/strict';
import test from 'node:test';
import { rowsToDataFrame } from '../excel.js';
import { evaluateSqlAssertion } from '../workflow/operators/dataframeSqlAssert.js';
import { executeSqlDataFrameQuery } from '../workflow/operators/sqlUtils.js';
import { workbookPersistExcelOperator } from '../workflow/operators/workbookPersistExcel.js';
import {
  buildMonthlyCapitalizationSummarySql,
  buildMonthlyRuntimeParameters,
  buildMonthlyWorkflowSeedDefinition,
  buildMonthlyWorkflowTasks,
  MONTHLY_RUNTIME_OPTIONS_AVAILABLE_CULLGEN,
  MONTHLY_RUNTIME_OPTIONS_OUTSTANDING_CULLGEN,
  MONTHLY_RUN_SOURCE_DEFINITIONS,
  MONTHLY_RECONCILIATION_COLUMNS,
  MONTHLY_SUMMARY_COLUMNS,
  MONTHLY_SUMMARY_TOTAL_FULLY_DILUTED,
} from './workflowDefinition.js';
import { resolveWorkflowRuntimeConfiguration } from '../workflow/runtimeParameters.js';

function resolvedMonthlyTask(taskId: string, month = '2026-05') {
  const workflow = buildMonthlyWorkflowSeedDefinition();
  const resolved = resolveWorkflowRuntimeConfiguration({
    tasks: workflow.tasks,
    runtimeParamsSchema: workflow.runtimeParamsSchema,
    runtimeParamsDefaults: workflow.runtimeParamsDefaults,
    runtimeParameters: { month },
  });
  const task = resolved.tasks.find((item) => item.id === taskId);
  assert.ok(task, `Task ${taskId} should exist`);
  return task;
}

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
  const previousSummaryExtract = tasks.find((item) => item.id === 'extract_previous_capitalization_summary');
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
  assert.deepEqual(summaryFileRef?.$default, { provider: 'product-files', id: 56 });
  assert.equal(previousSummaryExtract?.operatorCode, 'sheet.optional-range.extract');
  assert.equal(previousSummaryExtract?.params.sheetName, 'Capitalization Summary');
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

test('monthly summary source metrics accepts bilingual labels from the merged workbook', async () => {
  const task = buildMonthlyWorkflowTasks().find((item) => item.id === 'calc_cap_table_summary_source_metrics');
  assert.ok(task);

  const result = await executeSqlDataFrameQuery(task, { rowsToDataFrame } as never, async (slot) => {
    if (slot !== 'summary_source') throw new Error(`Unexpected input slot ${slot}`);
    return rowsToDataFrame(
      [
        {
          'Capitalization Table (Summary View)': 'BCI Shares Held by Futu Futu 持有的 BCI 股份',
          column_3: 4_876_873,
        },
        {
          'Capitalization Table (Summary View)': '2025 BC Subplan shares transferred to Futu\n2025 BC子计划转入Futu的股份',
          column_3: 695_164,
        },
        {
          'Capitalization Table (Summary View)': 'Warrants for Convertible Preferred Stock\n可转换优先股认股权证',
          column_3: 540_666,
        },
        {
          'Capitalization Table (Summary View)': 'Total Fully Diluted Shares Outstanding\n完全摊薄已发行股份合计',
          column_3: 133_527_448.2141,
        },
      ],
      { sheetName: 'Detailed Cap Table', a1Range: 'B24:F35' },
    );
  });

  assert.equal(result.dataFrame.rows[0].bci_shares_held_by_futu, 4_876_873);
  assert.equal(result.dataFrame.rows[0].bc_subplan_transfer_summary, 695_164);
  assert.equal(result.dataFrame.rows[0].warrants_for_convertible_preferred_stock, 540_666);
  assert.equal(result.dataFrame.rows[0].source_total_fully_diluted, 133_527_448.2141);
});

test('monthly control book metrics uses last non-empty issued outstanding row instead of max value', async () => {
  const task = resolvedMonthlyTask('calc_control_book_metrics', '2026-05');

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
          'As of Date': '29-May-2026',
        },
        {
          'Issued & Outstanding': '已发行流通股',
          'Shares Issued': '发行股份',
          Comment: '备注',
          'Trans. Type': '交易类型',
          'As of Date': '截止日期',
        },
      ],
      { sheetName: 'EQ Control Book', a1Range: 'A9:L11' },
    );
  });

  assert.equal(result.dataFrame.rows[0].eom_eq_balance_os, 250);
});

test('monthly control book metrics derives shares OS reconciliation inputs from single control book', async () => {
  const task = resolvedMonthlyTask('calc_control_book_metrics', '2026-05');

  const result = await executeSqlDataFrameQuery(task, { rowsToDataFrame } as never, async (slot) => {
    if (slot !== 'control_book') throw new Error(`Unexpected input slot ${slot}`);
    return rowsToDataFrame(
      [
        {
          'As of Date': '24-Apr-2026',
          'Issued & Outstanding': 97_028_322,
          'Shares Issued': 0,
          Comment: 'Opening',
          'Trans. Type': 'Other',
        },
        {
          'As of Date': '29-Apr-2026',
          'Issued & Outstanding': 97_028_322,
          'Shares Issued': 0,
          Comment: 'Opening',
          'Trans. Type': 'Other',
        },
        {
          'As of Date': '29-May-2026',
          'Issued & Outstanding': 111_488_849,
          'Shares Issued': 14_450_527,
          Comment: 'DIR # CA 84 Lin Han',
          'Trans. Type': 'Agr. & Pl. of Merger',
        },
      ],
      { sheetName: 'EQ Control Book', a1Range: 'A9:L11' },
    );
  });

  assert.equal(result.dataFrame.rows[0].last_month_eq_balance_os, 97_028_322);
  assert.equal(result.dataFrame.rows[0].eom_eq_balance_os, 111_488_849);
  assert.equal(result.dataFrame.rows[0].last_control_book_month, '2026-05');
});

test('monthly workflow blocks EQ Control Book whose last row is outside workflow month', async () => {
  const task = resolvedMonthlyTask('assert_control_book_workflow_month', '2026-06');

  const { assertion } = await evaluateSqlAssertion(task, { rowsToDataFrame } as never, async (slot) => {
    if (slot !== 'control_metrics') throw new Error(`Unexpected input slot ${slot}`);
    return rowsToDataFrame(
      [
        {
          last_control_book_month: '2026-05',
          last_month_eq_balance_os: 97_028_322,
          eom_eq_balance_os: 111_488_849,
        },
      ],
      { sheetName: 'control_metrics', a1Range: '' },
    );
  });

  assert.equal(assertion.passed, false);
  assert.equal(assertion.blockExecution, true);
  assert.match(assertion.failureMessage, /EQ Control Book input file error/);
});

test('monthly workflow builds Shares OS Reconciliation from control book metrics', async () => {
  const task = resolvedMonthlyTask('build_shares_os_reconciliation', '2026-05');

  const result = await executeSqlDataFrameQuery(task, { rowsToDataFrame } as never, async (slot) => {
    if (slot !== 'control_metrics') throw new Error(`Unexpected input slot ${slot}`);
    return rowsToDataFrame(
      [
        {
          last_month_eq_balance_os: 97_028_322,
          eom_eq_balance_os: 111_488_849,
        },
      ],
      { sheetName: 'control_metrics', a1Range: '' },
    );
  });

  assert.deepEqual(result.dataFrame.columns, MONTHLY_RECONCILIATION_COLUMNS);
  assert.deepEqual(result.dataFrame.rows[0], {
    Item: 'Equity Outstanding as of',
    'As of': '2026/5/31',
    'Last Month': 97_028_322,
    'New Shares': 14_460_527,
    'EOM Balance': 111_488_849,
  });
});

test('monthly workflow optional previous summary validates Last Month only when file rows exist', async () => {
  const metricsTask = buildMonthlyWorkflowTasks().find((item) => item.id === 'calc_previous_capitalization_summary_metrics');
  assert.ok(metricsTask);

  const emptyMetrics = await executeSqlDataFrameQuery(metricsTask, { rowsToDataFrame } as never, async (slot) => {
    if (slot !== 'previous_summary') throw new Error(`Unexpected input slot ${slot}`);
    return rowsToDataFrame([], { sheetName: 'Capitalization Summary', a1Range: 'A1:E30' });
  });
  assert.equal(emptyMetrics.dataFrame.rows[0].previous_summary_row_count, 0);

  const assertTask = buildMonthlyWorkflowTasks().find((item) => item.id === 'assert_previous_summary_last_month');
  assert.ok(assertTask);

  const pass = await evaluateSqlAssertion(assertTask, { rowsToDataFrame } as never, async (slot) => {
    if (slot === 'control_metrics') {
      return rowsToDataFrame([{ last_month_eq_balance_os: 97_028_322 }], { sheetName: 'control_metrics', a1Range: '' });
    }
    if (slot === 'previous_summary_metrics') {
      return rowsToDataFrame([{ previous_summary_row_count: 1, previous_eom_eq_balance_os: 97_028_322 }], {
        sheetName: 'previous_summary_metrics',
        a1Range: '',
      });
    }
    throw new Error(`Unexpected input slot ${slot}`);
  });
  assert.equal(pass.assertion.passed, true);

  const fail = await evaluateSqlAssertion(assertTask, { rowsToDataFrame } as never, async (slot) => {
    if (slot === 'control_metrics') {
      return rowsToDataFrame([{ last_month_eq_balance_os: 97_028_322 }], { sheetName: 'control_metrics', a1Range: '' });
    }
    if (slot === 'previous_summary_metrics') {
      return rowsToDataFrame([{ previous_summary_row_count: 1, previous_eom_eq_balance_os: 97_000_000 }], {
        sheetName: 'previous_summary_metrics',
        a1Range: '',
      });
    }
    throw new Error(`Unexpected input slot ${slot}`);
  });
  assert.equal(fail.assertion.passed, false);
  assert.match(fail.assertion.failureMessage, /Previous Capitalization Summary EOM/);
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
  assert.equal(workflow.runtimeParamsSchema.fileRefs?.properties?.summary_source?.type, 'object');
  assert.equal(workflow.runtimeParamsSchema.fileRefs?.properties?.previous_capitalization_summary?.type, 'object');
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
    summary_source: { provider: 'product-files', id: 56 },
    previous_capitalization_summary: {},
  });
});

test('monthly business input configuration maps source files one-to-one to extraction tasks', () => {
  assert.deepEqual(
    MONTHLY_RUN_SOURCE_DEFINITIONS.map(({ sourceKey, taskId }) => ({ sourceKey, taskId })),
    [
      { sourceKey: 'control_book', taskId: 'extract_control_book' },
      { sourceKey: 'summary_source', taskId: 'extract_cap_table_summary' },
      { sourceKey: 'previous_capitalization_summary', taskId: 'extract_previous_capitalization_summary' },
      { sourceKey: 'futu_exercises', taskId: 'extract_futu_exercises' },
      { sourceKey: 'option_plans', taskId: 'extract_option_plans' },
    ],
  );
  assert.equal(MONTHLY_RUN_SOURCE_DEFINITIONS.find((source) => source.sourceKey === 'previous_capitalization_summary')?.required, false);
  assert.equal(new Set(MONTHLY_RUN_SOURCE_DEFINITIONS.map((source) => source.taskId)).size, 5);
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
            source_total_fully_diluted: 1000.4,
          },
        ],
        { sheetName: 'summary_source', a1Range: '' },
      );
    }
    throw new Error(`Unexpected input slot ${slot}`);
  });

  assert.equal(result.dataFrame.rows[0].options_outstanding_cullgen, 10);
  assert.equal(result.dataFrame.rows[0].options_available_cullgen, 5);
  assert.equal(result.dataFrame.rows[0].total_fully_diluted, 1000);
});

test('persist excel operator prefixes output filename with resolved month constant', async () => {
  const task = buildMonthlyWorkflowTasks().find((item) => item.id === 'persist_capitalization_summary');
  assert.ok(task);
  task.params.fileNamePrefix = '2026-05';

  const preview = await workbookPersistExcelOperator.preview?.({
    task,
    executed: new Map(),
    taskMap: new Map([[task.id, task]]),
    runtime: {} as never,
    executeTask: async () => metricFrames.business_inputs,
    resolveInputDataFrame: async (slot) =>
      slot === 'reconciliation'
        ? rowsToDataFrame(
            [
              {
                Item: 'Equity Outstanding as of',
                'As of': '2026/5/31',
                'Last Month': 97_028_322,
                'New Shares': 14_460_527,
                'EOM Balance': 111_488_849,
              },
            ],
            { sheetName: 'Shares OS Reconciliation', a1Range: '' },
          )
        : metricFrames.business_inputs,
  });

  assert.equal(preview?.kind, 'file-plan');
  assert.equal(preview?.fileName, '2026-05-Capitalization_Table_Summary_View.xlsx');
  assert.equal(preview?.sheetName, 'Shares OS Reconciliation, Capitalization Summary');
});

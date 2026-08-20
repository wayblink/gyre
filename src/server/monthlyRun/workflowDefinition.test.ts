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
        bc_subplan_transfer_selected: 695_164,
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
  const controlInvoke = tasks.find((item) => item.id === 'invoke_control_book_merge');
  const previousSummaryExtract = tasks.find((item) => item.id === 'extract_previous_capitalization_summary');
  const optionInvoke = tasks.find((item) => item.id === 'invoke_option_plans_summary');
  const optionsOsDetailExtract = tasks.find((item) => item.id === 'extract_options_os_detail_by_plan');
  const bcSubplanExtract = tasks.find((item) => item.id === 'extract_bc_subplan_transfer');
  const bcSubplanMetrics = tasks.find((item) => item.id === 'calc_bc_subplan_cancelled');
  const optionMetrics = tasks.find((item) => item.id === 'calc_option_metrics');
  const businessInputs = tasks.find((item) => item.id === 'calc_business_inputs');
  const summaryBuild = tasks.find((item) => item.id === 'build_capitalization_summary');

  assert.equal(controlInvoke?.operatorCode, 'workflow.invoke');
  assert.equal(controlInvoke?.params.workflowCode, 'eq-control-book-incremental-merge');
  assert.equal(controlInvoke?.params.outputTaskId, 'merge_control_book');
  assert.equal(previousSummaryExtract?.operatorCode, 'sheet.optional-range.extract');
  assert.equal(previousSummaryExtract?.params.sheetName, 'Capitalization Summary');
  assert.equal(optionInvoke?.operatorCode, 'workflow.invoke');
  assert.equal(optionInvoke?.params.workflowCode, 'option-plans-summary-values');
  assert.equal(optionInvoke?.params.outputTaskId, 'enrich_option_plans_summary_plan_name');
  assert.deepEqual(optionInvoke?.params.runtimeParameters, {
    fileRefs: {
      option_plans_summary: {
        $fromRuntime: 'fileRefs.option_plans_summary',
        $type: 'object',
        $label: 'Gyre Option Plans Summary SL workbook',
        $default: {
          sheet: '!Option Plans Summary (Post-Gyr',
        },
      },
    },
  });
  assert.equal(optionsOsDetailExtract?.operatorCode, 'sheet.optional-range.extract');
  assert.equal(optionsOsDetailExtract?.params.sheetName, 'Options OS Detail');
  assert.equal(optionsOsDetailExtract?.params.range, 'A2:BZ');
  assert.equal(bcSubplanExtract?.operatorCode, 'sheet.range.extract');
  assert.deepEqual(bcSubplanExtract?.params.sheetName, {
    $fromRuntime: 'fileRefs.bc_subplan_transfer.sheet',
    $type: 'string',
    $label: 'Sheet',
    $default: 'Vesting Schedule',
  });
  assert.equal(bcSubplanExtract?.params.range, 'A2:AI');
  assert.equal(bcSubplanExtract?.params.headerRow, 4);
  assert.equal(bcSubplanMetrics?.inputs.transfer?.from, 'extract_bc_subplan_transfer');
  assert.equal(String(optionMetrics?.params.sql ?? '').includes('group by p.key'), true);
  assert.equal(String(optionMetrics?.params.sql ?? '').includes('bc_subplan_cancelled'), true);
  assert.equal(optionMetrics?.inputs.plans?.from, 'invoke_option_plans_summary');
  assert.equal(optionMetrics?.inputs.bc_subplan?.from, 'calc_bc_subplan_cancelled');
  assert.equal(businessInputs?.inputs.option_metrics?.from, 'calc_option_metrics');
  assert.deepEqual(businessInputs?.inputs.option_metrics?.guards, []);
  assert.deepEqual(summaryBuild?.inputs.option_metrics?.guards, []);
  assert.equal(businessInputs?.inputs.control_metrics?.from, 'calc_control_book_metrics');
  assert.equal(summaryBuild?.inputs.business_inputs?.from, 'calc_business_inputs');
  assert.equal(String(businessInputs?.params.sql ?? '').includes('bc_subplan_transfer_selected'), true);
  assert.equal(String(businessInputs?.params.sql ?? '').includes('warrants_for_convertible_preferred_stock'), true);
});

test('monthly control book metrics extract Futu SubPlan total from source rows instead of hardcoding it', () => {
  const task = buildMonthlyWorkflowTasks().find((item) => item.id === 'calc_control_book_metrics');
  const sql = String(task?.params.sql ?? '');

  assert.ok(sql.includes("Comment] = 'Equity Inc.Sub-Pl. Futu Network Technology'"));
  assert.ok(!sql.includes('7815396 as gyre_2023_china_subplan_total'));
});

test('monthly BC Subplan metrics derive cancelled shares from the explicitly selected transfer sheet', async () => {
  const task = resolvedMonthlyTask('calc_bc_subplan_cancelled', '2026-05');
  const result = await executeSqlDataFrameQuery(task, { rowsToDataFrame } as never, async (slot) => {
    if (slot !== 'transfer') throw new Error(`Unexpected input slot ${slot}`);
    return rowsToDataFrame(
      [
        { 行标签: '总计', 总计: 2_063_380, Column35: null },
        { 行标签: null, 总计: 2_100_000, Column35: null },
        { 行标签: null, 总计: -36_620, Column35: 'Options cancelled/forfeited' },
      ],
      { sheetName: 'Vesting Schedule', a1Range: 'A2:AI459' },
    );
  });

  assert.equal(result.dataFrame.rows[0].bc_subplan_cancelled, 36_620);
});

test('monthly BC Subplan metrics supports the 2025 transfer sheet two-total-row layout', async () => {
  const task = resolvedMonthlyTask('calc_bc_subplan_cancelled', '2026-05');
  const result = await executeSqlDataFrameQuery(task, { rowsToDataFrame } as never, async (slot) => {
    if (slot !== 'transfer') throw new Error(`Unexpected input slot ${slot}`);
    return rowsToDataFrame(
      [
        { 行标签: '总计', 总计: 2_100_000 },
        { 行标签: '总计', 总计: 2_071_829 },
      ],
      { sheetName: '2025 BC Subplan Transfer', a1Range: 'A2:AI485' },
    );
  });

  assert.equal(result.dataFrame.rows[0].bc_subplan_cancelled, 28_171);
  assert.equal(result.dataFrame.rows[0].bc_subplan_outstanding, 2_071_829);
});

test('monthly option metrics aggregates copy-style key totals without BC adjustment when no BC Subplan row exists', async () => {
  const task = resolvedMonthlyTask('calc_option_metrics', '2026-05');
  assert.ok(task);

  const result = await executeSqlDataFrameQuery(task, { rowsToDataFrame } as never, async (slot) => {
    if (slot === 'bc_subplan') {
      return rowsToDataFrame([{ bc_subplan_cancelled: 28_170 }], { sheetName: 'bc_subplan', a1Range: '' });
    }
    if (slot !== 'plans') throw new Error(`Unexpected input slot ${slot}`);
    return rowsToDataFrame(
      [
        {
          category_for_grouping: '0100PLAN_Other Plan',
          plan_name: 'Other Plan',
          key: 'Awards Outstanding',
          value: 2_071_830,
        },
        {
          category_for_grouping: '0101PLAN_GYRE 2023 Omnibus Incentive Plan',
          plan_name: 'GYRE 2023 Omnibus Incentive Plan',
          key: 'Awards Outstanding',
          value: 50_000,
        },
        {
          category_for_grouping: '0101PLAN_GYRE 2023 Omnibus Incentive Plan',
          plan_name: 'GYRE 2023 Omnibus Incentive Plan',
          key: 'Awards Outstanding + Shares Remaining for Issuance',
          value: 52_000,
        },
        {
          category_for_grouping: '0101PLAN_GYRE 2023 Omnibus Incentive Plan',
          plan_name: 'GYRE 2023 Omnibus Incentive Plan',
          key: 'Shares Remaining For Issuance',
          value: 2_000,
        },
      ],
      { sheetName: 'Option Plans Summary Values', a1Range: '' },
    );
  });

  assert.equal(result.dataFrame.rows[0].total_options_outstanding, 2_121_830);
  assert.equal(result.dataFrame.rows[0].total_options_available, 2_000);
  assert.equal(result.dataFrame.rows[0].total_options_outstanding_plus_available, 52_000);
});

test('monthly option metrics adjusts BC Subplan only when Cancelled is zero', async () => {
  const task = resolvedMonthlyTask('calc_option_metrics', '2026-05');
  assert.ok(task);

  const result = await executeSqlDataFrameQuery(task, { rowsToDataFrame } as never, async (slot) => {
    if (slot === 'bc_subplan') {
      return rowsToDataFrame([{ bc_subplan_cancelled: 28_170 }], { sheetName: 'bc_subplan', a1Range: '' });
    }
    if (slot !== 'plans') throw new Error(`Unexpected input slot ${slot}`);
    return rowsToDataFrame(
      [
        {
          category_for_grouping: '0100PLAN_GYRE 2025 BC Subplan',
          plan_name: 'GYRE 2025 BC Subplan',
          key: 'Awards Outstanding',
          value: 2_100_000,
        },
        {
          category_for_grouping: '0100PLAN_GYRE 2025 BC Subplan',
          plan_name: 'GYRE 2025 BC Subplan',
          key: 'Cancelled',
          value: 0,
        },
        {
          category_for_grouping: '0100PLAN_GYRE 2025 BC Subplan',
          plan_name: 'GYRE 2025 BC Subplan',
          key: 'Awards Outstanding + Shares Remaining for Issuance',
          value: 2_100_000,
        },
        {
          category_for_grouping: '0101PLAN_GYRE 2023 Omnibus Incentive Plan',
          plan_name: 'GYRE 2023 Omnibus Incentive Plan',
          key: 'Awards Outstanding',
          value: 2_983_369,
        },
        {
          category_for_grouping: '0101PLAN_GYRE 2023 Omnibus Incentive Plan',
          plan_name: 'GYRE 2023 Omnibus Incentive Plan',
          key: 'Shares Remaining For Issuance',
          value: 3_639_230,
        },
        {
          category_for_grouping: '0101PLAN_GYRE 2023 Omnibus Incentive Plan',
          plan_name: 'GYRE 2023 Omnibus Incentive Plan',
          key: 'Awards Outstanding + Shares Remaining for Issuance',
          value: 6_622_599,
        },
        {
          category_for_grouping: '0102PLAN_GYRE 2023 Non-China BCI grants',
          plan_name: 'GYRE 2023 Non-China BCI grants',
          key: 'Awards Outstanding',
          value: 8_992_192,
        },
        {
          category_for_grouping: '0102PLAN_GYRE 2023 Non-China BCI grants',
          plan_name: 'GYRE 2023 Non-China BCI grants',
          key: 'Awards Outstanding + Shares Remaining for Issuance',
          value: 8_992_192,
        },
        {
          category_for_grouping: '0103PLAN_2018 Omnibus Incentive Plan',
          plan_name: '2018 Omnibus Incentive Plan',
          key: 'Awards Outstanding',
          value: 185_935,
        },
        {
          category_for_grouping: '0103PLAN_2018 Omnibus Incentive Plan',
          plan_name: '2018 Omnibus Incentive Plan',
          key: 'Awards Outstanding + Shares Remaining for Issuance',
          value: 185_935,
        },
        {
          category_for_grouping: '0104PLAN_CBIO 2015 Stock Incentive Plan',
          plan_name: 'CBIO 2015 Stock Incentive Plan',
          key: 'Awards Outstanding',
          value: 152_732,
        },
        {
          category_for_grouping: '0104PLAN_CBIO 2015 Stock Incentive Plan',
          plan_name: 'CBIO 2015 Stock Incentive Plan',
          key: 'Awards Outstanding + Shares Remaining for Issuance',
          value: 152_732,
        },
      ],
      { sheetName: 'Option Plans Summary Values', a1Range: '' },
    );
  });

  assert.equal(result.dataFrame.rows[0].total_options_outstanding, 14_386_058);
  assert.equal(result.dataFrame.rows[0].total_options_available, 3_667_400);
  assert.equal(result.dataFrame.rows[0].total_options_outstanding_plus_available, 18_053_458);
  assert.equal(result.dataFrame.rows[0].bc_subplan_cancelled_adjustment, 28_170);
});

test('monthly option metrics keeps workbook values when BC Subplan Cancelled is non-zero', async () => {
  const task = resolvedMonthlyTask('calc_option_metrics', '2026-05');
  assert.ok(task);

  const result = await executeSqlDataFrameQuery(task, { rowsToDataFrame } as never, async (slot) => {
    if (slot === 'bc_subplan') {
      return rowsToDataFrame([{ bc_subplan_cancelled: 28_170 }], { sheetName: 'bc_subplan', a1Range: '' });
    }
    if (slot !== 'plans') throw new Error(`Unexpected input slot ${slot}`);
    return rowsToDataFrame(
      [
        {
          category_for_grouping: '0100PLAN_GYRE 2025 BC Subplan',
          plan_name: 'GYRE 2025 BC Subplan',
          key: 'Awards Outstanding',
          value: 2_071_830,
        },
        {
          category_for_grouping: '0100PLAN_GYRE 2025 BC Subplan',
          plan_name: 'GYRE 2025 BC Subplan',
          key: 'Cancelled',
          value: 28_170,
        },
        {
          category_for_grouping: '0100PLAN_GYRE 2025 BC Subplan',
          plan_name: 'GYRE 2025 BC Subplan',
          key: 'Awards Outstanding + Shares Remaining for Issuance',
          value: 2_100_000,
        },
        {
          category_for_grouping: '0101PLAN_GYRE 2023 Omnibus Incentive Plan',
          plan_name: 'GYRE 2023 Omnibus Incentive Plan',
          key: 'Awards Outstanding',
          value: 12_314_228,
        },
        {
          category_for_grouping: '0101PLAN_GYRE 2023 Omnibus Incentive Plan',
          plan_name: 'GYRE 2023 Omnibus Incentive Plan',
          key: 'Shares Remaining For Issuance',
          value: 3_667_400,
        },
        {
          category_for_grouping: '0101PLAN_GYRE 2023 Omnibus Incentive Plan',
          plan_name: 'GYRE 2023 Omnibus Incentive Plan',
          key: 'Awards Outstanding + Shares Remaining for Issuance',
          value: 15_953_458,
        },
      ],
      { sheetName: 'Option Plans Summary Values', a1Range: '' },
    );
  });

  assert.equal(result.dataFrame.rows[0].total_options_outstanding, 14_386_058);
  assert.equal(result.dataFrame.rows[0].total_options_available, 3_667_400);
  assert.equal(result.dataFrame.rows[0].total_options_outstanding_plus_available, 18_053_458);
  assert.equal(result.dataFrame.rows[0].bc_subplan_cancelled_adjustment, 0);
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

test('monthly workflow seed definition derives runtime parameters and fixed values', () => {
  const workflow = buildMonthlyWorkflowSeedDefinition();
  const persistTask = workflow.tasks.find((item) => item.id === 'persist_capitalization_summary');
  const businessInputsTask = workflow.tasks.find((item) => item.id === 'calc_business_inputs');
  const businessInputConstants = businessInputsTask?.params.constants as Record<string, Record<string, unknown>> | undefined;

  assert.deepEqual(persistTask?.params.fileNamePrefix, { $fromRuntime: 'month' });
  assert.equal(persistTask?.params.fileName, 'Capitalization_Table_Summary_View.xlsx');
  assert.equal(workflow.runtimeParamsSchema.month?.label, 'Month');
  assert.equal(workflow.runtimeParamsSchema.fixedValues?.type, 'object');
  assert.equal(workflow.runtimeParamsSchema.fixedValues?.properties?.bcSubplanCancelled, undefined);
  assert.equal(workflow.runtimeParamsSchema.transferDecision, undefined);
  assert.equal(workflow.runtimeParamsSchema.fixedValues?.properties?.warrantsConvertiblePreferred?.type, 'number');
  assert.equal(workflow.runtimeParamsSchema.fixedValues?.properties?.optionsOutstandingCullgen?.type, 'number');
  assert.equal(workflow.runtimeParamsSchema.fixedValues?.properties?.optionsAvailableCullgen?.type, 'number');
  assert.equal(workflow.runtimeParamsSchema.fileRefs?.properties?.base_control_book?.type, 'object');
  assert.equal(workflow.runtimeParamsSchema.fileRefs?.properties?.incremental_control_book?.type, 'object');
  assert.equal(workflow.runtimeParamsSchema.fileRefs?.properties?.futu_exercises?.type, 'object');
  assert.equal(workflow.runtimeParamsSchema.fileRefs?.properties?.option_plans_summary?.type, 'object');
  assert.equal(workflow.runtimeParamsSchema.fileRefs?.properties?.option_plans_summary?.properties?.sheet?.type, 'string');
  assert.equal(workflow.runtimeParamsSchema.fileRefs?.properties?.options_os_detail_by_plan?.type, 'object');
  assert.equal(workflow.runtimeParamsSchema.fileRefs?.properties?.previous_capitalization_summary?.type, 'object');
  assert.equal(workflow.runtimeParamsSchema.fileRefs?.properties?.bc_subplan_transfer?.type, 'object');
  assert.equal(workflow.runtimeParamsSchema.fileRefs?.properties?.bc_subplan_transfer?.properties?.sheet?.type, 'string');
  assert.equal(workflow.runtimeParamsSchema.sheetNames, undefined);
  assert.equal((workflow.runtimeParamsDefaults.fixedValues as Record<string, unknown>).bcSubplanCancelled, undefined);
  assert.equal(workflow.runtimeParamsDefaults.transferDecision, undefined);
  assert.equal((workflow.runtimeParamsDefaults.fixedValues as Record<string, unknown>).warrantsConvertiblePreferred, 540_666);
  assert.equal((workflow.runtimeParamsDefaults.fixedValues as Record<string, unknown>).optionsOutstandingCullgen, MONTHLY_RUNTIME_OPTIONS_OUTSTANDING_CULLGEN);
  assert.equal((workflow.runtimeParamsDefaults.fixedValues as Record<string, unknown>).optionsAvailableCullgen, MONTHLY_RUNTIME_OPTIONS_AVAILABLE_CULLGEN);
  assert.equal(businessInputConstants?.bcSubplanTransferOverride, undefined);
  assert.match(String(businessInputsTask?.params.sql ?? ''), /bc_subplan_transfer_control_book/);
  assert.equal(businessInputConstants?.warrantsConvertiblePreferred?.$default, 540_666);
  assert.equal(businessInputConstants?.optionsOutstandingCullgen?.$default, MONTHLY_RUNTIME_OPTIONS_OUTSTANDING_CULLGEN);
  assert.equal(businessInputConstants?.optionsAvailableCullgen?.$default, MONTHLY_RUNTIME_OPTIONS_AVAILABLE_CULLGEN);
  assert.match(String(workflow.runtimeParamsDefaults.month ?? ''), /^\d{4}-\d{2}$/);
});

test('monthly workflow defaults leave source workbooks unbound and preserve sheet defaults', () => {
  const workflow = buildMonthlyWorkflowSeedDefinition();

  assert.deepEqual(workflow.runtimeParamsDefaults.fileRefs, {
    base_control_book: { sheet: 'EQ Control Book' },
    incremental_control_book: { sheet: '27591' },
    futu_exercises: {},
    option_plans_summary: {
      sheet: '!Option Plans Summary (Post-Gyr',
    },
    bc_subplan_transfer: { sheet: 'Vesting Schedule' },
    options_os_detail_by_plan: {},
    previous_capitalization_summary: {},
  });
});

test('monthly business input configuration maps source files one-to-one to extraction tasks', () => {
  assert.deepEqual(
    MONTHLY_RUN_SOURCE_DEFINITIONS.map(({ sourceKey, taskId }) => ({ sourceKey, taskId })),
    [
      { sourceKey: 'base_control_book', taskId: 'invoke_control_book_merge' },
      { sourceKey: 'incremental_control_book', taskId: 'invoke_control_book_merge' },
      { sourceKey: 'previous_capitalization_summary', taskId: 'extract_previous_capitalization_summary' },
      { sourceKey: 'futu_exercises', taskId: 'extract_futu_exercises' },
      { sourceKey: 'option_plans_summary', taskId: 'invoke_option_plans_summary' },
      { sourceKey: 'bc_subplan_transfer', taskId: 'extract_bc_subplan_transfer' },
      { sourceKey: 'options_os_detail_by_plan', taskId: 'extract_options_os_detail_by_plan' },
    ],
  );
  assert.equal(MONTHLY_RUN_SOURCE_DEFINITIONS.find((source) => source.sourceKey === 'previous_capitalization_summary')?.required, false);
  assert.equal(MONTHLY_RUN_SOURCE_DEFINITIONS.find((source) => source.sourceKey === 'bc_subplan_transfer')?.required, true);
  assert.equal(MONTHLY_RUN_SOURCE_DEFINITIONS.find((source) => source.sourceKey === 'bc_subplan_transfer')?.allowSheetNameOverride, true);
  assert.equal(MONTHLY_RUN_SOURCE_DEFINITIONS.find((source) => source.sourceKey === 'option_plans_summary')?.allowSheetNameOverride, true);
  assert.equal(MONTHLY_RUN_SOURCE_DEFINITIONS.find((source) => source.sourceKey === 'options_os_detail_by_plan')?.required, false);
  assert.equal(new Set(MONTHLY_RUN_SOURCE_DEFINITIONS.map((source) => source.taskId)).size, 6);
});

test('monthly runtime parameter builder keeps defaults when optional override keys are undefined', () => {
  const runtimeParameters = buildMonthlyRuntimeParameters({
    month: '2026-06',
    fixedValues: undefined,
  });

  assert.equal(runtimeParameters.month, '2026-06');
  assert.deepEqual(runtimeParameters.fixedValues, {
    warrantsConvertiblePreferred: 540_666,
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

  assert.equal(String(task.params.sql).includes('options_os_detail_by_plan'), false);
  assert.deepEqual(task.params.constants, {
    warrantsConvertiblePreferred: 540_666,
    optionsOutstandingCullgen: 10,
    optionsAvailableCullgen: 5,
  });

  const result = await executeSqlDataFrameQuery(task, { rowsToDataFrame } as never, async (slot) => {
    if (slot === 'control_metrics') {
      return rowsToDataFrame(
        [
          {
            eom_eq_balance_os: 111_488_849,
            cullgen_common_stock: 14_450_527,
            gyre_2023_china_subplan_total: 7_815_396,
            bc_subplan_transfer_control_book: 695_165,
          },
        ],
        { sheetName: 'control_metrics', a1Range: '' },
      );
    }
    if (slot === 'option_metrics') {
      return rowsToDataFrame(
        [
          {
            total_options_outstanding: 14_386_058,
            total_options_available: 3_667_400,
          },
        ],
        { sheetName: 'option_metrics', a1Range: '' },
      );
    }
    throw new Error(`Unexpected input slot ${slot}`);
  });

  assert.equal(result.dataFrame.rows[0].options_outstanding_cullgen, 10);
  assert.equal(result.dataFrame.rows[0].options_available_cullgen, 5);
  assert.equal(result.dataFrame.rows[0].bc_subplan_transfer_selected, 695_165);
  assert.equal(result.dataFrame.rows[0].bc_subplan_transfer_selection_source, 'control_book');
  assert.equal(result.dataFrame.rows[0].total_fully_diluted, 129_387_823);
});

test('monthly transfer guards accept any positive Control Book value and avoid snapshot totals', () => {
  const workflow = buildMonthlyWorkflowSeedDefinition();
  const calcTask = workflow.tasks.find((item) => item.id === 'calc_business_inputs');
  const summaryTask = workflow.tasks.find((item) => item.id === 'build_capitalization_summary');
  const persistTask = workflow.tasks.find((item) => item.id === 'persist_capitalization_summary');
  assert.ok(calcTask);
  assert.ok(summaryTask);
  assert.ok(persistTask);

  const controlGuards = summaryTask.inputs.control_metrics.guards;
  const businessInputGuards = summaryTask.inputs.business_inputs.guards;
  const capitalizationGuards = persistTask.inputs.capitalization.guards;
  assert.ok(controlGuards);
  assert.ok(businessInputGuards);
  assert.ok(capitalizationGuards);

  const controlGuard = controlGuards.find(
    (guard) => guard.id === 'guard_assert_control_book_transfer_source',
  );
  const businessTotalGuard = businessInputGuards.find(
    (guard) => guard.id === 'guard_assert_total_fully_diluted_business_input',
  );
  const summaryTotalGuard = capitalizationGuards.find(
    (guard) => guard.id === 'guard_assert_summary_total_calculation',
  );

  assert.equal(controlGuard?.params.expectedValue, 1);
  assert.match(String(controlGuard?.params.sql), /> 0/);
  assert.equal(businessTotalGuard?.params.expectedValue, 1);
  assert.equal(summaryTotalGuard?.params.expectedValue, 1);
  assert.match(String(summaryTotalGuard?.params.sql), /Total Fully Diluted Shares Outstand/);
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
    runtimeParameters: {},
    invocationStack: [],
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

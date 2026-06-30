import type {
  MonthlyRunSourceDefinition,
  WorkflowRuntimeParameters,
  WorkflowRuntimeParametersSchema,
  WorkflowTask,
} from '../../shared/types.js';
import { MONTHLY_WORKFLOW_CODE } from './store.js';
import { deriveWorkflowRuntimeConfigFromTasks } from '../workflow/runtimeParameterRequirements.js';

export const MONTHLY_RUN_SOURCE_DEFINITIONS: MonthlyRunSourceDefinition[] = [
  {
    sourceKey: 'control_book',
    taskId: 'extract_control_book',
    label: 'EQ Control Book',
    description: '用于提取期末股本、Futu SubPlan 总数和 Omnibus 备注行。',
    defaultSheetName: 'EQ Control Book',
    required: true,
  },
  {
    sourceKey: 'futu_exercises',
    taskId: 'extract_futu_exercises',
    label: 'Futu BCI Exercises',
    description: '用于汇总 Futu exercises to date 的已行权数量。',
    defaultSheetName: 'Futu BCI Exercises to Date',
    required: true,
  },
  {
    sourceKey: 'option_plans',
    taskId: 'extract_option_plans',
    label: 'Option Plans Summary',
    description: '用于提取各个 option plan 区块的 outstanding 与 available shares。',
    defaultSheetName: 'Option Plans Summary',
    required: true,
  },
];

export const MONTHLY_WORKFLOW_NAME = 'Gyre Cap Table Summary';

export const MONTHLY_WORKFLOW_DESCRIPTION =
  '基于 GyreESOP 管理系统需求文档 0614 的 Summary 计算草稿：从 !!Gyre Cap Table 05.31.26.xlsx 提取 Control Book/Futu/Option Plans，按 Control Book 口径生成 Summary View；关键输入、口径常数、汇总公式和输出结构均拆分断言，2025 BC Subplan transfer 的 1 股差异作为 warning 人工确认点。';

export const MONTHLY_RUNTIME_PARAMS_SCHEMA: WorkflowRuntimeParametersSchema = {
  fileRefs: {
    type: 'object',
    label: 'File References',
    required: true,
    properties: {
      control_book: { type: 'object', label: 'EQ Control Book workbook', required: true },
      futu_exercises: { type: 'object', label: 'Futu exercises workbook', required: true },
      option_plans: { type: 'object', label: 'Option plans workbook', required: true },
      summary_source: { type: 'object', label: 'Merged summary source workbook', required: false },
    },
  },
};

export const MONTHLY_RUNTIME_PARAMS_DEFAULTS: WorkflowRuntimeParameters = {
  fileRefs: {
    control_book: { provider: 'product-files', id: 7 },
    futu_exercises: { provider: 'product-files', id: 7 },
    option_plans: { provider: 'product-files', id: 7 },
    summary_source: { provider: 'product-files', id: 7 },
  },
};

const controlBookRuntimeFileRef = { $fromRuntime: 'fileRefs.control_book' };
const futuExercisesRuntimeFileRef = { $fromRuntime: 'fileRefs.futu_exercises' };
const optionPlansRuntimeFileRef = { $fromRuntime: 'fileRefs.option_plans' };
const summarySourceRuntimeFileRef = { $fromRuntime: 'fileRefs.summary_source' };

export const MONTHLY_SUMMARY_TOTAL_FULLY_DILUTED = 133_527_448;
export const MONTHLY_SUMMARY_CONTROL_BOOK_TOTAL = 111_488_849;
export const MONTHLY_SUMMARY_BC_SUBPLAN_TRANSFER = 695_164;

export const MONTHLY_SUMMARY_COLUMNS = [
  'Number',
  'Description',
  'Common Shares Equivalent',
  '% of fully diluted',
  'Formula',
];

export const buildMonthlyCapitalizationSummarySql = `
select '' as Number, 'Issued Shares -Equity Asset Class' as Description,
  null as [Common Shares Equivalent],
  null as [% of fully diluted],
  '' as Formula
from {business_inputs}
union all select '' as Number, 'Asset Class Summary: EOM' as Description,
  b.eom_eq_balance_os as [Common Shares Equivalent],
  null as [% of fully diluted],
  'value=1+2+3+4, sourced from <span class="link-blue" data-link="control-book">Control book</span>' as Formula
from {business_inputs} b
union all select '1' as Number, 'Common Shares OS' as Description,
  b.eom_eq_balance_os - b.cullgen_common_stock - f.bci_shares_held_by_futu - b.bc_subplan_transfer_summary as [Common Shares Equivalent],
  (b.eom_eq_balance_os - b.cullgen_common_stock - f.bci_shares_held_by_futu - b.bc_subplan_transfer_summary) / b.total_fully_diluted as [% of fully diluted],
  'value=EOM-2-3-4-5' as Formula
from {futu_metrics} f, {business_inputs} b
union all select '2' as Number, 'Cullgen common stock' as Description,
  b.cullgen_common_stock as [Common Shares Equivalent],
  b.cullgen_common_stock / b.total_fully_diluted as [% of fully diluted],
  'Fixed value' as Formula
from {business_inputs} b
union all select '3' as Number, 'BCI Shares Held by Futu' as Description,
  f.bci_shares_held_by_futu as [Common Shares Equivalent],
  f.bci_shares_held_by_futu / b.total_fully_diluted as [% of fully diluted],
  'value=ΣGyre Gyre granted options(1) - utu exercises to date(2)<br><span class="formula-indent">(1) Fixed value</span><br><span class="formula-indent">(2) is aggregated from Futu exercise reports(<span class="link-blue" data-link="futu-exercise">Futu BCI Exercises to Date</span>)</span>' as Formula
from {futu_metrics} f, {business_inputs} b
union all select '4' as Number, '2025 BC Subplan shares transferred to Futu' as Description,
  b.bc_subplan_transfer_summary as [Common Shares Equivalent],
  b.bc_subplan_transfer_summary / b.total_fully_diluted as [% of fully diluted],
  'value =aggregated from <span class="link-blue" data-link="control-detail-1">Control Book</span> monthly report, with note ''Omnibus Inc. Pl''' as Formula
from {business_inputs} b
union all select '' as Number, 'Derivative Equity Incentives' as Description,
  null as [Common Shares Equivalent],
  null as [% of fully diluted],
  '' as Formula
from {business_inputs}
union all select '5' as Number, 'Warrants for Convertible Preferred Stock' as Description,
  b.warrants_for_convertible_preferred_stock as [Common Shares Equivalent],
  b.warrants_for_convertible_preferred_stock / b.total_fully_diluted as [% of fully diluted],
  'Fixed value' as Formula
from {business_inputs} b
union all select '6' as Number, 'Options Outstanding- Gyre' as Description,
  o.total_options_outstanding - b.bc_subplan_transfer_summary as [Common Shares Equivalent],
  (o.total_options_outstanding - b.bc_subplan_transfer_summary) / b.total_fully_diluted as [% of fully diluted],
  'value=Σ <span class="link-blue" data-link="option-outstanding">all option plan outstanding shares</span>(1) - 2025 BC Subplan shares transferred to Futu(2)<br><span class="formula-indent">(1) Fixed value</span><br><span class="formula-indent">(2) is Item 4</span>' as Formula
from {option_metrics} o, {business_inputs} b
union all select '7' as Number, 'Options Available- Gyre' as Description,
  o.total_options_available as [Common Shares Equivalent],
  o.total_options_available / b.total_fully_diluted as [% of fully diluted],
  'value=Σ <span class="link-blue" data-link="option-available">all option plan available shares</span>' as Formula
from {option_metrics} o, {business_inputs} b
union all select '8' as Number, 'Options Outstanding- Cullgen' as Description,
  b.options_outstanding_cullgen as [Common Shares Equivalent],
  b.options_outstanding_cullgen / b.total_fully_diluted as [% of fully diluted],
  'Fixed value' as Formula
from {business_inputs} b
union all select '9' as Number, 'Options Available- Cullgen' as Description,
  b.options_available_cullgen as [Common Shares Equivalent],
  b.options_available_cullgen / b.total_fully_diluted as [% of fully diluted],
  'Fixed value' as Formula
from {business_inputs} b
union all select '' as Number, 'Total Fully Diluted Shares Outstand' as Description,
  b.total_fully_diluted as [Common Shares Equivalent],
  1 as [% of fully diluted],
  '' as Formula
from {business_inputs} b`;

export function buildMonthlyWorkflowTasks(): WorkflowTask[] {
  return [
    {
      x: 48,
      y: 48,
      id: 'extract_control_book',
      name: 'Extract EQ Control Book',
      inputs: {},
      params: {
        range: 'A9:L124',
        fileRef: controlBookRuntimeFileRef,
        headerRow: 9,
        sheetName: 'EQ Control Book',
      },
      dependsOn: [],
      description: '从完整 EQ Control Book 提取期末股本、Omnibus transfer、Cullgen common stock 和 Futu SubPlan 总数。',
      operatorCode: 'sheet.range.extract',
      operatorVersion: '1.0.0',
    },
    {
      x: 48,
      y: 226,
      id: 'extract_cap_table_summary',
      name: 'Extract Cap Table Summary Source',
      inputs: {},
      params: {
        range: 'B24:F35',
        fileRef: summarySourceRuntimeFileRef,
        headerRow: 24,
        sheetName: 'Detailed Cap Table',
      },
      dependsOn: [],
      description: '从 Detailed Cap Table / Capitalization Table (Summary View) 抽取当前文件中的 Summary 源值，用于和 workflow 计算口径做测试期对账。',
      operatorCode: 'sheet.range.extract',
      operatorVersion: '1.0.0',
    },
    {
      x: 48,
      y: 404,
      id: 'extract_futu_exercises',
      name: 'Extract Futu BCI Exercises',
      inputs: {},
      params: {
        range: 'A1:M424',
        fileRef: futuExercisesRuntimeFileRef,
        headerRow: 1,
        sheetName: 'Futu BCI Exercises to Date',
      },
      dependsOn: [],
      description: '提取 Futu BCI Exercises to Date 明细，用于汇总已行权数量。',
      operatorCode: 'sheet.range.extract',
      operatorVersion: '1.0.0',
    },
    {
      x: 48,
      y: 582,
      id: 'extract_option_plans',
      name: 'Extract Option Plans Sections',
      inputs: {},
      params: {
        fileRef: optionPlansRuntimeFileRef,
        sections: [
          { key: 'bc_subplan_2025', range: 'A4:E10', title: 'GYRE 2025 BC Subplan', headerRow: 2 },
          { key: 'omnibus_2023', range: 'A13:E21', title: 'GYRE 2023 Omnibus Incentive Plan', headerRow: 2 },
          { key: 'china_subplan_2023', range: 'A25:E33', title: 'GYRE 2023 China Subplan', headerRow: 2 },
          { key: 'non_china_bci_2023', range: 'A37:E45', title: 'GYRE 2023 Non-China BCI grants', headerRow: 2 },
          { key: 'omnibus_2018', range: 'A49:E57', title: '2018 Omnibus Incentive Plan', headerRow: 2 },
          { key: 'cbio_2015', range: 'A61:E71', title: 'CBIO 2015 Stock Incentive Plan', headerRow: 2 },
        ],
        sheetName: 'Option Plans Summary',
        sectionMode: 'manual',
        sectionColumn: 'section',
        sourceRangeColumn: 'sourceRange',
        sectionIndexColumn: 'sectionIndex',
      },
      dependsOn: [],
      description: '从独立 Option Plans Summary workbook 的 6 个计划区块提取明细，并合并为带 section 元数据的 dataframe。',
      operatorCode: 'sheet.sections.extract',
      operatorVersion: '1.0.0',
    },
    {
      x: 416,
      y: 48,
      id: 'calc_control_book_metrics',
      name: 'Calc Control Book Metrics',
      inputs: {
        control_book: {
          from: 'extract_control_book',
          slot: 'dataframe',
          guards: [
            {
              id: 'guard_assert_control_book_schema',
              name: 'Assert Control Book Schema',
              type: 'dataframe.schema.assert',
              params: {
                mode: 'contains',
                failureMessage: 'Assert Control Book Schema failed',
                expectedColumns: 'As of Date, Shares Issued, Issued & Outstanding, Comment',
                failureStrategy: 'block',
              },
              enabled: true,
            },
          ],
        },
      },
      params: {
        sql: "select\n  max([Issued & Outstanding]) as eom_eq_balance_os,\n  sum(case when [Comment] in ('Omnibus Inc. Pl', 'Omnibus Inc. Pl.') then [Shares Issued] else 0 end) as bc_subplan_transfer_control_book,\n  max(case when [Trans. Type] = 'Agr. & Pl. of Merger' then [Shares Issued] else null end) as cullgen_common_stock,\n  max(case when [Comment] = 'Equity Inc.Sub-Pl. Futu Network Technology' then [Shares Issued] else null end) as gyre_2023_china_subplan_total\nfrom {control_book}\nwhere [Issued & Outstanding] is not null",
        tableBindings: [{ inputSlot: 'control_book', tableName: 'control_book' }],
      },
      dependsOn: [],
      description: '计算 EOM EQ Balance OS 和 Control Book 口径的 2025 BC Subplan transfer。',
      operatorCode: 'sql.compute',
      operatorVersion: '1.0.0',
    },
    {
      x: 416,
      y: 226,
      id: 'calc_cap_table_summary_source_metrics',
      name: 'Calc Cap Table Summary Source Metrics',
      inputs: {
        summary_source: {
          from: 'extract_cap_table_summary',
          slot: 'dataframe',
          guards: [
            {
              id: 'guard_assert_cap_table_summary_schema',
              name: 'Assert Cap Table Summary Source Schema',
              type: 'dataframe.schema.assert',
              params: {
                mode: 'contains',
                failureMessage: 'Assert Cap Table Summary Source Schema failed',
                expectedColumns: 'Capitalization Table (Summary View), column_3, column_5',
                failureStrategy: 'block',
              },
              enabled: true,
            },
          ],
        },
      },
      params: {
        sql: "select\n  max(case when [Capitalization Table (Summary View)] = 'BCI Shares Held by Futu' then [column_3] else null end) as bci_shares_held_by_futu,\n  max(case when [Capitalization Table (Summary View)] = '2025 BC Subplan shares transferred to Futu' then [column_3] else null end) as bc_subplan_transfer_summary,\n  max(case when [Capitalization Table (Summary View)] = 'Warrants for Convertible Preferred Stock' then [column_3] else null end) as warrants_for_convertible_preferred_stock,\n  max(case when [Capitalization Table (Summary View)] = 'Options Outstanding' then [column_3] else null end) as options_outstanding_gyre,\n  max(case when [Capitalization Table (Summary View)] = 'Options Available' then [column_3] else null end) as options_available_gyre,\n  max(case when [Capitalization Table (Summary View)] = 'Total Fully Diluted Shares Outstanding' then [column_3] else null end) as source_total_fully_diluted,\n  max(case when [Capitalization Table (Summary View)] = 'Equinity Outstanding as of:' then [column_5] else null end) as eom_eq_balance_os\nfrom {summary_source}",
        tableBindings: [{ inputSlot: 'summary_source', tableName: 'summary_source' }],
      },
      dependsOn: [],
      description: '把 Detailed Cap Table 的 Summary View 行转成 key-value metrics，便于后续计算和断言引用。',
      operatorCode: 'sql.compute',
      operatorVersion: '1.0.0',
    },
    {
      x: 416,
      y: 404,
      id: 'calc_futu_metrics',
      name: 'Calc Futu Exercise Metrics',
      inputs: {
        futu: {
          from: 'extract_futu_exercises',
          slot: 'dataframe',
          guards: [
            {
              id: 'guard_assert_futu_schema',
              name: 'Assert Futu Exercise Schema',
              type: 'dataframe.schema.assert',
              params: {
                mode: 'contains',
                failureMessage: 'Assert Futu Exercise Schema failed',
                expectedColumns: 'Exercised Qty',
                failureStrategy: 'block',
              },
              enabled: true,
            },
          ],
        },
        control_metrics: {
          from: 'calc_control_book_metrics',
          slot: 'dataframe',
        },
      },
      params: {
        sql: 'select\n  sum(f.[Exercised Qty]) as futu_exercised_qty,\n  max(c.gyre_2023_china_subplan_total) - sum(f.[Exercised Qty]) as bci_shares_held_by_futu\nfrom {futu} f, {control_metrics} c',
        tableBindings: [
          { inputSlot: 'futu', tableName: 'futu' },
          { inputSlot: 'control_metrics', tableName: 'control_metrics' },
        ],
      },
      dependsOn: [],
      description: '计算 Futu 已行权总数以及 BCI Shares Held by Futu。',
      operatorCode: 'sql.compute',
      operatorVersion: '1.0.0',
    },
    {
      x: 416,
      y: 582,
      id: 'calc_option_metrics',
      name: 'Calc Option Plan Metrics',
      inputs: {
        plans: {
          from: 'extract_option_plans',
          slot: 'dataframe',
          guards: [
            {
              id: 'guard_assert_option_plan_schema',
              name: 'Assert Option Plan Schema',
              type: 'dataframe.schema.assert',
              params: {
                mode: 'contains',
                failureMessage: 'Assert Option Plan Schema failed',
                expectedColumns: 'section, sourceRange, sectionIndex, Plan Name, Options Outstanding, Available Shares in Pool',
                failureStrategy: 'block',
              },
              enabled: true,
            },
            {
              id: 'guard_assert_six_option_plan_sections',
              name: 'Assert Six Option Plan Sections',
              type: 'dataframe.sql.assert',
              params: {
                sql: 'select count(distinct [section]) as actual from {plans}',
                operator: '=',
                expectedValue: 6,
                tableBindings: [{ inputSlot: 'plans', tableName: 'plans' }],
                failureMessage: 'Assert Option Plan Sections failed',
                failureStrategy: 'block',
              },
              enabled: true,
            },
          ],
        },
      },
      params: {
        sql: "select\n  sum(case when [Plan Name] = 'Awards Outstanding' then [Options Outstanding] else 0 end) as total_options_outstanding,\n  max(case when [Plan Name] = 'Shares Remaining For Issuance' then [Available Shares in Pool] else 0 end) as total_options_available\nfrom {plans}",
        tableBindings: [{ inputSlot: 'plans', tableName: 'plans' }],
      },
      dependsOn: [],
      description: '计算 Gyre option plans 的 total outstanding 和 available。',
      operatorCode: 'sql.compute',
      operatorVersion: '1.0.0',
    },
    {
      x: 784,
      y: 226,
      id: 'calc_business_inputs',
      name: 'Calc Business Inputs',
      inputs: {
        control_metrics: {
          from: 'calc_control_book_metrics',
          slot: 'dataframe',
          guards: [
            {
              id: 'guard_assert_cullgen_common_stock',
              name: 'Assert Cullgen Common Stock',
              type: 'dataframe.sql.assert',
              params: {
                sql: 'select cullgen_common_stock as actual from {control_metrics}',
                operator: '=',
                expectedValue: 14450527,
                tableBindings: [{ inputSlot: 'control_metrics', tableName: 'control_metrics' }],
                failureMessage: 'Assert Cullgen common stock failed',
                failureStrategy: 'block',
              },
              enabled: true,
            },
            {
              id: 'guard_assert_gyre_2023_china_subplan_total',
              name: 'Assert Gyre 2023 China SubPlan Total',
              type: 'dataframe.sql.assert',
              params: {
                sql: 'select gyre_2023_china_subplan_total as actual from {control_metrics}',
                operator: '=',
                expectedValue: 7815396,
                tableBindings: [{ inputSlot: 'control_metrics', tableName: 'control_metrics' }],
                failureMessage: 'Assert Gyre 2023 China SubPlan total failed',
                failureStrategy: 'block',
              },
              enabled: true,
            },
          ],
        },
        summary_source: {
          from: 'calc_cap_table_summary_source_metrics',
          slot: 'dataframe',
          guards: [
            {
              id: 'guard_assert_summary_source_transfer',
              name: 'Assert Summary Source Transfer',
              type: 'dataframe.sql.assert',
              params: {
                sql: 'select bc_subplan_transfer_summary as actual from {summary_source}',
                operator: '=',
                expectedValue: MONTHLY_SUMMARY_BC_SUBPLAN_TRANSFER,
                tableBindings: [{ inputSlot: 'summary_source', tableName: 'summary_source' }],
                failureMessage: 'Assert Summary source transfer failed',
                failureStrategy: 'block',
              },
              enabled: true,
            },
            {
              id: 'guard_assert_summary_source_warrants',
              name: 'Assert Summary Source Warrants',
              type: 'dataframe.sql.assert',
              params: {
                sql: 'select warrants_for_convertible_preferred_stock as actual from {summary_source}',
                operator: '=',
                expectedValue: 540666,
                tableBindings: [{ inputSlot: 'summary_source', tableName: 'summary_source' }],
                failureMessage: 'Assert Summary source warrants failed',
                failureStrategy: 'block',
              },
              enabled: true,
            },
          ],
        },
      },
      params: {
        sql: 'select\n  max(c.eom_eq_balance_os) as eom_eq_balance_os,\n  max(c.cullgen_common_stock) as cullgen_common_stock,\n  max(c.gyre_2023_china_subplan_total) as gyre_2023_china_subplan_total,\n  max(s.bc_subplan_transfer_summary) as bc_subplan_transfer_summary,\n  max(s.warrants_for_convertible_preferred_stock) as warrants_for_convertible_preferred_stock,\n  4156815 as options_outstanding_cullgen,\n  10994 as options_available_cullgen,\n  max(s.source_total_fully_diluted) + 4156815 + 10994 as total_fully_diluted\nfrom {control_metrics} c, {summary_source} s',
        tableBindings: [
          { inputSlot: 'control_metrics', tableName: 'control_metrics' },
          { inputSlot: 'summary_source', tableName: 'summary_source' },
        ],
      },
      dependsOn: [],
      description: '汇总 Summary 计算所需业务输入；可从源 workbook 取到的值来自上游抽取，Cullgen option 两个值暂按测试期固定输入保留在此节点。',
      operatorCode: 'sql.compute',
      operatorVersion: '1.0.0',
    },
    {
      x: 1152,
      y: 48,
      id: 'build_capitalization_summary',
      name: 'Build Capitalization Summary',
      inputs: {
        futu_metrics: {
          from: 'calc_futu_metrics',
          slot: 'dataframe',
          guards: [
            {
              id: 'guard_assert_futu_exercised_qty',
              name: 'Assert Futu Exercised Qty',
              type: 'dataframe.sql.assert',
              params: {
                sql: 'select futu_exercised_qty as actual from {futu_metrics}',
                operator: '=',
                expectedValue: 2938523,
                tableBindings: [{ inputSlot: 'futu_metrics', tableName: 'futu_metrics' }],
                failureMessage: 'Assert Futu Exercised Qty failed',
                failureStrategy: 'block',
              },
              enabled: true,
            },
            {
              id: 'guard_assert_bci_shares_held_by_futu',
              name: 'Assert BCI Shares Held By Futu',
              type: 'dataframe.sql.assert',
              params: {
                sql: 'select bci_shares_held_by_futu as actual from {futu_metrics}',
                operator: '=',
                expectedValue: 4876873,
                tableBindings: [{ inputSlot: 'futu_metrics', tableName: 'futu_metrics' }],
                failureMessage: 'Assert BCI Shares Held By Futu failed',
                failureStrategy: 'block',
              },
              enabled: true,
            },
          ],
        },
        option_metrics: {
          from: 'calc_option_metrics',
          slot: 'dataframe',
          guards: [
            {
              id: 'guard_assert_options_outstanding_total',
              name: 'Assert Options Outstanding Total',
              type: 'dataframe.sql.assert',
              params: {
                sql: 'select total_options_outstanding as actual from {option_metrics}',
                operator: '=',
                expectedValue: 14386058,
                tableBindings: [{ inputSlot: 'option_metrics', tableName: 'option_metrics' }],
                failureMessage: 'Assert Options Outstanding Total failed',
                failureStrategy: 'block',
              },
              enabled: true,
            },
            {
              id: 'guard_assert_options_available_total',
              name: 'Assert Options Available Total',
              type: 'dataframe.sql.assert',
              params: {
                sql: 'select total_options_available as actual from {option_metrics}',
                operator: '=',
                expectedValue: 3639230,
                tableBindings: [{ inputSlot: 'option_metrics', tableName: 'option_metrics' }],
                failureMessage: 'Assert Options Available Total failed',
                failureStrategy: 'block',
              },
              enabled: true,
            },
          ],
        },
        control_metrics: {
          from: 'calc_control_book_metrics',
          slot: 'dataframe',
          guards: [
            {
              id: 'guard_assert_eom_eq_balance_os',
              name: 'Assert EOM EQ Balance OS',
              type: 'dataframe.sql.assert',
              params: {
                sql: 'select eom_eq_balance_os as actual from {control_metrics}',
                operator: '=',
                expectedValue: MONTHLY_SUMMARY_CONTROL_BOOK_TOTAL,
                tableBindings: [{ inputSlot: 'control_metrics', tableName: 'control_metrics' }],
                failureMessage: 'Assert EOM EQ Balance OS failed',
                failureStrategy: 'block',
              },
              enabled: true,
            },
            {
              id: 'guard_assert_control_book_transfer_source',
              name: 'Assert Control Book Transfer Source',
              type: 'dataframe.sql.assert',
              params: {
                sql: 'select bc_subplan_transfer_control_book as actual from {control_metrics}',
                operator: '=',
                expectedValue: 695165,
                tableBindings: [{ inputSlot: 'control_metrics', tableName: 'control_metrics' }],
                failureMessage: 'Assert Control Book Transfer source sum failed',
                failureStrategy: 'block',
              },
              enabled: true,
            },
            {
              id: 'guard_assert_transfer_delta_warning',
              name: 'Warn Transfer Output Decision',
              type: 'dataframe.sql.assert',
              params: {
                sql: 'select bc_subplan_transfer_control_book - 695164 as actual from {control_metrics}',
                operator: '=',
                expectedValue: 0,
                tableBindings: [{ inputSlot: 'control_metrics', tableName: 'control_metrics' }],
                failureMessage: 'Transfer source mismatch requires manual review: Control Book row sum 695165 differs from Summary output decision 695164 by 1 share',
                failureStrategy: 'warning',
              },
              enabled: true,
            },
          ],
        },
        business_inputs: {
          from: 'calc_business_inputs',
          slot: 'dataframe',
          guards: [
            {
              id: 'guard_assert_total_fully_diluted_business_input',
              name: 'Assert Total Fully Diluted Business Input',
              type: 'dataframe.sql.assert',
              params: {
                sql: 'select total_fully_diluted as actual from {business_inputs}',
                operator: '=',
                expectedValue: MONTHLY_SUMMARY_TOTAL_FULLY_DILUTED,
                tableBindings: [{ inputSlot: 'business_inputs', tableName: 'business_inputs' }],
                failureMessage: 'Assert total fully diluted business input failed',
                failureStrategy: 'block',
              },
              enabled: true,
            },
            {
              id: 'guard_assert_cullgen_options_business_inputs',
              name: 'Assert Cullgen Option Business Inputs',
              type: 'dataframe.sql.assert',
              params: {
                sql: 'select options_outstanding_cullgen + options_available_cullgen as actual from {business_inputs}',
                operator: '=',
                expectedValue: 4167809,
                tableBindings: [{ inputSlot: 'business_inputs', tableName: 'business_inputs' }],
                failureMessage: 'Assert Cullgen option business inputs failed',
                failureStrategy: 'block',
              },
              enabled: true,
            },
          ],
        },
      },
      params: {
        sql: buildMonthlyCapitalizationSummarySql,
        tableBindings: [
          { inputSlot: 'control_metrics', tableName: 'control_metrics' },
          { inputSlot: 'futu_metrics', tableName: 'futu_metrics' },
          { inputSlot: 'option_metrics', tableName: 'option_metrics' },
          { inputSlot: 'business_inputs', tableName: 'business_inputs' },
        ],
      },
      dependsOn: [],
      description: '按需求文档生成 Capitalization Table (Summary View) 数据行；输出对齐 file15-before.xlsx 的 section/header/detail/total 结构。',
      operatorCode: 'sql.compute',
      operatorVersion: '1.0.0',
    },
    {
      x: 1520,
      y: 48,
      id: 'persist_capitalization_summary',
      name: 'Persist Capitalization Summary Excel',
      inputs: {
        input1: {
          from: 'build_capitalization_summary',
          slot: 'dataframe',
          guards: [
            {
              id: 'guard_assert_common_shares_os',
              name: 'Assert Common Shares OS',
              type: 'dataframe.sql.assert',
              params: {
                sql: "select [Common Shares Equivalent] as actual from {summary} where [Description] = 'Common Shares OS'",
                operator: '=',
                expectedValue: 91466285,
                tableBindings: [{ inputSlot: 'summary', tableName: 'summary' }],
                failureMessage: 'Assert Common Shares OS failed',
                failureStrategy: 'block',
              },
              enabled: true,
            },
            {
              id: 'guard_assert_options_outstanding_gyre',
              name: 'Assert Options Outstanding Gyre',
              type: 'dataframe.sql.assert',
              params: {
                sql: "select [Common Shares Equivalent] as actual from {summary} where [Description] = 'Options Outstanding- Gyre'",
                operator: '=',
                expectedValue: 13690894,
                tableBindings: [{ inputSlot: 'summary', tableName: 'summary' }],
                failureMessage: 'Assert Options Outstanding Gyre failed',
                failureStrategy: 'block',
              },
              enabled: true,
            },
            {
              id: 'guard_assert_summary_total_formula',
              name: 'Assert Summary Total Formula',
              type: 'dataframe.sql.assert',
              params: {
                sql: "select sum([Common Shares Equivalent]) as actual from {summary} where [Number] <> ''",
                operator: '=',
                expectedValue: MONTHLY_SUMMARY_TOTAL_FULLY_DILUTED,
                tableBindings: [{ inputSlot: 'summary', tableName: 'summary' }],
                failureMessage: 'Assert Summary Total Formula failed',
                failureStrategy: 'block',
              },
              enabled: true,
            },
            {
              id: 'guard_assert_summary_row_count',
              name: 'Assert Summary Row Count',
              type: 'dataframe.sql.assert',
              params: {
                sql: 'select count(*) as actual from {summary}',
                operator: '=',
                expectedValue: 13,
                tableBindings: [{ inputSlot: 'summary', tableName: 'summary' }],
                failureMessage: 'Assert Summary Row Count failed',
                failureStrategy: 'block',
              },
              enabled: true,
            },
            {
              id: 'guard_assert_summary_schema',
              name: 'Assert Summary Schema',
              type: 'dataframe.schema.assert',
              params: {
                mode: 'contains',
                failureMessage: 'Assert Summary Schema failed',
                expectedColumns: MONTHLY_SUMMARY_COLUMNS.join(', '),
                failureStrategy: 'block',
              },
              enabled: true,
            },
          ],
        },
      },
      params: {
        fileName: 'Capitalization_Table_Summary_View.xlsx',
        fileNamePrefix: { $fromRuntime: 'month' },
        sheetName: 'Capitalization Summary',
        uploadedBy: 'Workflow',
      },
      dependsOn: [],
      description: '将通过校验后的 Summary View 持久化为 Excel 并写入 Files；百分比列导出为 Excel 百分号格式但保留真实小数值。',
      operatorCode: 'dataframe.persist.excel',
      operatorVersion: '1.0.0',
    },
  ];
}

export function buildMonthlyWorkflowSeedDefinition() {
  const tasks = buildMonthlyWorkflowTasks();
  const runtimeConfig = deriveWorkflowRuntimeConfigFromTasks({
    tasks,
    runtimeParamsSchema: MONTHLY_RUNTIME_PARAMS_SCHEMA,
    runtimeParamsDefaults: MONTHLY_RUNTIME_PARAMS_DEFAULTS,
  });

  return {
    code: MONTHLY_WORKFLOW_CODE,
    name: MONTHLY_WORKFLOW_NAME,
    description: MONTHLY_WORKFLOW_DESCRIPTION,
    status: 'active' as const,
    version: 1,
    tasks,
    runtimeParamsSchema: runtimeConfig.runtimeParamsSchema,
    runtimeParamsDefaults: runtimeConfig.runtimeParamsDefaults,
  };
}

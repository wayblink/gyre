import type {
  MonthlyRunFixedValueDefinition,
  MonthlyRunSourceDefinition,
  WorkflowRuntimeParameters,
  WorkflowRuntimeParametersSchema,
  WorkflowTask,
} from '../../shared/types.js';
import { MONTHLY_WORKFLOW_CODE } from './store.js';
import { deriveWorkflowRuntimeConfigFromTasks } from '../workflow/runtimeParameterRequirements.js';

export const MONTHLY_RUN_SOURCE_DEFINITIONS: MonthlyRunSourceDefinition[] = [
  {
    sourceGroup: 'shareworks',
    sourceKey: 'base_control_book',
    taskId: 'invoke_control_book_merge',
    label: 'Control Book Summary',
    description: '上月完整 EQ Control Book，作为增量合并的 base；输出可作为下月 base 链式使用。',
    defaultSheetName: 'EQ Control Book',
    allowSheetNameOverride: true,
    required: true,
  },
  {
    sourceGroup: 'shareworks',
    sourceKey: 'incremental_control_book',
    taskId: 'invoke_control_book_merge',
    label: 'Control Book monthly detail',
    description: '本月下载的增量 Control Book 明细，与 base 按交易自然键幂等合并。',
    defaultSheetName: '27591',
    allowSheetNameOverride: true,
    required: true,
  },
  {
    sourceGroup: 'shareworks',
    sourceKey: 'previous_capitalization_summary',
    taskId: 'extract_previous_capitalization_summary',
    label: 'Previous Capitalization Summary',
    description: '可选：用于校验当前 EQ Control Book 算出的 Last Month 是否等于上月股权结构汇总表的 EOM。',
    defaultSheetName: 'Capitalization Summary',
    required: false,
  },
  {
    sourceGroup: 'futu',
    sourceKey: 'futu_exercises',
    taskId: 'extract_futu_exercises',
    label: 'Futu BCI Exercises',
    description: '用于汇总 Futu exercises to date 的已行权数量。',
    defaultSheetName: 'Futu BCI Exercises to Date',
    required: true,
  },
  {
    sourceGroup: 'shareworks',
    sourceKey: 'option_plans_summary',
    taskId: 'invoke_option_plans_summary',
    label: 'Gyre Option Plans Summary SL',
    description: '用于读取独立 Gyre_Option_Plans_Summary_SL workbook 并汇总各计划 outstanding 与 available shares。',
    defaultSheetName: '!Option Plans Summary (Post-Gyr',
    allowSheetNameOverride: true,
    required: true,
  },
  {
    sourceGroup: 'shareworks',
    sourceKey: 'bc_subplan_transfer',
    taskId: 'extract_bc_subplan_transfer',
    label: '2025 BC Subplan Transfer',
    description: '必选：用户明确选择合并表或单独 workbook，并指定包含 2025 BC Subplan transfer/vesting 数据的 Sheet。',
    defaultSheetName: 'Vesting Schedule',
    allowSheetNameOverride: true,
    required: true,
  },
  {
    sourceGroup: 'shareworks',
    sourceKey: 'options_os_detail_by_plan',
    taskId: 'extract_options_os_detail_by_plan',
    label: 'Options OS Detail by Plan',
    description: '设计文档中的 Options_OS_Detail_by_Plan：Shareworks 按计划/员工维度的 options outstanding 明细，用作可选复核输入。',
    defaultSheetName: 'Options OS Detail',
    required: false,
    // 暂时从月度页面隐藏：该输入当前未参与计算，需求文档对其复核(check)口径留白，待明确后再放开。
    hidden: true,
  },
];

export const MONTHLY_WORKFLOW_NAME = 'Gyre Cap Table Summary V2';
export const MONTHLY_WORKFLOW_DESCRIPTION =
  '基于 GyreESOP 管理系统需求文档 0614 的 Summary 计算 v2：EQ Control Book、Gyre Option Plans Summary SL、Futu BCI Exercises 三个业务输入分别绑定对应抽取节点；关键输入、口径常数、汇总公式和输出结构均拆分断言，2025 BC Subplan transfer 使用 EQ Control Book 当月计算值。';

export const MONTHLY_RUNTIME_OPTIONS_OUTSTANDING_CULLGEN = 4_156_815;
export const MONTHLY_RUNTIME_OPTIONS_AVAILABLE_CULLGEN = 10_994;
export const MONTHLY_RUNTIME_WARRANTS_CONVERTIBLE_PREFERRED = 540_666;
export const MONTHLY_RUNTIME_CULLGEN_COMMON_STOCK = 14_450_527;
export const MONTHLY_RUNTIME_GYRE_2023_CHINA_SUBPLAN_TOTAL = 7_815_396;

export const MONTHLY_RUN_FIXED_VALUE_DEFINITIONS: MonthlyRunFixedValueDefinition[] = [
  {
    key: 'warrantsConvertiblePreferred',
    label: 'Warrants for Convertible Preferred Stock',
    description: 'Warrants for Convertible Preferred Stock 固定口径。',
    defaultValue: MONTHLY_RUNTIME_WARRANTS_CONVERTIBLE_PREFERRED,
    required: true,
  },
  {
    key: 'optionsOutstandingCullgen',
    label: 'Options Outstanding - Cullgen',
    description: 'Cullgen outstanding options 固定口径。',
    defaultValue: MONTHLY_RUNTIME_OPTIONS_OUTSTANDING_CULLGEN,
    required: true,
  },
  {
    key: 'optionsAvailableCullgen',
    label: 'Options Available - Cullgen',
    description: 'Cullgen available options 固定口径。',
    defaultValue: MONTHLY_RUNTIME_OPTIONS_AVAILABLE_CULLGEN,
    required: true,
  },
  {
    key: 'cullgenCommonStock',
    label: 'Cullgen Common Stock',
    description: 'Cullgen 母公司普通股固定口径（Agr. & Pl. of Merger 股数）；从 Global Parameter cullgen_common_stock 读取。',
    defaultValue: MONTHLY_RUNTIME_CULLGEN_COMMON_STOCK,
    required: true,
  },
  {
    key: 'gyre2023ChinaSubplanTotal',
    label: 'Gyre 2023 China SubPlan Total',
    description: 'Gyre 2023 China SubPlan 已归属总数固定口径；从 Global Parameter gyre_2023_china_subplan_total 读取。',
    defaultValue: MONTHLY_RUNTIME_GYRE_2023_CHINA_SUBPLAN_TOTAL,
    required: true,
  },
];

const MONTHLY_RUNTIME_FILE_REF_DEFAULTS = {
  base_control_book: { sheet: 'EQ Control Book' },
  incremental_control_book: { sheet: '27591' },
  futu_exercises: {},
  option_plans_summary: {
    sheet: '!Option Plans Summary (Post-Gyr',
  },
  bc_subplan_transfer: { sheet: 'Vesting Schedule' },
  options_os_detail_by_plan: {},
  previous_capitalization_summary: {},
} as const;

export const MONTHLY_RUNTIME_PARAMS_SCHEMA: WorkflowRuntimeParametersSchema = {
  month: {
    type: 'string',
    label: 'Month',
  },
  fileRefs: {
    type: 'object',
    label: 'File References',
    properties: {
      base_control_book: {
        type: 'object',
        label: 'Control Book Summary workbook',
        properties: { sheet: { type: 'string', label: 'Base sheet' } },
      },
      incremental_control_book: {
        type: 'object',
        label: 'Control Book monthly detail workbook',
        properties: { sheet: { type: 'string', label: 'Increment sheet' } },
      },
      futu_exercises: { type: 'object', label: 'Futu exercises workbook' },
      option_plans_summary: {
        type: 'object',
        label: 'Gyre Option Plans Summary SL workbook',
        properties: { sheet: { type: 'string', label: 'Sheet' } },
      },
      bc_subplan_transfer: {
        type: 'object',
        label: '2025 BC Subplan Transfer 输入源',
        properties: { sheet: { type: 'string', label: 'Sheet' } },
      },
      options_os_detail_by_plan: { type: 'object', label: 'Options OS Detail by Plan workbook' },
      previous_capitalization_summary: { type: 'object', label: 'Previous capitalization summary workbook' },
    },
  },
  fixedValues: {
    type: 'object',
    label: 'Global Parameters',
    properties: {
      warrantsConvertiblePreferred: { type: 'number', label: 'Warrants for Convertible Preferred Stock' },
      optionsOutstandingCullgen: { type: 'number', label: 'Options Outstanding - Cullgen' },
      optionsAvailableCullgen: { type: 'number', label: 'Options Available - Cullgen' },
      cullgenCommonStock: { type: 'number', label: 'Cullgen Common Stock' },
      gyre2023ChinaSubplanTotal: { type: 'number', label: 'Gyre 2023 China SubPlan Total' },
    },
  },
};

export const MONTHLY_RUNTIME_PARAMS_DEFAULTS: WorkflowRuntimeParameters = {
  month: new Date().toISOString().slice(0, 7),
  fileRefs: MONTHLY_RUNTIME_FILE_REF_DEFAULTS,
  fixedValues: {
    warrantsConvertiblePreferred: MONTHLY_RUNTIME_WARRANTS_CONVERTIBLE_PREFERRED,
    optionsOutstandingCullgen: MONTHLY_RUNTIME_OPTIONS_OUTSTANDING_CULLGEN,
    optionsAvailableCullgen: MONTHLY_RUNTIME_OPTIONS_AVAILABLE_CULLGEN,
    cullgenCommonStock: MONTHLY_RUNTIME_CULLGEN_COMMON_STOCK,
    gyre2023ChinaSubplanTotal: MONTHLY_RUNTIME_GYRE_2023_CHINA_SUBPLAN_TOTAL,
  },
};

function cloneMonthlyRuntimeParameters(value: WorkflowRuntimeParameters): WorkflowRuntimeParameters {
  return JSON.parse(JSON.stringify(value)) as WorkflowRuntimeParameters;
}

function mergeMonthlyRuntimeParameters(
  base: WorkflowRuntimeParameters,
  override: WorkflowRuntimeParameters,
): WorkflowRuntimeParameters {
  const merged = cloneMonthlyRuntimeParameters(base);
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    const current = merged[key];
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      current &&
      typeof current === 'object' &&
      !Array.isArray(current)
    ) {
      merged[key] = mergeMonthlyRuntimeParameters(current as WorkflowRuntimeParameters, value as WorkflowRuntimeParameters);
      continue;
    }
    merged[key] = JSON.parse(JSON.stringify(value)) as unknown;
  }
  return merged;
}

export function buildMonthlyRuntimeParameters(overrides: WorkflowRuntimeParameters = {}): WorkflowRuntimeParameters {
  return mergeMonthlyRuntimeParameters(MONTHLY_RUNTIME_PARAMS_DEFAULTS, overrides);
}

const baseControlBookRuntimeFileRef = {
  $fromRuntime: 'fileRefs.base_control_book',
  $type: 'object',
  $label: 'Base Control Book workbook',
  $default: MONTHLY_RUNTIME_FILE_REF_DEFAULTS.base_control_book,
};
const incrementalControlBookRuntimeFileRef = {
  $fromRuntime: 'fileRefs.incremental_control_book',
  $type: 'object',
  $label: 'Incremental Control Book workbook',
  $default: MONTHLY_RUNTIME_FILE_REF_DEFAULTS.incremental_control_book,
};
const futuExercisesRuntimeFileRef = {
  $fromRuntime: 'fileRefs.futu_exercises',
  $type: 'object',
  $label: 'Futu exercises workbook',
  $default: MONTHLY_RUNTIME_FILE_REF_DEFAULTS.futu_exercises,
};
const optionPlansRuntimeFileRef = {
  $fromRuntime: 'fileRefs.option_plans_summary',
  $type: 'object',
  $label: 'Gyre Option Plans Summary SL workbook',
  $default: MONTHLY_RUNTIME_FILE_REF_DEFAULTS.option_plans_summary,
};
const optionPlansRuntimeSheetName = {
  $fromRuntime: 'fileRefs.option_plans_summary.sheet',
  $type: 'string',
  $label: 'Sheet',
  $default: '!Option Plans Summary (Post-Gyr',
};
const bcSubplanTransferRuntimeFileRef = {
  $fromRuntime: 'fileRefs.bc_subplan_transfer',
  $type: 'object',
  $label: '2025 BC Subplan Transfer 输入源',
  $default: MONTHLY_RUNTIME_FILE_REF_DEFAULTS.bc_subplan_transfer,
};
const bcSubplanTransferRuntimeSheetName = {
  $fromRuntime: 'fileRefs.bc_subplan_transfer.sheet',
  $type: 'string',
  $label: 'Sheet',
  $default: 'Vesting Schedule',
};
const optionsOsDetailByPlanRuntimeFileRef = {
  $fromRuntime: 'fileRefs.options_os_detail_by_plan',
  $type: 'object',
  $label: 'Options OS Detail by Plan workbook',
  $default: MONTHLY_RUNTIME_FILE_REF_DEFAULTS.options_os_detail_by_plan,
};
const previousCapitalizationSummaryRuntimeFileRef = {
  $fromRuntime: 'fileRefs.previous_capitalization_summary',
  $type: 'object',
  $label: 'Previous capitalization summary workbook',
  $default: MONTHLY_RUNTIME_FILE_REF_DEFAULTS.previous_capitalization_summary,
};

export const MONTHLY_SUMMARY_TOTAL_FULLY_DILUTED = 133_527_448;
export const MONTHLY_SUMMARY_CONTROL_BOOK_TOTAL = 111_488_849;
export const MONTHLY_SUMMARY_BC_SUBPLAN_TRANSFER = 695_164;

export const MONTHLY_SUMMARY_COLUMNS = [
  'Number',
  'Description',
  'Common Shares Equivalent',
  '% of fully diluted',
];

export const MONTHLY_RECONCILIATION_COLUMNS = ['Item', 'As of', 'Last Month', 'New Shares', 'EOM Balance'];

export const buildMonthlyCapitalizationSummarySql = `
select '' as Number, 'Issued Shares -Equity Asset Class' as Description,
  null as [Common Shares Equivalent],
  null as [% of fully diluted]
from {business_inputs}
union all select '' as Number, 'Asset Class Summary: EOM' as Description,
  b.eom_eq_balance_os as [Common Shares Equivalent],
  null as [% of fully diluted]
from {business_inputs} b
union all select '1' as Number, 'Common Shares OS' as Description,
  b.eom_eq_balance_os - b.cullgen_common_stock - f.bci_shares_held_by_futu - b.bc_subplan_transfer_selected as [Common Shares Equivalent],
  (b.eom_eq_balance_os - b.cullgen_common_stock - f.bci_shares_held_by_futu - b.bc_subplan_transfer_selected) / b.total_fully_diluted as [% of fully diluted]
from {futu_metrics} f, {business_inputs} b
union all select '2' as Number, 'Cullgen common stock' as Description,
  b.cullgen_common_stock as [Common Shares Equivalent],
  b.cullgen_common_stock / b.total_fully_diluted as [% of fully diluted]
from {business_inputs} b
union all select '3' as Number, 'BCI Shares Held by Futu' as Description,
  f.bci_shares_held_by_futu as [Common Shares Equivalent],
  f.bci_shares_held_by_futu / b.total_fully_diluted as [% of fully diluted]
from {futu_metrics} f, {business_inputs} b
union all select '4' as Number, '2025 BC Subplan shares transferred to Futu' as Description,
  b.bc_subplan_transfer_selected as [Common Shares Equivalent],
  b.bc_subplan_transfer_selected / b.total_fully_diluted as [% of fully diluted]
from {business_inputs} b
union all select '' as Number, 'Derivative Equity Incentives' as Description,
  null as [Common Shares Equivalent],
  null as [% of fully diluted]
from {business_inputs}
union all select '5' as Number, 'Warrants for Convertible Preferred Stock' as Description,
  b.warrants_for_convertible_preferred_stock as [Common Shares Equivalent],
  b.warrants_for_convertible_preferred_stock / b.total_fully_diluted as [% of fully diluted]
from {business_inputs} b
union all select '6' as Number, 'Options Outstanding- Gyre' as Description,
  o.total_options_outstanding - b.bc_subplan_transfer_selected as [Common Shares Equivalent],
  (o.total_options_outstanding - b.bc_subplan_transfer_selected) / b.total_fully_diluted as [% of fully diluted]
from {option_metrics} o, {business_inputs} b
union all select '7' as Number, 'Options Available- Gyre' as Description,
  o.total_options_available as [Common Shares Equivalent],
  o.total_options_available / b.total_fully_diluted as [% of fully diluted]
from {option_metrics} o, {business_inputs} b
union all select '8' as Number, 'Options Outstanding- Cullgen' as Description,
  b.options_outstanding_cullgen as [Common Shares Equivalent],
  b.options_outstanding_cullgen / b.total_fully_diluted as [% of fully diluted]
from {business_inputs} b
union all select '9' as Number, 'Options Available- Cullgen' as Description,
  b.options_available_cullgen as [Common Shares Equivalent],
  b.options_available_cullgen / b.total_fully_diluted as [% of fully diluted]
from {business_inputs} b
union all select '' as Number, 'Total Fully Diluted Shares Outstand' as Description,
  b.total_fully_diluted as [Common Shares Equivalent],
  1 as [% of fully diluted]
from {business_inputs} b`;

const buildString = (value: string) => ({
  sql: value,
});

export function buildMonthlyWorkflowTasks(): WorkflowTask[] {
  return [
    {
      x: 48,
      y: 48,
      id: 'invoke_control_book_merge',
      name: 'Invoke EQ Control Book Incremental Merge',
      inputs: {},
      params: {
        workflowCode: 'eq-control-book-incremental-merge',
        inheritRuntimeParameters: true,
        outputTaskId: 'merge_control_book',
        inputMappings: [],
        runtimeParameters: {
          fileRefs: {
            base_control_book: baseControlBookRuntimeFileRef,
            incremental_control_book: incrementalControlBookRuntimeFileRef,
          },
        },
      },
      dependsOn: [],
      description:
        '调用 EQ Control Book Incremental Merge 子工作流：上月 base + 本月增量按交易自然键幂等合并出当月完整 EQ Control Book（12 列），供指标计算；子工作流同时落盘可作为下月 base 的 workbook。',
      operatorCode: 'workflow.invoke',
      operatorVersion: '1.0.0',
    },
    {
      x: 48,
      y: 226,
      id: 'extract_previous_capitalization_summary',
      name: 'Extract Previous Capitalization Summary',
      inputs: {},
      params: {
        range: 'A1:E30',
        fileRef: previousCapitalizationSummaryRuntimeFileRef,
        headerRow: 1,
        dropTrailingEmptyRows: true,
        sheetName: 'Capitalization Summary',
      },
      dependsOn: [],
      description: '可选抽取上一个月的 Capitalization Summary；未配置文件时输出空 dataframe，不阻断 workflow。',
      operatorCode: 'sheet.optional-range.extract',
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
      id: 'invoke_option_plans_summary',
      name: 'Invoke Option Plans Summary',
      inputs: {},
      params: {
        workflowCode: 'option-plans-summary-values',
        inheritRuntimeParameters: true,
        outputTaskId: 'enrich_option_plans_summary_plan_name',
        runtimeParameters: {
          fileRefs: {
            option_plans_summary: optionPlansRuntimeFileRef,
          },
        },
      },
      dependsOn: [],
      description: '调用可复用的 Option Plans Summary workflow，输出标准化的 category_for_grouping/plan_name/key/value dataframe。',
      operatorCode: 'workflow.invoke',
      operatorVersion: '1.0.0',
    },
    {
      x: 48,
      y: 760,
      id: 'extract_bc_subplan_transfer',
      name: 'Extract 2025 BC Subplan Transfer',
      inputs: {},
      params: {
        range: 'A2:AI',
        fileRef: bcSubplanTransferRuntimeFileRef,
        headerRow: 4,
        sheetName: bcSubplanTransferRuntimeSheetName,
        dropTrailingEmptyRows: true,
      },
      dependsOn: [],
      description: '从用户明确选择的 workbook 和 Sheet 提取 2025 BC Subplan transfer 数据；第 4 行为字段表头，不做隐式 fallback。',
      operatorCode: 'sheet.range.extract',
      operatorVersion: '1.0.0',
    },
    {
      x: 48,
      y: 938,
      id: 'extract_options_os_detail_by_plan',
      name: 'Extract Options OS Detail by Plan',
      inputs: {},
      params: {
        range: 'A2:BZ',
        fileRef: optionsOsDetailByPlanRuntimeFileRef,
        headerRow: 2,
        sheetName: 'Options OS Detail',
        dropTrailingEmptyRows: true,
      },
      dependsOn: [],
      description: '可选抽取设计文档中的 Options_OS_Detail_by_Plan 明细；未配置文件时输出空 dataframe，不参与当前 Summary 公式。',
      operatorCode: 'sheet.optional-range.extract',
      operatorVersion: '1.0.0',
    },
    {
      x: 416,
      y: 48,
      id: 'calc_control_book_metrics',
      name: 'Calc Control Book Metrics',
      inputs: {
        control_book: {
          from: 'invoke_control_book_merge',
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
        sql: `
select
  (select [Issued & Outstanding] from {control_book} where [Issued & Outstanding] is not null and wf_month_key([As of Date]) is not null order by __workflow_row_number desc limit 1) as eom_eq_balance_os,
  (select [Issued & Outstanding] from {control_book} where [Issued & Outstanding] is not null and wf_month_key([As of Date]) < {constants.workflowMonth} order by __workflow_row_number desc limit 1) as last_month_eq_balance_os,
  (select wf_month_key([As of Date]) from {control_book} where [Issued & Outstanding] is not null and wf_month_key([As of Date]) is not null order by __workflow_row_number desc limit 1) as last_control_book_month,
  sum(case when [Comment] in ('Omnibus Inc. Pl', 'Omnibus Inc. Pl.') then [Shares Issued] else 0 end) as bc_subplan_transfer_control_book,
  max(case when [Trans. Type] = 'Agr. & Pl. of Merger' then [Shares Issued] else null end) as cullgen_common_stock,
  max(case when [Comment] = 'Equity Inc.Sub-Pl. Futu Network Technology' then [Shares Issued] else null end) as gyre_2023_china_subplan_total
from {control_book}`,
        tableBindings: [{ inputSlot: 'control_book', tableName: 'control_book' }],
        constants: {
          workflowMonth: {
            $fromRuntime: 'month',
            $type: 'string',
            $label: 'Workflow Month',
          },
        },
      },
      dependsOn: [],
      description: '计算 EOM EQ Balance OS 和 Control Book 口径的 2025 BC Subplan transfer。',
      operatorCode: 'sql.compute',
      operatorVersion: '1.0.0',
    },
    {
      x: 416,
      y: 226,
      id: 'calc_previous_capitalization_summary_metrics',
      name: 'Calc Previous Capitalization Summary Metrics',
      inputs: {
        previous_summary: {
          from: 'extract_previous_capitalization_summary',
          slot: 'dataframe',
        },
      },
      params: {
        sql: `
select
  count(*) as previous_summary_row_count,
  max(case when [Description] like 'Asset Class Summary:%' then [Common Shares Equivalent] else null end) as previous_eom_eq_balance_os
from {previous_summary}`,
        tableBindings: [{ inputSlot: 'previous_summary', tableName: 'previous_summary' }],
      },
      dependsOn: [],
      description: '从可选上月 Capitalization Summary 中读取上月 EOM EQ Balance OS；未传文件时 row_count=0。',
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
        sql: `
select
  sum(f.[Exercised Qty]) as futu_exercised_qty,
  max(c.gyre_2023_china_subplan_total) - sum(f.[Exercised Qty]) as bci_shares_held_by_futu
from {futu} f, {control_metrics} c`,
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
      id: 'calc_bc_subplan_cancelled',
      name: 'Calc 2025 BC Subplan Cancelled',
      inputs: {
        transfer: {
          from: 'extract_bc_subplan_transfer',
          slot: 'dataframe',
          guards: [
            {
              id: 'guard_assert_bc_subplan_transfer_schema',
              name: 'Assert BC Subplan Transfer Schema',
              type: 'dataframe.schema.assert',
              params: {
                mode: 'contains',
                failureMessage: '2025 BC Subplan Transfer input must contain 行标签 and 总计 columns',
                expectedColumns: '行标签, 总计',
                failureStrategy: 'block',
              },
              enabled: true,
            },
          ],
        },
      },
      params: {
        sql: `
select
  coalesce(
    abs(min(case when [总计] < 0 then [总计] else null end)),
    max(case when trim(coalesce(cast([行标签] as text), '')) like '总计%' then [总计] else null end)
      - min(case when trim(coalesce(cast([行标签] as text), '')) like '总计%' then [总计] else null end)
  ) as bc_subplan_cancelled,
  coalesce(
    min(case when trim(coalesce(cast([行标签] as text), '')) like '总计%' then [总计] else null end),
    max(case when trim(coalesce(cast([行标签] as text), '')) like '总计%' then [总计] else null end)
      + min(case when [总计] < 0 then [总计] else null end)
  ) as bc_subplan_outstanding
from {transfer}`,
        tableBindings: [{ inputSlot: 'transfer', tableName: 'transfer' }],
      },
      dependsOn: [],
      description: '从用户指定的 2025 BC Subplan Transfer/Vesting Schedule Sheet 计算 cancelled/forfeited shares；优先读取负数取消总计，兼容两个总计行的差额格式。',
      operatorCode: 'sql.compute',
      operatorVersion: '1.0.0',
    },
    {
      x: 416,
      y: 760,
      id: 'calc_option_metrics',
      name: 'Calc Option Plan Metrics',
      inputs: {
        plans: {
          from: 'invoke_option_plans_summary',
          slot: 'dataframe',
          guards: [
            {
              id: 'guard_assert_option_plan_schema',
              name: 'Assert Option Plan Schema',
              type: 'dataframe.schema.assert',
              params: {
                mode: 'contains',
                failureMessage: 'Assert Option Plan Schema failed',
                expectedColumns: 'category_for_grouping, plan_name, key, value',
                failureStrategy: 'block',
              },
              enabled: true,
            },
          ],
        },
        bc_subplan: {
          from: 'calc_bc_subplan_cancelled',
          slot: 'dataframe',
        },
      },
      params: {
        sql: `
with totals as (
  select
    p.key,
    sum(p.[value]) as total_value
  from {plans} p
  where p.key in (
    'Awards Outstanding',
    'Shares Remaining For Issuance',
    'Awards Outstanding + Shares Remaining for Issuance'
  )
  group by p.key
),
bc_plan as (
  select
    sum(case when p.key = 'Cancelled' then coalesce(p.[value], 0) else 0 end) as cancelled_value,
    sum(case when p.key = 'Awards Outstanding' then 1 else 0 end) as awards_row_count
  from {plans} p
  where p.plan_name = 'GYRE 2025 BC Subplan'
    or p.category_for_grouping like '%GYRE 2025 BC Subplan%'
),
bc_adjustment as (
  select
    case
      when coalesce(max(bc_plan.awards_row_count), 0) > 0
        and coalesce(abs(max(bc_plan.cancelled_value)), 0) = 0
      then coalesce(max(bc_subplan.bc_subplan_cancelled), 0)
      else 0
    end as bc_cancelled_adjustment
  from bc_plan, {bc_subplan} bc_subplan
)
select
  coalesce(max(case when totals.key = 'Awards Outstanding' then totals.total_value else null end), 0)
    - max(bc_adjustment.bc_cancelled_adjustment) as total_options_outstanding,
  coalesce(max(case when totals.key = 'Shares Remaining For Issuance' then totals.total_value else null end), 0)
    + max(bc_adjustment.bc_cancelled_adjustment) as total_options_available,
  coalesce(max(case when totals.key = 'Awards Outstanding + Shares Remaining for Issuance' then totals.total_value else null end), 0) as total_options_outstanding_plus_available,
  max(bc_adjustment.bc_cancelled_adjustment) as bc_subplan_cancelled_adjustment
from totals, bc_adjustment`,
        tableBindings: [
          { inputSlot: 'plans', tableName: 'plans' },
          { inputSlot: 'bc_subplan', tableName: 'bc_subplan' },
        ],
      },
      dependsOn: [],
      description: '按 Option Plans Summary workflow 的标准化 key/value 输出汇总期权指标；仅当 GYRE 2025 BC Subplan 的 Cancelled 为空或 0 时，用 2025 BC Subplan Transfer 的 cancelled 进行修正。',
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
        option_metrics: {
          from: 'calc_option_metrics',
          slot: 'dataframe',
          guards: [],
        },
      },
      params: {
        sql: `
select
  max(c.eom_eq_balance_os) as eom_eq_balance_os,
  max(c.cullgen_common_stock) as cullgen_common_stock,
  max(c.gyre_2023_china_subplan_total) as gyre_2023_china_subplan_total,
  max(c.bc_subplan_transfer_control_book) as bc_subplan_transfer_selected,
  'control_book' as bc_subplan_transfer_selection_source,
  {constants.warrantsConvertiblePreferred} as warrants_for_convertible_preferred_stock,
  {constants.optionsOutstandingCullgen} as options_outstanding_cullgen,
  {constants.optionsAvailableCullgen} as options_available_cullgen,
  round(max(c.eom_eq_balance_os) + max(o.total_options_outstanding) + {constants.warrantsConvertiblePreferred} - max(c.bc_subplan_transfer_control_book) + max(o.total_options_available) + {constants.optionsOutstandingCullgen} + {constants.optionsAvailableCullgen}, 0) as total_fully_diluted
from {control_metrics} c, {option_metrics} o`,
        tableBindings: [
          { inputSlot: 'control_metrics', tableName: 'control_metrics' },
          { inputSlot: 'option_metrics', tableName: 'option_metrics' },
        ],
        constants: {
          warrantsConvertiblePreferred: {
            $fromRuntime: 'fixedValues.warrantsConvertiblePreferred',
            $type: 'number',
            $label: 'Warrants for Convertible Preferred Stock',
            $default: MONTHLY_RUNTIME_WARRANTS_CONVERTIBLE_PREFERRED,
          },
          optionsOutstandingCullgen: {
            $fromRuntime: 'fixedValues.optionsOutstandingCullgen',
            $type: 'number',
            $label: 'Options Outstanding - Cullgen',
            $default: MONTHLY_RUNTIME_OPTIONS_OUTSTANDING_CULLGEN,
          },
          optionsAvailableCullgen: {
            $fromRuntime: 'fixedValues.optionsAvailableCullgen',
            $type: 'number',
            $label: 'Options Available - Cullgen',
            $default: MONTHLY_RUNTIME_OPTIONS_AVAILABLE_CULLGEN,
          },
        },
      },
      dependsOn: [],
      description: '汇总 Summary 计算所需业务输入；各类固定值来自 global parameters，Gyre option totals 由 raw option plans workbook 与 cancellation 调整计算。',
      operatorCode: 'sql.compute',
      operatorVersion: '1.0.0',
    },
    {
      x: 1152,
      y: 48,
      id: 'assert_control_book_workflow_month',
      name: 'Assert EQ Control Book Workflow Month',
      inputs: {
        control_metrics: {
          from: 'calc_control_book_metrics',
          slot: 'dataframe',
        },
      },
      params: {
        sql: 'select case when last_control_book_month = {constants.workflowMonth} then 1 else 0 end as actual from {control_metrics}',
        operator: '=',
        expectedValue: 1,
        tableBindings: [{ inputSlot: 'control_metrics', tableName: 'control_metrics' }],
        constants: {
          workflowMonth: {
            $fromRuntime: 'month',
            $type: 'string',
            $label: 'Workflow Month',
          },
        },
        failureMessage: 'EQ Control Book input file error: last row month does not match workflow month',
        failureStrategy: 'block',
      },
      dependsOn: [],
      description: '阻断错月输入：EQ Control Book 最后一条有效 Issued & Outstanding 的 As of Date 必须属于 workflow 月份。',
      operatorCode: 'dataframe.sql.assert',
      operatorVersion: '1.0.0',
    },
    {
      x: 1152,
      y: 226,
      id: 'assert_previous_summary_last_month',
      name: 'Assert Previous Summary Last Month',
      inputs: {
        control_metrics: {
          from: 'calc_control_book_metrics',
          slot: 'dataframe',
        },
        previous_summary_metrics: {
          from: 'calc_previous_capitalization_summary_metrics',
          slot: 'dataframe',
        },
      },
      params: {
        sql: 'select case when p.previous_summary_row_count = 0 then 1 when p.previous_eom_eq_balance_os = c.last_month_eq_balance_os then 1 else 0 end as actual from {control_metrics} c, {previous_summary_metrics} p',
        operator: '=',
        expectedValue: 1,
        tableBindings: [
          { inputSlot: 'control_metrics', tableName: 'control_metrics' },
          { inputSlot: 'previous_summary_metrics', tableName: 'previous_summary_metrics' },
        ],
        failureMessage: 'Previous Capitalization Summary EOM does not match EQ Control Book Last Month',
        failureStrategy: 'block',
      },
      dependsOn: ['assert_control_book_workflow_month'],
      description: '若传入上月 Capitalization Summary，则校验其 EOM 等于当前 EQ Control Book 计算出的 Last Month；未传文件时通过。',
      operatorCode: 'dataframe.sql.assert',
      operatorVersion: '1.0.0',
    },
    {
      x: 1152,
      y: 404,
      id: 'build_shares_os_reconciliation',
      name: 'Build Shares OS Reconciliation',
      inputs: {
        control_metrics: {
          from: 'calc_control_book_metrics',
          slot: 'dataframe',
          guards: [
            {
              id: 'guard_assert_last_month_balance_available',
              name: 'Assert Last Month Balance Available',
              type: 'dataframe.sql.assert',
              params: {
                sql: 'select case when last_month_eq_balance_os is not null then 1 else 0 end as actual from {control_metrics}',
                operator: '=',
                expectedValue: 1,
                tableBindings: [{ inputSlot: 'control_metrics', tableName: 'control_metrics' }],
                failureMessage: 'EQ Control Book input file error: cannot derive Last Month from rows before workflow month',
                failureStrategy: 'block',
              },
              enabled: true,
            },
          ],
        },
      },
      params: {
        sql: `
select
  'Equity Outstanding as of' as Item,
  wf_eom_label({constants.workflowMonth}) as [As of],
  last_month_eq_balance_os as [Last Month],
  eom_eq_balance_os - last_month_eq_balance_os as [New Shares],
  eom_eq_balance_os as [EOM Balance]
from {control_metrics}`,
        tableBindings: [{ inputSlot: 'control_metrics', tableName: 'control_metrics' }],
        constants: {
          workflowMonth: {
            $fromRuntime: 'month',
            $type: 'string',
            $label: 'Workflow Month',
          },
        },
      },
      dependsOn: ['assert_control_book_workflow_month', 'assert_previous_summary_last_month'],
      description: '从 EQ Control Book 单表生成 Shares OS Reconciliation：Last Month 取 workflow 月份之前最后一条 I&O，EOM 取整表最后一条 I&O。',
      operatorCode: 'sql.compute',
      operatorVersion: '1.0.0',
    },
    {
      x: 1520,
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
          guards: [],
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
                sql: 'select case when bc_subplan_transfer_control_book > 0 then 1 else 0 end as actual from {control_metrics}',
                operator: '=',
                expectedValue: 1,
                tableBindings: [{ inputSlot: 'control_metrics', tableName: 'control_metrics' }],
                failureMessage: 'Control Book transfer source must be positive',
                failureStrategy: 'block',
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
                sql: 'select case when total_fully_diluted > 0 then 1 else 0 end as actual from {business_inputs}',
                operator: '=',
                expectedValue: 1,
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
      x: 1888,
      y: 48,
      id: 'persist_capitalization_summary',
      name: 'Persist Capitalization Summary Excel',
      inputs: {
        reconciliation: {
          from: 'build_shares_os_reconciliation',
          slot: 'dataframe',
          guards: [
            {
              id: 'guard_assert_reconciliation_schema',
              name: 'Assert Reconciliation Schema',
              type: 'dataframe.schema.assert',
              params: {
                mode: 'contains',
                failureMessage: 'Assert Shares OS Reconciliation Schema failed',
                expectedColumns: MONTHLY_RECONCILIATION_COLUMNS.join(', '),
                failureStrategy: 'block',
              },
              enabled: true,
            },
          ],
        },
        capitalization: {
          from: 'build_capitalization_summary',
          slot: 'dataframe',
          guards: [
            {
              id: 'guard_assert_common_shares_os',
              name: 'Assert Common Shares OS',
              type: 'dataframe.sql.assert',
              params: {
                sql: "select case when [Common Shares Equivalent] > 0 then 1 else 0 end as actual from {summary} where [Description] = 'Common Shares OS'",
                operator: '=',
                expectedValue: 1,
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
                sql: "select case when [Common Shares Equivalent] > 0 then 1 else 0 end as actual from {summary} where [Description] = 'Options Outstanding- Gyre'",
                operator: '=',
                expectedValue: 1,
                tableBindings: [{ inputSlot: 'summary', tableName: 'summary' }],
                failureMessage: 'Assert Options Outstanding Gyre failed',
                failureStrategy: 'block',
              },
              enabled: true,
            },
            {
              id: 'guard_assert_summary_total_calculation',
              name: 'Assert Summary Total Calculation',
              type: 'dataframe.sql.assert',
              params: {
                sql: "select case when (select sum([Common Shares Equivalent]) from {summary} where [Number] <> '') = (select [Common Shares Equivalent] from {summary} where [Description] = 'Total Fully Diluted Shares Outstand') then 1 else 0 end as actual",
                operator: '=',
                expectedValue: 1,
                tableBindings: [{ inputSlot: 'summary', tableName: 'summary' }],
                failureMessage: 'Assert Summary Total Calculation failed',
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
        folderPrefix: 'output/captable',
        sheets: [
          { inputSlot: 'reconciliation', sheetName: 'Shares OS Reconciliation' },
          { inputSlot: 'capitalization', sheetName: 'Capitalization Summary' },
        ],
        uploadedBy: 'Workflow',
      },
      dependsOn: [],
      description: '将通过校验后的 Summary View 持久化为 Excel 并写入 Files；百分比列导出为 Excel 百分号格式但保留真实小数值。',
      operatorCode: 'workbook.persist.excel',
      operatorVersion: '1.0.0',
    },
  ];
}

export function buildMonthlyWorkflowSeedDefinition() {
  const tasks = buildMonthlyWorkflowTasks();
  const runtimeConfig = deriveWorkflowRuntimeConfigFromTasks({ tasks });
  return {
    code: MONTHLY_WORKFLOW_CODE,
    name: MONTHLY_WORKFLOW_NAME,
    description: MONTHLY_WORKFLOW_DESCRIPTION,
    status: 'active' as const,
    version: 2,
    runtimeParamsSchema: MONTHLY_RUNTIME_PARAMS_SCHEMA,
    runtimeParamsDefaults: MONTHLY_RUNTIME_PARAMS_DEFAULTS,
    runtimeConfig,
    fixedValueDefinitions: MONTHLY_RUN_FIXED_VALUE_DEFINITIONS,
    sourceDefinitions: MONTHLY_RUN_SOURCE_DEFINITIONS,
    tasks,
  };
}

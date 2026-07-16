import type {
  WorkflowRuntimeParameters,
  WorkflowRuntimeParametersSchema,
  WorkflowTask,
} from '../../shared/types.js';
import {
  EMPLOYEE_IMPORT_WORKFLOW_CODE,
  buildEmployeeImportWorkflowSeedDefinition,
} from '../workflow/employeeImportWorkflow.js';
import { deriveWorkflowRuntimeConfigFromTasks } from '../workflow/runtimeParameterRequirements.js';

export type DataManagementPageKey = 'employee' | 'plan-summary' | 'five-percent-holders';
export type DataManagementSourceBindings = Record<string, { fileId: number } | undefined>;

type SourceDefinition = { sourceKey: string; label: string };
type DataManagementWorkflowConfig = {
  pageKey: DataManagementPageKey;
  workflowCode: string;
  workflowName: string;
  description: string;
  sources: SourceDefinition[];
};

export const DATA_MANAGEMENT_WORKFLOW_CONFIGS: Record<DataManagementPageKey, DataManagementWorkflowConfig> = {
  employee: {
    pageKey: 'employee',
    workflowCode: EMPLOYEE_IMPORT_WORKFLOW_CODE,
    workflowName: 'Employee Import / 员工归集',
    description: '分别读取 Futu 授予记录与 Shareworks Options OS Detail，归集 Employee Management 主数据。',
    sources: [
      { sourceKey: 'futu_grants', label: 'Futu 授予记录' },
      { sourceKey: 'shareworks_grants', label: 'Shareworks Options OS Detail' },
    ],
  },
  'plan-summary': {
    pageKey: 'plan-summary',
    workflowCode: 'plan-summary-sync',
    workflowName: 'Plan Summary Sync',
    description: '独立读取 Shareworks Options OS Detail，按计划聚合并更新 Plan Summary 展示数据。',
    sources: [{ sourceKey: 'shareworks_grants', label: 'Shareworks Options OS Detail' }],
  },
  'five-percent-holders': {
    pageKey: 'five-percent-holders',
    workflowCode: 'five-percent-holders-sync',
    workflowName: '5% Holders Sync',
    description: '读取 Capitalization Summary 分母，并结合 Global Parameter 中维护的 5% holder 数字生成 5% Holders 结果文件。',
    sources: [{ sourceKey: 'capitalization_summary', label: 'Capitalization Summary' }],
  },
};

const PLAN_SUMMARY_SQL = `
select
  trim(concat('', [Plan Name])) as plan_name,
  count(*) as grant_count,
  sum(coalesce([No. of Shares Granted], 0)) as granted,
  sum(coalesce([Shares Exercised / Released], 0)) as exercised,
  sum(coalesce([Shares Cancelled/Expired], 0)) as cancelled,
  sum(coalesce([Shares Outstanding], 0)) as outstanding
from {grants}
where trim(concat('', coalesce([Plan Name], ''))) <> ''
group by trim(concat('', [Plan Name]))`;

export const FIVE_PERCENT_HOLDER_GLOBAL_PARAMETER_KEYS = {
  gniCommonStock: 'fivePercentHoldersGniCommonStock',
  gniTotalCses: 'fivePercentHoldersGniTotalCses',
  songjiangMaCommonStock: 'fivePercentHoldersSongjiangMaCommonStock',
  songjiangMaTotalCses: 'fivePercentHoldersSongjiangMaTotalCses',
} as const;

const FIVE_PERCENT_HOLDERS_SQL = `
select
  row_type as [Row Type],
  name as [Name],
  common_stock as [Common Stock],
  total_cses as [Total CSEs],
  case when common_stock_os is null or common_stock_os = 0 then null else common_stock / common_stock_os end as [% of Class],
  case when fully_diluted is null or fully_diluted = 0 then null else total_cses / fully_diluted end as [% Fully Diluted],
  '' as [SC13 Filing],
  note as [Note],
  as_of_date as [As Of Date],
  fully_diluted as [Fully Diluted],
  common_stock_os as [Common Stock OS]
from (
  select
    'holder' as row_type,
    'GNI Group Ltd.' as name,
    {constants.gniCommonStock} as common_stock,
    {constants.gniTotalCses} as total_cses,
    common_stock_os,
    fully_diluted,
    as_of_date,
    'Global Parameter maintained manually' as note
  from (
    select
      sum(case when lower(trim([Description])) in ('common shares os', 'cullgen common stock') then [Common Shares Equivalent] else 0 end) as common_stock_os,
      max(case when lower(trim([Description])) like 'total fully diluted shares outstand%' then [Common Shares Equivalent] else null end) as fully_diluted,
      wf_eom_label({constants.workflowMonth}) as as_of_date
    from {capitalization}
  )
  union all
  select
    'holder' as row_type,
    'Songjiang Ma' as name,
    {constants.songjiangMaCommonStock} as common_stock,
    {constants.songjiangMaTotalCses} as total_cses,
    common_stock_os,
    fully_diluted,
    as_of_date,
    'Global Parameter maintained manually' as note
  from (
    select
      sum(case when lower(trim([Description])) in ('common shares os', 'cullgen common stock') then [Common Shares Equivalent] else 0 end) as common_stock_os,
      max(case when lower(trim([Description])) like 'total fully diluted shares outstand%' then [Common Shares Equivalent] else null end) as fully_diluted,
      wf_eom_label({constants.workflowMonth}) as as_of_date
    from {capitalization}
  )
  union all
  select
    'total' as row_type,
    'Total >5%' as name,
    {constants.gniCommonStock} + {constants.songjiangMaCommonStock} as common_stock,
    {constants.gniTotalCses} + {constants.songjiangMaTotalCses} as total_cses,
    common_stock_os,
    fully_diluted,
    as_of_date,
    'Calculated from fixed values' as note
  from (
    select
      sum(case when lower(trim([Description])) in ('common shares os', 'cullgen common stock') then [Common Shares Equivalent] else 0 end) as common_stock_os,
      max(case when lower(trim([Description])) like 'total fully diluted shares outstand%' then [Common Shares Equivalent] else null end) as fully_diluted,
      wf_eom_label({constants.workflowMonth}) as as_of_date
    from {capitalization}
  )
)`;

function buildPlanSummaryWorkflowSeedDefinition(): {
  code: string;
  name: string;
  description: string;
  status: 'active';
  version: number;
  tasks: WorkflowTask[];
  runtimeParamsSchema: WorkflowRuntimeParametersSchema;
  runtimeParamsDefaults: WorkflowRuntimeParameters;
} {
  const tasks: WorkflowTask[] = [
    {
      id: 'extract_shareworks_grants',
      name: 'Extract Shareworks Options OS Detail',
      operatorCode: 'sheet.range.extract',
      operatorVersion: '1.0.0',
      description: '从独立业务输入读取 Options OS Detail，表头位于第 2 行。',
      x: 48, y: 80,
      params: {
        fileRef: {
          $fromRuntime: 'fileRefs.shareworks_grants',
          $type: 'object',
          $label: 'Shareworks Options OS Detail',
        },
        sheetName: 'Options OS Detail', range: 'A2:BZ', headerRow: 2, dropTrailingEmptyRows: true,
      },
      inputs: {}, dependsOn: [],
    },
    {
      id: 'aggregate_plan_summary',
      name: 'Aggregate Plan Summary',
      operatorCode: 'sql.compute',
      operatorVersion: '1.0.0',
      description: '按 Plan Name 聚合授予、行权、取消及 outstanding 数量。',
      x: 420, y: 80,
      params: { sql: PLAN_SUMMARY_SQL, tableBindings: [{ tableName: 'grants', inputSlot: 'input1' }] },
      inputs: { input1: { from: 'extract_shareworks_grants', slot: 'dataframe' } }, dependsOn: [],
    },
    {
      id: 'persist_plan_summary_file',
      name: 'Persist Plan Summary File',
      operatorCode: 'dataframe.persist.excel',
      operatorVersion: '1.0.0',
      description: '将 Plan Summary dataframe 输出为 Excel 文件，业务页面读取最新成功执行的输出文件渲染。',
      x: 790, y: 80,
      params: {
        fileName: 'Plan_Summary.xlsx',
        folderPrefix: 'output/plan-summary',
        sheetName: 'Plan Summary',
        uploadedBy: 'Workflow',
      },
      inputs: { input1: { from: 'aggregate_plan_summary', slot: 'dataframe' } }, dependsOn: [],
    },
  ];
  const runtimeConfig = deriveWorkflowRuntimeConfigFromTasks({ tasks, runtimeParamsSchema: {}, runtimeParamsDefaults: {} });
  const config = DATA_MANAGEMENT_WORKFLOW_CONFIGS['plan-summary'];
  return {
    code: config.workflowCode,
    name: config.workflowName,
    description: config.description,
    status: 'active', version: 1, tasks,
    runtimeParamsSchema: {
      ...runtimeConfig.runtimeParamsSchema,
      fileRefs: {
        type: 'object', label: 'File References',
        properties: { shareworks_grants: { type: 'object', label: 'Shareworks Options OS Detail' } },
      },
    },
    runtimeParamsDefaults: runtimeConfig.runtimeParamsDefaults,
  };
}

function buildFivePercentHoldersWorkflowSeedDefinition(): {
  code: string;
  name: string;
  description: string;
  status: 'active';
  version: number;
  tasks: WorkflowTask[];
  runtimeParamsSchema: WorkflowRuntimeParametersSchema;
  runtimeParamsDefaults: WorkflowRuntimeParameters;
} {
  const tasks: WorkflowTask[] = [
    {
      id: 'extract_capitalization_summary',
      name: 'Extract Capitalization Summary',
      operatorCode: 'sheet.range.extract',
      operatorVersion: '1.0.0',
      description: '读取 Capitalization Summary 结果文件，用于取得 Common Stock OS 与 Fully Diluted 分母。',
      x: 48, y: 80,
      params: {
        fileRef: {
          $fromRuntime: 'fileRefs.capitalization_summary',
          $type: 'object',
          $label: 'Capitalization Summary',
        },
        sheetName: 'Capitalization Summary',
        range: 'A1:E200',
        headerRow: 1,
        dropTrailingEmptyRows: true,
      },
      inputs: {}, dependsOn: [],
    },
    {
      id: 'assert_five_percent_denominators',
      name: 'Assert 5% Holders Denominators',
      operatorCode: 'dataframe.sql.assert',
      operatorVersion: '1.0.0',
      description: '确认 Capitalization Summary 中存在 Common Shares OS、Cullgen common stock 和 Total Fully Diluted Shares Outstand 三个分母来源。',
      x: 420, y: 80,
      params: {
        sql: `
select
  sum(case when lower(trim([Description])) = 'common shares os' then 1 else 0 end)
  + sum(case when lower(trim([Description])) = 'cullgen common stock' then 1 else 0 end)
  + sum(case when lower(trim([Description])) like 'total fully diluted shares outstand%' then 1 else 0 end) as actual
from {capitalization}`,
        tableBindings: [{ tableName: 'capitalization', inputSlot: 'capitalization' }],
        operator: '>=',
        expectedValue: 3,
        failureStrategy: 'block',
        failureMessage: '5% Holders denominators missing: Capitalization Summary must include Common Shares OS, Cullgen common stock, and Total Fully Diluted Shares Outstand.',
      },
      inputs: { capitalization: { from: 'extract_capitalization_summary', slot: 'dataframe' } }, dependsOn: [],
    },
    {
      id: 'calculate_five_percent_holders',
      name: 'Calculate 5% Holders',
      operatorCode: 'sql.compute',
      operatorVersion: '1.0.0',
      description: '用 Global Parameter 的四个手工数生成两行 holder 和 Total >5%，并用 Summary 分母计算百分比。',
      x: 790, y: 80,
      params: {
        sql: FIVE_PERCENT_HOLDERS_SQL,
        tableBindings: [{ tableName: 'capitalization', inputSlot: 'capitalization' }],
        constants: {
          workflowMonth: { $fromRuntime: 'month', $type: 'string', $label: 'Workflow Month' },
          gniCommonStock: { $fromRuntime: `fixedValues.${FIVE_PERCENT_HOLDER_GLOBAL_PARAMETER_KEYS.gniCommonStock}`, $type: 'number', $label: 'GNI Group Common Stock' },
          gniTotalCses: { $fromRuntime: `fixedValues.${FIVE_PERCENT_HOLDER_GLOBAL_PARAMETER_KEYS.gniTotalCses}`, $type: 'number', $label: 'GNI Group Total CSEs' },
          songjiangMaCommonStock: { $fromRuntime: `fixedValues.${FIVE_PERCENT_HOLDER_GLOBAL_PARAMETER_KEYS.songjiangMaCommonStock}`, $type: 'number', $label: 'Songjiang Ma Common Stock' },
          songjiangMaTotalCses: { $fromRuntime: `fixedValues.${FIVE_PERCENT_HOLDER_GLOBAL_PARAMETER_KEYS.songjiangMaTotalCses}`, $type: 'number', $label: 'Songjiang Ma Total CSEs' },
        },
      },
      inputs: { capitalization: { from: 'assert_five_percent_denominators', slot: 'dataframe' } }, dependsOn: [],
    },
    {
      id: 'persist_five_percent_holders_file',
      name: 'Persist 5% Holders File',
      operatorCode: 'dataframe.persist.excel',
      operatorVersion: '1.0.0',
      description: '将 5% Holders dataframe 输出为 Excel 文件，业务页面读取最新成功执行的输出文件渲染。',
      x: 1160, y: 80,
      params: {
        fileName: 'Five_Percent_Holders.xlsx',
        folderPrefix: 'output/five-percent-holders',
        sheetName: '5% Holders',
        uploadedBy: 'Workflow',
      },
      inputs: { input1: { from: 'calculate_five_percent_holders', slot: 'dataframe' } }, dependsOn: [],
    },
  ];
  const runtimeConfig = deriveWorkflowRuntimeConfigFromTasks({
    tasks,
    runtimeParamsSchema: {},
    runtimeParamsDefaults: {
      month: '2026-05',
    },
  });
  const config = DATA_MANAGEMENT_WORKFLOW_CONFIGS['five-percent-holders'];
  return {
    code: config.workflowCode,
    name: config.workflowName,
    description: config.description,
    status: 'active', version: 1, tasks,
    runtimeParamsSchema: {
      ...runtimeConfig.runtimeParamsSchema,
      fileRefs: {
        type: 'object', label: 'File References',
        properties: { capitalization_summary: { type: 'object', label: 'Capitalization Summary' } },
      },
    },
    runtimeParamsDefaults: runtimeConfig.runtimeParamsDefaults,
  };
}

export function buildDataManagementWorkflowSeedDefinitions() {
  return [
    buildEmployeeImportWorkflowSeedDefinition(),
    buildPlanSummaryWorkflowSeedDefinition(),
    buildFivePercentHoldersWorkflowSeedDefinition(),
  ];
}

export function getDataManagementWorkflowSeedDefinition(pageKey: DataManagementPageKey) {
  const definitions = buildDataManagementWorkflowSeedDefinitions();
  const config = DATA_MANAGEMENT_WORKFLOW_CONFIGS[pageKey];
  const definition = definitions.find((item) => item.code === config.workflowCode);
  if (!definition) throw new Error(`Missing data management workflow definition: ${pageKey}`);
  return definition;
}

export function buildDataManagementWorkflowRuntimeParameters(
  pageKey: DataManagementPageKey,
  sources: DataManagementSourceBindings,
  overrides: WorkflowRuntimeParameters = {},
): WorkflowRuntimeParameters {
  const fileRefs: Record<string, { provider: 'product-files'; id: number }> = {};
  for (const source of DATA_MANAGEMENT_WORKFLOW_CONFIGS[pageKey].sources) {
    const fileId = Number(sources[source.sourceKey]?.fileId);
    if (!Number.isInteger(fileId) || fileId <= 0) throw new Error(`Missing data management workflow source: ${source.sourceKey}`);
    fileRefs[source.sourceKey] = { provider: 'product-files', id: fileId };
  }
  return { ...overrides, fileRefs };
}

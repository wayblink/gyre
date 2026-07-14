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
    description: '独立读取 Gyre Cap Table 的 5% Holders sheet，并更新 5% Holders 展示数据。',
    sources: [{ sourceKey: 'gyre_cap_table', label: 'Gyre Cap Table 5% Holders' }],
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
      id: 'persist_plan_summary',
      name: 'Persist Plan Summary',
      operatorCode: 'plan-summary.persist',
      operatorVersion: '1.0.0',
      description: '原子替换 Plan Summary 展示表并记录输入文件血缘。',
      x: 790, y: 80,
      params: { sourceFileId: { $fromRuntime: 'fileRefs.shareworks_grants.id' } },
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
      id: 'extract_five_percent_holders',
      name: 'Extract 5% Holders',
      operatorCode: 'sheet.range.extract',
      operatorVersion: '1.0.0',
      description: '从独立业务输入读取 Gyre Cap Table 的 5% Holders sheet，保留原始网格供专用持久化节点解析。',
      x: 48, y: 80,
      params: {
        fileRef: {
          $fromRuntime: 'fileRefs.gyre_cap_table',
          $type: 'object',
          $label: 'Gyre Cap Table',
        },
        sheetName: '5% Holders',
        range: 'A1:O74',
        headerRow: null,
        dropTrailingEmptyRows: true,
      },
      inputs: {}, dependsOn: [],
    },
    {
      id: 'persist_five_percent_holders',
      name: 'Persist 5% Holders',
      operatorCode: 'five-percent-holders.persist',
      operatorVersion: '1.0.0',
      description: '原子替换 5% Holders 展示表并记录输入文件血缘。',
      x: 420, y: 80,
      params: { sourceFileId: { $fromRuntime: 'fileRefs.gyre_cap_table.id' } },
      inputs: { input1: { from: 'extract_five_percent_holders', slot: 'dataframe' } }, dependsOn: [],
    },
  ];
  const runtimeConfig = deriveWorkflowRuntimeConfigFromTasks({ tasks, runtimeParamsSchema: {}, runtimeParamsDefaults: {} });
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
        properties: { gyre_cap_table: { type: 'object', label: 'Gyre Cap Table 5% Holders' } },
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
): WorkflowRuntimeParameters {
  const fileRefs: Record<string, { provider: 'product-files'; id: number }> = {};
  for (const source of DATA_MANAGEMENT_WORKFLOW_CONFIGS[pageKey].sources) {
    const fileId = Number(sources[source.sourceKey]?.fileId);
    if (!Number.isInteger(fileId) || fileId <= 0) throw new Error(`Missing data management workflow source: ${source.sourceKey}`);
    fileRefs[source.sourceKey] = { provider: 'product-files', id: fileId };
  }
  return { fileRefs };
}

import type {
  WorkflowRuntimeParameters,
  WorkflowRuntimeParametersSchema,
  WorkflowTask,
} from '../../shared/types.js';
import { deriveWorkflowRuntimeConfigFromTasks } from '../workflow/runtimeParameterRequirements.js';

export type EsopPageKey = 'grant-record' | 'exercise-record' | 'sold-shares' | 'transfer-plan';

export type EsopWorkflowSourceDefinition = {
  sourceKey: string;
  label: string;
  extractTaskId: string;
  sheetName: string;
  range: string;
  headerRow: number;
  inputSlot: 'input1' | 'input2';
};

export type EsopPageWorkflowConfig = {
  pageKey: EsopPageKey;
  workflowCode: string;
  workflowName: string;
  description: string;
  sources: EsopWorkflowSourceDefinition[];
};

export type EsopWorkflowSourceBindings = Record<string, { fileId: number } | undefined>;

export const ESOP_PAGE_WORKFLOW_CONFIGS: Record<EsopPageKey, EsopPageWorkflowConfig> = {
  'grant-record': {
    pageKey: 'grant-record',
    workflowCode: 'esop-grant-record-sync',
    workflowName: 'ESOP / Grant Record Sync',
    description: '分别读取 Futu 授予记录与 Shareworks Options OS Detail，并更新 Grant Record 三个展示视图。',
    sources: [
      {
        sourceKey: 'futu_grants',
        label: 'Futu 授予记录',
        extractTaskId: 'extract_futu_grants',
        sheetName: '授予记录',
        range: 'A1:BZ',
        headerRow: 1,
        inputSlot: 'input1',
      },
      {
        sourceKey: 'shareworks_grants',
        label: 'Shareworks Options OS Detail',
        extractTaskId: 'extract_shareworks_grants',
        sheetName: 'Options OS Detail',
        range: 'A2:BZ',
        headerRow: 2,
        inputSlot: 'input2',
      },
    ],
  },
  'exercise-record': {
    pageKey: 'exercise-record',
    workflowCode: 'esop-exercise-record-sync',
    workflowName: 'ESOP / Exercise to Date Sync',
    description: '读取 Futu BCI Exercises to Date 明细并替换 Exercise to Date 展示数据。',
    sources: [
      {
        sourceKey: 'futu_exercises',
        label: 'Futu BCI Exercises to Date',
        extractTaskId: 'extract_exercises',
        sheetName: 'Futu BCI Exercises to Date',
        range: 'A1:M',
        headerRow: 1,
        inputSlot: 'input1',
      },
    ],
  },
  'sold-shares': {
    pageKey: 'sold-shares',
    workflowCode: 'esop-sold-shares-sync',
    workflowName: 'ESOP / Sold Shares Sync',
    description: '读取 Futu sold shares 明细并替换 Sold Shares 展示数据。',
    sources: [
      {
        sourceKey: 'futu_sold_shares',
        label: 'Futu Sold Shares',
        extractTaskId: 'extract_sold_shares',
        sheetName: 'Futu sold shares',
        range: 'A1:S',
        headerRow: 1,
        inputSlot: 'input1',
      },
    ],
  },
  'transfer-plan': {
    pageKey: 'transfer-plan',
    workflowCode: 'esop-transfer-to-futu-sync',
    workflowName: 'ESOP / Transfer to Futu Sync',
    description: '读取 2025 BC Subplan Transfer 透视表并更新按月转仓汇总，保留人工调整值。',
    sources: [
      {
        sourceKey: 'transfer_plan',
        label: '2025 BC Subplan Transfer',
        extractTaskId: 'extract_transfer_plan',
        sheetName: '2025 BC Subplan Transfer',
        range: 'A4:AH',
        headerRow: 4,
        inputSlot: 'input1',
      },
    ],
  },
};

function runtimeFileRef(source: EsopWorkflowSourceDefinition) {
  return {
    $fromRuntime: `fileRefs.${source.sourceKey}`,
    $type: 'object',
    $label: source.label,
  };
}

const SHAREWORKS_GRANT_RECORD_COLUMNS = [
  'Employee Number',
  'Last Name',
  'First Name',
  'Middle Name',
  'Plan Name',
  'Grant Name',
  'Grant Type',
  'Employee Grant Number',
  'Grant Date',
  'Vesting Start Date',
  'Service Start Date',
  'Original VCD (migrated grants)',
  'Expire Date',
  'Expire Date (participant view)',
  'Earliest Expire Cancel Date',
  'Latest Expire Cancel Date',
  'No. of Shares Granted',
  'Exercise Price per Share',
  'Vesting Schedule',
  'Early Exercise Allowed',
  'No. of Shares Vested',
  'No. of Shares Unvested',
  'Shares Exercised / Released',
  'Shares Subject To Repurchase',
  'Shares Cancelled/Expired',
  'Shares Outstanding',
  'Outstanding Unvested',
  'Outstanding Vested/Exercisable',
];

function shareworksGrantRecordProjectionSql() {
  return `select
${SHAREWORKS_GRANT_RECORD_COLUMNS.map((column) => `  [${column}]`).join(',\n')}
from {shareworks_grants}`;
}

function persistInputTaskIdForSource(config: EsopPageWorkflowConfig, source: EsopWorkflowSourceDefinition) {
  if (config.pageKey === 'sold-shares') return 'filter_sold_shares_rows';
  if (config.pageKey === 'grant-record' && source.sourceKey === 'shareworks_grants') return 'project_shareworks_grants_columns';
  return source.extractTaskId;
}

function persistTaskForSource(config: EsopPageWorkflowConfig, source: EsopWorkflowSourceDefinition): WorkflowTask {
  const pageName = config.pageKey.replaceAll('-', '_');
  const sourceName = source.sourceKey
    .replace(/^futu_/, 'futu_')
    .replace(/^shareworks_/, 'shareworks_')
    .replace(/^transfer_plan$/, 'transfer_plan')
    .replaceAll('-', '_');
  const taskId =
    config.pageKey === 'grant-record'
      ? `persist_${pageName}_${source.sourceKey === 'futu_grants' ? 'futu' : 'shareworks'}_file`
      : `persist_${pageName}_file`;
  const fileName =
    config.pageKey === 'grant-record'
      ? `Grant_Record_${source.sourceKey === 'futu_grants' ? 'Futu' : 'Shareworks'}.xlsx`
      : `${config.pageKey.replaceAll('-', '_')}.xlsx`;
  const sheetName =
    config.pageKey === 'grant-record'
      ? source.sourceKey === 'futu_grants'
        ? 'Futu Grants'
        : 'Shareworks Grants'
      : source.label;

  return {
    id: taskId,
    name: `Persist ${source.label} File`,
    operatorCode: 'dataframe.persist.excel',
    operatorVersion: '1.0.0',
    description: `将 ${source.label} dataframe 输出为 Excel 文件，展示层读取最新成功执行的输出文件。`,
    x: 520,
    y: 48 + config.sources.indexOf(source) * 220,
    params: {
      fileName,
      folderPrefix: `output/${config.pageKey}`,
      sheetName,
      uploadedBy: 'Workflow',
      sourceKey: sourceName,
    },
    inputs: {
      input1: {
        from: persistInputTaskIdForSource(config, source),
        slot: 'dataframe',
      },
    },
    dependsOn: [],
  };
}

function buildWorkflowTasks(config: EsopPageWorkflowConfig): WorkflowTask[] {
  const extractTasks: WorkflowTask[] = config.sources.map((source, index) => ({
    id: source.extractTaskId,
    name: `Extract ${source.label}`,
    operatorCode: 'sheet.range.extract',
    operatorVersion: '1.0.0',
    description: `从独立业务输入 ${source.label} 提取 ${source.sheetName}。`,
    x: 48,
    y: 48 + index * 220,
    params: {
      fileRef: runtimeFileRef(source),
      sheetName: source.sheetName,
      range: source.range,
      headerRow: source.headerRow,
      dropTrailingEmptyRows: true,
    },
    inputs: {},
    dependsOn: [],
  }));

  const transformTasks: WorkflowTask[] = [
    ...(config.pageKey === 'grant-record'
      ? [
          {
            id: 'project_shareworks_grants_columns',
            name: 'Project Shareworks Grant Columns',
            operatorCode: 'sql.compute',
            operatorVersion: '1.0.0',
            description: '输出 Shareworks Grant Record 时移除两个不展示字段。',
            x: 284,
            y: 268,
            params: {
              sql: shareworksGrantRecordProjectionSql(),
              tableBindings: [{ inputSlot: 'input1', tableName: 'shareworks_grants' }],
            },
            inputs: { input1: { from: 'extract_shareworks_grants', slot: 'dataframe' } },
            dependsOn: [],
          },
        ]
      : []),
    ...(config.pageKey === 'sold-shares'
      ? [
          {
            id: 'filter_sold_shares_rows',
            name: 'Filter Sold Shares Rows',
            operatorCode: 'sql.compute',
            operatorVersion: '1.0.0',
            description: '过滤 Futu sold shares 顶部空行、说明行和表头噪音，只保留有员工工号和姓名的业务明细。',
            x: 284,
            y: 48,
            params: {
              sql: `select *
from {sold_shares}
where trim(concat('', coalesce([工号], ''))) <> ''
  and trim(concat('', coalesce([姓名], ''))) <> ''
  and trim(concat('', coalesce([工号], ''))) <> '工号'
  and lower(trim(concat('', coalesce([姓名], '')))) not like 'note:%'`,
              tableBindings: [{ inputSlot: 'input1', tableName: 'sold_shares' }],
            },
            inputs: { input1: { from: 'extract_sold_shares', slot: 'dataframe' } },
            dependsOn: [],
          },
        ]
      : []),
  ];

  return [...extractTasks, ...transformTasks, ...config.sources.map((source) => persistTaskForSource(config, source))];
}

export function buildEsopPageWorkflowSeedDefinitions(): Array<{
  code: string;
  name: string;
  description: string;
  status: 'active';
  version: number;
  tasks: WorkflowTask[];
  runtimeParamsSchema: WorkflowRuntimeParametersSchema;
  runtimeParamsDefaults: WorkflowRuntimeParameters;
}> {
  return Object.values(ESOP_PAGE_WORKFLOW_CONFIGS).map((config) => {
    const tasks = buildWorkflowTasks(config);
    const runtimeConfig = deriveWorkflowRuntimeConfigFromTasks({
      tasks,
      runtimeParamsSchema: {},
      runtimeParamsDefaults: {},
    });
    return {
      code: config.workflowCode,
      name: config.workflowName,
      description: config.description,
      status: 'active',
      version: 1,
      tasks,
      runtimeParamsSchema: {
        ...runtimeConfig.runtimeParamsSchema,
        fileRefs: {
          type: 'object',
          label: 'File References',
          properties: Object.fromEntries(
            config.sources.map((source) => [source.sourceKey, { type: 'object' as const, label: source.label }]),
          ),
        },
      },
      runtimeParamsDefaults: runtimeConfig.runtimeParamsDefaults,
    };
  });
}

export function buildEsopWorkflowRuntimeParameters(
  pageKey: EsopPageKey,
  sources: EsopWorkflowSourceBindings,
): WorkflowRuntimeParameters {
  const config = ESOP_PAGE_WORKFLOW_CONFIGS[pageKey];
  const fileRefs: Record<string, { provider: 'product-files'; id: number }> = {};
  for (const source of config.sources) {
    const fileId = Number(sources[source.sourceKey]?.fileId);
    if (!Number.isInteger(fileId) || fileId <= 0) {
      throw new Error(`Missing ESOP workflow source: ${source.sourceKey}`);
    }
    fileRefs[source.sourceKey] = { provider: 'product-files', id: fileId };
  }
  return { fileRefs };
}

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

  const sourceFileIds = Object.fromEntries(
    config.sources.map((source) => [source.sourceKey, { $fromRuntime: `fileRefs.${source.sourceKey}.id` }]),
  );
  const inputs = Object.fromEntries(
    config.sources.map((source) => [source.inputSlot, { from: source.extractTaskId, slot: 'dataframe' }]),
  );

  return [
    ...extractTasks,
    {
      id: `persist_${config.pageKey.replaceAll('-', '_')}`,
      name: `Persist ${config.workflowName}`,
      operatorCode: 'esop.page.persist',
      operatorVersion: '1.0.0',
      description: '将 workflow 产出的 dataframe 原子写入页面对应业务表，页面本身只读取结果。',
      x: 520,
      y: 120,
      params: { pageKey: config.pageKey, sourceFileIds },
      inputs,
      dependsOn: [],
    },
  ];
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

import type { WorkflowDataFrame, WorkflowRuntimeParameters, WorkflowTaskPreviewResult } from '../../../shared/types.js';
import { defineWorkflowOperator, isRecord, normalizeWorkflowTaskDependencies } from './types.js';

type InputMapping = {
  inputSlot: string;
  taskId: string;
};

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function mergeRuntimeParameters(
  base: WorkflowRuntimeParameters,
  override: WorkflowRuntimeParameters,
): WorkflowRuntimeParameters {
  const merged: WorkflowRuntimeParameters = cloneJson(base);
  for (const [key, value] of Object.entries(override)) {
    if (isRecord(value) && isRecord(merged[key])) {
      merged[key] = mergeRuntimeParameters(merged[key] as WorkflowRuntimeParameters, value);
      continue;
    }
    merged[key] = cloneJson(value);
  }
  return merged;
}

function normalizeInputMappings(value: unknown): InputMapping[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!isRecord(item)) return null;
      const inputSlot = String(item.inputSlot ?? '').trim();
      const taskId = String(item.taskId ?? '').trim();
      return inputSlot && taskId ? { inputSlot, taskId } : null;
    })
    .filter((item): item is InputMapping => Boolean(item));
}

function normalizeRuntimeParameters(value: unknown): WorkflowRuntimeParameters {
  return isRecord(value) ? cloneJson(value) : {};
}

function normalizePathList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? '').trim()).filter(Boolean);
}

function readRuntimePath(parameters: WorkflowRuntimeParameters, path: string): unknown {
  let current: unknown = parameters;
  for (const segment of path.split('.')) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }
  return current;
}

/** A file reference without a file is what an unbound optional monthly source resolves to. */
function isEmptyRuntimeValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (!isRecord(value)) return false;
  const hasFile = Boolean(value.key) || Boolean(value.path) || Number(value.fileId) > 0;
  return !hasFile;
}

async function executeWorkflowInvoke(params: {
  taskName: string;
  workflowId: unknown;
  workflowCode: unknown;
  outputTaskId: unknown;
  inheritRuntimeParameters: unknown;
  runtimeParameters: unknown;
  inputMappings: unknown;
  parentRuntimeParameters: WorkflowRuntimeParameters;
  invocationStack: string[];
  skipWhenEmpty: unknown;
  propagateChildArtifacts: unknown;
  resolveInputDataFrame: (slot: string) => Promise<WorkflowDataFrame>;
  buildEmptyDataFrame: (sheetName: string) => WorkflowDataFrame;
  invokeWorkflow?: (params: {
    workflowId?: number;
    workflowCode?: string;
    runtimeParameters: WorkflowRuntimeParameters;
    inputDataFrames: Record<string, WorkflowDataFrame>;
    outputTaskId?: string;
    invocationStack: string[];
    propagateChildArtifacts?: boolean;
  }) => Promise<WorkflowTaskPreviewResult>;
}): Promise<WorkflowTaskPreviewResult> {
  if (!params.invokeWorkflow) {
    throw new Error('workflow.invoke runtime is not configured');
  }

  const workflowId = Number(params.workflowId);
  const normalizedWorkflowId = Number.isInteger(workflowId) && workflowId > 0 ? workflowId : undefined;
  const workflowCode = String(params.workflowCode ?? '').trim() || undefined;
  if (!normalizedWorkflowId && !workflowCode) {
    throw new Error(`Task ${params.taskName} requires workflowCode or workflowId`);
  }

  const explicitRuntimeParameters = normalizeRuntimeParameters(params.runtimeParameters);
  const runtimeParameters =
    params.inheritRuntimeParameters === false
      ? explicitRuntimeParameters
      : mergeRuntimeParameters(params.parentRuntimeParameters, explicitRuntimeParameters);

  // Optional monthly sources: when every listed parameter is unbound there is nothing to do, so
  // skip the call entirely instead of asking the child to persist an empty snapshot.
  const skipWhenEmpty = normalizePathList(params.skipWhenEmpty);
  if (
    skipWhenEmpty.length > 0 &&
    skipWhenEmpty.every((path) => isEmptyRuntimeValue(readRuntimePath(runtimeParameters, path)))
  ) {
    return { kind: 'dataframe', dataFrame: params.buildEmptyDataFrame(`${params.taskName} skipped`) };
  }

  const inputDataFrames: Record<string, WorkflowDataFrame> = {};
  for (const mapping of normalizeInputMappings(params.inputMappings)) {
    inputDataFrames[mapping.taskId] = await params.resolveInputDataFrame(mapping.inputSlot);
  }

  const outputTaskId = String(params.outputTaskId ?? '').trim() || undefined;
  return params.invokeWorkflow({
    workflowId: normalizedWorkflowId,
    workflowCode,
    runtimeParameters,
    inputDataFrames,
    outputTaskId,
    invocationStack: params.invocationStack,
    propagateChildArtifacts: params.propagateChildArtifacts === true,
  });
}

export const workflowInvokeOperator = defineWorkflowOperator({
  code: 'workflow.invoke',
  name: 'Invoke Workflow',
  version: '1.0.0',
  category: 'Transform',
  description: '调用另一个 workflow，并把子 workflow 的 dataframe 输出作为当前节点输出。',
  documentation: {
    usage:
      '把可复用 workflow 作为一个节点调用。默认继承父 workflow 的运行时参数，可用 runtimeParameters 覆盖；也可以把父节点输入 dataframe 注入到子 workflow 的指定 task id。',
    steps: [
      '配置 workflowCode 或 workflowId 指向要调用的子 workflow。',
      '默认 inheritRuntimeParameters=true，父 workflow 的 runtime parameters 会透传给子 workflow。',
      '需要覆盖参数时填写 runtimeParameters；覆盖会深度合并到继承参数上。',
      '需要透传 dataframe 输入时，在 inputMappings 中把父 inputSlot 映射到子 workflow 的 taskId。',
      '默认取子 workflow 的最终 result；也可以用 outputTaskId 指定取某个子节点输出。',
    ],
    example: `{
  "workflowCode": "option-plans-summary-values",
  "inheritRuntimeParameters": true,
  "outputTaskId": "enrich_option_plans_summary_plan_name"
}`,
  },
  inputSlots: [
    { slot: 'input1', type: 'table', contentType: 'application/json', label: 'Input 1', required: false },
    { slot: 'input2', type: 'table', contentType: 'application/json', label: 'Input 2', required: false },
  ],
  outputSlots: [{ slot: 'dataframe', type: 'table', contentType: 'application/json', label: 'DataFrame' }],
  paramsSchema: {
    workflowCode: {
      type: 'string',
      label: 'Workflow Code',
      required: false,
      description: '要调用的子 workflow code。workflowId 为空时必填。',
      default: '',
    },
    workflowId: {
      type: 'number',
      label: 'Workflow ID',
      required: false,
      description: '要调用的子 workflow ID。优先于 workflowCode。',
      default: null,
    },
    inheritRuntimeParameters: {
      type: 'boolean',
      label: '继承父运行时参数',
      required: false,
      default: true,
    },
    runtimeParameters: {
      type: 'object',
      label: 'Runtime Parameters',
      required: false,
      description: '传给子 workflow 的运行时参数；继承开启时会覆盖同名父参数。',
      default: {},
    },
    inputMappings: {
      type: 'array',
      label: 'Input Mappings',
      required: false,
      description:
        '把当前节点的 inputSlot 注入到子 workflow 的 taskId，例如 [{ "inputSlot": "input1", "taskId": "source" }]',
      default: [],
    },
    outputTaskId: {
      type: 'string',
      label: 'Output Task ID',
      required: false,
      description: '指定子 workflow 中哪个 task 的 dataframe 作为输出；为空则取子 workflow 最终 result。',
      default: '',
    },
    skipWhenEmpty: {
      type: 'array',
      label: 'Skip When Empty',
      required: false,
      description:
        '运行时参数路径列表（如 fileRefs.sold_shares）。全部为空时直接跳过调用、不产生输出文件；任一有值则正常调用。',
      default: [],
    },
    propagateChildArtifacts: {
      type: 'boolean',
      label: '级联子流程产物',
      required: false,
      description:
        '开启后把子 workflow 里各 persist 节点写出的文件，按子节点 task id 一并记录到当前 run 的产物中（供页面按 task id + 月份查询）。',
      default: false,
    },
  },
  normalizeTask(task) {
    const nextInputs: typeof task.inputs = {};
    for (const [slot, binding] of Object.entries(task.inputs ?? {})) {
      const slotName = slot.trim();
      if (!slotName) continue;
      nextInputs[slotName] = {
        from: String(binding?.from ?? '').trim(),
        slot: String(binding?.slot ?? 'dataframe').trim() || 'dataframe',
        guards: binding?.guards,
      };
    }
    task.inputs = nextInputs;
    task.params.inputMappings = normalizeInputMappings(task.params.inputMappings);
    task.params.runtimeParameters = normalizeRuntimeParameters(task.params.runtimeParameters);
    task.params.inheritRuntimeParameters = task.params.inheritRuntimeParameters !== false;
    task.params.skipWhenEmpty = normalizePathList(task.params.skipWhenEmpty);
    task.params.propagateChildArtifacts = task.params.propagateChildArtifacts === true;
    normalizeWorkflowTaskDependencies(task);
  },
  async execute({ task, runtime, runtimeParameters, invocationStack, resolveInputDataFrame }) {
    return executeWorkflowInvoke({
      taskName: task.name,
      workflowId: task.params.workflowId,
      workflowCode: task.params.workflowCode,
      outputTaskId: task.params.outputTaskId,
      inheritRuntimeParameters: task.params.inheritRuntimeParameters,
      runtimeParameters: task.params.runtimeParameters,
      inputMappings: task.params.inputMappings,
      parentRuntimeParameters: runtimeParameters,
      invocationStack,
      skipWhenEmpty: task.params.skipWhenEmpty,
      propagateChildArtifacts: task.params.propagateChildArtifacts,
      resolveInputDataFrame,
      buildEmptyDataFrame: (sheetName) =>
        runtime.rowsToDataFrame([], { sheetName, a1Range: 'A1', columns: ['skipped'] }),
      invokeWorkflow: runtime.invokeWorkflow,
    });
  },
  async preview(context) {
    return executeWorkflowInvoke({
      taskName: context.task.name,
      workflowId: context.task.params.workflowId,
      workflowCode: context.task.params.workflowCode,
      outputTaskId: context.task.params.outputTaskId,
      inheritRuntimeParameters: context.task.params.inheritRuntimeParameters,
      runtimeParameters: context.task.params.runtimeParameters,
      inputMappings: context.task.params.inputMappings,
      parentRuntimeParameters: context.runtimeParameters,
      invocationStack: context.invocationStack,
      skipWhenEmpty: context.task.params.skipWhenEmpty,
      propagateChildArtifacts: context.task.params.propagateChildArtifacts,
      resolveInputDataFrame: context.resolveInputDataFrame,
      buildEmptyDataFrame: (sheetName) =>
        context.runtime.rowsToDataFrame([], { sheetName, a1Range: 'A1', columns: ['skipped'] }),
      invokeWorkflow: context.runtime.invokeWorkflow,
    });
  },
});

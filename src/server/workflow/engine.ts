import type {
  WorkflowDataFrame,
  WorkflowExecutionResult,
  WorkflowExecutionTaskState,
  WorkflowTask,
  WorkflowTaskPreviewResult,
} from '../../shared/types.js';
import type { WorkflowOperatorExecutionContext, WorkflowOperatorExecuteResult, WorkflowOperatorRuntime } from './operators/types.js';
import { workflowOperatorDefinitionByCode } from './operators/registry.js';

type WorkflowTaskExecutionOutput = {
  dataFrame: WorkflowDataFrame;
  result: WorkflowTaskPreviewResult;
};

function getWorkflowDependencyIds(task: WorkflowTask): string[] {
  const inputDependencies = Object.values(task.inputs ?? {})
    .map((input) => String(input?.from ?? '').trim())
    .filter(Boolean);
  const controlDependencies = Array.isArray(task.dependsOn)
    ? task.dependsOn.map((taskId) => String(taskId ?? '').trim()).filter(Boolean)
    : [];
  return Array.from(new Set([...inputDependencies, ...controlDependencies])).filter((taskId) => taskId !== task.id);
}

function getWorkflowExecutionOrder(tasks: WorkflowTask[]): WorkflowTask[] {
  const taskMap = new Map(tasks.map((task) => [task.id, task]));
  const inDegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();

  tasks.forEach((task) => {
    inDegree.set(task.id, 0);
    outgoing.set(task.id, []);
  });

  tasks.forEach((task) => {
    getWorkflowDependencyIds(task).forEach((dependencyId) => {
      if (!taskMap.has(dependencyId)) {
        throw new Error(`Task ${task.name} references unknown dependency ${dependencyId}`);
      }
      outgoing.get(dependencyId)?.push(task.id);
      inDegree.set(task.id, (inDegree.get(task.id) ?? 0) + 1);
    });
  });

  const queue = tasks.filter((task) => (inDegree.get(task.id) ?? 0) === 0);
  const ordered: WorkflowTask[] = [];

  while (queue.length) {
    const task = queue.shift();
    if (!task) break;
    ordered.push(task);
    for (const nextId of outgoing.get(task.id) ?? []) {
      const nextDegree = (inDegree.get(nextId) ?? 0) - 1;
      inDegree.set(nextId, nextDegree);
      if (nextDegree === 0) {
        const nextTask = taskMap.get(nextId);
        if (nextTask) queue.push(nextTask);
      }
    }
  }

  if (ordered.length !== tasks.length) {
    throw new Error('Workflow dependency graph contains a cycle');
  }

  return ordered;
}

function getOperatorOrThrow(task: WorkflowTask) {
  const operator = workflowOperatorDefinitionByCode.get(task.operatorCode);
  if (!operator) {
    throw new Error(`Unsupported workflow operator: ${task.operatorCode}`);
  }
  operator.normalizeTask?.(task);
  return operator;
}

function isWorkflowTaskPreviewResult(value: WorkflowOperatorExecuteResult): value is WorkflowTaskPreviewResult {
  return typeof value === 'object' && value !== null && 'kind' in value && 'dataFrame' in value;
}

function toWorkflowTaskExecutionOutput(value: WorkflowOperatorExecuteResult): WorkflowTaskExecutionOutput {
  if (isWorkflowTaskPreviewResult(value)) {
    return {
      dataFrame: value.dataFrame,
      result: value,
    };
  }

  return {
    dataFrame: value,
    result: {
      kind: 'dataframe',
      dataFrame: value,
    },
  };
}

function createExecutionContext(
  task: WorkflowTask,
  executed: Map<string, WorkflowDataFrame>,
  taskMap: Map<string, WorkflowTask>,
  runtime: WorkflowOperatorRuntime,
  executeTask: (task: WorkflowTask) => Promise<WorkflowDataFrame>,
): WorkflowOperatorExecutionContext {
  return {
    task,
    executed,
    taskMap,
    runtime,
    executeTask,
    async resolveInputDataFrame(inputSlot: string) {
      const inputRef = task.inputs[inputSlot];
      if (!inputRef?.from?.trim()) {
        throw new Error(`Task ${task.name} is missing input mapping for slot ${inputSlot}`);
      }
      const upstreamTask = taskMap.get(inputRef.from);
      if (!upstreamTask) {
        throw new Error(`Task ${task.name} references unknown upstream task ${inputRef.from}`);
      }
      return executeTask(upstreamTask);
    },
  };
}

export async function executeWorkflowTask(
  task: WorkflowTask,
  executed: Map<string, WorkflowDataFrame>,
  taskMap: Map<string, WorkflowTask>,
  runtime: WorkflowOperatorRuntime,
): Promise<WorkflowDataFrame> {
  return (await executeWorkflowTaskOutput(task, executed, new Map(), taskMap, runtime)).dataFrame;
}

async function executeWorkflowTaskOutput(
  task: WorkflowTask,
  executed: Map<string, WorkflowDataFrame>,
  taskResults: Map<string, WorkflowTaskPreviewResult>,
  taskMap: Map<string, WorkflowTask>,
  runtime: WorkflowOperatorRuntime,
): Promise<WorkflowTaskExecutionOutput> {
  const cached = executed.get(task.id);
  const cachedResult = taskResults.get(task.id);
  if (cached && cachedResult) {
    return {
      dataFrame: cached,
      result: cachedResult,
    };
  }
  if (cached) {
    return {
      dataFrame: cached,
      result: {
        kind: 'dataframe',
        dataFrame: cached,
      },
    };
  }

  for (const dependencyId of getWorkflowDependencyIds(task)) {
    const dependencyTask = taskMap.get(dependencyId);
    if (!dependencyTask) {
      throw new Error(`Task ${task.name} references unknown dependency ${dependencyId}`);
    }
    await executeWorkflowTaskOutput(dependencyTask, executed, taskResults, taskMap, runtime);
  }

  const operator = getOperatorOrThrow(task);
  const context = createExecutionContext(task, executed, taskMap, runtime, (upstreamTask) =>
    executeWorkflowTaskOutput(upstreamTask, executed, taskResults, taskMap, runtime).then((output) => output.dataFrame),
  );
  const output = toWorkflowTaskExecutionOutput(await operator.execute(context));
  executed.set(task.id, output.dataFrame);
  taskResults.set(task.id, output.result);
  return output;
}

async function executeWorkflowTaskPreviewDataFrame(
  task: WorkflowTask,
  executed: Map<string, WorkflowDataFrame>,
  taskMap: Map<string, WorkflowTask>,
  runtime: WorkflowOperatorRuntime,
): Promise<WorkflowDataFrame> {
  const cached = executed.get(task.id);
  if (cached) return cached;
  const preview = await executeWorkflowTaskPreview(task, executed, taskMap, runtime);
  return preview.dataFrame;
}

export async function executeWorkflowTaskPreview(
  task: WorkflowTask,
  executed: Map<string, WorkflowDataFrame>,
  taskMap: Map<string, WorkflowTask>,
  runtime: WorkflowOperatorRuntime,
): Promise<WorkflowTaskPreviewResult> {
  const operator = getOperatorOrThrow(task);
  const context = createExecutionContext(task, executed, taskMap, runtime, (upstreamTask) =>
    executeWorkflowTaskPreviewDataFrame(upstreamTask, executed, taskMap, runtime),
  );

  if (operator.preview) {
    const preview = await operator.preview(context);
    executed.set(task.id, preview.dataFrame);
    return preview;
  }

  const output = await executeWorkflowTaskOutput(task, executed, new Map(), taskMap, runtime);
  return output.result;
}

export async function executeWorkflowDefinition(
  tasks: WorkflowTask[],
  runtime: WorkflowOperatorRuntime,
  options?: { enforceTerminalAssertBlock?: boolean; approvedWarningTaskIds?: string[] },
): Promise<WorkflowExecutionResult> {
  if (!tasks.length) {
    throw new Error('Workflow has no tasks');
  }

  const orderedTasks = getWorkflowExecutionOrder(tasks);
  const taskMap = new Map(orderedTasks.map((task) => [task.id, task]));
  const executed = new Map<string, WorkflowDataFrame>();
  const taskResults = new Map<string, WorkflowTaskPreviewResult>();
  const approvedWarningTaskIds = new Set((options?.approvedWarningTaskIds ?? []).map((taskId) => String(taskId).trim()).filter(Boolean));
  const taskStates: Record<string, WorkflowExecutionTaskState> = Object.fromEntries(
    orderedTasks.map((task) => [task.id, 'pending' as WorkflowExecutionTaskState]),
  );
  const taskResultRecords: Record<string, WorkflowTaskPreviewResult | null> = Object.fromEntries(
    orderedTasks.map((task) => [task.id, null]),
  );
  const taskTimings: WorkflowExecutionResult['taskTimings'] = {};
  const taskErrors: WorkflowExecutionResult['taskErrors'] = Object.fromEntries(
    orderedTasks.map((task) => [task.id, null]),
  );

  let lastResult: WorkflowTaskPreviewResult | null = null;
  let failedTaskId: string | null = null;
  let errorMessage: string | null = null;
  const warningTaskIds: string[] = [];
  const waitingForApprovalTaskIds: string[] = [];
  const warnings: WorkflowExecutionResult['warnings'] = [];

  for (const task of orderedTasks) {
    const dependencyIds = getWorkflowDependencyIds(task);
    const dependencyStates = dependencyIds.map((dependencyId) => taskStates[dependencyId]).filter(Boolean);
    const hasUnapprovedWarningDependency = dependencyIds.some(
      (dependencyId) => taskStates[dependencyId] === 'warning' && !approvedWarningTaskIds.has(dependencyId),
    );

    if (dependencyStates.some((state) => state === 'failed' || state === 'blocked') || hasUnapprovedWarningDependency) {
      taskStates[task.id] = 'blocked';
      continue;
    }

    try {
      taskStates[task.id] = 'running';
      const taskStartedAtMs = Date.now();
      const taskStartedAt = new Date(taskStartedAtMs).toISOString();
      const taskOutput = await executeWorkflowTaskOutput(task, executed, taskResults, taskMap, runtime);
      const taskFinishedAtMs = Date.now();
      taskTimings[task.id] = {
        startedAt: taskStartedAt,
        finishedAt: new Date(taskFinishedAtMs).toISOString(),
        durationMs: taskFinishedAtMs - taskStartedAtMs,
      };
      lastResult = taskOutput.result;
      taskResultRecords[task.id] = lastResult;
      if (lastResult.kind === 'assert' && !lastResult.assertion.passed) {
        if (lastResult.assertion.failureStrategy === 'block') {
          taskStates[task.id] = 'failed';
          failedTaskId = task.id;
          errorMessage = lastResult.assertion.failureMessage;
          taskErrors[task.id] = lastResult.assertion.failureMessage;
          continue;
        }
        if (lastResult.assertion.failureStrategy === 'warning') {
          const approved = approvedWarningTaskIds.has(task.id);
          taskStates[task.id] = 'warning';
          warningTaskIds.push(task.id);
          warnings.push({
            taskId: task.id,
            message: lastResult.assertion.failureMessage,
            approved,
          });
          if (!approved) {
            waitingForApprovalTaskIds.push(task.id);
          }
          continue;
        }
      }
      taskStates[task.id] = 'completed';
    } catch (error) {
      taskStates[task.id] = 'failed';
      failedTaskId = task.id;
      errorMessage = error instanceof Error ? error.message : 'Workflow execution failed';
      taskErrors[task.id] = errorMessage;
      if (!taskTimings[task.id]) {
        const now = new Date().toISOString();
        taskTimings[task.id] = {
          startedAt: now,
          finishedAt: now,
          durationMs: 0,
        };
      }
      const operator = getOperatorOrThrow(task);
      if (operator.preview) {
        try {
          lastResult = await operator.preview(
            createExecutionContext(task, executed, taskMap, runtime, (upstreamTask) =>
              executeWorkflowTaskPreviewDataFrame(upstreamTask, executed, taskMap, runtime),
            ),
          );
          taskResultRecords[task.id] = lastResult;
        } catch {
          // Ignore preview fallback failure and keep the original error result.
        }
      }
    }
  }

  if (!lastResult && !failedTaskId) {
    throw new Error('Workflow execution produced no result');
  }

  return {
    result: lastResult,
    taskStates,
    taskResults: taskResultRecords,
    taskTimings,
    taskErrors,
    failedTaskId,
    blockedTaskIds: orderedTasks.filter((task) => taskStates[task.id] === 'blocked').map((task) => task.id),
    warningTaskIds,
    waitingForApprovalTaskIds,
    warnings,
    errorMessage,
  };
}

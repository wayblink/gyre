import type {
  WorkflowAssertionResult,
  WorkflowDataFrame,
  WorkflowInputGuard,
  WorkflowTask,
  WorkflowTaskInput,
} from '../../shared/types.js';
import type { WorkflowOperatorRuntime } from './operators/types.js';
import { evaluateDataFrameAssertion } from './operators/dataframeAssert.js';
import { evaluateSchemaAssertion } from './operators/dataframeSchemaAssert.js';
import { evaluateShapeAssertion } from './operators/dataframeShapeAssert.js';
import { evaluateSqlAssertion } from './operators/dataframeSqlAssert.js';
import { isRecord } from '../utils/json.js';

export type WorkflowEvaluatedInputGuard = {
  guard: WorkflowInputGuard;
  assertion: WorkflowAssertionResult;
  dataFrame: WorkflowDataFrame;
  inputSlot: string;
  upstreamTaskId: string;
};

export function normalizeInputGuards(value: unknown): WorkflowInputGuard[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => {
      if (!isRecord(item)) return null;
      const type = String(item.type ?? '').trim();
      if (
        type !== 'dataframe.assert' &&
        type !== 'dataframe.sql.assert' &&
        type !== 'dataframe.schema.assert' &&
        type !== 'dataframe.shape.assert'
      ) {
        return null;
      }
      const id = String(item.id ?? `guard_${index + 1}`).trim() || `guard_${index + 1}`;
      const name = String(item.name ?? type).trim() || type;
      return {
        id,
        type,
        name,
        enabled: item.enabled !== false,
        params: isRecord(item.params) ? item.params : {},
      };
    })
    .filter((item): item is WorkflowInputGuard => Boolean(item));
}

export function normalizeWorkflowTaskInput(input: unknown, fallbackSlot = 'dataframe'): WorkflowTaskInput {
  const record = isRecord(input) ? input : {};
  return {
    from: String(record.from ?? '').trim(),
    slot: String(record.slot ?? fallbackSlot).trim() || fallbackSlot,
    guards: normalizeInputGuards(record.guards),
  };
}

function buildGuardTask(
  task: WorkflowTask,
  inputSlot: string,
  inputRef: WorkflowTaskInput,
  guard: WorkflowInputGuard,
): WorkflowTask {
  const inputs: WorkflowTask['inputs'] = {
    input1: {
      from: inputRef.from,
      slot: inputRef.slot || 'dataframe',
    },
  };
  if (inputSlot && inputSlot !== 'input1') {
    inputs[inputSlot] = {
      from: inputRef.from,
      slot: inputRef.slot || 'dataframe',
    };
  }
  if (Array.isArray(guard.params.tableBindings)) {
    for (const binding of guard.params.tableBindings) {
      if (!isRecord(binding)) continue;
      const bindingInputSlot = String(binding.inputSlot ?? '').trim();
      if (!bindingInputSlot || inputs[bindingInputSlot]) continue;
      inputs[bindingInputSlot] = {
        from: inputRef.from,
        slot: inputRef.slot || 'dataframe',
      };
    }
  }

  return {
    id: `${task.id}:${inputSlot}:${guard.id}`,
    name: guard.name || `${task.name} input check`,
    operatorCode: guard.type,
    operatorVersion: '1.0.0',
    description: '',
    x: task.x,
    y: task.y,
    params: { ...guard.params },
    inputs,
  };
}

export async function evaluateWorkflowInputGuards(params: {
  task: WorkflowTask;
  inputSlot: string;
  inputRef: WorkflowTaskInput;
  dataframe: WorkflowDataFrame;
  runtime: WorkflowOperatorRuntime;
}): Promise<WorkflowEvaluatedInputGuard[]> {
  const guards = normalizeInputGuards(params.inputRef.guards).filter((guard) => guard.enabled);
  const results: WorkflowEvaluatedInputGuard[] = [];

  for (const guard of guards) {
    const guardTask = buildGuardTask(params.task, params.inputSlot, params.inputRef, guard);
    let assertion: WorkflowAssertionResult;

    if (guard.type === 'dataframe.assert') {
      assertion = evaluateDataFrameAssertion(guardTask, params.dataframe);
    } else if (guard.type === 'dataframe.schema.assert') {
      assertion = evaluateSchemaAssertion(guardTask, params.dataframe.columns);
    } else if (guard.type === 'dataframe.shape.assert') {
      assertion = evaluateShapeAssertion(guardTask, params.dataframe);
    } else {
      const { assertion: sqlAssertion } = await evaluateSqlAssertion(guardTask, params.runtime, async () => params.dataframe);
      assertion = sqlAssertion;
    }

    results.push({
      guard,
      assertion,
      dataFrame: params.dataframe,
      inputSlot: params.inputSlot,
      upstreamTaskId: params.inputRef.from,
    });
  }

  return results;
}

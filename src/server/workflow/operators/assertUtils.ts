import type {
  WorkflowAssertionResult,
  WorkflowAssertFailureStrategy,
  WorkflowAssertOperator,
  WorkflowTask,
} from '../../../shared/types.js';

export function isAssertOperator(value: unknown): value is WorkflowAssertOperator {
  return value === '>' || value === '>=' || value === '<' || value === '<=' || value === '=' || value === '!=';
}

function isAssertFailureStrategy(value: unknown): value is WorkflowAssertFailureStrategy {
  return value === 'block' || value === 'warning' || value === 'pass-through';
}

export function normalizeAssertFailureStrategy(task: WorkflowTask): WorkflowAssertFailureStrategy {
  if (isAssertFailureStrategy(task.params.failureStrategy)) {
    return task.params.failureStrategy;
  }
  return task.params.blockExecution === false ? 'pass-through' : 'block';
}

export function normalizeAssertBaseParams(task: WorkflowTask) {
  task.params.failureMessage =
    typeof task.params.failureMessage === 'string' && task.params.failureMessage.trim()
      ? task.params.failureMessage
      : 'Assertion failed';
  task.params.failureStrategy = normalizeAssertFailureStrategy(task);
  task.params.blockExecution = task.params.failureStrategy === 'block';
}

export function coerceAssertExpectedValue(raw: unknown) {
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed !== '') {
      const numeric = Number(trimmed);
      if (Number.isFinite(numeric)) return numeric;
    }
    return trimmed;
  }
  return raw;
}

export function compareAssertValues(actual: unknown, expected: unknown, operator: WorkflowAssertOperator) {
  const actualComparable = coerceAssertExpectedValue(actual);
  const expectedComparable = coerceAssertExpectedValue(expected);
  const bothNumbers = typeof actualComparable === 'number' && typeof expectedComparable === 'number';

  if (operator === '>') return bothNumbers ? actualComparable > expectedComparable : String(actualComparable) > String(expectedComparable);
  if (operator === '>=') return bothNumbers ? actualComparable >= expectedComparable : String(actualComparable) >= String(expectedComparable);
  if (operator === '<') return bothNumbers ? actualComparable < expectedComparable : String(actualComparable) < String(expectedComparable);
  if (operator === '<=') return bothNumbers ? actualComparable <= expectedComparable : String(actualComparable) <= String(expectedComparable);
  if (operator === '=') return actualComparable === expectedComparable;
  return actualComparable !== expectedComparable;
}

export function buildAssertionResult(params: {
  task: WorkflowTask;
  passed: boolean;
  operator?: WorkflowAssertOperator;
  actualValue: unknown;
  expectedValue: unknown;
  failureMessage: string;
  actualLabel?: string;
  expectedLabel?: string;
}): WorkflowAssertionResult {
  const failureStrategy = normalizeAssertFailureStrategy(params.task);
  return {
    passed: params.passed,
    operator: params.operator ?? '=',
    actualValue: params.actualValue,
    expectedValue: params.expectedValue,
    failureMessage: params.passed ? String(params.task.params.failureMessage ?? 'Assertion failed') : params.failureMessage,
    failureStrategy,
    blockExecution: failureStrategy === 'block',
    actualLabel: params.actualLabel,
    expectedLabel: params.expectedLabel,
  };
}

export function throwIfBlockingAssertionFailed(assertion: WorkflowAssertionResult) {
  if (!assertion.passed && assertion.failureStrategy === 'block') {
    throw new Error(assertion.failureMessage);
  }
}

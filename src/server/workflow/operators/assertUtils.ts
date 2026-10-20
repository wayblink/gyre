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

  if (operator === '>')
    return bothNumbers ? actualComparable > expectedComparable : String(actualComparable) > String(expectedComparable);
  if (operator === '>=')
    return bothNumbers
      ? actualComparable >= expectedComparable
      : String(actualComparable) >= String(expectedComparable);
  if (operator === '<')
    return bothNumbers ? actualComparable < expectedComparable : String(actualComparable) < String(expectedComparable);
  if (operator === '<=')
    return bothNumbers
      ? actualComparable <= expectedComparable
      : String(actualComparable) <= String(expectedComparable);
  if (operator === '=') return actualComparable === expectedComparable;
  return actualComparable !== expectedComparable;
}

/**
 * Tail appended to a failed assertion's message.
 *
 * Reads as a parenthetical note rather than a shout: the old `actual=X = expected=Y was false` form
 * made an operator-facing warning look like a test failure dump, which is exactly the kind of
 * message that gets approved without being read.
 *
 * A multi-line actual value is a *findings block* (e.g. the offending rows), not a scalar, so it is
 * appended as its own paragraph instead of being crammed into parentheses — and the expected value is
 * dropped, because a block that already says what was found does not need a "expected 0" tail.
 */
export function formatAssertionFailureTail(
  failureMessage: string,
  actualValue: unknown,
  expectedValue: unknown,
  operator: WorkflowAssertOperator,
): string {
  const actual = String(actualValue);
  if (actual.includes('\n')) return `${failureMessage}\n\n${actual}`;
  const comparison =
    operator === '='
      ? `actual=${actual}, expected=${String(expectedValue)}`
      : `actual=${actual} ${operator} expected=${String(expectedValue)}`;
  return `${failureMessage} (${comparison})`;
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
    failureMessage: params.passed
      ? String(params.task.params.failureMessage ?? 'Assertion failed')
      : params.failureMessage,
    failureStrategy,
    blockExecution: failureStrategy === 'block',
    actualLabel: params.actualLabel,
    expectedLabel: params.expectedLabel,
  };
}

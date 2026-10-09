import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { WorkflowDefinition, WorkflowOperator, WorkflowTask } from '../../shared/types.js';
import {
  applyAutoLayoutToWorkflow,
  estimateWorkflowSlotHeight,
  estimateWorkflowTextLines,
  getEdgePath,
  getWorkflowCanvasSize,
  getWorkflowControlDependencies,
  getWorkflowDependencyIds,
  getWorkflowExecutionOrder,
  getWorkflowNodeBadge,
  getWorkflowNodeHeight,
  getWorkflowTaskMap,
  WORKFLOW_CANVAS_PADDING,
  WORKFLOW_NODE_WIDTH,
  WORKFLOW_LAYOUT_COLUMN_GAP,
} from './dagLayout.js';

function task(id: string, overrides: Partial<WorkflowTask> = {}): WorkflowTask {
  return {
    id,
    name: id,
    operatorCode: 'sql_transform',
    operatorVersion: '1.0.0',
    description: '',
    x: 0,
    y: 0,
    params: {},
    inputs: {},
    ...overrides,
  };
}

function workflow(tasks: WorkflowTask[]): WorkflowDefinition {
  return {
    id: 1,
    code: 'demo',
    name: 'Demo',
    description: '',
    status: 'draft',
    version: 1,
    tasks,
    runtimeParamsSchema: {},
    runtimeParamsDefaults: {},
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  };
}

test('dependency ids merge input bindings and control dependencies, excluding self', () => {
  const node = task('b', {
    inputs: { source: { from: 'a', slot: 'out' } },
    dependsOn: ['a', 'b', 'c'],
  });
  assert.deepEqual(getWorkflowDependencyIds(node).sort(), ['a', 'c']);
});

test('control dependencies exclude ids already implied by an input binding', () => {
  const node = task('b', {
    inputs: { source: { from: 'a', slot: 'out' } },
    dependsOn: ['a', 'c'],
  });
  assert.deepEqual(getWorkflowControlDependencies(node), ['c']);
});

test('execution order puts upstream tasks first and breaks ties by canvas position', () => {
  const definition = workflow([
    task('downstream', {
      x: 400,
      inputs: { source: { from: 'upstream', slot: 'out' } },
    }),
    task('upstream', { x: 40 }),
  ]);
  assert.deepEqual(
    getWorkflowExecutionOrder(definition).map((item) => item.id),
    ['upstream', 'downstream'],
  );
});

test('execution order appends cyclic tasks instead of dropping them', () => {
  const definition = workflow([
    task('a', { inputs: { source: { from: 'b', slot: 'out' } } }),
    task('b', { inputs: { source: { from: 'a', slot: 'out' } } }),
  ]);
  const ordered = getWorkflowExecutionOrder(definition).map((item) => item.id);
  assert.equal(ordered.length, 2, 'a cycle must not hide tasks from the canvas');
  assert.deepEqual([...ordered].sort(), ['a', 'b']);
});

test('auto layout places each dependency depth in its own column', () => {
  const definition = workflow([
    task('a', { x: 900, y: 900 }),
    task('b', { x: 0, y: 0, inputs: { source: { from: 'a', slot: 'out' } } }),
    task('c', { x: 0, y: 0, inputs: { source: { from: 'b', slot: 'out' } } }),
  ]);
  assert.equal(
    applyAutoLayoutToWorkflow(definition, () => null),
    true,
  );

  const columns = new Map(definition.tasks.map((item) => [item.id, item.x]));
  assert.equal(columns.get('a'), WORKFLOW_CANVAS_PADDING);
  assert.equal(columns.get('b'), WORKFLOW_CANVAS_PADDING + WORKFLOW_NODE_WIDTH + WORKFLOW_LAYOUT_COLUMN_GAP);
  assert.equal(columns.get('c'), WORKFLOW_CANVAS_PADDING + 2 * (WORKFLOW_NODE_WIDTH + WORKFLOW_LAYOUT_COLUMN_GAP));
});

test('auto layout is a no-op for empty or single-task workflows', () => {
  assert.equal(
    applyAutoLayoutToWorkflow(null, () => null),
    false,
  );
  const single = workflow([task('only', { x: 10, y: 10 })]);
  assert.equal(
    applyAutoLayoutToWorkflow(single, () => null),
    false,
  );
  assert.equal(single.tasks[0].x, 10);
});

test('node height grows with slot rows and shrinks with longer names', () => {
  const short = workflow([task('t')]);
  const long = workflow([task('t', { name: 'x'.repeat(80) })]);
  const operator: WorkflowOperator = {
    code: 'sql_transform',
    name: 'Transform',
    version: '1.0.0',
    category: 'Transform',
    inputSlots: [],
    outputSlots: ['result'],
    params: [],
  } as unknown as WorkflowOperator;

  assert.ok(getWorkflowNodeHeight(long.tasks[0]) > getWorkflowNodeHeight(short.tasks[0]));
  assert.ok(getWorkflowNodeHeight(short.tasks[0], operator) > 0);
  assert.ok(estimateWorkflowTextLines('', 20) === 1);
  assert.ok(estimateWorkflowSlotHeight({ name: 'a', binding: '' }) >= 34);
});

test('canvas size always covers the nodes plus padding', () => {
  const definition = workflow([task('a', { x: 100, y: 100 })]);
  const size = getWorkflowCanvasSize(definition, () => null);
  assert.ok(size.width >= 100 + WORKFLOW_NODE_WIDTH + WORKFLOW_CANVAS_PADDING * 2);
  assert.ok(size.height >= 100 + WORKFLOW_CANVAS_PADDING * 2);
});

test('edge paths are cubic curves between the two handles', () => {
  const path = getEdgePath(0, 0, 200, 100);
  assert.match(path, /^M 0 0 C 90 0, 110 100, 200 100$/);
});

test('node badges fall back to a transform badge for unknown operators', () => {
  assert.equal(getWorkflowNodeBadge(null).code, 'transform');
  assert.equal(
    getWorkflowNodeBadge({ category: 'Input', code: 'read_excel', name: 'Read' } as WorkflowOperator).code,
    'input',
  );
  assert.equal(getWorkflowTaskMap(workflow([task('a')])).get('a')?.id, 'a');
});

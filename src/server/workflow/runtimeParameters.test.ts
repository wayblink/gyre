import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolveWorkflowRuntimeConfiguration } from './runtimeParameters.js';
import type { WorkflowTask, WorkflowRuntimeParametersSchema } from '../../shared/types.js';

const baseTask = (overrides: Partial<WorkflowTask>): WorkflowTask => ({
  id: 'task',
  name: 'Task',
  operatorCode: 'noop',
  operatorVersion: '1.0.0',
  description: '',
  x: 0,
  y: 0,
  params: {},
  inputs: {},
  dependsOn: [],
  ...overrides,
});

const monthlySchema: WorkflowRuntimeParametersSchema = {
  month: { type: 'string', label: '月份', required: true },
  fileIds: {
    type: 'object',
    label: '源文件 ID 集',
    required: true,
    properties: {
      control_book: { type: 'number', label: 'EQ Control Book fileId', required: true },
      futu_exercises: { type: 'number', label: 'Futu exercises fileId', required: true },
      option_plans: { type: 'number', label: 'Option plans fileId', required: true },
    },
  },
};

const extractTask = () =>
  baseTask({
    id: 'extract_control_book',
    name: 'Extract EQ Control Book',
    operatorCode: 'sheet.range.extract',
    params: {
      fileId: { $fromRuntime: 'fileIds.control_book' },
      sheetName: 'EQ Control Book',
      range: 'A9:L130',
      headerRow: 9,
    },
  });

test('resolveWorkflowRuntimeConfiguration injects numeric fileId from nested runtime reference', () => {
  const resolved = resolveWorkflowRuntimeConfiguration({
    tasks: [extractTask()],
    runtimeParamsSchema: monthlySchema,
    runtimeParamsDefaults: {},
    runtimeParameters: { month: '2026-05', fileIds: { control_book: 42, futu_exercises: 43, option_plans: 44 } },
  });

  const params = resolved.tasks[0].params;
  assert.equal(params.fileId, 42);
  assert.equal(typeof params.fileId, 'number');
  // unrelated params are preserved untouched
  assert.equal(params.sheetName, 'EQ Control Book');
  assert.equal(params.range, 'A9:L130');
  assert.equal(params.headerRow, 9);
  // merged runtime parameters are returned as-is
  assert.deepEqual(resolved.runtimeParameters, { month: '2026-05', fileIds: { control_book: 42, futu_exercises: 43, option_plans: 44 } });
});

test('resolveWorkflowRuntimeConfiguration merges defaults under caller overrides', () => {
  const resolved = resolveWorkflowRuntimeConfiguration({
    tasks: [extractTask()],
    runtimeParamsSchema: monthlySchema,
    runtimeParamsDefaults: { fileIds: { control_book: 7, futu_exercises: 8, option_plans: 9 } },
    runtimeParameters: { month: '2026-06' },
  });

  // default fileId applies because caller did not override it
  assert.equal(resolved.tasks[0].params.fileId, 7);
  assert.equal(resolved.runtimeParameters.month, '2026-06');
});

test('resolveWorkflowRuntimeConfiguration throws when required runtime parameter is missing', () => {
  assert.throws(
    () =>
      resolveWorkflowRuntimeConfiguration({
        tasks: [extractTask()],
        runtimeParamsSchema: monthlySchema,
        runtimeParamsDefaults: {},
        runtimeParameters: { month: '2026-05', fileIds: {} },
      }),
    /Missing runtime parameter: fileIds\.control_book/,
  );
});

test('resolveWorkflowRuntimeConfiguration throws when the whole required object is missing', () => {
  assert.throws(
    () =>
      resolveWorkflowRuntimeConfiguration({
        tasks: [extractTask()],
        runtimeParamsSchema: monthlySchema,
        runtimeParamsDefaults: {},
        runtimeParameters: { month: '2026-05' },
      }),
    /Missing runtime parameter: fileIds/,
  );
});

test('resolveWorkflowRuntimeConfiguration rejects wrong type for nested numeric parameter', () => {
  assert.throws(
    () =>
      resolveWorkflowRuntimeConfiguration({
        tasks: [extractTask()],
        runtimeParamsSchema: monthlySchema,
        runtimeParamsDefaults: {},
        runtimeParameters: { month: '2026-05', fileIds: { control_book: 'not-a-number', futu_exercises: 2, option_plans: 3 } },
      }),
    /Runtime parameter fileIds\.control_book must be a number/,
  );
});

test('resolveWorkflowRuntimeConfiguration rejects unknown runtime parameter keys', () => {
  assert.throws(
    () =>
      resolveWorkflowRuntimeConfiguration({
        tasks: [extractTask()],
        runtimeParamsSchema: monthlySchema,
        runtimeParamsDefaults: {},
        runtimeParameters: { month: '2026-05', fileIds: { control_book: 1, futu_exercises: 2, option_plans: 3 }, surprise: true },
      }),
    /Unknown runtime parameter: surprise/,
  );
});

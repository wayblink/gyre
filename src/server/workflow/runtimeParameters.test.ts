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
  fileRefs: {
    type: 'object',
    label: '源文件引用集',
    required: true,
    properties: {
      control_book: { type: 'object', label: 'EQ Control Book fileRef', required: true },
      futu_exercises: { type: 'object', label: 'Futu exercises fileRef', required: true },
      option_plans: { type: 'object', label: 'Option plans fileRef', required: true },
    },
  },
};

const extractTask = () =>
  baseTask({
    id: 'extract_control_book',
    name: 'Extract EQ Control Book',
    operatorCode: 'sheet.range.extract',
    params: {
      fileRef: { $fromRuntime: 'fileRefs.control_book' },
      sheetName: 'EQ Control Book',
      range: 'A9:L130',
      headerRow: 9,
    },
  });

test('resolveWorkflowRuntimeConfiguration injects fileRef from nested runtime reference', () => {
  const resolved = resolveWorkflowRuntimeConfiguration({
    tasks: [extractTask()],
    runtimeParamsSchema: monthlySchema,
    runtimeParamsDefaults: {},
    runtimeParameters: {
      month: '2026-05',
      fileRefs: {
        control_book: { provider: 'product-files', id: 42 },
        futu_exercises: { provider: 'product-files', id: 43 },
        option_plans: { provider: 'product-files', id: 44 },
      },
    },
  });

  const params = resolved.tasks[0].params;
  assert.deepEqual(params.fileRef, { provider: 'product-files', id: 42 });
  // unrelated params are preserved untouched
  assert.equal(params.sheetName, 'EQ Control Book');
  assert.equal(params.range, 'A9:L130');
  assert.equal(params.headerRow, 9);
  // merged runtime parameters are returned as-is
  assert.deepEqual(resolved.runtimeParameters, {
    month: '2026-05',
    fileRefs: {
      control_book: { provider: 'product-files', id: 42 },
      futu_exercises: { provider: 'product-files', id: 43 },
      option_plans: { provider: 'product-files', id: 44 },
    },
  });
});

test('resolveWorkflowRuntimeConfiguration merges defaults under caller overrides', () => {
  const resolved = resolveWorkflowRuntimeConfiguration({
    tasks: [extractTask()],
    runtimeParamsSchema: monthlySchema,
    runtimeParamsDefaults: {
      fileRefs: {
        control_book: { provider: 'product-files', id: 7 },
        futu_exercises: { provider: 'product-files', id: 8 },
        option_plans: { provider: 'product-files', id: 9 },
      },
    },
    runtimeParameters: { month: '2026-06' },
  });

  // default fileRef applies because caller did not override it
  assert.deepEqual(resolved.tasks[0].params.fileRef, { provider: 'product-files', id: 7 });
  assert.equal(resolved.runtimeParameters.month, '2026-06');
});

test('resolveWorkflowRuntimeConfiguration supports preview runtime defaults for edited tasks', () => {
  const resolved = resolveWorkflowRuntimeConfiguration({
    tasks: [extractTask()],
    runtimeParamsSchema: monthlySchema,
    runtimeParamsDefaults: {
      month: '2026-06',
      fileRefs: {
        control_book: { provider: 'product-files', id: 88 },
        futu_exercises: { provider: 'product-files', id: 89 },
        option_plans: { provider: 'product-files', id: 90 },
      },
    },
    runtimeParameters: { month: '2026-06' },
  });

  assert.deepEqual(resolved.tasks[0].params.fileRef, { provider: 'product-files', id: 88 });
  assert.deepEqual(resolved.runtimeParameters, {
    month: '2026-06',
    fileRefs: {
      control_book: { provider: 'product-files', id: 88 },
      futu_exercises: { provider: 'product-files', id: 89 },
      option_plans: { provider: 'product-files', id: 90 },
    },
  });
});

test('resolveWorkflowRuntimeConfiguration throws when required runtime parameter is missing', () => {
  assert.throws(
    () =>
      resolveWorkflowRuntimeConfiguration({
        tasks: [extractTask()],
        runtimeParamsSchema: { month: { type: 'string', label: '月份', required: true } },
        runtimeParamsDefaults: {},
        runtimeParameters: {},
      }),
    /Missing runtime parameter: month/,
  );
});

test('resolveWorkflowRuntimeConfiguration throws when required nested runtime parameter is missing', () => {
  assert.throws(
    () =>
      resolveWorkflowRuntimeConfiguration({
        tasks: [extractTask()],
        runtimeParamsSchema: monthlySchema,
        runtimeParamsDefaults: {},
        runtimeParameters: { month: '2026-05', fileRefs: {} },
      }),
    /Missing runtime parameter: fileRefs\.control_book/,
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
    /Missing runtime parameter: fileRefs/,
  );
});

test('resolveWorkflowRuntimeConfiguration rejects wrong type for nested numeric parameter', () => {
  assert.throws(
    () =>
      resolveWorkflowRuntimeConfiguration({
        tasks: [extractTask()],
        runtimeParamsSchema: monthlySchema,
        runtimeParamsDefaults: {},
        runtimeParameters: { month: '2026-05', fileRefs: { control_book: 'not-a-ref', futu_exercises: {}, option_plans: {} } },
      }),
    /Runtime parameter fileRefs\.control_book must be an object/,
  );
});

test('resolveWorkflowRuntimeConfiguration rejects unknown runtime parameter keys', () => {
  assert.throws(
    () =>
      resolveWorkflowRuntimeConfiguration({
        tasks: [extractTask()],
        runtimeParamsSchema: monthlySchema,
        runtimeParamsDefaults: {},
        runtimeParameters: {
          month: '2026-05',
          fileRefs: {
            control_book: { provider: 'product-files', id: 1 },
            futu_exercises: { provider: 'product-files', id: 2 },
            option_plans: { provider: 'product-files', id: 3 },
          },
          surprise: true,
        },
      }),
    /Unknown runtime parameter: surprise/,
  );
});

test('resolveWorkflowRuntimeConfiguration resolves runtime constants into output task params', () => {
  const outputTask = baseTask({
    id: 'persist_capitalization_summary',
    name: 'Persist Capitalization Summary',
    operatorCode: 'dataframe.persist.excel',
    params: {
      fileName: 'Capitalization_Table_Summary_View.xlsx',
      fileNamePrefix: { $fromRuntime: 'month' },
      sheetName: 'Capitalization Summary',
    },
  });

  const resolved = resolveWorkflowRuntimeConfiguration({
    tasks: [outputTask],
    runtimeParamsSchema: { month: { type: 'string', label: 'Month', required: true } },
    runtimeParamsDefaults: {},
    runtimeParameters: { month: '2026-05' },
  });

  assert.equal(resolved.tasks[0].params.fileNamePrefix, '2026-05');
  assert.deepEqual(resolved.runtimeParameters, { month: '2026-05' });
});

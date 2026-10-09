import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  filterWorkflowRuntimeParametersBySchema,
  normalizeWorkflowRuntimeParametersSchema,
  resolveWorkflowRuntimeConfiguration,
} from './runtimeParameters.js';
import { deriveWorkflowRuntimeConfigFromTasks } from './runtimeParameterRequirements.js';
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

test('resolveWorkflowRuntimeConfiguration migrates the legacy cancel/restore fileRef name', () => {
  const task = baseTask({
    id: 'read_cancel_restore',
    operatorCode: 'sheet.range.extract',
    params: { fileRef: { $fromRuntime: 'fileRefs.incremental_cancel_restore_report' } },
  });
  const schema: WorkflowRuntimeParametersSchema = {
    fileRefs: {
      type: 'object',
      label: 'fileRefs',
      properties: { incremental_cancel_restore_report: { type: 'object', label: 'Incremental report' } },
    },
  };
  const resolved = resolveWorkflowRuntimeConfiguration({
    tasks: [task],
    runtimeParamsSchema: schema,
    runtimeParamsDefaults: {},
    runtimeParameters: { fileRefs: { cancel_restore_report: { provider: 'product-files', id: 206 } } },
  });
  assert.deepEqual(resolved.tasks[0].params.fileRef, { provider: 'product-files', id: 206 });
  assert.deepEqual(resolved.runtimeParameters.fileRefs, {
    incremental_cancel_restore_report: { provider: 'product-files', id: 206 },
  });
});

test('resolveWorkflowRuntimeConfiguration drops the legacy cancel/restore fileRef when both names are present', () => {
  const schema: WorkflowRuntimeParametersSchema = {
    fileRefs: {
      type: 'object',
      label: 'fileRefs',
      properties: { incremental_cancel_restore_report: { type: 'object', label: 'Incremental report' } },
    },
  };
  const resolved = resolveWorkflowRuntimeConfiguration({
    tasks: [],
    runtimeParamsSchema: schema,
    runtimeParamsDefaults: {},
    runtimeParameters: {
      fileRefs: {
        cancel_restore_report: { provider: 'product-files', id: 1 },
        incremental_cancel_restore_report: { provider: 'product-files', id: 2 },
      },
    },
  });
  assert.deepEqual(resolved.runtimeParameters.fileRefs, {
    incremental_cancel_restore_report: { provider: 'product-files', id: 2 },
  });
});

test('resolveWorkflowRuntimeConfiguration preserves product file path keys', () => {
  const resolved = resolveWorkflowRuntimeConfiguration({
    tasks: [
      baseTask({
        id: 'extract',
        name: 'Extract',
        operatorCode: 'sheet.range.extract',
        params: { fileRef: { $fromRuntime: 'fileRefs.control_book' } },
      }),
    ],
    runtimeParamsSchema: {
      fileRefs: {
        type: 'object',
        label: 'Files',
        properties: { control_book: { type: 'object', label: 'Control Book' } },
      },
    },
    runtimeParamsDefaults: {},
    runtimeParameters: {
      fileRefs: {
        control_book: { provider: 'product-files', key: 'input/2026-05/Control Book.xlsx' },
      },
    },
  });

  assert.deepEqual(resolved.tasks[0]?.params.fileRef, {
    provider: 'product-files',
    key: 'input/2026-05/Control Book.xlsx',
  });
});

test('resolveWorkflowRuntimeConfiguration accepts file reference metadata beside a nested sheet parameter', () => {
  const task = baseTask({
    operatorCode: 'sheet.range.extract',
    params: {
      fileRef: { $fromRuntime: 'fileRefs.option_plans_summary' },
      sheetName: { $fromRuntime: 'fileRefs.option_plans_summary.sheet' },
    },
  });
  const resolved = resolveWorkflowRuntimeConfiguration({
    tasks: [task],
    runtimeParamsSchema: {
      fileRefs: {
        type: 'object',
        label: 'Files',
        properties: {
          option_plans_summary: {
            type: 'object',
            label: 'Option Plans Summary',
            properties: { sheet: { type: 'string', label: 'Sheet' } },
          },
        },
      },
    },
    runtimeParamsDefaults: {},
    runtimeParameters: {
      fileRefs: {
        option_plans_summary: {
          provider: 'product-files',
          id: 43,
          sheet: 'Option Plans Summary',
        },
      },
    },
  });

  assert.deepEqual(resolved.tasks[0]?.params.fileRef, {
    provider: 'product-files',
    id: 43,
    sheet: 'Option Plans Summary',
  });
  assert.equal(resolved.tasks[0]?.params.sheetName, 'Option Plans Summary');
});

test('filterWorkflowRuntimeParametersBySchema keeps child workflow params and drops inherited extras', () => {
  const filtered = filterWorkflowRuntimeParametersBySchema(
    {
      month: '2026-08',
      fixedValues: { optionsOutstandingCullgen: 4_156_815 },
      fileRefs: {
        option_plans_summary: {
          provider: 'product-files',
          id: 43,
          sheet: '!Option Plans Summary (Post-Gyr',
        },
        bc_subplan_transfer: {
          provider: 'product-files',
          id: 53,
          sheet: '2025 BC Subplan Transfer',
        },
      },
    },
    {
      fileRefs: {
        type: 'object',
        label: 'Files',
        properties: {
          option_plans_summary: {
            type: 'object',
            label: 'Option Plans Summary',
            properties: { sheet: { type: 'string', label: 'Sheet' } },
          },
        },
      },
    },
  );

  assert.deepEqual(filtered, {
    fileRefs: {
      option_plans_summary: {
        provider: 'product-files',
        id: 43,
        sheet: '!Option Plans Summary (Post-Gyr',
      },
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

test('resolveWorkflowRuntimeConfiguration ignores required metadata on runtime schema', () => {
  const resolved = resolveWorkflowRuntimeConfiguration({
    tasks: [baseTask({ params: {} })],
    runtimeParamsSchema: { month: { type: 'string', label: '月份', required: true } },
    runtimeParamsDefaults: {},
    runtimeParameters: {},
  });

  assert.deepEqual(resolved.runtimeParameters, {});
});

test('resolveWorkflowRuntimeConfiguration throws when a referenced nested runtime parameter is missing', () => {
  assert.throws(
    () =>
      resolveWorkflowRuntimeConfiguration({
        tasks: [extractTask()],
        runtimeParamsSchema: monthlySchema,
        runtimeParamsDefaults: {},
        runtimeParameters: { month: '2026-05', fileRefs: {} },
      }),
    /Runtime parameter reference not found: fileRefs\.control_book/,
  );
});

test('resolveWorkflowRuntimeConfiguration throws when a referenced runtime object is missing', () => {
  assert.throws(
    () =>
      resolveWorkflowRuntimeConfiguration({
        tasks: [extractTask()],
        runtimeParamsSchema: monthlySchema,
        runtimeParamsDefaults: {},
        runtimeParameters: { month: '2026-05' },
      }),
    /Runtime parameter reference not found: fileRefs\.control_book/,
  );
});

test('resolveWorkflowRuntimeConfiguration rejects wrong type for nested numeric parameter', () => {
  assert.throws(
    () =>
      resolveWorkflowRuntimeConfiguration({
        tasks: [extractTask()],
        runtimeParamsSchema: monthlySchema,
        runtimeParamsDefaults: {},
        runtimeParameters: {
          month: '2026-05',
          fileRefs: { control_book: 'not-a-ref', futu_exercises: {}, option_plans: {} },
        },
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

test('normalizeWorkflowRuntimeParametersSchema preserves required metadata from workflow runtime schema', () => {
  const schema = normalizeWorkflowRuntimeParametersSchema({
    optionalMonth: { type: 'string', label: 'Optional Month' },
    requiredMonth: { type: 'string', label: 'Required Month', required: true },
  });

  assert.equal(schema.optionalMonth.required, undefined);
  assert.equal(schema.requiredMonth.required, true);
});

test('normalizeWorkflowRuntimeParametersSchema preserves optional source categories', () => {
  const schema = normalizeWorkflowRuntimeParametersSchema({
    fileRefs: {
      type: 'object',
      label: 'fileRefs',
      properties: {
        source: { type: 'object', label: 'Source', required: false, optionalCategory: 'inherit' },
      },
    },
  });

  assert.equal(schema.fileRefs.properties?.source.optionalCategory, 'inherit');
});

test('deriveWorkflowRuntimeConfigFromTasks does not inject workflow-level required metadata', () => {
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

  const runtimeConfig = deriveWorkflowRuntimeConfigFromTasks({
    tasks: [outputTask],
    runtimeParamsSchema: {},
    runtimeParamsDefaults: {},
  });

  assert.equal(runtimeConfig.runtimeParamsSchema.month?.label, 'Month');
  assert.equal(runtimeConfig.runtimeParamsSchema.month?.required, undefined);
});

test('deriveWorkflowRuntimeConfigFromTasks derives schema from task runtime references', () => {
  const extractTask = baseTask({
    id: 'task_extract_range',
    name: 'Extract Excel Range',
    operatorCode: 'sheet.range.extract',
    params: {
      fileRef: { $fromRuntime: 'fileRefs.source' },
      sheetName: 'Detailed Cap Table',
      range: 'A1:Z50',
    },
  });

  const runtimeConfig = deriveWorkflowRuntimeConfigFromTasks({
    tasks: [extractTask],
    runtimeParamsSchema: {},
    runtimeParamsDefaults: {},
  });

  assert.equal(runtimeConfig.runtimeParamsSchema.fileRefs?.type, 'object');
  assert.equal(runtimeConfig.runtimeParamsSchema.fileRefs?.properties?.source?.type, 'object');
  assert.equal(runtimeConfig.runtimeParamsSchema.fileRefs?.properties?.source?.label, 'Extract Excel Range file');
  assert.equal(runtimeConfig.runtimeParamsSchema.fileRefs?.required, undefined);
  assert.equal(runtimeConfig.runtimeParamsSchema.fileRefs?.properties?.source?.required, undefined);
  assert.deepEqual(runtimeConfig.runtimeParamsDefaults, {});
});

test('deriveWorkflowRuntimeConfigFromTasks derives typed schema and defaults from runtime reference metadata', () => {
  const computeTask = baseTask({
    id: 'calc_business_inputs',
    name: 'Calc Business Inputs',
    operatorCode: 'sql.compute',
    params: {
      sql: 'select {constants.optionsOutstandingCullgen} as total',
      tableBindings: [{ tableName: 'source', inputSlot: 'source' }],
      constants: {
        optionsOutstandingCullgen: {
          $fromRuntime: 'fixedValues.optionsOutstandingCullgen',
          $type: 'number',
          $label: 'Options Outstanding - Cullgen',
          $default: 4156815,
        },
      },
    },
  });

  const runtimeConfig = deriveWorkflowRuntimeConfigFromTasks({
    tasks: [computeTask],
    runtimeParamsSchema: {},
    runtimeParamsDefaults: {},
  });

  assert.equal(runtimeConfig.runtimeParamsSchema.fixedValues?.type, 'object');
  assert.equal(runtimeConfig.runtimeParamsSchema.fixedValues?.properties?.optionsOutstandingCullgen?.type, 'number');
  assert.equal(
    runtimeConfig.runtimeParamsSchema.fixedValues?.properties?.optionsOutstandingCullgen?.label,
    'Options Outstanding - Cullgen',
  );
  assert.deepEqual(runtimeConfig.runtimeParamsDefaults, {
    fixedValues: {
      optionsOutstandingCullgen: 4156815,
    },
  });
});

test('deriveWorkflowRuntimeConfigFromTasks keeps saved defaults ahead of task reference defaults', () => {
  const extractTask = baseTask({
    id: 'extract_bc_subplan_transfer',
    name: 'Extract 2025 BC Subplan Transfer',
    operatorCode: 'sheet.range.extract',
    params: {
      fileRef: {
        $fromRuntime: 'fileRefs.bc_subplan_transfer',
        $type: 'object',
        $label: '2025 BC Subplan Transfer input source',
        $default: { sheet: 'Vesting Schedule' },
      },
      sheetName: {
        $fromRuntime: 'fileRefs.bc_subplan_transfer.sheet',
        $type: 'string',
        $label: 'Sheet',
        $default: 'Vesting Schedule',
      },
      range: 'A2:AI',
    },
  });

  const runtimeConfig = deriveWorkflowRuntimeConfigFromTasks({
    tasks: [extractTask],
    runtimeParamsSchema: {},
    runtimeParamsDefaults: {
      fileRefs: {
        bc_subplan_transfer: {
          provider: 'product-files',
          id: 65,
          sheet: '2025 BC Subplan Transfer',
        },
      },
    },
  });

  assert.deepEqual(runtimeConfig.runtimeParamsDefaults, {
    fileRefs: {
      bc_subplan_transfer: {
        provider: 'product-files',
        id: 65,
        sheet: '2025 BC Subplan Transfer',
      },
    },
  });
});

test('deriveWorkflowRuntimeConfigFromTasks keeps saved defaults ahead of operator defaults', () => {
  const persistTask = baseTask({
    id: 'persist_capitalization_summary',
    name: 'Persist Capitalization Summary',
    operatorCode: 'dataframe.persist.excel',
    params: {
      fileName: 'Capitalization_Table_Summary_View.xlsx',
      fileNamePrefix: { $fromRuntime: 'month' },
      sheetName: 'Capitalization Summary',
    },
  });

  const runtimeConfig = deriveWorkflowRuntimeConfigFromTasks({
    tasks: [persistTask],
    runtimeParamsSchema: {
      month: { type: 'string', label: 'Month' },
    },
    runtimeParamsDefaults: {
      month: '2026-05',
    },
  });

  assert.equal(runtimeConfig.runtimeParamsDefaults.month, '2026-05');
});

test('deriveWorkflowRuntimeConfigFromTasks drops schema and defaults that are not referenced by workflow tasks', () => {
  const extractTask = baseTask({
    id: 'task_extract_range',
    name: 'Extract Excel Range',
    operatorCode: 'sheet.range.extract',
    params: {
      fileRef: { $fromRuntime: 'fileRefs.source' },
      sheetName: 'Detailed Cap Table',
      range: 'A1:Z50',
    },
  });

  const runtimeConfig = deriveWorkflowRuntimeConfigFromTasks({
    tasks: [extractTask],
    runtimeParamsSchema: {
      fileRefs: {
        type: 'object',
        label: 'File refs',
        properties: {
          source: { type: 'object', label: 'Source file' },
          stale: { type: 'object', label: 'Stale file' },
        },
      },
      businessRequiredOnly: { type: 'string', label: 'Should not persist' },
    },
    runtimeParamsDefaults: {
      fileRefs: {
        source: { provider: 'product-files', id: 7 },
        stale: { provider: 'product-files', id: 8 },
      },
      businessRequiredOnly: 'required',
    },
  });

  assert.deepEqual(runtimeConfig.runtimeParamsSchema, {
    fileRefs: {
      type: 'object',
      label: 'fileRefs',
      properties: {
        source: { type: 'object', label: 'Source file' },
      },
    },
  });
  assert.deepEqual(runtimeConfig.runtimeParamsDefaults, {
    fileRefs: {
      source: { provider: 'product-files', id: 7 },
    },
  });
});

test('resolveWorkflowRuntimeConfiguration resolves a persist fileNameSuffix from monthUnderscore', () => {
  const resolved = resolveWorkflowRuntimeConfiguration({
    tasks: [
      baseTask({
        id: 'persist_control_book_base_dated',
        operatorCode: 'workbook.persist.excel',
        params: {
          fileName: 'EQ_Control_Book_Base.xlsx',
          folderPrefix: 'control_book',
          fileNameSuffix: { $fromRuntime: 'monthUnderscore' },
        },
      }),
    ],
    runtimeParamsSchema: { monthUnderscore: { type: 'string', label: 'Month (underscore)' } },
    runtimeParamsDefaults: { monthUnderscore: '2026_05' },
    runtimeParameters: { monthUnderscore: '2026_06' },
  });
  assert.equal(resolved.tasks[0].params.fileNameSuffix, '2026_06');
});

test('resolveWorkflowRuntimeConfiguration falls back to the default monthUnderscore when none is provided', () => {
  const resolved = resolveWorkflowRuntimeConfiguration({
    tasks: [
      baseTask({
        id: 'persist_control_book_base_dated',
        operatorCode: 'workbook.persist.excel',
        params: { fileName: 'EQ_Control_Book_Base.xlsx', fileNameSuffix: { $fromRuntime: 'monthUnderscore' } },
      }),
    ],
    runtimeParamsSchema: { monthUnderscore: { type: 'string', label: 'Month (underscore)' } },
    runtimeParamsDefaults: { monthUnderscore: '2026_05' },
  });
  assert.equal(resolved.tasks[0].params.fileNameSuffix, '2026_05');
});

test('filterWorkflowRuntimeParametersBySchema keeps monthUnderscore only when the child schema declares it', () => {
  const inherited = { month: '2026-06', monthUnderscore: '2026_06', fileRefs: {} };
  assert.deepEqual(
    filterWorkflowRuntimeParametersBySchema(inherited, {
      monthUnderscore: { type: 'string', label: 'Month (underscore)' },
    }),
    { monthUnderscore: '2026_06' },
  );
  // Without the declaration the inherited value is dropped at the invoke boundary.
  assert.deepEqual(
    filterWorkflowRuntimeParametersBySchema(inherited, {
      fileRefs: { type: 'object', label: 'Files', properties: {} },
    }),
    { fileRefs: {} },
  );
});

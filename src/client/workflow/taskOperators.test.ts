import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkflowTask } from '../../shared/types.js';
import {
  collectWorkflowTaskParamInputUsages,
  collectWorkflowRuntimeReferences,
  decodeWorkflowFileParamSelection,
  encodeWorkflowFileParamSelection,
  getTaskInputSlots,
  normalizeSheetRangeExtractTask,
  normalizeSheetSectionsExtractTask,
  normalizeWorkflowFileParamValue,
} from './taskOperators.js';

function buildSectionsTask(fileId: unknown): WorkflowTask {
  return {
    id: 'extract_option_plans',
    name: 'Extract Option Plans Sections',
    operatorCode: 'sheet.sections.extract',
    operatorVersion: '1.0.0',
    description: '',
    x: 0,
    y: 0,
    inputs: {},
    dependsOn: [],
    params: {
      fileId,
      sheetName: 'Option Plans Summary',
      sectionMode: 'manual',
      sections: [{ key: 'section_1', title: 'Section 1', range: 'A1:B2', headerRow: 1 }],
    },
  };
}

test('normalizeSheetSectionsExtractTask preserves runtime file references', () => {
  const task = buildSectionsTask({ $fromRuntime: 'fileRefs.option_plans' });

  normalizeSheetSectionsExtractTask(task);

  assert.deepEqual(task.params.fileRef, { $fromRuntime: 'fileRefs.option_plans' });
  assert.equal(task.params.fileId, undefined);
});

test('normalizeSheetRangeExtractTask preserves runtime sheet references', () => {
  const task: WorkflowTask = {
    ...buildSectionsTask({ $fromRuntime: 'fileRefs.bc_subplan_transfer' }),
    operatorCode: 'sheet.range.extract',
    params: {
      fileRef: { $fromRuntime: 'fileRefs.bc_subplan_transfer' },
      sheetName: { $fromRuntime: 'sheetNames.bc_subplan_transfer' },
      range: 'A2:AI',
    },
  };

  normalizeSheetRangeExtractTask(task);

  assert.deepEqual(task.params.sheetName, { $fromRuntime: 'sheetNames.bc_subplan_transfer' });
});

test('normalizeWorkflowFileParamValue accepts numeric ids and runtime references', () => {
  assert.equal(normalizeWorkflowFileParamValue(7), 7);
  assert.deepEqual(normalizeWorkflowFileParamValue({ $fromRuntime: 'fileIds.control_book' }), {
    $fromRuntime: 'fileIds.control_book',
  });
  assert.equal(normalizeWorkflowFileParamValue(null), null);
});

test('workflow file select encoding round-trips runtime references', () => {
  const encoded = encodeWorkflowFileParamSelection({ $fromRuntime: 'fileRefs.option_plans' });

  assert.equal(encoded, '__runtime__:fileRefs.option_plans');
  assert.deepEqual(decodeWorkflowFileParamSelection(encoded), { $fromRuntime: 'fileRefs.option_plans' });
});

test('collectWorkflowRuntimeReferences finds nested task runtime bindings', () => {
  const refs = collectWorkflowRuntimeReferences({
    fileRef: { $fromRuntime: 'fileRefs.option_plans' },
    sections: [{ key: 'section_1', title: 'Section 1' }],
    nested: { source: { $fromRuntime: 'fileRefs.control_book' } },
  });

  assert.deepEqual(refs, [
    { paramPath: 'fileRef', runtimePath: 'fileRefs.option_plans' },
    { paramPath: 'nested.source', runtimePath: 'fileRefs.control_book' },
  ]);
});

test('collectWorkflowTaskParamInputUsages includes fixed file params for extract tasks', () => {
  const task = buildSectionsTask(7);

  assert.deepEqual(collectWorkflowTaskParamInputUsages(task), [{ paramPath: 'fileId', kind: 'file', fileId: 7 }]);
});

test('collectWorkflowTaskParamInputUsages includes runtime file params for extract tasks', () => {
  const task = buildSectionsTask({ $fromRuntime: 'fileRefs.option_plans' });

  assert.deepEqual(collectWorkflowTaskParamInputUsages(task), [
    { paramPath: 'fileId', kind: 'runtime', runtimePath: 'fileRefs.option_plans' },
  ]);
});

test('collectWorkflowTaskParamInputUsages includes runtime file params for workflow invoke tasks', () => {
  const task: WorkflowTask = {
    id: 'invoke_option_plans_summary',
    name: 'Invoke Option Plans Summary',
    operatorCode: 'workflow.invoke',
    operatorVersion: '1.0.0',
    description: '',
    x: 0,
    y: 0,
    inputs: {},
    dependsOn: [],
    params: {
      workflowCode: 'option-plans-summary-values',
      runtimeParameters: {
        fileRefs: {
          option_plans_summary: { $fromRuntime: 'fileRefs.option_plans_summary' },
        },
        fixedValues: {
          ignored: { $fromRuntime: 'fixedValues.ignored' },
        },
      },
    },
  };

  assert.deepEqual(collectWorkflowTaskParamInputUsages(task), [
    {
      paramPath: 'runtimeParameters.fileRefs.option_plans_summary',
      kind: 'runtime',
      runtimePath: 'fileRefs.option_plans_summary',
    },
  ]);
});

function buildWorkbookPersistTask(inputSlot: string, from: string): WorkflowTask {
  return {
    id: 'persist_control_book_base',
    name: 'Persist Merged Control Book Base',
    operatorCode: 'workbook.persist.excel',
    operatorVersion: '1.0.0',
    description: '',
    x: 0,
    y: 0,
    inputs: { [inputSlot]: { from, slot: 'dataframe', guards: [{ id: 'g1', type: 'dataframe.schema.assert' }] } },
    dependsOn: [],
    params: {
      sheets: [{ inputSlot, sheetName: 'EQ Control Book', headerRow: 9 }],
      fileName: 'EQ_Control_Book_Base.xlsx',
    },
  } as unknown as WorkflowTask;
}

// workbook.persist.excel only declares input1, but binds inputs via sheets[].inputSlot.
const workbookPersistOperator = { inputSlots: [{ slot: 'input1' }] } as unknown as Parameters<typeof getTaskInputSlots>[1];

test('workbook persist excel reports its custom sheets slot so the incoming edge renders', () => {
  const task = buildWorkbookPersistTask('control_book', 'merge_control_book');
  // Edge rendering uses getTaskInputSlots; it must return the real sheets slot (control_book)
  // even though the operator only declares input1, otherwise merge -> persist has no edge.
  assert.deepEqual(getTaskInputSlots(task, workbookPersistOperator), ['control_book']);
  assert.equal(task.inputs?.control_book?.from, 'merge_control_book');
});

test('workbook persist excel falls back to input1 when sheets use the default slot', () => {
  const task = buildWorkbookPersistTask('input1', 'merge_control_book');
  assert.deepEqual(getTaskInputSlots(task, workbookPersistOperator), ['input1']);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkflowTask } from '../../shared/types.js';
import {
  collectWorkflowTaskParamInputUsages,
  collectWorkflowRuntimeReferences,
  decodeWorkflowFileParamSelection,
  encodeWorkflowFileParamSelection,
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

test('normalizeWorkflowFileParamValue accepts numeric ids and runtime references', () => {
  assert.equal(normalizeWorkflowFileParamValue(7), 7);
  assert.deepEqual(normalizeWorkflowFileParamValue({ $fromRuntime: 'fileIds.control_book' }), {
    $fromRuntime: 'fileIds.control_book',
  });
  assert.equal(normalizeWorkflowFileParamValue(null), null);
});

test('workflow file select encoding round-trips runtime references', () => {
  const encoded = encodeWorkflowFileParamSelection({ $fromRuntime: 'fileRefs.summary_source' });

  assert.equal(encoded, '__runtime__:fileRefs.summary_source');
  assert.deepEqual(decodeWorkflowFileParamSelection(encoded), { $fromRuntime: 'fileRefs.summary_source' });
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

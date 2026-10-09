import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ProductFileRecord, WorkflowDefinition } from '../../shared/types.js';
import {
  cloneJson,
  flattenWorkflowRuntimeSchema,
  formatRuntimeSummaryValue,
  getNestedValueAtPath,
  readRuntimeDefaultControlValue,
  runtimeProductFileId,
  setNestedValueAtPath,
  setWorkflowRuntimeDefaultFileId,
  setWorkflowRuntimeDefaultString,
  stringifyWorkflowJson,
  syncRuntimeDefaultControlToWorkflow,
  workflowRuntimeDefaultFileId,
  workflowRuntimeDefaultString,
} from './runtimeDefaults.js';

const FILE = {
  id: 7,
  logicalPath: '/Futu/grants.xlsx',
  displayPath: '/Futu/grants.xlsx',
} as ProductFileRecord;

const files = () => [FILE];

function workflowWithDefaults(defaults: Record<string, unknown>): WorkflowDefinition {
  return {
    id: 1,
    code: 'demo',
    name: 'Demo',
    description: '',
    status: 'draft',
    version: 1,
    tasks: [],
    runtimeParamsSchema: {},
    runtimeParamsDefaults: defaults,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  };
}

function control(dataset: Record<string, string>, value: string): HTMLInputElement {
  return { dataset, value } as unknown as HTMLInputElement;
}

test('nested path helpers read and write dotted paths, creating missing objects', () => {
  const source: Record<string, unknown> = {};
  setNestedValueAtPath(source, 'fileRefs.grants.key', '/Futu/grants.xlsx');
  assert.equal(getNestedValueAtPath(source, 'fileRefs.grants.key'), '/Futu/grants.xlsx');
  assert.deepEqual(Object.keys(source), ['fileRefs']);

  // A non-object in the way is replaced rather than walked into.
  const blocked: Record<string, unknown> = { a: 5 };
  setNestedValueAtPath(blocked, 'a.b', 1);
  assert.deepEqual(blocked.a, { b: 1 });
  assert.equal(getNestedValueAtPath(blocked, 'a.b'), 1);
  // Empty paths are ignored instead of writing to the root.
  const root: Record<string, unknown> = { keep: true };
  setNestedValueAtPath(root, '   ', 9);
  assert.deepEqual(root, { keep: true });
});

test('runtime schema flattening keeps fileRefs containers and labels nested fields', () => {
  const entries = flattenWorkflowRuntimeSchema({
    sheet: { type: 'string', label: 'Sheet' },
    fileRefs: {
      type: 'object',
      label: 'Files',
      properties: {
        grants: { type: 'string', label: 'Grants file' },
      },
    },
    nested: {
      type: 'object',
      label: 'Nested',
      properties: { deep: { type: 'number', label: 'Deep' } },
    },
    'fileRefs.group': {
      type: 'object',
      label: 'Group',
      properties: { inner: { type: 'string', label: 'Inner' } },
    },
  });

  const paths = entries.map((entry) => entry.path);
  // A plain nested object is replaced by its children; the `fileRefs` tree keeps its own container
  // entries so a runtime path can point at a whole fileRef group.
  assert.deepEqual(paths, ['sheet', 'fileRefs.grants', 'nested.deep', 'fileRefs.group', 'fileRefs.group.inner']);
  assert.equal(entries.find((entry) => entry.path === 'fileRefs.grants')?.label, 'Grants file');
  // Unlabelled fields fall back to their path.
  assert.equal(entries.find((entry) => entry.path === 'nested.deep')?.label, 'Deep');
  assert.deepEqual(
    entries.filter((entry) => entry.path.startsWith('fileRefs.')).map((entry) => entry.path),
    ['fileRefs.grants', 'fileRefs.group', 'fileRefs.group.inner'],
  );
});

test('string defaults round-trip and empty values are cleared', () => {
  const workflow = workflowWithDefaults({ sheet: 'Grants' });
  assert.equal(workflowRuntimeDefaultString(workflow, 'sheet'), 'Grants');
  assert.equal(workflowRuntimeDefaultString(workflow, 'missing'), '');

  setWorkflowRuntimeDefaultString(workflow, 'sheet', 'Exercises');
  assert.equal(workflow.runtimeParamsDefaults.sheet, 'Exercises');
  setWorkflowRuntimeDefaultString(workflow, 'sheet', '');
  assert.equal(workflow.runtimeParamsDefaults.sheet, undefined);
});

test('file defaults are stored by logical key and resolved back to a file id', () => {
  const workflow = workflowWithDefaults({});
  setWorkflowRuntimeDefaultFileId(workflow, 'fileRefs.grants', FILE.id, files);

  assert.deepEqual(workflow.runtimeParamsDefaults.fileRefs, {
    grants: { provider: 'product-files', key: '/Futu/grants.xlsx', id: undefined },
  });
  assert.equal(workflowRuntimeDefaultFileId(workflow, 'fileRefs.grants', files), FILE.id);

  // Unknown ids and non-fileRef values resolve to null instead of throwing.
  assert.equal(runtimeProductFileId({ provider: 'other', id: 7 }, files), null);
  assert.equal(runtimeProductFileId('nope', files), null);
  assert.equal(runtimeProductFileId({ provider: 'product-files', id: 7 }, files), FILE.id);
});

test('runtime default controls coerce per declared type', () => {
  assert.equal(readRuntimeDefaultControlValue(control({ runtimeDefaultType: 'number' }, '42'), undefined, files), 42);
  assert.equal(
    readRuntimeDefaultControlValue(control({ runtimeDefaultType: 'boolean' }, 'true'), undefined, files),
    true,
  );
  assert.equal(readRuntimeDefaultControlValue(control({ runtimeDefaultType: 'string' }, ' x '), undefined, files), 'x');
  // Blank input clears the default.
  assert.equal(
    readRuntimeDefaultControlValue(control({ runtimeDefaultType: 'string' }, '  '), undefined, files),
    undefined,
  );

  const fileRef = readRuntimeDefaultControlValue(
    control({ runtimeDefaultType: 'fileRef', runtimeDefaultPath: 'fileRefs.grants' }, String(FILE.id)),
    undefined,
    files,
  ) as Record<string, unknown>;
  assert.deepEqual(fileRef, { provider: 'product-files', key: '/Futu/grants.xlsx' });
});

test('syncing a control writes through to the workflow defaults', () => {
  const workflow = workflowWithDefaults({});
  const numberControl = control({ runtimeDefaultPath: 'sheet.pageSize', runtimeDefaultType: 'number' }, '50');
  assert.equal(syncRuntimeDefaultControlToWorkflow(workflow, numberControl, files), true);
  assert.equal(getNestedValueAtPath(workflow.runtimeParamsDefaults as Record<string, unknown>, 'sheet.pageSize'), 50);

  // Controls without a bound path are ignored.
  assert.equal(syncRuntimeDefaultControlToWorkflow(workflow, control({}, '1'), files), false);
});

test('summary formatting and json stringification cover the value shapes the panel shows', () => {
  assert.equal(formatRuntimeSummaryValue(undefined), '未设置默认值');
  assert.equal(formatRuntimeSummaryValue(null), 'null');
  assert.equal(formatRuntimeSummaryValue(''), '""');
  assert.equal(formatRuntimeSummaryValue(12), '12');
  assert.equal(formatRuntimeSummaryValue({ a: 1 }), '{"a":1}');
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  assert.equal(typeof formatRuntimeSummaryValue(cyclic), 'string');
  assert.equal(stringifyWorkflowJson(null), '{}');
  assert.equal(cloneJson({ a: { b: 1 } }).a.b, 1);
});

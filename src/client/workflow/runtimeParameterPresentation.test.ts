import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildRuntimeInputFileItems,
  isRuntimeInputFileParameter,
  shouldRerenderRuntimeDefaultControl,
} from './runtimeParameterPresentation.js';

const entries = [
  { path: 'fileRefs.control_book', required: false, type: 'object', label: 'EQ Control Book workbook' },
  { path: 'fileRefs.bc_subplan_transfer', required: false, type: 'object', label: '2025 BC Subplan Transfer input source' },
  { path: 'fileRefs.bc_subplan_transfer.sheet', required: false, type: 'string', label: 'Sheet' },
  { path: 'fixedValues.warrants', required: false, type: 'number', label: 'Warrants' },
];

test('runtime input file parameters include linked sheet names', () => {
  assert.equal(isRuntimeInputFileParameter(entries[1]!), true);
  assert.equal(isRuntimeInputFileParameter(entries[2]!), true);
  assert.equal(isRuntimeInputFileParameter(entries[3]!), false);
});

test('runtime input file items pair a sheet name with its matching file reference', () => {
  assert.deepEqual(buildRuntimeInputFileItems(entries), [
    { file: entries[0], sheet: undefined },
    { file: entries[1], sheet: entries[2] },
  ]);
});

test('runtime default text and number inputs update state without replacing the editor DOM', () => {
  assert.equal(shouldRerenderRuntimeDefaultControl('string'), false);
  assert.equal(shouldRerenderRuntimeDefaultControl('number'), false);
  assert.equal(shouldRerenderRuntimeDefaultControl('boolean'), false);
  assert.equal(shouldRerenderRuntimeDefaultControl('fileRef'), true);
});

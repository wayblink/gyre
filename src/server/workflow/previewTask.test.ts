import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WorkflowTask } from '../../shared/types.js';
import { selectWorkflowPreviewTasks } from './previewTask.js';

function task(id: string, dependsOn: string[] = []): WorkflowTask {
  return {
    id,
    name: id,
    operatorCode: 'sheet.range.extract',
    operatorVersion: '1.0.0',
    description: '',
    params: {},
    inputs: {},
    dependsOn,
    x: 0,
    y: 0,
  };
}

test('selectWorkflowPreviewTasks keeps only the selected task dependency closure', () => {
  const selected = selectWorkflowPreviewTasks(
    [task('extract_current'), task('calc_current', ['extract_current']), task('optional_unrelated')],
    'calc_current',
  );

  assert.deepEqual(
    selected.map((item) => item.id),
    ['extract_current', 'calc_current'],
  );
});

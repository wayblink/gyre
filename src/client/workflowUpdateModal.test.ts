import assert from 'node:assert/strict';
import test from 'node:test';

import { getWorkflowUpdateSheetOptions } from './workflowUpdateModal.js';

/**
 * The update modal's Sheet picker has to behave like the Monthly Update one: the operator's choice
 * wins, the definition default is the fallback, and the workbook's real sheet list is what the
 * control offers. A picked sheet that the workbook no longer contains must stay visible — silently
 * switching to another sheet would extract the wrong table without any error.
 */

test('sheet options keep the operator pick and offer the workbook sheets', () => {
  assert.deepEqual(
    getWorkflowUpdateSheetOptions({
      selectedSheet: '授予记录',
      defaultSheet: '授予记录',
      sheets: ['授予记录', '归属记录', '协议详情'],
    }),
    { selectedSheet: '授予记录', options: ['授予记录', '归属记录', '协议详情'] },
  );
});

test('sheet options prepend a pick the workbook does not contain', () => {
  assert.deepEqual(
    getWorkflowUpdateSheetOptions({
      selectedSheet: 'Options OS Detail',
      defaultSheet: 'Personnel Summary (Options OS D',
      sheets: ['Personnel Summary (Options OS D', 'Report Information'],
    }),
    {
      selectedSheet: 'Options OS Detail',
      options: ['Options OS Detail', 'Personnel Summary (Options OS D', 'Report Information'],
    },
  );
});

test('sheet options fall back to the source default before the first workbook sheet', () => {
  assert.deepEqual(
    getWorkflowUpdateSheetOptions({
      selectedSheet: null,
      defaultSheet: 'Personnel Summary (Options OS D',
      sheets: ['Report Information', 'Personnel Summary (Options OS D'],
    }),
    { selectedSheet: 'Personnel Summary (Options OS D', options: ['Report Information', 'Personnel Summary (Options OS D'] },
  );
});

test('sheet options use the first workbook sheet when nothing is configured', () => {
  assert.deepEqual(
    getWorkflowUpdateSheetOptions({
      selectedSheet: '  ',
      defaultSheet: '',
      sheets: [' 授予记录 ', '', '归属记录'],
    }),
    { selectedSheet: '授予记录', options: ['授予记录', '归属记录'] },
  );
});

test('sheet options are empty when the workbook has no readable sheet names', () => {
  assert.deepEqual(getWorkflowUpdateSheetOptions({ selectedSheet: null, defaultSheet: null, sheets: [] }), {
    selectedSheet: '',
    options: [],
  });
});

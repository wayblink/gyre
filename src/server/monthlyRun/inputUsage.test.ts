import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isMonthlyRunWorkflowRuntimeInputRow,
  monthlyRunWorkflowFileRuntimeKeyForName,
  monthlyRunWorkflowFileRuntimeKeyForRow,
  monthlyRunWorkflowFixedRuntimeKeyForRow,
} from './inputUsage.js';

test('monthly run input usage marks workflow file runtime rows as used', () => {
  assert.equal(monthlyRunWorkflowFileRuntimeKeyForRow({ source_group: 'shareworks', label: 'EQ Control Book' }), 'control_book');
  assert.equal(monthlyRunWorkflowFileRuntimeKeyForRow({ source_group: 'futu', label: 'Futu BCI Exercises to Date' }), 'futu_exercises');
  assert.equal(monthlyRunWorkflowFileRuntimeKeyForRow({ source_group: 'shareworks', label: 'Option Plans Summary' }), 'option_plans');
  assert.equal(monthlyRunWorkflowFileRuntimeKeyForRow({ source_group: 'shareworks', label: 'Detailed Cap Table' }), 'summary_source');
});

test('monthly run source usage can be calculated from the merged source file name', () => {
  assert.equal(monthlyRunWorkflowFileRuntimeKeyForName('EQ Control Book'), 'control_book');
  assert.equal(monthlyRunWorkflowFileRuntimeKeyForName('Option Plans Summary.xlsx'), 'option_plans');
  assert.equal(monthlyRunWorkflowFileRuntimeKeyForName('Futu BCI Exercises to Date'), 'futu_exercises');
  assert.equal(monthlyRunWorkflowFileRuntimeKeyForName('Option plans summary(include cancel)'), null);
  assert.equal(monthlyRunWorkflowFileRuntimeKeyForName('GYRE 2025 BC Subplan canceled'), null);
});

test('monthly run input usage marks only workflow fixed runtime rows as used', () => {
  assert.equal(
    monthlyRunWorkflowFixedRuntimeKeyForRow({
      source_group: 'fixed',
      metric_key: 'fixed_options_outstanding_cullgen',
      label: 'Options Outstanding- Cullgen',
    }),
    'optionsOutstandingCullgen',
  );
  assert.equal(
    monthlyRunWorkflowFixedRuntimeKeyForRow({
      source_group: 'fixed',
      metric_key: 'fixed_options_available_cullgen',
      label: 'Options Available- Cullgen',
    }),
    'optionsAvailableCullgen',
  );
  assert.equal(
    isMonthlyRunWorkflowRuntimeInputRow({
      source_group: 'fixed',
      metric_key: 'fixed_cullgen_common_stock',
      label: 'Cullgen common stock',
    }),
    false,
  );
});

test('monthly run input usage handles raw value labels used by checklist rows', () => {
  assert.equal(
    isMonthlyRunWorkflowRuntimeInputRow({
      source_group: 'shareworks',
      raw_value: {
        fileName: 'EQ Control Book',
        item: 'EOM',
      },
    }),
    true,
  );
  assert.equal(
    isMonthlyRunWorkflowRuntimeInputRow({
      source_group: 'futu',
      raw_value: JSON.stringify({
        fileName: 'Option Plans detail',
        uploadedFile: 'Not uploaded',
      }),
    }),
    false,
  );
});

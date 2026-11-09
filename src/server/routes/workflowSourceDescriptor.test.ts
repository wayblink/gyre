import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { sourcesFromWorkflowSchemaJson } from './support.js';

/**
 * The update dialog's per-source Sheet picker is driven by `sourcesFromWorkflowSchemaJson`.
 *
 * `defaultSheetName` is where a DB workflow declares which sheet a source reads (Monthly Update
 * derives its whole source list from it), and it survives an editor save because the schema
 * normalizer knows about it. `properties.sheet` only declares that the sheet is operator-settable —
 * without it a picked sheet is rejected as an unknown runtime parameter. Reading the default from
 * `properties.sheet.default` instead made the picker vanish on any definition that declared its
 * default the documented way.
 */

test('a source declaring defaultSheetName reaches the page with a sheet default', () => {
  const descriptors = sourcesFromWorkflowSchemaJson({
    fileRefs: {
      type: 'object',
      properties: {
        employee_grants: {
          type: 'object',
          label: 'Grant workbook',
          allowSheetNameOverride: true,
          defaultSheetName: 'Personnel Summary (Options OS D',
          properties: { sheet: { type: 'string', label: 'Sheet' } },
        },
      },
    },
  });

  assert.deepEqual(descriptors, [
    {
      sourceKey: 'employee_grants',
      label: 'Grant workbook',
      sheet: 'Personnel Summary (Options OS D',
      required: true,
    },
  ]);
});

test('a source without any sheet metadata still exposes no sheet control', () => {
  const descriptors = sourcesFromWorkflowSchemaJson({
    fileRefs: { type: 'object', properties: { plain: { type: 'object', label: 'Plain' } } },
  });

  assert.deepEqual(descriptors, [{ sourceKey: 'plain', label: 'Plain', required: true }]);
});

test('hidden system-supplied sources stay out of the page source list', () => {
  const descriptors = sourcesFromWorkflowSchemaJson({
    fileRefs: {
      type: 'object',
      properties: {
        base_control_book: { type: 'object', label: 'Base', hidden: true, defaultSheetName: 'EQ Control Book' },
      },
    },
  });

  assert.deepEqual(descriptors, []);
});

test('Employee Import derives both sheet pickers from its own definition', () => {
  const seed = JSON.parse(
    readFileSync(path.join(process.cwd(), 'database/workflows/employee-import.json'), 'utf8'),
  ) as { runtimeParamsSchema: unknown };

  assert.deepEqual(sourcesFromWorkflowSchemaJson(seed.runtimeParamsSchema), [
    { sourceKey: 'futu_grants', label: 'Futu 授予记录', sheet: '授予记录', required: true },
    {
      sourceKey: 'shareworks_grants',
      label: 'Shareworks Options OS Detail',
      sheet: 'Personnel Summary (Options OS D',
      required: true,
    },
  ]);
});

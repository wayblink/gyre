import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import type { WorkflowRuntimeParameters, WorkflowRuntimeParametersSchema, WorkflowTask } from '../../shared/types.js';
import { resolveWorkflowRuntimeConfiguration } from './runtimeParameters.js';

/**
 * Employee Import (员工归集) reads two workbooks whose data sheet is not fixed:
 *
 * - the Futu grants export always has `授予记录`, but an export may be renamed;
 * - the Shareworks export's sheet depends on how the operator exported it — the deprecated
 *   `!!Gyre Cap Table *.xlsx` master workbook carried `Options OS Detail`, while the current
 *   `!Cap_Table_-_Options_OS_Detail_by_Plan_(Pers._Summary_OS_only).xlsx` carries
 *   `Personnel Summary (Options OS D` (Excel truncates sheet names at 31 characters).
 *
 * The page therefore has to let the operator pick the sheet, like Monthly Update does, and the
 * picked value has to reach the extract task. These tests pin the definition contract; the extract
 * task reading `params.sheetName` is what makes the whole chain work.
 */

const seed = JSON.parse(
  readFileSync(path.join(process.cwd(), 'database/workflows/employee-import.json'), 'utf8'),
) as {
  tasks: WorkflowTask[];
  runtimeParamsSchema: WorkflowRuntimeParametersSchema;
  runtimeParamsDefaults: WorkflowRuntimeParameters;
};

const DEFAULT_SHEETS: Record<string, string> = {
  futu_grants: '授予记录',
  shareworks_grants: 'Personnel Summary (Options OS D',
};

function schemaFileRefs() {
  const schema = seed.runtimeParamsSchema as {
    fileRefs?: { properties?: Record<string, Record<string, unknown>> };
  };
  return schema.fileRefs?.properties ?? {};
}

function resolveRun(fileRefs: Record<string, unknown>) {
  return resolveWorkflowRuntimeConfiguration({
    tasks: seed.tasks,
    runtimeParamsSchema: seed.runtimeParamsSchema,
    runtimeParamsDefaults: seed.runtimeParamsDefaults,
    runtimeParameters: { fileRefs },
  });
}

function sheetNameOf(resolved: { tasks: WorkflowTask[] }, taskId: string) {
  const task = resolved.tasks.find((candidate) => candidate.id === taskId);
  assert.ok(task, `missing task ${taskId}`);
  return String(task.params.sheetName ?? '');
}

test('every Employee Import source declares an operator-settable sheet', () => {
  for (const [sourceKey, defaultSheetName] of Object.entries(DEFAULT_SHEETS)) {
    const field = schemaFileRefs()[sourceKey];
    assert.ok(field, `schema is missing source ${sourceKey}`);
    assert.equal(field.defaultSheetName, defaultSheetName);
    assert.equal(field.allowSheetNameOverride, true);
    const sheetField = (field.properties as Record<string, Record<string, unknown>> | undefined)?.sheet;
    assert.ok(sheetField, `source ${sourceKey} does not declare properties.sheet; a picked sheet would be dropped`);
    assert.equal(sheetField.type, 'string');
  }
});

test('both extract tasks read their sheet from the bound file reference', () => {
  const expectations: Record<string, string> = {
    extract_futu_grants: 'futu_grants',
    extract_shareworks: 'shareworks_grants',
  };
  for (const [taskId, sourceKey] of Object.entries(expectations)) {
    const task = seed.tasks.find((candidate) => candidate.id === taskId);
    assert.ok(task, `missing task ${taskId}`);
    const reference = task.params.sheetName as { $fromRuntime?: string; $default?: string };
    assert.equal(reference.$fromRuntime, `fileRefs.${sourceKey}.sheet`);
    assert.equal(reference.$default, DEFAULT_SHEETS[sourceKey]);
  }
});

test('an operator-picked sheet overrides the default for that source only', () => {
  const resolved = resolveRun({
    futu_grants: { provider: 'product-files', id: 109, key: 'input/futu.xlsx', sheet: 'Custom Futu Sheet' },
    shareworks_grants: {
      provider: 'product-files',
      id: 420,
      key: 'input/shareworks.xls',
      sheet: 'Personnel Summary (Options OS D',
    },
  });

  assert.equal(sheetNameOf(resolved, 'extract_futu_grants'), 'Custom Futu Sheet');
  assert.equal(sheetNameOf(resolved, 'extract_shareworks'), 'Personnel Summary (Options OS D');
});

test('a run that binds only a file falls back to the definition sheet defaults', () => {
  const resolved = resolveRun({
    futu_grants: { provider: 'product-files', id: 109, key: 'input/futu.xlsx' },
    shareworks_grants: { provider: 'product-files', id: 420, key: 'input/shareworks.xls' },
  });

  assert.equal(sheetNameOf(resolved, 'extract_futu_grants'), DEFAULT_SHEETS.futu_grants);
  assert.equal(sheetNameOf(resolved, 'extract_shareworks'), DEFAULT_SHEETS.shareworks_grants);
});

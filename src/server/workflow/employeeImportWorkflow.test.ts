import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EMPLOYEE_IMPORT_WORKFLOW_CODE,
  buildEmployeeImportWorkflowSeedDefinition,
} from './employeeImportWorkflow.js';

test('employee-import workflow wires extract → normalize → union → db.upsert', () => {
  const def = buildEmployeeImportWorkflowSeedDefinition();
  assert.equal(def.code, EMPLOYEE_IMPORT_WORKFLOW_CODE);
  assert.equal(def.status, 'active');

  const byId = new Map(def.tasks.map((task) => [task.id, task]));
  assert.deepEqual(
    def.tasks.map((task) => task.operatorCode),
    ['sheet.range.extract', 'sheet.range.extract', 'sql.compute', 'sql.compute', 'sql.compute', 'dataframe.union', 'db.upsert'],
  );

  const filter = byId.get('filter_shareworks_employee_rows');
  assert.equal(filter?.operatorCode, 'sql.compute');
  assert.equal(filter?.inputs.input1.from, 'extract_shareworks');
  assert.match(String(filter?.params.sql ?? ''), /Last Name/);
  assert.match(String(filter?.params.sql ?? ''), /Subplan/i);

  // union pulls from both normalize steps
  const shareworksNormalize = byId.get('normalize_shareworks_employees');
  assert.equal(shareworksNormalize?.inputs.input1.from, 'filter_shareworks_employee_rows');
  assert.match(
    String(shareworksNormalize?.params.sql ?? '').replace(/\s+/g, ' '),
    /\[First Name\].*\[Middle Name\].*\[Last Name\]/,
  );

  const union = byId.get('union_employees');
  assert.equal(union?.inputs.input1.from, 'normalize_futu_employees');
  assert.equal(union?.inputs.input2.from, 'normalize_shareworks_employees');

  // db.upsert targets employees keyed on employee_id
  const upsert = byId.get('upsert_employees');
  assert.equal(upsert?.params.table, 'employees');
  assert.deepEqual(upsert?.params.conflictColumns, ['employee_id']);
  assert.equal(upsert?.inputs.input1.from, 'union_employees');
});

test('employee-import workflow derives fileRefs runtime params for both sources', () => {
  const def = buildEmployeeImportWorkflowSeedDefinition();
  const fileRefs = def.runtimeParamsSchema.fileRefs;
  assert.equal(fileRefs?.type, 'object');
  assert.equal(fileRefs?.properties?.futu_grants?.type, 'object');
  assert.equal(fileRefs?.properties?.shareworks_grants?.type, 'object');
});

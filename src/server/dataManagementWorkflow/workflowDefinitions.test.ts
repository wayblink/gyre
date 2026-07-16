import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DATA_MANAGEMENT_WORKFLOW_CONFIGS,
  buildDataManagementWorkflowRuntimeParameters,
  buildDataManagementWorkflowSeedDefinitions,
} from './workflowDefinitions.js';

test('Employee, Plan Summary, and 5% Holders are exposed as independent business workflows', () => {
  assert.deepEqual(Object.keys(DATA_MANAGEMENT_WORKFLOW_CONFIGS), ['employee', 'plan-summary', 'five-percent-holders']);
  assert.deepEqual(
    DATA_MANAGEMENT_WORKFLOW_CONFIGS.employee.sources.map((source) => source.sourceKey),
    ['futu_grants', 'shareworks_grants'],
  );
  assert.deepEqual(
    DATA_MANAGEMENT_WORKFLOW_CONFIGS['plan-summary'].sources.map((source) => source.sourceKey),
    ['shareworks_grants'],
  );
  assert.deepEqual(
    DATA_MANAGEMENT_WORKFLOW_CONFIGS['five-percent-holders'].sources.map((source) => source.sourceKey),
    ['capitalization_summary'],
  );
});

test('Employee workflow filters Shareworks plan-level placeholder rows before normalization', () => {
  const definitions = buildDataManagementWorkflowSeedDefinitions();
  const employee = definitions.find((definition) => definition.code === 'employee-import');
  assert.ok(employee);
  const byId = new Map(employee.tasks.map((task) => [task.id, task]));
  const filter = byId.get('filter_shareworks_employee_rows');
  assert.equal(filter?.operatorCode, 'sql.compute');
  assert.equal(filter?.inputs.input1.from, 'extract_shareworks');
  assert.equal(byId.get('normalize_shareworks_employees')?.inputs.input1.from, 'filter_shareworks_employee_rows');
});

test('Plan Summary workflow extracts, aggregates, then persists a dataframe file', () => {
  const definitions = buildDataManagementWorkflowSeedDefinitions();
  const plan = definitions.find((definition) => definition.code === 'plan-summary-sync');
  assert.ok(plan);
  assert.deepEqual(plan.tasks.map((task) => task.operatorCode), [
    'sheet.range.extract',
    'sql.compute',
    'dataframe.persist.excel',
  ]);
  assert.equal(plan.tasks[0]?.params.sheetName, 'Options OS Detail');
  assert.equal(plan.tasks[2]?.inputs.input1.from, 'aggregate_plan_summary');
  assert.equal(plan.tasks[2]?.params.fileName, 'Plan_Summary.xlsx');
  assert.equal(plan.tasks[2]?.params.sheetName, 'Plan Summary');
  assert.equal(plan.runtimeParamsSchema.fileRefs?.properties?.shareworks_grants?.type, 'object');
});

test('5% Holders workflow calculates from capitalization summary and fixed values, then persists a dataframe file', () => {
  const definitions = buildDataManagementWorkflowSeedDefinitions();
  const workflow = definitions.find((definition) => definition.code === 'five-percent-holders-sync');
  assert.ok(workflow);
  assert.deepEqual(workflow.tasks.map((task) => task.operatorCode), [
    'sheet.range.extract',
    'dataframe.sql.assert',
    'sql.compute',
    'dataframe.persist.excel',
  ]);
  assert.equal(workflow.tasks[0]?.params.sheetName, 'Capitalization Summary');
  assert.equal(workflow.tasks[0]?.params.range, 'A1:E200');
  assert.equal(workflow.tasks[0]?.params.headerRow, 1);
  assert.equal(workflow.tasks[1]?.inputs.capitalization.from, 'extract_capitalization_summary');
  assert.match(String(workflow.tasks[1]?.params.failureMessage), /Common Shares OS, Cullgen common stock/);
  assert.equal(workflow.tasks[2]?.inputs.capitalization.from, 'assert_five_percent_denominators');
  assert.match(String(workflow.tasks[2]?.params.sql), /'common shares os', 'cullgen common stock'/);
  const constants = workflow.tasks[2]?.params.constants as Record<string, { $fromRuntime?: string }>;
  assert.equal(constants.gniCommonStock?.$fromRuntime, 'fixedValues.fivePercentHoldersGniCommonStock');
  assert.equal(workflow.tasks[3]?.inputs.input1.from, 'calculate_five_percent_holders');
  assert.equal(workflow.tasks[3]?.params.fileName, 'Five_Percent_Holders.xlsx');
  assert.equal(workflow.tasks[3]?.params.sheetName, '5% Holders');
  assert.equal(workflow.runtimeParamsSchema.fileRefs?.properties?.capitalization_summary?.type, 'object');
  assert.equal(workflow.runtimeParamsSchema.fixedValues?.properties?.fivePercentHoldersGniCommonStock?.type, 'number');
  assert.equal(workflow.runtimeParamsDefaults.fixedValues, undefined);
});

test('business runtime parameters require a one-to-one file binding for every source', () => {
  assert.deepEqual(buildDataManagementWorkflowRuntimeParameters('plan-summary', {
    shareworks_grants: { fileId: 4 },
  }), {
    fileRefs: { shareworks_grants: { provider: 'product-files', id: 4 } },
  });
  assert.deepEqual(buildDataManagementWorkflowRuntimeParameters('five-percent-holders', {
    capitalization_summary: { fileId: 5 },
  }), {
    fileRefs: { capitalization_summary: { provider: 'product-files', id: 5 } },
  });
  assert.deepEqual(buildDataManagementWorkflowRuntimeParameters('five-percent-holders', {
    capitalization_summary: { fileId: 5 },
  }, {
    fixedValues: { fivePercentHoldersGniCommonStock: 10 },
  }), {
    fixedValues: { fivePercentHoldersGniCommonStock: 10 },
    fileRefs: { capitalization_summary: { provider: 'product-files', id: 5 } },
  });
  assert.throws(
    () => buildDataManagementWorkflowRuntimeParameters('employee', { futu_grants: { fileId: 9 } }),
    /shareworks_grants/,
  );
});

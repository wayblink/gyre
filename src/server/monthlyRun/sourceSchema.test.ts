import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { monthlySourcesFromSchemaOrdered } from './sourceSchema.js';

function monthlyWorkflowSchema(): Record<string, unknown> {
  const file = path.join(process.cwd(), 'database', 'workflows', 'gyre-captable-summary-v2.json');
  const doc = JSON.parse(readFileSync(file, 'utf8')) as { runtimeParamsSchema: Record<string, unknown> };
  return doc.runtimeParamsSchema;
}

test('monthly input sources render in the order the workflow definition declares, without ties', () => {
  const sources = monthlySourcesFromSchemaOrdered(monthlyWorkflowSchema());
  const visible = sources.filter((source) => !source.hidden);

  // Both Futu rows must sit above Gyre Option Plans Summary SL.
  const futuKeys = ['base_futu_exercises', 'incremental_futu_exercises'];
  const optionPlansIndex = visible.findIndex((source) => source.sourceKey === 'option_plans_summary');
  for (const key of futuKeys) {
    const index = visible.findIndex((source) => source.sourceKey === key);
    assert.ok(index >= 0, `${key} must be a visible monthly input source`);
    assert.ok(index < optionPlansIndex, `${key} must render above option_plans_summary`);
  }

  // jsonb does not preserve key order, so a repeated `order` makes the rendered row order
  // arbitrary. Every source must carry a distinct order value.
  const orders = sources.map((source) => source.order);
  assert.equal(new Set(orders).size, orders.length, `duplicate order values: ${orders.join(',')}`);
});

test('monthly Futu input sources are labelled for the monthly update flow', () => {
  const sources = monthlySourcesFromSchemaOrdered(monthlyWorkflowSchema());
  const byKey = new Map(sources.map((source) => [source.sourceKey, source.label]));

  assert.equal(byKey.get('base_futu_exercises'), 'Futu Exercises Latest');
  assert.equal(byKey.get('incremental_futu_exercises'), 'Futu Exercise Monthly Update');
});

test('2025 BC Subplan transfer remains as an optional compatibility input source', () => {
  const sources = monthlySourcesFromSchemaOrdered(monthlyWorkflowSchema());
  const transfer = sources.find((source) => source.sourceKey === 'bc_subplan_transfer');
  assert.equal(transfer?.label, '2025 BC Subplan Transfer');
  assert.equal(transfer?.required, false);
  assert.equal(transfer?.hidden, false);
  assert.equal(transfer?.order, 6);
  assert.equal(transfer?.allowSheetNameOverride, true);

  const workflow = JSON.parse(readFileSync(
    path.join(process.cwd(), 'database', 'workflows', 'gyre-captable-summary-v2.json'),
    'utf8',
  )) as { tasks: Array<Record<string, unknown>> };
  assert.equal(workflow.tasks.some((candidate) => candidate.id === 'extract_bc_subplan_transfer'), true);
  assert.equal(workflow.tasks.some((candidate) => candidate.id === 'calc_bc_subplan_cancelled'), true);
  const controlMetrics = workflow.tasks.find((candidate) => candidate.id === 'calc_control_book_metrics') as { params?: { sql?: string } } | undefined;
  assert.match(controlMetrics?.params?.sql ?? '', /Omnibus Inc\. Pl/);
  assert.match(controlMetrics?.params?.sql ?? '', /bc_subplan_transfer_control_book/);
  const optionMetrics = workflow.tasks.find((candidate) => candidate.id === 'calc_option_metrics') as { inputs?: unknown; params?: { sql?: string } } | undefined;
  assert.equal(JSON.stringify(optionMetrics?.inputs ?? {}).includes('bc_subplan'), true);
  assert.match(optionMetrics?.params?.sql ?? '', /bc_subplan_cancelled_adjustment/);
});

test('CapTable workflow includes Series B Preferred Stock as a configurable fixed value', () => {
  const workflow = JSON.parse(readFileSync(
    path.join(process.cwd(), 'database', 'workflows', 'gyre-captable-summary-v2.json'),
    'utf8',
  )) as { version: number; runtimeParamsSchema: Record<string, any>; runtimeParamsDefaults: Record<string, any>; tasks: Array<Record<string, any>> };
  assert.equal(workflow.version, 11);
  assert.equal(workflow.runtimeParamsSchema.fixedValues.properties.seriesBPreferredStock.type, 'number');
  assert.equal(workflow.runtimeParamsDefaults.fixedValues.seriesBPreferredStock, 18_486_180);
  const businessInputs = workflow.tasks.find((task) => task.id === 'calc_business_inputs');
  assert.match(businessInputs?.params?.sql ?? '', /series_b_preferred_stock/);
  const summary = workflow.tasks.find((task) => task.id === 'build_capitalization_summary');
  assert.match(summary?.params?.sql ?? '', /Series B Preferred Stock/);
});

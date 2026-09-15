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

test('2025 BC Subplan Transfer is optional and its extract schema check is a warning', () => {
  const sources = monthlySourcesFromSchemaOrdered(monthlyWorkflowSchema());
  const transfer = sources.find((source) => source.sourceKey === 'bc_subplan_transfer');
  assert.ok(transfer);
  assert.equal(transfer.required, false);

  const workflow = JSON.parse(readFileSync(
    path.join(process.cwd(), 'database', 'workflows', 'gyre-captable-summary-v2.json'),
    'utf8',
  )) as { tasks: Array<Record<string, unknown>> };
  const task = workflow.tasks.find((candidate) => candidate.id === 'extract_bc_subplan_transfer');
  assert.equal(task?.operatorCode, 'sheet.optional-range.extract');

  const transferCalculation = workflow.tasks.find((candidate) => candidate.id === 'calc_bc_subplan_cancelled');
  const transferInput = (transferCalculation?.inputs as Record<string, unknown>)?.transfer as Record<string, unknown> | undefined;
  const guards = transferInput?.guards as Array<Record<string, unknown>> | undefined;
  assert.equal(guards?.[0]?.params && (guards[0].params as Record<string, unknown>).failureStrategy, 'warning');
});

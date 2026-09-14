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

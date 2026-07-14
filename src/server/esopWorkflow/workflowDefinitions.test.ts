import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ESOP_PAGE_WORKFLOW_CONFIGS,
  buildEsopPageWorkflowSeedDefinitions,
  buildEsopWorkflowRuntimeParameters,
} from './workflowDefinitions.js';

test('ESOP detail pages each have an independent active workflow', () => {
  const definitions = buildEsopPageWorkflowSeedDefinitions();

  assert.deepEqual(
    definitions.map((definition) => definition.code),
    [
      'esop-grant-record-sync',
      'esop-exercise-record-sync',
      'esop-sold-shares-sync',
      'esop-transfer-to-futu-sync',
    ],
  );
  assert.ok(definitions.every((definition) => definition.status === 'active'));
  assert.ok(definitions.every((definition) => definition.tasks.at(-1)?.operatorCode === 'esop.page.persist'));
  assert.ok(
    definitions.every((definition) => {
      const fileRefs = definition.runtimeParamsSchema.fileRefs;
      return Object.values(fileRefs?.properties ?? {}).every((field) => field.type === 'object' && !field.properties);
    }),
  );
});

test('ESOP workflow inputs are one-to-one and never reused through another binding', () => {
  const grant = ESOP_PAGE_WORKFLOW_CONFIGS['grant-record'];
  assert.deepEqual(grant.sources.map((source) => source.sourceKey), ['futu_grants', 'shareworks_grants']);
  assert.deepEqual(grant.sources.map((source) => source.extractTaskId), ['extract_futu_grants', 'extract_shareworks_grants']);

  const exercise = ESOP_PAGE_WORKFLOW_CONFIGS['exercise-record'];
  const sold = ESOP_PAGE_WORKFLOW_CONFIGS['sold-shares'];
  const transfer = ESOP_PAGE_WORKFLOW_CONFIGS['transfer-plan'];
  assert.deepEqual(exercise.sources.map((source) => source.sourceKey), ['futu_exercises']);
  assert.deepEqual(sold.sources.map((source) => source.sourceKey), ['futu_sold_shares']);
  assert.deepEqual(transfer.sources.map((source) => source.sourceKey), ['transfer_plan']);
  assert.equal(transfer.sources[0]?.range, 'A4:AH');
  assert.equal(transfer.sources[0]?.headerRow, 4);

  const allSourceKeys = Object.values(ESOP_PAGE_WORKFLOW_CONFIGS).flatMap((config) =>
    config.sources.map((source) => source.sourceKey),
  );
  assert.equal(new Set(allSourceKeys).size, allSourceKeys.length);
});

test('business runtime builder validates required files and emits product file references', () => {
  assert.throws(
    () => buildEsopWorkflowRuntimeParameters('grant-record', { futu_grants: { fileId: 11 } }),
    /Missing ESOP workflow source: shareworks_grants/,
  );

  assert.deepEqual(
    buildEsopWorkflowRuntimeParameters('grant-record', {
      futu_grants: { fileId: 11 },
      shareworks_grants: { fileId: 12 },
    }),
    {
      fileRefs: {
        futu_grants: { provider: 'product-files', id: 11 },
        shareworks_grants: { provider: 'product-files', id: 12 },
      },
    },
  );
});

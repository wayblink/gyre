import assert from 'node:assert/strict';
import test from 'node:test';
import { rowsToDataFrame } from '../excel.js';
import { executeSqlDataFrameQuery } from '../workflow/operators/sqlUtils.js';
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
  assert.ok(
    definitions.every((definition) =>
      definition.tasks
        .filter((task) => task.id.startsWith('persist_'))
        .every((task) => task.operatorCode === 'dataframe.persist.excel'),
    ),
  );
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
  const grantDefinition = buildEsopPageWorkflowSeedDefinitions().find((definition) => definition.code === 'esop-grant-record-sync');
  assert.deepEqual(
    grantDefinition?.tasks.filter((task) => task.operatorCode === 'dataframe.persist.excel').map((task) => task.id),
    ['persist_grant_record_futu_file', 'persist_grant_record_shareworks_file'],
  );
  const shareworksProjection = grantDefinition?.tasks.find((task) => task.id === 'project_shareworks_grants_columns');
  const shareworksPersist = grantDefinition?.tasks.find((task) => task.id === 'persist_grant_record_shareworks_file');
  assert.equal(shareworksProjection?.operatorCode, 'sql.compute');
  assert.equal(shareworksProjection?.inputs.input1.from, 'extract_shareworks_grants');
  assert.equal(shareworksPersist?.inputs.input1.from, 'project_shareworks_grants_columns');
  assert.doesNotMatch(String(shareworksProjection?.params.sql ?? ''), /Cost Center/);
  assert.doesNotMatch(String(shareworksProjection?.params.sql ?? ''), /Participant Type @ Report Date/);

  const exercise = ESOP_PAGE_WORKFLOW_CONFIGS['exercise-record'];
  const sold = ESOP_PAGE_WORKFLOW_CONFIGS['sold-shares'];
  const transfer = ESOP_PAGE_WORKFLOW_CONFIGS['transfer-plan'];
  assert.deepEqual(exercise.sources.map((source) => source.sourceKey), ['futu_exercises']);
  const exerciseDefinition = buildEsopPageWorkflowSeedDefinitions().find((definition) => definition.code === 'esop-exercise-record-sync');
  const exerciseFilter = exerciseDefinition?.tasks.find((task) => task.id === 'filter_exercise_rows');
  const exercisePersist = exerciseDefinition?.tasks.find((task) => task.id === 'persist_exercise_record_file');
  assert.equal(exerciseFilter?.operatorCode, 'sql.compute');
  assert.equal(exerciseFilter?.inputs.input1.from, 'extract_exercises');
  assert.equal(exercisePersist?.inputs.input1.from, 'filter_exercise_rows');
  assert.deepEqual(sold.sources.map((source) => source.sourceKey), ['futu_sold_shares']);
  const soldDefinition = buildEsopPageWorkflowSeedDefinitions().find((definition) => definition.code === 'esop-sold-shares-sync');
  const soldFilter = soldDefinition?.tasks.find((task) => task.id === 'filter_sold_shares_rows');
  const soldPersist = soldDefinition?.tasks.find((task) => task.id === 'persist_sold_shares_file');
  assert.equal(soldFilter?.operatorCode, 'sql.compute');
  assert.equal(soldFilter?.inputs.input1.from, 'extract_sold_shares');
  assert.equal(soldPersist?.inputs.input1.from, 'filter_sold_shares_rows');
  assert.deepEqual(transfer.sources.map((source) => source.sourceKey), ['transfer_plan']);
  assert.equal(transfer.sources[0]?.range, 'A4:AH');
  assert.equal(transfer.sources[0]?.headerRow, 4);

  const allSourceKeys = Object.values(ESOP_PAGE_WORKFLOW_CONFIGS).flatMap((config) =>
    config.sources.map((source) => source.sourceKey),
  );
  assert.equal(new Set(allSourceKeys).size, allSourceKeys.length);
});

test('Exercise workflow filters translated header rows before persisting output', async () => {
  const definition = buildEsopPageWorkflowSeedDefinitions().find((item) => item.code === 'esop-exercise-record-sync');
  const task = definition?.tasks.find((item) => item.id === 'filter_exercise_rows');
  assert.ok(task);

  const result = await executeSqlDataFrameQuery(task, { rowsToDataFrame } as never, async (slot) => {
    assert.equal(slot, 'input1');
    return rowsToDataFrame(
      [
        {
          Name: '姓名',
          'Employee No.': '员工编号',
          'Futubull ID': 'Futubull 账号',
          'User ID': '用户 ID',
          'Grant No.': '授予编号',
          'Grant Date': '授予日期',
          'Grant Price(USD)': 0,
          'Exercise Date': '行权日期',
          'Ordered Qty': 0,
        },
        {
          Name: '叶卫国',
          'Employee No.': 'K00252',
          'Futubull ID': '26823650',
          'User ID': '12942000007',
          'Grant No.': 'K00252',
          'Grant Date': '2023-10-31',
          'Grant Price(USD)': 0.75,
          'Exercise Date': '2026-05-29',
          'Ordered Qty': 0,
        },
      ],
      { sheetName: 'Futu BCI Exercises to Date', a1Range: 'A1:M3' },
    );
  });

  assert.deepEqual(
    result.dataFrame.rows.map((row) => row['Employee No.']),
    ['K00252'],
  );
});

test('Sold Shares workflow filters note and blank rows before persisting output', async () => {
  const definition = buildEsopPageWorkflowSeedDefinitions().find((item) => item.code === 'esop-sold-shares-sync');
  const task = definition?.tasks.find((item) => item.id === 'filter_sold_shares_rows');
  assert.ok(task);

  const result = await executeSqlDataFrameQuery(task, { rowsToDataFrame } as never, async (slot) => {
    assert.equal(slot, 'input1');
    return rowsToDataFrame(
      [
        {
          姓名: '',
          工号: '',
          牛牛号: '',
          用户ID: '',
          出售总数量: 0,
          成交总数量: 942_453,
        },
        {
          姓名: 'Note: This report is ran quarterly to calculate the public float.',
          工号: '',
          牛牛号: '',
          用户ID: '',
          出售总数量: 0,
          成交总数量: 0,
        },
        {
          姓名: '工号',
          工号: '工号',
          牛牛号: '牛牛号',
          用户ID: '用户ID',
        },
        {
          姓名: '李巍',
          工号: 'K00003',
          牛牛号: '26219737',
          用户ID: '12942000006',
          出售总数量: 9_899,
          成交总数量: 9_899,
        },
      ],
      { sheetName: 'Futu sold shares', a1Range: 'A1:S5' },
    );
  });

  assert.deepEqual(
    result.dataFrame.rows.map((row) => row['姓名']),
    ['李巍'],
  );
  assert.deepEqual(
    result.dataFrame.rows.map((row) => row['工号']),
    ['K00003'],
  );
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

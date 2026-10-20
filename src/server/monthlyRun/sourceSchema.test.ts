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

  assert.deepEqual(
    visible.map((source) => source.label),
    [
      'Control Book Summary',
      'Control Book Detail update',
      'SERIES B Control Book',
      'Gyre Option Plans Summary SL',
      'Futu Exercises Summary',
      'Futu Exercise Export',
      '2025 BC Subplan Transfer',
      // Previous Capitalization Summary sits between these two in `order` but stays hidden: the
      // system injects last month's output itself, so there is nothing for the operator to upload.
      'Cancel & Restore Summary',
      'Cancel & Restore Detail',
      // Record pages are refreshed at the end of the monthly run. The Futu view reuses the Futu
      // exercise export above (same workbook, other sheet), so only these two are extra uploads.
      'Exercise Record · Shareworks',
      'Sold Shares · Futu 出售汇总',
    ],
  );

  // jsonb does not preserve key order, so a repeated `order` makes the rendered row order
  // arbitrary. Every source must carry a distinct order value.
  const orders = sources.map((source) => source.order);
  assert.equal(new Set(orders).size, orders.length, `duplicate order values: ${orders.join(',')}`);
});

test('last month Capitalization Summary is injected by the system and hidden from the table', () => {
  const sources = monthlySourcesFromSchemaOrdered(monthlyWorkflowSchema());
  const byKey = new Map(sources.map((source) => [source.sourceKey, source]));

  const previous = byKey.get('previous_capitalization_summary');
  assert.equal(previous?.hidden, true, 'the source must not be shown: nothing about it is operator input');
  // Still declared, because the run injects it and the history labels it.
  assert.ok(previous, 'the source itself must stay in the schema');
  assert.notEqual(previous?.required, true);
});

test('only sources the operator uploads carry a file-name template', () => {
  const sources = monthlySourcesFromSchemaOrdered(monthlyWorkflowSchema());
  const byKey = new Map(sources.map((source) => [source.sourceKey, source]));

  // Files carried over from last month describe themselves through their badge; a template on them
  // would suggest there is a file to go and find.
  for (const sourceKey of [
    'base_control_book',
    'base_futu_exercises',
    'previous_capitalization_summary',
    'base_cancel_restore_report',
  ]) {
    assert.equal(byKey.get(sourceKey)?.fileTemplate, undefined, `${sourceKey} must not have a template`);
  }

  // Everything the operator brings must say which export it is.
  for (const sourceKey of [
    'incremental_control_book',
    'option_plans_summary',
    'series_b',
    'incremental_futu_exercises',
    'bc_subplan_transfer',
    'incremental_cancel_restore_report',
    'exercise_record_shareworks',
    'sold_shares_futu',
  ]) {
    assert.ok(byKey.get(sourceKey)?.fileTemplate?.trim(), `${sourceKey} needs a template`);
  }

  assert.equal(byKey.get('incremental_control_book')?.fileTemplate, 'Control_Books_Detail_Data_DD.MM.YYYY_HH.mm.xlsx');
  assert.equal(
    byKey.get('exercise_record_shareworks')?.fileTemplate,
    'DD-M-YYYY_HH-mm-ss_MDT_!GYRE_Exec_Option_OS.xlsx',
  );
});

test('monthly Futu input sources are labelled for the monthly update flow', () => {
  const sources = monthlySourcesFromSchemaOrdered(monthlyWorkflowSchema());
  const byKey = new Map(sources.map((source) => [source.sourceKey, source.label]));

  assert.equal(byKey.get('base_futu_exercises'), 'Futu Exercises Summary');
  assert.equal(byKey.get('incremental_futu_exercises'), 'Futu Exercise Export');
});

test('monthly input sources distinguish required business files from optional inputs', () => {
  const sources = monthlySourcesFromSchemaOrdered(monthlyWorkflowSchema());
  const byKey = new Map(sources.map((source) => [source.sourceKey, source]));

  // Business files the operator must always bring: without them the month cannot be computed.
  for (const sourceKey of ['incremental_control_book', 'option_plans_summary']) {
    assert.equal(byKey.get(sourceKey)?.required, true, `${sourceKey} should be required`);
  }

  // The two incremental merges are optional: months before the Futu exercise report and the
  // cancel/restore report existed have no file to supply, and the merge sub-workflows fall back to
  // their base alone (an unbound optional source resolves to a declared-but-empty dataframe).
  for (const sourceKey of ['incremental_futu_exercises', 'incremental_cancel_restore_report']) {
    assert.equal(byKey.get(sourceKey)?.required, false, `${sourceKey} should be optional`);
    assert.equal(byKey.get(sourceKey)?.hidden, false, `${sourceKey} should stay visible`);
  }

  for (const sourceKey of [
    'base_control_book',
    'base_futu_exercises',
    'base_cancel_restore_report',
    'bc_subplan_transfer',
    'previous_capitalization_summary',
    'series_b',
  ]) {
    assert.equal(byKey.get(sourceKey)?.required, false, `${sourceKey} should remain optional`);
  }

  assert.equal(byKey.get('base_control_book')?.optionalCategory, 'inherit');
  assert.equal(byKey.get('base_futu_exercises')?.optionalCategory, 'inherit');
  assert.equal(byKey.get('previous_capitalization_summary')?.optionalCategory, 'inherit');
  assert.equal(byKey.get('base_cancel_restore_report')?.optionalCategory, 'inherit');
  assert.equal(byKey.get('bc_subplan_transfer')?.optionalCategory, 'validation');
  assert.equal(byKey.get('series_b')?.optionalCategory, 'supplement');
});

test('2025 BC Subplan transfer remains as an optional compatibility input source', () => {
  const sources = monthlySourcesFromSchemaOrdered(monthlyWorkflowSchema());
  const transfer = sources.find((source) => source.sourceKey === 'bc_subplan_transfer');
  assert.equal(transfer?.label, '2025 BC Subplan Transfer');
  assert.equal(transfer?.required, false);
  assert.equal(transfer?.hidden, false);
  assert.equal(transfer?.order, 7);

  const workflow = JSON.parse(
    readFileSync(path.join(process.cwd(), 'database', 'workflows', 'gyre-captable-summary-v2.json'), 'utf8'),
  ) as { tasks: Array<Record<string, unknown>> };
  assert.equal(
    workflow.tasks.some((candidate) => candidate.id === 'extract_bc_subplan_transfer'),
    true,
  );
  assert.equal(
    workflow.tasks.some((candidate) => candidate.id === 'calc_bc_subplan_cancelled'),
    true,
  );
  const controlMetrics = workflow.tasks.find((candidate) => candidate.id === 'calc_control_book_metrics') as
    { params?: { sql?: string } } | undefined;
  assert.match(controlMetrics?.params?.sql ?? '', /Omnibus Inc%Pl%/);
  assert.match(controlMetrics?.params?.sql ?? '', /Ominibus Inc%Pl%/);
  assert.match(controlMetrics?.params?.sql ?? '', /bc_subplan_transfer_control_book/);
  // A non-canonical Omnibus spelling must be surfaced as a warning, never as a silent drop.
  const controlMetricsGuards = JSON.stringify(
    (
      workflow.tasks.find((candidate) => candidate.id === 'calc_control_book_metrics') as
        { inputs?: unknown } | undefined
    )?.inputs ?? {},
  );
  assert.match(controlMetricsGuards, /guard_warn_control_book_comment_variants/);
  assert.match(controlMetricsGuards, /"failureStrategy":"warning"/);
  const optionMetrics = workflow.tasks.find((candidate) => candidate.id === 'calc_option_metrics') as
    { inputs?: unknown; params?: { sql?: string } } | undefined;
  assert.equal(JSON.stringify(optionMetrics?.inputs ?? {}).includes('bc_subplan'), true);
  assert.match(optionMetrics?.params?.sql ?? '', /bc_subplan_cancelled_adjustment/);
});

test('CapTable workflow derives Series B Preferred Stock from the Read SERIES B child workflow', () => {
  const workflow = JSON.parse(
    readFileSync(path.join(process.cwd(), 'database', 'workflows', 'gyre-captable-summary-v2.json'), 'utf8'),
  ) as {
    version: number;
    runtimeParamsSchema: Record<string, any>;
    runtimeParamsDefaults: Record<string, any>;
    tasks: Array<Record<string, any>>;
  };
  assert.ok(workflow.version >= 12);
  assert.equal(workflow.runtimeParamsSchema.monthUnderscore.type, 'string');
  const planSummaryInvoke = workflow.tasks.find((task) => task.id === 'invoke_plan_summary_sync');
  assert.equal(planSummaryInvoke?.operatorCode, 'workflow.invoke');
  assert.equal(planSummaryInvoke?.params?.workflowCode, 'plan-summary-sync');
  assert.equal(
    workflow.tasks.some((task) => task.id === 'aggregate_plan_summary' || task.id === 'persist_plan_summary'),
    false,
  );
  assert.equal(workflow.runtimeParamsSchema.fixedValues.properties.seriesBPreferredStock, undefined);
  assert.equal(workflow.runtimeParamsDefaults.fixedValues?.seriesBPreferredStock, undefined);
  const businessInputs = workflow.tasks.find((task) => task.id === 'calc_business_inputs');
  assert.match(businessInputs?.params?.sql ?? '', /series_b_preferred_stock/);
  assert.equal(JSON.stringify(businessInputs?.inputs ?? {}).includes('calculate_series_b_preferred_stock'), true);
  const seriesBCalculation = workflow.tasks.find((task) => task.id === 'calculate_series_b_preferred_stock');
  assert.match(seriesBCalculation?.params?.sql ?? '', /\* 5/);
  const summary = workflow.tasks.find((task) => task.id === 'build_capitalization_summary');
  assert.match(summary?.params?.sql ?? '', /Series B Preferred Stock/);
});

test('Plan Summary overrides BC Subplan Cancelled from the dated cancel/restore report', () => {
  const workflow = JSON.parse(
    readFileSync(path.join(process.cwd(), 'database', 'workflows', 'plan-summary-sync.json'), 'utf8'),
  ) as { version: number; tasks: Array<Record<string, any>> };
  assert.ok(workflow.version >= 3);
  const readReport = workflow.tasks.find((task) => task.id === 'invoke_cancel_restore_report');
  assert.equal(readReport?.operatorCode, 'workflow.invoke');
  assert.equal(readReport?.params?.workflowCode, 'gyre-therapeutics-cancel-restore-incremental-merge');
  const calculate = workflow.tasks.find((task) => task.id === 'calculate_cancel_restore_cancelled');
  assert.match(calculate?.params?.sql ?? '', /\[变更日期\]/);
  assert.match(calculate?.params?.sql ?? '', /\[数量\]/);
  assert.match(calculate?.params?.sql ?? '', /\[变更类型\]/);
  assert.match(calculate?.params?.sql ?? '', /已归属到期失效/);
  assert.match(calculate?.params?.sql ?? '', /wf_month_key\(\[变更日期\]\) <= \{constants\.workflowMonth\}/);
  assert.match(calculate?.params?.sql ?? '', /GYRE 2025 BC Subplan/);
  const aggregate = workflow.tasks.find((task) => task.id === 'aggregate_plan_summary');
  assert.equal(aggregate?.inputs?.input1?.from, 'union_plan_summary_inputs');
  assert.match(aggregate?.params?.sql ?? '', /category_for_grouping = 'cancel_restore'/);
});

test('Cancel and restore merge keeps all rows and defers month filtering to Plan Summary', () => {
  const workflow = JSON.parse(
    readFileSync(
      path.join(process.cwd(), 'database', 'workflows', 'gyre-therapeutics-cancel-restore-incremental-merge.json'),
      'utf8',
    ),
  ) as { tasks: Array<Record<string, any>> };
  const project = workflow.tasks.find((task) => task.id === 'project_incremental_cancel_restore_report');
  assert.doesNotMatch(project?.params?.sql ?? '', /wf_month_key/);
  assert.match(project?.params?.sql ?? '', /创建编号/);
  const merge = workflow.tasks.find((task) => task.id === 'merge_cancel_restore_report');
  assert.match(merge?.params?.sql ?? '', /创建编号/);
  assert.match(merge?.description ?? '', /幂等/);
  const persist = workflow.tasks.find((task) => task.id === 'persist_cancel_restore_base');
  assert.equal(persist?.params?.folderPrefix, 'cancel_restore');
  assert.equal(persist?.params?.fileNameSuffix?.$fromRuntime, 'monthUnderscore');
});

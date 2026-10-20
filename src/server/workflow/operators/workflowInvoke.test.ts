import assert from 'node:assert/strict';
import test from 'node:test';
import { rowsToDataFrame } from '../../excel.js';
import type { WorkflowDataFrame, WorkflowRuntimeParameters, WorkflowTaskPreviewResult } from '../../../shared/types.js';
import type { WorkflowOperatorExecutionContext, WorkflowOperatorRuntime } from './types.js';
import { workflowInvokeOperator } from './workflowInvoke.js';

type InvokeCall = {
  workflowId?: number;
  workflowCode?: string;
  runtimeParameters: WorkflowRuntimeParameters;
  inputDataFrames: Record<string, WorkflowDataFrame>;
  outputTaskId?: string;
  invocationStack: string[];
};

function createContext(params: Record<string, unknown>, calls: InvokeCall[]): WorkflowOperatorExecutionContext {
  const sourceFrame = rowsToDataFrame([{ key: 'Granted', value: 1 }]);
  const outputFrame = rowsToDataFrame([{ key: 'Granted', value: 10 }]);
  const runtime = {
    rowsToDataFrame,
    async invokeWorkflow(callParams: InvokeCall): Promise<WorkflowTaskPreviewResult> {
      calls.push(callParams);
      return { kind: 'dataframe', dataFrame: outputFrame };
    },
  } as unknown as WorkflowOperatorRuntime;
  const task = {
    id: 'invoke',
    name: 'Invoke Option Plans Summary',
    operatorCode: 'workflow.invoke',
    operatorVersion: '1.0.0',
    description: '',
    x: 0,
    y: 0,
    params,
    inputs: { input1: { from: 'source', slot: 'dataframe' } },
  };

  return {
    task,
    runtime,
    runtimeParameters: {
      month: '2026-08',
      fileRefs: {
        option_plans_summary: { provider: 'product-files', id: 43, sheet: 'Default Sheet' },
        bc_subplan_transfer: { provider: 'product-files', id: 53, sheet: '2025 BC Subplan Transfer' },
      },
    },
    invocationStack: ['parent-workflow', 'id:1'],
    resolveInputDataFrame: async (slot: string) => {
      assert.equal(slot, 'input1');
      return sourceFrame;
    },
    executed: new Map(),
    taskMap: new Map(),
    executeTask: async () => {
      throw new Error('not used');
    },
  } as unknown as WorkflowOperatorExecutionContext;
}

test('workflow.invoke inherits parent runtime parameters and maps input dataframes', async () => {
  const calls: InvokeCall[] = [];
  const context = createContext(
    {
      workflowCode: 'option-plans-summary-values',
      outputTaskId: 'enrich_option_plans_summary_plan_name',
      inputMappings: [{ inputSlot: 'input1', taskId: 'child_source' }],
    },
    calls,
  );

  const result = (await workflowInvokeOperator.execute(context)) as WorkflowTaskPreviewResult;

  assert.equal(result.kind, 'dataframe');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].workflowCode, 'option-plans-summary-values');
  assert.equal(calls[0].outputTaskId, 'enrich_option_plans_summary_plan_name');
  assert.deepEqual(calls[0].runtimeParameters.fileRefs, context.runtimeParameters.fileRefs);
  assert.equal(calls[0].inputDataFrames.child_source.rows[0].key, 'Granted');
  assert.deepEqual(calls[0].invocationStack, ['parent-workflow', 'id:1']);
});

test('workflow.invoke deep merges explicit runtime parameters over inherited values', async () => {
  const calls: InvokeCall[] = [];
  const context = createContext(
    {
      workflowCode: 'child',
      runtimeParameters: {
        fileRefs: {
          option_plans_summary: { provider: 'product-files', id: 99, sheet: 'Selected Sheet' },
        },
      },
    },
    calls,
  );

  await workflowInvokeOperator.execute(context);

  assert.equal(calls[0].runtimeParameters.month, '2026-08');
  assert.deepEqual(calls[0].runtimeParameters.fileRefs, {
    option_plans_summary: { provider: 'product-files', id: 99, sheet: 'Selected Sheet' },
    bc_subplan_transfer: { provider: 'product-files', id: 53, sheet: '2025 BC Subplan Transfer' },
  });
});

test('workflow.invoke can disable runtime parameter inheritance', async () => {
  const calls: InvokeCall[] = [];
  const context = createContext(
    {
      workflowId: 1386,
      inheritRuntimeParameters: false,
      runtimeParameters: { month: '2026-09' },
    },
    calls,
  );

  await workflowInvokeOperator.execute(context);

  assert.equal(calls[0].workflowId, 1386);
  assert.deepEqual(calls[0].runtimeParameters, { month: '2026-09' });
});

test('workflow.invoke fails when the host runtime has no invocation capability', async () => {
  const context = createContext({ workflowCode: 'child' }, []);
  (context.runtime as { invokeWorkflow?: unknown }).invokeWorkflow = undefined;

  await assert.rejects(() => workflowInvokeOperator.execute(context), /workflow\.invoke runtime is not configured/);
});

test('workflow.invoke skips the call when every listed source is unbound', async () => {
  const calls: InvokeCall[] = [];
  const context = createContext(
    {
      workflowCode: 'esop-sold-shares-sync',
      skipWhenEmpty: ['fileRefs.futu_sold_shares'],
      runtimeParameters: { fileRefs: { futu_sold_shares: { sheet: '出售汇总数据' } } },
    },
    calls,
  );

  const result = (await workflowInvokeOperator.execute(context)) as WorkflowTaskPreviewResult;

  assert.equal(calls.length, 0, 'nothing to sync, so the child must not run');
  assert.equal(result.kind, 'dataframe');
  assert.equal(result.dataFrame.rows.length, 0);
  assert.match(result.dataFrame.range.sheetName, /skipped/i);
});

test('workflow.invoke still runs when at least one listed source is bound', async () => {
  const calls: InvokeCall[] = [];
  const context = createContext(
    {
      workflowCode: 'esop-exercise-record-sync',
      skipWhenEmpty: ['fileRefs.futu_exercises', 'fileRefs.shareworks_exercises'],
      runtimeParameters: {
        fileRefs: {
          futu_exercises: {},
          shareworks_exercises: { provider: 'product-files', key: 'sw.xlsx', sheet: 'Executive Awards OS Only' },
        },
      },
    },
    calls,
  );

  await workflowInvokeOperator.execute(context);

  assert.equal(calls.length, 1, 'one bound source is enough');
  assert.deepEqual((calls[0].runtimeParameters.fileRefs as Record<string, unknown>).shareworks_exercises, {
    provider: 'product-files',
    key: 'sw.xlsx',
    sheet: 'Executive Awards OS Only',
  });
});

test('workflow.invoke refuses a skipWhenEmpty path that no runtime parameter declares', async () => {
  const calls: InvokeCall[] = [];
  const context = createContext(
    {
      workflowCode: 'esop-sold-shares-sync',
      // Typo: the monthly source is `sold_shares_futu`. Without the guard the task would skip on
      // every run and the page would simply stay empty, with the run reporting success.
      skipWhenEmpty: ['fileRefs.sold_shares'],
    },
    calls,
  );

  await assert.rejects(
    () => workflowInvokeOperator.execute(context),
    /skipWhenEmpty refers to an unknown runtime parameter: fileRefs\.sold_shares/,
  );
  assert.equal(calls.length, 0);
});

test('workflow.invoke asks the host to cascade child artifacts only when configured', async () => {
  const calls: InvokeCall[] = [];
  await workflowInvokeOperator.execute(createContext({ workflowCode: 'child' }, calls));
  assert.equal((calls[0] as { propagateChildArtifacts?: boolean }).propagateChildArtifacts, false);

  const cascading: InvokeCall[] = [];
  await workflowInvokeOperator.execute(
    createContext({ workflowCode: 'child', propagateChildArtifacts: true }, cascading),
  );
  assert.equal((cascading[0] as { propagateChildArtifacts?: boolean }).propagateChildArtifacts, true);
});

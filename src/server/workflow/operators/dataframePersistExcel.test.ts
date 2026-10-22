import assert from 'node:assert/strict';
import test from 'node:test';
import { rowsToDataFrame } from '../../excel.js';
import { dataframePersistExcelOperator } from './dataframePersistExcel.js';
import type { WorkflowOperatorExecuteResult, WorkflowOperatorExecutionContext } from './types.js';

function buildContext(params: Record<string, unknown>, rows: Array<Record<string, unknown>>) {
  const saved: unknown[] = [];
  const dataframe = rowsToDataFrame(rows, { sheetName: 'S', a1Range: 'A1:A1', columns: ['a'] });
  const context = {
    task: {
      id: 'persist',
      name: 'Persist',
      operatorCode: 'dataframe.persist.excel',
      operatorVersion: '1.0.0',
      description: '',
      x: 0,
      y: 0,
      params: { fileName: 'x.xlsx', sheetName: 'S', folderPrefix: 'output/x', ...params },
      inputs: { input1: { from: 'source', slot: 'dataframe' } },
    },
    runtime: {
      dataFrameToWorkbookBuffer: () => Buffer.from(''),
      async saveGeneratedWorkbook(input: unknown) {
        saved.push(input);
        return { id: 1, originalName: 'x.xlsx', displayName: 'x.xlsx' } as never;
      },
    },
    runtimeParameters: {},
    executed: new Map(),
    taskMap: new Map(),
    async executeTask() {
      throw new Error('not used');
    },
    async resolveInputDataFrame() {
      return dataframe;
    },
  } as unknown as WorkflowOperatorExecutionContext;
  return { context, saved };
}

/**
 * A monthly input can be optional. When its view has no rows the run must leave the folder alone:
 * a freshly written empty file becomes the newest artifact for the month and replaces the snapshot a
 * previous run produced, which silently blanks the page.
 */
test('an empty input writes nothing when skipWhenEmpty is on', async () => {
  const { context, saved } = buildContext({ skipWhenEmpty: true }, []);

  const result = (await dataframePersistExcelOperator.execute(context)) as Extract<
    WorkflowOperatorExecuteResult,
    { kind: string }
  >;

  assert.equal(saved.length, 0, 'no file must be written');
  assert.equal(result.kind, 'dataframe');
});

test('a non-empty input is still written when skipWhenEmpty is on', async () => {
  const { context, saved } = buildContext({ skipWhenEmpty: true }, [{ a: 1 }]);

  const result = (await dataframePersistExcelOperator.execute(context)) as Extract<
    WorkflowOperatorExecuteResult,
    { kind: string }
  >;

  assert.equal(saved.length, 1);
  assert.equal(result.kind, 'file');
});

test('without the flag an empty input still writes, so existing workflows are unchanged', async () => {
  const { context, saved } = buildContext({}, []);

  await dataframePersistExcelOperator.execute(context);

  assert.equal(saved.length, 1);
});

test('normalizeTask coerces skipWhenEmpty to a real boolean', () => {
  const task = {
    id: 'persist',
    name: 'Persist',
    operatorCode: 'dataframe.persist.excel',
    operatorVersion: '1.0.0',
    description: '',
    x: 0,
    y: 0,
    params: { skipWhenEmpty: 'yes' },
    inputs: {},
    dependsOn: [],
  } as never;

  dataframePersistExcelOperator.normalizeTask?.(task);

  assert.equal((task as { params: Record<string, unknown> }).params.skipWhenEmpty, false);
});

test('overwrite replaces an existing file instead of failing on the name', async () => {
  const { context, saved } = buildContext({ overwrite: true }, [{ a: 1 }]);

  await dataframePersistExcelOperator.execute(context);

  assert.equal((saved[0] as { conflictPolicy?: string }).conflictPolicy, 'overwrite');
  const plain = buildContext({}, [{ a: 1 }]);
  await dataframePersistExcelOperator.execute(plain.context);
  assert.equal((plain.saved[0] as { conflictPolicy?: string }).conflictPolicy, undefined);
});

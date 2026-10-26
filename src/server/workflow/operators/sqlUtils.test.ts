import assert from 'node:assert/strict';
import test from 'node:test';

import { executeSqlDataFrameQuery } from './sqlUtils.js';
import type { WorkflowOperatorRuntime } from './types.js';
import type { WorkflowDataFrame, WorkflowTask } from '../../../shared/types.js';

function frame(columns: string[], rows: Array<Record<string, unknown>> = []): WorkflowDataFrame {
  return {
    columns,
    rows,
    index: rows.map((_, index) => index + 1),
    matrix: [],
    range: {
      sheetName: 'frame',
      a1Range: '',
      startRow: 1,
      endRow: 1,
      startCol: 1,
      endCol: Math.max(columns.length, 1),
    },
  };
}

const runtime = {
  rowsToDataFrame: (rows: Array<Record<string, unknown>>, options: { columns?: string[] }) =>
    frame(options.columns ?? Array.from(new Set(rows.flatMap((row) => Object.keys(row)))), rows),
} as unknown as WorkflowOperatorRuntime;

const projectTask = (sql: string): WorkflowTask => ({
  id: 'project_increment',
  name: 'Project Increment',
  operatorCode: 'sql.compute',
  operatorVersion: '1.0.0',
  description: '',
  x: 0,
  y: 0,
  params: { sql, tableBindings: [{ inputSlot: 'increment', tableName: 'increment' }] },
  inputs: { increment: { from: 'extract_increment', slot: 'dataframe', guards: [] } },
  dependsOn: [],
});

const INCREMENT_COLUMNS = ['创建编号', '变更日期', '数量'];

test('an empty result keeps the source columns when the query is select *', async () => {
  // Regression: the Monthly run left an optional input unbound, `sheet.optional-range.extract`
  // returned a 0-row frame with its declared column contract, and the projection below dropped that
  // contract — the downstream schema guard then blocked with
  // "Cancel & Restore 增量缺少创建编号或变更日期字段: missing=[创建编号, 变更日期, 数量]".
  const sql = `
select * from {increment}
where trim(cast(coalesce([创建编号], '') as string)) <> ''
order by [变更日期], [创建编号]`;

  const { dataFrame } = await executeSqlDataFrameQuery(projectTask(sql), runtime, async () => frame(INCREMENT_COLUMNS));

  assert.deepEqual(dataFrame.rows, []);
  assert.deepEqual(dataFrame.columns, INCREMENT_COLUMNS);
});

test('a non-empty result still derives its columns from the selected rows', async () => {
  const { dataFrame } = await executeSqlDataFrameQuery(
    projectTask('select [创建编号] as [创建编号], [数量] as [数量] from {increment}'),
    runtime,
    async () => frame(INCREMENT_COLUMNS, [{ 创建编号: 'A1', 变更日期: '2026-01-05', 数量: -10 }]),
  );

  assert.equal(dataFrame.rows.length, 1);
  assert.equal(dataFrame.rows[0]['创建编号'], 'A1');
  assert.ok(dataFrame.columns.includes('创建编号'));
  assert.ok(dataFrame.columns.includes('数量'));
});

test('an aggregate over an empty input still returns its own single row', async () => {
  const { dataFrame } = await executeSqlDataFrameQuery(
    projectTask('select count(*) as [rows] from {increment}'),
    runtime,
    async () => frame(INCREMENT_COLUMNS),
  );

  assert.equal(dataFrame.rows.length, 1);
  assert.equal(dataFrame.columns.includes('rows'), true);
});

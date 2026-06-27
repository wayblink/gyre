import alasql from 'alasql';
import type { WorkflowDataFrame, WorkflowTask } from '../../../shared/types.js';
import type { WorkflowOperatorRuntime } from './types.js';
import { normalizeSqlTableBindings, toSqlIdentifier } from './types.js';

export async function executeSqlDataFrameQuery(
  task: WorkflowTask,
  runtime: WorkflowOperatorRuntime,
  resolveInputDataFrame: (inputSlot: string) => Promise<WorkflowDataFrame>,
) {
  const sql = String(task.params.sql ?? '').trim();
  if (!sql) throw new Error(`Task ${task.name} requires SQL`);

  const bindings = normalizeSqlTableBindings(task.params.tableBindings);
  if (!bindings.length) throw new Error(`Task ${task.name} requires at least one table binding`);

  let compiledSql = sql;
  const tableNames = new Set<string>();
  let firstInputDataFrame: WorkflowDataFrame | null = null;

  for (const binding of bindings) {
    const inputRef = task.inputs[binding.inputSlot];
    if (!inputRef) {
      throw new Error(`Task ${task.name} is missing input mapping for slot ${binding.inputSlot}`);
    }
    const dataframe = await resolveInputDataFrame(binding.inputSlot);
    firstInputDataFrame ??= dataframe;
    const safeTableName = toSqlIdentifier(binding.tableName);
    tableNames.add(safeTableName);
    alasql.tables[safeTableName] = { data: dataframe.rows };
    compiledSql = compiledSql.replaceAll(`{${binding.tableName}}`, safeTableName);
  }

  let result: unknown;
  try {
    result = alasql(compiledSql);
  } catch (error) {
    throw new Error(`SQL execution failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    for (const tableName of tableNames) {
      delete alasql.tables[tableName];
    }
  }

  if (!Array.isArray(result)) {
    throw new Error('SQL must return a row set');
  }

  return {
    dataFrame: runtime.rowsToDataFrame(result as Array<Record<string, unknown>>, {
      sheetName: task.name || 'SQL Result',
      a1Range: '',
    }),
    firstInputDataFrame,
  };
}

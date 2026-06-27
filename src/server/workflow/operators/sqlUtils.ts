import alasql from 'alasql';
import type { WorkflowDataFrame, WorkflowTask } from '../../../shared/types.js';
import type { WorkflowOperatorRuntime } from './types.js';
import { normalizeSqlTableBindings, toSqlIdentifier } from './types.js';

type AlaSqlDatabase = {
  tables: Record<string, { data?: Array<Record<string, unknown>> }>;
  exec: (sql: string) => unknown;
};

const BLOCKED_SQL_PATTERN =
  /\b(attach|alter|create|delete|detach|drop|insert|into|merge|replace|truncate|update|upsert|use)\b/i;

function createIsolatedSqlDatabase(): AlaSqlDatabase {
  return new alasql.Database() as AlaSqlDatabase;
}

function assertSafeReadOnlySql(sql: string) {
  const withoutLineComments = sql.replace(/--.*$/gm, '');
  const withoutBlockComments = withoutLineComments.replace(/\/\*[\s\S]*?\*\//g, '');
  const normalized = withoutBlockComments
    .replace(/'([^']|'')*'/g, "''")
    .replace(/"([^"]|"")*"/g, '""')
    .trim();
  if (!normalized) {
    throw new Error('SQL cannot be empty');
  }
  if (normalized.includes(';')) {
    throw new Error('Only one SQL statement is allowed');
  }
  if (!/^(select|with)\b/i.test(normalized)) {
    throw new Error('Only SELECT/WITH queries are allowed');
  }
  if (BLOCKED_SQL_PATTERN.test(normalized)) {
    throw new Error('SQL contains a blocked keyword; only read-only row-set queries are allowed');
  }
}

function bindDataFrameTable(database: AlaSqlDatabase, tableName: string, dataframe: WorkflowDataFrame) {
  database.exec(`CREATE TABLE ${tableName}`);
  database.tables[tableName].data = dataframe.rows;
}

export async function executeSqlDataFrameQuery(
  task: WorkflowTask,
  runtime: WorkflowOperatorRuntime,
  resolveInputDataFrame: (inputSlot: string) => Promise<WorkflowDataFrame>,
) {
  const sql = String(task.params.sql ?? '').trim();
  if (!sql) throw new Error(`Task ${task.name} requires SQL`);
  assertSafeReadOnlySql(sql);

  const bindings = normalizeSqlTableBindings(task.params.tableBindings);
  if (!bindings.length) throw new Error(`Task ${task.name} requires at least one table binding`);

  let compiledSql = sql;
  const tableNames = new Set<string>();
  let firstInputDataFrame: WorkflowDataFrame | null = null;
  const database = createIsolatedSqlDatabase();

  for (const binding of bindings) {
    const inputRef = task.inputs[binding.inputSlot];
    if (!inputRef) {
      throw new Error(`Task ${task.name} is missing input mapping for slot ${binding.inputSlot}`);
    }
    const dataframe = await resolveInputDataFrame(binding.inputSlot);
    firstInputDataFrame ??= dataframe;
    const safeTableName = toSqlIdentifier(binding.tableName);
    if (tableNames.has(safeTableName)) {
      throw new Error(`Duplicate SQL table binding: ${binding.tableName}`);
    }
    tableNames.add(safeTableName);
    bindDataFrameTable(database, safeTableName, dataframe);
    compiledSql = compiledSql.replaceAll(`{${binding.tableName}}`, safeTableName);
  }
  const unresolvedPlaceholder = compiledSql.match(/\{[^{}]+\}/);
  if (unresolvedPlaceholder) {
    throw new Error(`SQL table placeholder is not bound: ${unresolvedPlaceholder[0]}`);
  }
  assertSafeReadOnlySql(compiledSql);

  let result: unknown;
  try {
    result = database.exec(compiledSql);
  } catch (error) {
    throw new Error(`SQL execution failed: ${error instanceof Error ? error.message : String(error)}`);
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

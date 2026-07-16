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
  alasql.fn.wf_month_key = workflowMonthKey;
  alasql.fn.wf_eom_label = workflowEomLabel;
  return new alasql.Database() as AlaSqlDatabase;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function dateToMonthKey(date: Date): string | null {
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}`;
}

function dateToEomLabel(date: Date): string | null {
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getUTCFullYear()}/${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
}

function dateFromExcelSerial(serial: number): Date | null {
  if (!Number.isFinite(serial) || serial < 1) return null;
  return new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86_400_000);
}

function dateFromWorkflowValue(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') return dateFromExcelSerial(value);
  const text = String(value ?? '').trim();
  if (!text) return null;
  const numeric = Number(text);
  if (Number.isFinite(numeric) && numeric > 10_000) return dateFromExcelSerial(numeric);
  const normalized = text.replace(/\//g, '-');
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function workflowMonthKey(value: unknown): string | null {
  const date = dateFromWorkflowValue(value);
  return date ? dateToMonthKey(date) : null;
}

export function workflowEomLabel(value: unknown): string | null {
  const month = String(value ?? '').trim();
  const match = month.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  const eom = new Date(Date.UTC(year, monthNumber, 0));
  return dateToEomLabel(eom);
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
  database.tables[tableName].data = dataframe.rows.map((row, index) => ({
    ...row,
    __workflow_row_number: index + 1,
    __workflow_source_row: dataframe.index?.[index] ?? index + 1,
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toSqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('SQL constant number must be finite');
    return String(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return `'${value.replaceAll("'", "''")}'`;
  throw new Error('SQL constants must be string, number, boolean, or null');
}

function replaceSqlConstants(sql: string, constants: unknown): string {
  const normalizedConstants = isRecord(constants) ? constants : {};
  return sql.replace(/\{constants\.([A-Za-z_][A-Za-z0-9_]*)\}/g, (placeholder, constantName: string) => {
    if (!Object.prototype.hasOwnProperty.call(normalizedConstants, constantName)) {
      throw new Error(`SQL constant placeholder is not configured: ${placeholder}`);
    }
    return toSqlLiteral(normalizedConstants[constantName]);
  });
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

  let compiledSql = replaceSqlConstants(sql, task.params.constants);
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

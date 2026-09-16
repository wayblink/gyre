import assert from 'node:assert/strict';
import test from 'node:test';
import { schemaSql } from './schema.js';

// Regression guard: commit 76b19eb ("月度常量打散到每实例") taught instanceStore.ts to read and
// write 6 fixed-value columns on monthly_run_instances, but only added `series_b_preferred_stock`
// to schema.ts. The other 3 stayed undeclared, so any pre-existing database (the cloud service's
// included) never got them: `create table if not exists` is a no-op on an existing table, and
// creating a monthly plan then died with
//   column "warrants_convertible_preferred" of relation "monthly_run_instances" does not exist
// instanceStore.test.ts fakes the DB with a plain JS object, so a missing column cannot surface
// there — this test parses the real DDL instead.

const MONTHLY_FIXED_VALUE_COLUMNS = [
  'options_outstanding_cullgen',
  'options_available_cullgen',
  'warrants_convertible_preferred',
  'series_b_preferred_stock',
  'cullgen_common_stock',
  'gyre_2023_china_subplan_total',
] as const;

/** Column names declared for `table` by its `create table if not exists (...) (...)` block. */
function declaredColumns(createTableStatement: string): Set<string> {
  const columns = new Set<string>();
  for (const rawLine of createTableStatement.split('\n')) {
    const line = rawLine.trim();
    // Skip the constraint/trailing lines and anything indented under them.
    if (!line || line.startsWith('(') || line.startsWith(')')) continue;
    const name = line.split(/\s+/)[0];
    if (/^[a-z_][a-z0-9_]*$/.test(name)) columns.add(name);
  }
  return columns;
}

function monthlyRunInstancesDdl(): string {
  const start = schemaSql.indexOf('create table if not exists monthly_run_instances');
  assert.notEqual(start, -1, 'monthly_run_instances create statement is missing from schemaSql');
  const end = schemaSql.indexOf('\n);', start);
  assert.notEqual(end, -1, 'monthly_run_instances create statement is unterminated');
  return schemaSql.slice(start, end);
}

test('monthly_run_instances DDL declares every fixed-value column instanceStore reads and writes', () => {
  const declared = declaredColumns(monthlyRunInstancesDdl());
  const missing = MONTHLY_FIXED_VALUE_COLUMNS.filter((column) => !declared.has(column));
  assert.deepEqual(
    missing,
    [],
    `monthly_run_instances DDL is missing fixed-value columns: ${missing.join(', ')}`,
  );
});

// `create table if not exists` cannot backfill a database whose table already exists, so every
// fixed-value column also needs a standalone `add column if not exists` statement.
test('monthly_run_instances DDL backfills every fixed-value column on existing databases', () => {
  const addColumnStatements = schemaSql
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) =>
      /^alter table monthly_run_instances add column if not exists [a-z][a-z0-9_]*/.test(statement),
    );
  const backfilled = new Set(
    addColumnStatements
      .map((statement) => statement.match(/add column if not exists ([a-z][a-z0-9_]*)/)?.[1])
      .filter((column): column is string => Boolean(column)),
  );
  const missing = MONTHLY_FIXED_VALUE_COLUMNS.filter((column) => !backfilled.has(column));
  assert.deepEqual(
    missing,
    [],
    `monthly_run_instances has no "add column if not exists" backfill for: ${missing.join(', ')}`,
  );
});

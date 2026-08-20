import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeWorkflowSqlText } from './workflowPage.js';

test('normalizeWorkflowSqlText formats select lists and clauses for readability', () => {
  const formatted = normalizeWorkflowSqlText('select plan_name, coalesce(outstanding_calc, options_outstanding, 0) as value from {source} where category_for_grouping is not null and plan_name <> \'Plan Name: N/A\' order by sorting, plan_name');

  assert.equal(formatted, [
    'SELECT',
    '  plan_name,',
    '  coalesce ( outstanding_calc, options_outstanding, 0 ) AS value',
    'FROM {source}',
    'WHERE',
    '  category_for_grouping IS NOT NULL',
    "  AND plan_name <> 'Plan Name: N/A'",
    'ORDER BY',
    '  sorting,',
    '  plan_name',
  ].join('\n'));
});

test('normalizeWorkflowSqlText does not split function arguments as select columns', () => {
  const formatted = normalizeWorkflowSqlText('select concat(last_name, \', \', first_name) as key, count(*) as total from people group by concat(last_name, \', \', first_name)');

  assert.match(formatted, /concat \( last_name, ', ', first_name \) AS key,/);
  assert.match(formatted, /GROUP BY\n  concat \( last_name, ', ', first_name \)/);
});

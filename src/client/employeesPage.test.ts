import assert from 'node:assert/strict';
import test from 'node:test';

import { buildEmployeesApiUrl } from './employeesPage.js';

test('employees api url includes source filter and pagination parameters', () => {
  assert.equal(
    buildEmployeesApiUrl({
      query: 'Subplan BC',
      tag: '',
      source: 'shareworks',
      page: 1,
      pageSize: 20,
      sort: { by: '', dir: 'asc' },
    }),
    '/api/employees?query=Subplan+BC&tag=&source=shareworks&page=1&pageSize=20',
  );
});

test('employees api url appends sort only when a sort key is selected', () => {
  assert.equal(
    buildEmployeesApiUrl({
      query: '',
      tag: 'review',
      source: '',
      page: 2,
      pageSize: 50,
      sort: { by: 'name', dir: 'desc' },
    }),
    '/api/employees?query=&tag=review&source=&page=2&pageSize=50&sort=name&dir=desc',
  );
});

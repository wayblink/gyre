import type { EmployeeSource } from '../shared/types.js';

export type EmployeeSourceFilter = '' | EmployeeSource;

export type EmployeesPageQuery = {
  query: string;
  tag: string;
  source: EmployeeSourceFilter;
  page: number;
  pageSize: number;
  sort: { by: 'name' | 'empNo' | ''; dir: 'asc' | 'desc' };
};

export function buildEmployeesApiUrl(params: EmployeesPageQuery): string {
  const search = new URLSearchParams({
    query: params.query,
    tag: params.tag,
    source: params.source,
    page: String(params.page),
    pageSize: String(params.pageSize),
  });
  if (params.sort.by) {
    search.set('sort', params.sort.by);
    search.set('dir', params.sort.dir);
  }
  return `/api/employees?${search.toString()}`;
}

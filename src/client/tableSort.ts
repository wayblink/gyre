/** Sorting and pagination text shared by every paged table page. */
import type { AppLanguage } from './i18n.js';
import { createTexts, createTextFormatter } from './texts.js';

const t = createTexts('main');
const tp = createTextFormatter('main');

/** `NameEmpNoSort` is the shape of the `by`/`dir` pair every table header uses. */
export type NameEmpNoSort = { by: '' | 'name' | 'empNo'; dir: 'asc' | 'desc' };

/** Flip the sort direction when the same column is clicked again. */
export function nextSort(current: NameEmpNoSort, by: 'name' | 'empNo'): NameEmpNoSort {
  if (current.by === by) {
    return { by, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  }
  return { by, dir: 'asc' };
}

export function paginationSummaryText(
  start: number,
  end: number,
  total: number,
  unit: 'records' | 'employees',
  language: AppLanguage,
) {
  const empty = t(unit === 'employees' ? 'paginationSummaryEmployeesEmpty' : 'paginationSummaryRecordsEmpty', language);
  if (total === 0) return empty;
  return tp(
    unit === 'employees' ? 'paginationSummaryEmployees' : 'paginationSummaryRecords',
    { start, end, total },
    language,
  );
}

// Shared Name / Employee No. header sorting for the ESOP detail tables.
export function sortQuery(sort: NameEmpNoSort): string {
  return sort.by ? `&sort=${sort.by}&dir=${sort.dir}` : '';
}

export function renderSortIndicators(scopeSelector: string, sort: NameEmpNoSort) {
  document.querySelectorAll<HTMLElement>(`${scopeSelector} [data-sort-key]`).forEach((node) => {
    const key = node.dataset.sortKey;
    node.dataset.dir = sort.by && sort.by === key ? sort.dir : 'none';
  });
}

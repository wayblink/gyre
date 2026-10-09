/**
 * Shared pagination rendering for the list pages (holdings / exercises / sold shares / employees).
 *
 * Every page used to carry its own copy of "compute the visible range, write the summary, enable or
 * disable the four nav buttons" — four near-identical functions plus four copies of the same
 * page-size/first/last handlers. The maths lives here so it can be unit tested once.
 */

export type PaginationIds = {
  summary: string;
  page: string;
  first: string;
  prev: string;
  next: string;
  last: string;
};

export type PaginationView = {
  start: number;
  end: number;
  /** e.g. `3 / 12`, or `0 / 1` when there is nothing to page through. */
  pageLabel: string;
  canPrev: boolean;
  canNext: boolean;
};

/**
 * @param totalPages pages reported by the API; the client never recomputes it, so a server-side
 * page-size change cannot leave the controls disabled on the last page.
 */
export function paginationView(params: {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}): PaginationView {
  const { page, pageSize, total, totalPages } = params;
  const lastPage = Math.max(totalPages, 1);
  return {
    start: total === 0 ? 0 : (page - 1) * pageSize + 1,
    end: Math.min(page * pageSize, total),
    pageLabel: `${total === 0 ? 0 : page} / ${lastPage}`,
    canPrev: page > 1,
    canNext: total !== 0 && page < totalPages,
  };
}

export function renderPaginationControls(
  el: <T extends HTMLElement>(id: string) => T,
  ids: PaginationIds,
  view: PaginationView,
  summaryText: string,
): void {
  el(ids.summary).textContent = summaryText;
  el(ids.page).textContent = view.pageLabel;
  el<HTMLButtonElement>(ids.first).disabled = !view.canPrev;
  el<HTMLButtonElement>(ids.prev).disabled = !view.canPrev;
  el<HTMLButtonElement>(ids.next).disabled = !view.canNext;
  el<HTMLButtonElement>(ids.last).disabled = !view.canNext;
}

/**
 * Next page for a relative move (prev/next), or null when the move would be a no-op. Callers keep
 * their own state, so they can skip the reload when nothing changes.
 */
export function nextPageWithinBounds(total: number, pageSize: number, currentPage: number, delta: number): number | null {
  const maxPage = Math.max(1, Math.ceil(total / pageSize));
  const next = Math.min(Math.max(1, currentPage + delta), maxPage);
  return next === currentPage ? null : next;
}

/** First/last page, or null when already there. */
export function edgePage(total: number, pageSize: number, currentPage: number, target: 'first' | 'last'): number | null {
  const maxPage = Math.max(1, Math.ceil(total / pageSize));
  const next = target === 'first' ? 1 : maxPage;
  return next === currentPage ? null : next;
}

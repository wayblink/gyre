/**
 * The find bar above the workbook viewer.
 *
 * The browser's own Ctrl+F cannot see a canvas-drawn sheet, and Univer's built-in find dialog only
 * stays open while the grid itself holds keyboard focus — opened right after picking a file from the
 * list it flashes and closes. So the page owns the bar and drives the viewer's data-level search
 * instead: it knows how many cells matched, which one is current, and moves to the next/previous one
 * (wrapping) while the sheet scrolls the active cell into view.
 */

export type WorkbookSearchResult = { total: number; index: number };

export type WorkbookFindBarElements = {
  bar: HTMLElement;
  input: HTMLInputElement;
  count: HTMLElement;
  previous: HTMLButtonElement;
  next: HTMLButtonElement;
  close: HTMLButtonElement;
};

export type WorkbookFindBarLabels = {
  placeholder: string;
  previous: string;
  next: string;
  close: string;
  noResults: string;
};

export type WorkbookFindBarOptions = {
  elements: WorkbookFindBarElements;
  /** Resolved on every open, so a language switch is picked up without rebuilding the bar. */
  labels: WorkbookFindBarLabels | (() => WorkbookFindBarLabels);
  /** Runs the search and reports the match count; `index` is 1-based, 0 when nothing matched. */
  search: (query: string) => Promise<WorkbookSearchResult>;
  /** Moves the cursor; the viewer wraps around at both ends. */
  step: (direction: 1 | -1) => WorkbookSearchResult;
  /** Called when the bar closes, so the viewer can drop its matches. */
  clear: () => void;
  /** Typing is debounced so a keystroke does not start a workbook-wide scan of its own. */
  debounceMs?: number;
};

export function createWorkbookFindBar({
  elements,
  labels,
  search,
  step,
  clear,
  debounceMs = 250,
}: WorkbookFindBarOptions) {
  const { bar, input, count, previous, next, close } = elements;
  let timer: number | null = null;
  /** Search generation, so a slow earlier query cannot overwrite a newer one's count. */
  let generation = 0;
  let lastQuery = '';
  let isOpen = false;

  const currentLabels = (): WorkbookFindBarLabels => (typeof labels === 'function' ? labels() : labels);

  function applyLabels() {
    const resolved = currentLabels();
    input.placeholder = resolved.placeholder;
    previous.textContent = '↑';
    next.textContent = '↓';
    close.textContent = '×';
    previous.title = resolved.previous;
    previous.setAttribute('aria-label', resolved.previous);
    next.title = resolved.next;
    next.setAttribute('aria-label', resolved.next);
    close.title = resolved.close;
    close.setAttribute('aria-label', resolved.close);
  }

  applyLabels();

  function renderCount(result: WorkbookSearchResult | null) {
    if (!result || (!lastQuery && result.total === 0)) {
      count.textContent = '';
      return;
    }
    count.textContent = result.total === 0 ? currentLabels().noResults : `${result.index}/${result.total}`;
    count.classList.toggle('files-find-bar__count--empty', result.total === 0);
  }

  async function runSearch(query: string) {
    const current = ++generation;
    lastQuery = query;
    if (!query.trim()) {
      clear();
      renderCount(null);
      return;
    }
    const result = await search(query);
    // A newer keystroke already started its own search: this answer is stale.
    if (current !== generation) return;
    renderCount(result);
  }

  function scheduleSearch() {
    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = null;
      void runSearch(input.value);
    }, debounceMs);
  }

  function move(direction: 1 | -1) {
    if (!input.value.trim()) return;
    renderCount(step(direction));
  }

  function open() {
    isOpen = true;
    applyLabels();
    bar.classList.remove('hidden');
    // Focus only: a second Ctrl+F while the bar is open is a "get me back to the box", not a new
    // search that would jump back to the first match.
    input.focus();
    input.select();
  }

  function closeBar({ restoreMatches = true } = {}) {
    isOpen = false;
    bar.classList.add('hidden');
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
    generation += 1;
    count.textContent = '';
    if (restoreMatches) {
      clear();
      input.value = '';
      lastQuery = '';
    }
  }

  input.addEventListener('input', scheduleSearch);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (event.shiftKey) move(-1);
      else move(1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeBar();
    }
  });
  previous.addEventListener('click', (event) => {
    event.preventDefault();
    move(-1);
  });
  next.addEventListener('click', (event) => {
    event.preventDefault();
    move(1);
  });
  close.addEventListener('click', (event) => {
    event.preventDefault();
    closeBar();
  });

  return {
    open,
    close: closeBar,
    isOpen: () => isOpen,
    /** The input keeps keyboard focus after a move, so "next, next, next" stays a keystroke away. */
    focusInput: () => input.focus(),
  };
}

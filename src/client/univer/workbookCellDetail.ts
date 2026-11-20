/**
 * Read-only cell detail card for the workbook viewer.
 *
 * The grid paints a number with the cell's number format, so a stored `-29590.2182` reads as
 * `-29,590`. Univer reveals the exact value through the cell editor, and the read-only preview
 * refuses to open one — it answers with the "range is protected" dialog instead. Double-clicking a
 * cell is therefore intercepted before Univer sees the event, and this card takes over: exact value,
 * formula and number format, with one click to copy the value.
 *
 * The pure helpers are exported so the formatting and placement rules can be tested without a
 * browser (`workbookCellDetail.test.ts`).
 */
import type { AppLanguage } from '../i18n.js';
import { createTexts, type TextKey } from '../texts.js';

const t = createTexts('files');

export type CellDetailSource = {
  sheetName: string;
  address: string;
  rawValue: unknown;
  formula?: string | null;
  numberPattern?: string | null;
};

export type CellDetail = {
  /** `B148`, the same shape the formula bar's name box uses. */
  address: string;
  sheetName: string;
  /** Full precision, exactly what the file stores — never the rounded grid text. */
  rawValueText: string;
  formulaText: string;
  numberPattern: string;
  isEmpty: boolean;
};

/** `String(number)` keeps every stored digit; the number format only affects painting. */
export function formatCellRawValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return String(value);
}

/**
 * Excel writes the same thousands separator group over and over (`#,###,###,…,##0`), which reads as
 * noise in a 272px card; collapsing the repeats keeps the meaning and the card readable.
 */
export function shortenNumberPattern(pattern: string): string {
  return pattern.trim().replace(/(,###)+/g, ',###');
}

export function buildCellDetail(source: CellDetailSource): CellDetail {
  const rawValueText = formatCellRawValue(source.rawValue);
  const formulaText = (source.formula ?? '').trim();
  return {
    address: source.address,
    sheetName: source.sheetName,
    rawValueText,
    formulaText,
    numberPattern: shortenNumberPattern(source.numberPattern ?? ''),
    isEmpty: rawValueText === '' && formulaText === '',
  };
}

export type CellDetailPlacement = {
  hostWidth: number;
  hostHeight: number;
  cardWidth: number;
  cardHeight: number;
  /** Pointer position, relative to the viewer host. */
  x: number;
  y: number;
  margin?: number;
  gap?: number;
};

/**
 * Put the card below-right of the pointer when it fits, flip it above/left otherwise, and clamp it
 * inside the viewer: the sheet is wider than the window, so a card for a cell near the right edge
 * would otherwise open out of sight.
 */
export function placeCellDetail({
  hostWidth,
  hostHeight,
  cardWidth,
  cardHeight,
  x,
  y,
  margin = 8,
  gap = 6,
}: CellDetailPlacement): { left: number; top: number } {
  let left = x + gap;
  let top = y + gap;
  if (left + cardWidth > hostWidth - margin) left = x - gap - cardWidth;
  if (top + cardHeight > hostHeight - margin) top = y - gap - cardHeight;
  const maxLeft = hostWidth - cardWidth - margin;
  const maxTop = hostHeight - cardHeight - margin;
  return {
    left: Math.max(margin, Math.min(left, maxLeft)),
    top: Math.max(margin, Math.min(top, maxTop)),
  };
}

export type WorkbookCellDetailOptions = {
  /** The Univer mount; the card is absolutely positioned inside it. */
  container: HTMLElement;
  language: AppLanguage;
  /** Reads the selected cell from the viewer. Returns null when there is no cell to describe. */
  readActiveCell: () => CellDetailSource | null;
  /** Injectable so the card can be exercised without the async clipboard API. */
  copyText?: (text: string) => Promise<boolean>;
};

export type WorkbookCellDetail = {
  close: () => void;
  dispose: () => void;
};

export function createWorkbookCellDetail({
  container,
  language,
  readActiveCell,
  copyText = copyTextToClipboard,
}: WorkbookCellDetailOptions): WorkbookCellDetail {
  const label = (key: TextKey<'files'>) => t(key, language);

  const card = document.createElement('div');
  card.className = 'workbook-cell-detail hidden';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'false');

  const header = document.createElement('div');
  header.className = 'workbook-cell-detail__header';
  const title = document.createElement('div');
  title.className = 'workbook-cell-detail__title';
  const address = document.createElement('span');
  address.className = 'workbook-cell-detail__address';
  const sheet = document.createElement('span');
  sheet.className = 'workbook-cell-detail__sheet';
  title.append(address, sheet);
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'workbook-cell-detail__close';
  closeButton.textContent = '×';
  closeButton.title = label('cellDetailClose');
  closeButton.setAttribute('aria-label', label('cellDetailClose'));
  header.append(title, closeButton);

  const list = document.createElement('dl');
  list.className = 'workbook-cell-detail__list';

  const footer = document.createElement('div');
  footer.className = 'workbook-cell-detail__footer';
  const status = document.createElement('span');
  status.className = 'workbook-cell-detail__status';
  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.className = 'workbook-cell-detail__copy';
  copyButton.textContent = label('cellDetailCopy');
  footer.append(status, copyButton);

  card.append(header, list, footer);

  let current: CellDetail | null = null;
  let resetTimer: number | null = null;

  function renderRows(detail: CellDetail) {
    list.replaceChildren();
    list.append(
      detailRow(label('cellDetailValue'), detail.isEmpty ? label('cellDetailEmpty') : detail.rawValueText, 'value'),
    );
    if (detail.formulaText) {
      list.append(detailRow(label('cellDetailFormula'), detail.formulaText, 'formula'));
    }
    if (detail.numberPattern) {
      list.append(detailRow(label('cellDetailNumberFormat'), detail.numberPattern, 'format'));
    }
  }

  function detailRow(labelText: string, valueText: string, kind: 'value' | 'formula' | 'format'): HTMLElement {
    const row = document.createElement('div');
    row.className = 'workbook-cell-detail__row';
    const term = document.createElement('dt');
    term.textContent = labelText;
    const value = document.createElement('dd');
    value.className = `workbook-cell-detail__value workbook-cell-detail__value--${kind}`;
    value.textContent = valueText;
    row.append(term, value);
    return row;
  }

  function close() {
    if (card.classList.contains('hidden')) return;
    card.classList.add('hidden');
    current = null;
    status.textContent = '';
    if (resetTimer !== null) {
      window.clearTimeout(resetTimer);
      resetTimer = null;
    }
    copyButton.textContent = label('cellDetailCopy');
  }

  function show(detail: CellDetail, clientX: number, clientY: number) {
    current = detail;
    address.textContent = detail.address;
    address.title = detail.sheetName ? `${detail.sheetName}!${detail.address}` : detail.address;
    sheet.textContent = detail.sheetName;
    sheet.title = detail.sheetName;
    renderRows(detail);
    status.textContent = '';
    copyButton.disabled = detail.isEmpty;
    copyButton.textContent = label('cellDetailCopy');
    card.classList.remove('hidden');

    const hostRect = container.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const position = placeCellDetail({
      hostWidth: hostRect.width,
      hostHeight: hostRect.height,
      cardWidth: cardRect.width,
      cardHeight: cardRect.height,
      x: clientX - hostRect.left,
      y: clientY - hostRect.top,
    });
    card.style.left = `${hostRect.left + position.left}px`;
    card.style.top = `${hostRect.top + position.top}px`;
  }

  async function handleCopy() {
    if (!current || current.isEmpty) return;
    const copied = await copyText(current.rawValueText);
    copyButton.textContent = copied ? label('cellDetailCopied') : label('cellDetailCopy');
    status.textContent = copied ? '' : label('cellDetailCopyFailed');
    if (resetTimer !== null) window.clearTimeout(resetTimer);
    resetTimer = window.setTimeout(() => {
      copyButton.textContent = label('cellDetailCopy');
      status.textContent = '';
      resetTimer = null;
    }, 1600);
  }

  /**
   * Univer does not open the editor from the DOM `dblclick` event: its input manager counts two
   * pointer-ups within 500ms at the same spot (`InputManager._prePointerDoubleOrTripleClick`) and
   * turns that into a cell-edit request. In read-only mode the workbook answers with the "range is
   * protected" dialog, so the second pointer-up is swallowed before the canvas sees it.
   */
  const DOUBLE_CLICK_DELAY = 500;
  const DOUBLE_CLICK_TOLERANCE = 2;
  let lastPointerUp: { time: number; x: number; y: number } | null = null;

  function isSheetCanvas(event: Event): boolean {
    const target = event.target instanceof Element ? event.target : null;
    return Boolean(target?.closest('canvas[data-u-comp="render-canvas"]'));
  }

  function onPointerUp(event: PointerEvent) {
    if (event.button !== 0 || !isSheetCanvas(event)) {
      lastPointerUp = null;
      return;
    }
    const now = event.timeStamp || Date.now();
    const previous = lastPointerUp;
    lastPointerUp = { time: now, x: event.clientX, y: event.clientY };
    if (!previous) return;
    if (now - previous.time > DOUBLE_CLICK_DELAY) return;
    if (Math.abs(event.clientX - previous.x) > DOUBLE_CLICK_TOLERANCE) return;
    if (Math.abs(event.clientY - previous.y) > DOUBLE_CLICK_TOLERANCE) return;
    const source = readActiveCell();
    if (!source) return;
    event.preventDefault();
    event.stopPropagation();
    lastPointerUp = null;
    show(buildCellDetail(source), event.clientX, event.clientY);
  }

  /** Belt and braces: the browser still fires `dblclick`, and Univer's canvas listens for it. */
  function onDoubleClick(event: MouseEvent) {
    if (!isSheetCanvas(event)) return;
    event.preventDefault();
    event.stopPropagation();
  }

  function onDocumentPointerDown(event: Event) {
    if (card.classList.contains('hidden')) return;
    const target = event.target instanceof Node ? event.target : null;
    if (target && card.contains(target)) return;
    close();
  }

  function onDocumentKeyDown(event: KeyboardEvent) {
    if (card.classList.contains('hidden') || event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    close();
  }

  function onScroll() {
    close();
  }

  container.addEventListener('pointerup', onPointerUp, true);
  container.addEventListener('dblclick', onDoubleClick, true);
  document.addEventListener('pointerdown', onDocumentPointerDown, true);
  document.addEventListener('keydown', onDocumentKeyDown, true);
  document.addEventListener('scroll', onScroll, true);
  window.addEventListener('resize', onScroll);
  // Univer scrolls the sheet by transforming the canvas, which fires no DOM scroll event.
  container.addEventListener('wheel', onScroll, { capture: true, passive: true });
  closeButton.addEventListener('click', close);
  copyButton.addEventListener('click', () => void handleCopy());
  // Fixed positioning inside <body>: Univer owns the mount's children (React re-renders the tree),
  // so a card appended to the mount would be removed by the viewer's first render.
  document.body.append(card);

  return {
    close,
    dispose() {
      container.removeEventListener('pointerup', onPointerUp, true);
      container.removeEventListener('dblclick', onDoubleClick, true);
      document.removeEventListener('pointerdown', onDocumentPointerDown, true);
      document.removeEventListener('keydown', onDocumentKeyDown, true);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
      container.removeEventListener('wheel', onScroll, { capture: true });
      if (resetTimer !== null) window.clearTimeout(resetTimer);
      card.remove();
    },
  };
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Falls through to the selection-based copy below (older browsers, denied permission).
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(area);
    return copied;
  } catch {
    return false;
  }
}

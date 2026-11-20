/**
 * Decide whether a keypress should open the workbook's find dialog.
 *
 * The browser's own Ctrl+F only searches the rendered DOM, and the sheet viewer draws its cells on
 * a canvas, so letting it through means "no results" for anything in the workbook. Univer registers
 * its own Ctrl+F as well, but that one only fires while the sheet has keyboard focus — pressing it
 * right after opening a file from the list would otherwise bring up the useless browser find.
 *
 * The exception is a text field that belongs to the page (the file-name search box): Ctrl+F there is
 * an ordinary "find in this list" reflex, so the shortcut steps aside instead of hijacking it. The
 * find dialog's own input lives inside the workbook container, where Ctrl+F should keep working.
 */

type ShortcutEvent = {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  defaultPrevented?: boolean;
};

export type WorkbookFindShortcutContext = {
  /** A workbook viewer is mounted and visible. */
  hasWorkbook: boolean;
  /** The Files Center page is the active page. */
  pageActive: boolean;
  /** Focus sits in a page text field outside the workbook (e.g. the file name search box). */
  focusInPageTextField: boolean;
};

export function shouldOpenWorkbookFind(event: ShortcutEvent, context: WorkbookFindShortcutContext): boolean {
  if (event.defaultPrevented || event.altKey || event.shiftKey) return false;
  if (!(event.ctrlKey || event.metaKey)) return false;
  if (event.key.toLowerCase() !== 'f') return false;
  if (!context.hasWorkbook || !context.pageActive) return false;
  return !context.focusInPageTextField;
}

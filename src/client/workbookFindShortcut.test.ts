import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldOpenWorkbookFind } from './workbookFindShortcut.js';

/**
 * Ctrl+F inside the Files Center must reach the workbook, not the browser: the sheet viewer draws on
 * a canvas, so the browser's own find reports nothing. The shortcut only steps aside for a page text
 * field (the file-name search box), where Ctrl+F is the operator's "find in this list" reflex.
 */

const openContext = { hasWorkbook: true, pageActive: true, focusInPageTextField: false };

test('Ctrl+F with a workbook on screen opens the sheet find', () => {
  assert.equal(shouldOpenWorkbookFind({ key: 'f', ctrlKey: true }, openContext), true);
  assert.equal(shouldOpenWorkbookFind({ key: 'F', ctrlKey: true }, openContext), true);
});

test('Cmd+F works the same on macOS', () => {
  assert.equal(shouldOpenWorkbookFind({ key: 'f', metaKey: true }, openContext), true);
});

test('the shortcut stays out of the way of other key combinations', () => {
  assert.equal(shouldOpenWorkbookFind({ key: 'f' }, openContext), false, 'plain f is typing');
  assert.equal(shouldOpenWorkbookFind({ key: 'f', ctrlKey: true, altKey: true }, openContext), false);
  assert.equal(shouldOpenWorkbookFind({ key: 'f', ctrlKey: true, shiftKey: true }, openContext), false);
  assert.equal(shouldOpenWorkbookFind({ key: 'g', ctrlKey: true }, openContext), false);
  assert.equal(shouldOpenWorkbookFind({ key: 'f', ctrlKey: true, defaultPrevented: true }, openContext), false);
});

test('nothing to search means no interception', () => {
  assert.equal(shouldOpenWorkbookFind({ key: 'f', ctrlKey: true }, { ...openContext, hasWorkbook: false }), false);
  assert.equal(shouldOpenWorkbookFind({ key: 'f', ctrlKey: true }, { ...openContext, pageActive: false }), false);
});

test('a focused page text field keeps the browser behaviour', () => {
  assert.equal(
    shouldOpenWorkbookFind({ key: 'f', ctrlKey: true }, { ...openContext, focusInPageTextField: true }),
    false,
  );
});

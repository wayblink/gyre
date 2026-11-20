import assert from 'node:assert/strict';
import test from 'node:test';

import { installDom } from '../../test/dom-env.mjs';
import { createWorkbookFindBar, type WorkbookSearchResult } from './workbookFindBar.js';

/**
 * The find bar is the only UI for searching a canvas-drawn sheet, so its wiring is what makes
 * Ctrl+F useful at all: the search itself lives in the viewer (Univer's data-level finder), and this
 * module owns the input, the "n/m" count, stepping and closing.
 */

installDom();

const LABELS = {
  placeholder: '在文件中查找',
  previous: '上一个',
  next: '下一个',
  close: '关闭',
  noResults: '无结果',
};

function buildBar() {
  const document = globalThis.document;
  const make = <K extends keyof HTMLElementTagNameMap>(tag: K, id: string) => {
    const node = document.createElement(tag);
    node.id = id;
    document.body.appendChild(node);
    return node;
  };
  const bar = document.createElement('div');
  bar.id = 'bar';
  document.body.appendChild(bar);
  const input = document.createElement('input');
  input.id = 'input';
  bar.appendChild(input);
  const count = document.createElement('span');
  count.id = 'count';
  bar.appendChild(count);
  const previous = document.createElement('button');
  previous.id = 'previous';
  bar.appendChild(previous);
  const next = document.createElement('button');
  next.id = 'next';
  bar.appendChild(next);
  const close = document.createElement('button');
  close.id = 'close';
  bar.appendChild(close);
  void make;
  return { bar, input, count, previous, next, close };
}

type Harness = ReturnType<typeof buildBar>;

function createHarness(options: {
  results?: Array<WorkbookSearchResult>;
  stepResults?: Array<WorkbookSearchResult>;
  searchDelayMs?: number;
}) {
  const elements = buildBar();
  const searches: string[] = [];
  const steps: number[] = [];
  let clears = 0;
  let stepIndex = 0;
  const results = options.results ?? [{ total: 0, index: 0 }];
  const stepResults = options.stepResults ?? [{ total: 0, index: 0 }];
  const bar = createWorkbookFindBar({
    elements: elements as unknown as Harness,
    labels: LABELS,
    debounceMs: 1,
    search: async (query) => {
      searches.push(query);
      if (options.searchDelayMs) await new Promise((resolve) => setTimeout(resolve, options.searchDelayMs));
      return results[Math.min(searches.length - 1, results.length - 1)];
    },
    step: (direction) => {
      steps.push(direction);
      return stepResults[Math.min(stepIndex++, stepResults.length - 1)];
    },
    clear: () => {
      clears += 1;
    },
  });
  return { bar, elements, searches, steps, clears: () => clears };
}

async function type(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new globalThis.Event('input', { bubbles: true }));
  // The bar debounces typing; one macrotask is enough at debounceMs = 1.
  await new Promise((resolve) => setTimeout(resolve, 15));
}

test('typing searches and renders "current/total"', async () => {
  const harness = createHarness({ results: [{ total: 4, index: 1 }] });
  harness.bar.open();
  assert.equal(harness.elements.input.placeholder, LABELS.placeholder);

  await type(harness.elements.input, 'Omnibus');
  assert.deepEqual(harness.searches, ['Omnibus']);
  assert.equal(harness.elements.count.textContent, '1/4');
});

test('a query with no matches says so instead of showing "0/0"', async () => {
  const harness = createHarness({ results: [{ total: 0, index: 0 }] });
  harness.bar.open();

  await type(harness.elements.input, 'zzzzzz');
  assert.equal(harness.elements.count.textContent, LABELS.noResults);
  assert.equal(harness.elements.count.classList.contains('files-find-bar__count--empty'), true);
});

test('Enter steps forward, Shift+Enter steps back, and the count follows', async () => {
  const harness = createHarness({
    results: [{ total: 3, index: 1 }],
    stepResults: [
      { total: 3, index: 2 },
      { total: 3, index: 1 },
    ],
  });
  harness.bar.open();
  await type(harness.elements.input, 'omni');

  harness.elements.input.dispatchEvent(new globalThis.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.deepEqual(harness.steps, [1]);
  assert.equal(harness.elements.count.textContent, '2/3');

  harness.elements.input.dispatchEvent(
    new globalThis.KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }),
  );
  assert.deepEqual(harness.steps, [1, -1]);
  assert.equal(harness.elements.count.textContent, '1/3');
});

test('Enter does nothing until there is a query', async () => {
  const harness = createHarness({ stepResults: [{ total: 1, index: 1 }] });
  harness.bar.open();
  harness.elements.input.dispatchEvent(new globalThis.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.deepEqual(harness.steps, []);
});

test('Escape closes the bar, clears the viewer matches and empties the input', async () => {
  const harness = createHarness({ results: [{ total: 2, index: 1 }] });
  harness.bar.open();
  await type(harness.elements.input, 'x');
  assert.equal(harness.clears(), 0);

  harness.elements.input.dispatchEvent(new globalThis.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(harness.bar.isOpen(), false);
  assert.equal(harness.elements.bar.classList.contains('hidden'), true);
  assert.equal(harness.clears(), 1);
  assert.equal(harness.elements.input.value, '');
  assert.equal(harness.elements.count.textContent, '');
});

test('a slow answer for an older query cannot overwrite the newer count', async () => {
  const harness = createHarness({
    results: [
      { total: 9, index: 1 },
      { total: 2, index: 1 },
    ],
    searchDelayMs: 30,
  });
  harness.bar.open();

  // First query resolves late; the second one is issued while the first is still in flight.
  harness.elements.input.value = 'first';
  harness.elements.input.dispatchEvent(new globalThis.Event('input', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 15));
  harness.elements.input.value = 'second';
  harness.elements.input.dispatchEvent(new globalThis.Event('input', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 80));

  assert.equal(harness.elements.count.textContent, '1/2');
});

test('the close button closes the bar like Escape does', async () => {
  const harness = createHarness({ results: [{ total: 1, index: 1 }] });
  harness.bar.open();
  await type(harness.elements.input, 'a');
  harness.elements.close.click();
  assert.equal(harness.bar.isOpen(), false);
  assert.equal(harness.clears(), 1);
});

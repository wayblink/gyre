import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { installDom } from '../../test/dom-env.mjs';
import {
  buildDriveSteps,
  isTourSeen,
  markTourSeen,
  planSegments,
  resolveTourSteps,
  waitForElement,
  type TourStep,
} from './tour.js';
import { TOURS, tourById, tourForPage, tourStepsForPage } from './tours.js';

const INDEX_HTML = readFileSync(path.join(process.cwd(), 'index.html'), 'utf8');

/**
 * jsdom implements no layout, so `getClientRects()` is empty for every element and the visibility
 * check would drop all steps. Tests declare elements visible; `display: none` still works through
 * `getComputedStyle`, which is what the "invisible target" test relies on.
 */
function stubLayout(window: Window & typeof globalThis): void {
  // Mimics a browser: a box exists unless the element or an ancestor is display:none.
  window.Element.prototype.getClientRects = function getClientRects(this: Element) {
    // `closest` would stop at the element itself; walk up so an ancestor's display:none counts too.
    const hidden = [this, ...Array.from(documentAncestors(this))].some(
      (node) => (node as HTMLElement).style?.display === 'none',
    );
    if (hidden) return [] as unknown as DOMRectList;
    return [{ width: 8, height: 8 }] as unknown as DOMRectList;
  } as typeof window.Element.prototype.getClientRects;
}

function* documentAncestors(element: Element): Generator<Element> {
  let node = element.parentElement;
  while (node) {
    yield node;
    node = node.parentElement;
  }
}

function step(target: string, extra: Partial<TourStep> = {}): TourStep {
  return { target, title: 'captableMonthTitle', body: 'captableMonthBody', ...extra };
}

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
    key: (index: number) => [...map.keys()][index] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

test('a tour only keeps steps whose target exists, and navigates for steps on another page', async () => {
  const { window } = installDom({ url: 'http://localhost/captable' });
  stubLayout(window);
  window.document.body.innerHTML = '<div id="here"></div>';

  const navigated: string[] = [];
  const steps = await resolveTourSteps(
    [step('#here'), step('#missing'), step('#later', { page: 'monthlyrun' }), step('#still-missing')],
    {
      page: 'captable',
      navigate: async (page) => {
        navigated.push(page);
        // Simulate the target only existing after the page switch.
        const node = document.createElement('div');
        node.id = 'later';
        window.document.body.appendChild(node);
      },
      firstStepTimeoutMs: 30,
      stepTimeoutMs: 30,
    },
  );

  // Missing targets are dropped, not fatal; the page switch happens exactly once.
  assert.deepEqual(
    steps.map((item) => item.target),
    ['#here', '#later'],
  );
  assert.deepEqual(navigated, ['monthlyrun']);
});

test('waitForElement gives up after the timeout instead of hanging', async () => {
  const { window } = installDom({ url: 'http://localhost/captable' });
  stubLayout(window);
  window.document.body.innerHTML = '';

  const started = Date.now();
  const found = await waitForElement('#nope', { timeoutMs: 60, intervalMs: 10 });

  assert.equal(found, null);
  assert.ok(Date.now() - started >= 40, 'should wait roughly the timeout');
});

test('the seen flag is per user and per tour, and survives a storage that throws', () => {
  const storage = memoryStorage();

  assert.equal(isTourSeen('captable', 'alice', storage), false);
  markTourSeen('captable', 'alice', storage);
  assert.equal(isTourSeen('captable', 'alice', storage), true);
  assert.equal(isTourSeen('captable', 'bob', storage), false, 'another user is unaffected');
  assert.equal(isTourSeen('monthlyrun', 'alice', storage), false, 'another tour is unaffected');

  const broken = {
    getItem() {
      throw new Error('denied');
    },
    setItem() {
      throw new Error('denied');
    },
  } as unknown as Storage;
  assert.equal(isTourSeen('captable', 'alice', broken), false);
  assert.doesNotThrow(() => markTourSeen('captable', 'alice', broken));
});

test('step copy is resolved through the text table, in the active language', () => {
  const texts: Record<string, string> = { captableMonthTitle: '先选月份', captableMonthBody: '每个月一份快照。' };

  const driveSteps = buildDriveSteps([step('#monthPickerTrigger')], (key) => texts[key] ?? key, 'zh-CN');

  assert.deepEqual(driveSteps, [
    { element: '#monthPickerTrigger', popover: { title: '先选月份', description: '每个月一份快照。' } },
  ]);
});

/** The selector forms the tours use, checked against the shipped markup. */
function staticSelectorExists(selector: string): boolean {
  // `[attr="value"]`, optionally prefixed with a tag or a class: `.nav-item[data-page="monthly"]`.
  const attribute = selector.match(/^(?:([a-z]+)|\.[\w-]+)?\[([\w-]+)="([^"]+)"\]$/i);
  if (attribute) {
    const [, tag, name, value] = attribute;
    const prefix = tag ? `(?=<${tag}\\b)[^>]*` : '[^>]*';
    return new RegExp(`${prefix}\\b${name}="${value}"`).test(INDEX_HTML);
  }

  // `#anchor .child` / `#anchor tag` — the anchor id must exist; the descendant is page content that
  // is rendered by the page itself, so only the anchor is asserted.
  const anchored = selector.match(/^#([\w-]+)(\s|$)/);
  if (anchored) return new RegExp(`id="${anchored[1]}"`).test(INDEX_HTML);

  const idOnly = selector.match(/^#([\w-]+)$/);
  if (idOnly) return new RegExp(`id="${idOnly[1]}"`).test(INDEX_HTML);

  // `tag.class` / `.class`
  const classSelector = selector.match(/^([a-z]*)\.([\w-]+)$/i);
  if (classSelector) {
    const tag = classSelector[1] ? `(?=<${classSelector[1]}[^>]*class=")` : '';
    return new RegExp(`${tag}[^>]*class="[^"]*\\b${classSelector[2]}\\b`).test(INDEX_HTML);
  }

  return false;
}

test('every static tour target exists in index.html', () => {
  // Guards the failure mode that actually happens: someone renames an id, the tour silently starts
  // pointing at nothing, and nobody notices until a user complains.
  const missing: string[] = [];
  for (const tour of TOURS) {
    for (const item of tour.steps) {
      if (item.dynamic) continue;
      if (!staticSelectorExists(item.target)) missing.push(`${tour.id}: ${item.target}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('every tour maps to a page that has a top-bar entry, and lookups behave', () => {
  assert.equal(tourForPage('captable')?.id, 'captable');
  assert.equal(tourForPage('grant-record')?.id, 'record-pages');
  assert.equal(tourForPage('exercise-record')?.id, 'record-pages');
  assert.equal(tourForPage('cancellation-record')?.id, 'record-pages');
  assert.equal(tourForPage('monthly')?.id, 'monthlyrun');
  assert.equal(tourForPage('monthlyrun')?.id, 'monthlyrun');
  assert.equal(tourForPage('employee-management')?.id, 'employee-management');
  assert.equal(tourForPage('plan-summary')?.id, 'plan-summary');
  assert.equal(tourForPage('five-percent-holders')?.id, 'five-percent-holders');
  // Pages without a script must fall back to the "not available" notice rather than throwing.
  assert.equal(tourForPage('settings'), null);
  assert.equal(tourForPage('docs'), null, 'the handbook itself has no walkthrough');
  assert.equal(tourById('nope'), null);
  // The overview leads the list: it is the one a new user should open first.
  assert.equal(TOURS[0]?.id, 'overview');
});

test('a page-scoped tour keeps only that page and still covers four record pages', () => {
  const records = tourById('record-pages');
  assert.ok(records);

  const grantOnly = tourStepsForPage(records, 'grant-record');
  assert.deepEqual(
    grantOnly.map((item) => item.page),
    Array.from({ length: grantOnly.length }, () => 'grant-record'),
  );

  const pages = new Set(records.steps.map((item) => item.page));
  assert.deepEqual([...pages].sort(), ['cancellation-record', 'exercise-record', 'grant-record', 'sold-shares']);
});

test('a script that spans pages is split into one segment per page', () => {
  const steps: TourStep[] = [
    { page: 'monthly', target: '#a', title: 'monthlyCreateTitle', body: 'monthlyCreateBody' },
    { target: '#b', title: 'monthlyPlansTitle', body: 'monthlyPlansBody' },
    { page: 'monthlyrun', target: '#c', title: 'monthlyMonthTitle', body: 'monthlyMonthBody' },
    { target: '#d', title: 'monthlyInputsTitle', body: 'monthlyInputsBody' },
    { page: 'monthlyrun', target: '#e', title: 'monthlyRunTitle', body: 'monthlyRunBody' },
  ];

  const segments = planSegments(steps, 'captable');

  assert.deepEqual(
    segments.map((segment) => [segment.page, segment.steps.map((step) => step.target)]),
    [
      ['monthly', ['#a', '#b']],
      ['monthlyrun', ['#c', '#d', '#e']],
    ],
  );
});

test('a segment inherits the previous page when a step does not name one', () => {
  const segments = planSegments([{ target: '#a', title: 'captableMonthTitle', body: 'captableMonthBody' }], 'captable');
  assert.deepEqual(
    segments.map((segment) => segment.page),
    ['captable'],
  );
});

test('the runner plays every segment, navigating between them, and records "seen" once at the end', async () => {
  const { window } = installDom({ url: 'http://localhost/captable' });
  stubLayout(window);
  window.document.body.innerHTML = '<div id="one"></div><div id="two"></div><div id="three"></div>';
  const storage = window.localStorage;
  storage.clear();
  const outcomes: string[] = [];
  const navigated: string[] = [];
  const drivenSteps: number[] = [];
  const doneLabels: string[] = [];

  const { createTourRunner } = await import('./tourRunner.js');
  const runner = createTourRunner(
    {
      language: () => 'zh-CN',
      text: (key) => String(key),
      navigate: async (page) => {
        navigated.push(page);
      },
      currentPage: () => navigated[navigated.length - 1] ?? 'captable',
      user: () => 'alice',
      onFinished: (_id, outcome) => outcomes.push(outcome),
    },
    {
      // Fake driver: renders the popover node, then the test clicks its done button.
      createDriver: (config) => {
        drivenSteps.push((config.steps ?? []).length);
        doneLabels.push(String(config.doneBtnText));
        return {
          drive: () => {
            const popover = window.document.createElement('div');
            popover.className = 'driver-popover';
            const done = window.document.createElement('button');
            done.className = 'driver-popover-next-btn driver-popover-done-btn';
            done.addEventListener('click', () => popover.remove());
            popover.appendChild(done);
            window.document.body.appendChild(popover);
            // The user finishes each chunk.
            done.click();
          },
          destroy: () => {},
        } as never;
      },
    },
  );

  const started = await runner.start({
    id: 'monthlyrun',
    title: 'monthlyTitle',
    description: 'monthlyDescription',
    steps: [
      { page: 'monthly', target: '#one', title: 'monthlyCreateTitle', body: 'monthlyCreateBody' },
      { page: 'monthlyrun', target: '#two', title: 'monthlyMonthTitle', body: 'monthlyMonthBody' },
      { page: 'monthlyrun', target: '#three', title: 'monthlyRunTitle', body: 'monthlyRunBody' },
    ],
  });

  assert.equal(started, true);
  assert.deepEqual(navigated, ['monthly', 'monthlyrun'], 'one navigation per segment');
  assert.deepEqual(drivenSteps, [1, 2], 'each segment drives only its own steps');
  assert.deepEqual(doneLabels, ['继续', '完成'], 'intermediate chunks continue, the last one finishes');
  assert.deepEqual(outcomes, ['finished']);
  assert.equal(isTourSeen('monthlyrun', 'alice', storage), true);
});

test('a tour with nothing to highlight reports "not started" instead of opening an empty overlay', async () => {
  const { window } = installDom({ url: 'http://localhost/captable' });
  stubLayout(window);
  window.document.body.innerHTML = '<div id="present"></div>';

  const { createTourRunner } = await import('./tourRunner.js');
  let driveCalled = false;
  const runner = createTourRunner(
    {
      language: () => 'zh-CN',
      text: (key) => String(key),
      navigate: async () => {},
      currentPage: () => 'captable',
      user: () => 'alice',
    },
    {
      createDriver: () =>
        ({
          drive: () => {
            driveCalled = true;
          },
          destroy: () => {},
        }) as never,
    },
  );

  const started = await runner.start({
    id: 'captable',
    title: 'captableTitle',
    description: 'captableDescription',
    steps: [{ target: '#gone', title: 'captableMonthTitle', body: 'captableMonthBody' }],
  });

  assert.equal(started, false);
  assert.equal(driveCalled, false);
});

test('a target that exists but is not on screen is skipped like a missing one', async () => {
  const { window } = installDom({ url: 'http://localhost/captable' });
  stubLayout(window);
  // A legacy control kept inside a hidden wrapper: `querySelector` finds it, the user cannot see it.
  window.document.body.innerHTML =
    '<div id="visible"></div><div id="wrapped" style="display: none"><select id="hiddenControl"></select></div>';

  const steps = await resolveTourSteps([step('#visible'), step('#hiddenControl'), step('#not-there-at-all')], {
    page: 'captable',
    navigate: async () => {},
    firstStepTimeoutMs: 20,
    stepTimeoutMs: 20,
  });

  assert.deepEqual(
    steps.map((item) => item.target),
    ['#visible'],
  );
});

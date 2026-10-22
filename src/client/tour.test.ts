import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { installDom } from '../../test/dom-env.mjs';
import { buildDriveSteps, isTourSeen, markTourSeen, resolveTourSteps, waitForElement, type TourStep } from './tour.js';
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

test('every static tour target exists in index.html', () => {
  // Guards the failure mode that actually happens: someone renames an id, the tour silently starts
  // pointing at nothing, and nobody notices until a user complains.
  const missing: string[] = [];
  for (const tour of TOURS) {
    for (const item of tour.steps) {
      if (item.dynamic) continue;
      const id = item.target.startsWith('#') ? item.target.slice(1) : null;
      const attribute = item.target.startsWith('[') ? item.target : null;
      if (id) {
        if (!new RegExp(`id="${id}"`).test(INDEX_HTML)) missing.push(`${tour.id}: ${item.target}`);
        continue;
      }
      if (attribute) {
        const match = attribute.match(/^\[([\w-]+)="([^"]+)"\]$/);
        if (!match) {
          missing.push(`${tour.id}: unsupported selector ${item.target}`);
        } else if (!new RegExp(`${match[1]}="${match[2]}"`).test(INDEX_HTML)) {
          missing.push(`${tour.id}: ${item.target}`);
        }
        continue;
      }
      missing.push(`${tour.id}: unsupported selector ${item.target}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('every tour maps to a page that has a top-bar entry, and lookups behave', () => {
  assert.equal(tourForPage('captable')?.id, 'captable');
  assert.equal(tourForPage('grant-record')?.id, 'record-pages');
  assert.equal(tourForPage('exercise-record')?.id, 'record-pages');
  assert.equal(tourForPage('cancellation-record')?.id, 'record-pages');
  assert.equal(tourForPage('monthlyrun')?.id, 'monthlyrun');
  assert.equal(tourForPage('docs')?.id, 'docs');
  // Pages without a script must fall back to the "not available" notice rather than throwing.
  assert.equal(tourForPage('settings'), null);
  assert.equal(tourById('nope'), null);
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

test('the runner maps steps, drives, and only records "seen" when the user finishes', async () => {
  const { window } = installDom({ url: 'http://localhost/captable' });
  stubLayout(window);
  window.document.body.innerHTML = '<div id="one"></div><div id="two"></div>';
  const storage = memoryStorage();
  const outcomes: string[] = [];
  const captured: { config: { steps?: unknown[]; allowClose?: boolean; onDestroyed?: () => void } | null } = {
    config: null,
  };
  let drove = false;

  const { createTourRunner } = await import('./tourRunner.js');
  const runner = createTourRunner(
    {
      language: () => 'zh-CN',
      text: (key) => String(key),
      navigate: async () => {},
      currentPage: () => 'captable',
      user: () => 'alice',
      onFinished: (_id, outcome) => outcomes.push(outcome),
    },
    {
      // Fake driver: capture the config and let the test drive the hooks itself.
      createDriver: (driverConfig) => {
        captured.config = driverConfig as unknown as NonNullable<typeof captured.config>;
        return {
          drive: () => {
            drove = true;
          },
          destroy: () => {},
        } as never;
      },
    },
  );

  const started = await runner.start({
    id: 'captable',
    title: 'captableTitle',
    description: 'captableDescription',
    steps: [
      { target: '#one', title: 'captableMonthTitle', body: 'captableMonthBody' },
      { target: '#two', title: 'captableReconTitle', body: 'captableReconBody' },
    ],
  });

  assert.equal(started, true);
  assert.equal(drove, true);
  assert.equal(captured.config?.steps?.length, 2);
  assert.equal(captured.config?.allowClose, true);

  // Esc / close: dismissed, nothing remembered.
  captured.config?.onDestroyed?.();
  assert.deepEqual(outcomes, ['dismissed']);
  assert.equal(isTourSeen('captable', 'alice', storage), false);
});

test('pressing Done is what records the tour as seen, and other closes are not', async () => {
  const { window } = installDom({ url: 'http://localhost/captable' });
  stubLayout(window);
  window.document.body.innerHTML = '<div id="one"></div>';
  const storage = window.localStorage;
  const outcomes: string[] = [];
  const captured: { config: { onDestroyed?: () => void } | null } = { config: null };

  const { createTourRunner } = await import('./tourRunner.js');
  const runner = createTourRunner(
    {
      language: () => 'zh-CN',
      text: (key) => String(key),
      navigate: async () => {},
      currentPage: () => 'captable',
      user: () => 'alice',
      onFinished: (_id, outcome) => outcomes.push(outcome),
    },
    {
      createDriver: (driverConfig) => {
        captured.config = driverConfig as unknown as NonNullable<typeof captured.config>;
        return { drive: () => {}, destroy: () => {} } as never;
      },
    },
  );

  assert.equal(
    await runner.start({
      id: 'captable',
      title: 'captableTitle',
      description: 'captableDescription',
      steps: [{ target: '#one', title: 'captableMonthTitle', body: 'captableMonthBody' }],
    }),
    true,
  );

  // A Next click mid-tour must not count.
  const next = window.document.createElement('button');
  next.className = 'driver-popover-next-btn';
  window.document.body.appendChild(next);
  next.click();
  assert.equal(isTourSeen('captable', 'alice', storage), false);

  const done = window.document.createElement('button');
  done.className = 'driver-popover-next-btn driver-popover-done-btn';
  window.document.body.appendChild(done);
  done.click();

  assert.equal(isTourSeen('captable', 'alice', storage), true);
  assert.deepEqual(outcomes, ['finished']);

  // Driver's own teardown must not then report a dismissal on top of the finish.
  captured.config?.onDestroyed?.();
  assert.deepEqual(outcomes, ['finished']);
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

import type { DriveStep } from 'driver.js';
import type { AppLanguage } from './i18n.js';
import type { TextKey } from './texts.js';

/**
 * Product tours ("walkthroughs").
 *
 * Deliberately passive: nothing ever starts on its own. The user opens one from the top-bar
 * question mark (current page) or from the 使用手册 page (any page). That keeps existing users
 * undisturbed and means a broken step can never interrupt real work.
 *
 * Steps only target elements that are visible in a page's normal state — no opening modals or
 * switching tabs mid-tour, because driver.js has no async per-step hook and a half-applied state
 * change is exactly how tours start pointing at nothing.
 */

export type TourId = 'captable' | 'monthlyrun' | 'record-pages' | 'docs';

export type TourStep = {
  /** Page the step lives on; when it differs from the current page the tour navigates first. */
  page?: string;
  /** CSS selector of the element to spotlight. */
  target: string;
  title: TextKey<'tour'>;
  body: TextKey<'tour'>;
  /** Target is rendered at runtime rather than living in index.html (static-selector test skips it). */
  dynamic?: boolean;
};

export type TourDefinition = {
  id: TourId;
  title: TextKey<'tour'>;
  description: TextKey<'tour'>;
  steps: TourStep[];
};

const SEEN_KEY_PREFIX = 'gyre.tour.';

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function seenKey(tourId: string, user: string): string {
  return `${SEEN_KEY_PREFIX}${user || 'anonymous'}.${tourId}.done`;
}

export function isTourSeen(tourId: string, user: string, storage: Storage | null = safeStorage()): boolean {
  try {
    return storage?.getItem(seenKey(tourId, user)) === '1';
  } catch {
    return false;
  }
}

export function markTourSeen(tourId: string, user: string, storage: Storage | null = safeStorage()): void {
  try {
    storage?.setItem(seenKey(tourId, user), '1');
  } catch {
    // Private mode / full storage must never break the tour itself.
  }
}

/**
 * `querySelector` finds elements that are present but not on screen — a legacy control kept inside a
 * `display: none` wrapper, a collapsed section, a zero-size placeholder. driver.js would then put its
 * spotlight at the top-left corner, which looks like a bug to the user.
 */
export function isElementVisible(element: HTMLElement): boolean {
  if (element.getClientRects().length === 0) return false;
  const style = window.getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
}

/** Resolves once `selector` matches, or to null after `timeoutMs`. */
export async function waitForElement(
  selector: string,
  options: { timeoutMs?: number; intervalMs?: number; root?: ParentNode } = {},
): Promise<HTMLElement | null> {
  const timeoutMs = options.timeoutMs ?? 1500;
  const intervalMs = options.intervalMs ?? 50;
  const root = options.root ?? document;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const element = root.querySelector<HTMLElement>(selector);
    if (element) return element;
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/**
 * Keep only the steps that can actually be shown.
 *
 * A step whose target is absent is dropped rather than leaving the tour pointing at nothing: the
 * monthly page renders a version-mismatch banner instead of the input table, and a month with no
 * records has no rows, so this is a normal state rather than an error.
 */
export async function resolveTourSteps(
  steps: ReadonlyArray<TourStep>,
  options: {
    page: string;
    navigate: (page: string) => Promise<void>;
    /** Budget for the first step: the page the user is already on may still be loading data. */
    firstStepTimeoutMs?: number;
    /** Budget for the rest. They are on an already-rendered page, so a long wait only delays the tour. */
    stepTimeoutMs?: number;
  },
): Promise<TourStep[]> {
  const usable: TourStep[] = [];
  let currentPage = options.page;
  for (const [index, step] of steps.entries()) {
    if (step.page && step.page !== currentPage) {
      await options.navigate(step.page);
      currentPage = step.page;
    }
    const timeoutMs = index === 0 ? (options.firstStepTimeoutMs ?? 1500) : (options.stepTimeoutMs ?? 300);
    const element = await waitForElement(step.target, { timeoutMs });
    // Present but not on screen counts as missing: there is nothing to point at.
    if (element && isElementVisible(element)) usable.push(step);
  }
  return usable;
}

/** Maps tour steps to driver.js steps. Pure, so the copy/language mapping is testable in node. */
export function buildDriveSteps(
  steps: ReadonlyArray<TourStep>,
  text: (key: TextKey<'tour'>, language: AppLanguage) => string,
  language: AppLanguage,
): DriveStep[] {
  return steps.map((step) => ({
    element: step.target,
    popover: {
      title: text(step.title, language),
      description: text(step.body, language),
    },
  }));
}

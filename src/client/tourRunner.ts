import { driver, type Config, type Driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import type { AppLanguage } from './i18n.js';
import type { TextKey } from './texts.js';
import {
  buildDriveSteps,
  markTourSeen,
  planSegments,
  resolveTourSteps,
  type TourDefinition,
  type TourId,
  type TourStep,
} from './tour.js';

/**
 * driver.js binding, kept separate from `tour.ts` so the step logic there stays importable from node
 * tests (this module pulls in a CSS file).
 */

export type TourRunnerDeps = {
  language: () => AppLanguage;
  text: (key: TextKey<'tour'>, language: AppLanguage) => string;
  navigate: (page: string) => Promise<void>;
  /** Current page, so a tour can decide whether it must navigate first. */
  currentPage: () => string;
  user: () => string;
  onFinished?: (tourId: TourId, outcome: 'finished' | 'dismissed') => void;
};

export type TourRunner = {
  start: (tour: TourDefinition) => Promise<boolean>;
  destroy: () => void;
};

/** Injectable so the runner's bookkeeping can be tested without a browser. */
export type TourDriverFactory = (config: Config) => Driver;

export function createTourRunner(deps: TourRunnerDeps, options: { createDriver?: TourDriverFactory } = {}): TourRunner {
  const createDriver = options.createDriver ?? driver;
  let active: Driver | null = null;
  let cancelled = false;

  function destroy() {
    cancelled = true;
    active?.destroy();
    active = null;
  }

  /** driver.js may skip its destroy hooks on the final step, so watch the DOM instead of trusting them. */
  async function waitForTourToClose(): Promise<void> {
    for (let waited = 0; waited < 5 * 60 * 1000; waited += 100) {
      if (!document.querySelector('.driver-popover')) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  async function playSegment(
    segment: { page: string; steps: TourStep[] },
    language: AppLanguage,
    lastSegment: boolean,
    showProgress: boolean,
  ): Promise<'done' | 'closed'> {
    let doneClicked = false;
    // Capture phase: survives the button node being replaced on each render, and does not shadow
    // driver's own handlers (a `onDoneClick` config hook would swallow the default teardown).
    const onDocumentClick = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest?.('.driver-popover-done-btn')) doneClicked = true;
    };
    document.addEventListener('click', onDocumentClick, true);

    const instance = createDriver({
      steps: buildDriveSteps(segment.steps, deps.text, language),
      // A per-segment counter that restarts (1/1, 1/16, …) reads worse than none, so only a
      // single-page tour shows progress.
      showProgress,
      progressText: '{{current}} / {{total}}',
      nextBtnText: language === 'en-US' ? 'Next' : '下一步',
      prevBtnText: language === 'en-US' ? 'Back' : '上一步',
      // Intermediate chunks say "继续": finishing them is not the end of the walkthrough.
      doneBtnText: lastSegment ? (language === 'en-US' ? 'Done' : '完成') : language === 'en-US' ? 'Continue' : '继续',
      allowClose: true,
      // Belt and braces: `resolveTourSteps` already dropped missing targets, this keeps a step from
      // being fatal if the DOM changes between resolution and highlight.
      skipMissingElement: true,
      waitForElement: 0,
      overlayColor: 'rgb(15 23 42 / 0.62)',
      stagePadding: 6,
      stageRadius: 10,
      popoverClass: 'gyre-tour-popover',
      smoothScroll: true,
    });
    active = instance;
    instance.drive();
    await waitForTourToClose();
    document.removeEventListener('click', onDocumentClick, true);
    if (active === instance) active = null;
    return doneClicked ? 'done' : 'closed';
  }

  async function start(tour: TourDefinition): Promise<boolean> {
    destroy();
    cancelled = false;
    const language = deps.language();
    const segments = planSegments(tour.steps, deps.currentPage());
    let played = 0;

    for (const [index, segment] of segments.entries()) {
      if (cancelled) return played > 0;
      if (deps.currentPage() !== segment.page) await deps.navigate(segment.page);
      if (cancelled) return played > 0;

      // Resolved per segment: the page is already showing, so nothing waits on a page it cannot see.
      const steps = await resolveTourSteps(segment.steps, { page: segment.page, navigate: deps.navigate });
      if (!steps.length) continue;

      played += 1;
      const outcome = await playSegment(
        { page: segment.page, steps },
        language,
        index === segments.length - 1,
        segments.length === 1,
      );
      if (outcome === 'closed') {
        // Esc, the X or the overlay: the user stopped, so the tour is offered again next time.
        deps.onFinished?.(tour.id, 'dismissed');
        return true;
      }
    }

    if (!played) return false;
    markTourSeen(tour.id, deps.user());
    deps.onFinished?.(tour.id, 'finished');
    return true;
  }

  return { start, destroy };
}

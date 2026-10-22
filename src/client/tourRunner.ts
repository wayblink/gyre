import { driver, type Config, type Driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import type { AppLanguage } from './i18n.js';
import type { TextKey } from './texts.js';
import { buildDriveSteps, markTourSeen, resolveTourSteps, type TourDefinition, type TourId } from './tour.js';

/**
 * driver.js binding, kept separate from `tour.ts` so the step logic there stays importable from
 * node tests (this module pulls in a CSS file).
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

  function destroy() {
    active?.destroy();
    active = null;
  }

  async function start(tour: TourDefinition): Promise<boolean> {
    destroy();
    const steps = await resolveTourSteps(tour.steps, {
      page: deps.currentPage(),
      navigate: deps.navigate,
    });
    if (!steps.length) return false;

    const language = deps.language();
    // "Finished" must not depend on driver's destroy bookkeeping: on the last step driver clears
    // `__activeStep` before destroying, then skips both `onDeselected` and `onDestroyed`, and the
    // button node it hands to `onPopoverRender` is replaced on the next render. A capture-phase
    // listener on the document survives both, and "the Done button was pressed" is exactly the
    // moment the walkthrough is complete.
    let finished = false;
    const onDocumentClick = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest?.('.driver-popover-done-btn')) return;
      finished = true;
      markTourSeen(tour.id, deps.user());
      deps.onFinished?.(tour.id, 'finished');
    };
    document.addEventListener('click', onDocumentClick, true);

    const instance = createDriver({
      steps: buildDriveSteps(steps, deps.text, language),
      showProgress: true,
      progressText: '{{current}} / {{total}}',
      nextBtnText: language === 'en-US' ? 'Next' : '下一步',
      prevBtnText: language === 'en-US' ? 'Back' : '上一步',
      doneBtnText: language === 'en-US' ? 'Done' : '完成',
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
      onDestroyed: () => {
        document.removeEventListener('click', onDocumentClick, true);
        active = null;
        // Any other close (Esc, overlay, the X) leaves the tour un-finished, so it is offered again.
        if (!finished) deps.onFinished?.(tour.id, 'dismissed');
      },
    });
    active = instance;
    instance.drive();
    return true;
  }

  return { start, destroy };
}

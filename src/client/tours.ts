import type { TourDefinition, TourStep } from './tour.js';

/**
 * Tour content, kept in code next to the selectors it points at.
 *
 * These are UI strings, not workflow definitions — the "definitions live in the DB" rule in
 * AGENTS.md is about `workflow_definitions`. If a non-developer ever needs to edit the copy or the
 * order, this becomes a DB-backed JSON exactly like the monthly input schema; until then, code keeps
 * selectors and copy reviewed together.
 */

/** The four record pages share one script; only the element ids differ. */
function recordPageTour(params: {
  id: 'grant-record' | 'exercise-record' | 'sold-shares' | 'cancellation-record';
  monthPicker: string;
  sourceFiles: string;
  tableBody: string;
  /** Grant and exercise pages have a Futu / Shareworks / Merge view switch. */
  viewTabs?: string;
}): TourStep[] {
  // Every record-page action bar exposes its update button by attribute, not by id.
  const updateButton = `[data-workflow-update-page="${params.id}"]`;
  const steps: TourStep[] = [
    {
      page: params.id,
      target: `#${params.monthPicker}`,
      title: 'recordMonthTitle',
      body: 'recordMonthBody',
    },
    {
      page: params.id,
      target: `#${params.sourceFiles}`,
      title: 'recordSourceTitle',
      body: 'recordSourceBody',
    },
  ];
  if (params.viewTabs) {
    steps.push({
      page: params.id,
      target: `#${params.viewTabs}`,
      title: 'recordViewsTitle',
      body: 'recordViewsBody',
    });
  }
  steps.push(
    {
      page: params.id,
      target: `#${params.tableBody}`,
      title: 'recordTableTitle',
      body: 'recordTableBody',
      dynamic: true,
    },
    {
      page: params.id,
      target: updateButton,
      title: 'recordUpdateTitle',
      body: 'recordUpdateBody',
    },
  );
  return steps;
}

export const TOURS: TourDefinition[] = [
  {
    id: 'captable',
    title: 'captableTitle',
    description: 'captableDescription',
    steps: [
      { page: 'captable', target: '#monthPickerTrigger', title: 'captableMonthTitle', body: 'captableMonthBody' },
      {
        target: '#reconciliationTable',
        title: 'captableReconTitle',
        body: 'captableReconBody',
        dynamic: true,
      },
      {
        target: '#capitalizationTable',
        title: 'captableSummaryTitle',
        body: 'captableSummaryBody',
        dynamic: true,
      },
      {
        target: '#btnExport',
        title: 'captableExportTitle',
        body: 'captableExportBody',
        dynamic: true,
      },
      {
        target: '#btnOpenMonthlyUpdateFromCapTable',
        title: 'captableToMonthlyTitle',
        body: 'captableToMonthlyBody',
        dynamic: true,
      },
    ],
  },
  {
    id: 'monthlyrun',
    title: 'monthlyTitle',
    description: 'monthlyDescription',
    steps: [
      { page: 'monthlyrun', target: '#monthlyRunMonth', title: 'monthlyMonthTitle', body: 'monthlyMonthBody' },
      {
        target: '#monthlyRunSourcesBody',
        title: 'monthlyInputsTitle',
        body: 'monthlyInputsBody',
        dynamic: true,
      },
      {
        target: '#btnMonthlyRunConfigureSources',
        title: 'monthlyConfigureTitle',
        body: 'monthlyConfigureBody',
      },
      {
        target: '#monthlyRunConstantsBlock',
        title: 'monthlyConstantsTitle',
        body: 'monthlyConstantsBody',
        dynamic: true,
      },
      { target: '#btnTriggerMonthlyRun', title: 'monthlyRunTitle', body: 'monthlyRunBody', dynamic: true },
      {
        target: '#monthlyRunPanel',
        title: 'monthlyPanelTitle',
        body: 'monthlyPanelBody',
        dynamic: true,
      },
    ],
  },
  {
    id: 'record-pages',
    title: 'recordsTitle',
    description: 'recordsDescription',
    steps: [
      ...recordPageTour({
        id: 'grant-record',
        monthPicker: 'grantMonthPickerTrigger',
        sourceFiles: 'grantRecordSourceFilesName',
        tableBody: 'holdingsBody',
        viewTabs: 'grantTab-futu',
      }),
      ...recordPageTour({
        id: 'exercise-record',
        monthPicker: 'exerciseMonthPickerTrigger',
        sourceFiles: 'exerciseRecordSourceFilesName',
        tableBody: 'exerciseBody',
        viewTabs: 'exerciseTab-futu',
      }),
      ...recordPageTour({
        id: 'sold-shares',
        monthPicker: 'soldSharesMonthPickerTrigger',
        sourceFiles: 'soldSharesSourceFilesName',
        tableBody: 'soldSharesBody',
      }),
      ...recordPageTour({
        id: 'cancellation-record',
        monthPicker: 'cancellationMonthPickerTrigger',
        sourceFiles: 'cancellationSourceFilesName',
        tableBody: 'cancellationRecordsBody',
      }),
    ],
  },
  {
    id: 'docs',
    title: 'docsTitle',
    description: 'docsDescription',
    steps: [
      { page: 'docs', target: '#docNav', title: 'docsNavTitle', body: 'docsNavBody', dynamic: true },
      { target: '#tourStartPanel', title: 'docsTourTitle', body: 'docsTourBody' },
      { target: '#docContent', title: 'docsContentTitle', body: 'docsContentBody' },
    ],
  },
];

/** Page → the tour the top-bar question mark should play. */
const TOUR_BY_PAGE: Record<string, TourDefinition['id']> = {
  captable: 'captable',
  monthlyrun: 'monthlyrun',
  'grant-record': 'record-pages',
  'exercise-record': 'record-pages',
  'sold-shares': 'record-pages',
  'cancellation-record': 'record-pages',
  docs: 'docs',
};

export function tourForPage(page: string): TourDefinition | null {
  const id = TOUR_BY_PAGE[page];
  return TOURS.find((tour) => tour.id === id) ?? null;
}

export function tourById(id: string): TourDefinition | null {
  return TOURS.find((tour) => tour.id === id) ?? null;
}

/** Steps restricted to one page — used when the tour was started from a specific page. */
export function tourStepsForPage(tour: TourDefinition, page: string): TourStep[] {
  const steps = tour.steps.filter((step) => !step.page || step.page === page);
  return steps.length ? steps : tour.steps;
}

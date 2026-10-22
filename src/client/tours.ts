import type { TourDefinition, TourStep } from './tour.js';

/**
 * Tour content, kept in code next to the selectors it points at.
 *
 * These are UI strings, not workflow definitions — the "definitions live in the DB" rule in
 * AGENTS.md is about `workflow_definitions`. If a non-developer ever needs to edit the copy or the
 * order, this becomes a DB-backed JSON exactly like the monthly input schema; until then, code keeps
 * selectors and copy reviewed together.
 *
 * Rules the steps follow (they are what make a tour survive real data):
 * - only targets that are on screen in the page's normal state (a step pointing into a modal would
 *   need the modal opened first, and driver.js has no async per-step hook);
 * - row-level targets use the first row's class inside the table body and are marked `dynamic`, so a
 *   month with nothing rendered simply skips them instead of pointing at empty space.
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
    id: 'overview',
    menuLabel: 'navOverview',
    title: 'overviewTitle',
    description: 'overviewDescription',
    // An overview walks the navigation, not the widgets: one step per module, each pointing at its
    // entry in the sidebar, so the reader learns where things live without leaving the page.
    steps: [
      { page: 'captable', target: 'aside.sidebar', title: 'overviewNavTitle', body: 'overviewNavBody' },
      {
        target: '.nav-item[data-page="captable"]',
        title: 'overviewCaptableTitle',
        body: 'overviewCaptableBody',
      },
      {
        target: '.nav-item[data-page="monthly"]',
        title: 'overviewMonthlyTitle',
        body: 'overviewMonthlyBody',
      },
      { target: '.nav-item[data-page="esop-detail"]', title: 'overviewEsopTitle', body: 'overviewEsopBody' },
      {
        target: '.nav-item[data-page="employee-management"]',
        title: 'overviewEmployeesTitle',
        body: 'overviewEmployeesBody',
      },
      { target: '.nav-item[data-page="plan-summary"]', title: 'overviewPlanTitle', body: 'overviewPlanBody' },
      {
        target: '.nav-item[data-page="five-percent-holders"]',
        title: 'overviewHoldersTitle',
        body: 'overviewHoldersBody',
      },
      { target: '.nav-section-label', title: 'overviewAdminTitle', body: 'overviewAdminBody', dynamic: true },
      {
        target: '#btnStartTour',
        title: 'overviewHelpTitle',
        body: 'overviewHelpBody',
      },
    ],
  },
  {
    id: 'captable',
    menuLabel: 'navCaptable',
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
    menuLabel: 'navMonthly',
    title: 'monthlyTitle',
    description: 'monthlyDescription',
    steps: [
      // The month is created on the plan list; the run itself happens on its own page.
      { page: 'monthly', target: '#btnAddUpdate', title: 'monthlyCreateTitle', body: 'monthlyCreateBody' },
      {
        target: '#monthlyUpdateTable',
        title: 'monthlyPlansTitle',
        body: 'monthlyPlansBody',
      },
      { page: 'monthlyrun', target: '#monthlyRunMonth', title: 'monthlyMonthTitle', body: 'monthlyMonthBody' },
      {
        // The header row, not the whole table: a 16-row table as a spotlight puts the popover on top
        // of the rows it is describing.
        target: '#monthlyRunSourcesTable thead',
        title: 'monthlyInputsTitle',
        body: 'monthlyInputsBody',
        dynamic: true,
      },
      // Column by column, left to right.
      {
        target: '#monthlyRunColFile',
        title: 'monthlyColFileTitle',
        body: 'monthlyColFileBody',
      },
      {
        target: '#monthlyRunColDescription',
        title: 'monthlyColDescTitle',
        body: 'monthlyColDescBody',
      },
      {
        target: '#monthlyRunSourcesBody .source-required-badge',
        title: 'monthlyBadgeTitle',
        body: 'monthlyBadgeBody',
        dynamic: true,
      },
      {
        target: '#monthlyRunSourcesBody .source-purpose',
        title: 'monthlyPurposeTitle',
        body: 'monthlyPurposeBody',
        dynamic: true,
      },
      {
        target: '#monthlyRunSourcesBody .source-file-template__trigger',
        title: 'monthlyTemplateTitle',
        body: 'monthlyTemplateBody',
        dynamic: true,
      },
      {
        target: '#monthlyRunColUploaded',
        title: 'monthlyColUploadedTitle',
        body: 'monthlyColUploadedBody',
      },
      {
        target: '#monthlyRunSourcesBody .source-uploaded-cell',
        title: 'monthlyUploadedCellTitle',
        body: 'monthlyUploadedCellBody',
        dynamic: true,
      },
      {
        target: '#monthlyRunSourcesBody .source-sheet-control',
        title: 'monthlySheetTitle',
        body: 'monthlySheetBody',
        dynamic: true,
      },
      {
        target: '#monthlyRunColUploadedTime',
        title: 'monthlyColTimeTitle',
        body: 'monthlyColTimeBody',
      },
      {
        // One step for this column: the header and the buttons were explaining the same two actions.
        target: '#monthlyRunSourcesBody .source-file-action-group',
        title: 'monthlyActionsCellTitle',
        body: 'monthlyActionsCellBody',
        dynamic: true,
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
    menuLabel: 'navEsop',
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
    id: 'employee-management',
    menuLabel: 'navEmployees',
    title: 'employeesTitle',
    description: 'employeesDescription',
    steps: [
      {
        page: 'employee-management',
        target: '#searchEmployeesPage',
        title: 'employeesSearchTitle',
        body: 'employeesSearchBody',
      },
      {
        target: '#filterEmployeesPageSource',
        title: 'employeesSourceTitle',
        body: 'employeesSourceBody',
      },
      {
        target: '#filterEmployeesPageTag',
        title: 'employeesTagTitle',
        body: 'employeesTagBody',
      },
      {
        target: '#btnManageEmployeeLabels',
        title: 'employeesLabelsTitle',
        body: 'employeesLabelsBody',
      },
      {
        target: '#btnAddEmployeesPage',
        title: 'employeesAddTitle',
        body: 'employeesAddBody',
      },
      {
        target: '#employeesPageBody',
        title: 'employeesTableTitle',
        body: 'employeesTableBody',
        dynamic: true,
      },
    ],
  },
  {
    id: 'plan-summary',
    menuLabel: 'navPlan',
    title: 'planSummaryTitle',
    description: 'planSummaryDescription',
    steps: [
      {
        page: 'plan-summary',
        target: '#planSummaryMonthPickerTrigger',
        title: 'planSummaryMonthTitle',
        body: 'planSummaryMonthBody',
      },
      {
        target: '#planSummaryResultFileName',
        title: 'planSummaryFileTitle',
        body: 'planSummaryFileBody',
        dynamic: true,
      },
      {
        target: '#planSummaryGranted',
        title: 'planSummaryMetricsTitle',
        body: 'planSummaryMetricsBody',
        dynamic: true,
      },
      {
        target: '#planSummaryBody',
        title: 'planSummaryTableTitle',
        body: 'planSummaryTableBody',
        dynamic: true,
      },
      {
        target: '#btnOpenMonthlyUpdateFromPlanSummary',
        title: 'planSummaryToMonthlyTitle',
        body: 'planSummaryToMonthlyBody',
      },
    ],
  },
  {
    id: 'five-percent-holders',
    menuLabel: 'navHolders',
    title: 'holdersTitle',
    description: 'holdersDescription',
    steps: [
      {
        page: 'five-percent-holders',
        target: '#page-five-percent-holders',
        title: 'holdersWhatTitle',
        body: 'holdersWhatBody',
      },
      {
        target: '#fivePercentHoldersBody',
        title: 'holdersTableTitle',
        body: 'holdersTableBody',
        dynamic: true,
      },
      {
        target: '[data-workflow-update-page="five-percent-holders"]',
        title: 'holdersUpdateTitle',
        body: 'holdersUpdateBody',
      },
    ],
  },
];

/** Page → the tour the top-bar question mark should play. */
const TOUR_BY_PAGE: Record<string, TourDefinition['id']> = {
  captable: 'captable',
  monthly: 'monthlyrun',
  monthlyrun: 'monthlyrun',
  'grant-record': 'record-pages',
  'exercise-record': 'record-pages',
  'sold-shares': 'record-pages',
  'cancellation-record': 'record-pages',
  'employee-management': 'employee-management',
  'plan-summary': 'plan-summary',
  'five-percent-holders': 'five-percent-holders',
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

import type {
  WorkflowExecutionResult,
  WorkflowExecutionTaskState,
  ProductFileDetail,
  ProductFileRecord,
  WorkflowAssertFailureStrategy,
  WorkflowAssertionResult,
  WorkflowAssertOperator,
  WorkflowExecuteRequest,
  WorkflowDataFrame,
  WorkflowDefinition,
  WorkflowInputGuard,
  WorkflowInputGuardType,
  WorkflowImportExportBundle,
  WorkflowOperator,
  WorkflowRunRecord,
  WorkflowSqlTableBinding,
  WorkflowTask,
  WorkflowTaskInput,
  WorkflowTaskPreviewResult,
  WorkflowTaskPreviewRequest,
} from '../shared/types.js';
import { isWorkflowRunTerminalStatus } from '../shared/workflowRunStatus.js';
import type { ConfirmActionFn, NotifyFn } from './uiFeedback.js';
import { applyStaticTranslations, translateStaticText, type AppLanguage } from './i18n.js';
import { createFilePickerModal } from './filePickerModal.js';
import { renderOperatorConfigForm, syncOperatorConfigForm } from './workflow/operatorConfigForm.js';
import {
  applyTaskOperatorDefaults,
  collectWorkflowTaskParamInputUsages,
  buildDefaultTaskParams,
  buildWorkflowTask,
  decodeWorkflowFileParamSelection,
  encodeWorkflowFileParamSelection,
  getAssertFailureStrategy,
  getWorkflowFileParamRuntimePath,
  getSheetSections,
  getSqlTableBindings,
  getTaskInputSlots,
  getTaskOutputSlots,
  isAnyAssertTask,
  isAssertTask,
  isPersistExcelTask,
  isSchemaAssertTask,
  isSheetRangeExtractTask,
  isSheetSectionsExtractTask,
  isShapeAssertTask,
  isSqlAssertTask,
  isSqlComputeTask,
  isSqlTableBackedTask,
  isWorkflowRuntimeParameterReference,
  nextSqlInputSlotName,
  normalizeAssertTask,
  normalizePersistExcelTask,
  normalizeSchemaAssertTask,
  normalizeShapeAssertTask,
  normalizeSheetRangeExtractTask,
  normalizeSheetSectionsExtractTask,
  normalizeSqlTask,
  normalizeTaskDependencies,
} from './workflow/taskOperators.js';
import {
  buildRuntimeInputFileItems,
  isRuntimeFileParameter,
  isRuntimeInputFileParameter,
  shouldRerenderRuntimeDefaultControl,
  type RuntimeInputFileItem,
  type RuntimeParameterEntry,
} from './workflow/runtimeParameterPresentation.js';

type DomGetter = <T extends HTMLElement>(id: string) => T;

type WorkflowPageDeps = {
  el: DomGetter;
  api: <T>(url: string, options?: RequestInit) => Promise<T>;
  escapeHtml: (text: unknown) => string;
  formatFileSize: (bytes: number) => string;
  getProductFiles: () => ProductFileRecord[];
  refreshProductFiles: () => Promise<unknown>;
  notify: NotifyFn;
  confirmAction: ConfirmActionFn;
  getLanguage?: () => AppLanguage;
};

export function normalizeWorkflowSqlText(sql: string): string {
  const protectedSql = protectSqlLiterals(sql.trim());
  if (!protectedSql.text) return '';

  let formatted = canonicalizeSqlKeywords(protectedSql.text)
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s*([()])\s*/g, ' $1 ')
    .replace(/\s*([=<>!]+)\s*/g, ' $1 ')
    .replace(/\s+/g, ' ')
    .trim();

  formatted = formatted
    .replace(/\s+(WITH|SELECT|FROM|WHERE|GROUP BY|HAVING|ORDER BY|LIMIT|OFFSET|UNION ALL|UNION)\b/g, '\n$1')
    .replace(/\s+((?:LEFT|RIGHT|INNER|FULL|CROSS)\s+JOIN|JOIN)\b/g, '\n$1')
    .replace(/\s+(ON)\b/g, '\n$1');

  formatted = formatSqlClauseLines(formatted);
  formatted = indentSqlLines(formatted);
  return restoreSqlLiterals(formatted, protectedSql.parts);
}

function protectSqlLiterals(sql: string): { text: string; parts: string[] } {
  const parts: string[] = [];
  const placeholderPrefix = '__GYRE_SQL_PART_';
  let text = '';
  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    if (char === "'" || char === '"' || char === '`') {
      const quote = char;
      let part = quote;
      index += 1;
      while (index < sql.length) {
        const next = sql[index];
        part += next;
        if (next === quote) {
          if (sql[index + 1] === quote) {
            part += sql[index + 1];
            index += 2;
            continue;
          }
          break;
        }
        index += 1;
      }
      text += `${placeholderPrefix}${parts.length}__`;
      parts.push(part);
      continue;
    }
    if (char === '[') {
      let part = char;
      index += 1;
      while (index < sql.length) {
        const next = sql[index];
        part += next;
        if (next === ']') break;
        index += 1;
      }
      text += `${placeholderPrefix}${parts.length}__`;
      parts.push(part);
      continue;
    }
    text += char;
  }
  return { text, parts };
}

function restoreSqlLiterals(sql: string, parts: string[]): string {
  let restored = sql;
  parts.forEach((part, index) => {
    restored = restored.replace(new RegExp(`__GYRE_SQL_PART_${index}__`, 'g'), part);
  });
  return restored;
}

function canonicalizeSqlKeywords(sql: string): string {
  const replacements: Array<[RegExp, string]> = [
    [/\bunion\s+all\b/gi, 'UNION ALL'],
    [/\bgroup\s+by\b/gi, 'GROUP BY'],
    [/\border\s+by\b/gi, 'ORDER BY'],
    [/\bleft\s+join\b/gi, 'LEFT JOIN'],
    [/\bright\s+join\b/gi, 'RIGHT JOIN'],
    [/\binner\s+join\b/gi, 'INNER JOIN'],
    [/\bfull\s+join\b/gi, 'FULL JOIN'],
    [/\bcross\s+join\b/gi, 'CROSS JOIN'],
    [/\bselect\b/gi, 'SELECT'],
    [/\bdistinct\b/gi, 'DISTINCT'],
    [/\bfrom\b/gi, 'FROM'],
    [/\bwhere\b/gi, 'WHERE'],
    [/\bhaving\b/gi, 'HAVING'],
    [/\blimit\b/gi, 'LIMIT'],
    [/\boffset\b/gi, 'OFFSET'],
    [/\bunion\b/gi, 'UNION'],
    [/\bjoin\b/gi, 'JOIN'],
    [/\bon\b/gi, 'ON'],
    [/\bas\b/gi, 'AS'],
    [/\band\b/gi, 'AND'],
    [/\bor\b/gi, 'OR'],
    [/\bcase\b/gi, 'CASE'],
    [/\bwhen\b/gi, 'WHEN'],
    [/\bthen\b/gi, 'THEN'],
    [/\belse\b/gi, 'ELSE'],
    [/\bend\b/gi, 'END'],
    [/\bnull\b/gi, 'NULL'],
    [/\bis\b/gi, 'IS'],
    [/\bnot\b/gi, 'NOT'],
    [/\bin\b/gi, 'IN'],
  ];
  return replacements.reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), sql);
}

function splitSqlTopLevelList(text: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  for (const char of text) {
    if (char === '(') depth += 1;
    if (char === ')') depth = Math.max(0, depth - 1);
    if (char === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function splitSqlTopLevelConditions(text: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  const words = text.split(' ');
  for (const word of words) {
    for (const char of word) {
      if (char === '(') depth += 1;
      if (char === ')') depth = Math.max(0, depth - 1);
    }
    if ((word === 'AND' || word === 'OR') && depth === 0 && current.trim()) {
      parts.push(current.trim());
      current = word;
      continue;
    }
    current = current ? `${current} ${word}` : word;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function formatSqlExpressionList(prefix: string, body: string): string[] {
  const items = splitSqlTopLevelList(body);
  if (items.length <= 1) return [prefix, `  ${body}`];
  return [
    prefix,
    ...items.map((item, index) => `  ${item}${index < items.length - 1 ? ',' : ''}`),
  ];
}

function formatSqlCondition(prefix: string, body: string): string[] {
  const parts = splitSqlTopLevelConditions(body);
  if (parts.length <= 1) return [`${prefix} ${body}`.trim()];
  return [
    prefix,
    ...parts.map((part) => `  ${part}`),
  ];
}

function formatSqlClauseLines(sql: string): string {
  const lines: string[] = [];
  for (const rawLine of sql.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    const selectMatch = line.match(/^SELECT\s+(.+)$/);
    if (selectMatch) {
      lines.push(...formatSqlExpressionList('SELECT', selectMatch[1]));
      continue;
    }

    const listMatch = line.match(/^(GROUP BY|ORDER BY)\s+(.+)$/);
    if (listMatch) {
      lines.push(...formatSqlExpressionList(listMatch[1], listMatch[2]));
      continue;
    }

    const conditionMatch = line.match(/^(WHERE|HAVING|ON)\s+(.+)$/);
    if (conditionMatch) {
      lines.push(...formatSqlCondition(conditionMatch[1], conditionMatch[2]));
      continue;
    }

    lines.push(line);
  }
  return lines.join('\n');
}

function indentSqlLines(sql: string): string {
  let depth = 0;
  return sql
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const trimmed = line.trimStart();
      const leadingCloseParens = trimmed.match(/^\)+/)?.[0].length ?? 0;
      const extraIndent = line.startsWith('  ') ? 1 : 0;
      const indentDepth = Math.max(0, depth - leadingCloseParens) + extraIndent;
      const formatted = `${'  '.repeat(indentDepth)}${trimmed}`;
      const opens = (trimmed.match(/\(/g) ?? []).length;
      const closes = (trimmed.match(/\)/g) ?? []).length;
      depth = Math.max(0, depth + opens - closes);
      return formatted;
    })
    .join('\n')
    .trim();
}

export function createWorkflowPage({ el, api, escapeHtml, formatFileSize, getProductFiles, refreshProductFiles, notify, confirmAction, getLanguage }: WorkflowPageDeps) {
  const filePicker = createFilePickerModal({
    el,
    api,
    escapeHtml,
    formatFileSize,
    getProductFiles,
    refreshProductFiles,
    notify,
    confirmAction,
    getLanguage,
  });

  function productFileDisplayName(file: ProductFileRecord) {
    return file.displayName || file.originalName;
  }

  const WORKFLOW_NODE_WIDTH = 300;
  const WORKFLOW_NODE_HEADER_BASE_HEIGHT = 64;
  const WORKFLOW_SLOT_ROW_MIN_HEIGHT = 34;
  const WORKFLOW_SLOT_LINE_HEIGHT = 13;
  const WORKFLOW_SLOT_COLUMN_GAP = 6;
  const WORKFLOW_CANVAS_PADDING = 48;
  const WORKFLOW_LAYOUT_COLUMN_GAP = 120;
  const WORKFLOW_LAYOUT_ROW_GAP = 56;
  const WORKFLOW_DRAG_THRESHOLD = 4;
  const WORKFLOW_PREVIEW_PAGE_SIZE = 20;
  const WORKFLOW_ZOOM_MIN = 0.5;
  const WORKFLOW_ZOOM_MAX = 1.5;
  const WORKFLOW_ZOOM_STEP = 0.1;
  const WORKFLOW_SIDEBAR_COLLAPSED_KEY = 'captable.workflow.sidebarCollapsed';
  const WORKFLOW_INSPECTOR_COLLAPSED_KEY = 'captable.workflow.inspectorCollapsed';
  const WORKFLOW_OPERATOR_GROUPS: Array<{ category: WorkflowOperator['category']; label: Record<AppLanguage, string> }> = [
    { category: 'Input', label: { 'zh-CN': '输入', 'en-US': 'Input' } },
    { category: 'Transform', label: { 'zh-CN': '计算', 'en-US': 'Transform' } },
    { category: 'Output', label: { 'zh-CN': '输出', 'en-US': 'Output' } },
    { category: 'Database', label: { 'zh-CN': '数据库', 'en-US': 'Database' } },
    { category: 'Validation', label: { 'zh-CN': '断言', 'en-US': 'Validation' } },
  ];
  type WorkflowRunState = {
    isOpen: boolean;
    isRunning: boolean;
    workflowId: number | null;
    runId: number | null;
    activeTaskId: string | null;
    taskStates: Record<string, WorkflowExecutionTaskState>;
    approvedWarningTaskIds: string[];
    waitingForApprovalTaskIds: string[];
    warningTaskIds: string[];
    warningMessages: Record<string, string>;
    taskMessages: Record<string, string>;
    message: string;
    errorMessage: string | null;
  };

  let workflowDefinitions: WorkflowDefinition[] = [];
  let workflowOperators: WorkflowOperator[] = [];
  let activeWorkflowId: number | null = null;
  let workflowSearchQuery = '';
  let editingWorkflowDescriptionId: number | null = null;
  let editingWorkflowDescriptionDraft = '';
  let activeWorkflowTaskId: string | null = null;
  let activeWorkflowPreview: WorkflowTaskPreviewResult | null = null;
  let workflowPreviewPage = 1;
  let activeWorkflowBindingPreview:
    | {
        dataFrame: WorkflowDataFrame;
        tableName: string;
        inputSlot: string;
        sourceTaskName: string;
      }
    | null = null;
  let workflowBindingPreviewPage = 1;
  let pendingWorkflowOperatorKey: string | null = null;
  let isWorkflowSidebarCollapsed = false;
  let isWorkflowInspectorCollapsed = false;
  let isWorkflowDependenciesCollapsed = false;
  let isWorkflowDependencyPickerOpen = false;
  let isWorkflowRuntimeParamsCollapsed = true;
  let activeWorkflowOperatorKey: string | null = null;
  let workflowCanvasZoom = 1;
  let isWorkflowPersisting = false;
  let workflowInputGuardAddSlot: string | null = null;
  let activeWorkflowEdgeGuards:
    | {
        taskId: string;
        slot: string;
      }
    | null = null;
  let pendingWorkflowConnectionSource: { taskId: string; slot: string } | null = null;
  let workflowRunState: WorkflowRunState = {
    isOpen: false,
    isRunning: false,
    workflowId: null,
    runId: null,
    activeTaskId: null,
    taskStates: {},
    approvedWarningTaskIds: [],
    waitingForApprovalTaskIds: [],
    warningTaskIds: [],
    warningMessages: {},
    taskMessages: {},
    message: '准备执行',
    errorMessage: null,
  };
  let workflowDragState:
    | {
        taskId: string;
        pointerId: number;
        startClientX: number;
        startClientY: number;
        startTaskX: number;
        startTaskY: number;
        moved: boolean;
      }
    | null = null;

  const handleWorkflowDragPointerMove = (event: PointerEvent) => {
    updateWorkflowDrag(event);
  };

  const handleWorkflowDragPointerUp = (event: PointerEvent) => {
    const dragTaskId = workflowDragState?.taskId ?? '';
    const moved = finishWorkflowDrag(event, dragTaskId);
    if (!dragTaskId) return;
    if (moved) {
      renderWorkflowEditor();
      return;
    }
    activeWorkflowTaskId = dragTaskId;
    activeWorkflowPreview = null;
    workflowPreviewPage = 1;
    renderWorkflowEditor();
    openWorkflowTaskModal();
  };

  const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

  function lang(): AppLanguage {
    return getLanguage?.() ?? 'zh-CN';
  }

  function localizeWorkflowDom() {
    const page = document.getElementById('page-workflow');
    if (page) applyStaticTranslations(page, lang());
  }

  function getWorkflowOperatorKey(operator: WorkflowOperator) {
    return `${operator.code}@${operator.version}`;
  }

  function getWorkflowOperatorByKey(operatorKey: string | null) {
    if (!operatorKey) return null;
    return workflowOperators.find((operator) => getWorkflowOperatorKey(operator) === operatorKey) ?? null;
  }

  function getWorkflowOperatorGroupLabel(category: WorkflowOperator['category']) {
    const label = WORKFLOW_OPERATOR_GROUPS.find((group) => group.category === category)?.label;
    return label ? label[lang()] : category;
  }

  function getGroupedWorkflowOperators() {
    return WORKFLOW_OPERATOR_GROUPS.map((group) => ({
      ...group,
      operators: workflowOperators.filter((operator) => operator.category === group.category),
    })).filter((group) => group.operators.length > 0);
  }

  async function init() {
    restoreWorkflowPanelState();
    el('btnCreateWorkflow').addEventListener('click', () => void createWorkflow());
    el('btnSaveWorkflow').addEventListener('click', () => void saveWorkflow());
    el('btnExportWorkflow').addEventListener('click', () => void exportWorkflow());
    el('btnDeleteWorkflow').addEventListener('click', () => void deleteWorkflow());
    el('btnImportWorkflow').addEventListener('click', () => {
      el<HTMLInputElement>('workflowImportInput').click();
    });
    el('workflowImportInput').addEventListener('change', (event) => {
      void importWorkflow(event);
    });
    el('workflowSearchInput').addEventListener('input', () => {
      workflowSearchQuery = el<HTMLInputElement>('workflowSearchInput').value.trim().toLowerCase();
      renderWorkflowList();
    });
    el('btnToggleWorkflowSidebar').addEventListener('click', toggleWorkflowSidebar);
    el('workflowCollapsedRail').addEventListener('click', toggleWorkflowSidebar);
    el('btnToggleWorkflowInspector').addEventListener('click', toggleWorkflowInspector);
    el('workflowInspectorCollapsedRail').addEventListener('click', toggleWorkflowInspector);
    el('btnAddWorkflowTask').addEventListener('click', addWorkflowTask);
    el('btnAutoLayoutWorkflow').addEventListener('click', autoLayoutActiveWorkflow);
    el('btnWorkflowZoomOut').addEventListener('click', () => setWorkflowCanvasZoom(workflowCanvasZoom - WORKFLOW_ZOOM_STEP));
    el('btnWorkflowZoomIn').addEventListener('click', () => setWorkflowCanvasZoom(workflowCanvasZoom + WORKFLOW_ZOOM_STEP));
    el('btnWorkflowZoomReset').addEventListener('click', fitWorkflowCanvas);
    el('btnExecuteWorkflow').addEventListener('click', () => void executeWorkflow());
    el('btnEditWorkflowDescription').addEventListener('click', () => {
      if (activeWorkflowId !== null) startWorkflowDescriptionEdit(activeWorkflowId);
    });
    el('workflowDescriptionInput').addEventListener('input', () => {
      editingWorkflowDescriptionDraft = el<HTMLTextAreaElement>('workflowDescriptionInput').value;
    });
    el('workflowDescriptionInput').addEventListener('blur', () => {
      if (activeWorkflowId !== null && editingWorkflowDescriptionId === activeWorkflowId) {
        commitWorkflowDescriptionEdit(activeWorkflowId);
      }
    });
    el('workflowDescriptionInput').addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cancelWorkflowDescriptionEdit();
        return;
      }
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        if (activeWorkflowId !== null) commitWorkflowDescriptionEdit(activeWorkflowId);
      }
    });
    el('btnToggleWorkflowRunPanel').addEventListener('click', toggleWorkflowRunPanel);
    el('workflowRunFooter').addEventListener('click', (event) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const button = target?.closest<HTMLButtonElement>('[data-continue-workflow-warning]');
      const skipButton = target?.closest<HTMLButtonElement>('[data-skip-workflow-warning]');
      const cancelButton = target?.closest<HTMLButtonElement>('[data-cancel-workflow-run]');
      if (!button && !skipButton && !cancelButton) return;
      event.preventDefault();
      if (cancelButton) {
        void cancelWorkflowRun();
        return;
      }
      void continueWorkflowAfterWarning(skipButton ? 'skipped' : 'approved');
    });
    el('btnConfirmWorkflowOperatorPicker').addEventListener('click', confirmAddWorkflowTask);
    el('btnCancelWorkflowOperatorPicker').addEventListener('click', closeWorkflowOperatorPickerModal);
    el('btnCloseWorkflowOperatorPickerModal').addEventListener('click', closeWorkflowOperatorPickerModal);
    el('workflowOperatorPickerModal').addEventListener('click', (event) => {
      if (event.target === el('workflowOperatorPickerModal')) closeWorkflowOperatorPickerModal();
    });
    el('workflowOperatorPickerSelect').addEventListener('change', () => {
      pendingWorkflowOperatorKey = el<HTMLSelectElement>('workflowOperatorPickerSelect').value;
      renderWorkflowOperatorPickerSummary();
    });
    el('btnRemoveWorkflowTask').addEventListener('click', removeWorkflowTask);
    el('btnRunWorkflowTaskStep').addEventListener('click', () => void runActiveWorkflowTaskStep());
    el('btnRetryWorkflowUnfinished').addEventListener('click', () => void retryUnfinishedWorkflowRun());
    el('btnDoneWorkflowTask').addEventListener('click', closeWorkflowTaskModal);
    el('btnCloseWorkflowTaskModal').addEventListener('click', closeWorkflowTaskModal);
    el('workflowTaskModal').addEventListener('click', (event) => {
      if (event.target === el('workflowTaskModal')) closeWorkflowTaskModal();
    });
    el('btnOpenWorkflowSqlFullscreen').addEventListener('click', openWorkflowSqlFullscreenModal);
    el('btnCloseWorkflowSqlFullscreen').addEventListener('click', closeWorkflowSqlFullscreenModal);
    el('btnCancelWorkflowSqlFullscreen').addEventListener('click', closeWorkflowSqlFullscreenModal);
    el('btnNormalizeWorkflowSql').addEventListener('click', normalizeWorkflowSqlInput);
    el('btnNormalizeWorkflowSqlFullscreen').addEventListener('click', normalizeWorkflowSqlFullscreenInput);
    el('btnApplyWorkflowSqlFullscreen').addEventListener('click', applyWorkflowSqlFullscreenModal);
    el('workflowSqlFullscreenModal').addEventListener('click', (event) => {
      if (event.target === el('workflowSqlFullscreenModal')) closeWorkflowSqlFullscreenModal();
    });
    el('workflowSqlFullscreenInput').addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeWorkflowSqlFullscreenModal();
        return;
      }
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        applyWorkflowSqlFullscreenModal();
      }
    });
    el('btnCloseWorkflowBindingPreviewModal').addEventListener('click', closeWorkflowBindingPreviewModal);
    el('workflowBindingPreviewModal').addEventListener('click', (event) => {
      if (event.target === el('workflowBindingPreviewModal')) closeWorkflowBindingPreviewModal();
    });
    el('btnCloseWorkflowEdgeGuardsModal').addEventListener('click', closeWorkflowEdgeGuardsModal);
    el('btnDoneWorkflowEdgeGuards').addEventListener('click', closeWorkflowEdgeGuardsModal);
    el('workflowEdgeGuardsModal').addEventListener('click', (event) => {
      if (event.target === el('workflowEdgeGuardsModal')) closeWorkflowEdgeGuardsModal();
    });
    el('btnCloseWorkflowOperatorDetailsModal').addEventListener('click', closeWorkflowOperatorDetailsModal);
    el('btnDoneWorkflowOperatorDetails').addEventListener('click', closeWorkflowOperatorDetailsModal);
    el('workflowOperatorDetailsModal').addEventListener('click', (event) => {
      if (event.target === el('workflowOperatorDetailsModal')) closeWorkflowOperatorDetailsModal();
    });
    el('btnEditWorkflowEdgeGuards').addEventListener('click', () => {
      if (!activeWorkflowEdgeGuards) return;
      activeWorkflowTaskId = activeWorkflowEdgeGuards.taskId;
      activeWorkflowPreview = null;
      workflowPreviewPage = 1;
      closeWorkflowEdgeGuardsModal();
      renderWorkflowEditor();
      openWorkflowTaskModal();
    });
    el('workflowPreviewTable').addEventListener('click', (event) => {
      const button = (event.target instanceof HTMLElement ? event.target : null)?.closest<HTMLButtonElement>(
        '[data-workflow-preview-page]',
      );
      if (!button) return;
      workflowPreviewPage = Number(button.dataset.workflowPreviewPage) || 1;
      renderWorkflowPreview();
    });
    el('workflowBindingPreviewTable').addEventListener('click', (event) => {
      const button = (event.target instanceof HTMLElement ? event.target : null)?.closest<HTMLButtonElement>(
        '[data-workflow-binding-preview-page]',
      );
      if (!button) return;
      workflowBindingPreviewPage = Number(button.dataset.workflowBindingPreviewPage) || 1;
      renderWorkflowBindingPreview();
    });
    el('btnPreviewWorkflowTask').addEventListener('click', () => void previewWorkflowTask());
    el('workflowPreviewFileId').addEventListener('change', syncStructuredTaskParamsToState);
    el('workflowPreviewFilePickTrigger').addEventListener('click', () => void openStructuredFilePicker());
    el('workflowPreviewSheetName').addEventListener('input', syncStructuredTaskParamsToState);
    el('workflowPreviewSheetSelect').addEventListener('change', syncStructuredTaskParamsToState);
    el('workflowPreviewRange').addEventListener('input', syncStructuredTaskParamsToState);
    el('workflowPreviewHeaderRow').addEventListener('input', syncStructuredTaskParamsToState);
    el('workflowSqlInput').addEventListener('input', syncStructuredTaskParamsToState);
    el('workflowPersistInputSource').addEventListener('change', syncStructuredTaskParamsToState);
    el('workflowPersistFileName').addEventListener('input', syncStructuredTaskParamsToState);
    el('workflowPersistSheetName').addEventListener('input', syncStructuredTaskParamsToState);
    el('workflowPersistUploadedBy').addEventListener('input', syncStructuredTaskParamsToState);
    el('workflowAssertInputSource').addEventListener('change', syncStructuredTaskParamsToState);
    el('workflowAssertOperator').addEventListener('change', syncStructuredTaskParamsToState);
    el('workflowAssertExpectedValue').addEventListener('input', syncStructuredTaskParamsToState);
    el('workflowAssertFailureStrategy').addEventListener('change', syncStructuredTaskParamsToState);
    el('workflowAssertFailureMessage').addEventListener('input', syncStructuredTaskParamsToState);
    el('workflowAssertSchemaMode').addEventListener('change', syncStructuredTaskParamsToState);
    el('workflowAssertSchemaColumns').addEventListener('input', syncStructuredTaskParamsToState);
    el('workflowShapeRowOperator').addEventListener('change', syncStructuredTaskParamsToState);
    el('workflowShapeExpectedRows').addEventListener('input', syncStructuredTaskParamsToState);
    el('workflowShapeColumnOperator').addEventListener('change', syncStructuredTaskParamsToState);
    el('workflowShapeExpectedColumns').addEventListener('input', syncStructuredTaskParamsToState);
    el('taskNameInput').addEventListener('input', syncTaskEditorToState);
    el('taskDescriptionInput').addEventListener('input', syncTaskEditorToState);
    el('taskParamsInput').addEventListener('input', syncTaskEditorToState);
    await loadWorkflowOperators();
    await loadWorkflows();
    renderWorkflowLayout();
  }

  function renderWorkflowLayout() {
    const layout = el('workflowPageLayout');
    const sidebarToggle = el('btnToggleWorkflowSidebar');
    const inspectorToggle = el('btnToggleWorkflowInspector');
    const workflowSidebar = el('workflowSidebar');
    const workflowRail = el('workflowCollapsedRail');
    const workflowInspector = el('workflowInspector');
    const workflowInspectorRail = el('workflowInspectorCollapsedRail');
    layout.classList.toggle('workflow-page--sidebar-collapsed', isWorkflowSidebarCollapsed);
    layout.classList.toggle('workflow-page--inspector-collapsed', isWorkflowInspectorCollapsed);
    workflowSidebar.classList.toggle('hidden', isWorkflowSidebarCollapsed);
    workflowRail.classList.toggle('hidden', !isWorkflowSidebarCollapsed);
    workflowInspector.classList.toggle('hidden', isWorkflowInspectorCollapsed);
    workflowInspectorRail.classList.toggle('hidden', !isWorkflowInspectorCollapsed);
    sidebarToggle.setAttribute('aria-expanded', String(!isWorkflowSidebarCollapsed));
    inspectorToggle.setAttribute('aria-expanded', String(!isWorkflowInspectorCollapsed));
    sidebarToggle.textContent = '«';
    inspectorToggle.textContent = '»';
    localizeWorkflowDom();
  }

  function setWorkflowCanvasZoom(nextZoom: number) {
    const clampedZoom = Math.min(WORKFLOW_ZOOM_MAX, Math.max(WORKFLOW_ZOOM_MIN, nextZoom));
    workflowCanvasZoom = Math.round(clampedZoom * 10) / 10;
    renderWorkflowEditor();
  }

  function getWorkflowCanvasSize(workflow: WorkflowDefinition) {
    const operatorsByTaskId = new Map(workflow.tasks.map((task) => [task.id, getWorkflowOperator(task)]));
    return {
      width: Math.max(
        960,
        ...workflow.tasks.map((task) => task.x + WORKFLOW_NODE_WIDTH + WORKFLOW_CANVAS_PADDING * 2),
      ),
      height: Math.max(
        620,
        ...workflow.tasks.map((task) => task.y + getWorkflowNodeHeight(task, operatorsByTaskId.get(task.id) ?? null) + WORKFLOW_CANVAS_PADDING * 2),
      ),
    };
  }

  function fitWorkflowCanvas() {
    const workflow = getActiveWorkflow();
    if (!workflow) {
      setWorkflowCanvasZoom(1);
      return;
    }

    const dag = el('workflowDag');
    const canvasSize = getWorkflowCanvasSize(workflow);
    const viewportWidth = Math.max(1, dag.clientWidth - WORKFLOW_CANVAS_PADDING * 2);
    const viewportHeight = Math.max(1, dag.clientHeight - WORKFLOW_CANVAS_PADDING * 2);
    const fitZoom = Math.min(viewportWidth / canvasSize.width, viewportHeight / canvasSize.height, 1);
    setWorkflowCanvasZoom(fitZoom);
    requestAnimationFrame(() => {
      dag.scrollLeft = 0;
      dag.scrollTop = 0;
    });
  }

  function renderWorkflowZoomControls() {
    el('workflowZoomValue').textContent = `${Math.round(workflowCanvasZoom * 100)}%`;
  }

  function readCachedBoolean(key: string, fallback: boolean) {
    try {
      const value = window.localStorage.getItem(key);
      if (value === 'true') return true;
      if (value === 'false') return false;
    } catch {
      return fallback;
    }
    return fallback;
  }

  function writeCachedBoolean(key: string, value: boolean) {
    try {
      window.localStorage.setItem(key, String(value));
    } catch {
      // Ignore storage failures; the live UI state should still update.
    }
  }

  function restoreWorkflowPanelState() {
    isWorkflowSidebarCollapsed = readCachedBoolean(WORKFLOW_SIDEBAR_COLLAPSED_KEY, isWorkflowSidebarCollapsed);
    isWorkflowInspectorCollapsed = readCachedBoolean(WORKFLOW_INSPECTOR_COLLAPSED_KEY, isWorkflowInspectorCollapsed);
  }

  function toggleWorkflowSidebar() {
    isWorkflowSidebarCollapsed = !isWorkflowSidebarCollapsed;
    writeCachedBoolean(WORKFLOW_SIDEBAR_COLLAPSED_KEY, isWorkflowSidebarCollapsed);
    renderWorkflowLayout();
  }

  function toggleWorkflowInspector() {
    isWorkflowInspectorCollapsed = !isWorkflowInspectorCollapsed;
    writeCachedBoolean(WORKFLOW_INSPECTOR_COLLAPSED_KEY, isWorkflowInspectorCollapsed);
    renderWorkflowLayout();
  }

  function toggleWorkflowRunPanel() {
    workflowRunState.isOpen = !workflowRunState.isOpen;
    renderWorkflowRunPanel();
  }

  function getActiveWorkflow(): WorkflowDefinition | null {
    return workflowDefinitions.find((item) => item.id === activeWorkflowId) ?? null;
  }

  function getActiveWorkflowTask(): WorkflowTask | null {
    const workflow = getActiveWorkflow();
    if (!workflow) return null;
    return workflow.tasks.find((item) => item.id === activeWorkflowTaskId) ?? null;
  }

  function resetWorkflowRunState(workflowId: number | null = activeWorkflowId) {
    workflowRunState = {
      isOpen: false,
      isRunning: false,
      workflowId,
      runId: null,
      activeTaskId: null,
      taskStates: {},
      approvedWarningTaskIds: [],
      waitingForApprovalTaskIds: [],
      warningTaskIds: [],
      warningMessages: {},
      taskMessages: {},
      message: 'Ready to run',
      errorMessage: null,
    };
  }

  async function loadWorkflowOperators() {
    const data = await api<{ operators: WorkflowOperator[] }>('/api/workflow/operators');
    workflowOperators = data.operators;
    el('workflowOperatorCount').textContent = String(workflowOperators.length);
    renderWorkflowOperators();
    renderWorkflowOperatorPickerOptions();
  }

  async function loadWorkflows(selectedId?: number) {
    const data = await api<{ items: WorkflowDefinition[] }>('/api/workflows');
    workflowDefinitions = data.items.map((workflow) => ({
      ...workflow,
      tasks: workflow.tasks.map((task) => {
        applyTaskOperatorDefaults(task);
        return task;
      }),
    }));
    if (selectedId !== undefined) {
      activeWorkflowId = selectedId;
    } else if (!workflowDefinitions.find((item) => item.id === activeWorkflowId)) {
      activeWorkflowId = workflowDefinitions[0]?.id ?? null;
    }
    activeWorkflowTaskId = null;
    if (!workflowDefinitions.find((item) => item.id === workflowRunState.workflowId)) {
      resetWorkflowRunState(activeWorkflowId);
    }
    applyAutoLayoutToWorkflow(getActiveWorkflow());
    renderWorkflowList();
    renderWorkflowEditor();
  }

  function normalizeWorkflowDefinitionForClient(workflow: WorkflowDefinition): WorkflowDefinition {
    return {
      ...workflow,
      tasks: workflow.tasks.map((task) => {
        applyTaskOperatorDefaults(task);
        return task;
      }),
    };
  }

  function upsertWorkflowDefinition(workflow: WorkflowDefinition) {
    const normalized = normalizeWorkflowDefinitionForClient(workflow);
    const existingIndex = workflowDefinitions.findIndex((item) => item.id === normalized.id);
    if (existingIndex >= 0) {
      workflowDefinitions.splice(existingIndex, 1, normalized);
    } else {
      workflowDefinitions.unshift(normalized);
    }
    activeWorkflowId = normalized.id;
  }

  async function persistWorkflowDefinition(workflow: WorkflowDefinition, options: { reload?: boolean } = {}) {
    if (isWorkflowPersisting) throw new Error('工作流配置正在保存，请稍候');
    isWorkflowPersisting = true;
    el<HTMLButtonElement>('btnSaveWorkflow').disabled = true;
    el<HTMLButtonElement>('btnExecuteWorkflow').disabled = true;
    try {
      const saved = await api<WorkflowDefinition>(`/api/workflows/${workflow.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          code: workflow.code,
          name: workflow.name,
          description: workflow.description,
          status: workflow.status,
          version: workflow.version,
          tasks: workflow.tasks,
          runtimeParamsSchema: workflow.runtimeParamsSchema,
          runtimeParamsDefaults: workflow.runtimeParamsDefaults,
          expectedUpdatedAt: workflow.updatedAt,
        }),
      });

      if (options.reload) {
        await loadWorkflows(saved.id);
        return workflowDefinitions.find((item) => item.id === saved.id) ?? normalizeWorkflowDefinitionForClient(saved);
      }

      upsertWorkflowDefinition(saved);
      renderWorkflowList();
      renderWorkflowEditor();
      return normalizeWorkflowDefinitionForClient(saved);
    } finally {
      isWorkflowPersisting = false;
      el<HTMLButtonElement>('btnSaveWorkflow').disabled = false;
      el<HTMLButtonElement>('btnExecuteWorkflow').disabled = false;
    }
  }

  function downloadJsonFile(fileName: string, payload: unknown) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function cloneJson<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
  }

  async function exportWorkflow(workflowId: number | null = activeWorkflowId) {
    const workflow = workflowDefinitions.find((item) => item.id === workflowId) ?? null;
    if (!workflow) {
      notify('请先选择一个工作流', { type: 'warning' });
      return;
    }
    const bundle = await api<WorkflowImportExportBundle>(`/api/workflows/${workflow.id}/export`);
    const safeName = (workflow.code || workflow.name || 'workflow').trim().replace(/[^a-zA-Z0-9-_]+/g, '-');
    downloadJsonFile(`${safeName || 'workflow'}.json`, bundle);
  }

  async function importWorkflow(event: Event) {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const bundle = JSON.parse(text) as WorkflowImportExportBundle;
      const created = await api<WorkflowDefinition>('/api/workflows/import', {
        method: 'POST',
        body: JSON.stringify(bundle),
      });
      resetWorkflowRunState(created.id);
      await loadWorkflows(created.id);
      if (created.code !== bundle.workflow.code) {
        notify(`工作流已导入，code 已调整为 ${created.code}`, { type: 'success' });
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : '导入工作流失败', { type: 'error' });
    } finally {
      if (input) input.value = '';
    }
  }

  function renderWorkflowList() {
    const container = el('workflowList');
    const workflows = getFilteredWorkflowDefinitions();
    if (!workflows.length) {
      container.innerHTML = '<div class="workflow-empty">暂无工作流</div>';
      localizeWorkflowDom();
      return;
    }
    container.innerHTML = workflows
      .map(
        (workflow) => `
        <div class="workflow-list__item ${workflow.id === activeWorkflowId ? 'is-active' : ''}" data-id="${workflow.id}">
          <div class="workflow-list__main" data-role="select" data-id="${workflow.id}" role="button" tabindex="0">
            <div class="workflow-list__title-row">
              <div class="workflow-list__name">${escapeHtml(workflow.name)}</div>
              <span class="workflow-version-badge">v${escapeHtml(workflow.version)}</span>
            </div>
            <div class="workflow-list__desc">${escapeHtml(workflow.description || '暂无描述')}</div>
            <div class="workflow-list__meta">${workflow.tasks.length} 个节点</div>
          </div>
          <div class="workflow-list__actions">
            <button class="btn btn-secondary btn-sm" data-role="export" data-id="${workflow.id}" type="button">导出</button>
            <button class="btn btn-secondary btn-sm" data-role="duplicate" data-id="${workflow.id}" type="button">复制</button>
          </div>
        </div>`,
      )
      .join('');

    container.querySelectorAll<HTMLElement>('[data-role="select"]').forEach((node) => {
      node.addEventListener('click', () => {
        activeWorkflowId = Number(node.dataset.id);
        activeWorkflowTaskId = null;
        activeWorkflowPreview = null;
        workflowPreviewPage = 1;
        renderWorkflowList();
        renderWorkflowEditor();
      });
      node.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        activeWorkflowId = Number(node.dataset.id);
        activeWorkflowTaskId = null;
        activeWorkflowPreview = null;
        workflowPreviewPage = 1;
        renderWorkflowList();
        renderWorkflowEditor();
      });
    });
    container.querySelectorAll<HTMLElement>('[data-role="export"]').forEach((node) => {
      node.addEventListener('click', () => {
        void exportWorkflow(Number(node.dataset.id));
      });
    });
    container.querySelectorAll<HTMLElement>('[data-role="duplicate"]').forEach((node) => {
      node.addEventListener('click', () => {
        void duplicateWorkflow(Number(node.dataset.id));
      });
    });
    localizeWorkflowDom();
  }

  function getFilteredWorkflowDefinitions() {
    if (!workflowSearchQuery) return [...workflowDefinitions];
    return workflowDefinitions.filter((workflow) => {
      const searchableText = [
        workflow.name,
        workflow.code,
        workflow.description ?? '',
        ...workflow.tasks.map((task) => task.name),
        ...workflow.tasks.map((task) => task.id),
      ]
        .join(' ')
        .toLowerCase();
      return searchableText.includes(workflowSearchQuery);
    });
  }

  function startWorkflowDescriptionEdit(workflowId: number) {
    const workflow = workflowDefinitions.find((item) => item.id === workflowId);
    if (!workflow) return;
    activeWorkflowId = workflowId;
    editingWorkflowDescriptionId = workflowId;
    editingWorkflowDescriptionDraft = workflow.description ?? '';
    renderWorkflowList();
    renderWorkflowEditor();
    window.requestAnimationFrame(() => {
      const editor = el<HTMLTextAreaElement>('workflowDescriptionInput');
      editor?.focus();
      editor?.setSelectionRange(editor.value.length, editor.value.length);
    });
  }

  function commitWorkflowDescriptionEdit(workflowId: number) {
    const workflow = workflowDefinitions.find((item) => item.id === workflowId);
    if (!workflow) return;
    workflow.description = editingWorkflowDescriptionDraft.trim();
    editingWorkflowDescriptionId = null;
    editingWorkflowDescriptionDraft = '';
    renderWorkflowList();
    renderWorkflowEditor();
  }

  function cancelWorkflowDescriptionEdit() {
    editingWorkflowDescriptionId = null;
    editingWorkflowDescriptionDraft = '';
    renderWorkflowList();
    renderWorkflowEditor();
  }

  function openWorkflowTaskModal() {
    el('workflowTaskModal').classList.remove('hidden');
  }

  function closeWorkflowTaskModal() {
    el('workflowTaskModal').classList.add('hidden');
    closeWorkflowSqlFullscreenModal();
  }

  function openWorkflowSqlFullscreenModal() {
    const sqlInput = el<HTMLTextAreaElement>('workflowSqlInput');
    const fullscreenInput = el<HTMLTextAreaElement>('workflowSqlFullscreenInput');
    fullscreenInput.value = sqlInput.value;
    el('workflowSqlFullscreenModal').classList.remove('hidden');
    requestAnimationFrame(() => {
      fullscreenInput.focus();
      fullscreenInput.setSelectionRange(fullscreenInput.value.length, fullscreenInput.value.length);
    });
  }

  function closeWorkflowSqlFullscreenModal() {
    el('workflowSqlFullscreenModal').classList.add('hidden');
  }

  function normalizeWorkflowSqlInput() {
    const sqlInput = el<HTMLTextAreaElement>('workflowSqlInput');
    const normalized = normalizeWorkflowSqlText(sqlInput.value);
    if (normalized === sqlInput.value) return;
    sqlInput.value = normalized;
    syncStructuredTaskParamsToState();
  }

  function normalizeWorkflowSqlFullscreenInput() {
    const fullscreenInput = el<HTMLTextAreaElement>('workflowSqlFullscreenInput');
    fullscreenInput.value = normalizeWorkflowSqlText(fullscreenInput.value);
    fullscreenInput.focus();
  }

  function applyWorkflowSqlFullscreenModal() {
    const sqlInput = el<HTMLTextAreaElement>('workflowSqlInput');
    sqlInput.value = el<HTMLTextAreaElement>('workflowSqlFullscreenInput').value;
    syncStructuredTaskParamsToState();
    closeWorkflowSqlFullscreenModal();
  }

  function openWorkflowBindingPreviewModal() {
    el('workflowBindingPreviewModal').classList.remove('hidden');
  }

  function closeWorkflowBindingPreviewModal() {
    el('workflowBindingPreviewModal').classList.add('hidden');
  }

  function openWorkflowEdgeGuardsModal(taskId: string, slot: string) {
    activeWorkflowEdgeGuards = { taskId, slot };
    renderWorkflowEdgeGuardsModal();
    el('workflowEdgeGuardsModal').classList.remove('hidden');
  }

  function closeWorkflowEdgeGuardsModal() {
    el('workflowEdgeGuardsModal').classList.add('hidden');
    activeWorkflowEdgeGuards = null;
  }

  function openWorkflowOperatorPickerModal() {
    if (!workflowOperators.length) {
      notify('暂无可用算子', { type: 'warning' });
      return;
    }
    if (!pendingWorkflowOperatorKey || !workflowOperators.some((item) => getWorkflowOperatorKey(item) === pendingWorkflowOperatorKey)) {
      pendingWorkflowOperatorKey = getWorkflowOperatorKey(workflowOperators[0]);
    }
    el<HTMLSelectElement>('workflowOperatorPickerSelect').value = pendingWorkflowOperatorKey;
    renderWorkflowOperatorPickerSummary();
    el('workflowOperatorPickerModal').classList.remove('hidden');
  }

  function closeWorkflowOperatorPickerModal() {
    el('workflowOperatorPickerModal').classList.add('hidden');
  }

  function openWorkflowOperatorDetailsModal(operatorKey: string) {
    activeWorkflowOperatorKey = operatorKey;
    renderWorkflowOperatorDetailsModal();
    el('workflowOperatorDetailsModal').classList.remove('hidden');
  }

  function closeWorkflowOperatorDetailsModal() {
    el('workflowOperatorDetailsModal').classList.add('hidden');
    activeWorkflowOperatorKey = null;
  }

  function renderWorkflowOperatorPickerOptions() {
    const select = el<HTMLSelectElement>('workflowOperatorPickerSelect');
    select.innerHTML = getGroupedWorkflowOperators()
      .map(
        (group) => `
          <optgroup label="${escapeHtml(group.label[lang()])}">
            ${group.operators
              .map(
                (operator) =>
                  `<option value="${escapeHtml(getWorkflowOperatorKey(operator))}">${escapeHtml(operator.name)} · ${escapeHtml(operator.code)}</option>`,
              )
              .join('')}
          </optgroup>`,
      )
      .join('');
    if (!pendingWorkflowOperatorKey && workflowOperators[0]) {
      pendingWorkflowOperatorKey = getWorkflowOperatorKey(workflowOperators[0]);
    }
    if (pendingWorkflowOperatorKey) {
      select.value = pendingWorkflowOperatorKey;
    }
    renderWorkflowOperatorPickerSummary();
  }

  function renderWorkflowOperatorPickerSummary() {
    const summary = el('workflowOperatorPickerSummary');
    const operatorKey = pendingWorkflowOperatorKey ?? el<HTMLSelectElement>('workflowOperatorPickerSelect').value;
    const operator = workflowOperators.find((item) => getWorkflowOperatorKey(item) === operatorKey);
    if (!operator) {
      summary.innerHTML = '<div class="workflow-empty" style="padding:0;">请选择一个算子</div>';
      return;
    }
    summary.innerHTML = `
      <strong>${escapeHtml(operator.name)}</strong>
      <div>${escapeHtml(operator.description || '暂无描述')}</div>
      <div style="margin-top:8px;">${escapeHtml(getWorkflowOperatorGroupLabel(operator.category))} · ${operator.inputSlots.length} 个输入 · ${operator.outputSlots.length} 个输出</div>
    `;
  }

  function getWorkflowOperator(task: WorkflowTask): WorkflowOperator | null {
    return workflowOperators.find((item) => item.code === task.operatorCode && item.version === task.operatorVersion) ?? null;
  }

  function getWorkflowFileLabel(fileId: number) {
    return getProductFiles().find((file) => file.id === fileId)?.originalName ?? `File #${fileId}`;
  }

  function getTaskParameterInputUsages(task: WorkflowTask) {
    const paramInputs = collectWorkflowTaskParamInputUsages(task);
    return { paramInputs };
  }

  function estimateWorkflowTextLines(value: unknown, charsPerLine: number) {
    const text = String(value ?? '').trim();
    if (!text) return 1;
    return Math.max(1, Math.ceil(text.length / charsPerLine));
  }

  function getWorkflowNodeBadge(operator: WorkflowOperator | null) {
    const category = operator?.category ?? 'Transform';
    const code =
      category === 'Input'
        ? 'input'
        : category === 'Output'
          ? 'output'
          : category === 'Validation'
            ? 'validation'
            : 'transform';
    return {
      code,
      label: operator?.code ?? 'unknown.operator',
      title: operator ? `${operator.name} · ${operator.code}` : 'Unknown operator',
    };
  }

  function getWorkflowNodeSlotRows(task: WorkflowTask, operator?: WorkflowOperator | null) {
    const { paramInputs } = getTaskParameterInputUsages(task);
    const inputSlots = getTaskInputSlots(task, operator).map((slot) => {
      const binding = task.inputs?.[slot];
      return {
        name: slot,
        binding: binding?.from ? `${binding.from}.${binding.slot}` : 'Not connected',
      };
    });
    const paramRows = paramInputs.map((usage) => ({
      name: usage.paramPath,
      binding: usage.kind === 'runtime' ? usage.runtimePath : getWorkflowFileLabel(usage.fileId),
    }));
    const inputs = [...inputSlots, ...paramRows];
    const outputs = getTaskOutputSlots(task, operator).map((slot) => ({ name: slot, binding: '' }));
    return {
      inputs,
      outputs,
      rowCount: Math.max(inputs.length, outputs.length, 1),
    };
  }

  function estimateWorkflowSlotHeight(row: { name: string; binding: string }) {
    const nameLines = estimateWorkflowTextLines(row.name, 20);
    const bindingLines = row.binding ? estimateWorkflowTextLines(row.binding, 18) : 0;
    const contentLines = nameLines + bindingLines;
    return Math.max(WORKFLOW_SLOT_ROW_MIN_HEIGHT, contentLines * WORKFLOW_SLOT_LINE_HEIGHT + 10);
  }

  function getWorkflowNodeHeight(task: WorkflowTask, operator?: WorkflowOperator | null) {
    const { inputs, outputs, rowCount } = getWorkflowNodeSlotRows(task, operator);
    const taskNameHeight = estimateWorkflowTextLines(task.name, 24) * 16;
    const metaHeight = estimateWorkflowTextLines(task.id, 42) * 12;
    const slotHeight = Array.from({ length: rowCount }).reduce<number>((sum, _, index) => {
      const inputHeight = inputs[index] ? estimateWorkflowSlotHeight(inputs[index]) : WORKFLOW_SLOT_ROW_MIN_HEIGHT;
      const outputHeight = outputs[index] ? estimateWorkflowSlotHeight(outputs[index]) : WORKFLOW_SLOT_ROW_MIN_HEIGHT;
      return sum + Math.max(inputHeight, outputHeight);
    }, 0);
    const slotGaps = Math.max(0, rowCount - 1) * WORKFLOW_SLOT_COLUMN_GAP;
    return WORKFLOW_NODE_HEADER_BASE_HEIGHT + taskNameHeight + metaHeight + slotHeight + slotGaps;
  }

  function getNestedValueAtPath(source: Record<string, unknown>, path: string): unknown {
    return path
      .split('.')
      .map((segment) => segment.trim())
      .filter(Boolean)
      .reduce<unknown>((current, segment) => {
        if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
        return (current as Record<string, unknown>)[segment];
      }, source);
  }

  function setNestedValueAtPath(source: Record<string, unknown>, path: string, value: unknown) {
    const segments = path
      .split('.')
      .map((segment) => segment.trim())
      .filter(Boolean);
    if (!segments.length) return;
    let current: Record<string, unknown> = source;
    segments.slice(0, -1).forEach((segment) => {
      const existing = current[segment];
      if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
        current[segment] = {};
      }
      current = current[segment] as Record<string, unknown>;
    });
    current[segments[segments.length - 1] as string] = value;
  }

  function flattenWorkflowRuntimeSchema(
    schema: WorkflowDefinition['runtimeParamsSchema'],
    parentPath = '',
  ): RuntimeParameterEntry[] {
    return Object.entries(schema ?? {}).flatMap(([key, field]) => {
      const nextPath = parentPath ? `${parentPath}.${key}` : key;
      if (field.type === 'object' && field.properties) {
        const nested = flattenWorkflowRuntimeSchema(field.properties, nextPath);
        if (!nextPath.startsWith('fileRefs.')) return nested;
        return [
          {
            path: nextPath,
            required: field.required === true,
            type: field.type,
            label: field.label ?? nextPath,
          },
          ...nested,
        ];
      }
      return [
        {
          path: nextPath,
          required: field.required === true,
          type: field.type,
          label: field.label ?? nextPath,
        },
      ];
    });
  }

  function formatRuntimeSummaryValue(value: unknown): string {
    if (value === undefined) return '未设置默认值';
    if (value === null) return 'null';
    if (typeof value === 'string') return value || '""';
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  function stringifyWorkflowJson(value: unknown): string {
    return JSON.stringify(value ?? {}, null, 2);
  }

  function runtimeProductFileId(value: unknown): number | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (record.provider !== 'product-files') return null;
    const fileKey = String(record.key ?? '').trim();
    if (fileKey) return getProductFiles().find((file) => (file.logicalPath ?? file.displayPath) === fileKey)?.id ?? null;
    const fileId = Number(record.id);
    return Number.isInteger(fileId) && fileId > 0 ? fileId : null;
  }

  function workflowRuntimeDefaultFileId(workflow: WorkflowDefinition, runtimePath: string): number | null {
    return runtimeProductFileId(getNestedValueAtPath(workflow.runtimeParamsDefaults as Record<string, unknown>, runtimePath));
  }

  function setWorkflowRuntimeDefaultFileId(workflow: WorkflowDefinition, runtimePath: string, fileId: number | null) {
    const defaults = cloneJson(workflow.runtimeParamsDefaults ?? {}) as Record<string, unknown>;
    const existing = getNestedValueAtPath(defaults, runtimePath);
    const existingRecord = existing && typeof existing === 'object' && !Array.isArray(existing)
      ? existing as Record<string, unknown>
      : {};
    const file = fileId ? getProductFiles().find((item) => item.id === fileId) : null;
    setNestedValueAtPath(defaults, runtimePath, file ? {
      ...existingRecord,
      provider: 'product-files',
      key: file.logicalPath ?? file.displayPath,
      id: undefined,
    } : undefined);
    workflow.runtimeParamsDefaults = defaults;
  }

  function workflowRuntimeDefaultString(workflow: WorkflowDefinition, runtimePath: string): string {
    const value = getNestedValueAtPath(workflow.runtimeParamsDefaults as Record<string, unknown>, runtimePath);
    return typeof value === 'string' ? value : '';
  }

  function setWorkflowRuntimeDefaultString(workflow: WorkflowDefinition, runtimePath: string, value: string) {
    const defaults = cloneJson(workflow.runtimeParamsDefaults ?? {}) as Record<string, unknown>;
    setNestedValueAtPath(defaults, runtimePath, value || undefined);
    workflow.runtimeParamsDefaults = defaults;
  }

  function readRuntimeDefaultControlValue(
    control: HTMLInputElement | HTMLSelectElement,
    currentValue: unknown,
  ): unknown {
    const type = control.dataset.runtimeDefaultType ?? '';
    const rawValue = control.value.trim();
    if (rawValue === '') return undefined;
    if (type === 'number') return Number(rawValue);
    if (type === 'boolean') return rawValue === 'true';
    if (type === 'fileRef') {
      const existing = currentValue && typeof currentValue === 'object' && !Array.isArray(currentValue)
        ? currentValue as Record<string, unknown>
        : {};
      const nextFileId = Number(rawValue);
      const file = getProductFiles().find((item) => item.id === nextFileId);
      const nextFileKey = file?.logicalPath ?? file?.displayPath;
      const sameFile = existing.key === nextFileKey && existing.provider === 'product-files';
      return {
        ...(sameFile ? existing : {}),
        provider: 'product-files',
        key: nextFileKey,
      };
    }
    return rawValue;
  }

  function syncRuntimeDefaultControlToWorkflow(
    workflow: WorkflowDefinition,
    control: HTMLInputElement | HTMLSelectElement,
  ): boolean {
    const path = control.dataset.runtimeDefaultPath ?? '';
    if (!path) return false;

    const defaults = cloneJson(workflow.runtimeParamsDefaults ?? {}) as Record<string, unknown>;
    const currentValue = getNestedValueAtPath(defaults, path);
    const value = readRuntimeDefaultControlValue(control, currentValue);
    setNestedValueAtPath(defaults, path, value);
    workflow.runtimeParamsDefaults = defaults;
    return true;
  }

  function syncVisibleRuntimeDefaultsToWorkflow(workflow: WorkflowDefinition): boolean {
    const container = el('workflowRuntimeParamsSummary');
    let changed = false;
    container.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-runtime-default-path]').forEach((control) => {
      changed = syncRuntimeDefaultControlToWorkflow(workflow, control) || changed;
    });
    if (changed) resetWorkflowRunState(workflow.id);
    return changed;
  }

  function formatRuntimeDefaultDisplay(entry: { path: string; type: string }, value: unknown): string {
    if (isRuntimeFileParameter(entry)) {
      const fileId = runtimeProductFileId(value);
      if (!fileId) return '未设置默认文件';
      const file = getProductFiles().find((item) => item.id === fileId);
      return file ? `${productFileDisplayName(file)} (#${fileId})` : `File #${fileId}`;
    }
    return formatRuntimeSummaryValue(value);
  }

  function getRuntimeParameterLabel(path: string): string {
    const workflow = getActiveWorkflow();
    if (!workflow) return path;
    return flattenWorkflowRuntimeSchema(workflow.runtimeParamsSchema).find((entry) => entry.path === path)?.label ?? path;
  }

  function formatRuntimeFileSelectionLabel(runtimePath: string): string {
    const label = getRuntimeParameterLabel(runtimePath);
    return label === runtimePath ? `Default file · ${runtimePath}` : `Default file · ${label}`;
  }

  function renderRuntimeDefaultEditor(entry: { path: string; type: string }, value: unknown) {
    const pathAttr = escapeHtml(entry.path);
    if (isRuntimeFileParameter(entry)) {
      const currentValue = runtimeProductFileId(value);
      const file = currentValue ? getProductFiles().find((item) => item.id === currentValue) : undefined;
      const label = file ? productFileDisplayName(file) : '未设置默认文件';
      const detail = file ? `${file.logicalPath ?? file.displayPath} · #${file.id}` : '点击选择文件';
      return `
        <div class="workflow-runtime-summary__filepick" data-file-pick>
          <input type="hidden" class="workflow-runtime-summary__control" value="${currentValue ?? ''}" data-runtime-default-path="${pathAttr}" data-runtime-default-type="fileRef">
          <button type="button" class="workflow-runtime-summary__filepick-trigger" data-file-pick-open title="${escapeHtml(detail)}">
            <span class="workflow-runtime-summary__filepick-name">${escapeHtml(label)}</span>
            <span class="workflow-runtime-summary__filepick-path">${escapeHtml(detail)}</span>
          </button>
        </div>`;
    }
    if (entry.type === 'number') {
      return `<input class="workflow-runtime-summary__control" type="number" value="${escapeHtml(value ?? '')}" data-runtime-default-path="${pathAttr}" data-runtime-default-type="number">`;
    }
    if (entry.type === 'boolean') {
      return `
        <select class="workflow-runtime-summary__control" data-runtime-default-path="${pathAttr}" data-runtime-default-type="boolean">
          <option value="">No default</option>
          <option value="true"${value === true ? ' selected' : ''}>true</option>
          <option value="false"${value === false ? ' selected' : ''}>false</option>
        </select>`;
    }
    return `<input class="workflow-runtime-summary__control" value="${escapeHtml(value ?? '')}" data-runtime-default-path="${pathAttr}" data-runtime-default-type="string">`;
  }

  function renderWorkflowRuntimeParameterItem(
    workflow: WorkflowDefinition,
    entry: RuntimeParameterEntry,
  ) {
    const rawDefaultValue = getNestedValueAtPath(workflow.runtimeParamsDefaults as Record<string, unknown>, entry.path);
    const defaultValue = formatRuntimeDefaultDisplay(entry, rawDefaultValue);
    return `
      <div class="workflow-runtime-summary__item">
        <div class="workflow-runtime-summary__item-top">
          <span class="workflow-runtime-summary__path">${escapeHtml(entry.path)}</span>
          <span class="workflow-runtime-summary__type">${escapeHtml(entry.type)}</span>
          ${entry.required ? '<span class="workflow-runtime-summary__required">required</span>' : ''}
        </div>
        <div class="workflow-runtime-summary__default">default: ${escapeHtml(defaultValue)}</div>
        ${renderRuntimeDefaultEditor(entry, rawDefaultValue)}
      </div>`;
  }

  function renderRuntimeSheetEditor(
    workflow: WorkflowDefinition,
    fileEntry: RuntimeParameterEntry,
    sheetEntry: RuntimeParameterEntry,
  ) {
    const fileId = workflowRuntimeDefaultFileId(workflow, fileEntry.path);
    const currentSheet = getNestedValueAtPath(workflow.runtimeParamsDefaults as Record<string, unknown>, sheetEntry.path);
    const currentSheetName = typeof currentSheet === 'string' ? currentSheet : '';
    const options = fileId
      ? `<option value="${escapeHtml(currentSheetName)}">Loading sheets...</option>`
      : '<option value="">Select a file first</option>';
    return `
      <label class="workflow-runtime-summary__linked-field">
        <span>${escapeHtml(sheetEntry.label)}</span>
        <select
          class="workflow-runtime-summary__control"
          data-runtime-default-path="${escapeHtml(sheetEntry.path)}"
          data-runtime-default-type="string"
          data-runtime-sheet-file-path="${escapeHtml(fileEntry.path)}"
          ${fileId ? '' : 'disabled'}
        >${options}</select>
      </label>`;
  }

  function renderWorkflowRuntimeInputFileItem(workflow: WorkflowDefinition, item: RuntimeInputFileItem) {
    const fileDefault = getNestedValueAtPath(workflow.runtimeParamsDefaults as Record<string, unknown>, item.file.path);
    return `
      <div class="workflow-runtime-summary__item workflow-runtime-summary__item--input-source">
        <div class="workflow-runtime-summary__item-top">
          <span class="workflow-runtime-summary__path">${escapeHtml(item.file.label)}</span>
          <span class="workflow-runtime-summary__type">${item.sheet ? 'file + sheet' : 'file'}</span>
          ${item.file.required || item.sheet?.required ? '<span class="workflow-runtime-summary__required">required</span>' : ''}
        </div>
        <div class="workflow-runtime-summary__technical-path">
          ${escapeHtml(item.file.path)}${item.sheet ? ` · ${escapeHtml(item.sheet.path)}` : ''}
        </div>
        <label class="workflow-runtime-summary__linked-field">
          <span>Workbook</span>
          ${renderRuntimeDefaultEditor(item.file, fileDefault)}
        </label>
        ${item.sheet ? renderRuntimeSheetEditor(workflow, item.file, item.sheet) : ''}
      </div>`;
  }

  function renderWorkflowRuntimeParameterGroup(
    title: string,
    description: string,
    entries: Array<{ path: string; required: boolean; type: string; label: string }>,
    workflow: WorkflowDefinition,
  ) {
    if (!entries.length) return '';
    return `
      <section class="workflow-runtime-summary__group">
        <div class="workflow-runtime-summary__group-header">
          <div>
            <div class="workflow-runtime-summary__group-title">${escapeHtml(title)}</div>
            <div class="workflow-runtime-summary__group-description">${escapeHtml(description)}</div>
          </div>
          <span class="workflow-runtime-summary__group-count">${entries.length}</span>
        </div>
        <div class="workflow-runtime-summary__list">
          ${entries.map((entry) => renderWorkflowRuntimeParameterItem(workflow, entry)).join('')}
        </div>
      </section>`;
  }

  function renderWorkflowRuntimeInputFilesGroup(items: RuntimeInputFileItem[], workflow: WorkflowDefinition) {
    if (!items.length) return '';
    return `
      <section class="workflow-runtime-summary__group">
        <div class="workflow-runtime-summary__group-header">
          <div>
            <div class="workflow-runtime-summary__group-title">Input Sources 输入源</div>
            <div class="workflow-runtime-summary__group-description">Each workbook is configured together with its related Sheet when required.</div>
          </div>
          <span class="workflow-runtime-summary__group-count">${items.length}</span>
        </div>
        <div class="workflow-runtime-summary__list">
          ${items.map((item) => renderWorkflowRuntimeInputFileItem(workflow, item)).join('')}
        </div>
      </section>`;
  }

  async function hydrateRuntimeSheetControl(control: HTMLSelectElement, workflow: WorkflowDefinition) {
    const filePath = control.dataset.runtimeSheetFilePath ?? '';
    const sheetPath = control.dataset.runtimeDefaultPath ?? '';
    const fileId = workflowRuntimeDefaultFileId(workflow, filePath);
    if (!fileId || !sheetPath) return;
    try {
      const detail = await api<ProductFileDetail>(`/api/files/${fileId}`);
      if (!control.isConnected) return;
      const current = getNestedValueAtPath(workflow.runtimeParamsDefaults as Record<string, unknown>, sheetPath);
      const currentName = typeof current === 'string' ? current : '';
      control.innerHTML = [
        '<option value="">Select sheet</option>',
        ...detail.sheets.map((sheet) => `<option value="${escapeHtml(sheet.sheetName)}">${escapeHtml(sheet.sheetName)}</option>`),
      ].join('');
      control.value = detail.sheets.some((sheet) => sheet.sheetName === currentName) ? currentName : '';
      control.disabled = false;
    } catch {
      if (!control.isConnected) return;
      control.innerHTML = '<option value="">Unable to load sheets</option>';
      control.disabled = true;
    }
  }

  async function hydrateStructuredRuntimeSheetControl(task: WorkflowTask) {
    const workflow = getActiveWorkflow();
    if (!workflow || !isWorkflowRuntimeParameterReference(task.params.sheetName)) return;
    const sheetPath = task.params.sheetName.$fromRuntime;
    const filePath = getWorkflowFileParamRuntimePath(task.params.fileRef ?? task.params.fileId);
    const sheetSelect = el<HTMLSelectElement>('workflowPreviewSheetSelect');
    if (!filePath) {
      sheetSelect.innerHTML = '<option value="">Select a runtime file first</option>';
      sheetSelect.disabled = true;
      return;
    }

    const fileId = workflowRuntimeDefaultFileId(workflow, filePath);
    if (!fileId) {
      sheetSelect.innerHTML = '<option value="">Select a file first</option>';
      sheetSelect.disabled = true;
      return;
    }

    const currentSheet = workflowRuntimeDefaultString(workflow, sheetPath)
      || (typeof task.params.sheetName.$default === 'string' ? task.params.sheetName.$default : '');
    sheetSelect.innerHTML = `<option value="${escapeHtml(currentSheet)}">Loading sheets...</option>`;
    sheetSelect.disabled = true;
    try {
      const detail = await api<ProductFileDetail>(`/api/files/${fileId}`);
      if (!sheetSelect.isConnected || getActiveWorkflowTask()?.id !== task.id) return;
      sheetSelect.innerHTML = [
        '<option value="">Select sheet</option>',
        ...detail.sheets.map((sheet) => `<option value="${escapeHtml(sheet.sheetName)}">${escapeHtml(sheet.sheetName)}</option>`),
      ].join('');
      sheetSelect.value = detail.sheets.some((sheet) => sheet.sheetName === currentSheet) ? currentSheet : '';
      sheetSelect.disabled = false;
    } catch {
      if (!sheetSelect.isConnected) return;
      sheetSelect.innerHTML = '<option value="">Unable to load sheets</option>';
      sheetSelect.disabled = true;
    }
  }

  function syncRuntimeDefaultFromControl(control: HTMLInputElement | HTMLSelectElement) {
    const workflow = getActiveWorkflow();
    if (!workflow) return;
    if (!syncRuntimeDefaultControlToWorkflow(workflow, control)) return;
    resetWorkflowRunState(workflow.id);
    if (shouldRerenderRuntimeDefaultControl(control.dataset.runtimeDefaultType ?? '')) {
      renderWorkflowRuntimeParamsSummary(workflow);
    }
  }

  function applyRuntimeJsonFromTextareas() {
    const workflow = getActiveWorkflow();
    if (!workflow) return;
    try {
      const schema = JSON.parse(
        (document.querySelector('[data-workflow-runtime-json="schema"]') as HTMLTextAreaElement | null)?.value || '{}',
      ) as WorkflowDefinition['runtimeParamsSchema'];
      const defaults = JSON.parse(
        (document.querySelector('[data-workflow-runtime-json="defaults"]') as HTMLTextAreaElement | null)?.value || '{}',
      ) as WorkflowDefinition['runtimeParamsDefaults'];
      workflow.runtimeParamsSchema = schema;
      workflow.runtimeParamsDefaults = defaults;
      resetWorkflowRunState(workflow.id);
      renderWorkflowEditor();
      notify('Runtime parameters 已应用，点击 Save 后保存到工作流', { type: 'success' });
    } catch (error) {
      notify(`Runtime parameters JSON 格式错误：${(error as Error).message}`, { type: 'error' });
    }
  }

  function renderWorkflowRuntimeParamsSummary(workflow: WorkflowDefinition | null) {
    const container = el('workflowRuntimeParamsSummary');
    if (!workflow) {
      container.classList.add('hidden');
      container.innerHTML = '';
      return;
    }

    const entries = flattenWorkflowRuntimeSchema(workflow.runtimeParamsSchema);
    const fileEntries = entries.filter((entry) => isRuntimeInputFileParameter(entry));
    const constantEntries = entries.filter((entry) => !isRuntimeInputFileParameter(entry));
    const inputFileItems = buildRuntimeInputFileItems(fileEntries);
    const groupedEntriesHtml = [
      renderWorkflowRuntimeParameterGroup(
        'Constants 常量',
        'Workflow execution constants and fixed business values.',
        constantEntries,
        workflow,
      ),
      renderWorkflowRuntimeInputFilesGroup(inputFileItems, workflow),
    ].join('');

    container.classList.remove('hidden');
    container.classList.toggle('is-collapsed', isWorkflowRuntimeParamsCollapsed);
    container.innerHTML = `
      <div class="workflow-runtime-summary__header">
        <button
          class="workflow-runtime-summary__toggle"
          type="button"
          aria-expanded="${String(!isWorkflowRuntimeParamsCollapsed)}"
          data-workflow-runtime-toggle
        >
          <span class="workflow-runtime-summary__chevron" aria-hidden="true">▸</span>
          <span class="workflow-runtime-summary__title">运行时参数</span>
          <span class="workflow-runtime-summary__summary">${entries.length} 项参数</span>
        </button>
        <button class="btn btn-secondary btn-sm workflow-runtime-summary__apply" type="button" data-workflow-runtime-json-apply>应用 JSON</button>
      </div>
      <div class="workflow-runtime-summary__body">
        ${
          entries.length
            ? `<div class="workflow-runtime-summary__groups">${groupedEntriesHtml}</div>`
            : '<div class="workflow-runtime-summary__empty">暂无运行时参数配置</div>'
        }
        <details class="workflow-runtime-summary__raw">
          <summary>运行时参数 JSON</summary>
          <div class="workflow-runtime-summary__raw-grid">
            <label>
              <span>schema</span>
              <textarea class="workflow-runtime-summary__raw-textarea" spellcheck="false" data-workflow-runtime-json="schema">${escapeHtml(
                stringifyWorkflowJson(workflow.runtimeParamsSchema),
              )}</textarea>
            </label>
            <label>
              <span>defaults</span>
              <textarea class="workflow-runtime-summary__raw-textarea" spellcheck="false" data-workflow-runtime-json="defaults">${escapeHtml(
                stringifyWorkflowJson(workflow.runtimeParamsDefaults),
              )}</textarea>
            </label>
          </div>
        </details>
      </div>
    `;

    container.querySelector<HTMLElement>('[data-workflow-runtime-toggle]')?.addEventListener('click', () => {
      isWorkflowRuntimeParamsCollapsed = !isWorkflowRuntimeParamsCollapsed;
      renderWorkflowRuntimeParamsSummary(workflow);
    });

    container.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-runtime-default-path]').forEach((control) => {
      control.addEventListener('change', () => syncRuntimeDefaultFromControl(control));
      control.addEventListener('input', () => {
        if (control instanceof HTMLInputElement) syncRuntimeDefaultFromControl(control);
      });
    });
    container.querySelectorAll<HTMLSelectElement>('[data-runtime-sheet-file-path]').forEach((control) => {
      void hydrateRuntimeSheetControl(control, workflow);
    });
    container.querySelectorAll<HTMLElement>('[data-file-pick-open]').forEach((trigger) => {
      trigger.addEventListener('click', () => void openRuntimeFilePicker(trigger));
    });
    container.querySelector<HTMLElement>('[data-workflow-runtime-json-apply]')?.addEventListener('click', applyRuntimeJsonFromTextareas);
    localizeWorkflowDom();
  }

  /**
   * The picker only writes the file id into the hidden control and fires `change`, so the existing
   * sync → re-render → sheet hydration path stays the single source of truth.
   */
  async function openRuntimeFilePicker(trigger: HTMLElement) {
    const control = trigger.closest('[data-file-pick]')?.querySelector<HTMLInputElement>('input[data-runtime-default-type="fileRef"]');
    if (!control) return;
    const currentFileId = control.value ? Number(control.value) : null;
    const result = await filePicker.open({
      titleKey: 'defaultFileTitle',
      currentFileId,
      allowClear: true,
      uploadFolderPrefix: 'input',
    });
    if (!result) return;
    control.value = result.action === 'pick' ? String(result.fileId) : '';
    control.dispatchEvent(new Event('change', { bubbles: true }));
  }


  function getEdgePath(startX: number, startY: number, endX: number, endY: number) {
    const deltaX = Math.max((endX - startX) * 0.45, 48);
    return `M ${startX} ${startY} C ${startX + deltaX} ${startY}, ${endX - deltaX} ${endY}, ${endX} ${endY}`;
  }

  function cssEscape(value: string) {
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
      return CSS.escape(value);
    }
    return value.replace(/["\\]/g, '\\$&');
  }

  function findWorkflowHandle(
    root: ParentNode,
    role: 'source' | 'target',
    taskId: string,
    slot: string,
  ): HTMLElement | null {
    return root.querySelector<HTMLElement>(
      `[data-handle-role="${role}"][data-task-id="${cssEscape(taskId)}"][data-slot="${cssEscape(slot)}"]`,
    );
  }

  function renderWorkflowEdges(
    workflow: WorkflowDefinition,
    operatorsByTaskId: Map<string, WorkflowOperator | null>,
    dag: HTMLElement,
  ) {
    const canvas = dag.querySelector<HTMLElement>('.workflow-dag__canvas');
    const svg = dag.querySelector<SVGSVGElement>('.workflow-dag__edges');
    if (!canvas || !svg) return;

    const canvasRect = canvas.getBoundingClientRect();
    const dataEdges = workflow.tasks.flatMap((task) => {
      const operator = operatorsByTaskId.get(task.id) ?? null;
      const inputSlots = getTaskInputSlots(task, operator);
      return inputSlots
        .map((targetSlot) => {
          const input = task.inputs?.[targetSlot];
          if (!input?.from) return null;
          const sourceTask = workflow.tasks.find((candidate) => candidate.id === input.from);
          if (!sourceTask) return null;
          const sourceSlot = String(input.slot ?? 'output');
          const sourceHandle = findWorkflowHandle(canvas, 'source', sourceTask.id, sourceSlot);
          const targetHandle = findWorkflowHandle(canvas, 'target', task.id, targetSlot);
          if (!sourceHandle || !targetHandle) return null;
          const sourceRect = sourceHandle.getBoundingClientRect();
          const targetRect = targetHandle.getBoundingClientRect();
          const startX = (sourceRect.left + sourceRect.width / 2 - canvasRect.left) / workflowCanvasZoom;
          const startY = (sourceRect.top + sourceRect.height / 2 - canvasRect.top) / workflowCanvasZoom;
          const endX = (targetRect.left + targetRect.width / 2 - canvasRect.left) / workflowCanvasZoom;
          const endY = (targetRect.top + targetRect.height / 2 - canvasRect.top) / workflowCanvasZoom;
          return {
            id: `${sourceTask.id}:${sourceSlot}->${task.id}:${targetSlot}`,
            targetTaskId: task.id,
            targetSlot,
            guardCount: normalizeInputGuards(input.guards).length,
            path: getEdgePath(startX, startY, endX, endY),
            labelX: startX + (endX - startX) / 2,
            labelY: startY + (endY - startY) / 2 - 16,
            guardX: startX + (endX - startX) / 2,
            guardY: startY + (endY - startY) / 2,
          };
        })
        .filter((edge): edge is NonNullable<typeof edge> => Boolean(edge));
    });

    const dependencyEdges = workflow.tasks.flatMap((task) => {
      return getWorkflowControlDependencies(task)
        .map((dependencyTaskId) => {
          const dependencyTask = workflow.tasks.find((candidate) => candidate.id === dependencyTaskId);
          if (!dependencyTask) return null;
          const sourceNode = canvas.querySelector<HTMLElement>(`.workflow-node[data-task-id="${cssEscape(dependencyTask.id)}"]`);
          const targetNode = canvas.querySelector<HTMLElement>(`.workflow-node[data-task-id="${cssEscape(task.id)}"]`);
          if (!sourceNode || !targetNode) return null;
          const sourceRect = sourceNode.getBoundingClientRect();
          const targetRect = targetNode.getBoundingClientRect();
          const startX = (sourceRect.right - canvasRect.left) / workflowCanvasZoom;
          const startY = (sourceRect.top + sourceRect.height / 2 - canvasRect.top) / workflowCanvasZoom;
          const endX = (targetRect.left - canvasRect.left) / workflowCanvasZoom;
          const endY = (targetRect.top + targetRect.height / 2 - canvasRect.top) / workflowCanvasZoom;
          return {
            id: `${dependencyTask.id}->${task.id}:dependency`,
            labelX: startX + (endX - startX) / 2,
            labelY: startY + (endY - startY) / 2 - 10,
            path: getEdgePath(startX, startY, endX, endY),
          };
        })
        .filter((edge): edge is NonNullable<typeof edge> => Boolean(edge));
    });

    svg.innerHTML = dataEdges
      .map(
        (edge) => `
          <g class="workflow-edge" data-edge-target-task-id="${escapeHtml(edge.targetTaskId)}" data-edge-target-slot="${escapeHtml(edge.targetSlot)}">
            <path class="workflow-edge__path" d="${edge.path}"></path>
            <path class="workflow-edge__hitbox" d="${edge.path}"></path>
            <text class="workflow-edge__label" x="${edge.labelX}" y="${edge.labelY}">${escapeHtml(edge.targetSlot)}</text>
            ${
              edge.guardCount
                ? `<g class="workflow-edge__guard-badge" data-edge-guard-task-id="${escapeHtml(edge.targetTaskId)}" data-edge-guard-slot="${escapeHtml(edge.targetSlot)}" transform="translate(${edge.guardX}, ${edge.guardY})">
                    <rect x="${edge.guardCount > 9 ? -36 : -32}" y="-10" width="${edge.guardCount > 9 ? 72 : 64}" height="22" rx="11"></rect>
                    <text x="0" y="5">${edge.guardCount} checks</text>
                  </g>`
                : ''
            }
          </g>`,
      )
      .concat(
        dependencyEdges.map(
          (edge) => `
          <g class="workflow-edge workflow-edge--dependency" data-edge-dependency-id="${escapeHtml(edge.id)}">
            <path class="workflow-edge__path" d="${edge.path}"></path>
            <text class="workflow-edge__label" x="${edge.labelX}" y="${edge.labelY}">dep</text>
          </g>`,
        ),
      )
      .join('');
  }

  function clearPendingWorkflowConnection() {
    pendingWorkflowConnectionSource = null;
  }

  function clearWorkflowDragState() {
    document.removeEventListener('pointermove', handleWorkflowDragPointerMove);
    document.removeEventListener('pointerup', handleWorkflowDragPointerUp);
    document.removeEventListener('pointercancel', handleWorkflowDragPointerUp);
    workflowDragState = null;
  }

  function isWorkflowHandleSelected(taskId: string, slot: string) {
    return pendingWorkflowConnectionSource?.taskId === taskId && pendingWorkflowConnectionSource?.slot === slot;
  }

  function connectWorkflowTasks(sourceTaskId: string, sourceSlot: string, targetTaskId: string, targetSlot: string) {
    if (sourceTaskId === targetTaskId) return;
    const workflow = getActiveWorkflow();
    if (!workflow) return;
    const targetTask = workflow.tasks.find((task) => task.id === targetTaskId);
    if (!targetTask) return;
    targetTask.inputs[targetSlot] = getInputBindingWithGuards(targetTask.inputs[targetSlot], {
      from: sourceTaskId,
      slot: sourceSlot,
    });
    normalizeTaskDependencies(targetTask);
    activeWorkflowPreview = null;
    workflowPreviewPage = 1;
    clearPendingWorkflowConnection();
    renderWorkflowEditor();
  }

  function removeWorkflowConnection(targetTaskId: string, targetSlot: string) {
    const workflow = getActiveWorkflow();
    if (!workflow) return;
    const targetTask = workflow.tasks.find((task) => task.id === targetTaskId);
    if (!targetTask?.inputs[targetSlot]) return;
    delete targetTask.inputs[targetSlot];
    normalizeTaskDependencies(targetTask);
    if (isSqlComputeTask(targetTask)) {
      normalizeSqlTask(targetTask);
      targetTask.params.tableBindings = getSqlTableBindings(targetTask).filter((binding) => binding.inputSlot !== targetSlot || targetTask.inputs[targetSlot]);
    }
    activeWorkflowPreview = null;
    workflowPreviewPage = 1;
    renderWorkflowEditor();
  }

  function getWorkflowTaskMap(workflow: WorkflowDefinition) {
    return new Map(workflow.tasks.map((task) => [task.id, task]));
  }

  function getWorkflowDependencyIds(task: WorkflowTask) {
    const inputDependencies = Object.values(task.inputs ?? {})
      .map((input) => String(input?.from ?? '').trim())
      .filter(Boolean);
    const controlDependencies = Array.isArray(task.dependsOn)
      ? task.dependsOn.map((taskId) => String(taskId ?? '').trim()).filter(Boolean)
      : [];
    return Array.from(new Set([...inputDependencies, ...controlDependencies])).filter((taskId) => taskId !== task.id);
  }

  function getWorkflowControlDependencies(task: WorkflowTask) {
    const inputDependencies = new Set(
      Object.values(task.inputs ?? {})
        .map((input) => String(input?.from ?? '').trim())
        .filter(Boolean),
    );
    return (Array.isArray(task.dependsOn) ? task.dependsOn : [])
      .map((taskId) => String(taskId ?? '').trim())
      .filter((taskId) => taskId && taskId !== task.id && !inputDependencies.has(taskId));
  }

  function getWorkflowExecutionOrder(workflow: WorkflowDefinition): WorkflowTask[] {
    const taskMap = getWorkflowTaskMap(workflow);
    const inDegree = new Map<string, number>();
    const outgoing = new Map<string, string[]>();

    workflow.tasks.forEach((task) => {
      inDegree.set(task.id, 0);
      outgoing.set(task.id, []);
    });

    workflow.tasks.forEach((task) => {
      getWorkflowDependencyIds(task).forEach((from) => {
        if (!from || !taskMap.has(from) || from === task.id) return;
        outgoing.get(from)?.push(task.id);
        inDegree.set(task.id, (inDegree.get(task.id) ?? 0) + 1);
      });
    });

    const queue = workflow.tasks
      .filter((task) => (inDegree.get(task.id) ?? 0) === 0)
      .sort((left, right) => left.x - right.x || left.y - right.y || left.id.localeCompare(right.id))
      .map((task) => task.id);
    const ordered: WorkflowTask[] = [];
    const visited = new Set<string>();

    while (queue.length) {
      const taskId = queue.shift()!;
      if (visited.has(taskId)) continue;
      visited.add(taskId);
      const task = taskMap.get(taskId);
      if (task) ordered.push(task);
      for (const downstreamId of outgoing.get(taskId) ?? []) {
        inDegree.set(downstreamId, (inDegree.get(downstreamId) ?? 0) - 1);
        if ((inDegree.get(downstreamId) ?? 0) === 0) queue.push(downstreamId);
      }
    }

    workflow.tasks
      .filter((task) => !visited.has(task.id))
      .sort((left, right) => left.x - right.x || left.y - right.y || left.id.localeCompare(right.id))
      .forEach((task) => ordered.push(task));

    return ordered;
  }

  function getWorkflowRunTaskState(taskId: string): WorkflowExecutionTaskState | null {
    if (!activeWorkflowId || workflowRunState.workflowId !== activeWorkflowId || !workflowRunState.isOpen) return null;
    if (workflowRunState.activeTaskId === taskId) return 'running';
    return workflowRunState.taskStates[taskId] ?? 'pending';
  }

  function renderWorkflowRunPanel() {
    const panel = el('workflowRunPanel');
    const summary = el('workflowRunSummary');
    const progressBar = el('workflowRunProgressBar');
    const progressText = el('workflowRunProgressText');
    const taskList = el('workflowRunTaskList');
    const footer = el('workflowRunFooter');
    const toggleButton = el<HTMLButtonElement>('btnToggleWorkflowRunPanel');
    const headerTitle = panel.querySelector<HTMLHeadingElement>('.workflow-run-panel__header h3');
    const workflow = getActiveWorkflow();

    if (!workflow || !workflowRunState.isOpen || workflowRunState.workflowId !== workflow.id) {
      panel.classList.add('hidden');
      localizeWorkflowDom();
      return;
    }

    const orderedTasks = getWorkflowExecutionOrder(workflow);
    const total = orderedTasks.length;
    const completed = orderedTasks.filter((task) => workflowRunState.taskStates[task.id] === 'completed').length;
    const warnings = orderedTasks.filter((task) => workflowRunState.taskStates[task.id] === 'warning').length;
    const skipped = orderedTasks.filter((task) => workflowRunState.taskStates[task.id] === 'skipped').length;
    const reached = completed + warnings + skipped;
    const ratio = total ? Math.min(1, reached / total) : 0;
    const hasFailedTask = orderedTasks.some((task) => workflowRunState.taskStates[task.id] === 'failed');
    const hasWarningTask = orderedTasks.some((task) => workflowRunState.taskStates[task.id] === 'warning');
    const hasWaitingWarning = workflowRunState.waitingForApprovalTaskIds.length > 0;
    const executionStatus = hasFailedTask
      ? { code: 'failed', label: 'Failed' }
      : hasWaitingWarning
        ? { code: 'warning', label: 'Needs Review' }
        : workflowRunState.isRunning
          ? { code: 'running', label: 'Running' }
          : !workflowRunState.isRunning && reached === total && total > 0 && hasWarningTask
            ? { code: 'warning', label: 'Warning' }
            : !workflowRunState.isRunning && completed === total && total > 0
              ? { code: 'completed', label: 'Completed' }
              : { code: 'idle', label: 'Idle' };

    panel.classList.remove('hidden');
    panel.classList.toggle('is-running', workflowRunState.isRunning);
    panel.classList.toggle('is-finished', !workflowRunState.isRunning && reached > 0 && !hasFailedTask && !hasWaitingWarning);
    panel.classList.toggle('is-failed', hasFailedTask);
    panel.classList.toggle('is-warning', hasWarningTask);
    if (headerTitle) {
      headerTitle.innerHTML = `Execution <span class="workflow-run-panel__status workflow-run-panel__status--${executionStatus.code}">${escapeHtml(executionStatus.label)}</span>`;
    }
    summary.textContent = workflowRunState.message;
    toggleButton.textContent = workflowRunState.isRunning ? 'Collapse' : 'Hide';
    progressBar.style.width = `${ratio * 100}%`;
    progressText.textContent = hasWaitingWarning ? `${reached} / ${total} · review required` : `${reached} / ${total}`;
    taskList.innerHTML = orderedTasks
      .map((task, index) => {
        const state = getWorkflowRunTaskState(task.id) ?? 'pending';
        const isWaiting = workflowRunState.waitingForApprovalTaskIds.includes(task.id);
        const indicator =
          state === 'completed'
            ? '✓'
            : state === 'running'
              ? '…'
            : state === 'failed'
                ? '!'
                : state === 'warning'
                  ? '!'
                : state === 'blocked'
                  ? '·'
                : state === 'skipped'
                  ? '–'
                : String(index + 1).padStart(2, '0');
        const stateLabel =
          state === 'completed'
            ? 'Completed'
            : state === 'running'
              ? 'Running'
              : state === 'failed'
                ? 'Failed'
                : state === 'warning'
                  ? isWaiting
                    ? 'Needs Review'
                    : 'Warning'
                : state === 'blocked'
                  ? 'Blocked'
                : state === 'skipped'
                  ? 'Skipped'
                : 'Pending';
        const detailMessage = workflowRunState.taskMessages[task.id] ?? '';
        const meta = state === 'warning' ? (workflowRunState.warningMessages[task.id] ?? task.operatorCode) : (task.description || task.operatorCode);
        return `
          <div class="workflow-run-task workflow-run-task--${state}">
            <span class="workflow-run-task__indicator">${escapeHtml(indicator)}</span>
            <div class="workflow-run-task__body">
              <div class="workflow-run-task__topline">
                <div class="workflow-run-task__name">${escapeHtml(task.name)}</div>
                <span class="workflow-run-task__state workflow-run-task__state--${state}">${escapeHtml(stateLabel)}</span>
              </div>
              <div class="workflow-run-task__meta">${escapeHtml(meta)}</div>
              ${detailMessage ? `<div class="workflow-run-task__detail">${escapeHtml(detailMessage)}</div>` : ''}
            </div>
          </div>
        `;
      })
      .join('');

    if (workflowRunState.errorMessage) {
      footer.innerHTML = `
        <div class="workflow-run-panel__review">
          <span class="workflow-run-panel__error">${escapeHtml(workflowRunState.errorMessage)}</span>
        </div>
      `;
      localizeWorkflowDom();
      return;
    }
    if (!workflowRunState.isRunning && hasWaitingWarning) {
      const waitingNames = workflowRunState.waitingForApprovalTaskIds
        .map((taskId) => orderedTasks.find((task) => task.id === taskId)?.name ?? taskId)
        .join(', ');
      footer.innerHTML = `
        <div class="workflow-run-panel__review">
          <span class="workflow-run-panel__warning">Warning requires review: ${escapeHtml(waitingNames)}</span>
          <div class="workflow-run-panel__actions">
            <button class="btn btn-warning btn-sm" type="button" data-continue-workflow-warning>Continue</button>
            <button class="btn btn-secondary btn-sm" type="button" data-cancel-workflow-run>Cancel</button>
          </div>
        </div>
      `;
      localizeWorkflowDom();
      return;
    }
    if (workflowRunState.isRunning && workflowRunState.runId) {
      footer.innerHTML = `
        <div class="workflow-run-panel__review">
          <div class="workflow-run-panel__actions">
            <button class="btn btn-secondary btn-sm" type="button" data-cancel-workflow-run>Cancel</button>
          </div>
        </div>
      `;
      localizeWorkflowDom();
      return;
    }
    footer.innerHTML =
      !workflowRunState.isRunning && reached === total && total > 0
        ? hasWarningTask
          ? '<span class="workflow-run-panel__warning">Workflow completed with warnings.</span>'
          : '<span class="workflow-run-panel__success">Workflow execution completed.</span>'
        : '<span class="workflow-run-panel__hint">节点会按依赖顺序显示执行状态。</span>';
    localizeWorkflowDom();
  }

  function applyAutoLayoutToWorkflow(workflow: WorkflowDefinition | null) {
    if (!workflow || workflow.tasks.length <= 1) return false;
    const taskMap = getWorkflowTaskMap(workflow);
    const inDegree = new Map<string, number>();
    const outgoing = new Map<string, string[]>();
    const depth = new Map<string, number>();

    workflow.tasks.forEach((task) => {
      inDegree.set(task.id, 0);
      outgoing.set(task.id, []);
      depth.set(task.id, 0);
    });

    workflow.tasks.forEach((task) => {
      getWorkflowDependencyIds(task).forEach((from) => {
        if (!from || !taskMap.has(from) || from === task.id) return;
        outgoing.get(from)?.push(task.id);
        inDegree.set(task.id, (inDegree.get(task.id) ?? 0) + 1);
      });
    });

    const queue = workflow.tasks
      .filter((task) => (inDegree.get(task.id) ?? 0) === 0)
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((task) => task.id);
    const visited = new Set<string>();

    while (queue.length) {
      const taskId = queue.shift()!;
      visited.add(taskId);
      const currentDepth = depth.get(taskId) ?? 0;
      for (const downstreamId of outgoing.get(taskId) ?? []) {
        depth.set(downstreamId, Math.max(depth.get(downstreamId) ?? 0, currentDepth + 1));
        inDegree.set(downstreamId, (inDegree.get(downstreamId) ?? 0) - 1);
        if ((inDegree.get(downstreamId) ?? 0) === 0) {
          queue.push(downstreamId);
        }
      }
    }

    workflow.tasks.forEach((task) => {
      if (!visited.has(task.id)) {
        const fallbackDepth = getWorkflowDependencyIds(task).some((dependencyId) => taskMap.has(dependencyId)) ? 1 : 0;
        depth.set(task.id, Math.max(depth.get(task.id) ?? 0, fallbackDepth));
      }
    });

    const columns = new Map<number, WorkflowTask[]>();
    workflow.tasks.forEach((task) => {
      const column = depth.get(task.id) ?? 0;
      const items = columns.get(column) ?? [];
      items.push(task);
      columns.set(column, items);
    });

    Array.from(columns.entries())
      .sort((left, right) => left[0] - right[0])
      .forEach(([column, tasks]) => {
        tasks
          .sort((left, right) => left.y - right.y || left.x - right.x || left.id.localeCompare(right.id))
          .forEach((task, rowIndex) => {
            task.x = WORKFLOW_CANVAS_PADDING + column * (WORKFLOW_NODE_WIDTH + WORKFLOW_LAYOUT_COLUMN_GAP);
            task.y =
              WORKFLOW_CANVAS_PADDING +
              tasks
                .slice(0, rowIndex)
                .reduce(
                  (sum, current) =>
                    sum + getWorkflowNodeHeight(current, getWorkflowOperator(current)) + WORKFLOW_LAYOUT_ROW_GAP,
                  0,
                );
          });
      });

    return true;
  }

  function autoLayoutActiveWorkflow() {
    if (!applyAutoLayoutToWorkflow(getActiveWorkflow())) return;
    activeWorkflowPreview = null;
    workflowPreviewPage = 1;
    fitWorkflowCanvas();
  }

  function startWorkflowDrag(event: PointerEvent, taskId: string) {
    const workflow = getActiveWorkflow();
    if (!workflow) return;
    const task = workflow.tasks.find((item) => item.id === taskId);
    if (!task) return;
    workflowDragState = {
      taskId,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startTaskX: task.x,
      startTaskY: task.y,
      moved: false,
    };
    document.addEventListener('pointermove', handleWorkflowDragPointerMove);
    document.addEventListener('pointerup', handleWorkflowDragPointerUp);
    document.addEventListener('pointercancel', handleWorkflowDragPointerUp);
  }

  function updateWorkflowDrag(event: PointerEvent) {
    const workflow = getActiveWorkflow();
    if (!workflowDragState || !workflow || workflowDragState.pointerId !== event.pointerId) return;
    const task = workflow.tasks.find((item) => item.id === workflowDragState?.taskId);
    if (!task) return;
    const deltaX = event.clientX - workflowDragState.startClientX;
    const deltaY = event.clientY - workflowDragState.startClientY;
    if (!workflowDragState.moved && Math.hypot(deltaX, deltaY) >= WORKFLOW_DRAG_THRESHOLD) {
      workflowDragState.moved = true;
    }
    task.x = Math.max(WORKFLOW_CANVAS_PADDING / 2, Math.round(workflowDragState.startTaskX + deltaX / workflowCanvasZoom));
    task.y = Math.max(WORKFLOW_CANVAS_PADDING / 2, Math.round(workflowDragState.startTaskY + deltaY / workflowCanvasZoom));
    renderWorkflowEditor();
  }

  function finishWorkflowDrag(event: PointerEvent, taskId: string) {
    if (!workflowDragState || workflowDragState.pointerId !== event.pointerId || workflowDragState.taskId !== taskId) return false;
    const didMove = workflowDragState.moved;
    clearWorkflowDragState();
    return didMove;
  }

  function renderWorkflowEditor() {
    renderWorkflowZoomControls();
    const workflow = getActiveWorkflow();
    el<HTMLInputElement>('workflowNameInput').value = workflow?.name ?? '';
    const workflowVersionBadge = el('workflowVersionBadge');
    workflowVersionBadge.textContent = workflow ? `v${workflow.version}` : '';
    workflowVersionBadge.classList.toggle('hidden', !workflow);
    const descriptionText = el('workflowDescriptionText');
    const descriptionDisplayRow = el('workflowDescriptionDisplayRow');
    const descriptionInput = el<HTMLTextAreaElement>('workflowDescriptionInput');
    if (!workflow) {
      descriptionText.textContent = '暂无描述';
      descriptionDisplayRow.classList.remove('hidden');
      descriptionInput.classList.add('hidden');
      descriptionInput.value = '';
    } else if (editingWorkflowDescriptionId === workflow.id) {
      descriptionText.textContent = workflow.description || '暂无描述';
      descriptionDisplayRow.classList.add('hidden');
      descriptionInput.classList.remove('hidden');
      descriptionInput.value = editingWorkflowDescriptionDraft;
    } else {
      descriptionText.textContent = workflow.description || '暂无描述';
      descriptionDisplayRow.classList.remove('hidden');
      descriptionInput.classList.add('hidden');
      descriptionInput.value = workflow.description || '';
    }

    const dag = el('workflowDag');
    if (!workflow) {
      dag.innerHTML = '<div class="workflow-empty">请先创建或选择工作流</div>';
      renderWorkflowRuntimeParamsSummary(null);
      renderTaskEditor();
      localizeWorkflowDom();
      return;
    }
    renderWorkflowRuntimeParamsSummary(workflow);

    const operatorsByTaskId = new Map(workflow.tasks.map((task) => [task.id, getWorkflowOperator(task)]));
    const { width: canvasWidth, height: canvasHeight } = getWorkflowCanvasSize(workflow);

    dag.innerHTML = `
      <div class="workflow-dag__surface" style="width:${canvasWidth * workflowCanvasZoom}px;height:${canvasHeight * workflowCanvasZoom}px;">
        <div class="workflow-dag__canvas" style="width:${canvasWidth}px;height:${canvasHeight}px;transform:scale(${workflowCanvasZoom});">
          <svg class="workflow-dag__edges" width="${canvasWidth}" height="${canvasHeight}" viewBox="0 0 ${canvasWidth} ${canvasHeight}" aria-hidden="true"></svg>
          ${workflow.tasks
            .map((task) => {
              const operator = operatorsByTaskId.get(task.id) ?? null;
              const operatorBadge = getWorkflowNodeBadge(operator);
              const inputSlots = getTaskInputSlots(task, operator);
              const outputSlots = getTaskOutputSlots(task, operator);
              const { paramInputs } = getTaskParameterInputUsages(task);
              const renderedInputRows = inputSlots.length + paramInputs.length;
              const slotRows = Math.max(renderedInputRows, outputSlots.length, 1);
              const runState = getWorkflowRunTaskState(task.id);
              const controlDependencyCount = getWorkflowControlDependencies(task).length;
              const metaParts = [
                renderedInputRows ? `${renderedInputRows} inputs` : '',
                `${controlDependencyCount} deps`,
              ].filter(Boolean);
              return `
              <div
                class="workflow-node ${task.id === activeWorkflowTaskId ? 'is-active' : ''} ${runState ? `workflow-node--${runState}` : ''}"
                data-task-id="${escapeHtml(task.id)}"
                style="left:${task.x}px;top:${task.y}px;height:${getWorkflowNodeHeight(task, operator)}px;"
                tabindex="0"
                role="button"
                aria-label="${escapeHtml(task.name)}"
              >
                <div class="workflow-node__title">
                  <div class="workflow-node__id">${escapeHtml(task.name)}</div>
                  <span class="workflow-node__category workflow-node__category--${escapeHtml(operatorBadge.code)}" title="${escapeHtml(operatorBadge.title)}">${escapeHtml(operatorBadge.label)}</span>
                </div>
                <div class="workflow-node__meta">${escapeHtml(task.id)} · ${escapeHtml(metaParts.join(' · '))}</div>
                <div class="workflow-node__slots" style="--workflow-slot-count:${slotRows};">
                  <div class="workflow-node__slot-column workflow-node__slot-column--inputs">
                    ${inputSlots.length
                      ? inputSlots
                          .map((slot) => {
                            const binding = task.inputs?.[slot];
                            return `
                            <button
                              type="button"
                              class="workflow-handle workflow-handle--target"
                              data-handle-role="target"
                              data-task-id="${escapeHtml(task.id)}"
                              data-slot="${escapeHtml(slot)}"
                              title="${escapeHtml(binding?.from ? `${slot} <- ${binding.from}.${binding.slot}` : `Connect ${slot}`)}"
                            ></button>
                            <div class="workflow-node__slot workflow-node__slot--input">
                              <span class="workflow-node__slot-name">${escapeHtml(slot)}</span>
                              <span class="workflow-node__slot-binding">${escapeHtml(binding?.from ? `${binding.from}.${binding.slot}` : 'Not connected')}</span>
                            </div>`;
                          })
                          .join('')
                      : ''}
                    ${
                      paramInputs.length
                        ? paramInputs
                            .map(
                              (usage) => `
                              <div class="workflow-node__slot workflow-node__slot--parameter">
                                <span class="workflow-node__slot-name">${escapeHtml(usage.paramPath)}</span>
                                <span class="workflow-node__slot-binding">${escapeHtml(
                                  usage.kind === 'runtime' ? usage.runtimePath : getWorkflowFileLabel(usage.fileId),
                                )}</span>
                              </div>`,
                            )
                            .join('')
                        : ''
                    }
                    ${
                      !inputSlots.length && !paramInputs.length
                        ? '<div class="workflow-node__slot workflow-node__slot--empty">暂无输入</div>'
                        : ''
                    }
                  </div>
                  <div class="workflow-node__slot-column workflow-node__slot-column--outputs">
                    ${outputSlots
                      .map(
                        (slot) => `
                        <div class="workflow-node__slot workflow-node__slot--output">
                          <span class="workflow-node__slot-name">${escapeHtml(slot)}</span>
                        </div>
                        <button
                          type="button"
                          class="workflow-handle workflow-handle--source ${isWorkflowHandleSelected(task.id, slot) ? 'is-selected' : ''}"
                          data-handle-role="source"
                          data-task-id="${escapeHtml(task.id)}"
                          data-slot="${escapeHtml(slot)}"
                          title="${escapeHtml(`Connect from ${task.name}.${slot}`)}"
                        ></button>`,
                      )
                      .join('')}
                  </div>
                </div>
              </div>`;
            })
            .join('')}
        </div>
      </div>
    `;

    renderWorkflowEdges(workflow, operatorsByTaskId, dag);
    renderWorkflowRunPanel();

    dag.querySelectorAll<HTMLElement>('.workflow-node[data-task-id]').forEach((node) => {
      node.addEventListener('pointerdown', (event) => {
        if (!(event.target instanceof HTMLElement)) return;
        if (event.button !== 0) return;
        if (event.target.closest('.workflow-handle')) return;
        const taskId = node.dataset.taskId ?? '';
        if (!taskId) return;
        startWorkflowDrag(event, taskId);
      });
      node.addEventListener('click', (event) => {
        event.preventDefault();
        if (workflowDragState?.moved) return;
        const taskId = node.dataset.taskId ?? '';
        if (!taskId) return;
        activeWorkflowTaskId = taskId;
        activeWorkflowPreview = null;
        workflowPreviewPage = 1;
        renderWorkflowEditor();
        openWorkflowTaskModal();
      });
    });

    dag.querySelectorAll<HTMLElement>('[data-handle-role="source"]').forEach((handle) => {
      handle.addEventListener('click', (event) => {
        event.stopPropagation();
        const taskId = handle.dataset.taskId ?? '';
        const slot = handle.dataset.slot ?? '';
        if (!taskId || !slot) return;
        pendingWorkflowConnectionSource = isWorkflowHandleSelected(taskId, slot) ? null : { taskId, slot };
        renderWorkflowEditor();
      });
    });

    dag.querySelectorAll<HTMLElement>('[data-handle-role="target"]').forEach((handle) => {
      handle.addEventListener('click', (event) => {
        event.stopPropagation();
        const targetTaskId = handle.dataset.taskId ?? '';
        const targetSlot = handle.dataset.slot ?? '';
        if (!targetTaskId || !targetSlot) return;
        if (!pendingWorkflowConnectionSource) {
          removeWorkflowConnection(targetTaskId, targetSlot);
          return;
        }
        connectWorkflowTasks(
          pendingWorkflowConnectionSource.taskId,
          pendingWorkflowConnectionSource.slot,
          targetTaskId,
          targetSlot,
        );
      });
    });

    dag.querySelectorAll<HTMLElement>('[data-edge-target-task-id]').forEach((edge) => {
      edge.addEventListener('click', (event) => {
        if ((event.target instanceof Element ? event.target : null)?.closest('[data-edge-guard-task-id]')) return;
        event.stopPropagation();
        const targetTaskId = edge.dataset.edgeTargetTaskId ?? '';
        const targetSlot = edge.dataset.edgeTargetSlot ?? '';
        if (!targetTaskId || !targetSlot) return;
        removeWorkflowConnection(targetTaskId, targetSlot);
      });
    });

    dag.querySelectorAll<SVGElement>('[data-edge-guard-task-id]').forEach((badge) => {
      badge.addEventListener('click', (event) => {
        event.stopPropagation();
        const targetTaskId = badge.dataset.edgeGuardTaskId ?? '';
        const targetSlot = badge.dataset.edgeGuardSlot ?? '';
        if (!targetTaskId || !targetSlot) return;
        openWorkflowEdgeGuardsModal(targetTaskId, targetSlot);
      });
    });

    dag.onclick = (event) => {
      if (
        event.target === dag ||
        (event.target instanceof HTMLElement &&
          (event.target.classList.contains('workflow-dag__canvas') || event.target.classList.contains('workflow-dag__surface')))
      ) {
        clearPendingWorkflowConnection();
        renderWorkflowEditor();
      }
    };

    renderTaskEditor();
    localizeWorkflowDom();
  }

  function renderTaskEditor() {
    const editor = el('workflowTaskEditor');
    const task = getActiveWorkflowTask();
    const structured = el('workflowStructuredParams');
    const dependencies = el('workflowDependenciesPanel');
    const preview = el('workflowPreviewPanel');
    if (!task) {
      editor.classList.add('hidden');
      structured.classList.add('hidden');
      dependencies.classList.add('hidden');
      preview.classList.add('hidden');
      el<HTMLButtonElement>('btnRunWorkflowTaskStep').classList.add('hidden');
      el<HTMLButtonElement>('btnRetryWorkflowUnfinished').classList.add('hidden');
      closeWorkflowTaskModal();
      return;
    }
    editor.classList.remove('hidden');
    el<HTMLInputElement>('taskNameInput').value = task.name;
    el<HTMLTextAreaElement>('taskDescriptionInput').value = task.description ?? '';
    el<HTMLTextAreaElement>('taskParamsInput').value = JSON.stringify(task.params ?? {}, null, 2);
    const stepState = getWorkflowRunTaskState(task.id);
    const canRetryStep =
      Boolean(workflowRunState.runId) &&
      workflowRunState.workflowId === getActiveWorkflow()?.id &&
      !workflowRunState.isRunning &&
      (stepState === 'failed' || stepState === 'blocked' || stepState === 'skipped' || stepState === 'pending');
    const runStepButton = el<HTMLButtonElement>('btnRunWorkflowTaskStep');
    runStepButton.classList.toggle('hidden', !canRetryStep);
    runStepButton.textContent = stepState === 'pending' ? 'Run Step' : 'Retry Step';
    const retryUnfinishedButton = el<HTMLButtonElement>('btnRetryWorkflowUnfinished');
    retryUnfinishedButton.classList.toggle(
      'hidden',
      !workflowRunState.runId || workflowRunState.workflowId !== getActiveWorkflow()?.id || workflowRunState.isRunning,
    );
    renderStructuredTaskParams(task);
    dependencies.classList.remove('hidden');
    renderTaskDependencies(task);
    renderWorkflowPreview();
  }

  function getWorkflowTaskCandidates(taskId?: string): WorkflowTask[] {
    const workflow = getActiveWorkflow();
    if (!workflow) return [];
    return workflow.tasks.filter((task) => task.id !== taskId);
  }

  function getInputGuardOperators() {
    return workflowOperators.filter((operator) => operator.category === 'Validation') as Array<
      WorkflowOperator & { code: WorkflowInputGuardType }
    >;
  }

  function getInputGuardOperator(type: string) {
    return getInputGuardOperators().find((operator) => operator.code === type) ?? null;
  }

  function normalizeInputGuards(guards: unknown): WorkflowInputGuard[] {
    if (!Array.isArray(guards)) return [];
    return guards
      .map((guard, index) => {
        if (!guard || typeof guard !== 'object') return null;
        const record = guard as Partial<WorkflowInputGuard>;
        const operator = getInputGuardOperator(String(record.type ?? ''));
        if (!operator) return null;
        return {
          id: String(record.id ?? `guard_${index + 1}`).trim() || `guard_${index + 1}`,
          type: operator.code,
          name: String(record.name ?? operator.name).trim() || operator.name,
          enabled: record.enabled !== false,
          params: record.params && typeof record.params === 'object' && !Array.isArray(record.params) ? record.params : {},
        };
      })
      .filter((guard): guard is WorkflowInputGuard => Boolean(guard));
  }

  function getInputBindingWithGuards(input: WorkflowTaskInput | undefined, next: { from: string; slot?: string }): WorkflowTaskInput {
    const guards = normalizeInputGuards(input?.guards);
    return {
      from: next.from,
      slot: next.slot ?? 'dataframe',
      guards,
    };
  }

  function getInputGuardParamValue(guard: WorkflowInputGuard, key: string, operator: WorkflowOperator) {
    if (Object.prototype.hasOwnProperty.call(guard.params, key)) return guard.params[key];
    return operator.paramsSchema?.[key]?.default ?? '';
  }

  function renderInputGuardParamField(guard: WorkflowInputGuard, operator: WorkflowOperator, key: string) {
    const field = operator.paramsSchema[key];
    const value = getInputGuardParamValue(guard, key, operator);
    const label = escapeHtml(field.label ?? key);
    const commonAttrs = `data-input-guard-param-id="${escapeHtml(guard.id)}" data-input-guard-param-key="${escapeHtml(key)}"`;
    if (field.enum?.length) {
      return `
        <label class="workflow-input-guard__field">
          <span>${label}</span>
          <select class="search-input workflow-select" ${commonAttrs}>
            ${field.enum.map((item) => `<option value="${escapeHtml(item)}"${String(value) === item ? ' selected' : ''}>${escapeHtml(item)}</option>`).join('')}
          </select>
        </label>`;
    }
    if (field.type === 'number') {
      return `
        <label class="workflow-input-guard__field">
          <span>${label}</span>
          <input class="search-input workflow-input" type="number" ${commonAttrs} value="${escapeHtml(value)}">
        </label>`;
    }
    if (field.type === 'boolean') {
      return `
        <label class="workflow-input-guard__field workflow-input-guard__field--checkbox">
          <input type="checkbox" ${commonAttrs} ${value === true ? 'checked' : ''}>
          <span>${label}</span>
        </label>`;
    }
    const isLong = key === 'sql' || key === 'expectedColumns' || field.type === 'array';
    if (isLong) {
      return `
        <label class="workflow-input-guard__field workflow-input-guard__field--wide">
          <span>${label}</span>
          <textarea class="search-input workflow-textarea" rows="2" ${commonAttrs}>${escapeHtml(
            Array.isArray(value) ? value.join(', ') : value,
          )}</textarea>
        </label>`;
    }
    return `
      <label class="workflow-input-guard__field">
        <span>${label}</span>
        <input class="search-input workflow-input" ${commonAttrs} value="${escapeHtml(value)}" placeholder="${escapeHtml(field.placeholder ?? '')}">
      </label>`;
  }

  function renderWorkflowEdgeGuardsModal() {
    const workflow = getActiveWorkflow();
    const content = el('workflowEdgeGuardsContent');
    const title = el('workflowEdgeGuardsTitle');
    if (!workflow || !activeWorkflowEdgeGuards) {
      title.textContent = '输入检查';
      content.innerHTML = '<div class="workflow-dependency-empty">暂无输入检查</div>';
      return;
    }

    const task = workflow.tasks.find((item) => item.id === activeWorkflowEdgeGuards?.taskId);
    const input = task?.inputs?.[activeWorkflowEdgeGuards.slot];
    const guards = normalizeInputGuards(input?.guards);
    const sourceTask = input?.from ? workflow.tasks.find((item) => item.id === input.from) : null;
    title.textContent = sourceTask?.name ?? input?.from ?? '输入检查';
    content.innerHTML = `
      <div class="workflow-edge-guards">
        <div class="workflow-edge-guards__summary">
          <strong>${escapeHtml(activeWorkflowEdgeGuards.slot)}</strong>
          <span>${escapeHtml(input?.from ? `${input.from}.${input.slot}` : 'Not connected')}</span>
        </div>
        ${
          guards.length
            ? guards
                .map((guard) => {
                  const guardOperator = getInputGuardOperator(guard.type);
                  const params = Object.entries(guard.params ?? {});
                  return `
                    <article class="workflow-edge-guard-card">
                      <div class="workflow-edge-guard-card__header">
                        <div>
                          <strong>${escapeHtml(guard.name)}</strong>
                          <span>${escapeHtml(guardOperator?.name ?? guard.type)}</span>
                        </div>
                        <label class="workflow-edge-guard-card__toggle">
                          <input type="checkbox" data-edge-guard-toggle-id="${escapeHtml(guard.id)}" ${guard.enabled ? 'checked' : ''}>
                          <span>${guard.enabled ? 'Enabled' : 'Disabled'}</span>
                        </label>
                      </div>
                      ${
                        params.length
                          ? `<dl class="workflow-edge-guard-card__params">
                              ${params
                                .map(
                                  ([key, value]) => `
                                    <div>
                                      <dt>${escapeHtml(key)}</dt>
                                      <dd>${escapeHtml(Array.isArray(value) ? value.join(', ') : value)}</dd>
                                    </div>`,
                                )
                                .join('')}
                            </dl>`
                          : '<div class="workflow-dependency-empty">暂无参数</div>'
                      }
                    </article>`;
                })
                .join('')
              : '<div class="workflow-dependency-empty">当前输入暂无检查</div>'
        }
      </div>
    `;

    content.querySelectorAll<HTMLInputElement>('[data-edge-guard-toggle-id]').forEach((checkbox) => {
      checkbox.addEventListener('change', () => {
        if (!task) return;
        const guard = findInputGuard(task, checkbox.dataset.edgeGuardToggleId ?? '');
        if (!guard) return;
        guard.enabled = checkbox.checked;
        syncTaskParamsTextarea(task);
        renderWorkflowEditor();
        renderWorkflowEdgeGuardsModal();
      });
    });
  }

  function renderWorkflowInputGuards(task: WorkflowTask) {
    const row = el('workflowStructuredInputGuardsRow');
    const container = el('workflowInputGuardsEditor');
    const operator = getWorkflowOperator(task);
    const inputSlots = getTaskInputSlots(task, operator);
    const guardOperators = getInputGuardOperators();
    const slotsWithInputs = inputSlots.filter((slot) => task.inputs?.[slot]);

    if (!slotsWithInputs.length || !guardOperators.length) {
      row.classList.add('hidden');
      container.innerHTML = '';
      return;
    }

    row.classList.remove('hidden');
    container.innerHTML = `
      <div class="workflow-input-guards">
        <div class="workflow-structured__section-head">
          <div>
            <div class="workflow-structured__label">Input Checks</div>
            <div class="workflow-structured__section-subtitle">Assertions attached to data inputs. Failed checks can block or pause this node.</div>
          </div>
        </div>
        ${slotsWithInputs
          .map((slot) => {
            const input = task.inputs[slot];
            const guards = normalizeInputGuards(input.guards);
            return `
              <section class="workflow-input-guard-slot" data-input-guard-slot="${escapeHtml(slot)}">
                <div class="workflow-input-guard-slot__header">
                  <div>
                    <strong>${escapeHtml(slot)}</strong>
                    <span>${escapeHtml(input.from ? `${input.from}.${input.slot}` : 'Not connected')}</span>
                  </div>
                  <button class="workflow-icon-btn" type="button" data-add-input-guard-slot="${escapeHtml(slot)}" aria-label="Add check" title="Add check">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <line x1="12" y1="5" x2="12" y2="19"></line>
                      <line x1="5" y1="12" x2="19" y2="12"></line>
                    </svg>
                  </button>
                </div>
                ${
                  workflowInputGuardAddSlot === slot
                    ? `<div class="workflow-input-guard-picker">
                        ${guardOperators
                          .map(
                            (guardOperator) => `
                              <button class="workflow-dependency-option" type="button" data-create-input-guard-slot="${escapeHtml(slot)}" data-create-input-guard-type="${escapeHtml(guardOperator.code)}">
                                <span>${escapeHtml(guardOperator.name)}</span>
                                <small>${escapeHtml(guardOperator.description)}</small>
                              </button>`,
                          )
                          .join('')}
                      </div>`
                    : ''
                }
                <div class="workflow-input-guard-list">
                  ${
                    guards.length
                      ? guards
                          .map((guard) => {
                            const guardOperator = getInputGuardOperator(guard.type);
                            if (!guardOperator) return '';
                            return `
                              <article class="workflow-input-guard" data-input-guard-id="${escapeHtml(guard.id)}">
                                <div class="workflow-input-guard__header">
                                  <label class="workflow-input-guard__enabled">
                                    <input type="checkbox" data-toggle-input-guard-id="${escapeHtml(guard.id)}" ${guard.enabled ? 'checked' : ''}>
                                    <span>${escapeHtml(guard.name)}</span>
                                  </label>
                                  <span class="workflow-input-guard__type">${escapeHtml(guardOperator.name)}</span>
                                  <button class="workflow-icon-btn workflow-icon-btn--danger" type="button" data-remove-input-guard-id="${escapeHtml(guard.id)}" aria-label="Remove check">
                                    <svg viewBox="0 0 16 16" fill="none">
                                      <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                                    </svg>
                                  </button>
                                </div>
                                <div class="workflow-input-guard__params">
                                  ${Object.keys(guardOperator.paramsSchema ?? {})
                                    .map((key) => renderInputGuardParamField(guard, guardOperator, key))
                                    .join('')}
                                </div>
                              </article>`;
                          })
                          .join('')
                      : '<div class="workflow-dependency-empty">No checks on this input</div>'
                  }
                </div>
              </section>`;
          })
          .join('')}
      </div>
    `;

    container.querySelectorAll<HTMLButtonElement>('[data-add-input-guard-slot]').forEach((button) => {
      button.addEventListener('click', () => {
        workflowInputGuardAddSlot = workflowInputGuardAddSlot === button.dataset.addInputGuardSlot ? null : button.dataset.addInputGuardSlot ?? null;
        renderWorkflowInputGuards(task);
      });
    });
    container.querySelectorAll<HTMLButtonElement>('[data-create-input-guard-slot]').forEach((button) => {
      button.addEventListener('click', () => {
        const slot = button.dataset.createInputGuardSlot ?? '';
        const guardOperator = getInputGuardOperator(button.dataset.createInputGuardType ?? '');
        if (!slot || !guardOperator || !task.inputs[slot]) return;
        const guards = normalizeInputGuards(task.inputs[slot].guards);
        guards.push({
          id: `guard_${Date.now().toString(36)}`,
          type: guardOperator.code,
          name: guardOperator.name,
          enabled: true,
          params: buildDefaultTaskParams(guardOperator),
        });
        task.inputs[slot].guards = guards;
        workflowInputGuardAddSlot = null;
        syncTaskParamsTextarea(task);
        renderWorkflowEditor();
      });
    });
    container.querySelectorAll<HTMLInputElement>('[data-toggle-input-guard-id]').forEach((checkbox) => {
      checkbox.addEventListener('change', () => {
        const guard = findInputGuard(task, checkbox.dataset.toggleInputGuardId ?? '');
        if (!guard) return;
        guard.enabled = checkbox.checked;
        syncTaskParamsTextarea(task);
        renderWorkflowEditor();
      });
    });
    container.querySelectorAll<HTMLButtonElement>('[data-remove-input-guard-id]').forEach((button) => {
      button.addEventListener('click', () => {
        removeInputGuard(task, button.dataset.removeInputGuardId ?? '');
        syncTaskParamsTextarea(task);
        renderWorkflowEditor();
      });
    });
    container.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('[data-input-guard-param-id]').forEach((field) => {
      field.addEventListener('input', () => syncInputGuardParam(task, field));
      field.addEventListener('change', () => syncInputGuardParam(task, field));
    });
  }

  function findInputGuard(task: WorkflowTask, guardId: string): WorkflowInputGuard | null {
    for (const input of Object.values(task.inputs ?? {})) {
      input.guards = normalizeInputGuards(input.guards);
      const guard = input.guards.find((item) => item.id === guardId);
      if (guard) return guard;
    }
    return null;
  }

  function removeInputGuard(task: WorkflowTask, guardId: string) {
    for (const input of Object.values(task.inputs ?? {})) {
      input.guards = normalizeInputGuards(input.guards).filter((guard) => guard.id !== guardId);
    }
  }

  function syncInputGuardParam(
    task: WorkflowTask,
    field: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  ) {
    const guard = findInputGuard(task, field.dataset.inputGuardParamId ?? '');
    if (!guard) return;
    const key = field.dataset.inputGuardParamKey ?? '';
    if (!key) return;
    let value: unknown = field.value;
    const guardOperator = getInputGuardOperator(guard.type);
    const paramField = guardOperator?.paramsSchema?.[key];
    if (field instanceof HTMLInputElement && field.type === 'checkbox') {
      value = field.checked;
    } else if (paramField?.type === 'number') {
      const numeric = Number(field.value);
      value = Number.isFinite(numeric) ? numeric : field.value;
    } else if (paramField?.type === 'array') {
      value = field.value;
    }
    guard.params[key] = value;
    syncTaskParamsTextarea(task);
    activeWorkflowPreview = null;
    workflowPreviewPage = 1;
    renderWorkflowEdgesForActiveEditor();
  }

  function renderWorkflowEdgesForActiveEditor() {
    const workflow = getActiveWorkflow();
    const dag = el('workflowDag');
    if (!workflow) return;
    const operatorsByTaskId = new Map(workflow.tasks.map((item) => [item.id, getWorkflowOperator(item)]));
    renderWorkflowEdges(workflow, operatorsByTaskId, dag);
  }

  function getSqlInputSlots(task: WorkflowTask): string[] {
    return Object.keys(task.inputs ?? {});
  }

  function renderSqlTables(task: WorkflowTask) {
    const container = el('workflowSqlTables');
    normalizeSqlTask(task);
    const bindings = getSqlTableBindings(task);
    const candidates = getWorkflowTaskCandidates(task.id);

    container.innerHTML = `
      <div class="workflow-structured__section-head">
        <div class="workflow-structured__label">Tables</div>
        <button class="workflow-icon-btn" id="btnAddSqlTable" type="button" aria-label="Add table" title="Add table">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
        </button>
      </div>
      ${bindings
        .map(
          (binding, index) => `
          <div class="workflow-structured__grid workflow-structured__grid--sql-table" data-sql-table-row="${index}">
            <div>
              <label class="workflow-structured__label">Table Name</label>
              <input class="search-input workflow-input" data-sql-table-name="${index}" value="${escapeHtml(binding.tableName)}" placeholder="tablea">
            </div>
            <div>
              <label class="workflow-structured__label">Source Task</label>
              <select class="search-input workflow-select" data-sql-table-source="${index}">
                <option value="">Not set</option>
                ${candidates
                  .map((candidate) => {
                    const selected = task.inputs?.[binding.inputSlot]?.from === candidate.id ? 'selected' : '';
                    return `<option value="${escapeHtml(candidate.id)}" ${selected}>${escapeHtml(candidate.name)} · ${escapeHtml(candidate.id)}</option>`;
                  })
                  .join('')}
              </select>
            </div>
            <div class="workflow-structured__actions workflow-structured__actions--sql-table">
              <button class="workflow-icon-btn" type="button" data-preview-sql-table="${index}" aria-label="Preview table" title="Preview table">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <circle cx="11" cy="11" r="6"></circle>
                  <path d="M16 16l5 5"></path>
                </svg>
              </button>
              <button class="workflow-icon-btn workflow-icon-btn--danger" type="button" data-remove-sql-table="${index}" aria-label="Remove table" title="Remove table">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M3 6h18"></path>
                  <path d="M8 6V4h8v2"></path>
                  <path d="M19 6l-1 14H6L5 6"></path>
                  <path d="M10 11v6"></path>
                  <path d="M14 11v6"></path>
                </svg>
              </button>
            </div>
          </div>`,
        )
        .join('')}
    `;

    container.querySelectorAll<HTMLInputElement>('[data-sql-table-name]').forEach((input) => {
      input.addEventListener('input', syncStructuredTaskParamsToState);
    });
    container.querySelectorAll<HTMLSelectElement>('[data-sql-table-source]').forEach((select) => {
      select.addEventListener('change', syncStructuredTaskParamsToState);
    });
    container.querySelectorAll<HTMLElement>('[data-preview-sql-table]').forEach((button) => {
      button.addEventListener('click', () => {
        void previewSqlBinding(Number(button.dataset.previewSqlTable));
      });
    });
    container.querySelectorAll<HTMLElement>('[data-remove-sql-table]').forEach((button) => {
      button.addEventListener('click', () => {
        const activeTask = getActiveWorkflowTask();
        if (!activeTask) return;
        const index = Number(button.dataset.removeSqlTable);
        const nextBindings = getSqlTableBindings(activeTask).filter((_, itemIndex) => itemIndex !== index);
        activeTask.params.tableBindings = nextBindings;
        syncTaskParamsTextarea(activeTask);
        renderStructuredTaskParams(activeTask);
      });
    });
    el('btnAddSqlTable').addEventListener('click', () => {
      const activeTask = getActiveWorkflowTask();
      if (!activeTask) return;
      const nextBindings = getSqlTableBindings(activeTask);
      const defaultInputSlot = getSqlInputSlots(activeTask)[0] ?? nextSqlInputSlotName(activeTask);
      if (!activeTask.inputs[defaultInputSlot]) {
        activeTask.inputs[defaultInputSlot] = { from: '', slot: 'dataframe' };
      }
      nextBindings.push({ tableName: `table${String.fromCharCode(97 + nextBindings.length)}`, inputSlot: defaultInputSlot });
      activeTask.params.tableBindings = nextBindings;
      syncTaskParamsTextarea(activeTask);
      renderStructuredTaskParams(activeTask);
    });
  }

  function renderSheetSections(task: WorkflowTask) {
    const container = el('workflowSectionsEditor');
    normalizeSheetSectionsExtractTask(task);
    const sections = getSheetSections(task);

    container.innerHTML = `
      <div class="workflow-structured__section-head">
        <div class="workflow-structured__label">Sections</div>
        <button class="workflow-icon-btn" id="btnAddWorkflowSection" type="button" aria-label="Add section" title="Add section">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
        </button>
      </div>
      <div class="workflow-structured__section-subtitle">Use fixed ranges, anchor text, or Auto mode for title/header/blank-row section detection.</div>
      <div class="workflow-structured__grid">
        <div>
          <label class="workflow-structured__label">Mode</label>
          <select class="search-input workflow-input" id="workflowSectionMode">
            <option value="manual"${String(task.params.sectionMode ?? 'manual') === 'manual' ? ' selected' : ''}>Manual</option>
            <option value="auto"${String(task.params.sectionMode ?? 'manual') === 'auto' ? ' selected' : ''}>Auto detect sections</option>
          </select>
        </div>
        <div>
          <label class="workflow-structured__label">Split By Column</label>
          <input class="search-input workflow-input" id="workflowSectionSplitByColumn" value="${escapeHtml(task.params.splitByColumn ?? '')}" placeholder="Category for Grouping">
        </div>
      </div>
      ${sections
        .map(
          (section, index) => `
          <div class="workflow-structured__grid workflow-structured__grid--sections" data-sheet-section-row="${index}">
            <div>
              <label class="workflow-structured__label">Key</label>
              <input class="search-input workflow-input" data-sheet-section-key="${index}" value="${escapeHtml(section.key)}" placeholder="plan_2017">
            </div>
            <div>
              <label class="workflow-structured__label">Title</label>
              <input class="search-input workflow-input" data-sheet-section-title="${index}" value="${escapeHtml(section.title)}" placeholder="2017 Plan">
            </div>
            <div>
              <label class="workflow-structured__label">Range</label>
              <input class="search-input workflow-input" data-sheet-section-range="${index}" value="${escapeHtml(section.range)}" placeholder="B3:F20">
            </div>
            <div>
              <label class="workflow-structured__label">Anchor Text</label>
              <input class="search-input workflow-input" data-sheet-section-anchor-text="${index}" value="${escapeHtml(section.anchorText ?? '')}" placeholder="2017 Plan">
            </div>
            <div>
              <label class="workflow-structured__label">Columns</label>
              <input class="search-input workflow-input" data-sheet-section-range-columns="${index}" value="${escapeHtml(section.rangeColumns ?? '')}" placeholder="B:F">
            </div>
            <div>
              <label class="workflow-structured__label">Header Row</label>
              <input class="search-input workflow-input" data-sheet-section-header-row="${index}" type="number" min="1" value="${
                section.headerRow === null ? '' : escapeHtml(section.headerRow)
              }" placeholder="3">
            </div>
            <div>
              <label class="workflow-structured__label">Header Offset</label>
              <input class="search-input workflow-input" data-sheet-section-header-offset="${index}" type="number" value="${escapeHtml(section.headerRowOffset ?? '')}" placeholder="1">
            </div>
            <div>
              <label class="workflow-structured__label">Data Offset</label>
              <input class="search-input workflow-input" data-sheet-section-data-offset="${index}" type="number" value="${escapeHtml(section.dataStartRowOffset ?? '')}" placeholder="2">
            </div>
            <div>
              <label class="workflow-structured__label">Max Rows</label>
              <input class="search-input workflow-input" data-sheet-section-max-rows="${index}" type="number" min="1" value="${escapeHtml(section.maxRows ?? '')}" placeholder="blank row">
            </div>
            <div class="workflow-structured__actions">
              <button class="btn btn-secondary btn-sm" type="button" data-remove-sheet-section="${index}">Remove</button>
            </div>
          </div>`,
        )
        .join('')}
    `;

    el<HTMLSelectElement>('workflowSectionMode').addEventListener('change', syncStructuredTaskParamsToState);
    el<HTMLInputElement>('workflowSectionSplitByColumn').addEventListener('input', syncStructuredTaskParamsToState);
    container.querySelectorAll<HTMLInputElement>(
      '[data-sheet-section-key], [data-sheet-section-title], [data-sheet-section-range], [data-sheet-section-anchor-text], [data-sheet-section-range-columns], [data-sheet-section-header-row], [data-sheet-section-header-offset], [data-sheet-section-data-offset], [data-sheet-section-max-rows]',
    ).forEach((input) => {
      input.addEventListener('input', syncStructuredTaskParamsToState);
    });
    container.querySelectorAll<HTMLElement>('[data-remove-sheet-section]').forEach((button) => {
      button.addEventListener('click', () => {
        const activeTask = getActiveWorkflowTask();
        if (!activeTask) return;
        const index = Number(button.dataset.removeSheetSection);
        activeTask.params.sections = getSheetSections(activeTask).filter((_, itemIndex) => itemIndex !== index);
        normalizeSheetSectionsExtractTask(activeTask);
        syncTaskParamsTextarea(activeTask);
        renderStructuredTaskParams(activeTask);
      });
    });
    el('btnAddWorkflowSection').addEventListener('click', () => {
      const activeTask = getActiveWorkflowTask();
      if (!activeTask) return;
      const sections = getSheetSections(activeTask);
      const nextIndex = sections.length + 1;
      sections.push({
        key: `section_${nextIndex}`,
        title: `Section ${nextIndex}`,
        range: '',
        headerRow: null,
        anchorText: '',
        rangeColumns: '',
        headerRowOffset: null,
        dataStartRowOffset: null,
        maxRows: null,
      });
      activeTask.params.sections = sections;
      normalizeSheetSectionsExtractTask(activeTask);
      syncTaskParamsTextarea(activeTask);
      renderStructuredTaskParams(activeTask);
    });
  }

  function renderPersistExcelInput(task: WorkflowTask) {
    const select = el<HTMLSelectElement>('workflowPersistInputSource');
    const candidates = getWorkflowTaskCandidates(task.id);
    normalizePersistExcelTask(task);
    select.innerHTML = [
      '<option value="">Not set</option>',
      ...candidates.map(
        (candidate) =>
          `<option value="${escapeHtml(candidate.id)}"${task.inputs?.input1?.from === candidate.id ? ' selected' : ''}>${escapeHtml(candidate.name)} · ${escapeHtml(candidate.id)}</option>`,
      ),
    ].join('');
  }

  function renderAssertInput(task: WorkflowTask) {
    const select = el<HTMLSelectElement>('workflowAssertInputSource');
    const candidates = getWorkflowTaskCandidates(task.id);
    normalizeAssertTask(task);
    select.innerHTML = [
      '<option value="">Not set</option>',
      ...candidates.map(
        (candidate) =>
          `<option value="${escapeHtml(candidate.id)}"${task.inputs?.input1?.from === candidate.id ? ' selected' : ''}>${escapeHtml(candidate.name)} · ${escapeHtml(candidate.id)}</option>`,
      ),
    ].join('');
  }

  function renderTaskDependencies(task: WorkflowTask) {
    const container = el('workflowDependenciesEditor');
    normalizeTaskDependencies(task);
    const selectedIds = getWorkflowControlDependencies(task);
    const selected = new Set(selectedIds);
    const candidates = getWorkflowTaskCandidates(task.id).filter((candidate) => !selected.has(candidate.id));
    const workflow = getActiveWorkflow();
    const taskMap = workflow ? getWorkflowTaskMap(workflow) : new Map<string, WorkflowTask>();
    const selectedTasks = selectedIds.map((taskId) => taskMap.get(taskId)).filter((candidate): candidate is WorkflowTask => Boolean(candidate));
    const hasCandidates = candidates.length > 0;

    container.innerHTML = `
      <section class="workflow-dependency-card${isWorkflowDependenciesCollapsed ? ' is-collapsed' : ''}">
        <button class="workflow-dependency-card__header" id="btnToggleWorkflowDependencies" type="button" aria-expanded="${String(!isWorkflowDependenciesCollapsed)}">
          <span class="workflow-dependency-card__title">Execution Dependencies</span>
          <span class="workflow-dependency-card__summary">${selectedTasks.length} selected</span>
          <span class="workflow-dependency-card__chevron" aria-hidden="true">
            <svg viewBox="0 0 16 16" fill="none">
              <path d="M4 6L8 10L12 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </span>
        </button>
        ${
          isWorkflowDependenciesCollapsed
            ? ''
            : `<div class="workflow-dependency-card__body">
                <div class="workflow-dependency-selected-list">
                  ${
                    selectedTasks.length
                      ? selectedTasks
                          .map(
                            (dependency) => `
                              <div class="workflow-dependency-row" data-workflow-selected-dependency-id="${escapeHtml(dependency.id)}">
                                <div class="workflow-dependency-row__text">
                                  <strong>${escapeHtml(dependency.name)}</strong>
                                  <span>${escapeHtml(dependency.id)}</span>
                                </div>
                                <button class="workflow-icon-btn workflow-icon-btn--danger" data-remove-workflow-dependency-id="${escapeHtml(dependency.id)}" type="button" aria-label="Remove dependency">
                                  <svg viewBox="0 0 16 16" fill="none">
                                    <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                                  </svg>
                                </button>
                              </div>`,
                          )
                          .join('')
                      : '<div class="workflow-dependency-empty">暂无执行依赖</div>'
                  }
                </div>
                <div class="workflow-dependency-add">
                  <button class="btn btn-secondary btn-sm workflow-dependency-add__button" id="btnAddWorkflowDependency" type="button" ${hasCandidates ? '' : 'disabled'}>
                    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <path d="M8 3V13M3 8H13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                    </svg>
                    Add
                  </button>
                  ${
                    isWorkflowDependencyPickerOpen
                      ? `<div class="workflow-dependency-picker">
                          ${
                            hasCandidates
                              ? candidates
                                  .map(
                                    (candidate) => `
                                      <button class="workflow-dependency-option" data-add-workflow-dependency-id="${escapeHtml(candidate.id)}" type="button">
                                        <span>${escapeHtml(candidate.name)}</span>
                                        <small>${escapeHtml(candidate.id)}</small>
                                      </button>`,
                                  )
                                  .join('')
                              : '<div class="workflow-dependency-empty">没有更多可添加的候选节点</div>'
                          }
                        </div>`
                      : ''
                  }
                </div>
              </div>`
        }
      </section>
    `;

    container.querySelector<HTMLButtonElement>('#btnToggleWorkflowDependencies')?.addEventListener('click', () => {
      isWorkflowDependenciesCollapsed = !isWorkflowDependenciesCollapsed;
      isWorkflowDependencyPickerOpen = false;
      renderTaskDependencies(task);
    });

    container.querySelector<HTMLButtonElement>('#btnAddWorkflowDependency')?.addEventListener('click', () => {
      isWorkflowDependencyPickerOpen = !isWorkflowDependencyPickerOpen;
      renderTaskDependencies(task);
    });

    container.querySelectorAll<HTMLButtonElement>('[data-add-workflow-dependency-id]').forEach((button) => {
      button.addEventListener('click', () => {
        const dependencyId = button.dataset.addWorkflowDependencyId?.trim();
        if (!dependencyId) return;
        task.dependsOn = Array.from(new Set([...getWorkflowControlDependencies(task), dependencyId]));
        normalizeTaskDependencies(task);
        isWorkflowDependencyPickerOpen = false;
        activeWorkflowPreview = null;
        workflowPreviewPage = 1;
        syncTaskParamsTextarea(task);
        renderWorkflowEditor();
      });
    });

    container.querySelectorAll<HTMLButtonElement>('[data-remove-workflow-dependency-id]').forEach((button) => {
      button.addEventListener('click', () => {
        const dependencyId = button.dataset.removeWorkflowDependencyId?.trim();
        if (!dependencyId) return;
        task.dependsOn = getWorkflowControlDependencies(task).filter((taskId) => taskId !== dependencyId);
        normalizeTaskDependencies(task);
        isWorkflowDependencyPickerOpen = false;
        activeWorkflowPreview = null;
        workflowPreviewPage = 1;
        syncTaskParamsTextarea(task);
        renderWorkflowEditor();
      });
    });
  }

  function syncTaskParamsTextarea(task: WorkflowTask) {
    el<HTMLTextAreaElement>('taskParamsInput').value = JSON.stringify(task.params ?? {}, null, 2);
  }

  function getCustomParamKeys(task: WorkflowTask) {
    const keys = new Set<string>();

    if (isSheetRangeExtractTask(task)) {
      ['fileRef', 'fileId', 'sheetName', 'range', 'headerRow'].forEach((key) => keys.add(key));
    }

    if (isSheetSectionsExtractTask(task)) {
      ['fileRef', 'fileId', 'sheetName', 'sectionMode', 'sections', 'splitByColumn'].forEach((key) => keys.add(key));
    }

    if (isSqlTableBackedTask(task)) {
      ['sql', 'tableBindings'].forEach((key) => keys.add(key));
    }

    if (isPersistExcelTask(task)) {
      ['fileName', 'sheetName', 'uploadedBy'].forEach((key) => keys.add(key));
    }

    if (isAssertTask(task)) {
      ['operator', 'expectedValue', 'failureStrategy', 'failureMessage'].forEach((key) => keys.add(key));
    }

    if (isSqlAssertTask(task)) {
      ['sql', 'tableBindings', 'operator', 'expectedValue', 'failureStrategy', 'failureMessage'].forEach((key) => keys.add(key));
    }

    if (isSchemaAssertTask(task)) {
      ['mode', 'expectedColumns', 'failureStrategy', 'failureMessage'].forEach((key) => keys.add(key));
    }

    if (isShapeAssertTask(task)) {
      ['rowOperator', 'expectedRows', 'columnOperator', 'expectedColumns', 'failureStrategy', 'failureMessage'].forEach((key) => keys.add(key));
    }

    return keys;
  }

  function hasCustomStructuredParams(task: WorkflowTask) {
    return (
      isSheetRangeExtractTask(task) ||
      isSheetSectionsExtractTask(task) ||
      isSqlTableBackedTask(task) ||
      isPersistExcelTask(task) ||
      isAnyAssertTask(task)
    );
  }

  function renderStructuredTaskParams(task: WorkflowTask) {
    const structured = el('workflowStructuredParams');
    const operator = getWorkflowOperator(task);
    const customParamKeys = getCustomParamKeys(task);
    const hasInputSlots = getTaskInputSlots(task, operator).some((slot) => task.inputs?.[slot]);
    const genericParamsRow = el('workflowStructuredGenericParamsRow');
    const hasGenericParams = renderOperatorConfigForm({
      container: genericParamsRow,
      operator,
      task,
      excludedParamKeys: customParamKeys,
      escapeHtml,
      onChange: syncStructuredTaskParamsToState,
    });
    genericParamsRow.classList.toggle('hidden', !hasGenericParams);

    if (!hasCustomStructuredParams(task) && !hasGenericParams && !hasInputSlots) {
      structured.classList.add('hidden');
      return;
    }

    structured.classList.remove('hidden');

    const workflow = getActiveWorkflow();
    const fileSelect = el<HTMLSelectElement>('workflowPreviewFileId');
    const runtimeFilePath = getWorkflowFileParamRuntimePath(task.params.fileRef ?? task.params.fileId);
    const runtimeDefaultFileId = workflow && runtimeFilePath ? workflowRuntimeDefaultFileId(workflow, runtimeFilePath) : null;
    fileSelect.innerHTML = [
      `<option value="">${runtimeFilePath ? '未设置默认文件' : '请选择文件'}</option>`,
      ...getProductFiles().map((file) => `<option value="${file.id}">${escapeHtml(productFileDisplayName(file))}</option>`),
    ]
      .join('');
    fileSelect.dataset.runtimeDefaultPath = runtimeFilePath ?? '';
    fileSelect.dataset.fileParamMode = runtimeFilePath ? 'runtime-default' : 'direct';
    fileSelect.title = runtimeFilePath ? formatRuntimeFileSelectionLabel(runtimeFilePath) : '';

    const fileRow = el('workflowStructuredFileRow');
    fileRow.querySelector('label')!.textContent = runtimeFilePath ? 'Default file' : 'File Source';
    const sheetRow = el('workflowStructuredSheetRow');
    const rangeRow = el('workflowStructuredRangeRow');
    const headerRow = el('workflowStructuredHeaderRow');
    const sectionsRow = el('workflowStructuredSectionsRow');
    const sqlTablesRow = el('workflowStructuredSqlTablesRow');
    const sqlRow = el('workflowStructuredSqlRow');
    const persistInputRow = el('workflowStructuredPersistInputRow');
    const persistFileNameRow = el('workflowStructuredPersistFileNameRow');
    const persistSheetNameRow = el('workflowStructuredPersistSheetNameRow');
    const persistUploadedByRow = el('workflowStructuredPersistUploadedByRow');
    const assertInputRow = el('workflowStructuredAssertInputRow');
    const assertOperatorRow = el('workflowStructuredAssertOperatorRow');
    const assertExpectedRow = el('workflowStructuredAssertExpectedRow');
    const schemaModeRow = el('workflowStructuredSchemaModeRow');
    const schemaColumnsRow = el('workflowStructuredSchemaColumnsRow');
    const shapeRowsRow = el('workflowStructuredShapeRowsRow');
    const shapeColumnsRow = el('workflowStructuredShapeColumnsRow');
    const assertStrategyRow = el('workflowStructuredAssertStrategyRow');
    const assertMessageRow = el('workflowStructuredAssertMessageRow');
    const inputGuardsRow = el('workflowStructuredInputGuardsRow');
    const sheetNameInput = el<HTMLInputElement>('workflowPreviewSheetName');
    const sheetNameSelect = el<HTMLSelectElement>('workflowPreviewSheetSelect');

    fileRow.classList.add('hidden');
    sheetRow.classList.add('hidden');
    rangeRow.classList.add('hidden');
    headerRow.classList.add('hidden');
    sectionsRow.classList.add('hidden');
    sqlTablesRow.classList.add('hidden');
    sqlRow.classList.add('hidden');
    persistInputRow.classList.add('hidden');
    persistFileNameRow.classList.add('hidden');
    persistSheetNameRow.classList.add('hidden');
    persistUploadedByRow.classList.add('hidden');
    assertInputRow.classList.add('hidden');
    assertOperatorRow.classList.add('hidden');
    assertExpectedRow.classList.add('hidden');
    schemaModeRow.classList.add('hidden');
    schemaColumnsRow.classList.add('hidden');
    shapeRowsRow.classList.add('hidden');
    shapeColumnsRow.classList.add('hidden');
    assertStrategyRow.classList.add('hidden');
    assertMessageRow.classList.add('hidden');
    inputGuardsRow.classList.add('hidden');
    sheetNameInput.disabled = false;
    sheetNameInput.title = '';
    sheetNameInput.classList.remove('hidden');
    sheetNameSelect.classList.add('hidden');
    sheetNameSelect.disabled = true;
    sheetNameSelect.title = '';
    sheetNameSelect.innerHTML = '';

    if (isSheetRangeExtractTask(task)) {
      normalizeSheetRangeExtractTask(task);
      fileRow.classList.remove('hidden');
      sheetRow.classList.remove('hidden');
      rangeRow.classList.remove('hidden');
      headerRow.classList.remove('hidden');

      fileSelect.value = runtimeFilePath ? String(runtimeDefaultFileId ?? '') : encodeWorkflowFileParamSelection(task.params.fileRef ?? task.params.fileId);
      if (isWorkflowRuntimeParameterReference(task.params.sheetName)) {
        sheetNameInput.value = '';
        sheetNameInput.classList.add('hidden');
        sheetNameSelect.classList.remove('hidden');
        sheetNameSelect.title = formatRuntimeFileSelectionLabel(task.params.sheetName.$fromRuntime);
        sheetNameSelect.innerHTML = '<option value="">Loading sheets...</option>';
        void hydrateStructuredRuntimeSheetControl(task);
      } else {
        sheetNameInput.value = String(task.params.sheetName ?? '');
      }
      el<HTMLInputElement>('workflowPreviewRange').value = String(task.params.range ?? '');
      el<HTMLInputElement>('workflowPreviewHeaderRow').value =
        task.params.headerRow === null || task.params.headerRow === undefined ? '' : String(task.params.headerRow);
    }

    if (isSheetSectionsExtractTask(task)) {
      normalizeSheetSectionsExtractTask(task);
      fileRow.classList.remove('hidden');
      sheetRow.classList.remove('hidden');
      sectionsRow.classList.remove('hidden');

      fileSelect.value = runtimeFilePath ? String(runtimeDefaultFileId ?? '') : encodeWorkflowFileParamSelection(task.params.fileRef ?? task.params.fileId);
      if (isWorkflowRuntimeParameterReference(task.params.sheetName)) {
        sheetNameInput.value = '';
        sheetNameInput.classList.add('hidden');
        sheetNameSelect.classList.remove('hidden');
        sheetNameSelect.title = formatRuntimeFileSelectionLabel(task.params.sheetName.$fromRuntime);
        sheetNameSelect.innerHTML = '<option value="">Loading sheets...</option>';
        void hydrateStructuredRuntimeSheetControl(task);
      } else {
        sheetNameInput.value = String(task.params.sheetName ?? '');
      }
      renderSheetSections(task);
    }

    if (isSqlTableBackedTask(task)) {
      sqlTablesRow.classList.remove('hidden');
      sqlRow.classList.remove('hidden');
      el<HTMLTextAreaElement>('workflowSqlInput').value = String(task.params.sql ?? '');
      renderSqlTables(task);
    }

    if (isPersistExcelTask(task)) {
      normalizePersistExcelTask(task);
      persistInputRow.classList.remove('hidden');
      persistFileNameRow.classList.remove('hidden');
      persistSheetNameRow.classList.remove('hidden');
      persistUploadedByRow.classList.remove('hidden');
      renderPersistExcelInput(task);
      el<HTMLInputElement>('workflowPersistFileName').value = String(task.params.fileName ?? '');
      el<HTMLInputElement>('workflowPersistSheetName').value = String(task.params.sheetName ?? '');
      el<HTMLInputElement>('workflowPersistUploadedBy').value = String(task.params.uploadedBy ?? '');
    }

    if (isAssertTask(task)) {
      normalizeAssertTask(task);
      assertInputRow.classList.remove('hidden');
      assertOperatorRow.classList.remove('hidden');
      assertExpectedRow.classList.remove('hidden');
      assertStrategyRow.classList.remove('hidden');
      assertMessageRow.classList.remove('hidden');
      renderAssertInput(task);
      el<HTMLSelectElement>('workflowAssertOperator').value = String(task.params.operator ?? '=');
      el<HTMLInputElement>('workflowAssertExpectedValue').value = String(task.params.expectedValue ?? '');
      el<HTMLSelectElement>('workflowAssertFailureStrategy').value = getAssertFailureStrategy(task);
      el<HTMLInputElement>('workflowAssertFailureMessage').value = String(task.params.failureMessage ?? 'Assertion failed');
    }

    if (isSqlAssertTask(task)) {
      normalizeSqlTask(task);
      assertOperatorRow.classList.remove('hidden');
      assertExpectedRow.classList.remove('hidden');
      assertStrategyRow.classList.remove('hidden');
      assertMessageRow.classList.remove('hidden');
      el<HTMLSelectElement>('workflowAssertOperator').value = String(task.params.operator ?? '=');
      el<HTMLInputElement>('workflowAssertExpectedValue').value = String(task.params.expectedValue ?? '');
      el<HTMLSelectElement>('workflowAssertFailureStrategy').value = getAssertFailureStrategy(task);
      el<HTMLInputElement>('workflowAssertFailureMessage').value = String(task.params.failureMessage ?? 'Assertion failed');
    }

    if (isSchemaAssertTask(task)) {
      normalizeSchemaAssertTask(task);
      assertInputRow.classList.remove('hidden');
      schemaModeRow.classList.remove('hidden');
      schemaColumnsRow.classList.remove('hidden');
      assertStrategyRow.classList.remove('hidden');
      assertMessageRow.classList.remove('hidden');
      renderAssertInput(task);
      el<HTMLSelectElement>('workflowAssertSchemaMode').value = String(task.params.mode ?? 'contains');
      el<HTMLTextAreaElement>('workflowAssertSchemaColumns').value = String(task.params.expectedColumns ?? '');
      el<HTMLSelectElement>('workflowAssertFailureStrategy').value = getAssertFailureStrategy(task);
      el<HTMLInputElement>('workflowAssertFailureMessage').value = String(task.params.failureMessage ?? 'Assertion failed');
    }

    if (isShapeAssertTask(task)) {
      normalizeShapeAssertTask(task);
      assertInputRow.classList.remove('hidden');
      shapeRowsRow.classList.remove('hidden');
      shapeColumnsRow.classList.remove('hidden');
      assertStrategyRow.classList.remove('hidden');
      assertMessageRow.classList.remove('hidden');
      renderAssertInput(task);
      el<HTMLSelectElement>('workflowShapeRowOperator').value = String(task.params.rowOperator ?? '>=');
      el<HTMLInputElement>('workflowShapeExpectedRows').value = String(task.params.expectedRows ?? 1);
      el<HTMLSelectElement>('workflowShapeColumnOperator').value = String(task.params.columnOperator ?? '>=');
      el<HTMLInputElement>('workflowShapeExpectedColumns').value = String(task.params.expectedColumns ?? 1);
      el<HTMLSelectElement>('workflowAssertFailureStrategy').value = getAssertFailureStrategy(task);
      el<HTMLInputElement>('workflowAssertFailureMessage').value = String(task.params.failureMessage ?? 'Assertion failed');
    }

    inputGuardsRow.classList.add('hidden');
    syncStructuredFilePickTrigger();
  }

  /** The hidden select stays the source of truth; the trigger only mirrors it and opens the picker. */
  function syncStructuredFilePickTrigger() {
    const select = el<HTMLSelectElement>('workflowPreviewFileId');
    const isRuntimeDefault = select.dataset.fileParamMode === 'runtime-default';
    const fileId = select.value && !select.value.startsWith('__runtime__:') ? Number(select.value) : null;
    const file = fileId ? getProductFiles().find((item) => item.id === fileId) : undefined;
    el('workflowPreviewFilePickName').textContent = file
      ? productFileDisplayName(file)
      : translateStaticText(isRuntimeDefault ? '未设置默认文件' : '请选择文件', lang());
    el('workflowPreviewFilePickPath').textContent = file
      ? `${file.logicalPath ?? file.displayPath} · #${file.id}`
      : translateStaticText('点击选择文件', lang());
  }

  async function openStructuredFilePicker() {
    const select = el<HTMLSelectElement>('workflowPreviewFileId');
    const isRuntimeDefault = select.dataset.fileParamMode === 'runtime-default';
    const currentFileId = select.value && !select.value.startsWith('__runtime__:') ? Number(select.value) : null;
    const result = await filePicker.open({
      titleKey: isRuntimeDefault ? 'defaultFileTitle' : 'fileSourceTitle',
      currentFileId,
      allowClear: true,
      uploadFolderPrefix: 'input',
    });
    if (!result) return;
    if (result.action === 'pick' && !Array.from(select.options).some((option) => option.value === String(result.fileId))) {
      // A file uploaded from inside the picker has no option yet, and <select>.value ignores unknown values.
      const file = getProductFiles().find((item) => item.id === result.fileId);
      const option = document.createElement('option');
      option.value = String(result.fileId);
      option.textContent = file ? productFileDisplayName(file) : `#${result.fileId}`;
      select.appendChild(option);
    }
    select.value = result.action === 'pick' ? String(result.fileId) : '';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    syncStructuredFilePickTrigger();
  }

  function syncStructuredTaskParamsToState() {
    const task = getActiveWorkflowTask();
    if (!task) return;
    const workflow = getActiveWorkflow();
    const operator = getWorkflowOperator(task);
    const genericSyncResult = syncOperatorConfigForm({
      container: el('workflowStructuredGenericParamsRow'),
      operator,
      task,
      excludedParamKeys: getCustomParamKeys(task),
    });
    if (genericSyncResult.hasInvalidValue) {
      syncTaskParamsTextarea(task);
      return;
    }

    if (isSheetRangeExtractTask(task)) {
      const fileSelect = el<HTMLSelectElement>('workflowPreviewFileId');
      const selected = fileSelect.value;
      const runtimePath = getWorkflowFileParamRuntimePath(task.params.fileRef ?? task.params.fileId);
      if (workflow && runtimePath) {
        setWorkflowRuntimeDefaultFileId(workflow, runtimePath, selected ? Number(selected) : null);
        task.params.fileRef = { $fromRuntime: runtimePath };
        delete task.params.fileId;
      } else {
        task.params.fileRef = decodeWorkflowFileParamSelection(selected);
        delete task.params.fileId;
      }
      if (!isWorkflowRuntimeParameterReference(task.params.sheetName)) {
        task.params.sheetName = el<HTMLInputElement>('workflowPreviewSheetName').value.trim();
      } else if (workflow) {
        const sheetSelect = el<HTMLSelectElement>('workflowPreviewSheetSelect');
        if (!sheetSelect.disabled) {
          setWorkflowRuntimeDefaultString(workflow, task.params.sheetName.$fromRuntime, sheetSelect.value.trim());
        }
        void hydrateStructuredRuntimeSheetControl(task);
      }
      task.params.range = el<HTMLInputElement>('workflowPreviewRange').value.trim();
      const headerRowValue = el<HTMLInputElement>('workflowPreviewHeaderRow').value.trim();
      task.params.headerRow = headerRowValue ? Number(headerRowValue) : null;
    }

    if (isSheetSectionsExtractTask(task)) {
      const fileSelect = el<HTMLSelectElement>('workflowPreviewFileId');
      const selected = fileSelect.value;
      const runtimePath = getWorkflowFileParamRuntimePath(task.params.fileRef ?? task.params.fileId);
      if (workflow && runtimePath) {
        setWorkflowRuntimeDefaultFileId(workflow, runtimePath, selected ? Number(selected) : null);
        task.params.fileRef = { $fromRuntime: runtimePath };
        delete task.params.fileId;
      } else {
        task.params.fileRef = decodeWorkflowFileParamSelection(selected);
        delete task.params.fileId;
      }
      if (!isWorkflowRuntimeParameterReference(task.params.sheetName)) {
        task.params.sheetName = el<HTMLInputElement>('workflowPreviewSheetName').value.trim();
      } else if (workflow) {
        const sheetSelect = el<HTMLSelectElement>('workflowPreviewSheetSelect');
        if (!sheetSelect.disabled) {
          setWorkflowRuntimeDefaultString(workflow, task.params.sheetName.$fromRuntime, sheetSelect.value.trim());
        }
        void hydrateStructuredRuntimeSheetControl(task);
      }
      task.params.sectionMode = el<HTMLSelectElement>('workflowSectionMode')?.value ?? 'manual';
      task.params.splitByColumn = el<HTMLInputElement>('workflowSectionSplitByColumn')?.value.trim() ?? '';
      task.params.sections = Array.from(document.querySelectorAll<HTMLElement>('[data-sheet-section-row]'))
        .map((row, index) => {
          const key =
            row.querySelector<HTMLInputElement>(`[data-sheet-section-key="${index}"]`)?.value.trim() || `section_${index + 1}`;
          const title = row.querySelector<HTMLInputElement>(`[data-sheet-section-title="${index}"]`)?.value.trim() || key;
          const range = row.querySelector<HTMLInputElement>(`[data-sheet-section-range="${index}"]`)?.value.trim() ?? '';
          const anchorText = row.querySelector<HTMLInputElement>(`[data-sheet-section-anchor-text="${index}"]`)?.value.trim() ?? '';
          const rangeColumns = row.querySelector<HTMLInputElement>(`[data-sheet-section-range-columns="${index}"]`)?.value.trim() ?? '';
          const headerRowValue = row.querySelector<HTMLInputElement>(`[data-sheet-section-header-row="${index}"]`)?.value.trim() ?? '';
          const headerOffsetValue = row.querySelector<HTMLInputElement>(`[data-sheet-section-header-offset="${index}"]`)?.value.trim() ?? '';
          const dataOffsetValue = row.querySelector<HTMLInputElement>(`[data-sheet-section-data-offset="${index}"]`)?.value.trim() ?? '';
          const maxRowsValue = row.querySelector<HTMLInputElement>(`[data-sheet-section-max-rows="${index}"]`)?.value.trim() ?? '';
          return {
            key,
            title,
            range,
            anchorText,
            rangeColumns,
            headerRow: headerRowValue ? Number(headerRowValue) : null,
            headerRowOffset: headerOffsetValue ? Number(headerOffsetValue) : null,
            dataStartRowOffset: dataOffsetValue ? Number(dataOffsetValue) : null,
            maxRows: maxRowsValue ? Number(maxRowsValue) : null,
          };
        });
      normalizeSheetSectionsExtractTask(task);
    }

    if (isSqlTableBackedTask(task)) {
      task.params.sql = el<HTMLTextAreaElement>('workflowSqlInput').value;
      const nextInputs: WorkflowTask['inputs'] = {};
      task.params.tableBindings = Array.from(document.querySelectorAll<HTMLElement>('[data-sql-table-row]'))
        .map((row, index) => {
          const tableName = (row.querySelector<HTMLInputElement>(`[data-sql-table-name="${index}"]`)?.value ?? '').trim();
          const upstreamTaskId = (row.querySelector<HTMLSelectElement>(`[data-sql-table-source="${index}"]`)?.value ?? '').trim();
          if (!tableName) return null;
          const inputSlot = `input${index + 1}`;
          nextInputs[inputSlot] = getInputBindingWithGuards(task.inputs?.[inputSlot], { from: upstreamTaskId, slot: 'dataframe' });
          return { tableName, inputSlot };
        })
        .filter((item): item is WorkflowSqlTableBinding => Boolean(item));

      task.inputs = Object.keys(nextInputs).length
        ? nextInputs
        : { input1: getInputBindingWithGuards(task.inputs?.input1, { from: '', slot: 'dataframe' }) };
      normalizeSqlTask(task);
    }

    if (isPersistExcelTask(task)) {
      task.params.fileName = el<HTMLInputElement>('workflowPersistFileName').value.trim();
      task.params.sheetName = el<HTMLInputElement>('workflowPersistSheetName').value.trim();
      task.params.uploadedBy = el<HTMLInputElement>('workflowPersistUploadedBy').value.trim();
      task.inputs = {
        input1: getInputBindingWithGuards(task.inputs?.input1, {
          from: el<HTMLSelectElement>('workflowPersistInputSource').value.trim(),
          slot: 'dataframe',
        }),
      };
      normalizePersistExcelTask(task);
    }

    if (isAssertTask(task)) {
      task.params.operator = el<HTMLSelectElement>('workflowAssertOperator').value as WorkflowAssertOperator;
      const expectedValueRaw = el<HTMLInputElement>('workflowAssertExpectedValue').value.trim();
      const expectedValueNumber = Number(expectedValueRaw);
      task.params.expectedValue =
        expectedValueRaw !== '' && Number.isFinite(expectedValueNumber) ? expectedValueNumber : expectedValueRaw;
      const failureStrategy = el<HTMLSelectElement>('workflowAssertFailureStrategy').value as WorkflowAssertFailureStrategy;
      task.params.failureStrategy = failureStrategy;
      task.params.blockExecution = failureStrategy === 'block';
      task.params.failureMessage = el<HTMLInputElement>('workflowAssertFailureMessage').value.trim() || 'Assertion failed';
      task.inputs = {
        input1: getInputBindingWithGuards(task.inputs?.input1, {
          from: el<HTMLSelectElement>('workflowAssertInputSource').value.trim(),
          slot: 'dataframe',
        }),
      };
      normalizeAssertTask(task);
    }

    if (isSqlAssertTask(task)) {
      task.params.operator = el<HTMLSelectElement>('workflowAssertOperator').value as WorkflowAssertOperator;
      const expectedValueRaw = el<HTMLInputElement>('workflowAssertExpectedValue').value.trim();
      const expectedValueNumber = Number(expectedValueRaw);
      task.params.expectedValue =
        expectedValueRaw !== '' && Number.isFinite(expectedValueNumber) ? expectedValueNumber : expectedValueRaw;
      const failureStrategy = el<HTMLSelectElement>('workflowAssertFailureStrategy').value as WorkflowAssertFailureStrategy;
      task.params.failureStrategy = failureStrategy;
      task.params.blockExecution = failureStrategy === 'block';
      task.params.failureMessage = el<HTMLInputElement>('workflowAssertFailureMessage').value.trim() || 'Assertion failed';
      normalizeSqlTask(task);
    }

    if (isSchemaAssertTask(task)) {
      task.params.mode = el<HTMLSelectElement>('workflowAssertSchemaMode').value;
      task.params.expectedColumns = el<HTMLTextAreaElement>('workflowAssertSchemaColumns').value.trim();
      const failureStrategy = el<HTMLSelectElement>('workflowAssertFailureStrategy').value as WorkflowAssertFailureStrategy;
      task.params.failureStrategy = failureStrategy;
      task.params.blockExecution = failureStrategy === 'block';
      task.params.failureMessage = el<HTMLInputElement>('workflowAssertFailureMessage').value.trim() || 'Assertion failed';
      task.inputs = {
        input1: getInputBindingWithGuards(task.inputs?.input1, {
          from: el<HTMLSelectElement>('workflowAssertInputSource').value.trim(),
          slot: 'dataframe',
        }),
      };
      normalizeSchemaAssertTask(task);
    }

    if (isShapeAssertTask(task)) {
      const expectedRowsRaw = el<HTMLInputElement>('workflowShapeExpectedRows').value.trim();
      const expectedColumnsRaw = el<HTMLInputElement>('workflowShapeExpectedColumns').value.trim();
      task.params.rowOperator = el<HTMLSelectElement>('workflowShapeRowOperator').value;
      task.params.expectedRows = expectedRowsRaw ? Number(expectedRowsRaw) : 0;
      task.params.columnOperator = el<HTMLSelectElement>('workflowShapeColumnOperator').value;
      task.params.expectedColumns = expectedColumnsRaw ? Number(expectedColumnsRaw) : 0;
      const failureStrategy = el<HTMLSelectElement>('workflowAssertFailureStrategy').value as WorkflowAssertFailureStrategy;
      task.params.failureStrategy = failureStrategy;
      task.params.blockExecution = failureStrategy === 'block';
      task.params.failureMessage = el<HTMLInputElement>('workflowAssertFailureMessage').value.trim() || 'Assertion failed';
      task.inputs = {
        input1: getInputBindingWithGuards(task.inputs?.input1, {
          from: el<HTMLSelectElement>('workflowAssertInputSource').value.trim(),
          slot: 'dataframe',
        }),
      };
      normalizeShapeAssertTask(task);
    }

    task.dependsOn = getWorkflowControlDependencies(task);
    normalizeTaskDependencies(task);

    syncTaskParamsTextarea(task);
    renderWorkflowEditor();
  }

  async function previewWorkflowTask() {
    const task = getActiveWorkflowTask();
    if (!task) return;

    const workflow = getActiveWorkflow();
    if (!workflow) return;

    syncVisibleRuntimeDefaultsToWorkflow(workflow);

    const payload: WorkflowTaskPreviewRequest = {
      workflowId: workflow.id,
      taskId: task.id,
      tasks: workflow.tasks,
      runtimeParamsSchema: workflow.runtimeParamsSchema,
      runtimeParamsDefaults: workflow.runtimeParamsDefaults,
      runtimeParameters: workflow.runtimeParamsDefaults,
    };

    try {
      activeWorkflowPreview = await api<WorkflowTaskPreviewResult>('/api/workflows/preview-task', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      workflowPreviewPage = 1;
      renderWorkflowPreview();
    } catch (error) {
      activeWorkflowPreview = null;
      renderWorkflowPreview();
      notify(`预览失败：${error instanceof Error ? error.message : '未知错误'}`, { type: 'error' });
    }
  }

  function getWorkflowRunLastResult(run: WorkflowRunRecord): WorkflowTaskPreviewResult | null {
    for (let index = run.steps.length - 1; index >= 0; index -= 1) {
      const result = run.steps[index]?.result;
      if (result) return result;
    }
    return null;
  }

  function applyWorkflowRunRecord(run: WorkflowRunRecord, workflow: WorkflowDefinition) {
    const orderedTasks = getWorkflowExecutionOrder(workflow);
    const taskStates: Record<string, WorkflowExecutionTaskState> = Object.fromEntries(
      orderedTasks.map((task) => [task.id, 'pending' as WorkflowExecutionTaskState]),
    );
    for (const step of run.steps) {
      taskStates[step.taskId] = step.status;
    }

    const runIsTerminal = isWorkflowRunTerminalStatus(run.status);
    const activeStep = runIsTerminal ? null : run.steps.find((step) => step.status === 'running');
    const waitingForApprovalTaskIds = run.approvals
      .filter((approval) => approval.status === 'pending')
      .map((approval) => approval.taskId);
    const warningMessages = Object.fromEntries(
      run.steps
        .filter((step) => step.status === 'warning')
        .map((step) => [
          step.taskId,
          step.result?.kind === 'assert'
            ? step.result.assertion.failureMessage
            : step.errorMessage ?? run.approvals.find((approval) => approval.taskId === step.taskId)?.comment ?? 'Warning',
        ]),
    );
    const taskMessages = Object.fromEntries(
      run.steps
        .filter((step) => (step.status === 'warning' || step.status === 'failed' || step.status === 'blocked') && Boolean(step.errorMessage?.trim() || step.result?.kind === 'assert'))
        .map((step) => [
          step.taskId,
          step.status === 'warning' && step.result?.kind === 'assert'
            ? step.result.assertion.failureMessage
            : step.errorMessage?.trim() ?? (step.status === 'failed' ? 'Task failed' : 'Task blocked'),
        ]),
    );

    workflowRunState.workflowId = workflow.id;
    workflowRunState.runId = run.id;
    workflowRunState.isOpen = true;
    workflowRunState.isRunning = !runIsTerminal && (run.status === 'running' || Boolean(activeStep));
    workflowRunState.activeTaskId = activeStep?.taskId ?? null;
    workflowRunState.taskStates = taskStates;
    workflowRunState.approvedWarningTaskIds = run.approvedWarningTaskIds;
    workflowRunState.waitingForApprovalTaskIds = waitingForApprovalTaskIds;
    workflowRunState.warningTaskIds = run.steps.filter((step) => step.status === 'warning').map((step) => step.taskId);
    workflowRunState.warningMessages = warningMessages;
    workflowRunState.taskMessages = taskMessages;
    workflowRunState.errorMessage =
      run.errorMessage ?? run.steps.find((step) => step.status === 'failed')?.errorMessage ?? null;

    if (run.status === 'waiting_approval' || waitingForApprovalTaskIds.length) {
      workflowRunState.isRunning = false;
      workflowRunState.message = 'Workflow requires review before continuing';
    } else if (run.status === 'failed') {
      workflowRunState.isRunning = false;
      workflowRunState.message = 'Workflow execution failed';
    } else if (run.status === 'skipped') {
      workflowRunState.isRunning = false;
      workflowRunState.message = `Workflow ${workflow.name} skipped`;
    } else if (run.status === 'completed_with_warnings') {
      workflowRunState.isRunning = false;
      workflowRunState.message = `Workflow ${workflow.name} completed with warnings`;
    } else if (run.status === 'completed') {
      workflowRunState.isRunning = false;
      workflowRunState.message = `Workflow ${workflow.name} completed`;
    } else if (activeStep) {
      const task = orderedTasks.find((item) => item.id === activeStep.taskId);
      workflowRunState.message = task ? `Running ${task.name}` : `Workflow ${workflow.name} is running`;
    } else {
      workflowRunState.message = `Workflow ${workflow.name} is queued`;
    }

    activeWorkflowPreview = getWorkflowRunLastResult(run);
    workflowPreviewPage = 1;
    renderWorkflowEditor();
    renderWorkflowPreview();
  }

  async function pollWorkflowRunUntilSettled(
    runId: number,
    workflow: WorkflowDefinition,
    options: { minimumPollCount?: number } = {},
  ) {
    let shouldRefreshFiles = false;
    let pollCount = 0;
    for (;;) {
      await wait(500);
      pollCount += 1;
      const run = await api<WorkflowRunRecord>(`/api/workflow-runs/${runId}`);
      applyWorkflowRunRecord(run, workflow);
      shouldRefreshFiles ||= run.artifacts.some((artifact) => artifact.artifactType === 'file');
      const isSettled =
        isWorkflowRunTerminalStatus(run.status) || (run.status !== 'running' && !run.steps.some((step) => step.status === 'running'));
      if (pollCount < (options.minimumPollCount ?? 1)) continue;
      if (!isSettled) continue;
      if (shouldRefreshFiles || getWorkflowRunLastResult(run)?.kind === 'file') {
        await refreshProductFiles();
      }
      if (run.status === 'completed' || run.status === 'completed_with_warnings' || run.status === 'skipped') {
        window.setTimeout(() => {
          if (workflowRunState.runId === runId && !workflowRunState.isRunning) {
            notify(
              run.status === 'skipped'
                ? '任务已跳过后续流程'
                : run.status === 'completed_with_warnings'
                  ? '任务完成（包含 Warning）'
                  : '任务完成',
              { type: run.status === 'completed_with_warnings' ? 'warning' : 'success' },
            );
          }
        }, 120);
      }
      return;
    }
  }

  async function executeWorkflow() {
    const workflow = getActiveWorkflow();
    if (!workflow) return;

    syncVisibleRuntimeDefaultsToWorkflow(workflow);

    if (!workflow.tasks.length) {
      notify('当前工作流没有任务', { type: 'warning' });
      return;
    }

    const initialExecutionOrder = getWorkflowExecutionOrder(workflow);
    resetWorkflowRunState(workflow.id);
    workflowRunState.isOpen = true;
    workflowRunState.isRunning = true;
    workflowRunState.taskStates = Object.fromEntries(
      initialExecutionOrder.map((task) => [task.id, 'pending' as WorkflowExecutionTaskState]),
    );
    workflowRunState.message = `Starting ${workflow.name}`;
    renderWorkflowEditor();

    try {
      const savedWorkflow = await persistWorkflowDefinition(workflow);
      const payload: WorkflowExecuteRequest = {};
      const result = await api<WorkflowExecutionResult>(`/api/workflows/${savedWorkflow.id}/execute`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (!result.run) {
        throw new Error('Workflow run was not created');
      }
      applyWorkflowRunRecord(result.run, savedWorkflow);
      await pollWorkflowRunUntilSettled(result.run.id, savedWorkflow);
    } catch (error) {
      workflowRunState.isRunning = false;
      if (workflowRunState.activeTaskId) {
        workflowRunState.taskStates[workflowRunState.activeTaskId] = 'failed';
      }
      workflowRunState.activeTaskId = null;
      workflowRunState.message = 'Workflow execution failed';
      workflowRunState.errorMessage = error instanceof Error ? error.message : 'Unknown execution error';
      renderWorkflowEditor();
      throw error;
    }
  }

  async function continueWorkflowAfterWarning(decision: 'approved' | 'skipped' = 'approved') {
    const workflow = getActiveWorkflow();
    if (!workflow || workflowRunState.isRunning) return;
    const waitingTaskIds = workflowRunState.waitingForApprovalTaskIds.filter(Boolean);
    if (!waitingTaskIds.length) return;
    if (!workflowRunState.runId) {
      notify('当前没有可继续的工作流运行', { type: 'warning' });
      return;
    }

    workflowRunState.isRunning = true;
    workflowRunState.message = decision === 'skipped' ? `Skipping downstream flow for ${workflow.name}` : `Continuing ${workflow.name}`;
    renderWorkflowEditor();

    const result = await api<WorkflowExecutionResult>(`/api/workflow-runs/${workflowRunState.runId}/approvals`, {
      method: 'POST',
      body: JSON.stringify({ taskIds: waitingTaskIds, decision }),
    });
    if (!result.run) {
      throw new Error('Workflow run was not returned');
    }
    applyWorkflowRunRecord(result.run, workflow);
    await pollWorkflowRunUntilSettled(result.run.id, workflow, { minimumPollCount: 2 });
  }

  async function cancelWorkflowRun() {
    const workflow = getActiveWorkflow();
    if (!workflow || !workflowRunState.runId) return;
    workflowRunState.isRunning = true;
    workflowRunState.message = `Cancelling ${workflow.name}`;
    workflowRunState.errorMessage = null;
    renderWorkflowEditor();

    try {
      const result = await api<WorkflowExecutionResult>(`/api/workflow-runs/${workflowRunState.runId}/cancel`, {
        method: 'POST',
      });
      if (!result.run) throw new Error('Workflow run was not returned');
      applyWorkflowRunRecord(result.run, workflow);
    } catch (error) {
      workflowRunState.isRunning = false;
      workflowRunState.message = 'Workflow cancel failed';
      workflowRunState.errorMessage = error instanceof Error ? error.message : 'Unknown cancel error';
      renderWorkflowEditor();
      throw error;
    }
  }

  async function retryUnfinishedWorkflowRun() {
    const workflow = getActiveWorkflow();
    if (!workflow || !workflowRunState.runId) return;
    workflowRunState.isOpen = true;
    workflowRunState.isRunning = true;
    workflowRunState.message = `Retrying unfinished steps for ${workflow.name}`;
    workflowRunState.errorMessage = null;
    renderWorkflowEditor();

    try {
      await api<WorkflowExecutionResult>(`/api/workflow-runs/${workflowRunState.runId}/retry-unfinished`, {
        method: 'POST',
        body: JSON.stringify({ tasks: workflow.tasks }),
      });
      await pollWorkflowRunUntilSettled(workflowRunState.runId, workflow, { minimumPollCount: 2 });
    } catch (error) {
      workflowRunState.isRunning = false;
      workflowRunState.message = 'Workflow retry failed';
      workflowRunState.errorMessage = error instanceof Error ? error.message : 'Unknown retry error';
      renderWorkflowEditor();
      throw error;
    }
  }

  async function runActiveWorkflowTaskStep() {
    const workflow = getActiveWorkflow();
    const task = getActiveWorkflowTask();
    if (!workflow || !task) return;

    if (!workflowRunState.runId || workflowRunState.workflowId !== workflow.id) {
      notify('请先执行工作流，创建当前 Run 后再单步执行节点', { type: 'warning' });
      return;
    }
    if (workflowRunState.isRunning) {
      notify('工作流正在执行中，不能同时单步执行', { type: 'warning' });
      return;
    }

    syncTaskEditorToState();
    workflowRunState.isOpen = true;
    workflowRunState.isRunning = true;
    workflowRunState.activeTaskId = task.id;
    workflowRunState.message = `Running ${task.name}`;
    workflowRunState.errorMessage = null;
    workflowRunState.taskStates = {
      ...workflowRunState.taskStates,
      [task.id]: 'running',
    };
    closeWorkflowTaskModal();
    renderWorkflowEditor();

    try {
      await api<WorkflowExecutionResult>(
        `/api/workflow-runs/${workflowRunState.runId}/steps/${encodeURIComponent(task.id)}/execute`,
        {
          method: 'POST',
          body: JSON.stringify({ tasks: workflow.tasks }),
        },
      );
      await pollWorkflowRunUntilSettled(workflowRunState.runId, workflow, { minimumPollCount: 2 });
    } catch (error) {
      workflowRunState.isRunning = false;
      workflowRunState.activeTaskId = null;
      workflowRunState.taskStates = {
        ...workflowRunState.taskStates,
        [task.id]: 'failed',
      };
      workflowRunState.message = `Step ${task.name} failed`;
      workflowRunState.errorMessage = error instanceof Error ? error.message : 'Unknown step execution error';
      renderWorkflowEditor();
      throw error;
    }
  }

  async function previewSqlBinding(bindingIndex: number) {
    const task = getActiveWorkflowTask();
    const workflow = getActiveWorkflow();
    if (!task || !workflow || !isSqlComputeTask(task)) return;

    const bindings = getSqlTableBindings(task);
    const binding = bindings[bindingIndex];
    if (!binding) return;

    const inputRef = task.inputs?.[binding.inputSlot];
    const sourceTaskId = inputRef?.from?.trim() ?? '';
    if (!sourceTaskId) {
      notify('当前绑定还没有关联上游任务', { type: 'warning' });
      return;
    }

    const sourceTask = workflow.tasks.find((item) => item.id === sourceTaskId);
    if (!sourceTask) {
      notify('未找到绑定的上游任务', { type: 'warning' });
      return;
    }

    const payload: WorkflowTaskPreviewRequest = {
      workflowId: workflow.id,
      taskId: sourceTask.id,
      tasks: workflow.tasks,
      runtimeParamsSchema: workflow.runtimeParamsSchema,
      runtimeParamsDefaults: workflow.runtimeParamsDefaults,
      runtimeParameters: workflow.runtimeParamsDefaults,
    };

    try {
      const preview = await api<WorkflowTaskPreviewResult>('/api/workflows/preview-task', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (preview.kind !== 'dataframe' && preview.kind !== 'file' && preview.kind !== 'assert') {
        throw new Error('Unsupported preview result');
      }

      activeWorkflowBindingPreview = {
        dataFrame: preview.dataFrame,
        tableName: binding.tableName,
        inputSlot: binding.inputSlot,
        sourceTaskName: sourceTask.name,
      };
      workflowBindingPreviewPage = 1;
      renderWorkflowBindingPreview();
      openWorkflowBindingPreviewModal();
    } catch (error) {
      activeWorkflowBindingPreview = null;
      renderWorkflowBindingPreview();
      notify(`预览失败：${error instanceof Error ? error.message : '未知错误'}`, { type: 'error' });
    }
  }

  function clampWorkflowPreviewPage(page: number, totalRows: number) {
    const totalPages = Math.max(1, Math.ceil(totalRows / WORKFLOW_PREVIEW_PAGE_SIZE));
    return Math.min(Math.max(1, page), totalPages);
  }

  function renderWorkflowDataFramePreviewTable(
    dataFrame: WorkflowDataFrame,
    page: number,
    pageDatasetName: 'workflowPreviewPage' | 'workflowBindingPreviewPage',
  ) {
    const totalRows = dataFrame.rows.length;
    const totalPages = Math.max(1, Math.ceil(totalRows / WORKFLOW_PREVIEW_PAGE_SIZE));
    const currentPage = clampWorkflowPreviewPage(page, totalRows);
    const startIndex = (currentPage - 1) * WORKFLOW_PREVIEW_PAGE_SIZE;
    const endIndex = Math.min(startIndex + WORKFLOW_PREVIEW_PAGE_SIZE, totalRows);
    const previewRows = dataFrame.rows.slice(startIndex, endIndex);
    const previousPage = Math.max(1, currentPage - 1);
    const nextPage = Math.min(totalPages, currentPage + 1);
    const pageAttribute =
      pageDatasetName === 'workflowPreviewPage' ? 'data-workflow-preview-page' : 'data-workflow-binding-preview-page';
    const rangeLabel = totalRows > 0 ? `${startIndex + 1}-${endIndex} / ${totalRows}` : `0 / ${totalRows}`;

    return `
      <div class="workflow-preview__table-scroll">
        <table class="workflow-preview__table">
          <thead>
            <tr>
              <th>#</th>
              ${dataFrame.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${
              previewRows.length
                ? previewRows
                    .map(
                      (row, rowIndex) => {
                        const absoluteRowIndex = startIndex + rowIndex;
                        return `
                          <tr>
                            <td>${escapeHtml(dataFrame.index?.[absoluteRowIndex] ?? absoluteRowIndex + 1)}</td>
                            ${dataFrame.columns
                              .map((column, columnIndex) => {
                                const displayValue = dataFrame.cells?.[absoluteRowIndex]?.[columnIndex]?.displayValue;
                                return `<td>${escapeHtml(displayValue ?? row[column])}</td>`;
                              })
                              .join('')}
                          </tr>`;
                      },
                    )
                    .join('')
                : `<tr><td colspan="${dataFrame.columns.length + 1}"><div class="workflow-empty">暂无数据</div></td></tr>`
            }
          </tbody>
        </table>
      </div>
      <div class="workflow-preview__pagination">
        <span class="workflow-preview__pagination-info">Rows ${escapeHtml(rangeLabel)}</span>
        <div class="workflow-preview__pagination-actions">
          <button class="btn btn-secondary btn-sm" type="button" ${pageAttribute}="${previousPage}" ${currentPage <= 1 ? 'disabled' : ''}>Previous</button>
          <span class="workflow-preview__pagination-page">Page ${escapeHtml(currentPage)} / ${escapeHtml(totalPages)}</span>
          <button class="btn btn-secondary btn-sm" type="button" ${pageAttribute}="${nextPage}" ${currentPage >= totalPages ? 'disabled' : ''}>Next</button>
        </div>
      </div>
    `;
  }

  function renderWorkflowPreview() {
    const panel = el('workflowPreviewPanel');
    const summary = el('workflowPreviewSummary');
    const table = el('workflowPreviewTable');
    const task = getActiveWorkflowTask();

    if (!task) {
      panel.classList.add('hidden');
      summary.innerHTML = '';
      table.innerHTML = '';
      localizeWorkflowDom();
      return;
    }

    panel.classList.remove('hidden');

    if (!activeWorkflowPreview) {
      summary.innerHTML = '<div class="workflow-empty workflow-preview__empty">点击 Preview 执行当前节点，预览节点输出</div>';
      table.innerHTML = '';
      localizeWorkflowDom();
      return;
    }

    const preview = activeWorkflowPreview;
    if (preview.kind === 'file-plan') {
      summary.innerHTML = `
        <div class="workflow-preview__summary-item"><strong>Planned File</strong><span>${escapeHtml(preview.fileName)}</span></div>
        <div class="workflow-preview__summary-item"><strong>Sheet</strong><span>${escapeHtml(preview.sheetName)}</span></div>
        <div class="workflow-preview__summary-item"><strong>Rows</strong><span>${escapeHtml(preview.dataFrame.rows.length)}</span></div>
        <div class="workflow-preview__summary-item"><strong>Columns</strong><span>${escapeHtml(preview.dataFrame.columns.length)}</span></div>
      `;
      table.innerHTML = `
        <div class="workflow-empty" style="align-items:flex-start;">
          Preview 不会写入 Files。点击 Execute 后，该节点才会生成 Excel 文件并记录为 workflow artifact。
        </div>
      `;
      localizeWorkflowDom();
      return;
    }

    if (preview.kind === 'file') {
      summary.innerHTML = `
        <div class="workflow-preview__summary-item"><strong>File</strong><span>${escapeHtml(productFileDisplayName(preview.file))}</span></div>
        <div class="workflow-preview__summary-item"><strong>File ID</strong><span>${escapeHtml(preview.file.id)}</span></div>
        <div class="workflow-preview__summary-item"><strong>Sheets</strong><span>${escapeHtml(preview.file.workbookSheetCount)}</span></div>
        <div class="workflow-preview__summary-item"><strong>Rows</strong><span>${escapeHtml(preview.file.workbookRowCount)}</span></div>
      `;
      table.innerHTML = `
        <div class="workflow-empty" style="align-items:flex-start;">
          文件已持久化到 Files。你可以到 Files 页查看或下载，也可以继续使用该节点输出的 dataframe。
        </div>
      `;
      localizeWorkflowDom();
      return;
    }

    if (preview.kind === 'assert') {
      renderAssertionPreview(preview.assertion, preview.dataFrame);
      localizeWorkflowDom();
      return;
    }

    const dataFrame = preview.dataFrame;
    workflowPreviewPage = clampWorkflowPreviewPage(workflowPreviewPage, dataFrame.rows.length);
    summary.innerHTML = `
      <div class="workflow-preview__summary-item"><strong>Rows</strong><span>${escapeHtml(dataFrame.rows.length)}</span></div>
      <div class="workflow-preview__summary-item"><strong>Columns</strong><span>${escapeHtml(dataFrame.columns.length)}</span></div>
    `;
    table.innerHTML = renderWorkflowDataFramePreviewTable(dataFrame, workflowPreviewPage, 'workflowPreviewPage');
    localizeWorkflowDom();
  }

  function renderAssertionPreview(assertion: WorkflowAssertionResult, dataFrame: WorkflowDataFrame) {
    const summary = el('workflowPreviewSummary');
    const table = el('workflowPreviewTable');
    const statusClass = assertion.passed ? 'is-success' : assertion.failureStrategy === 'warning' ? 'is-warning' : 'is-danger';
    const statusLabel = assertion.passed ? 'Passed' : assertion.failureStrategy === 'warning' ? 'Warning' : 'Failed';
    const failureStrategyLabel =
      assertion.failureStrategy === 'block'
        ? 'Block workflow'
        : assertion.failureStrategy === 'warning'
          ? 'Warning, require review'
          : 'Pass through';
    summary.innerHTML = `
      <div class="workflow-preview__summary-item ${statusClass}">
        <strong>Status</strong>
        <span>${escapeHtml(statusLabel)}</span>
      </div>
        <div class="workflow-preview__summary-item">
          <strong>Actual Value</strong>
        <span>${escapeHtml(assertion.actualLabel ?? assertion.actualValue ?? '')}</span>
        </div>
        <div class="workflow-preview__summary-item">
          <strong>Expected</strong>
        <span>${escapeHtml(assertion.expectedLabel ?? `${assertion.operator} ${String(assertion.expectedValue ?? '')}`)}</span>
        </div>
      <div class="workflow-preview__summary-item">
        <strong>On Failure</strong>
        <span>${escapeHtml(failureStrategyLabel)}</span>
      </div>
      <div class="workflow-preview__summary-item" style="grid-column:1 / -1;">
        <strong>Message</strong>
        <span>${escapeHtml(assertion.passed ? 'Assertion passed' : assertion.failureMessage)}</span>
      </div>
    `;

    workflowPreviewPage = clampWorkflowPreviewPage(workflowPreviewPage, dataFrame.rows.length);
    table.innerHTML = renderWorkflowDataFramePreviewTable(dataFrame, workflowPreviewPage, 'workflowPreviewPage');
  }

  function renderWorkflowBindingPreview() {
    const title = el('workflowBindingPreviewTitle');
    const summary = el('workflowBindingPreviewSummary');
    const table = el('workflowBindingPreviewTable');

    if (!activeWorkflowBindingPreview) {
      title.textContent = 'Dataset Preview';
      summary.innerHTML = '<div class="workflow-empty">暂无数据</div>';
      table.innerHTML = '';
      return;
    }

    const preview = activeWorkflowBindingPreview.dataFrame;
    title.textContent = `${activeWorkflowBindingPreview.tableName} Preview`;
    summary.innerHTML = `
      <div class="workflow-preview__summary-item"><strong>Table</strong><span>${escapeHtml(activeWorkflowBindingPreview.tableName)}</span></div>
      <div class="workflow-preview__summary-item"><strong>Input Slot</strong><span>${escapeHtml(activeWorkflowBindingPreview.inputSlot)}</span></div>
      <div class="workflow-preview__summary-item"><strong>Rows</strong><span>${escapeHtml(preview.rows.length)}</span></div>
      <div class="workflow-preview__summary-item"><strong>Columns</strong><span>${escapeHtml(preview.columns.length)}</span></div>
    `;

    workflowBindingPreviewPage = clampWorkflowPreviewPage(workflowBindingPreviewPage, preview.rows.length);
    table.innerHTML = renderWorkflowDataFramePreviewTable(preview, workflowBindingPreviewPage, 'workflowBindingPreviewPage');
  }

  function renderWorkflowOperatorSlotList(title: string, slots: WorkflowOperator['inputSlots']) {
    return `
      <div class="workflow-operator-card__detail-section">
        <div class="workflow-operator-card__detail-title">${escapeHtml(title)}</div>
        ${
          slots.length
            ? `<div class="workflow-operator-card__slot-list">
                ${slots
                  .map(
                    (slot) => `
                      <div class="workflow-operator-card__slot">
                        <strong>${escapeHtml(slot.slot)}</strong>
                        <span>${escapeHtml(slot.label || slot.type)}${slot.required ? ' · required' : ''}</span>
                      </div>`,
                  )
                  .join('')}
              </div>`
            : '<div class="workflow-operator-card__empty">None</div>'
        }
      </div>`;
  }

  function renderWorkflowOperatorParams(operator: WorkflowOperator) {
    const entries = Object.entries(operator.paramsSchema ?? {});
    return `
      <div class="workflow-operator-card__detail-section">
        <div class="workflow-operator-card__detail-title">参数</div>
        ${
          entries.length
            ? `<div class="workflow-operator-card__param-list">
                ${entries
                  .map(([key, field]) => {
                    const enumValues = Array.isArray(field.enum) && field.enum.length ? ` · ${field.enum.join(' | ')}` : '';
                    const defaultValue =
                      field.default === undefined || field.default === null ? '' : ` · default: ${JSON.stringify(field.default)}`;
                    return `
                      <div class="workflow-operator-card__param">
                        <div>
                          <strong>${escapeHtml(key)}</strong>
                          <span>${escapeHtml(field.label || key)}</span>
                        </div>
                        <small>${escapeHtml(`${field.type}${field.required ? ' · required' : ''}${enumValues}${defaultValue}`)}</small>
                        ${field.description ? `<small>${escapeHtml(field.description)}</small>` : ''}
                      </div>`;
                  })
                  .join('')}
              </div>`
            : '<div class="workflow-operator-card__empty">暂无参数</div>'
        }
      </div>`;
  }

  function renderWorkflowOperatorDetails(operator: WorkflowOperator) {
    const documentation = operator.documentation;
    const hasDocumentation =
      Boolean(documentation) &&
      typeof documentation?.usage === 'string' &&
      Array.isArray(documentation.steps) &&
      typeof documentation.example === 'string';
    const doc = hasDocumentation
      ? documentation
      : {
          usage: operator.description || '暂无使用说明。',
          steps: ['配置参数后连接输入输出槽。'],
          example: '{}',
        };
    return `
      <div class="workflow-operator-card__details">
        <div class="workflow-operator-card__detail-section">
          <div class="workflow-operator-card__detail-title">用法</div>
          <p>${escapeHtml(doc.usage)}</p>
        </div>
        <div class="workflow-operator-card__detail-section">
          <div class="workflow-operator-card__detail-title">配置步骤</div>
          <ol class="workflow-operator-card__steps">
            ${doc.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join('')}
          </ol>
        </div>
        <div class="workflow-operator-card__detail-grid">
          ${renderWorkflowOperatorSlotList('输入槽', operator.inputSlots)}
          ${renderWorkflowOperatorSlotList('输出槽', operator.outputSlots)}
        </div>
        ${renderWorkflowOperatorParams(operator)}
        <div class="workflow-operator-card__detail-section">
          <div class="workflow-operator-card__detail-title">示例参数</div>
          <pre class="workflow-operator-card__example"><code>${escapeHtml(doc.example)}</code></pre>
        </div>
      </div>`;
  }

  function renderWorkflowOperatorDetailsModal() {
    const operator = getWorkflowOperatorByKey(activeWorkflowOperatorKey);
    const title = el('workflowOperatorDetailsTitle');
    const subtitle = el('workflowOperatorDetailsSubtitle');
    const body = el('workflowOperatorDetailsBody');
    if (!operator) {
      title.textContent = 'Operator';
      subtitle.textContent = '';
      body.innerHTML = '<div class="workflow-empty">请选择一个 operator</div>';
      return;
    }

    title.textContent = operator.name;
    subtitle.textContent = `${operator.code} · ${getWorkflowOperatorGroupLabel(operator.category)} · ${operator.inputSlots.length} in · ${operator.outputSlots.length} out`;
    body.innerHTML = renderWorkflowOperatorDetails(operator);
  }

  function renderWorkflowOperators() {
    const container = el('workflowOperators');
    if (!workflowOperators.length) {
      container.innerHTML = '<div class="workflow-empty">暂无算子</div>';
      localizeWorkflowDom();
      return;
    }
    container.innerHTML = getGroupedWorkflowOperators()
      .map(
        (group) => `
        <section class="workflow-operator-group">
          <div class="workflow-operator-group__header">
            <span>${escapeHtml(group.label[lang()])}</span>
            <span>${group.operators.length}</span>
          </div>
          <div class="workflow-operator-group__list">
            ${group.operators
              .map(
                (operator) => {
                  const operatorKey = getWorkflowOperatorKey(operator);
                  return `
                <div class="workflow-operator-card" role="button" tabindex="0" data-workflow-operator-key="${escapeHtml(operatorKey)}" aria-label="Open ${escapeHtml(operator.name)} documentation">
                  <div class="workflow-operator-card__head">
                    <span class="workflow-operator-card__name">${escapeHtml(operator.name)}</span>
                    <span class="workflow-operator-card__open">Details</span>
                  </div>
                  <div class="workflow-operator-card__code">${escapeHtml(operator.code)}</div>
                  <div class="workflow-operator-card__desc">${escapeHtml(operator.description)}</div>
                  <div class="workflow-operator-card__meta">${escapeHtml(getWorkflowOperatorGroupLabel(operator.category))} · ${operator.inputSlots.length} in · ${operator.outputSlots.length} out</div>
                </div>`;
                },
              )
              .join('')}
          </div>
        </section>`,
      )
      .join('');

    container.querySelectorAll<HTMLElement>('[data-workflow-operator-key]').forEach((card) => {
      const open = () => {
        const operatorKey = card.dataset.workflowOperatorKey ?? '';
        if (operatorKey) openWorkflowOperatorDetailsModal(operatorKey);
      };
      card.addEventListener('click', open);
      card.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        open();
      });
    });
    localizeWorkflowDom();
  }

  async function createWorkflow() {
    const nextCodeBase = `workflow_${Date.now()}`;
    const created = await api<WorkflowDefinition>('/api/workflows', {
      method: 'POST',
      body: JSON.stringify({
        code: nextCodeBase,
        name: 'New Workflow',
        description: '',
        status: 'draft',
        version: 1,
        tasks: [],
        runtimeParamsSchema: {},
        runtimeParamsDefaults: {},
      }),
    });
    resetWorkflowRunState(created.id);
    await loadWorkflows(created.id);
  }

  async function duplicateWorkflow(workflowId: number | null = activeWorkflowId) {
    const workflow = workflowDefinitions.find((item) => item.id === workflowId) ?? null;
    if (!workflow) {
      notify('请先选择一个工作流', { type: 'warning' });
      return;
    }
    const suffix = Date.now();
    const baseCode = (workflow.code || 'workflow').trim().replace(/[^a-zA-Z0-9-_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'workflow';
    const created = await api<WorkflowDefinition>('/api/workflows', {
      method: 'POST',
      body: JSON.stringify({
        code: `${baseCode}-copy-${suffix}`,
        name: `${workflow.name} Copy`,
        description: workflow.description,
        status: 'draft',
        version: workflow.version,
        tasks: cloneJson(workflow.tasks),
        runtimeParamsSchema: cloneJson(workflow.runtimeParamsSchema),
        runtimeParamsDefaults: cloneJson(workflow.runtimeParamsDefaults),
      }),
    });
    resetWorkflowRunState(created.id);
    await loadWorkflows(created.id);
  }

  function addWorkflowTask() {
    if (!getActiveWorkflow()) return;
    openWorkflowOperatorPickerModal();
  }

  function confirmAddWorkflowTask() {
    const workflow = getActiveWorkflow();
    if (!workflow) return;
    const operatorKey = pendingWorkflowOperatorKey ?? el<HTMLSelectElement>('workflowOperatorPickerSelect').value;
    const operator = workflowOperators.find((item) => getWorkflowOperatorKey(item) === operatorKey);
    if (!operator) {
      notify('请选择一个算子', { type: 'warning' });
      return;
    }
    const nextIndex = workflow.tasks.length + 1;
    workflow.tasks.push(buildWorkflowTask(operator, nextIndex));
    activeWorkflowTaskId = workflow.tasks[workflow.tasks.length - 1]?.id ?? null;
    activeWorkflowPreview = null;
    workflowPreviewPage = 1;
    resetWorkflowRunState(workflow.id);
    renderWorkflowEditor();
    closeWorkflowOperatorPickerModal();
    openWorkflowTaskModal();
  }

  function removeWorkflowTask() {
    const workflow = getActiveWorkflow();
    const task = getActiveWorkflowTask();
    if (!workflow || !task) return;
    workflow.tasks = workflow.tasks.filter((item) => item.id !== task.id);
    activeWorkflowTaskId = null;
    activeWorkflowPreview = null;
    workflowPreviewPage = 1;
    resetWorkflowRunState(workflow.id);
    renderWorkflowEditor();
    closeWorkflowTaskModal();
  }

  function syncTaskEditorToState() {
    const task = getActiveWorkflowTask();
    if (!task) return;
    task.name = el<HTMLInputElement>('taskNameInput').value.trim() || task.name;
    task.description = el<HTMLTextAreaElement>('taskDescriptionInput').value.trim();
    try {
      task.params = JSON.parse(el<HTMLTextAreaElement>('taskParamsInput').value || '{}') as Record<string, unknown>;
    } catch {
      return;
    }
    applyTaskOperatorDefaults(task);
    activeWorkflowPreview = null;
    workflowPreviewPage = 1;
    resetWorkflowRunState(activeWorkflowId);
    renderWorkflowEditor();
  }

  async function saveWorkflow() {
    const workflow = getActiveWorkflow();
    if (!workflow) return;
    const name = el<HTMLInputElement>('workflowNameInput').value.trim();
    if (!name) {
      notify('Workflow name 不能为空', { type: 'warning' });
      return;
    }

    workflow.name = name;
    syncVisibleRuntimeDefaultsToWorkflow(workflow);

    try {
      await persistWorkflowDefinition(workflow, { reload: true });
      resetWorkflowRunState(workflow.id);
      notify('工作流配置已保存', { type: 'success' });
    } catch (error) {
      notify(`保存失败：${error instanceof Error ? error.message : '未知错误'}`, { type: 'error' });
    }
  }

  async function deleteWorkflow() {
    const workflow = getActiveWorkflow();
    if (!workflow) return;
    if (!(await confirmAction(`确定删除工作流 ${workflow.name} 吗？`, { title: '删除工作流', confirmText: '删除', tone: 'danger' }))) return;
    await api(`/api/workflows/${workflow.id}`, { method: 'DELETE' });
    resetWorkflowRunState();
    await loadWorkflows();
  }

  function onActivate() {
    const workflow = getActiveWorkflow();
    if (!workflow) return;

    // Recompute node/handle geometry after the hidden page becomes visible.
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        renderWorkflowEditor();
      });
    });
  }

  return {
    init,
    onActivate,
    applyLanguage() {
      renderWorkflowLayout();
      renderWorkflowList();
      renderWorkflowEditor();
      renderWorkflowOperators();
      localizeWorkflowDom();
    },
  };
}

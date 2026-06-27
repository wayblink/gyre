import type {
  WorkflowExecutionResult,
  WorkflowExecutionTaskState,
  ProductFileRecord,
  WorkflowAssertFailureStrategy,
  WorkflowAssertionResult,
  WorkflowAssertOperator,
  WorkflowExecuteRequest,
  WorkflowDataFrame,
  WorkflowDefinition,
  WorkflowImportExportBundle,
  WorkflowOperator,
  WorkflowSqlTableBinding,
  WorkflowTask,
  WorkflowTaskPreviewResult,
  WorkflowTaskPreviewRequest,
} from '../shared/types.js';
import {
  applyTaskOperatorDefaults,
  buildWorkflowTask,
  getAssertFailureStrategy,
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
  nextSqlInputSlotName,
  normalizeAssertTask,
  normalizePersistExcelTask,
  normalizeSchemaAssertTask,
  normalizeShapeAssertTask,
  normalizeSheetSectionsExtractTask,
  normalizeSqlTask,
  normalizeTaskDependencies,
} from './workflow/taskOperators.js';

type DomGetter = <T extends HTMLElement>(id: string) => T;

type WorkflowPageDeps = {
  el: DomGetter;
  api: <T>(url: string, options?: RequestInit) => Promise<T>;
  escapeHtml: (text: unknown) => string;
  getProductFiles: () => ProductFileRecord[];
  refreshProductFiles: () => Promise<unknown>;
};

export function createWorkflowPage({ el, api, escapeHtml, getProductFiles, refreshProductFiles }: WorkflowPageDeps) {
  const WORKFLOW_NODE_WIDTH = 248;
  const WORKFLOW_NODE_HEADER_HEIGHT = 78;
  const WORKFLOW_SLOT_ROW_HEIGHT = 26;
  const WORKFLOW_CANVAS_PADDING = 48;
  const WORKFLOW_LAYOUT_COLUMN_GAP = 120;
  const WORKFLOW_LAYOUT_ROW_GAP = 56;
  const WORKFLOW_DRAG_THRESHOLD = 4;
  const WORKFLOW_EXECUTE_STEP_MS = 480;
  const WORKFLOW_PREVIEW_PAGE_SIZE = 20;
  const WORKFLOW_OPERATOR_GROUPS: Array<{ category: WorkflowOperator['category']; label: string }> = [
    { category: 'Input', label: '输入' },
    { category: 'Transform', label: '计算' },
    { category: 'Output', label: '输出' },
    { category: 'Validation', label: '断言' },
  ];
  type WorkflowRunState = {
    isOpen: boolean;
    isRunning: boolean;
    workflowId: number | null;
    activeTaskId: string | null;
    taskStates: Record<string, WorkflowExecutionTaskState>;
    approvedWarningTaskIds: string[];
    waitingForApprovalTaskIds: string[];
    warningTaskIds: string[];
    warningMessages: Record<string, string>;
    message: string;
    errorMessage: string | null;
  };

  let workflowDefinitions: WorkflowDefinition[] = [];
  let workflowOperators: WorkflowOperator[] = [];
  let activeWorkflowId: number | null = null;
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
  let pendingWorkflowConnectionSource: { taskId: string; slot: string } | null = null;
  let workflowRunState: WorkflowRunState = {
    isOpen: false,
    isRunning: false,
    workflowId: null,
    activeTaskId: null,
    taskStates: {},
    approvedWarningTaskIds: [],
    waitingForApprovalTaskIds: [],
    warningTaskIds: [],
    warningMessages: {},
    message: 'Ready to run',
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

  function getWorkflowOperatorKey(operator: WorkflowOperator) {
    return `${operator.code}@${operator.version}`;
  }

  function getWorkflowOperatorGroupLabel(category: WorkflowOperator['category']) {
    return WORKFLOW_OPERATOR_GROUPS.find((group) => group.category === category)?.label ?? category;
  }

  function getGroupedWorkflowOperators() {
    return WORKFLOW_OPERATOR_GROUPS.map((group) => ({
      ...group,
      operators: workflowOperators.filter((operator) => operator.category === group.category),
    })).filter((group) => group.operators.length > 0);
  }

  async function init() {
    el('btnCreateWorkflow').addEventListener('click', () => void createWorkflow());
    el('btnSaveWorkflow').addEventListener('click', () => void saveWorkflow());
    el('btnDeleteWorkflow').addEventListener('click', () => void deleteWorkflow());
    el('btnImportWorkflow').addEventListener('click', () => {
      el<HTMLInputElement>('workflowImportInput').click();
    });
    el('workflowImportInput').addEventListener('change', (event) => {
      void importWorkflow(event);
    });
    el('btnToggleWorkflowSidebar').addEventListener('click', toggleWorkflowSidebar);
    el('workflowCollapsedRail').addEventListener('click', toggleWorkflowSidebar);
    el('btnToggleWorkflowInspector').addEventListener('click', toggleWorkflowInspector);
    el('workflowInspectorCollapsedRail').addEventListener('click', toggleWorkflowInspector);
    el('btnAddWorkflowTask').addEventListener('click', addWorkflowTask);
    el('btnAutoLayoutWorkflow').addEventListener('click', autoLayoutActiveWorkflow);
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
      if (!button) return;
      void continueWorkflowAfterWarning();
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
    el('btnDoneWorkflowTask').addEventListener('click', closeWorkflowTaskModal);
    el('btnCloseWorkflowTaskModal').addEventListener('click', closeWorkflowTaskModal);
    el('workflowTaskModal').addEventListener('click', (event) => {
      if (event.target === el('workflowTaskModal')) closeWorkflowTaskModal();
    });
    el('btnCloseWorkflowBindingPreviewModal').addEventListener('click', closeWorkflowBindingPreviewModal);
    el('workflowBindingPreviewModal').addEventListener('click', (event) => {
      if (event.target === el('workflowBindingPreviewModal')) closeWorkflowBindingPreviewModal();
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
    el('workflowPreviewSheetName').addEventListener('input', syncStructuredTaskParamsToState);
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
  }

  function toggleWorkflowSidebar() {
    isWorkflowSidebarCollapsed = !isWorkflowSidebarCollapsed;
    renderWorkflowLayout();
  }

  function toggleWorkflowInspector() {
    isWorkflowInspectorCollapsed = !isWorkflowInspectorCollapsed;
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
      activeTaskId: null,
      taskStates: {},
      approvedWarningTaskIds: [],
      waitingForApprovalTaskIds: [],
      warningTaskIds: [],
      warningMessages: {},
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
    renderWorkflowList();
    renderWorkflowEditor();
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
    if (!workflow) return alert('请先选择一个工作流');
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
        alert(`工作流已导入，code 已调整为 ${created.code}`);
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : '导入工作流失败');
    } finally {
      if (input) input.value = '';
    }
  }

  function renderWorkflowList() {
    const container = el('workflowList');
    if (!workflowDefinitions.length) {
      container.innerHTML = '<div class="workflow-empty">暂无工作流</div>';
      return;
    }
    container.innerHTML = workflowDefinitions
      .map(
        (workflow) => `
        <div class="workflow-list__item ${workflow.id === activeWorkflowId ? 'is-active' : ''}" data-id="${workflow.id}">
          <div class="workflow-list__main" data-role="select" data-id="${workflow.id}" role="button" tabindex="0">
            <div class="workflow-list__name">${escapeHtml(workflow.name)}</div>
            <div class="workflow-list__desc">${escapeHtml(workflow.description || 'No description')}</div>
            <div class="workflow-list__meta">${workflow.tasks.length} tasks</div>
          </div>
          <div class="workflow-list__actions">
            <button class="btn btn-secondary btn-sm" data-role="export" data-id="${workflow.id}" type="button">Export</button>
            <button class="btn btn-secondary btn-sm" data-role="duplicate" data-id="${workflow.id}" type="button">Copy</button>
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
  }

  function openWorkflowBindingPreviewModal() {
    el('workflowBindingPreviewModal').classList.remove('hidden');
  }

  function closeWorkflowBindingPreviewModal() {
    el('workflowBindingPreviewModal').classList.add('hidden');
  }

  function openWorkflowOperatorPickerModal() {
    if (!workflowOperators.length) {
      alert('暂无可用算子');
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

  function renderWorkflowOperatorPickerOptions() {
    const select = el<HTMLSelectElement>('workflowOperatorPickerSelect');
    select.innerHTML = getGroupedWorkflowOperators()
      .map(
        (group) => `
          <optgroup label="${escapeHtml(group.label)}">
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
      <div>${escapeHtml(operator.description || 'No description')}</div>
      <div style="margin-top:8px;">${escapeHtml(getWorkflowOperatorGroupLabel(operator.category))} · ${operator.inputSlots.length} inputs · ${operator.outputSlots.length} outputs</div>
    `;
  }

  function getWorkflowOperator(task: WorkflowTask): WorkflowOperator | null {
    return workflowOperators.find((item) => item.code === task.operatorCode && item.version === task.operatorVersion) ?? null;
  }

  function getWorkflowNodeHeight(task: WorkflowTask, operator?: WorkflowOperator | null) {
    const slotRows = Math.max(getTaskInputSlots(task, operator).length, getTaskOutputSlots(task, operator).length, 1);
    return WORKFLOW_NODE_HEADER_HEIGHT + slotRows * WORKFLOW_SLOT_ROW_HEIGHT + 18;
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
          const startX = sourceRect.left + sourceRect.width / 2 - canvasRect.left;
          const startY = sourceRect.top + sourceRect.height / 2 - canvasRect.top;
          const endX = targetRect.left + targetRect.width / 2 - canvasRect.left;
          const endY = targetRect.top + targetRect.height / 2 - canvasRect.top;
          return {
            id: `${sourceTask.id}:${sourceSlot}->${task.id}:${targetSlot}`,
            targetTaskId: task.id,
            targetSlot,
            path: getEdgePath(startX, startY, endX, endY),
            labelX: startX + (endX - startX) / 2,
            labelY: startY + (endY - startY) / 2 - 10,
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
          const startX = sourceRect.right - canvasRect.left;
          const startY = sourceRect.top + sourceRect.height / 2 - canvasRect.top;
          const endX = targetRect.left - canvasRect.left;
          const endY = targetRect.top + targetRect.height / 2 - canvasRect.top;
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
    targetTask.inputs[targetSlot] = {
      from: sourceTaskId,
      slot: sourceSlot,
    };
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

  function getWorkflowNodeCategoryBadge(operator: WorkflowOperator | null) {
    const category = operator?.category ?? 'Transform';
    if (category === 'Input') {
      return { code: 'input', label: '输入' };
    }
    if (category === 'Output') {
      return { code: 'output', label: '输出' };
    }
    if (category === 'Validation') {
      return { code: 'validation', label: '断言' };
    }
    return { code: 'transform', label: '计算' };
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
      return;
    }

    const orderedTasks = getWorkflowExecutionOrder(workflow);
    const total = orderedTasks.length;
    const completed = orderedTasks.filter((task) => workflowRunState.taskStates[task.id] === 'completed').length;
    const warnings = orderedTasks.filter((task) => workflowRunState.taskStates[task.id] === 'warning').length;
    const reached = completed + warnings;
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
                : 'Pending';
        const meta = state === 'warning' ? (workflowRunState.warningMessages[task.id] ?? task.operatorCode) : task.operatorCode;
        return `
          <div class="workflow-run-task workflow-run-task--${state}">
            <span class="workflow-run-task__indicator">${escapeHtml(indicator)}</span>
            <div class="workflow-run-task__body">
              <div class="workflow-run-task__topline">
                <div class="workflow-run-task__name">${escapeHtml(task.name)}</div>
                <span class="workflow-run-task__state workflow-run-task__state--${state}">${escapeHtml(stateLabel)}</span>
              </div>
              <div class="workflow-run-task__meta">${escapeHtml(meta)}</div>
            </div>
          </div>
        `;
      })
      .join('');

    if (workflowRunState.errorMessage) {
      footer.innerHTML = `<span class="workflow-run-panel__error">${escapeHtml(workflowRunState.errorMessage)}</span>`;
      return;
    }
    if (!workflowRunState.isRunning && hasWaitingWarning) {
      const waitingNames = workflowRunState.waitingForApprovalTaskIds
        .map((taskId) => orderedTasks.find((task) => task.id === taskId)?.name ?? taskId)
        .join(', ');
      footer.innerHTML = `
        <span class="workflow-run-panel__warning">Warning requires review: ${escapeHtml(waitingNames)}</span>
        <button class="btn btn-warning btn-sm" type="button" data-continue-workflow-warning>Continue</button>
      `;
      return;
    }
    footer.innerHTML =
      !workflowRunState.isRunning && reached === total && total > 0
        ? hasWarningTask
          ? '<span class="workflow-run-panel__warning">Workflow completed with warnings.</span>'
          : '<span class="workflow-run-panel__success">Workflow execution completed.</span>'
        : '<span class="workflow-run-panel__hint">节点会按依赖顺序显示执行状态。</span>';
  }

  function autoLayoutActiveWorkflow() {
    const workflow = getActiveWorkflow();
    if (!workflow || workflow.tasks.length <= 1) return;

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

    activeWorkflowPreview = null;
    workflowPreviewPage = 1;
    renderWorkflowEditor();
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
    task.x = Math.max(WORKFLOW_CANVAS_PADDING / 2, Math.round(workflowDragState.startTaskX + deltaX));
    task.y = Math.max(WORKFLOW_CANVAS_PADDING / 2, Math.round(workflowDragState.startTaskY + deltaY));
    renderWorkflowEditor();
  }

  function finishWorkflowDrag(event: PointerEvent, taskId: string) {
    if (!workflowDragState || workflowDragState.pointerId !== event.pointerId || workflowDragState.taskId !== taskId) return false;
    const didMove = workflowDragState.moved;
    clearWorkflowDragState();
    return didMove;
  }

  function renderWorkflowEditor() {
    const workflow = getActiveWorkflow();
    el<HTMLInputElement>('workflowNameInput').value = workflow?.name ?? '';
    const descriptionText = el('workflowDescriptionText');
    const descriptionDisplayRow = el('workflowDescriptionDisplayRow');
    const descriptionInput = el<HTMLTextAreaElement>('workflowDescriptionInput');
    if (!workflow) {
      descriptionText.textContent = 'No description';
      descriptionDisplayRow.classList.remove('hidden');
      descriptionInput.classList.add('hidden');
      descriptionInput.value = '';
    } else if (editingWorkflowDescriptionId === workflow.id) {
      descriptionText.textContent = workflow.description || 'No description';
      descriptionDisplayRow.classList.add('hidden');
      descriptionInput.classList.remove('hidden');
      descriptionInput.value = editingWorkflowDescriptionDraft;
    } else {
      descriptionText.textContent = workflow.description || 'No description';
      descriptionDisplayRow.classList.remove('hidden');
      descriptionInput.classList.add('hidden');
      descriptionInput.value = workflow.description || '';
    }

    const dag = el('workflowDag');
    if (!workflow) {
      dag.innerHTML = '<div class="workflow-empty">请先创建或选择工作流</div>';
      renderTaskEditor();
      return;
    }

    const operatorsByTaskId = new Map(workflow.tasks.map((task) => [task.id, getWorkflowOperator(task)]));
    const canvasWidth = Math.max(
      960,
      ...workflow.tasks.map((task) => task.x + WORKFLOW_NODE_WIDTH + WORKFLOW_CANVAS_PADDING * 2),
    );
    const canvasHeight = Math.max(
      620,
      ...workflow.tasks.map((task) => task.y + getWorkflowNodeHeight(task, operatorsByTaskId.get(task.id) ?? null) + WORKFLOW_CANVAS_PADDING * 2),
    );

    dag.innerHTML = `
      <div class="workflow-dag__canvas" style="width:${canvasWidth}px;height:${canvasHeight}px;">
        <svg class="workflow-dag__edges" width="${canvasWidth}" height="${canvasHeight}" viewBox="0 0 ${canvasWidth} ${canvasHeight}" aria-hidden="true"></svg>
        ${workflow.tasks
          .map((task) => {
            const operator = operatorsByTaskId.get(task.id) ?? null;
            const categoryBadge = getWorkflowNodeCategoryBadge(operator);
            const inputs = Object.entries(task.inputs ?? {});
            const inputSlots = getTaskInputSlots(task, operator);
            const outputSlots = getTaskOutputSlots(task, operator);
            const slotRows = Math.max(inputSlots.length, outputSlots.length, 1);
            const runState = getWorkflowRunTaskState(task.id);
            const controlDependencyCount = getWorkflowControlDependencies(task).length;
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
                <span class="workflow-node__category workflow-node__category--${escapeHtml(categoryBadge.code)}">${escapeHtml(categoryBadge.label)}</span>
              </div>
              <div class="workflow-node__step">${escapeHtml(operator?.name ?? task.operatorCode)}</div>
              <div class="workflow-node__meta">${escapeHtml(task.id)} · ${inputs.length} inputs · ${controlDependencyCount} deps</div>
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
                    : '<div class="workflow-node__slot workflow-node__slot--empty">No inputs</div>'}
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
        event.stopPropagation();
        const targetTaskId = edge.dataset.edgeTargetTaskId ?? '';
        const targetSlot = edge.dataset.edgeTargetSlot ?? '';
        if (!targetTaskId || !targetSlot) return;
        removeWorkflowConnection(targetTaskId, targetSlot);
      });
    });

    dag.onclick = (event) => {
      if (event.target === dag || (event.target instanceof HTMLElement && event.target.classList.contains('workflow-dag__canvas'))) {
        clearPendingWorkflowConnection();
        renderWorkflowEditor();
      }
    };

    renderTaskEditor();
  }

  function renderTaskEditor() {
    const editor = el('workflowTaskEditor');
    const task = getActiveWorkflowTask();
    const structured = el('workflowStructuredParams');
    const preview = el('workflowPreviewPanel');
    if (!task) {
      editor.classList.add('hidden');
      structured.classList.add('hidden');
      preview.classList.add('hidden');
      closeWorkflowTaskModal();
      return;
    }
    editor.classList.remove('hidden');
    el<HTMLInputElement>('taskNameInput').value = task.name;
    el<HTMLTextAreaElement>('taskDescriptionInput').value = task.description ?? '';
    el<HTMLTextAreaElement>('taskParamsInput').value = JSON.stringify(task.params ?? {}, null, 2);
    renderStructuredTaskParams(task);
    renderWorkflowPreview();
  }

  function getWorkflowTaskCandidates(taskId?: string): WorkflowTask[] {
    const workflow = getActiveWorkflow();
    if (!workflow) return [];
    return workflow.tasks.filter((task) => task.id !== taskId);
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
          <div class="workflow-structured__grid" data-sql-table-row="${index}">
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
            <div class="workflow-structured__actions">
              <button class="btn btn-secondary btn-sm" type="button" data-preview-sql-table="${index}">Preview</button>
              <button class="btn btn-secondary btn-sm" type="button" data-remove-sql-table="${index}">Remove</button>
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
      <div class="workflow-structured__section-subtitle">Use one row per logical table block in the selected sheet. Rows are merged into one dataframe with section metadata columns.</div>
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
              <label class="workflow-structured__label">Header Row</label>
              <input class="search-input workflow-input" data-sheet-section-header-row="${index}" type="number" min="1" value="${
                section.headerRow === null ? '' : escapeHtml(section.headerRow)
              }" placeholder="3">
            </div>
            <div class="workflow-structured__actions">
              <button class="btn btn-secondary btn-sm" type="button" data-remove-sheet-section="${index}">Remove</button>
            </div>
          </div>`,
        )
        .join('')}
    `;

    container.querySelectorAll<HTMLInputElement>('[data-sheet-section-key], [data-sheet-section-title], [data-sheet-section-range], [data-sheet-section-header-row]').forEach((input) => {
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
      sections.push({ key: `section_${nextIndex}`, title: `Section ${nextIndex}`, range: '', headerRow: null });
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
    const candidates = getWorkflowTaskCandidates(task.id);
    normalizeTaskDependencies(task);
    const selected = new Set(task.dependsOn ?? []);

    container.innerHTML = `
      <div class="workflow-structured__section-head">
        <div class="workflow-structured__label">Execution Dependencies</div>
      </div>
      <div class="workflow-structured__section-subtitle">Choose predecessor tasks that must finish successfully before this node can run. This does not replace the Input source.</div>
      ${
        candidates.length
          ? `<div class="workflow-dependency-list">
              ${candidates
                .map(
                  (candidate) => `
                    <label class="workflow-checkbox workflow-checkbox--dependency">
                      <input type="checkbox" data-workflow-dependency-id="${escapeHtml(candidate.id)}" ${selected.has(candidate.id) ? 'checked' : ''}>
                      <span>${escapeHtml(candidate.name)} · ${escapeHtml(candidate.id)}</span>
                    </label>`,
                )
                .join('')}
            </div>`
          : '<div class="workflow-empty" style="align-items:flex-start;">No candidate tasks</div>'
      }
    `;

    container.querySelectorAll<HTMLInputElement>('[data-workflow-dependency-id]').forEach((input) => {
      input.addEventListener('change', syncStructuredTaskParamsToState);
    });
  }

  function syncTaskParamsTextarea(task: WorkflowTask) {
    el<HTMLTextAreaElement>('taskParamsInput').value = JSON.stringify(task.params ?? {}, null, 2);
  }

  function renderStructuredTaskParams(task: WorkflowTask) {
    const structured = el('workflowStructuredParams');
    if (
      !isSheetRangeExtractTask(task) &&
      !isSheetSectionsExtractTask(task) &&
      !isSqlTableBackedTask(task) &&
      !isPersistExcelTask(task) &&
      !isAnyAssertTask(task)
    ) {
      structured.classList.add('hidden');
      return;
    }

    structured.classList.remove('hidden');

    const fileSelect = el<HTMLSelectElement>('workflowPreviewFileId');
    fileSelect.innerHTML = [
      '<option value="">Select file</option>',
      ...getProductFiles().map((file) => `<option value="${file.id}">${escapeHtml(file.originalName)}</option>`),
    ].join('');

    const fileRow = el('workflowStructuredFileRow');
    const sheetRow = el('workflowStructuredSheetRow');
    const rangeRow = el('workflowStructuredRangeRow');
    const headerRow = el('workflowStructuredHeaderRow');
    const sectionsRow = el('workflowStructuredSectionsRow');
    const dependenciesRow = el('workflowStructuredDependenciesRow');
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

    fileRow.classList.add('hidden');
    sheetRow.classList.add('hidden');
    rangeRow.classList.add('hidden');
    headerRow.classList.add('hidden');
    sectionsRow.classList.add('hidden');
    dependenciesRow.classList.remove('hidden');
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
    renderTaskDependencies(task);

    if (isSheetRangeExtractTask(task)) {
      fileRow.classList.remove('hidden');
      sheetRow.classList.remove('hidden');
      rangeRow.classList.remove('hidden');
      headerRow.classList.remove('hidden');

      const fileId = typeof task.params.fileId === 'number' && Number.isFinite(task.params.fileId) ? task.params.fileId : null;
      fileSelect.value = fileId ? String(fileId) : '';
      el<HTMLInputElement>('workflowPreviewSheetName').value = String(task.params.sheetName ?? '');
      el<HTMLInputElement>('workflowPreviewRange').value = String(task.params.range ?? '');
      el<HTMLInputElement>('workflowPreviewHeaderRow').value =
        task.params.headerRow === null || task.params.headerRow === undefined ? '' : String(task.params.headerRow);
    }

    if (isSheetSectionsExtractTask(task)) {
      normalizeSheetSectionsExtractTask(task);
      fileRow.classList.remove('hidden');
      sheetRow.classList.remove('hidden');
      sectionsRow.classList.remove('hidden');

      const fileId = typeof task.params.fileId === 'number' && Number.isFinite(task.params.fileId) ? task.params.fileId : null;
      fileSelect.value = fileId ? String(fileId) : '';
      el<HTMLInputElement>('workflowPreviewSheetName').value = String(task.params.sheetName ?? '');
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
  }

  function syncStructuredTaskParamsToState() {
    const task = getActiveWorkflowTask();
    if (!task) return;

    if (isSheetRangeExtractTask(task)) {
      const selected = el<HTMLSelectElement>('workflowPreviewFileId').value;
      task.params.fileId = selected ? Number(selected) : null;
      task.params.sheetName = el<HTMLInputElement>('workflowPreviewSheetName').value.trim();
      task.params.range = el<HTMLInputElement>('workflowPreviewRange').value.trim();
      const headerRowValue = el<HTMLInputElement>('workflowPreviewHeaderRow').value.trim();
      task.params.headerRow = headerRowValue ? Number(headerRowValue) : null;
    }

    if (isSheetSectionsExtractTask(task)) {
      const selected = el<HTMLSelectElement>('workflowPreviewFileId').value;
      task.params.fileId = selected ? Number(selected) : null;
      task.params.sheetName = el<HTMLInputElement>('workflowPreviewSheetName').value.trim();
      task.params.sections = Array.from(document.querySelectorAll<HTMLElement>('[data-sheet-section-row]'))
        .map((row, index) => {
          const key =
            row.querySelector<HTMLInputElement>(`[data-sheet-section-key="${index}"]`)?.value.trim() || `section_${index + 1}`;
          const title = row.querySelector<HTMLInputElement>(`[data-sheet-section-title="${index}"]`)?.value.trim() || key;
          const range = row.querySelector<HTMLInputElement>(`[data-sheet-section-range="${index}"]`)?.value.trim() ?? '';
          const headerRowValue = row.querySelector<HTMLInputElement>(`[data-sheet-section-header-row="${index}"]`)?.value.trim() ?? '';
          return {
            key,
            title,
            range,
            headerRow: headerRowValue ? Number(headerRowValue) : null,
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
          nextInputs[inputSlot] = { from: upstreamTaskId, slot: 'dataframe' };
          return { tableName, inputSlot };
        })
        .filter((item): item is WorkflowSqlTableBinding => Boolean(item));

      task.inputs = Object.keys(nextInputs).length ? nextInputs : { input1: { from: '', slot: 'dataframe' } };
      normalizeSqlTask(task);
    }

    if (isPersistExcelTask(task)) {
      task.params.fileName = el<HTMLInputElement>('workflowPersistFileName').value.trim();
      task.params.sheetName = el<HTMLInputElement>('workflowPersistSheetName').value.trim();
      task.params.uploadedBy = el<HTMLInputElement>('workflowPersistUploadedBy').value.trim();
      task.inputs = {
        input1: {
          from: el<HTMLSelectElement>('workflowPersistInputSource').value.trim(),
          slot: 'dataframe',
        },
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
        input1: {
          from: el<HTMLSelectElement>('workflowAssertInputSource').value.trim(),
          slot: 'dataframe',
        },
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
        input1: {
          from: el<HTMLSelectElement>('workflowAssertInputSource').value.trim(),
          slot: 'dataframe',
        },
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
        input1: {
          from: el<HTMLSelectElement>('workflowAssertInputSource').value.trim(),
          slot: 'dataframe',
        },
      };
      normalizeShapeAssertTask(task);
    }

    task.dependsOn = Array.from(document.querySelectorAll<HTMLInputElement>('[data-workflow-dependency-id]:checked'))
      .map((input) => input.dataset.workflowDependencyId?.trim() ?? '')
      .filter(Boolean);
    normalizeTaskDependencies(task);

    syncTaskParamsTextarea(task);
    renderWorkflowEditor();
  }

  async function previewWorkflowTask() {
    const task = getActiveWorkflowTask();
    if (!task) return;

    const workflow = getActiveWorkflow();
    if (!workflow) return;

    const payload: WorkflowTaskPreviewRequest = {
      workflowId: workflow.id,
      taskId: task.id,
      tasks: workflow.tasks,
    };

    activeWorkflowPreview = await api<WorkflowTaskPreviewResult>('/api/workflows/preview-task', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    workflowPreviewPage = 1;
    if (activeWorkflowPreview.kind === 'file') {
      await refreshProductFiles();
    }
    renderWorkflowPreview();
  }

  async function executeWorkflow(options: { approvedWarningTaskIds?: string[]; isResume?: boolean } = {}) {
    const workflow = getActiveWorkflow();
    if (!workflow) return;
    if (!workflow.tasks.length) {
      alert('当前工作流没有任务');
      return;
    }

    const approvedWarningTaskIds = options.approvedWarningTaskIds ?? [];
    const payload: WorkflowExecuteRequest = {
      tasks: workflow.tasks,
      approvedWarningTaskIds,
    };
    const executionOrder = getWorkflowExecutionOrder(workflow);
    resetWorkflowRunState(workflow.id);
    workflowRunState.isOpen = true;
    workflowRunState.isRunning = true;
    workflowRunState.approvedWarningTaskIds = approvedWarningTaskIds;
    workflowRunState.message = options.isResume ? `Continuing ${workflow.name}` : `Executing ${workflow.name}`;
    renderWorkflowEditor();

    workflowRunState.taskStates = Object.fromEntries(
      executionOrder.map((task) => [task.id, 'pending' as WorkflowExecutionTaskState]),
    );
    try {
      const result = await api<WorkflowExecutionResult>(`/api/workflows/${workflow.id}/execute`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      workflowRunState.warningTaskIds = result.warningTaskIds;
      workflowRunState.waitingForApprovalTaskIds = result.waitingForApprovalTaskIds;
      workflowRunState.warningMessages = Object.fromEntries(result.warnings.map((warning) => [warning.taskId, warning.message]));

      for (const [index, task] of executionOrder.entries()) {
        const finalState = result.taskStates[task.id] ?? 'pending';
        const shouldAnimate = finalState === 'completed' || finalState === 'failed' || finalState === 'warning';
        workflowRunState.activeTaskId = shouldAnimate ? task.id : null;

        if (shouldAnimate) {
          workflowRunState.taskStates[task.id] = 'running';
          workflowRunState.message = `Running ${task.name} (${index + 1}/${executionOrder.length})`;
          renderWorkflowEditor();
          await wait(WORKFLOW_EXECUTE_STEP_MS);
        }

        workflowRunState.activeTaskId = null;
        workflowRunState.taskStates[task.id] = finalState;
        workflowRunState.message =
          finalState === 'blocked'
            ? `${task.name} blocked by dependency`
            : finalState === 'failed'
              ? `${task.name} failed`
              : finalState === 'warning'
                ? result.waitingForApprovalTaskIds.includes(task.id)
                  ? `${task.name} requires review`
                  : `${task.name} completed with warning`
              : finalState === 'completed'
                ? `${task.name} completed`
                : `${task.name} pending`;
        renderWorkflowEditor();
        await wait(finalState === 'blocked' ? 120 : 60);
      }

      activeWorkflowPreview = result.result;
      workflowPreviewPage = 1;
      if (activeWorkflowPreview?.kind === 'file') {
        await refreshProductFiles();
      }
      workflowRunState.isRunning = false;
      workflowRunState.activeTaskId = null;
      workflowRunState.taskStates = result.taskStates;
      const hasWaitingWarning = result.waitingForApprovalTaskIds.length > 0;
      const hasWarning = result.warningTaskIds.length > 0;
      workflowRunState.message = result.failedTaskId
        ? 'Workflow execution failed'
        : hasWaitingWarning
          ? 'Workflow requires review before continuing'
          : hasWarning
            ? `Workflow ${workflow.name} completed with warnings`
            : `Workflow ${workflow.name} completed`;
      workflowRunState.errorMessage = result.errorMessage;
      renderWorkflowEditor();
      renderWorkflowPreview();
      if (!result.failedTaskId && !hasWaitingWarning) {
        window.setTimeout(() => {
          if (workflowRunState.workflowId === workflow.id && !workflowRunState.isRunning) {
            alert(hasWarning ? '任务完成（包含 Warning）' : '任务完成');
          }
        }, 120);
      }
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

  async function continueWorkflowAfterWarning() {
    const workflow = getActiveWorkflow();
    if (!workflow || workflowRunState.isRunning) return;
    const waitingTaskIds = workflowRunState.waitingForApprovalTaskIds.filter(Boolean);
    if (!waitingTaskIds.length) return;
    const approvedWarningTaskIds = Array.from(new Set([...workflowRunState.approvedWarningTaskIds, ...waitingTaskIds]));
    await executeWorkflow({ approvedWarningTaskIds, isResume: true });
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
      alert('当前绑定还没有关联上游任务');
      return;
    }

    const sourceTask = workflow.tasks.find((item) => item.id === sourceTaskId);
    if (!sourceTask) {
      alert('未找到绑定的上游任务');
      return;
    }

    const payload: WorkflowTaskPreviewRequest = {
      workflowId: workflow.id,
      taskId: sourceTask.id,
      tasks: workflow.tasks,
    };

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
                            ${dataFrame.columns.map((column) => `<td>${escapeHtml(row[column])}</td>`).join('')}
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
      return;
    }

    panel.classList.remove('hidden');

    if (!activeWorkflowPreview) {
      summary.innerHTML = '<div class="workflow-empty">点击 Preview 执行当前节点，或点击 Execute 运行整个工作流</div>';
      table.innerHTML = '';
      return;
    }

    const preview = activeWorkflowPreview;
    if (preview.kind === 'file') {
      summary.innerHTML = `
        <div class="workflow-preview__summary-item"><strong>File</strong><span>${escapeHtml(preview.file.originalName)}</span></div>
        <div class="workflow-preview__summary-item"><strong>File ID</strong><span>${escapeHtml(preview.file.id)}</span></div>
        <div class="workflow-preview__summary-item"><strong>Sheets</strong><span>${escapeHtml(preview.file.workbookSheetCount)}</span></div>
        <div class="workflow-preview__summary-item"><strong>Rows</strong><span>${escapeHtml(preview.file.workbookRowCount)}</span></div>
      `;
      table.innerHTML = `
        <div class="workflow-empty" style="align-items:flex-start;">
          文件已持久化到 Files。你可以到 Files 页查看或下载，也可以继续使用该节点输出的 dataframe。
        </div>
      `;
      return;
    }

    if (preview.kind === 'assert') {
      renderAssertionPreview(preview.assertion, preview.dataFrame);
      return;
    }

    const dataFrame = preview.dataFrame;
    workflowPreviewPage = clampWorkflowPreviewPage(workflowPreviewPage, dataFrame.rows.length);
    summary.innerHTML = `
      <div class="workflow-preview__summary-item"><strong>Rows</strong><span>${escapeHtml(dataFrame.rows.length)}</span></div>
      <div class="workflow-preview__summary-item"><strong>Columns</strong><span>${escapeHtml(dataFrame.columns.length)}</span></div>
    `;
    table.innerHTML = renderWorkflowDataFramePreviewTable(dataFrame, workflowPreviewPage, 'workflowPreviewPage');
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

  function renderWorkflowOperators() {
    const container = el('workflowOperators');
    if (!workflowOperators.length) {
      container.innerHTML = '<div class="workflow-empty">暂无算子</div>';
      return;
    }
    container.innerHTML = getGroupedWorkflowOperators()
      .map(
        (group) => `
        <section class="workflow-operator-group">
          <div class="workflow-operator-group__header">
            <span>${escapeHtml(group.label)}</span>
            <span>${group.operators.length}</span>
          </div>
          <div class="workflow-operator-group__list">
            ${group.operators
              .map(
                (operator) => `
                <div class="workflow-operator-card">
                  <div class="workflow-operator-card__head">
                    <strong>${escapeHtml(operator.name)}</strong>
                  </div>
                  <div class="workflow-operator-card__code">${escapeHtml(operator.code)}</div>
                  <div class="workflow-operator-card__desc">${escapeHtml(operator.description)}</div>
                  <div class="workflow-operator-card__meta">${escapeHtml(getWorkflowOperatorGroupLabel(operator.category))} · ${operator.inputSlots.length} in · ${operator.outputSlots.length} out</div>
                </div>`,
              )
              .join('')}
          </div>
        </section>`,
      )
      .join('');
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
      }),
    });
    resetWorkflowRunState(created.id);
    await loadWorkflows(created.id);
  }

  async function duplicateWorkflow(workflowId: number | null = activeWorkflowId) {
    const workflow = workflowDefinitions.find((item) => item.id === workflowId) ?? null;
    if (!workflow) return alert('请先选择一个工作流');
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
    if (!operator) return alert('请选择一个算子');
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
    if (!name) return alert('Workflow name 不能为空');

    workflow.name = name;

    await api(`/api/workflows/${workflow.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        code: workflow.code,
        name: workflow.name,
        description: workflow.description,
        status: workflow.status,
        version: workflow.version,
        tasks: workflow.tasks,
      }),
    });
    resetWorkflowRunState(workflow.id);
    await loadWorkflows(workflow.id);
  }

  async function deleteWorkflow() {
    const workflow = getActiveWorkflow();
    if (!workflow) return;
    if (!confirm(`确定删除工作流 ${workflow.name} 吗？`)) return;
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
  };
}

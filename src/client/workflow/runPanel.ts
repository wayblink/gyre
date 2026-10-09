import { getWorkflowExecutionOrder } from './dagLayout.js';
import type { WorkflowDefinition, WorkflowExecutionTaskState, WorkflowRunState } from '../../shared/types.js';

/**
 * The workflow run panel: progress, per-task status and the review/cancel footer.
 *
 * It is a pure projection of the run state onto the DOM, which is what made it worth separating from
 * the 3.8k-line workflowPage factory — the canvas, the task editor and the run controls all mutate
 * the run state, and this is the only place that decides what the user sees because of it.
 */

export type WorkflowRunPanelDeps = {
  el: <T extends HTMLElement>(id: string) => T;
  escapeHtml: (text: unknown) => string;
  /** The workflow the panel is showing (null when nothing is selected). */
  getWorkflow: () => WorkflowDefinition | null;
  getRunState: () => WorkflowRunState;
  /** Re-run the static DOM translation pass after rendering. */
  localizeDom: () => void;
};

const TASK_INDICATORS: Record<WorkflowExecutionTaskState | 'pending', string> = {
  completed: '✓',
  running: '…',
  failed: '!',
  warning: '!',
  blocked: '·',
  skipped: '–',
  pending: '',
};

/**
 * Status of one task in the current run, or null when the panel is not showing this workflow.
 */
export function workflowRunTaskState(
  taskId: string,
  activeWorkflowId: number | null,
  runState: WorkflowRunState,
): WorkflowExecutionTaskState | null {
  if (!activeWorkflowId || runState.workflowId !== activeWorkflowId || !runState.isOpen) return null;
  if (runState.activeTaskId === taskId) return 'running';
  return runState.taskStates[taskId] ?? 'pending';
}

export function createWorkflowRunPanel(deps: WorkflowRunPanelDeps) {
  const { el, escapeHtml } = deps;

  function taskStateLabel(state: WorkflowExecutionTaskState | 'pending', isWaiting: boolean): string {
    switch (state) {
      case 'completed':
        return 'Completed';
      case 'running':
        return 'Running';
      case 'failed':
        return 'Failed';
      case 'warning':
        return isWaiting ? 'Needs Review' : 'Warning';
      case 'blocked':
        return 'Blocked';
      case 'skipped':
        return 'Skipped';
      default:
        return 'Pending';
    }
  }

  function taskIndicator(state: WorkflowExecutionTaskState | 'pending', index: number): string {
    return TASK_INDICATORS[state] || String(index + 1).padStart(2, '0');
  }

  function render() {
    const panel = el('workflowRunPanel');
    const summary = el('workflowRunSummary');
    const progressBar = el('workflowRunProgressBar');
    const progressText = el('workflowRunProgressText');
    const taskList = el('workflowRunTaskList');
    const footer = el('workflowRunFooter');
    const toggleButton = el<HTMLButtonElement>('btnToggleWorkflowRunPanel');
    const headerTitle = panel.querySelector<HTMLHeadingElement>('.workflow-run-panel__header h3');
    const workflow = deps.getWorkflow();
    const runState = deps.getRunState();

    if (!workflow || !runState.isOpen || runState.workflowId !== workflow.id) {
      panel.classList.add('hidden');
      deps.localizeDom();
      return;
    }

    const orderedTasks = getWorkflowExecutionOrder(workflow);
    const total = orderedTasks.length;
    const completed = orderedTasks.filter((task) => runState.taskStates[task.id] === 'completed').length;
    const warnings = orderedTasks.filter((task) => runState.taskStates[task.id] === 'warning').length;
    const skipped = orderedTasks.filter((task) => runState.taskStates[task.id] === 'skipped').length;
    const reached = completed + warnings + skipped;
    const ratio = total ? Math.min(1, reached / total) : 0;
    const hasFailedTask = orderedTasks.some((task) => runState.taskStates[task.id] === 'failed');
    const hasWarningTask = orderedTasks.some((task) => runState.taskStates[task.id] === 'warning');
    const hasWaitingWarning = runState.waitingForApprovalTaskIds.length > 0;
    const executionStatus = hasFailedTask
      ? { code: 'failed', label: 'Failed' }
      : hasWaitingWarning
        ? { code: 'warning', label: 'Needs Review' }
        : runState.isRunning
          ? { code: 'running', label: 'Running' }
          : !runState.isRunning && reached === total && total > 0 && hasWarningTask
            ? { code: 'warning', label: 'Warning' }
            : !runState.isRunning && completed === total && total > 0
              ? { code: 'completed', label: 'Completed' }
              : { code: 'idle', label: 'Idle' };

    panel.classList.remove('hidden');
    panel.classList.toggle('is-running', runState.isRunning);
    panel.classList.toggle('is-finished', !runState.isRunning && reached > 0 && !hasFailedTask && !hasWaitingWarning);
    panel.classList.toggle('is-failed', hasFailedTask);
    panel.classList.toggle('is-warning', hasWarningTask);
    if (headerTitle) {
      headerTitle.innerHTML = `Execution <span class="workflow-run-panel__status workflow-run-panel__status--${executionStatus.code}">${escapeHtml(executionStatus.label)}</span>`;
    }
    summary.textContent = runState.message;
    toggleButton.textContent = runState.isRunning ? 'Collapse' : 'Hide';
    progressBar.style.width = `${ratio * 100}%`;
    progressText.textContent = hasWaitingWarning ? `${reached} / ${total} · review required` : `${reached} / ${total}`;
    taskList.innerHTML = orderedTasks
      .map((task, index) => {
        const state = workflowRunTaskState(task.id, workflow.id, runState) ?? 'pending';
        const isWaiting = runState.waitingForApprovalTaskIds.includes(task.id);
        const indicator = taskIndicator(state, index);
        const stateLabel = taskStateLabel(state, isWaiting);
        const detailMessage = runState.taskMessages[task.id] ?? '';
        const meta =
          state === 'warning'
            ? (runState.warningMessages[task.id] ?? task.operatorCode)
            : task.description || task.operatorCode;
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

    if (runState.errorMessage) {
      footer.innerHTML = `
        <div class="workflow-run-panel__review">
          <span class="workflow-run-panel__error">${escapeHtml(runState.errorMessage)}</span>
        </div>
      `;
      deps.localizeDom();
      return;
    }
    if (!runState.isRunning && hasWaitingWarning) {
      const waitingNames = runState.waitingForApprovalTaskIds
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
      deps.localizeDom();
      return;
    }
    if (runState.isRunning && runState.runId) {
      footer.innerHTML = `
        <div class="workflow-run-panel__review">
          <div class="workflow-run-panel__actions">
            <button class="btn btn-secondary btn-sm" type="button" data-cancel-workflow-run>Cancel</button>
          </div>
        </div>
      `;
      deps.localizeDom();
      return;
    }
    footer.innerHTML =
      !runState.isRunning && reached === total && total > 0
        ? hasWarningTask
          ? '<span class="workflow-run-panel__warning">Workflow completed with warnings.</span>'
          : '<span class="workflow-run-panel__success">Workflow execution completed.</span>'
        : '<span class="workflow-run-panel__hint">节点会按依赖顺序显示执行状态。</span>';
    deps.localizeDom();
  }

  return { render };
}

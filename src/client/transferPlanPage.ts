import type { AppLanguage } from './i18n.js';
import { createTexts } from './texts.js';
import type { NotifyFn } from './uiFeedback.js';
import type {
  TransferPlanPeriod,
  TransferPlanResponse,
  WorkflowExecutionResult,
  WorkflowPageSourceBinding,
  WorkflowResultFileBinding,
  WorkflowRunRecord,
} from '../shared/types.js';

export type TransferPlanTableView = 'summaryRows' | 'periodRows';

type RenderDeps = {
  escapeHtml: (value: unknown) => string;
  formatNumber: (value: unknown) => string;
};

type TransferPlanTableHtml = {
  headHtml: string;
  bodyHtml: string;
};

function renderCancelledCell(item: TransferPlanPeriod, deps: RenderDeps, editable: boolean): string {
  if (!editable) return deps.formatNumber(item.cancelledQuantity);
  return `
    <input
      class="transfer-plan-cancel-input"
      type="number"
      step="1"
      value="${item.cancelledQuantity}"
      data-transfer-cancelled-period="${deps.escapeHtml(item.period)}"
      aria-label="${deps.escapeHtml(item.period)} cancelled quantity"
    >`;
}

function renderSummaryRowsTable(
  data: TransferPlanResponse,
  deps: RenderDeps,
  editable: boolean,
): TransferPlanTableHtml {
  return {
    headHtml: `
      <tr>
        <th>Summary</th>
        ${data.items.map((item) => `<th>${deps.escapeHtml(item.period)}</th>`).join('')}
        <th>Total</th>
      </tr>`,
    bodyHtml: `
      <tr>
        <th>In total</th>
        ${data.items.map((item) => `<td>${deps.formatNumber(item.inTotal)}</td>`).join('')}
        <td class="transfer-plan-total">${deps.formatNumber(data.totals.inTotal)}</td>
      </tr>
      <tr class="transfer-plan-cancelled-row">
        <th>Options cancelled/forfeited</th>
        ${data.items.map((item) => `<td>${renderCancelledCell(item, deps, editable)}</td>`).join('')}
        <td class="transfer-plan-total">${deps.formatNumber(data.totals.cancelledQuantity)}</td>
      </tr>
      <tr class="transfer-plan-result-row">
        <th>Transfer to Futu</th>
        ${data.items.map((item) => `<td>${deps.formatNumber(item.transferToFutu)}</td>`).join('')}
        <td class="transfer-plan-total">${deps.formatNumber(data.totals.transferToFutu)}</td>
      </tr>`,
  };
}

function renderPeriodRowsTable(data: TransferPlanResponse, deps: RenderDeps, editable: boolean): TransferPlanTableHtml {
  return {
    headHtml: `
      <tr>
        <th>Period</th>
        <th>In total</th>
        <th>Options cancelled/forfeited</th>
        <th>Transfer to Futu</th>
      </tr>`,
    bodyHtml: `
      ${data.items
        .map(
          (item) => `
            <tr>
              <th>${deps.escapeHtml(item.period)}</th>
              <td>${deps.formatNumber(item.inTotal)}</td>
              <td>${renderCancelledCell(item, deps, editable)}</td>
              <td>${deps.formatNumber(item.transferToFutu)}</td>
            </tr>`,
        )
        .join('')}
      <tr class="transfer-plan-result-row">
        <th>Total</th>
        <td class="transfer-plan-total">${deps.formatNumber(data.totals.inTotal)}</td>
        <td class="transfer-plan-total">${deps.formatNumber(data.totals.cancelledQuantity)}</td>
        <td class="transfer-plan-total">${deps.formatNumber(data.totals.transferToFutu)}</td>
      </tr>`,
  };
}

export function renderTransferPlanSummaryTable(
  data: TransferPlanResponse,
  view: TransferPlanTableView,
  deps: RenderDeps,
  options: { editable?: boolean } = {},
): TransferPlanTableHtml {
  if (view === 'periodRows') {
    return renderPeriodRowsTable(data, deps, options.editable ?? false);
  }
  return renderSummaryRowsTable(data, deps, options.editable ?? false);
}

/**
 * The transfer-plan page controller: view mode, edit mode, and the Confirm & Run flow that persists
 * the edited cancellations and runs the workflow.
 *
 * main.ts kept this state (`transferPlanTableView` / `transferPlanEditMode`) and re-derived the
 * button labels from it inside applyLanguage(), so a language switch could disagree with what the
 * page thought it was showing.
 */
export type TransferPlanPageDeps = {
  el: <T extends HTMLElement>(id: string) => T;
  api: <T>(url: string, options?: RequestInit) => Promise<T>;
  escapeHtml: (text: unknown) => string;
  formatNumber: (value: unknown) => string;
  notify: NotifyFn;
  getLanguage: () => AppLanguage;
  setButtonLabel: (id: string, label: string) => void;
  /** Record the bindings the page response carries, for the next update. */
  rememberPageData: (
    page: 'transfer-plan',
    response: {
      workflowSourceBindings?: WorkflowPageSourceBinding[];
      workflowResultFiles?: WorkflowResultFileBinding[];
    },
  ) => void;
  refreshProductFiles: () => Promise<unknown>;
  localizeDom: () => void;
  /** The shared workflow modal, reused for the run progress UI. */
  workflowModal: {
    openProgressModal: (title: string, subtitle: string) => void;
    renderProgress: (run: WorkflowRunRecord) => void;
    statusMessage: (key: 'running' | 'completed' | 'completedWithWarnings' | 'failed', detail?: string) => string;
    pollRunUntilFinished: (runId: number, onProgress?: (run: WorkflowRunRecord) => void) => Promise<WorkflowRunRecord>;
    forceCloseModal: () => void;
    setCloseLocked: (locked: boolean) => void;
  };
};

export type TransferPlanPage = {
  render: () => Promise<void>;
  /** Relabel the page's buttons for the current language (called from applyLanguage). */
  syncLabels: () => void;
  toggleTableView: () => Promise<void>;
  startEdit: () => Promise<void>;
  cancelEdit: () => Promise<void>;
  saveEdit: () => Promise<void>;
};

type TransferPlanEdit = { period: string; cancelledQuantity: number };

export function createTransferPlanPage(deps: TransferPlanPageDeps): TransferPlanPage {
  const { el, api, escapeHtml, formatNumber, notify } = deps;
  const read = createTexts('main');
  const t = (key: Parameters<typeof read>[0]) => read(key, deps.getLanguage());

  let tableView: TransferPlanTableView = 'summaryRows';
  let editMode = false;

  function readEdits(): TransferPlanEdit[] {
    return Array.from(document.querySelectorAll<HTMLInputElement>('[data-transfer-cancelled-period]')).map((input) => {
      const period = input.dataset.transferCancelledPeriod ?? '';
      const cancelledQuantity = Number(input.value);
      if (!period || !Number.isFinite(cancelledQuantity)) {
        input.classList.add('is-invalid');
        throw new Error(t('transferPlanInvalidQuantity'));
      }
      input.classList.remove('is-invalid');
      return { period, cancelledQuantity };
    });
  }

  function syncLabels() {
    deps.setButtonLabel(
      'btnToggleTransferPlanTableView',
      tableView === 'summaryRows' ? t('transposeTable') : t('restoreHorizontal'),
    );
    const toggleButton = el<HTMLButtonElement>('btnToggleTransferPlanTableView');
    toggleButton.setAttribute('aria-pressed', String(tableView === 'periodRows'));
    el('transferPlanEditStatus').textContent = editMode
      ? t('transferPlanEditStatusEditing')
      : t('transferPlanEditStatusIdle');
  }

  async function render() {
    const data = await api<TransferPlanResponse>('/api/transfer-plan');
    deps.rememberPageData('transfer-plan', data);
    el('transferPlanSourceName').textContent = data.sourceFileName;
    el('transferPlanInTotal').textContent = formatNumber(data.totals.inTotal);
    el('transferPlanCancelled').textContent = formatNumber(data.totals.cancelledQuantity);
    el('transferPlanTransferred').textContent = formatNumber(data.totals.transferToFutu);
    el('transferPlanDetailCount').textContent = formatNumber(data.detailCount);

    const table = renderTransferPlanSummaryTable(data, tableView, { escapeHtml, formatNumber }, { editable: editMode });
    el('transferPlanSummaryHead').innerHTML = table.headHtml;
    el('transferPlanSummaryBody').innerHTML = table.bodyHtml;
    el('transferPlanSummaryTable').classList.toggle('table-transfer-plan--transposed', tableView === 'periodRows');
    el('btnEditTransferPlan').classList.toggle('hidden', editMode);
    el('btnSaveTransferPlanEdit').classList.toggle('hidden', !editMode);
    el('btnCancelTransferPlanEdit').classList.toggle('hidden', !editMode);
    document
      .querySelectorAll<HTMLElement>(
        '[data-workflow-update-page="transfer-plan"], [data-workflow-export-page="transfer-plan"]',
      )
      .forEach((button) => {
        button.classList.toggle('hidden', editMode);
      });
    syncLabels();
    deps.localizeDom();
  }

  async function saveEdit() {
    const saveButton = el<HTMLButtonElement>('btnSaveTransferPlanEdit');
    const cancelButton = el<HTMLButtonElement>('btnCancelTransferPlanEdit');
    let edits: TransferPlanEdit[];
    try {
      edits = readEdits();
    } catch (error) {
      notify((error as Error).message, { type: 'error' });
      return;
    }

    saveButton.disabled = true;
    cancelButton.disabled = true;
    el('transferPlanEditStatus').textContent = t('transferPlanSavingStatus');
    deps.workflowModal.openProgressModal(t('transferPlanConfirmAndRun'), t('transferPlanProgressSubtitle'));
    try {
      const result = await api<WorkflowExecutionResult>('/api/transfer-plan/edits', {
        method: 'POST',
        body: JSON.stringify({ edits }),
      });
      const runId = result.run?.id;
      if (!runId) throw new Error('Workflow run was not created');
      if (result.run) deps.workflowModal.renderProgress(result.run);
      el('workflowUpdateStatus').textContent = deps.workflowModal.statusMessage('running', String(runId));
      const run = await deps.workflowModal.pollRunUntilFinished(runId, (next) =>
        deps.workflowModal.renderProgress(next),
      );
      if (run.status !== 'completed' && run.status !== 'completed_with_warnings') {
        throw new Error(run.errorMessage ?? `Workflow ended with status ${run.status}`);
      }
      deps.workflowModal.renderProgress(run);
      el('workflowUpdateStatus').textContent = deps.workflowModal.statusMessage(
        run.status === 'completed_with_warnings' ? 'completedWithWarnings' : 'completed',
      );
      editMode = false;
      await deps.refreshProductFiles();
      await render();
      notify(
        run.status === 'completed_with_warnings' ? t('transferPlanUpdatedWithWarnings') : t('transferPlanUpdated'),
        {
          type: run.status === 'completed_with_warnings' ? 'warning' : 'success',
        },
      );
      deps.workflowModal.forceCloseModal();
    } catch (error) {
      notify((error as Error).message, { type: 'error' });
      el('transferPlanEditStatus').textContent = (error as Error).message;
      el('workflowUpdateStatus').textContent = deps.workflowModal.statusMessage('failed', (error as Error).message);
      el('workflowUpdateProgress').classList.add('is-error');
      deps.workflowModal.setCloseLocked(false);
      el('btnCloseWorkflowUpdateModal').classList.remove('hidden');
    } finally {
      saveButton.disabled = false;
      cancelButton.disabled = false;
    }
  }

  return {
    render,
    syncLabels,
    async toggleTableView() {
      tableView = tableView === 'summaryRows' ? 'periodRows' : 'summaryRows';
      await render();
    },
    async startEdit() {
      editMode = true;
      await render();
    },
    async cancelEdit() {
      editMode = false;
      await render();
    },
    saveEdit,
  };
}

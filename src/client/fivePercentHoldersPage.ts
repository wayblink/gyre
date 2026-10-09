import type { AppLanguage } from './i18n.js';
import { createTexts } from './texts.js';
import type { NotifyFn } from './uiFeedback.js';
import type {
  FixedValueRecord,
  FivePercentHoldersResponse,
  WorkflowExecutionResult,
  WorkflowPageSourceBinding,
  WorkflowResultFileBinding,
} from '../shared/types.js';

/**
 * The 5% Holders page.
 *
 * This page is the only one whose "update" flow is not the shared modal: the four holder numbers are
 * Global Parameters edited inline, so confirming has to persist them and *then* run the workflow.
 * That made it the most stateful page left in main.ts (`fivePercentHoldersEditMode` +
 * `fivePercentHoldersSaving` + the loaded parameter rows), and main's `syncWorkflowActionLabels()`
 * had to reach into the edit mode to decide whether the button said "Update" or "Confirm & Run".
 */

export const FIVE_PERCENT_HOLDER_GLOBAL_PARAMETER_KEYS = {
  gniCommonStock: 'fivePercentHoldersGniCommonStock',
  gniTotalCses: 'fivePercentHoldersGniTotalCses',
  songjiangMaCommonStock: 'fivePercentHoldersSongjiangMaCommonStock',
  songjiangMaTotalCses: 'fivePercentHoldersSongjiangMaTotalCses',
} as const;

const FIVE_PERCENT_HOLDER_GLOBAL_PARAMETER_LABELS: Record<string, string> = {
  [FIVE_PERCENT_HOLDER_GLOBAL_PARAMETER_KEYS.gniCommonStock]: '5% Holders - GNI Group Ltd. Common Stock',
  [FIVE_PERCENT_HOLDER_GLOBAL_PARAMETER_KEYS.gniTotalCses]: '5% Holders - GNI Group Ltd. Total CSEs',
  [FIVE_PERCENT_HOLDER_GLOBAL_PARAMETER_KEYS.songjiangMaCommonStock]: '5% Holders - Songjiang Ma Common Stock',
  [FIVE_PERCENT_HOLDER_GLOBAL_PARAMETER_KEYS.songjiangMaTotalCses]: '5% Holders - Songjiang Ma Total CSEs',
};

export type FivePercentHoldersPageDeps = {
  el: <T extends HTMLElement>(id: string) => T;
  api: <T>(url: string, options?: RequestInit) => Promise<T>;
  escapeHtml: (text: unknown) => string;
  notify: NotifyFn;
  formatNumber: (value: unknown) => string;
  getLanguage: () => AppLanguage;
  /** Display name recorded as `updatedBy` when persisting a parameter. */
  currentUserName: () => string;
  refreshProductFiles: () => Promise<unknown>;
  /** Record the bindings the page response carries, for the next update. */
  rememberPageData: (
    page: 'five-percent-holders',
    response: {
      workflowSourceBindings?: WorkflowPageSourceBinding[];
      workflowResultFiles?: WorkflowResultFileBinding[];
    },
  ) => void;
  /** The shared workflow modal, reused for the run endpoint, binding lookup and polling. */
  workflowModal: {
    bindingFor: (page: 'five-percent-holders', sourceKey: string) => WorkflowPageSourceBinding | null;
    runEndpoint: (page: 'five-percent-holders') => string;
    pollRunUntilFinished: (runId: number) => Promise<{ status: string; errorMessage?: string | null }>;
  };
  /** Re-run the static DOM translation pass after rendering. */
  localizeDom: () => void;
};

export type FivePercentHoldersPage = {
  render: () => Promise<void>;
  /** Relabel the page's action buttons (called from main's applyLanguage). */
  syncActionLabels: () => void;
  isEditMode: () => boolean;
  /** Update button: first click enters edit mode, second click saves and runs. */
  handleUpdateClick: () => Promise<void>;
  cancelEdit: () => Promise<void>;
};

type HolderRow = FivePercentHoldersResponse['items'][number];

export function createFivePercentHoldersPage(deps: FivePercentHoldersPageDeps): FivePercentHoldersPage {
  const { el, api, escapeHtml, notify, formatNumber } = deps;
  const read = createTexts('main');
  const t = (key: Parameters<typeof read>[0]) => read(key, deps.getLanguage());

  let editMode = false;
  let saving = false;
  let globalParameters: FixedValueRecord[] = [];

  function formatHolderPercent(value: number | null): string {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
    return `${(Number(value) * 100).toLocaleString('en-US', { maximumFractionDigits: 3 })}%`;
  }

  function updateButton(): HTMLButtonElement | null {
    return document.querySelector<HTMLButtonElement>('[data-workflow-update-page="five-percent-holders"]');
  }

  function cancelButton(): HTMLButtonElement | null {
    return document.querySelector<HTMLButtonElement>('#btnCancelFivePercentHoldersEdit');
  }

  function setUpdateButtonState() {
    const button = updateButton();
    if (!button) return;
    const label = button.querySelector<HTMLElement>('[data-workflow-action-label]');
    const text = editMode ? t('confirmAndRun') : t('update');
    if (label) {
      label.textContent = text;
    } else {
      button.textContent = text;
    }
    button.disabled = saving;
    const cancel = cancelButton();
    if (cancel) {
      cancel.classList.toggle('hidden', !editMode);
      cancel.disabled = saving;
      cancel.textContent = t('cancel');
    }
  }

  function parameterByKey(key: string): FixedValueRecord | null {
    return globalParameters.find((item) => item.key === key) ?? null;
  }

  function parameterKeyForHolderCell(holderIndex: number, field: 'commonStock' | 'totalCses'): string | null {
    if (holderIndex === 0) {
      return field === 'commonStock'
        ? FIVE_PERCENT_HOLDER_GLOBAL_PARAMETER_KEYS.gniCommonStock
        : FIVE_PERCENT_HOLDER_GLOBAL_PARAMETER_KEYS.gniTotalCses;
    }
    if (holderIndex === 1) {
      return field === 'commonStock'
        ? FIVE_PERCENT_HOLDER_GLOBAL_PARAMETER_KEYS.songjiangMaCommonStock
        : FIVE_PERCENT_HOLDER_GLOBAL_PARAMETER_KEYS.songjiangMaTotalCses;
    }
    return null;
  }

  function renderEditableNumber(item: HolderRow, field: 'commonStock' | 'totalCses', holderIndex: number) {
    const key = parameterKeyForHolderCell(holderIndex, field);
    const fixedValue = key ? parameterByKey(key) : null;
    if (!editMode || item.rowType !== 'holder' || !key) {
      if (item.rowType === 'holder' && key) return formatNumber(fixedValue?.value ?? null);
      return formatNumber(field === 'commonStock' ? item.commonStock : item.totalCses);
    }
    const inputValue = fixedValue?.value ?? '';
    const idAttribute = fixedValue?.id ? ` data-five-percent-fixed-value-id="${fixedValue.id}"` : '';
    return `<input class="form-input fixed-value-inline-input" type="text" inputmode="decimal" value="${escapeHtml(String(inputValue))}"${idAttribute} data-five-percent-fixed-value-key="${escapeHtml(key)}">`;
  }

  async function loadGlobalParameters() {
    const keys = new Set<string>(Object.values(FIVE_PERCENT_HOLDER_GLOBAL_PARAMETER_KEYS));
    const data = await api<{ items: FixedValueRecord[] }>('/api/five-percent-holders/fixed-values');
    globalParameters = data.items.filter((item) => keys.has(item.key) && item.updatedBy !== 'system');
  }

  async function render() {
    const data = await api<FivePercentHoldersResponse>('/api/five-percent-holders');
    await loadGlobalParameters();
    deps.rememberPageData('five-percent-holders', data);
    setUpdateButtonState();
    const summary = data.summary;
    el('fivePercentHoldersSummary').innerHTML = `
    <div class="stat-chip"><span class="stat-chip__label">As of</span><span class="stat-chip__value">${escapeHtml(summary.asOfDate ?? '-')}</span></div>
    <div class="stat-chip"><span class="stat-chip__label">Fully Diluted</span><span class="stat-chip__value">${formatNumber(summary.fullyDiluted)}</span></div>
    <div class="stat-chip"><span class="stat-chip__label">Common Stock OS</span><span class="stat-chip__value">${formatNumber(summary.commonStockOs)}</span></div>`;

    if (data.items.length === 0) {
      el('fivePercentHoldersBody').innerHTML =
        '<tr><td colspan="5" class="table-empty-cell">暂无 5% 股东记录</td></tr>';
      deps.localizeDom();
      return;
    }

    let holderIndex = 0;
    el('fivePercentHoldersBody').innerHTML = data.items
      .map((item) => {
        const rowClass = item.rowType === 'total' ? ' class="table-row--total"' : '';
        const currentHolderIndex = item.rowType === 'holder' ? holderIndex++ : -1;
        return `
      <tr${rowClass}>
        <td style="text-align:left; font-weight:600;">${escapeHtml(item.name)}</td>
        <td class="col-number">${renderEditableNumber(item, 'commonStock', currentHolderIndex)}</td>
        <td class="col-number">${renderEditableNumber(item, 'totalCses', currentHolderIndex)}</td>
        <td class="col-number">${formatHolderPercent(item.pctOfClass)}</td>
        <td class="col-number">${formatHolderPercent(item.pctFullyDiluted)}</td>
      </tr>`;
      })
      .join('');
    deps.localizeDom();
  }

  function readDrafts() {
    const drafts = Array.from(document.querySelectorAll<HTMLInputElement>('[data-five-percent-fixed-value-key]')).map(
      (input) => {
        const rawId = input.dataset.fivePercentFixedValueId;
        const id = rawId ? Number(rawId) : null;
        const key = String(input.dataset.fivePercentFixedValueKey ?? '');
        const value = Number(input.value.replace(/,/g, '').trim());
        if ((id !== null && (!Number.isInteger(id) || id <= 0)) || !key || !Number.isFinite(value)) {
          throw new Error(t('holdersDraftInvalid'));
        }
        return { id, key, value };
      },
    );
    if (drafts.length !== 4) throw new Error(t('holdersDraftCount'));
    return drafts;
  }

  async function runWorkflowWithPreviousSource() {
    const binding = deps.workflowModal.bindingFor('five-percent-holders', 'capitalization_summary');
    const fileId = Number(binding?.fileId);
    const sources = Number.isInteger(fileId) && fileId > 0 ? { capitalization_summary: { fileId } } : {};
    const result = await api<WorkflowExecutionResult>(deps.workflowModal.runEndpoint('five-percent-holders'), {
      method: 'POST',
      body: JSON.stringify({ sources }),
    });
    const runId = result.run?.id;
    if (!runId) throw new Error('Workflow run was not created');
    const run = await deps.workflowModal.pollRunUntilFinished(runId);
    if (run.status !== 'completed' && run.status !== 'completed_with_warnings') {
      throw new Error(run.errorMessage ?? `Workflow ended with status ${run.status}`);
    }
    return run;
  }

  async function saveAndRun() {
    const drafts = readDrafts();
    saving = true;
    setUpdateButtonState();
    try {
      const updatedBy = deps.currentUserName();
      for (const draft of drafts) {
        const payload = {
          key: draft.key,
          label: FIVE_PERCENT_HOLDER_GLOBAL_PARAMETER_LABELS[draft.key] ?? draft.key,
          value: draft.value,
          updatedBy,
        };
        if (draft.id) {
          await api(`/api/fixed-values/${draft.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ value: draft.value, updatedBy }),
          });
        } else {
          await api('/api/fixed-values', {
            method: 'POST',
            body: JSON.stringify(payload),
          });
        }
      }
      notify(t('holdersSavedRunning'), { type: 'success' });
      const run = await runWorkflowWithPreviousSource();
      await deps.refreshProductFiles();
      editMode = false;
      await render();
      notify(run.status === 'completed_with_warnings' ? t('holdersUpdatedWithWarnings') : t('holdersUpdated'), {
        type: run.status === 'completed_with_warnings' ? 'warning' : 'success',
      });
    } catch (error) {
      notify((error as Error).message, { type: 'error' });
    } finally {
      saving = false;
      setUpdateButtonState();
    }
  }

  return {
    render,
    syncActionLabels: setUpdateButtonState,
    isEditMode: () => editMode,
    async handleUpdateClick() {
      if (saving) return;
      if (!editMode) {
        editMode = true;
        await render();
        return;
      }
      await saveAndRun();
    },
    async cancelEdit() {
      if (saving || !editMode) return;
      editMode = false;
      await render();
    },
  };
}

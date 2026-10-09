import type { AppLanguage } from './i18n.js';
import { isWorkflowRunTerminalStatus } from '../shared/workflowRunStatus.js';
import type { FilePickerResult } from './filePickerModal.js';
import type {
  ProductFileRecord,
  WorkflowExecutionResult,
  WorkflowExecutionTaskState,
  WorkflowPageConfig,
  WorkflowPageSourceBinding,
  WorkflowResultFileBinding,
  WorkflowRunRecord,
} from '../shared/types.js';

/**
 * The "update this page" modal shared by the workflow-backed product pages (grant record, exercise
 * record, sold shares, transfer plan, employee management, plan summary, 5% holders).
 *
 * It owns the state that used to live at module level in main.ts: the per-page workflow configs, the
 * source/result bindings the last run recorded, the modal's selection drafts and its close lock.
 */

export type WorkflowUpdatePageKey =
  | 'grant-record'
  | 'exercise-record'
  | 'sold-shares'
  | 'transfer-plan'
  | 'employee-management'
  | 'plan-summary'
  | 'five-percent-holders';

type WorkflowUpdateKind = 'esop' | 'data-management';

export type WorkflowUpdateModalDeps = {
  el: <T extends HTMLElement>(id: string) => T;
  api: <T>(url: string, options?: RequestInit) => Promise<T>;
  escapeHtml: (text: unknown) => string;
  notify: (message: string, options?: { type?: 'info' | 'success' | 'warning' | 'error' }) => void;
  getLanguage: () => AppLanguage;
  getProductFiles: () => ProductFileRecord[];
  refreshProductFiles: () => Promise<unknown>;
  openFilePicker: (options: {
    sourceKey: string;
    currentFileId: number | null;
    titleKey?: 'title' | 'defaultFileTitle' | 'fileSourceTitle';
    allowClear?: boolean;
    uploadFolderPrefix?: string;
  }) => Promise<FilePickerResult | null>;
  productFileDisplayName: (file: ProductFileRecord) => string;
  /** Re-render the page whose workflow just ran. */
  refreshPage: (page: WorkflowUpdatePageKey) => Promise<void> | void;
};

const PAGE_KINDS: Record<WorkflowUpdatePageKey, WorkflowUpdateKind> = {
  'grant-record': 'esop',
  'exercise-record': 'esop',
  'sold-shares': 'esop',
  'transfer-plan': 'esop',
  'employee-management': 'data-management',
  'plan-summary': 'data-management',
  'five-percent-holders': 'data-management',
};

/** Bilingual copy this modal owns (it used to be inline ternaries inside main.ts). */
const TEXT = {
  chooseFromFilesCenter: { 'zh-CN': '从文件中心选择', 'en-US': 'Choose from the Files Center' },
  selectFile: { 'zh-CN': '选择文件…', 'en-US': 'Select file…' },
  planSummaryRuleNote: {
    'zh-CN': '说明：仅显示 Outstanding 不为 0 的计划。',
    'en-US': 'Note: only plans with non-zero Outstanding are shown.',
  },
  workflowProgress: { 'zh-CN': 'Workflow 进度', 'en-US': 'Workflow progress' },
  selected: { 'zh-CN': '已选择', 'en-US': 'Selected' },
  pickSource: { 'zh-CN': '请选择或上传 {label}', 'en-US': 'Select or upload {label}' },
  completedWithWarnings: { 'zh-CN': 'Workflow 完成（包含 Warning）', 'en-US': 'Workflow completed with warnings' },
  updateCompleted: { 'zh-CN': 'Workflow 更新完成', 'en-US': 'Workflow update completed' },
  noResultFiles: { 'zh-CN': '当前页面没有可导出的文件', 'en-US': 'This page has no exportable files' },
  exportingFiles: { 'zh-CN': '开始导出文件', 'en-US': 'Exporting file' },
  exportingFilesPlural: { 'zh-CN': '开始导出 {count} 个文件', 'en-US': 'Exporting {count} files' },
} as const;

export type WorkflowUpdateModal = {
  isWorkflowUpdatePage: (page: string) => page is WorkflowUpdatePageKey;
  /** Cache the per-page configs (called once at boot). */
  loadConfigs: () => Promise<void>;
  /** Record the bindings a page response carries, for the next update. */
  rememberPageData: (
    page: WorkflowUpdatePageKey,
    response: {
      workflowSourceBindings?: WorkflowPageSourceBinding[];
      workflowResultFiles?: WorkflowResultFileBinding[];
    },
  ) => void;
  openModal: (page: WorkflowUpdatePageKey) => Promise<void>;
  openProgressModal: (title: string, subtitle: string) => void;
  closeModal: () => void;
  forceCloseModal: () => void;
  setCloseLocked: (locked: boolean) => void;
  confirmUpdate: () => Promise<void>;
  downloadResultFiles: (page: WorkflowUpdatePageKey) => void;
  statusMessage: (
    key: 'idle' | 'starting' | 'running' | 'completed' | 'completedWithWarnings' | 'failed',
    detail?: string,
  ) => string;
  stepStatusText: (status: WorkflowExecutionTaskState | 'not_started') => string;
  /** Progress rendering/polling, reused by pages that run their workflow outside the modal. */
  renderProgress: (run: WorkflowRunRecord) => void;
  pollRunUntilFinished: (runId: number, onProgress?: (run: WorkflowRunRecord) => void) => Promise<WorkflowRunRecord>;
  /** Binding the last run recorded for a page source, and the page's run endpoint. */
  bindingFor: (page: WorkflowUpdatePageKey, sourceKey: string) => WorkflowPageSourceBinding | null;
  runEndpoint: (page: WorkflowUpdatePageKey) => string;
  /** Attach the modal's own button/overlay listeners. */
  bindEvents: () => void;
};

export function createWorkflowUpdateModal(deps: WorkflowUpdateModalDeps): WorkflowUpdateModal {
  const { el, api, escapeHtml, notify } = deps;
  const lang = deps.getLanguage;

  const tt = (key: keyof typeof TEXT) => TEXT[key][lang()] ?? TEXT[key]['zh-CN'];

  const sourceBindingsByPage: Partial<Record<WorkflowUpdatePageKey, WorkflowPageSourceBinding[]>> = {};
  const resultFilesByPage: Partial<Record<WorkflowUpdatePageKey, WorkflowResultFileBinding[]>> = {};
  let configs: Partial<Record<WorkflowUpdatePageKey, WorkflowPageConfig>> = {};
  let activePage: WorkflowUpdatePageKey | null = null;
  let selectedFiles: Record<string, number | null> = {};
  let selectedSheets: Record<string, string> = {};
  let closeLocked = false;

  const reachedStepStatuses = new Set<WorkflowExecutionTaskState>([
    'completed',
    'failed',
    'blocked',
    'warning',
    'skipped',
  ]);

  function isWorkflowUpdatePage(page: string): page is WorkflowUpdatePageKey {
    return Object.prototype.hasOwnProperty.call(PAGE_KINDS, page);
  }

  function configEndpoint(kind: WorkflowUpdateKind) {
    return kind === 'esop' ? '/api/esop-workflows' : '/api/data-management-workflows';
  }

  function runEndpoint(page: WorkflowUpdatePageKey) {
    const kind = PAGE_KINDS[page];
    const apiPageKey = page === 'employee-management' ? 'employee' : page;
    return kind === 'esop'
      ? `/api/esop-workflows/${apiPageKey}/runs`
      : `/api/data-management-workflows/${apiPageKey}/runs`;
  }

  async function loadConfigs() {
    const [esop, dataManagement] = await Promise.all([
      api<{ items: WorkflowPageConfig[] }>(configEndpoint('esop')),
      api<{ items: WorkflowPageConfig[] }>(configEndpoint('data-management')),
    ]);
    configs = Object.fromEntries(
      [...esop.items, ...dataManagement.items]
        .map((config) => (config.pageKey === 'employee' ? { ...config, pageKey: 'employee-management' } : config))
        .filter((config) => isWorkflowUpdatePage(config.pageKey))
        .map((config) => [config.pageKey, config]),
    ) as Partial<Record<WorkflowUpdatePageKey, WorkflowPageConfig>>;
  }

  function getConfig(page: WorkflowUpdatePageKey): WorkflowPageConfig {
    const config = configs[page];
    if (!config) throw new Error(`Missing workflow config for ${page}`);
    return config;
  }

  function bindingFor(page: WorkflowUpdatePageKey, sourceKey: string): WorkflowPageSourceBinding | null {
    return sourceBindingsByPage[page]?.find((binding) => binding.sourceKey === sourceKey) ?? null;
  }

  function renderSources() {
    const page = activePage;
    if (!page) return;
    const config = getConfig(page);
    el('workflowUpdateSourceList').innerHTML = config.sources
      .map((source) => {
        const selectedFileId = selectedFiles[source.sourceKey] ?? null;
        const previous = bindingFor(page, source.sourceKey);
        const selected = selectedFileId ? deps.getProductFiles().find((file) => file.id === selectedFileId) : null;
        const pickLabel = selected ? deps.productFileDisplayName(selected) : tt('selectFile');
        const ruleNote = page === 'plan-summary' ? tt('planSummaryRuleNote') : '';
        return `
        <div class="workflow-update-source-card" data-workflow-update-source="${escapeHtml(source.sourceKey)}">
          <div class="workflow-update-source-card__main">
            <div class="workflow-update-source-card__title">${escapeHtml(source.label)}</div>
            <div class="workflow-update-source-card__meta">Source key: ${escapeHtml(source.sourceKey)}</div>
            <div class="workflow-update-source-card__meta">Previous: ${escapeHtml(previous?.fileName ?? 'Not set')}</div>
            ${ruleNote ? `<div class="workflow-update-source-card__note">${escapeHtml(ruleNote)}</div>` : ''}
          </div>
          <div class="workflow-update-source-card__controls">
            <button
              class="btn btn-secondary workflow-update-source-card__pick"
              type="button"
              data-workflow-update-file-pick="${escapeHtml(source.sourceKey)}"
              aria-haspopup="dialog"
              title="${escapeHtml(tt('chooseFromFilesCenter'))}"
            >
              <span class="workbook-tree__folder-icon" aria-hidden="true"></span>
              <span class="workflow-update-source-card__pick-label">${escapeHtml(pickLabel)}</span>
            </button>
            ${
              source.sheet !== undefined || previous?.sheet
                ? `<label class="workflow-update-source-card__sheet">
                  <span class="workflow-update-source-card__sheet-label">Sheet</span>
                  <input class="workflow-update-source-card__sheet-input" type="text" data-workflow-update-sheet="${escapeHtml(source.sourceKey)}" value="${escapeHtml(selectedSheets[source.sourceKey] ?? previous?.sheet ?? source.sheet ?? '')}" />
                </label>`
                : ''
            }
          </div>
        </div>`;
      })
      .join('');

    el('workflowUpdateSourceList')
      .querySelectorAll<HTMLButtonElement>('[data-workflow-update-file-pick]')
      .forEach((button) => {
        button.addEventListener('click', () => {
          const sourceKey = button.dataset.workflowUpdateFilePick;
          if (!sourceKey) return;
          void pickSourceFile(sourceKey);
        });
      });
    el('workflowUpdateSourceList')
      .querySelectorAll<HTMLInputElement>('[data-workflow-update-sheet]')
      .forEach((input) => {
        input.addEventListener('input', () => {
          const sourceKey = input.dataset.workflowUpdateSheet;
          if (sourceKey) selectedSheets[sourceKey] = input.value;
        });
      });
  }

  async function pickSourceFile(sourceKey: string) {
    const currentFileId = selectedFiles[sourceKey] ?? null;
    const result = await deps.openFilePicker({
      sourceKey,
      currentFileId,
      titleKey: 'fileSourceTitle',
      allowClear: true,
      uploadFolderPrefix: 'input',
    });
    if (!result) return;
    selectedFiles[sourceKey] = result.action === 'pick' ? result.fileId : null;
    renderSources();
    if (result.action === 'pick') {
      const file = deps.getProductFiles().find((item) => item.id === result.fileId);
      if (file) {
        el('workflowUpdateStatus').textContent = `${tt('selected')}: ${deps.productFileDisplayName(file)}`;
      }
    }
  }

  function statusMessage(
    key: 'idle' | 'starting' | 'running' | 'completed' | 'completedWithWarnings' | 'failed',
    detail?: string,
  ): string {
    const copy: Record<typeof key, Record<AppLanguage, string>> = {
      idle: {
        'zh-CN': '默认使用上一次成功执行的输入文件；上传新文件后会自动替换当前输入项。',
        'en-US': 'The last successful input files are used by default; uploaded files replace the current input.',
      },
      starting: { 'zh-CN': '正在启动 workflow...', 'en-US': 'Starting workflow...' },
      running: {
        'zh-CN': `Workflow 运行中${detail ? `（#${detail}）` : ''}...`,
        'en-US': `Workflow running${detail ? ` (#${detail})` : ''}...`,
      },
      completed: { 'zh-CN': 'Workflow 更新完成。', 'en-US': 'Workflow update completed.' },
      completedWithWarnings: {
        'zh-CN': 'Workflow 完成（包含 Warning）。',
        'en-US': 'Workflow completed with warnings.',
      },
      failed: { 'zh-CN': `Workflow 失败：${detail ?? ''}`, 'en-US': `Workflow failed: ${detail ?? ''}` },
    };
    return copy[key][lang()];
  }

  function stepStatusText(status: WorkflowExecutionTaskState | 'not_started'): string {
    const copy: Record<WorkflowExecutionTaskState | 'not_started', Record<AppLanguage, string>> = {
      pending: { 'zh-CN': '等待中', 'en-US': 'Pending' },
      running: { 'zh-CN': '运行中', 'en-US': 'Running' },
      completed: { 'zh-CN': '已完成', 'en-US': 'Completed' },
      failed: { 'zh-CN': '失败', 'en-US': 'Failed' },
      blocked: { 'zh-CN': '已阻塞', 'en-US': 'Blocked' },
      warning: { 'zh-CN': '需确认', 'en-US': 'Warning' },
      skipped: { 'zh-CN': '已跳过', 'en-US': 'Skipped' },
      not_started: { 'zh-CN': '等待启动', 'en-US': 'Waiting to start' },
    };
    return copy[status][lang()];
  }

  function resetProgress() {
    const progress = el('workflowUpdateProgress');
    const bar = el('workflowUpdateProgressBar');
    const fill = el<HTMLElement>('workflowUpdateProgressFill');
    const text = el('workflowUpdateProgressText');
    const step = el('workflowUpdateProgressStep');
    const label = el('workflowUpdateProgressLabel');
    progress.classList.add('hidden');
    progress.classList.remove('is-running', 'is-success', 'is-warning', 'is-error');
    bar.setAttribute('aria-valuenow', '0');
    fill.style.width = '0%';
    text.textContent = '0 / 0';
    label.textContent = tt('workflowProgress');
    step.textContent = stepStatusText('not_started');
  }

  function renderProgress(run: WorkflowRunRecord) {
    const progress = el('workflowUpdateProgress');
    const bar = el('workflowUpdateProgressBar');
    const fill = el<HTMLElement>('workflowUpdateProgressFill');
    const text = el('workflowUpdateProgressText');
    const step = el('workflowUpdateProgressStep');
    const label = el('workflowUpdateProgressLabel');
    const steps = run.steps ?? [];
    const total = Math.max(steps.length, run.tasksSnapshot?.length ?? 0);
    const reached = steps.filter((item) => reachedStepStatuses.has(item.status)).length;
    const percent = total > 0 ? Math.round((reached / total) * 100) : 0;
    const runningStep = steps.find((item) => item.status === 'running');
    const failedStep = steps.find((item) => item.status === 'failed' || item.status === 'blocked');
    const pendingStep = steps.find((item) => item.status === 'pending');
    const currentStep = failedStep ?? runningStep ?? pendingStep ?? steps[steps.length - 1] ?? null;
    const displayedPercent =
      run.status === 'completed' || run.status === 'completed_with_warnings'
        ? 100
        : Math.max(percent, run.status === 'running' && total > 0 ? 8 : 0);

    progress.classList.remove('hidden', 'is-running', 'is-success', 'is-warning', 'is-error');
    progress.classList.toggle('is-running', run.status === 'running' || run.status === 'pending');
    progress.classList.toggle('is-success', run.status === 'completed');
    progress.classList.toggle(
      'is-warning',
      run.status === 'completed_with_warnings' || run.status === 'waiting_approval',
    );
    progress.classList.toggle('is-error', run.status === 'failed' || run.status === 'skipped');
    label.textContent = tt('workflowProgress');
    bar.setAttribute('aria-valuenow', String(displayedPercent));
    fill.style.width = `${displayedPercent}%`;
    text.textContent = total > 0 ? `${Math.min(reached, total)} / ${total}` : '0 / 0';

    if (currentStep) {
      const status = stepStatusText(currentStep.status);
      const error = currentStep.errorMessage ? ` · ${currentStep.errorMessage}` : '';
      step.textContent = `${status}: ${currentStep.taskName}${error}`;
    } else {
      step.textContent = stepStatusText('not_started');
    }
  }

  async function openModal(page: WorkflowUpdatePageKey) {
    await loadConfigs();
    await deps.refreshProductFiles();
    const config = getConfig(page);
    activePage = page;
    closeLocked = false;
    selectedFiles = Object.fromEntries(
      config.sources.map((source) => [source.sourceKey, bindingFor(page, source.sourceKey)?.fileId ?? null]),
    );
    selectedSheets = Object.fromEntries(
      config.sources.map((source) => [
        source.sourceKey,
        bindingFor(page, source.sourceKey)?.sheet ?? source.sheet ?? '',
      ]),
    );
    el('workflowUpdateModalTitle').textContent = `Update ${config.workflowName}`;
    el('workflowUpdateModalSubtitle').textContent = config.description;
    el('workflowUpdateStatus').textContent = statusMessage('idle');
    el('workflowUpdateSourceList').classList.remove('hidden');
    el('btnConfirmWorkflowUpdate').classList.remove('hidden');
    el('btnCancelWorkflowUpdateModal').classList.remove('hidden');
    el('btnCloseWorkflowUpdateModal').classList.remove('hidden');
    resetProgress();
    renderSources();
    el('workflowUpdateModal').classList.remove('hidden');
  }

  function openProgressModal(title: string, subtitle: string) {
    activePage = null;
    selectedFiles = {};
    selectedSheets = {};
    closeLocked = true;
    el('workflowUpdateModalTitle').textContent = title;
    el('workflowUpdateModalSubtitle').textContent = subtitle;
    el('workflowUpdateStatus').textContent = statusMessage('starting');
    el('workflowUpdateSourceList').innerHTML = '';
    el('workflowUpdateSourceList').classList.add('hidden');
    el('btnConfirmWorkflowUpdate').classList.add('hidden');
    el('btnCancelWorkflowUpdateModal').classList.add('hidden');
    el('btnCloseWorkflowUpdateModal').classList.add('hidden');
    resetProgress();
    el('workflowUpdateProgress').classList.remove('hidden');
    el('workflowUpdateModal').classList.remove('hidden');
  }

  function closeModal() {
    if (closeLocked) return;
    el('workflowUpdateModal').classList.add('hidden');
    activePage = null;
    selectedFiles = {};
    el('workflowUpdateSourceList').classList.remove('hidden');
    el('btnConfirmWorkflowUpdate').classList.remove('hidden');
    el('btnCancelWorkflowUpdateModal').classList.remove('hidden');
    el('btnCloseWorkflowUpdateModal').classList.remove('hidden');
  }

  function forceCloseModal() {
    closeLocked = false;
    closeModal();
  }

  async function pollRunUntilFinished(
    runId: number,
    onProgress?: (run: WorkflowRunRecord) => void,
  ): Promise<WorkflowRunRecord> {
    const startedAt = Date.now();
    const timeoutMs = 120_000;
    for (;;) {
      await new Promise((resolve) => window.setTimeout(resolve, 600));
      const run = await api<WorkflowRunRecord>(`/api/workflow-runs/${runId}`);
      onProgress?.(run);
      if (isWorkflowRunTerminalStatus(run.status)) return run;
      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(`Workflow run #${runId} did not finish within ${Math.round(timeoutMs / 1000)}s`);
      }
    }
  }

  async function confirmUpdate() {
    const page = activePage;
    if (!page) return;
    const config = getConfig(page);
    const missing = config.sources.find((source) => !selectedFiles[source.sourceKey]);
    if (missing) {
      notify(tt('pickSource').replace('{label}', missing.label), { type: 'warning' });
      return;
    }

    const confirmButton = el<HTMLButtonElement>('btnConfirmWorkflowUpdate');
    confirmButton.disabled = true;
    el('workflowUpdateStatus').textContent = statusMessage('starting');
    resetProgress();
    el('workflowUpdateProgress').classList.remove('hidden');
    try {
      const sources = Object.fromEntries(
        config.sources.map((source) => [
          source.sourceKey,
          {
            fileId: selectedFiles[source.sourceKey],
            ...(selectedSheets[source.sourceKey]?.trim() ? { sheet: selectedSheets[source.sourceKey].trim() } : {}),
          },
        ]),
      );
      const result = await api<WorkflowExecutionResult>(runEndpoint(page), {
        method: 'POST',
        body: JSON.stringify({ sources }),
      });
      const runId = result.run?.id;
      if (!runId) throw new Error('Workflow run was not created');
      if (result.run) renderProgress(result.run);
      el('workflowUpdateStatus').textContent = statusMessage('running', String(runId));
      const run = await pollRunUntilFinished(runId, renderProgress);
      if (run.status !== 'completed' && run.status !== 'completed_with_warnings') {
        throw new Error(run.errorMessage ?? `Workflow ended with status ${run.status}`);
      }
      renderProgress(run);
      await deps.refreshProductFiles();
      await deps.refreshPage(page);
      el('workflowUpdateStatus').textContent = statusMessage(
        run.status === 'completed_with_warnings' ? 'completedWithWarnings' : 'completed',
      );
      notify(tt(run.status === 'completed_with_warnings' ? 'completedWithWarnings' : 'updateCompleted'), {
        type: run.status === 'completed_with_warnings' ? 'warning' : 'success',
      });
      closeModal();
    } catch (error) {
      notify((error as Error).message, { type: 'error' });
      el('workflowUpdateStatus').textContent = statusMessage('failed', (error as Error).message);
    } finally {
      confirmButton.disabled = false;
    }
  }

  function downloadResultFiles(page: WorkflowUpdatePageKey) {
    const files = resultFilesByPage[page] ?? [];
    if (files.length === 0) {
      notify(tt('noResultFiles'), { type: 'warning' });
      return;
    }
    files.forEach((file, index) => {
      window.setTimeout(() => {
        const link = document.createElement('a');
        link.href = `/api/files/${file.fileId}/content`;
        link.download = file.fileName || `result-file-${file.fileId}.xlsx`;
        document.body.appendChild(link);
        link.click();
        link.remove();
      }, index * 150);
    });
    notify(
      files.length === 1 ? tt('exportingFiles') : tt('exportingFilesPlural').replace('{count}', String(files.length)),
      { type: 'success' },
    );
  }

  function bindEvents() {
    el('btnCloseWorkflowUpdateModal').addEventListener('click', closeModal);
    el('btnCancelWorkflowUpdateModal').addEventListener('click', closeModal);
    el('btnConfirmWorkflowUpdate').addEventListener('click', () => void confirmUpdate());
    el('workflowUpdateModal').addEventListener('click', (event) => {
      if (event.target === el('workflowUpdateModal')) closeModal();
    });
  }

  return {
    isWorkflowUpdatePage,
    loadConfigs,
    rememberPageData: (page, response) => {
      if (response.workflowSourceBindings) sourceBindingsByPage[page] = response.workflowSourceBindings;
      if (response.workflowResultFiles) resultFilesByPage[page] = response.workflowResultFiles;
    },
    openModal,
    openProgressModal,
    closeModal,
    forceCloseModal,
    setCloseLocked: (locked: boolean) => {
      closeLocked = locked;
    },
    confirmUpdate,
    downloadResultFiles,
    statusMessage,
    stepStatusText,
    renderProgress,
    pollRunUntilFinished: pollRunUntilFinished,
    bindingFor,
    runEndpoint,
    bindEvents,
  };
}

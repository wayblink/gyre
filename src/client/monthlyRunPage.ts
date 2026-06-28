import type {
  MonthlyRunHistoryRecord,
  MonthlyRunSourceConfigResponse,
  MonthlyRunSourceDefinition,
  MonthlyRunSourceBinding,
  MonthlyRunTriggerResponse,
  ProductFileRecord,
  WorkflowExecutionTaskState,
  WorkflowRunRecord,
} from '../shared/types.js';
import { isWorkflowRunTerminalStatus } from '../shared/workflowRunStatus.js';
import { createWorkflowRunClient } from './workflow/runClient.js';

type DomGetter = <T extends HTMLElement>(id: string) => T;

type MonthlyRunPageDeps = {
  el: DomGetter;
  api: <T>(url: string, options?: RequestInit) => Promise<T>;
  escapeHtml: (text: unknown) => string;
  formatDateTime: (value: string) => string;
  refreshProductFiles: () => Promise<unknown>;
  refreshSummary: (month: string) => Promise<unknown>;
};

type SourceDraftBindings = Record<string, MonthlyRunSourceBinding | null>;

function statusLabel(status: string): string {
  if (status === 'completed') return 'Completed';
  if (status === 'completed_with_warnings') return 'Completed with warnings';
  if (status === 'waiting_approval') return 'Needs review';
  if (status === 'failed') return 'Failed';
  if (status === 'skipped') return 'Skipped';
  if (status === 'running') return 'Running';
  return status || 'Pending';
}

function taskStateLabel(status: WorkflowExecutionTaskState): string {
  if (status === 'completed') return 'Completed';
  if (status === 'running') return 'Running';
  if (status === 'failed') return 'Failed';
  if (status === 'blocked') return 'Blocked';
  if (status === 'warning') return 'Needs review';
  if (status === 'skipped') return 'Skipped';
  return 'Pending';
}

function monthFolder(month: string): string {
  return /^\d{4}-\d{2}$/.test(month) ? month : new Date().toISOString().slice(0, 7);
}

export function createMonthlyRunPage({
  el,
  api,
  escapeHtml,
  formatDateTime,
  refreshProductFiles,
  refreshSummary,
}: MonthlyRunPageDeps) {
  const runClient = createWorkflowRunClient(api);
  let files: ProductFileRecord[] = [];
  let sourceDefinitions: MonthlyRunSourceDefinition[] = [];
  let selectedSources: Record<string, MonthlyRunSourceBinding> = {};
  let draftSources: SourceDraftBindings = {};
  let activeHistoryId: number | null = null;
  let activeRun: WorkflowRunRecord | null = null;
  let isRunning = false;
  let isSavingSources = false;
  const expandedWarningTaskIds = new Set<string>();

  async function init() {
    el('btnMonthlyRunConfigureSources').addEventListener('click', () => void openSourceModal());
    el('btnMonthlyRunRefreshFiles').addEventListener('click', () => void refreshFiles());
    el('btnTriggerMonthlyRun').addEventListener('click', () => void triggerMonthlyRun());
    el('btnMonthlyRunContinue').addEventListener('click', () => void approveActiveRun('approved'));
    el('btnMonthlyRunSkip').addEventListener('click', () => void approveActiveRun('skipped'));
    el('monthlyRunMonth').addEventListener('change', () => {
      renderSourceInfo();
      if (!el('monthlyRunSourceModal').classList.contains('hidden')) {
        renderSourceModal();
      }
    });
    bindSourceModalEvents();
    await Promise.all([refreshSourceConfig(), refreshFiles(), refreshHistory()]);
    renderRunPanel();
  }

  async function onActivate() {
    await Promise.all([refreshSourceConfig(), refreshFiles(), refreshHistory()]);
    if (activeRun && !isWorkflowRunTerminalStatus(activeRun.status)) {
      await refreshActiveRun();
    }
  }

  function bindSourceModalEvents() {
    el('btnCloseMonthlyRunSourceModal').addEventListener('click', closeSourceModal);
    el('btnCancelMonthlyRunSourceModal').addEventListener('click', closeSourceModal);
    el('btnSaveMonthlyRunSourceModal').addEventListener('click', () => void saveSourceModal());
    el('monthlyRunSourceModal').addEventListener('click', (event) => {
      if (event.target === el('monthlyRunSourceModal')) closeSourceModal();
    });
  }

  async function refreshSourceConfig() {
    const data = await api<MonthlyRunSourceConfigResponse>('/api/monthly-runs/source-config');
    sourceDefinitions = data.sources;
    ensureSelectedSourceBindings();
    renderSourceInfo();
  }

  async function refreshFiles() {
    const data = await api<{ files: ProductFileRecord[] }>('/api/files');
    files = data.files;
    sanitizeSelectedSourceBindings();
    renderSourceInfo();
    if (!el('monthlyRunSourceModal').classList.contains('hidden')) {
      renderSourceModal();
    }
  }

  function ensureSelectedSourceBindings() {
    if (!sourceDefinitions.length) return;
    const next = { ...selectedSources };
    for (const source of sourceDefinitions) {
      const current = next[source.sourceKey];
      if (current && files.some((file) => file.id === current.fileId)) continue;
      if (current && files.length === 0) continue;
      const firstFile = files[0];
      if (!current && firstFile) next[source.sourceKey] = { fileId: firstFile.id };
    }
    selectedSources = Object.fromEntries(
      Object.entries(next).filter(([, binding]) => binding && files.some((file) => file.id === binding.fileId)),
    );
  }

  function sanitizeSelectedSourceBindings() {
    selectedSources = Object.fromEntries(
      Object.entries(selectedSources).filter(([, binding]) => files.some((file) => file.id === binding.fileId)),
    );
    ensureSelectedSourceBindings();
  }

  function getFileById(fileId: number | null | undefined): ProductFileRecord | null {
    if (!fileId) return null;
    return files.find((file) => file.id === fileId) ?? null;
  }

  function renderSourceInfo() {
    const info = el('monthlyRunSourceInfo');
    if (!sourceDefinitions.length) {
      info.innerHTML = '<span>正在加载 source 配置…</span>';
      return;
    }

    const configured = sourceDefinitions.filter((source) => selectedSources[source.sourceKey]?.fileId);
    if (!configured.length) {
      info.innerHTML = '<span>请先配置每个 workflow 输入节点需要使用的源文件。</span>';
      return;
    }

    info.innerHTML = configured
      .map((source) => {
        const file = getFileById(selectedSources[source.sourceKey]?.fileId);
        return `<span class="monthly-run-source-pill"><strong>${escapeHtml(source.label)}</strong>${file ? escapeHtml(file.originalName) : '未配置'}</span>`;
      })
      .join('');
  }

  function openSourceModal() {
    draftSources = Object.fromEntries(
      sourceDefinitions.map((source) => [source.sourceKey, selectedSources[source.sourceKey] ?? null]),
    );
    renderSourceModal();
    el('monthlyRunSourceModal').classList.remove('hidden');
  }

  function closeSourceModal() {
    if (isSavingSources) return;
    el('monthlyRunSourceModal').classList.add('hidden');
  }

  function renderSourceModal() {
    el('monthlyRunSourceModalMonth').textContent = monthFolder(el<HTMLInputElement>('monthlyRunMonth').value);
    const list = el('monthlyRunSourceList');
    list.innerHTML = sourceDefinitions
      .map((source) => {
        const binding = draftSources[source.sourceKey];
        const file = binding ? getFileById(binding.fileId) : null;
        const options = [
          '<option value="">选择已上传文件</option>',
          ...files.map((productFile) => {
            const selected = binding?.fileId === productFile.id ? ' selected' : '';
            return `<option value="${productFile.id}"${selected}>${escapeHtml(productFile.originalName)} · ${escapeHtml(formatDateTime(productFile.createdAt))}</option>`;
          }),
        ].join('');

        return `
          <section class="monthly-run-source-card" data-source-key="${escapeHtml(source.sourceKey)}">
            <div class="monthly-run-source-card__header">
              <div>
                <h4>${escapeHtml(source.label)}</h4>
                <p>${escapeHtml(source.description)}</p>
              </div>
              <span class="monthly-run-source-card__task">${escapeHtml(source.taskId)}</span>
            </div>
            <div class="monthly-run-source-card__current">
              <span>Current</span>
              <strong>${file ? escapeHtml(file.originalName) : '未配置'}</strong>
            </div>
            <div class="monthly-run-source-card__controls">
              <select class="search-input monthly-run-source-card__select" data-source-select="${escapeHtml(source.sourceKey)}">
                ${options}
              </select>
              <button class="btn btn-secondary monthly-run-source-card__upload" type="button" data-source-upload="${escapeHtml(source.sourceKey)}">
                Upload New File
              </button>
            </div>
            <div class="monthly-run-source-card__hint">
              <span>Default sheet</span>
              <strong>${escapeHtml(source.defaultSheetName ?? '-')}</strong>
            </div>
          </section>
        `;
      })
      .join('');

    list.querySelectorAll<HTMLSelectElement>('[data-source-select]').forEach((select) => {
      select.addEventListener('change', () => {
        const sourceKey = select.dataset.sourceSelect;
        if (!sourceKey) return;
        const fileId = select.value ? Number(select.value) : null;
        draftSources[sourceKey] = fileId ? { fileId } : null;
        renderSourceModal();
      });
    });

    list.querySelectorAll<HTMLButtonElement>('[data-source-upload]').forEach((button) => {
      button.addEventListener('click', () => {
        const sourceKey = button.dataset.sourceUpload;
        if (!sourceKey) return;
        void uploadSourceFileFor(sourceKey);
      });
    });
  }

  async function uploadSourceFileFor(sourceKey: string) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xls,.csv';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      const form = new FormData();
      form.append('file', file);
      form.append('uploadedBy', `Monthly Run · ${sourceKey}`);
      form.append('folderPrefix', monthFolder(el<HTMLInputElement>('monthlyRunMonth').value));
      const data = await api<{ file: ProductFileRecord }>('/api/files/upload', { method: 'POST', body: form });
      await refreshFiles();
      await refreshProductFiles();
      draftSources[sourceKey] = { fileId: data.file.id };
      renderSourceModal();
    });
    input.click();
  }

  async function saveSourceModal() {
    const missing = sourceDefinitions.find((source) => source.required && !draftSources[source.sourceKey]?.fileId);
    if (missing) {
      alert(`请先为 ${missing.label} 选择文件`);
      return;
    }
    isSavingSources = true;
    const nextSources: Record<string, MonthlyRunSourceBinding> = {};
    for (const [sourceKey, binding] of Object.entries(draftSources)) {
      if (binding?.fileId) nextSources[sourceKey] = binding;
    }
    selectedSources = nextSources;
    renderSourceInfo();
    isSavingSources = false;
    closeSourceModal();
  }

  async function triggerMonthlyRun() {
    const month = el<HTMLInputElement>('monthlyRunMonth').value;
    if (!month) return alert('请选择月份');
    if (!sourceDefinitions.every((source) => !source.required || selectedSources[source.sourceKey]?.fileId)) {
      return alert('请先完成 source 配置');
    }
    if (isRunning) return;

    isRunning = true;
    activeHistoryId = null;
    activeRun = null;
    expandedWarningTaskIds.clear();
    renderRunPanel('Submitting monthly run...');

    try {
      const response = await api<MonthlyRunTriggerResponse>('/api/monthly-runs', {
        method: 'POST',
        body: JSON.stringify({
          month,
          sources: selectedSources,
          operator: 'Administrator',
        }),
      });
      activeHistoryId = response.history.id;
      activeRun = response.executionResult.run ?? null;
      renderRunPanel('Workflow submitted');
      if (activeRun) {
        await runClient.pollUntilSettled(activeRun.id, {
          minimumPollCount: 1,
          onUpdate: (run) => {
            activeRun = run;
            renderRunPanel();
          },
        });
        await finalizeAfterRun(month);
      }
    } catch (error) {
      renderRunPanel(error instanceof Error ? error.message : 'Monthly run failed');
      throw error;
    } finally {
      isRunning = false;
      await refreshHistory(month);
      renderRunPanel();
    }
  }

  async function approveActiveRun(decision: 'approved' | 'skipped') {
    if (!activeRun || !activeHistoryId || isRunning) return;
    const waitingTaskIds = activeRun.approvals.filter((approval) => approval.status === 'pending').map((approval) => approval.taskId);
    if (!waitingTaskIds.length) return;

    isRunning = true;
    renderRunPanel(decision === 'skipped' ? 'Skipping downstream flow...' : 'Continuing workflow...');
    const result = await api<{ run?: WorkflowRunRecord }>(`/api/monthly-runs/${activeHistoryId}/approvals`, {
      method: 'POST',
      body: JSON.stringify({ taskIds: waitingTaskIds, decision }),
    });
    activeRun = result.run ?? activeRun;
    expandedWarningTaskIds.clear();
    await runClient.pollUntilSettled(activeRun.id, {
      minimumPollCount: 2,
      onUpdate: (run) => {
        activeRun = run;
        renderRunPanel();
      },
    });
    isRunning = false;
    await finalizeAfterRun(el<HTMLInputElement>('monthlyRunMonth').value);
    await refreshHistory(el<HTMLInputElement>('monthlyRunMonth').value);
    renderRunPanel();
  }

  async function refreshActiveRun() {
    if (!activeRun) return;
    activeRun = await runClient.getRun(activeRun.id);
    renderRunPanel();
  }

  function getWarningMessageForTask(run: WorkflowRunRecord, taskId: string): string | null {
    const pendingApproval = run.approvals.find((approval) => approval.taskId === taskId && approval.status === 'pending');
    if (pendingApproval?.comment?.trim()) return pendingApproval.comment.trim();

    const warningEvent = [...run.events]
      .reverse()
      .find((event) => event.taskId === taskId && (event.eventType === 'warning_raised' || event.eventType === 'approval_requested'));
    if (warningEvent?.message?.trim()) return warningEvent.message.trim();

    const step = run.steps.find((item) => item.taskId === taskId);
    if (step?.errorMessage?.trim()) return step.errorMessage.trim();
    return null;
  }

  function toggleWarningTask(taskId: string) {
    if (expandedWarningTaskIds.has(taskId)) {
      expandedWarningTaskIds.delete(taskId);
    } else {
      expandedWarningTaskIds.add(taskId);
    }
    renderRunPanel();
  }

  async function finalizeAfterRun(month: string) {
    if (!activeRun) return;
    if (activeRun.artifacts.some((artifact) => artifact.artifactType === 'file')) {
      await refreshProductFiles();
    }
    if (activeRun.status === 'completed' || activeRun.status === 'completed_with_warnings') {
      await refreshSummary(month);
    }
  }

  function renderRunPanel(overrideMessage?: string) {
    const panel = el('monthlyRunPanel');
    const summary = el('monthlyRunSummary');
    const taskList = el('monthlyRunTaskList');
    const progressBar = el('monthlyRunProgressBar');
    const progressText = el('monthlyRunProgressText');
    const actions = el('monthlyRunActions');

    panel.classList.remove('hidden');
    const run = activeRun;
    if (!run) {
      summary.innerHTML = `<span class="monthly-run-status monthly-run-status--idle">${escapeHtml(overrideMessage ?? 'Ready')}</span>`;
      taskList.innerHTML = '<div class="monthly-run-empty">执行后会在这里显示节点状态。</div>';
      progressBar.style.width = '0%';
      progressText.textContent = '0 / 0';
      actions.classList.add('hidden');
      return;
    }

    const completedStates = new Set<WorkflowExecutionTaskState>(['completed', 'warning', 'failed', 'blocked', 'skipped']);
    const reached = run.steps.filter((step) => completedStates.has(step.status)).length;
    const total = run.steps.length;
    const ratio = total ? Math.min(1, reached / total) : 0;
    const pendingApprovals = run.approvals.filter((approval) => approval.status === 'pending');
    const statusCode = run.status === 'completed_with_warnings' ? 'warning' : run.status;
    summary.innerHTML = `<span class="monthly-run-status monthly-run-status--${escapeHtml(statusCode)}">${escapeHtml(statusLabel(run.status))}</span><span>${escapeHtml(overrideMessage ?? run.errorMessage ?? `Run #${run.id}`)}</span>`;
    progressBar.style.width = `${ratio * 100}%`;
    progressText.textContent = pendingApprovals.length ? `${reached} / ${total} · review required` : `${reached} / ${total}`;
    taskList.innerHTML = run.steps
      .map((step, index) => {
        const warningMessage = step.status === 'warning' ? getWarningMessageForTask(run, step.taskId) : null;
        const isWarningExpandable = Boolean(warningMessage);
        const isExpanded = isWarningExpandable && expandedWarningTaskIds.has(step.taskId);
        return `
        <div
          class="monthly-run-task monthly-run-task--${step.status} ${isWarningExpandable ? 'monthly-run-task--expandable' : ''} ${isExpanded ? 'is-expanded' : ''}"
          ${isWarningExpandable ? `data-warning-task-id="${escapeHtml(step.taskId)}"` : ''}
        >
          <span class="monthly-run-task__index">${step.status === 'completed' ? '✓' : step.status === 'running' ? '…' : String(index + 1).padStart(2, '0')}</span>
          <div class="monthly-run-task__main">
            <strong>${escapeHtml(step.taskName)}</strong>
            <span>${escapeHtml(step.operatorCode)}</span>
            ${
              isWarningExpandable
                ? `<button type="button" class="monthly-run-task__warning-toggle" data-warning-task-id="${escapeHtml(step.taskId)}">
                    ${escapeHtml(isExpanded ? 'Hide warning details' : 'Show warning details')}
                  </button>`
                : ''
            }
          </div>
          <span class="monthly-run-task__status">${escapeHtml(taskStateLabel(step.status))}</span>
          ${isExpanded && warningMessage ? `<div class="monthly-run-task__warning-detail">${escapeHtml(warningMessage)}</div>` : ''}
        </div>`;
      })
      .join('');

    taskList.querySelectorAll<HTMLElement>('[data-warning-task-id]').forEach((node) => {
      node.addEventListener('click', (event) => {
        event.preventDefault();
        const taskId = node.dataset.warningTaskId;
        if (!taskId) return;
        toggleWarningTask(taskId);
      });
    });

    actions.classList.toggle('hidden', pendingApprovals.length === 0);
  }

  async function refreshHistory(month = el<HTMLInputElement>('monthlyRunMonth').value) {
    const query = month ? `?month=${encodeURIComponent(month)}&limit=20` : '?limit=20';
    const data = await api<{ items: MonthlyRunHistoryRecord[] }>(`/api/monthly-runs${query}`);
    renderHistory(data.items);
  }

  function renderHistory(items: MonthlyRunHistoryRecord[]) {
    const body = el('monthlyRunHistoryBody');
    if (!items.length) {
      body.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:28px;color:#64748b;">暂无执行历史</td></tr>';
      return;
    }
    body.innerHTML = items
      .map((item) => `
        <tr>
          <td>${escapeHtml(item.monthKey)}</td>
          <td>${escapeHtml(item.sourceFileName ?? `#${item.sourceFileId ?? '-'}`)}</td>
          <td>${item.workflowRunId ? `#${item.workflowRunId}` : '-'}</td>
          <td><span class="monthly-run-status monthly-run-status--${escapeHtml(item.status === 'completed_with_warnings' ? 'warning' : item.status)}">${escapeHtml(statusLabel(item.status))}</span></td>
          <td>${escapeHtml(item.producedFileName ?? (item.producedFileId ? `#${item.producedFileId}` : '-'))}</td>
          <td>${escapeHtml(formatDateTime(item.triggeredAt))}</td>
          <td>${escapeHtml(item.errorMessage ?? '-')}</td>
        </tr>`)
      .join('');
  }

  return {
    init,
    onActivate,
  };
}

import type {
  MonthlyRunHistoryRecord,
  MonthlyRunInstanceRecord,
  MonthlyRunInstanceUpsertRequest,
  MonthlyRunSourceConfigResponse,
  MonthlyRunSourceDefinition,
  MonthlyRunSourceBinding,
  MonthlyRunTriggerResponse,
  ProductFileRecord,
  WorkflowExecutionTaskState,
  WorkflowRunRecord,
} from '../shared/types.js';
import { isWorkflowRunTerminalStatus } from '../shared/workflowRunStatus.js';
import type { ConfirmActionFn, NotifyFn } from './uiFeedback.js';
import { createWorkflowRunClient } from './workflow/runClient.js';
import type { AppLanguage } from './i18n.js';

type DomGetter = <T extends HTMLElement>(id: string) => T;

type MonthlyRunPageDeps = {
  el: DomGetter;
  api: <T>(url: string, options?: RequestInit) => Promise<T>;
  escapeHtml: (text: unknown) => string;
  formatDateTime: (value: string) => string;
  refreshProductFiles: () => Promise<unknown>;
  refreshSummary: (month: string) => Promise<unknown>;
  notify: NotifyFn;
  confirmAction: ConfirmActionFn;
  getLanguage?: () => AppLanguage;
  onMonthChanged?: (month: string) => void;
  onPlanStatusChanged?: () => void | Promise<void>;
};

type SourceDraftBindings = Record<string, MonthlyRunSourceBinding | null>;

export function retainAvailableSourceBindings(
  bindings: Record<string, MonthlyRunSourceBinding>,
  availableFiles: ReadonlyArray<Pick<ProductFileRecord, 'id'>>,
): Record<string, MonthlyRunSourceBinding> {
  if (availableFiles.length === 0) return bindings;
  return Object.fromEntries(
    Object.entries(bindings).filter(([, binding]) => availableFiles.some((file) => file.id === binding.fileId)),
  );
}

function statusLabel(status: string, language: AppLanguage = 'zh-CN'): string {
  if (language === 'zh-CN') {
    if (status === 'completed') return '已完成';
    if (status === 'completed_with_warnings') return '完成（含告警）';
    if (status === 'waiting_approval') return '需复核';
    if (status === 'failed') return '失败';
    if (status === 'skipped') return '已跳过';
    if (status === 'running') return '运行中';
    return status || '待启动';
  }
  if (status === 'completed') return 'Completed';
  if (status === 'completed_with_warnings') return 'Completed with warnings';
  if (status === 'waiting_approval') return 'Needs review';
  if (status === 'failed') return 'Failed';
  if (status === 'skipped') return 'Skipped';
  if (status === 'running') return 'Running';
  return status || 'Pending';
}

function taskStateLabel(status: WorkflowExecutionTaskState, language: AppLanguage = 'zh-CN'): string {
  if (language === 'zh-CN') {
    if (status === 'completed') return '已完成';
    if (status === 'running') return '运行中';
    if (status === 'failed') return '失败';
    if (status === 'blocked') return '已阻塞';
    if (status === 'warning') return '需复核';
    if (status === 'skipped') return '已跳过';
    return '待启动';
  }
  if (status === 'completed') return 'Completed';
  if (status === 'running') return 'Running';
  if (status === 'failed') return 'Failed';
  if (status === 'blocked') return 'Blocked';
  if (status === 'warning') return 'Needs review';
  if (status === 'skipped') return 'Skipped';
  return 'Pending';
}

function isMonthlyRunAttentionStatus(status: string): boolean {
  return status === 'failed' || status === 'waiting_approval' || status === 'completed_with_warnings';
}

function isMonthlyRunAttentionMessage(message?: string): boolean {
  return Boolean(message && !/submitting|submitted|ready|continuing|skipping/i.test(message));
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
  notify,
  confirmAction,
  getLanguage,
  onMonthChanged,
  onPlanStatusChanged,
}: MonthlyRunPageDeps) {
  const runClient = createWorkflowRunClient(api);
  let files: ProductFileRecord[] = [];
  let monthlyWorkflowCode = '';
  let sourceDefinitions: MonthlyRunSourceDefinition[] = [];
  let currentInstance: MonthlyRunInstanceRecord | null = null;
  let selectedSources: Record<string, MonthlyRunSourceBinding> = {};
  let draftSources: SourceDraftBindings = {};
  let activeHistoryId: number | null = null;
  let activeRun: WorkflowRunRecord | null = null;
  let isRunning = false;
  let isSavingSources = false;
  const expandedWarningTaskIds = new Set<string>();
  const text = {
    selectMonth: { 'zh-CN': '请选择月份', 'en-US': 'Please select a month' },
    codeDefined: { 'zh-CN': '代码定义', 'en-US': 'Code defined' },
    noInputDefinitions: { 'zh-CN': '暂无输入定义', 'en-US': 'No input definitions' },
    loadingSourceConfig: { 'zh-CN': '正在加载 source 配置…', 'en-US': 'Loading source configuration…' },
    configureSourcesHint: { 'zh-CN': '请先配置每个 workflow 输入节点需要使用的源文件。', 'en-US': 'Configure the source files required by each workflow input node first.' },
    notConfigured: { 'zh-CN': '未配置', 'en-US': 'Not configured' },
    chooseUploadedFile: { 'zh-CN': '选择已上传文件', 'en-US': 'Choose uploaded file' },
    currentFile: { 'zh-CN': '当前文件', 'en-US': 'Current file' },
    uploadNewFile: { 'zh-CN': '上传新文件', 'en-US': 'Upload new file' },
    defaultSheet: { 'zh-CN': '默认 Sheet', 'en-US': 'Default Sheet' },
    removeConfigTitle: { 'zh-CN': '删除 Uploaded file 配置', 'en-US': 'Delete Uploaded file configuration' },
    removeConfigConfirm: { 'zh-CN': '确定删除', 'en-US': 'Delete the Uploaded file configuration for' },
    removeConfigSuffix: { 'zh-CN': '的 Uploaded file 配置吗？文件中心里的文件不会被删除。', 'en-US': '? The file in Files will not be deleted.' },
    removedConfig: { 'zh-CN': '已删除', 'en-US': 'Deleted the Uploaded file configuration for' },
    removedConfigSuffix: { 'zh-CN': '的 Uploaded file 配置', 'en-US': '' },
    chooseFileFor: { 'zh-CN': '请先为', 'en-US': 'Please select a file for' },
    completeSourceConfig: { 'zh-CN': '请先完成 source 配置', 'en-US': 'Complete source configuration first' },
    submittingRun: { 'zh-CN': '正在提交 Monthly Run...', 'en-US': 'Submitting Monthly Run...' },
    submittedRun: { 'zh-CN': 'Monthly Run 已提交', 'en-US': 'Monthly Run submitted' },
    emptyRunState: { 'zh-CN': '执行后会在这里显示节点状态。', 'en-US': 'Node status will appear here after execution.' },
    reviewRequired: { 'zh-CN': '需人工复核', 'en-US': 'review required' },
    showWarningDetails: { 'zh-CN': '查看告警详情', 'en-US': 'View warning details' },
    hideWarningDetails: { 'zh-CN': '收起告警详情', 'en-US': 'Hide warning details' },
    noHistory: { 'zh-CN': '暂无执行历史', 'en-US': 'No execution history' },
    fileCount: { 'zh-CN': '个文件', 'en-US': 'files' },
    noInputSnapshot: { 'zh-CN': '暂无输入快照', 'en-US': 'No input snapshot' },
    runHistory: { 'zh-CN': '运行历史', 'en-US': 'Run history' },
    cannotDeleteRunning: { 'zh-CN': '运行中或待审批的记录不能删除', 'en-US': 'Running or approval-pending records cannot be deleted' },
    deleteHistoryTitle: { 'zh-CN': '删除运行历史及输出文件', 'en-US': 'Delete run history and output file' },
    deleteHistoryConfirm: { 'zh-CN': '确定删除这条运行历史吗？', 'en-US': 'Delete this run history?' },
    outputDeleteNotice: { 'zh-CN': '对应输出文件', 'en-US': 'The output file' },
    outputDeleteNoticeSuffix: { 'zh-CN': '也会被永久删除。', 'en-US': 'will also be permanently deleted.' },
    historyDeleted: { 'zh-CN': '运行历史及对应输出文件已删除', 'en-US': 'Run history and corresponding output file deleted' },
    delete: { 'zh-CN': '删除', 'en-US': 'Delete' },
  } satisfies Record<string, Record<AppLanguage, string>>;

  function lang(): AppLanguage {
    return getLanguage?.() ?? 'zh-CN';
  }

  function tt(key: keyof typeof text): string {
    return text[key][lang()] ?? text[key]['zh-CN'];
  }

  async function init() {
    el('btnMonthlyRunConfigureSources').addEventListener('click', () => void openSourceModal());
    el('btnMonthlyRunRefreshFiles').addEventListener('click', () => void refreshFiles());
    el('btnTriggerMonthlyRun').addEventListener('click', () => void triggerMonthlyRun());
    el('btnMonthlyRunContinue').addEventListener('click', () => void approveActiveRun('approved'));
    el('btnMonthlyRunSkip').addEventListener('click', () => void approveActiveRun('skipped'));
    el('monthlyRunMonth').addEventListener('change', () => {
      renderSourceInfo();
      onMonthChanged?.(el<HTMLInputElement>('monthlyRunMonth').value);
      if (!el('monthlyRunSourceModal').classList.contains('hidden')) {
        renderSourceModal();
      }
    });
    bindSourceModalEvents();
    await Promise.all([refreshSourceConfig(), refreshFiles(), refreshInstance(), refreshHistory()]);
    renderRunPanel();
  }

  async function onActivate() {
    await Promise.all([refreshSourceConfig(), refreshFiles(), refreshInstance(), refreshHistory()]);
    if (activeRun && !isWorkflowRunTerminalStatus(activeRun.status)) {
      await refreshActiveRun();
    }
  }

  async function openForMonth(month: string) {
    if (month) {
      el<HTMLInputElement>('monthlyRunMonth').value = month;
      renderSourceInfo();
    }
    await onActivate();
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
    monthlyWorkflowCode = data.workflowCode;
    sourceDefinitions = data.sources;
    ensureSelectedSourceBindings();
    renderSourceInfo();
    renderBusinessDefinedInputConfiguration();
  }

  async function refreshInstance() {
    const month = el<HTMLInputElement>('monthlyRunMonth').value;
    if (!month) {
      currentInstance = null;
      selectedSources = {};
      renderSourceInfo();
      renderBusinessDefinedInputConfiguration();
      return;
    }
    const data = await api<{ instance: MonthlyRunInstanceRecord }>(`/api/monthly-runs/instance?month=${encodeURIComponent(month)}`);
    currentInstance = data.instance;
    selectedSources = Object.fromEntries(
      Object.entries(data.instance.sources)
        .filter(([, value]) => typeof value.fileId === 'number' && value.fileId > 0)
        .map(([sourceKey, value]) => [sourceKey, { fileId: value.fileId as number }]),
    );
    renderSourceInfo();
    renderBusinessDefinedInputConfiguration();
  }

  async function saveInstance(patch: MonthlyRunInstanceUpsertRequest) {
    const month = el<HTMLInputElement>('monthlyRunMonth').value;
    if (!month) throw new Error(tt('selectMonth'));
    const data = await api<{ instance: MonthlyRunInstanceRecord }>(`/api/monthly-runs/instance?month=${encodeURIComponent(month)}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    });
    currentInstance = data.instance;
    selectedSources = Object.fromEntries(
      Object.entries(data.instance.sources)
        .filter(([, value]) => typeof value.fileId === 'number' && value.fileId > 0)
        .map(([sourceKey, value]) => [sourceKey, { fileId: value.fileId as number }]),
    );
    renderSourceInfo();
    renderBusinessDefinedInputConfiguration();
  }

  async function refreshFiles() {
    const data = await api<{ files: ProductFileRecord[] }>('/api/files');
    files = data.files;
    sanitizeSelectedSourceBindings();
    renderSourceInfo();
    renderBusinessDefinedInputConfiguration();
    if (!el('monthlyRunSourceModal').classList.contains('hidden')) {
      renderSourceModal();
    }
  }

  function renderUsedValue(used: boolean): string {
    return used ? '<span class="source-used source-used--true">true</span>' : '<span class="source-used source-used--false">false</span>';
  }

  function renderBusinessDefinedInputConfiguration() {
    el('shareworksBody').innerHTML = renderBusinessDefinedSourceRows('shareworks', (source) => source.sourceKey !== 'previous_capitalization_summary');
    el('previousCapitalizationSummaryBody').innerHTML = renderBusinessDefinedSingleSourceRow('previous_capitalization_summary');
    el('futuBody').innerHTML = renderBusinessDefinedSourceRows('futu');

    document.querySelectorAll<HTMLButtonElement>('[data-business-source-upload]').forEach((button) => {
      button.addEventListener('click', () => {
        const sourceKey = button.dataset.businessSourceUpload;
        if (!sourceKey) return;
        void uploadSourceFileFor(sourceKey);
      });
    });

    document.querySelectorAll<HTMLButtonElement>('[data-business-source-remove]').forEach((button) => {
      button.addEventListener('click', () => {
        const sourceKey = button.dataset.businessSourceRemove;
        if (!sourceKey) return;
        void removeSourceFileFor(sourceKey);
      });
    });

    document.querySelectorAll<HTMLElement>('.source-file-link[data-product-file-id]').forEach((link) => {
      link.addEventListener('click', (event) => {
        event.preventDefault();
        const fileId = Number(link.dataset.productFileId);
        if (!fileId) return;
        window.location.href = `/files?fileId=${fileId}`;
      });
    });
  }

  function renderBusinessDefinedSourceRows(
    sourceGroup: 'shareworks' | 'futu',
    predicate: (source: MonthlyRunSourceDefinition) => boolean = () => true,
  ) {
    const sources = sourceDefinitions.filter((source) => source.sourceGroup === sourceGroup && predicate(source));
    if (!sources.length) return `<tr><td colspan="6" class="table-empty-cell">${escapeHtml(tt('noInputDefinitions'))}</td></tr>`;
    return sources
      .map((source) => {
        const binding = selectedSources[source.sourceKey] ?? null;
        const file = binding ? getFileById(binding.fileId) : null;
        const displayName = file ? getFileDisplayName(file) : '';
        const uploaded = file
          ? `<div class="source-file-actions"><a href="/files?fileId=${file.id}" class="source-file-link" data-product-file-id="${file.id}" title="${escapeHtml(displayName)}">${escapeHtml(displayName)}</a></div>`
          : '<span class="source-not-uploaded">Not uploaded</span>';
        const uploadedTime = file ? formatCompactTimestamp(file.createdAt) : '-';
        const actions = file
          ? `<div class="source-file-action-group">
              <button class="source-upload-btn" type="button" data-business-source-upload="${escapeHtml(source.sourceKey)}">Update</button>
              <button class="source-file-delete source-file-delete--text" type="button" data-business-source-remove="${escapeHtml(source.sourceKey)}">Delete</button>
            </div>`
          : `<button class="source-upload-btn" type="button" data-business-source-upload="${escapeHtml(source.sourceKey)}">Upload</button>`;
        return `<tr>
          <td style="text-align:left; font-weight:600;">${escapeHtml(source.label)}</td>
          <td>${renderUsedValue(source.required)}</td>
          <td>${source.required ? '<span class="source-required-badge">Required</span>' : '<span class="source-optional-badge">Optional</span>'}</td>
          <td>${uploaded}</td>
          <td class="source-uploaded-time">${escapeHtml(uploadedTime)}</td>
          <td>${actions}</td>
        </tr>`;
      })
      .join('');
  }

  function renderBusinessDefinedSingleSourceRow(sourceKey: string) {
    const source = sourceDefinitions.find((item) => item.sourceKey === sourceKey);
    if (!source) return `<tr><td colspan="6" class="table-empty-cell">${escapeHtml(tt('noInputDefinitions'))}</td></tr>`;
    const binding = selectedSources[source.sourceKey] ?? null;
    const file = binding ? getFileById(binding.fileId) : null;
    const displayName = file ? getFileDisplayName(file) : '';
    const uploaded = file
      ? `<div class="source-file-actions"><a href="/files?fileId=${file.id}" class="source-file-link" data-product-file-id="${file.id}" title="${escapeHtml(displayName)}">${escapeHtml(displayName)}</a></div>`
      : '<span class="source-not-uploaded">Not uploaded</span>';
    const uploadedTime = file ? formatCompactTimestamp(file.createdAt) : '-';
    const actions = file
      ? `<div class="source-file-action-group">
          <button class="source-upload-btn" type="button" data-business-source-upload="${escapeHtml(source.sourceKey)}">Update</button>
          <button class="source-file-delete source-file-delete--text" type="button" data-business-source-remove="${escapeHtml(source.sourceKey)}">Delete</button>
        </div>`
      : `<button class="source-upload-btn" type="button" data-business-source-upload="${escapeHtml(source.sourceKey)}">Upload</button>`;
    return `<tr>
      <td style="text-align:left; font-weight:600;">${escapeHtml(source.label)}</td>
      <td>${renderUsedValue(source.required)}</td>
      <td>${source.required ? '<span class="source-required-badge">Required</span>' : '<span class="source-optional-badge">Optional</span>'}</td>
      <td>${uploaded}</td>
      <td class="source-uploaded-time">${escapeHtml(uploadedTime)}</td>
      <td>${actions}</td>
    </tr>`;
  }

  function ensureSelectedSourceBindings() {
    if (!sourceDefinitions.length) return;
    selectedSources = retainAvailableSourceBindings(selectedSources, files);
  }

  function sanitizeSelectedSourceBindings() {
    selectedSources = retainAvailableSourceBindings(selectedSources, files);
    ensureSelectedSourceBindings();
  }

  function getFileById(fileId: number | null | undefined): ProductFileRecord | null {
    if (!fileId) return null;
    return files.find((file) => file.id === fileId) ?? null;
  }

  function getFileDisplayName(file: ProductFileRecord) {
    return file.displayName || file.originalName;
  }

  function formatCompactTimestamp(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    const pad = (part: number) => String(part).padStart(2, '0');
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  }

  function renderSourceInfo() {
    const info = el('monthlyRunSourceInfo');
    if (!sourceDefinitions.length) {
      info.innerHTML = `<span>${escapeHtml(tt('loadingSourceConfig'))}</span>`;
      return;
    }

    const configured = sourceDefinitions.filter((source) => selectedSources[source.sourceKey]?.fileId);
    if (!configured.length) {
      info.innerHTML = `<span>${escapeHtml(tt('configureSourcesHint'))}</span>`;
      return;
    }

    info.innerHTML = configured
      .map((source) => {
        const file = getFileById(selectedSources[source.sourceKey]?.fileId);
        return `<span class="monthly-run-source-pill"><strong>${escapeHtml(source.label)}</strong>${file ? escapeHtml(getFileDisplayName(file)) : escapeHtml(tt('notConfigured'))}</span>`;
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
          `<option value="">${escapeHtml(tt('chooseUploadedFile'))}</option>`,
          ...files.map((productFile) => {
            const selected = binding?.fileId === productFile.id ? ' selected' : '';
            return `<option value="${productFile.id}"${selected}>${escapeHtml(getFileDisplayName(productFile))} · ${escapeHtml(formatDateTime(productFile.createdAt))}</option>`;
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
              <span>${escapeHtml(tt('currentFile'))}</span>
              <strong>${file ? escapeHtml(getFileDisplayName(file)) : escapeHtml(tt('notConfigured'))}</strong>
            </div>
            <div class="monthly-run-source-card__controls">
              <select class="search-input monthly-run-source-card__select" data-source-select="${escapeHtml(source.sourceKey)}">
                ${options}
              </select>
              <button class="btn btn-secondary monthly-run-source-card__upload" type="button" data-source-upload="${escapeHtml(source.sourceKey)}">
                ${escapeHtml(tt('uploadNewFile'))}
              </button>
            </div>
            <div class="monthly-run-source-card__hint">
              <span>${escapeHtml(tt('defaultSheet'))}</span>
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
      selectedSources[sourceKey] = { fileId: data.file.id };
      await saveInstance({
        operator: currentInstance?.operator ?? 'Administrator',
        sources: { [sourceKey]: { fileId: data.file.id } },
      });
      renderSourceInfo();
      renderBusinessDefinedInputConfiguration();
      renderSourceModal();
    });
    input.click();
  }

  async function removeSourceFileFor(sourceKey: string) {
    const source = sourceDefinitions.find((item) => item.sourceKey === sourceKey);
    const label = source?.label ?? sourceKey;
    if (!(await confirmAction(`${tt('removeConfigConfirm')} ${label} ${tt('removeConfigSuffix')}`, {
      title: tt('removeConfigTitle'),
      confirmText: tt('delete'),
      tone: 'danger',
    }))) {
      return;
    }

    delete selectedSources[sourceKey];
    draftSources[sourceKey] = null;
    await saveInstance({
      operator: currentInstance?.operator ?? 'Administrator',
      sources: { [sourceKey]: null },
    });
    renderSourceInfo();
    renderBusinessDefinedInputConfiguration();
    if (!el('monthlyRunSourceModal').classList.contains('hidden')) {
      renderSourceModal();
    }
    notify(`${tt('removedConfig')} ${label} ${tt('removedConfigSuffix')}`.trim(), { type: 'success' });
  }

  async function saveSourceModal() {
    const missing = sourceDefinitions.find((source) => source.required && !draftSources[source.sourceKey]?.fileId);
    if (missing) {
      notify(`${tt('chooseFileFor')} ${missing.label}`, { type: 'warning' });
      return;
    }
    isSavingSources = true;
    const nextSources: Record<string, MonthlyRunSourceBinding> = {};
    for (const [sourceKey, binding] of Object.entries(draftSources)) {
      if (binding?.fileId) nextSources[sourceKey] = binding;
    }
    selectedSources = nextSources;
    await saveInstance({
      operator: currentInstance?.operator ?? 'Administrator',
      sources: Object.fromEntries(
        sourceDefinitions.map((source) => [source.sourceKey, nextSources[source.sourceKey] ?? null]),
      ),
    });
    renderSourceInfo();
    renderBusinessDefinedInputConfiguration();
    isSavingSources = false;
    closeSourceModal();
  }

  async function triggerMonthlyRun() {
    const month = el<HTMLInputElement>('monthlyRunMonth').value;
    if (!month) {
      notify(tt('selectMonth'), { type: 'warning' });
      return;
    }
    if (!sourceDefinitions.every((source) => !source.required || selectedSources[source.sourceKey]?.fileId)) {
      notify(tt('completeSourceConfig'), { type: 'warning' });
      return;
    }
    if (isRunning) return;

    isRunning = true;
    activeHistoryId = null;
    activeRun = null;
    expandedWarningTaskIds.clear();
    renderRunPanel(tt('submittingRun'));
    let failedMessage: string | null = null;

    try {
      const response = await api<MonthlyRunTriggerResponse>('/api/monthly-runs', {
        method: 'POST',
        body: JSON.stringify({
          workflowCode: monthlyWorkflowCode,
          month,
          operator: currentInstance?.operator ?? 'Administrator',
        }),
      });
      activeHistoryId = response.history.id;
      activeRun = response.executionResult.run ?? null;
      renderRunPanel(tt('submittedRun'));
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
      failedMessage = error instanceof Error ? error.message : 'Monthly run failed';
      renderRunPanel(failedMessage);
    } finally {
      isRunning = false;
      await refreshHistory(month);
      await onPlanStatusChanged?.();
      renderRunPanel(failedMessage ?? undefined);
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
    await onPlanStatusChanged?.();
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
      if (isMonthlyRunAttentionMessage(overrideMessage)) {
        summary.classList.remove('hidden');
        summary.innerHTML = `<span class="monthly-run-status monthly-run-status--failed">${escapeHtml(overrideMessage)}</span>`;
      } else {
        summary.classList.add('hidden');
        summary.innerHTML = '';
      }
      taskList.innerHTML = `<div class="monthly-run-empty">${escapeHtml(tt('emptyRunState'))}</div>`;
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
    const shouldShowSummary = isMonthlyRunAttentionMessage(overrideMessage) || Boolean(run.errorMessage) || isMonthlyRunAttentionStatus(run.status);
    if (shouldShowSummary) {
      summary.classList.remove('hidden');
      summary.innerHTML = `<span class="monthly-run-status monthly-run-status--${escapeHtml(statusCode)}">${escapeHtml(statusLabel(run.status, lang()))}</span>${
        overrideMessage || run.errorMessage ? `<span>${escapeHtml(overrideMessage ?? run.errorMessage)}</span>` : ''
      }`;
    } else {
      summary.classList.add('hidden');
      summary.innerHTML = '';
    }
    progressBar.style.width = `${ratio * 100}%`;
    progressText.textContent = pendingApprovals.length ? `${reached} / ${total} · ${tt('reviewRequired')}` : `${reached} / ${total}`;
    taskList.innerHTML = run.steps
      .map((step, index) => {
        const warningMessage = step.status === 'warning' ? getWarningMessageForTask(run, step.taskId) : null;
        const failureMessage = step.status === 'failed' || step.status === 'blocked' ? step.errorMessage?.trim() ?? '' : '';
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
                    ${escapeHtml(isExpanded ? tt('hideWarningDetails') : tt('showWarningDetails'))}
                  </button>`
                : ''
            }
          </div>
          <span class="monthly-run-task__status">${escapeHtml(taskStateLabel(step.status, lang()))}</span>
          ${isExpanded && warningMessage ? `<div class="monthly-run-task__warning-detail">${escapeHtml(warningMessage)}</div>` : ''}
          ${failureMessage ? `<div class="monthly-run-task__failure-detail">${escapeHtml(failureMessage)}</div>` : ''}
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
      body.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:28px;color:#64748b;">${escapeHtml(tt('noHistory'))}</td></tr>`;
      return;
    }
    body.innerHTML = items
      .map((item) => {
        const canDelete = !['pending', 'running', 'waiting_approval'].includes(item.status);
        const inputSummary = item.inputFiles.length
          ? `${escapeHtml(item.inputFiles.filter((input) => input.fileId || input.fileName).length.toString())}/${escapeHtml(item.inputFiles.length.toString())} ${escapeHtml(tt('fileCount'))}`
          : '-';
        const inputDetails = item.inputFiles.length
          ? item.inputFiles
              .map(
                (input) => `
                  <div class="monthly-run-history__input-item">
                    <span class="monthly-run-history__input-label">${escapeHtml(input.label)}</span>
                    <span class="monthly-run-history__input-value">${escapeHtml(input.fileName ?? (input.fileId ? `#${input.fileId}` : '-'))}</span>
                  </div>`,
              )
              .join('')
              : `<div class="monthly-run-history__input-empty">${escapeHtml(tt('noInputSnapshot'))}</div>`;
        return `
        <tr class="monthly-run-history__row">
          <td class="monthly-run-history__run-cell">
            <button class="table-link-button table-link-button--subtle" data-history-toggle="${item.id}" type="button">
              ${item.workflowRunId ? `#${item.workflowRunId}` : `${escapeHtml(tt('runHistory'))} #${item.id}`}
            </button>
          </td>
          <td>
            <button class="table-link-button table-link-button--subtle" data-history-toggle="${item.id}" type="button">${inputSummary}</button>
          </td>
          <td><span class="monthly-run-status monthly-run-status--${escapeHtml(item.status === 'completed_with_warnings' ? 'warning' : item.status)}">${escapeHtml(statusLabel(item.status, lang()))}</span></td>
          <td>${escapeHtml(item.producedFileName ?? (item.producedFileId ? `#${item.producedFileId}` : '-'))}</td>
          <td>${escapeHtml(formatDateTime(item.triggeredAt))}</td>
          <td>${escapeHtml(item.errorMessage ?? '-')}</td>
          <td><button class="btn btn-danger btn-sm" data-history-delete="${item.id}" type="button" ${canDelete ? '' : `disabled title="${escapeHtml(tt('cannotDeleteRunning'))}"`}>${escapeHtml(tt('delete'))}</button></td>
        </tr>
        <tr class="monthly-run-history__detail-row hidden" data-history-detail="${item.id}">
          <td colspan="7">
            <div class="monthly-run-history__detail">
              <div class="monthly-run-history__detail-header">
                <strong>Input</strong>
                <span>${escapeHtml(item.monthKey)}</span>
              </div>
              <div class="monthly-run-history__input-list">${inputDetails}</div>
            </div>
          </td>
        </tr>`;
      })
      .join('');

    body.querySelectorAll<HTMLElement>('[data-history-toggle]').forEach((button) => {
      button.addEventListener('click', () => {
        const historyId = button.dataset.historyToggle;
        if (!historyId) return;
        body.querySelector(`[data-history-detail="${historyId}"]`)?.classList.toggle('hidden');
      });
    });
    body.querySelectorAll<HTMLElement>('[data-history-delete]').forEach((button) => {
      button.addEventListener('click', async () => {
        const historyId = Number(button.dataset.historyDelete);
        if (!historyId) return;
        const history = items.find((item) => item.id === historyId);
        const outputNotice = history?.producedFileName
          ? `\n${tt('outputDeleteNotice')} “${history.producedFileName}” ${tt('outputDeleteNoticeSuffix')}`
          : '';
        if (!(await confirmAction(`${tt('deleteHistoryConfirm')}${outputNotice}`, { title: tt('deleteHistoryTitle'), confirmText: tt('delete'), tone: 'danger' }))) return;
        await api(`/api/monthly-runs/${historyId}`, { method: 'DELETE' });
        if (activeHistoryId === historyId) {
          activeHistoryId = null;
          activeRun = null;
          renderRunPanel();
        }
        await Promise.all([refreshHistory(), refreshFiles(), refreshInstance(), refreshProductFiles()]);
        const month = el<HTMLInputElement>('monthlyRunMonth').value;
        if (month) await refreshSummary(month);
        notify(tt('historyDeleted'), { type: 'success' });
      });
    });
  }

  return {
    init,
    onActivate,
    openForMonth,
    applyLanguage() {
      renderSourceInfo();
      renderBusinessDefinedInputConfiguration();
      renderRunPanel();
      void refreshHistory();
    },
  };
}

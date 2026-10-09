import { getWorkflowFileParamRuntimePath, isWorkflowRuntimeParameterReference } from './taskOperators.js';
import {
  buildRuntimeInputFileItems,
  isRuntimeFileParameter,
  isRuntimeInputFileParameter,
  shouldRerenderRuntimeDefaultControl,
  type RuntimeInputFileItem,
  type RuntimeParameterEntry,
} from './runtimeParameterPresentation.js';
import {
  flattenWorkflowRuntimeSchema,
  getNestedValueAtPath,
  stringifyWorkflowJson,
  workflowRuntimeDefaultString,
} from './runtimeDefaults.js';
import type { FilePickerResult } from '../filePickerModal.js';
import type { ProductFileDetail, ProductFileRecord, WorkflowDefinition, WorkflowTask } from '../../shared/types.js';

/**
 * The runtime-parameters panel of the workflow editor: the collapsible constants / input-files
 * summary, the per-parameter default editors, the raw schema+defaults JSON view, and the sync that
 * writes a control back into the workflow.
 *
 * It is separated because the panel and the task editor both edit the same
 * `runtimeParamsDefaults` object through different controls, and a disagreement between them shows
 * up as a default that silently reverts on save.
 */

export type RuntimeParamsPanelDeps = {
  el: <T extends HTMLElement>(id: string) => T;
  api: <T>(url: string, options?: RequestInit) => Promise<T>;
  escapeHtml: (text: unknown) => string;
  notify: (message: string, options?: { type?: 'info' | 'success' | 'warning' | 'error' }) => void;
  getProductFiles: () => ProductFileRecord[];
  productFileDisplayName: (file: ProductFileRecord) => string;
  openFilePicker: (options: {
    titleKey?: 'title' | 'defaultFileTitle' | 'fileSourceTitle';
    currentFileId?: number | null;
    allowClear?: boolean;
    uploadFolderPrefix?: string;
  }) => Promise<FilePickerResult | null>;
};

export type RuntimeParamsPanelHost = {
  getWorkflow: () => WorkflowDefinition | null;
  /** Id of the task the editor is showing, so a stale sheet hydration can bail out. */
  getActiveTaskId: () => string | null;
  getCollapsed: () => boolean;
  setCollapsed: (collapsed: boolean) => void;
  localizeDom: () => void;
  /** A changed default invalidates the current run's cached results. */
  resetRunState: (workflowId: number) => void;
  /** Re-render the whole editor (used after applying raw JSON). */
  rerenderEditor: () => void;
  runtimeFileId: (value: unknown) => number | null;
  runtimeDefaultFileId: (workflow: WorkflowDefinition, runtimePath: string) => number | null;
  setRuntimeDefaultFileId: (workflow: WorkflowDefinition, runtimePath: string, fileId: number | null) => void;
  syncRuntimeDefaultControl: (workflow: WorkflowDefinition, control: HTMLInputElement | HTMLSelectElement) => boolean;
  formatRuntimeDefaultDisplay: (entry: { path: string; type: string }, value: unknown) => string;
  formatRuntimeFileSelectionLabel: (runtimePath: string) => string;
  /** Load the sheet options for a runtime-sheet control (needs the workbook API). */
  hydrateSheetControl: (control: HTMLSelectElement, workflow: WorkflowDefinition) => Promise<void>;
};

export function createRuntimeParamsPanel(deps: RuntimeParamsPanelDeps, host: RuntimeParamsPanelHost) {
  function renderRuntimeDefaultEditor(entry: { path: string; type: string }, value: unknown) {
    const pathAttr = deps.escapeHtml(entry.path);
    if (isRuntimeFileParameter(entry)) {
      const currentValue = host.runtimeFileId(value);
      const file = currentValue ? deps.getProductFiles().find((item) => item.id === currentValue) : undefined;
      const label = file ? deps.productFileDisplayName(file) : '未设置默认文件';
      const detail = file ? `${file.logicalPath ?? file.displayPath} · #${file.id}` : '点击选择文件';
      return `
      <div class="workflow-runtime-summary__filepick" data-file-pick>
        <input type="hidden" class="workflow-runtime-summary__control" value="${currentValue ?? ''}" data-runtime-default-path="${pathAttr}" data-runtime-default-type="fileRef">
        <button type="button" class="workflow-runtime-summary__filepick-trigger" data-file-pick-open title="${deps.escapeHtml(detail)}">
          <span class="workflow-runtime-summary__filepick-name">${deps.escapeHtml(label)}</span>
          <span class="workflow-runtime-summary__filepick-path">${deps.escapeHtml(detail)}</span>
        </button>
      </div>`;
    }
    if (entry.type === 'number') {
      return `<input class="workflow-runtime-summary__control" type="number" value="${deps.escapeHtml(value ?? '')}" data-runtime-default-path="${pathAttr}" data-runtime-default-type="number">`;
    }
    if (entry.type === 'boolean') {
      return `
      <select class="workflow-runtime-summary__control" data-runtime-default-path="${pathAttr}" data-runtime-default-type="boolean">
        <option value="">No default</option>
        <option value="true"${value === true ? ' selected' : ''}>true</option>
        <option value="false"${value === false ? ' selected' : ''}>false</option>
      </select>`;
    }
    return `<input class="workflow-runtime-summary__control" value="${deps.escapeHtml(value ?? '')}" data-runtime-default-path="${pathAttr}" data-runtime-default-type="string">`;
  }

  function renderWorkflowRuntimeParameterItem(workflow: WorkflowDefinition, entry: RuntimeParameterEntry) {
    const rawDefaultValue = getNestedValueAtPath(workflow.runtimeParamsDefaults as Record<string, unknown>, entry.path);
    const defaultValue = host.formatRuntimeDefaultDisplay(entry, rawDefaultValue);
    return `
    <div class="workflow-runtime-summary__item">
      <div class="workflow-runtime-summary__item-top">
        <span class="workflow-runtime-summary__path">${deps.escapeHtml(entry.path)}</span>
        <span class="workflow-runtime-summary__type">${deps.escapeHtml(entry.type)}</span>
        ${entry.required ? '<span class="workflow-runtime-summary__required">required</span>' : ''}
      </div>
      <div class="workflow-runtime-summary__default">default: ${deps.escapeHtml(defaultValue)}</div>
      ${renderRuntimeDefaultEditor(entry, rawDefaultValue)}
    </div>`;
  }

  function renderRuntimeSheetEditor(
    workflow: WorkflowDefinition,
    fileEntry: RuntimeParameterEntry,
    sheetEntry: RuntimeParameterEntry,
  ) {
    const fileId = host.runtimeDefaultFileId(workflow, fileEntry.path);
    const currentSheet = getNestedValueAtPath(
      workflow.runtimeParamsDefaults as Record<string, unknown>,
      sheetEntry.path,
    );
    const currentSheetName = typeof currentSheet === 'string' ? currentSheet : '';
    const options = fileId
      ? `<option value="${deps.escapeHtml(currentSheetName)}">Loading sheets...</option>`
      : '<option value="">Select a file first</option>';
    return `
    <label class="workflow-runtime-summary__linked-field">
      <span>${deps.escapeHtml(sheetEntry.label)}</span>
      <select
        class="workflow-runtime-summary__control"
        data-runtime-default-path="${deps.escapeHtml(sheetEntry.path)}"
        data-runtime-default-type="string"
        data-runtime-sheet-file-path="${deps.escapeHtml(fileEntry.path)}"
        ${fileId ? '' : 'disabled'}
      >${options}</select>
    </label>`;
  }

  function renderWorkflowRuntimeInputFileItem(workflow: WorkflowDefinition, item: RuntimeInputFileItem) {
    const fileDefault = getNestedValueAtPath(workflow.runtimeParamsDefaults as Record<string, unknown>, item.file.path);
    return `
    <div class="workflow-runtime-summary__item workflow-runtime-summary__item--input-source">
      <div class="workflow-runtime-summary__item-top">
        <span class="workflow-runtime-summary__path">${deps.escapeHtml(item.file.label)}</span>
        <span class="workflow-runtime-summary__type">${item.sheet ? 'file + sheet' : 'file'}</span>
        ${item.file.required || item.sheet?.required ? '<span class="workflow-runtime-summary__required">required</span>' : ''}
      </div>
      <div class="workflow-runtime-summary__technical-path">
        ${deps.escapeHtml(item.file.path)}${item.sheet ? ` · ${deps.escapeHtml(item.sheet.path)}` : ''}
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
          <div class="workflow-runtime-summary__group-title">${deps.escapeHtml(title)}</div>
          <div class="workflow-runtime-summary__group-description">${deps.escapeHtml(description)}</div>
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
    const fileId = host.runtimeDefaultFileId(workflow, filePath);
    if (!fileId || !sheetPath) return;
    try {
      const detail = await deps.api<ProductFileDetail>(`/api/files/${fileId}`);
      if (!control.isConnected) return;
      const current = getNestedValueAtPath(workflow.runtimeParamsDefaults as Record<string, unknown>, sheetPath);
      const currentName = typeof current === 'string' ? current : '';
      control.innerHTML = [
        '<option value="">Select sheet</option>',
        ...detail.sheets.map(
          (sheet) => `<option value="${deps.escapeHtml(sheet.sheetName)}">${deps.escapeHtml(sheet.sheetName)}</option>`,
        ),
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
    const workflow = host.getWorkflow();
    if (!workflow || !isWorkflowRuntimeParameterReference(task.params.sheetName)) return;
    const sheetPath = task.params.sheetName.$fromRuntime;
    const filePath = getWorkflowFileParamRuntimePath(task.params.fileRef ?? task.params.fileId);
    const sheetSelect = deps.el<HTMLSelectElement>('workflowPreviewSheetSelect');
    if (!filePath) {
      sheetSelect.innerHTML = '<option value="">Select a runtime file first</option>';
      sheetSelect.disabled = true;
      return;
    }

    const fileId = host.runtimeDefaultFileId(workflow, filePath);
    if (!fileId) {
      sheetSelect.innerHTML = '<option value="">Select a file first</option>';
      sheetSelect.disabled = true;
      return;
    }

    const currentSheet =
      workflowRuntimeDefaultString(workflow, sheetPath) ||
      (typeof task.params.sheetName.$default === 'string' ? task.params.sheetName.$default : '');
    sheetSelect.innerHTML = `<option value="${deps.escapeHtml(currentSheet)}">Loading sheets...</option>`;
    sheetSelect.disabled = true;
    try {
      const detail = await deps.api<ProductFileDetail>(`/api/files/${fileId}`);
      if (!sheetSelect.isConnected || host.getActiveTaskId() !== task.id) return;
      sheetSelect.innerHTML = [
        '<option value="">Select sheet</option>',
        ...detail.sheets.map(
          (sheet) => `<option value="${deps.escapeHtml(sheet.sheetName)}">${deps.escapeHtml(sheet.sheetName)}</option>`,
        ),
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
    const workflow = host.getWorkflow();
    if (!workflow) return;
    if (!host.syncRuntimeDefaultControl(workflow, control)) return;
    host.resetRunState(workflow.id);
    if (shouldRerenderRuntimeDefaultControl(control.dataset.runtimeDefaultType ?? '')) {
      renderWorkflowRuntimeParamsSummary(workflow);
    }
  }

  function applyRuntimeJsonFromTextareas() {
    const workflow = host.getWorkflow();
    if (!workflow) return;
    try {
      const schema = JSON.parse(
        (document.querySelector('[data-workflow-runtime-json="schema"]') as HTMLTextAreaElement | null)?.value || '{}',
      ) as WorkflowDefinition['runtimeParamsSchema'];
      const defaults = JSON.parse(
        (document.querySelector('[data-workflow-runtime-json="defaults"]') as HTMLTextAreaElement | null)?.value ||
          '{}',
      ) as WorkflowDefinition['runtimeParamsDefaults'];
      workflow.runtimeParamsSchema = schema;
      workflow.runtimeParamsDefaults = defaults;
      host.resetRunState(workflow.id);
      host.rerenderEditor();
      deps.notify('Runtime parameters 已应用，点击 Save 后保存到工作流', { type: 'success' });
    } catch (error) {
      deps.notify(`Runtime parameters JSON 格式错误：${(error as Error).message}`, { type: 'error' });
    }
  }

  function renderWorkflowRuntimeParamsSummary(workflow: WorkflowDefinition | null) {
    const container = deps.el('workflowRuntimeParamsSummary');
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
    container.classList.toggle('is-collapsed', host.getCollapsed());
    container.innerHTML = `
    <div class="workflow-runtime-summary__header">
      <button
        class="workflow-runtime-summary__toggle"
        type="button"
        aria-expanded="${String(!host.getCollapsed())}"
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
            <textarea class="workflow-runtime-summary__raw-textarea" spellcheck="false" data-workflow-runtime-json="schema">${deps.escapeHtml(
              stringifyWorkflowJson(workflow.runtimeParamsSchema),
            )}</textarea>
          </label>
          <label>
            <span>defaults</span>
            <textarea class="workflow-runtime-summary__raw-textarea" spellcheck="false" data-workflow-runtime-json="defaults">${deps.escapeHtml(
              stringifyWorkflowJson(workflow.runtimeParamsDefaults),
            )}</textarea>
          </label>
        </div>
      </details>
    </div>
  `;

    container.querySelector<HTMLElement>('[data-workflow-runtime-toggle]')?.addEventListener('click', () => {
      host.setCollapsed(!host.getCollapsed());
      renderWorkflowRuntimeParamsSummary(workflow);
    });

    container
      .querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-runtime-default-path]')
      .forEach((control) => {
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
    container
      .querySelector<HTMLElement>('[data-workflow-runtime-json-apply]')
      ?.addEventListener('click', applyRuntimeJsonFromTextareas);
    host.localizeDom();
  }

  /**
   * The picker only writes the file id into the hidden control and fires `change`, so the existing
   * sync → re-render → sheet hydration path stays the single source of truth.
   */
  async function openRuntimeFilePicker(trigger: HTMLElement) {
    const control = trigger
      .closest('[data-file-pick]')
      ?.querySelector<HTMLInputElement>('input[data-runtime-default-type="fileRef"]');
    if (!control) return;
    const currentFileId = control.value ? Number(control.value) : null;
    const result = await deps.openFilePicker({
      titleKey: 'defaultFileTitle',
      currentFileId,
      allowClear: true,
      uploadFolderPrefix: 'input',
    });
    if (!result) return;
    control.value = result.action === 'pick' ? String(result.fileId) : '';
    control.dispatchEvent(new Event('change', { bubbles: true }));
  }

  return {
    render: renderWorkflowRuntimeParamsSummary,
    syncFromControl: syncRuntimeDefaultFromControl,
    applyJsonFromTextareas: applyRuntimeJsonFromTextareas,
    hydrateStructuredSheetControl: hydrateStructuredRuntimeSheetControl,
    hydrateSheetControl: hydrateRuntimeSheetControl,
  };
}

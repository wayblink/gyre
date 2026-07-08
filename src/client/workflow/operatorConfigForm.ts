import type { WorkflowOperator, WorkflowOperatorParamField, WorkflowTask } from '../../shared/types.js';

type RenderOperatorConfigFormOptions = {
  container: HTMLElement;
  operator: WorkflowOperator | null;
  task: WorkflowTask;
  excludedParamKeys: Set<string>;
  escapeHtml: (text: unknown) => string;
  onChange: () => void;
};

type SyncOperatorConfigFormOptions = {
  container: HTMLElement;
  operator: WorkflowOperator | null;
  task: WorkflowTask;
  excludedParamKeys: Set<string>;
};

function shouldUseTextarea(key: string, value: unknown) {
  if (key.toLowerCase().includes('sql')) return true;
  if (typeof value === 'string' && (value.includes('\n') || value.length > 96)) return true;
  return false;
}

function fieldValue(task: WorkflowTask, key: string, field: WorkflowOperatorParamField) {
  if (Object.prototype.hasOwnProperty.call(task.params ?? {}, key)) return task.params[key];
  return field.default ?? '';
}

function fieldHint(field: WorkflowOperatorParamField, escapeHtml: (text: unknown) => string) {
  return field.description ? `<div class="workflow-structured__section-subtitle">${escapeHtml(field.description)}</div>` : '';
}

function renderInputField(key: string, field: WorkflowOperatorParamField, value: unknown, escapeHtml: (text: unknown) => string) {
  const required = field.required ? '<span class="workflow-generic-param__required">*</span>' : '';
  const label = `<label class="workflow-structured__label" for="workflowGenericParam-${escapeHtml(key)}">${escapeHtml(field.label)}${required}</label>`;
  const placeholder = field.placeholder ? ` placeholder="${escapeHtml(field.placeholder)}"` : '';
  const commonAttrs = `id="workflowGenericParam-${escapeHtml(key)}" data-workflow-generic-param="${escapeHtml(key)}"`;

  if (field.enum?.length) {
    const currentValue = String(value ?? '');
    return `
      <div class="workflow-generic-param">
        ${label}
        <select class="search-input workflow-select" ${commonAttrs}>
          ${field.enum
            .map((item) => `<option value="${escapeHtml(item)}"${item === currentValue ? ' selected' : ''}>${escapeHtml(item)}</option>`)
            .join('')}
        </select>
        ${fieldHint(field, escapeHtml)}
      </div>`;
  }

  if (field.type === 'boolean') {
    return `
      <div class="workflow-generic-param">
        <label class="workflow-checkbox workflow-generic-param__checkbox">
          <input type="checkbox" ${commonAttrs} ${value === true ? 'checked' : ''}>
          <span>${escapeHtml(field.label)}${required}</span>
        </label>
        ${fieldHint(field, escapeHtml)}
      </div>`;
  }

  if (field.type === 'array' || field.type === 'object') {
    const textValue = Array.isArray(value) || (value && typeof value === 'object') ? JSON.stringify(value, null, 2) : String(value ?? '');
    const expectedLabel = field.type === 'array' ? 'array' : 'object';
    return `
      <div class="workflow-generic-param">
        ${label}
        <textarea class="workflow-code-input workflow-code-input--compact" ${commonAttrs} spellcheck="false"${placeholder}>${escapeHtml(textValue)}</textarea>
        ${fieldHint(field, escapeHtml)}
        <div class="workflow-generic-param__error hidden" data-workflow-generic-param-error="${escapeHtml(key)}">Invalid JSON ${expectedLabel}.</div>
      </div>`;
  }

  if (field.type === 'number') {
    return `
      <div class="workflow-generic-param">
        ${label}
        <input class="search-input workflow-input" type="number" ${commonAttrs} value="${escapeHtml(value ?? '')}"${placeholder}>
        ${fieldHint(field, escapeHtml)}
      </div>`;
  }

  if (shouldUseTextarea(key, value)) {
    return `
      <div class="workflow-generic-param">
        ${label}
        <textarea class="workflow-code-input workflow-code-input--compact" ${commonAttrs} spellcheck="false"${placeholder}>${escapeHtml(value ?? '')}</textarea>
        ${fieldHint(field, escapeHtml)}
      </div>`;
  }

  return `
    <div class="workflow-generic-param">
      ${label}
      <input class="search-input workflow-input" ${commonAttrs} value="${escapeHtml(value ?? '')}"${placeholder}>
      ${fieldHint(field, escapeHtml)}
    </div>`;
}

export function renderOperatorConfigForm({
  container,
  operator,
  task,
  excludedParamKeys,
  escapeHtml,
  onChange,
}: RenderOperatorConfigFormOptions) {
  const fields = Object.entries(operator?.paramsSchema ?? {}).filter(([key]) => !excludedParamKeys.has(key));
  if (!operator || fields.length === 0) {
    container.innerHTML = '';
    return false;
  }

  container.innerHTML = `
    <div class="workflow-structured__section-head">
      <div class="workflow-structured__label">Advanced Params</div>
    </div>
    <div class="workflow-generic-param-grid">
      ${fields.map(([key, field]) => renderInputField(key, field, fieldValue(task, key, field), escapeHtml)).join('')}
    </div>
  `;

  container.querySelectorAll<HTMLElement>('[data-workflow-generic-param]').forEach((input) => {
    const eventName = input instanceof HTMLSelectElement || (input instanceof HTMLInputElement && input.type === 'checkbox') ? 'change' : 'input';
    input.addEventListener(eventName, onChange);
  });
  return true;
}

export function syncOperatorConfigForm({ container, operator, task, excludedParamKeys }: SyncOperatorConfigFormOptions) {
  const schema = operator?.paramsSchema ?? {};
  let hasInvalidValue = false;

  container.querySelectorAll<HTMLElement>('[data-workflow-generic-param]').forEach((input) => {
    const key = input.dataset.workflowGenericParam ?? '';
    const field = schema[key];
    if (!key || !field || excludedParamKeys.has(key)) return;

    const error = container.querySelector<HTMLElement>(`[data-workflow-generic-param-error="${CSS.escape(key)}"]`);
    error?.classList.add('hidden');

    if (field.type === 'boolean') {
      task.params[key] = input instanceof HTMLInputElement ? input.checked : false;
      return;
    }

    const rawValue =
      input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement || input instanceof HTMLSelectElement ? input.value.trim() : '';

    if (field.type === 'number') {
      task.params[key] = rawValue === '' ? null : Number(rawValue);
      return;
    }

    if (field.type === 'array' || field.type === 'object') {
      if (rawValue === '') {
        task.params[key] = field.type === 'array' ? [] : {};
        return;
      }
      try {
        const parsed = JSON.parse(rawValue) as unknown;
        if (field.type === 'array' && !Array.isArray(parsed)) throw new Error('Expected array');
        if (field.type === 'object' && (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))) {
          throw new Error('Expected object');
        }
        task.params[key] = parsed;
      } catch {
        hasInvalidValue = true;
        error?.classList.remove('hidden');
      }
      return;
    }

    task.params[key] = rawValue;
  });

  return { hasInvalidValue };
}

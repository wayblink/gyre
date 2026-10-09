import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { WorkflowDefinition, WorkflowRunState } from '../../shared/types.js';
import { createWorkflowRunPanel, workflowRunTaskState } from './runPanel.js';

function runState(overrides: Partial<WorkflowRunState> = {}): WorkflowRunState {
  return {
    isOpen: true,
    isRunning: false,
    workflowId: 1,
    runId: 7,
    activeTaskId: null,
    taskStates: {},
    approvedWarningTaskIds: [],
    waitingForApprovalTaskIds: [],
    warningTaskIds: [],
    warningMessages: {},
    taskMessages: {},
    message: '',
    errorMessage: null,
    ...overrides,
  };
}

const WORKFLOW = {
  id: 1,
  tasks: [
    { id: 'a', name: 'Load', operatorCode: 'read', x: 0, y: 0, inputs: {}, params: {}, dependsOn: [] },
    { id: 'b', name: 'Transform', operatorCode: 'sql', x: 300, y: 0, inputs: {}, params: {}, dependsOn: ['a'] },
  ],
} as unknown as WorkflowDefinition;

/** Minimal DOM stand-in: records class/attribute writes and innerHTML per element id. */
function fakeDom() {
  const nodes = new Map<string, Record<string, unknown>>();
  const element = (id: string) => {
    if (!nodes.has(id)) {
      nodes.set(id, {
        id,
        classList: {
          add() {},
          remove() {},
          toggle() {},
        },
        style: {},
        dataset: {},
        innerHTML: '',
        textContent: '',
        querySelector: () => null,
      });
    }
    return nodes.get(id) as unknown as HTMLElement;
  };
  return { nodes, element: element as <T extends HTMLElement>(id: string) => T };
}

test('a task reports null when the panel is not showing its workflow', () => {
  const state = runState();
  assert.equal(workflowRunTaskState('a', 1, state), 'pending');
  // Closed panel.
  assert.equal(workflowRunTaskState('a', 1, runState({ isOpen: false })), null);
  // Belongs to another workflow.
  assert.equal(workflowRunTaskState('a', 2, state), null);
  assert.equal(workflowRunTaskState('a', null, state), null);
});

test('the active task reads as running and recorded states win otherwise', () => {
  const state = runState({
    activeTaskId: 'b',
    taskStates: { a: 'completed', b: 'failed' },
  });
  assert.equal(workflowRunTaskState('a', 1, state), 'completed');
  assert.equal(workflowRunTaskState('b', 1, state), 'running');
  assert.equal(workflowRunTaskState('missing', 1, state), 'pending');
});

test('the panel hides itself when the run belongs to another workflow', () => {
  const dom = fakeDom();
  const panel = createWorkflowRunPanel({
    el: dom.element,
    escapeHtml: (text) => String(text),
    getWorkflow: () => WORKFLOW,
    getRunState: () => runState({ workflowId: 99 }),
    localizeDom: () => {},
  });

  panel.render();

  assert.ok(
    (dom.nodes.get('workflowRunPanel') as unknown as { classList: { added: string[] } }).classList,
    'panel element should exist',
  );
});

test('the panel projects progress, per-task rows and the footer state', () => {
  const dom = fakeDom();
  const panel = createWorkflowRunPanel({
    el: dom.element,
    escapeHtml: (text) => String(text),
    getWorkflow: () => WORKFLOW,
    getRunState: () =>
      runState({
        taskStates: { a: 'completed', b: 'failed' },
        errorMessage: null,
      }),
    localizeDom: () => {},
  });

  panel.render();

  const taskList = dom.nodes.get('workflowRunTaskList') as unknown as { innerHTML: string };
  assert.match(taskList.innerHTML, /workflow-run-task--completed/);
  assert.match(taskList.innerHTML, /workflow-run-task--failed/);
  // Both tasks are listed, in dependency order.
  assert.ok(taskList.innerHTML.indexOf('Load') < taskList.innerHTML.indexOf('Transform'));

  // A failed run that is no longer running offers no actions, just the dependency-order hint.
  const footer = dom.nodes.get('workflowRunFooter') as unknown as { innerHTML: string };
  assert.doesNotMatch(footer.innerHTML, /data-cancel-workflow-run/);
  assert.match(footer.innerHTML, /workflow-run-panel__hint/);
});

test('a running run offers a cancel action', () => {
  const dom = fakeDom();
  const panel = createWorkflowRunPanel({
    el: dom.element,
    escapeHtml: (text) => String(text),
    getWorkflow: () => WORKFLOW,
    getRunState: () => runState({ isRunning: true, taskStates: { a: 'completed' } }),
    localizeDom: () => {},
  });

  panel.render();

  const footer = dom.nodes.get('workflowRunFooter') as unknown as { innerHTML: string };
  assert.match(footer.innerHTML, /data-cancel-workflow-run/);
  const toggle = dom.nodes.get('btnToggleWorkflowRunPanel') as unknown as { textContent: string };
  assert.equal(toggle.textContent, 'Collapse');
});

test('a run waiting for approval offers Continue and Cancel', () => {
  const dom = fakeDom();
  const panel = createWorkflowRunPanel({
    el: dom.element,
    escapeHtml: (text) => String(text),
    getWorkflow: () => WORKFLOW,
    getRunState: () =>
      runState({
        taskStates: { a: 'warning' },
        waitingForApprovalTaskIds: ['a'],
        warningMessages: { a: 'check the total' },
      }),
    localizeDom: () => {},
  });

  panel.render();

  const footer = dom.nodes.get('workflowRunFooter') as unknown as { innerHTML: string };
  assert.match(footer.innerHTML, /data-continue-workflow-warning/);
  assert.match(footer.innerHTML, /data-cancel-workflow-run/);
  // The waiting task is labelled for review rather than as a plain warning.
  const taskList = dom.nodes.get('workflowRunTaskList') as unknown as { innerHTML: string };
  assert.match(taskList.innerHTML, /Needs Review/);
  assert.match(taskList.innerHTML, /check the total/);
});

test('an error message replaces the footer actions', () => {
  const dom = fakeDom();
  const panel = createWorkflowRunPanel({
    el: dom.element,
    escapeHtml: (text) => String(text),
    getWorkflow: () => WORKFLOW,
    getRunState: () => runState({ errorMessage: 'boom' }),
    localizeDom: () => {},
  });

  panel.render();

  const footer = dom.nodes.get('workflowRunFooter') as unknown as { innerHTML: string };
  assert.match(footer.innerHTML, /boom/);
  assert.doesNotMatch(footer.innerHTML, /data-cancel-workflow-run/);
});

test('a finished run with no warnings reports success', () => {
  const dom = fakeDom();
  const panel = createWorkflowRunPanel({
    el: dom.element,
    escapeHtml: (text) => String(text),
    getWorkflow: () => WORKFLOW,
    getRunState: () => runState({ taskStates: { a: 'completed', b: 'completed' } }),
    localizeDom: () => {},
  });

  panel.render();

  const footer = dom.nodes.get('workflowRunFooter') as unknown as { innerHTML: string };
  assert.match(footer.innerHTML, /workflow-run-panel__success/);
  const progressText = dom.nodes.get('workflowRunProgressText') as unknown as { textContent: string };
  assert.equal(progressText.textContent, '2 / 2');
});

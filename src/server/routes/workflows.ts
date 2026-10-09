import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  normalizeWorkflowRuntimeParameters,
  normalizeWorkflowRuntimeParametersSchema,
  validateRuntimeParameters,
} from '../workflow/runtimeParameters.js';
import { deriveWorkflowRuntimeConfigFromTasks } from '../workflow/runtimeParameterRequirements.js';
import { executeWorkflowTaskPreview } from '../workflow/engine.js';
import { selectWorkflowPreviewTasks } from '../workflow/previewTask.js';
import { resolveWorkflowRunPlan } from '../workflow/startWorkflowRun.js';
import { normalizeWorkflowTask, normalizeWorkflowTasks } from '../workflow/tasks.js';
import { workflowRunToExecutionResult } from '../workflow/runResult.js';
import { badRequest, conflict, notFound, parseIdParam } from './support.js';
import { parseJson } from '../utils/json.js';
import { toIsoTimestamp } from '../utils/timestamp.js';
import { resolveWorkflowRuntimeConfiguration } from '../workflow/runtimeParameters.js';
import type { RouteContext } from './context.js';
import type {
  WorkflowImportExportBundle,
  WorkflowPortableDefinition,
  WorkflowRuntimeParameters,
  WorkflowTask,
} from '../../shared/types.js';

/**
 * Workflow definitions (CRUD, import/export, preview, execute) and the runs they produce
 * (status, approvals, cancel, retry, single-step execution).
 */

const workflowTaskPreviewBodySchema = z.object({
  workflowId: z.number().int().positive(),
  taskId: z.string().trim().min(1),
  tasks: z.array(z.any()).optional(),
  runtimeParamsSchema: z.record(z.string(), z.unknown()).optional(),
  runtimeParamsDefaults: z.record(z.string(), z.unknown()).optional(),
  runtimeParameters: z.record(z.string(), z.unknown()).optional(),
});

const workflowExecuteBodySchema = z.object({
  runtimeParameters: z.record(z.string(), z.unknown()).optional(),
  approvedWarningTaskIds: z.array(z.string().trim().min(1)).optional().default([]),
});

export const workflowApprovalBodySchema = z.object({
  taskIds: z.array(z.string().trim().min(1)).optional(),
  taskId: z.string().trim().min(1).optional(),
  decision: z.enum(['approved', 'skipped']).optional().default('approved'),
});

const workflowRunRetryBodySchema = z.object({
  tasks: z.array(z.any()).optional(),
});

const workflowPortableDefinitionSchema = z.object({
  code: z.string().trim().min(1),
  name: z.string().trim().min(1),
  description: z.string().optional().default(''),
  status: z.enum(['draft', 'active']).optional().default('draft'),
  version: z.number().int().min(1).optional().default(1),
  tasks: z.array(z.any()).optional().default([]),
  runtimeParamsSchema: z.record(z.string(), z.unknown()).optional().default({}),
  runtimeParamsDefaults: z.record(z.string(), z.unknown()).optional().default({}),
});

const workflowImportBundleSchema = z.object({
  format: z.literal('captable-workflow'),
  version: z.literal(1),
  exportedAt: z.string().optional(),
  workflow: workflowPortableDefinitionSchema,
});

function toWorkflowOperator(row: Record<string, unknown>) {
  return {
    id: Number(row.id),
    code: String(row.code),
    name: String(row.name),
    version: String(row.version ?? '1.0.0'),
    category: String(row.category ?? 'General'),
    description: String(row.description ?? ''),
    inputSlots: parseJson(row.input_slots_json, []),
    outputSlots: parseJson(row.output_slots_json, []),
    paramsSchema: parseJson(row.params_schema_json, {}),
    documentation: parseJson(row.documentation_json, undefined),
    createdAt: toIsoTimestamp(row.created_at),
    updatedAt: toIsoTimestamp(row.updated_at),
  };
}

function toWorkflowDefinition(row: Record<string, unknown>) {
  return {
    id: Number(row.id),
    code: String(row.code),
    name: String(row.name),
    description: String(row.description ?? ''),
    status: String(row.status ?? 'draft') as 'draft' | 'active',
    version: Number(row.version ?? 1),
    tasks: normalizeWorkflowTasks(parseJson(row.tasks_json, [])),
    runtimeParamsSchema: normalizeWorkflowRuntimeParametersSchema(parseJson(row.runtime_params_schema_json, {})),
    runtimeParamsDefaults: normalizeWorkflowRuntimeParameters(parseJson(row.runtime_params_defaults_json, {})),
    createdAt: toIsoTimestamp(row.created_at),
    updatedAt: toIsoTimestamp(row.updated_at),
  };
}

function normalizeWorkflowTasksForPersistence(value: unknown, context: string): WorkflowTask[] {
  if (!Array.isArray(value)) return [];
  const normalized = normalizeWorkflowTasks(value);
  if (value.length !== normalized.length) {
    const invalidIndexes = value
      .map((item, index) => (normalizeWorkflowTask(item) ? null : index + 1))
      .filter((index): index is number => index !== null);
    throw badRequest(`${context} contains invalid workflow tasks at index: ${invalidIndexes.join(', ')}`);
  }
  return normalized;
}

function toWorkflowPortableDefinition(workflow: unknown): WorkflowPortableDefinition {
  const source = workflow as Partial<WorkflowPortableDefinition>;
  return {
    code: String(source.code ?? '').trim(),
    name: String(source.name ?? '').trim(),
    description: String(source.description ?? ''),
    status: source.status === 'active' ? 'active' : 'draft',
    version: Number(source.version ?? 1),
    tasks: normalizeWorkflowTasksForPersistence(source.tasks ?? [], 'Imported workflow'),
    runtimeParamsSchema: normalizeWorkflowRuntimeParametersSchema(source.runtimeParamsSchema),
    runtimeParamsDefaults: normalizeWorkflowRuntimeParameters(source.runtimeParamsDefaults),
  };
}

function toWorkflowImportExportBundle(workflow: WorkflowPortableDefinition): WorkflowImportExportBundle {
  return {
    format: 'captable-workflow',
    version: 1,
    exportedAt: new Date().toISOString(),
    workflow,
  };
}

function normalizeWorkflowRuntimeConfig(params: {
  tasks: WorkflowTask[];
  runtimeParamsSchema: unknown;
  runtimeParamsDefaults: unknown;
}): { runtimeParamsSchema: Record<string, unknown>; runtimeParamsDefaults: WorkflowRuntimeParameters } {
  const runtimeParamsSchemaHints = normalizeWorkflowRuntimeParametersSchema(params.runtimeParamsSchema);
  const runtimeParamsDefaultHints = normalizeWorkflowRuntimeParameters(params.runtimeParamsDefaults);
  const runtimeConfig = deriveWorkflowRuntimeConfigFromTasks({
    tasks: params.tasks,
    runtimeParamsSchema: runtimeParamsSchemaHints,
    runtimeParamsDefaults: runtimeParamsDefaultHints,
  });
  const runtimeParamsSchema = normalizeWorkflowRuntimeParametersSchema(runtimeConfig.runtimeParamsSchema);
  const runtimeParamsDefaults = normalizeWorkflowRuntimeParameters(runtimeConfig.runtimeParamsDefaults);
  validateRuntimeParameters(runtimeParamsDefaults, runtimeParamsSchema);
  return {
    runtimeParamsSchema,
    runtimeParamsDefaults,
  };
}

async function ensureUniqueWorkflowCode(db: RouteContext['db'], baseCode: string): Promise<string> {
  const normalizedBase = baseCode.trim() || 'workflow-import';
  let candidate = normalizedBase;
  let suffix = 0;
  while (true) {
    const existing = await db.queryOne<{ id: number }>('select id from workflow_definitions where code = $1', [
      candidate,
    ]);
    if (!existing) return candidate;
    suffix += 1;
    candidate = suffix === 1 ? `${normalizedBase}-imported` : `${normalizedBase}-imported-${suffix}`;
  }
}

export function registerWorkflowRoutes(app: FastifyInstance, ctx: RouteContext) {
  const { db, workflowOperatorRuntime, workflowRunStore, workflowRunExecutor } = ctx;

  app.get('/api/workflow/operators', async () => {
    const rows = await db.query<Record<string, unknown>>(
      'select * from workflow_operators order by category asc, name asc, version asc',
    );
    return { operators: rows.map(toWorkflowOperator) };
  });

  app.get('/api/workflows', async () => {
    const rows = await db.query<Record<string, unknown>>(
      'select * from workflow_definitions order by updated_at desc, id desc',
    );
    return { items: rows.map(toWorkflowDefinition) };
  });

  app.get('/api/workflows/:id/export', async (request) => {
    const workflowId = parseIdParam((request.params as { id: string }).id, 'workflow id');
    const row = await db.queryOne<Record<string, unknown>>('select * from workflow_definitions where id = $1', [
      workflowId,
    ]);
    if (!row) throw notFound('Workflow not found');
    const workflow = toWorkflowDefinition(row);
    return toWorkflowImportExportBundle({
      code: workflow.code,
      name: workflow.name,
      description: workflow.description,
      status: workflow.status,
      version: workflow.version,
      tasks: workflow.tasks,
      runtimeParamsSchema: workflow.runtimeParamsSchema,
      runtimeParamsDefaults: workflow.runtimeParamsDefaults,
    });
  });

  app.post('/api/workflows/import', async (request, reply) => {
    const body = workflowImportBundleSchema.parse(request.body);
    const imported = toWorkflowPortableDefinition(body.workflow);
    const uniqueCode = await ensureUniqueWorkflowCode(db, imported.code);
    const runtimeConfig = normalizeWorkflowRuntimeConfig({
      tasks: imported.tasks,
      runtimeParamsSchema: imported.runtimeParamsSchema,
      runtimeParamsDefaults: imported.runtimeParamsDefaults,
    });

    const row = await db.queryOne<Record<string, unknown>>(
      `insert into workflow_definitions (
         code, name, description, status, version, tasks_json, runtime_params_schema_json, runtime_params_defaults_json
       )
       values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb)
       returning *`,
      [
        uniqueCode,
        imported.name,
        imported.description,
        imported.status,
        imported.version,
        JSON.stringify(imported.tasks),
        JSON.stringify(runtimeConfig.runtimeParamsSchema),
        JSON.stringify(runtimeConfig.runtimeParamsDefaults),
      ],
    );
    if (!row) throw new Error('Failed to import workflow');
    return reply.code(201).send(toWorkflowDefinition(row));
  });

  app.post('/api/workflows', async (request, reply) => {
    const body = z
      .object({
        code: z.string().trim().min(1),
        name: z.string().trim().min(1),
        description: z.string().optional().default(''),
        status: z.enum(['draft', 'active']).optional().default('draft'),
        version: z.number().int().min(1).optional().default(1),
        tasks: z.array(z.record(z.string(), z.unknown())).optional().default([]),
        runtimeParamsSchema: z.record(z.string(), z.unknown()).optional().default({}),
        runtimeParamsDefaults: z.record(z.string(), z.unknown()).optional().default({}),
      })
      .parse(request.body);

    const normalizedTasks = normalizeWorkflowTasksForPersistence(body.tasks, 'Workflow');
    const runtimeConfig = normalizeWorkflowRuntimeConfig({
      tasks: normalizedTasks,
      runtimeParamsSchema: body.runtimeParamsSchema,
      runtimeParamsDefaults: body.runtimeParamsDefaults,
    });

    const row = await db.queryOne<Record<string, unknown>>(
      `insert into workflow_definitions (
         code, name, description, status, version, tasks_json, runtime_params_schema_json, runtime_params_defaults_json
       )
       values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb)
       returning *`,
      [
        body.code,
        body.name,
        body.description,
        body.status,
        body.version,
        JSON.stringify(normalizedTasks),
        JSON.stringify(runtimeConfig.runtimeParamsSchema),
        JSON.stringify(runtimeConfig.runtimeParamsDefaults),
      ],
    );
    if (!row) throw new Error('Failed to create workflow');
    return reply.code(201).send(toWorkflowDefinition(row));
  });

  app.patch('/api/workflows/:id', async (request) => {
    const { id } = request.params as { id: string };
    const workflowId = Number(id);
    const existing = await db.queryOne<Record<string, unknown>>('select * from workflow_definitions where id = $1', [
      workflowId,
    ]);
    if (!existing) throw notFound('Workflow not found');

    const body = z
      .object({
        code: z.string().trim().min(1).optional(),
        name: z.string().trim().min(1).optional(),
        description: z.string().optional(),
        status: z.enum(['draft', 'active']).optional(),
        version: z.number().int().min(1).optional(),
        tasks: z.array(z.record(z.string(), z.unknown())).optional(),
        runtimeParamsSchema: z.record(z.string(), z.unknown()).optional(),
        runtimeParamsDefaults: z.record(z.string(), z.unknown()).optional(),
        expectedUpdatedAt: z.string().trim().min(1).optional(),
      })
      .parse(request.body);

    const normalizedTasks =
      body.tasks === undefined
        ? normalizeWorkflowTasksForPersistence(parseJson(existing.tasks_json, []), 'Stored workflow')
        : normalizeWorkflowTasksForPersistence(body.tasks, 'Workflow');
    const runtimeConfig = normalizeWorkflowRuntimeConfig({
      tasks: normalizedTasks,
      runtimeParamsSchema:
        body.runtimeParamsSchema === undefined
          ? parseJson(existing.runtime_params_schema_json, {})
          : body.runtimeParamsSchema,
      runtimeParamsDefaults:
        body.runtimeParamsDefaults === undefined
          ? parseJson(existing.runtime_params_defaults_json, {})
          : body.runtimeParamsDefaults,
    });

    const row = await db.queryOne<Record<string, unknown>>(
      `update workflow_definitions
       set code = $1,
           name = $2,
           description = $3,
           status = $4,
           version = $5,
           tasks_json = $6::jsonb,
           runtime_params_schema_json = $7::jsonb,
           runtime_params_defaults_json = $8::jsonb,
           updated_at = current_timestamp
       where id = $9
         and ($10::timestamptz is null
           or date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $10::timestamptz))
       returning *`,
      [
        body.code ?? existing.code,
        body.name ?? existing.name,
        body.description ?? existing.description,
        body.status ?? existing.status,
        body.version ?? Number(existing.version ?? 1),
        JSON.stringify(normalizedTasks),
        JSON.stringify(runtimeConfig.runtimeParamsSchema),
        JSON.stringify(runtimeConfig.runtimeParamsDefaults),
        workflowId,
        body.expectedUpdatedAt ?? null,
      ],
    );
    if (!row) {
      throw conflict('工作流已被其他页面或请求更新，请刷新后重新应用本次修改');
    }
    return toWorkflowDefinition(row);
  });

  app.post('/api/workflows/preview-task', async (request) => {
    const body = workflowTaskPreviewBodySchema.parse(request.body);
    const workflowRow = await db.queryOne<Record<string, unknown>>('select * from workflow_definitions where id = $1', [
      body.workflowId,
    ]);
    if (!workflowRow) throw notFound('Workflow not found');

    const sourceTasks = body.tasks
      ? normalizeWorkflowTasks(body.tasks)
      : normalizeWorkflowTasks(parseJson(workflowRow.tasks_json, []));
    const previewTasks = selectWorkflowPreviewTasks(sourceTasks, body.taskId);
    const runtimeConfiguration = resolveWorkflowRuntimeConfiguration({
      tasks: previewTasks,
      runtimeParamsSchema: body.runtimeParamsSchema ?? parseJson(workflowRow.runtime_params_schema_json, {}),
      runtimeParamsDefaults: body.runtimeParamsDefaults ?? parseJson(workflowRow.runtime_params_defaults_json, {}),
      runtimeParameters: body.runtimeParameters,
    });
    const taskMap = new Map(runtimeConfiguration.tasks.map((task) => [task.id, task]));
    const task = taskMap.get(body.taskId);
    if (!task) throw notFound('Workflow task not found');

    return executeWorkflowTaskPreview(task, new Map(), taskMap, workflowOperatorRuntime, {
      runtimeParameters: runtimeConfiguration.runtimeParameters,
      invocationStack: [String(workflowRow.code), `id:${body.workflowId}`],
    });
  });

  app.post('/api/workflows/:id/execute', async (request) => {
    const { id } = request.params as { id: string };
    const workflowId = Number(id);
    const body = workflowExecuteBodySchema.parse(request.body);
    const workflowRow = await db.queryOne<Record<string, unknown>>('select * from workflow_definitions where id = $1', [
      workflowId,
    ]);
    if (!workflowRow) throw notFound('Workflow not found');

    // Approvals are recorded before the run is enqueued, so the resolution stays separate from
    // the shared startWorkflowRun() bootstrap here.
    const runtimeConfiguration = await resolveWorkflowRunPlan({
      db,
      workflow: workflowRow,
      runtimeParameters: body.runtimeParameters,
    });
    const run = await workflowRunStore.createRun({
      workflow: workflowRow,
      tasks: runtimeConfiguration.tasks,
      runtimeParameters: runtimeConfiguration.runtimeParameters,
    });

    if (body.approvedWarningTaskIds.length) {
      for (const taskId of body.approvedWarningTaskIds) {
        await workflowRunStore.approveWarning(run.id, taskId, 'approved');
      }
    }

    workflowRunExecutor.startAsync(run.id);
    return workflowRunToExecutionResult(await workflowRunStore.getRun(run.id));
  });

  app.get('/api/workflow-runs/:id', async (request) => {
    const runId = parseIdParam((request.params as { id: string }).id, 'workflow run id');
    const light = (request.query as { light?: string } | undefined)?.light;
    return workflowRunStore.getRun(runId, { light: light === '1' || light === 'true' });
  });

  app.post('/api/workflow-runs/:id/approvals', async (request) => {
    const runId = parseIdParam((request.params as { id: string }).id, 'workflow run id');
    const body = workflowApprovalBodySchema.parse(request.body ?? {});
    const taskIds = body.taskIds?.length ? body.taskIds : body.taskId ? [body.taskId] : [];
    if (!taskIds.length) {
      throw new Error('At least one approval task id is required');
    }
    const run = await workflowRunExecutor.continueAfterApproval(runId, taskIds, body.decision);
    return workflowRunToExecutionResult(run);
  });

  app.post('/api/workflow-runs/:id/cancel', async (request) => {
    const runId = parseIdParam((request.params as { id: string }).id, 'workflow run id');
    const run = await workflowRunExecutor.cancelRun(runId);
    return workflowRunToExecutionResult(run);
  });

  app.post('/api/workflow-runs/:id/retry-unfinished', async (request) => {
    const runId = parseIdParam((request.params as { id: string }).id, 'workflow run id');
    const body = workflowRunRetryBodySchema.parse(request.body ?? {});
    await workflowRunExecutor.retryUnfinishedAsync(runId, body.tasks ? normalizeWorkflowTasks(body.tasks) : undefined);
    return workflowRunToExecutionResult(await workflowRunStore.getRun(runId));
  });

  app.post('/api/workflow-runs/:id/steps/:taskId/execute', async (request) => {
    const { id, taskId } = request.params as { id: string; taskId: string };
    const runId = Number(id);
    const body = workflowRunRetryBodySchema.parse(request.body ?? {});
    await workflowRunExecutor.startSingleStepAsync(
      runId,
      taskId,
      body.tasks ? normalizeWorkflowTasks(body.tasks) : undefined,
    );
    return workflowRunToExecutionResult(await workflowRunStore.getRun(runId));
  });

  app.delete('/api/workflows/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    await db.execute('delete from workflow_definitions where id = $1', [Number(id)]);
    return reply.code(204).send();
  });
}

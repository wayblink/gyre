import type { AppDb } from '../db.js';
import { applyMonthlyRunPostProcessing } from '../monthlyRun/store.js';
import { dataFrameToWorkbookBuffer, extractSheetRangeAsDataFrame, rowsToDataFrame } from '../excel.js';
import { upsertTableRows } from '../workflow/tableUpsert.js';
import { WorkflowFileSourceRegistry } from '../workflow/fileSources.js';
import { WorkflowRunExecutor } from '../workflow/runExecutor.js';
import { WorkflowRunStore } from '../workflow/runStore.js';
import type { WorkflowOperatorRuntime } from '../workflow/operators/types.js';
import { executeWorkflowDefinition } from '../workflow/engine.js';
import {
  filterWorkflowRuntimeParametersBySchema,
  resolveWorkflowRuntimeConfiguration,
} from '../workflow/runtimeParameters.js';
import { normalizeWorkflowTasks } from '../workflow/tasks.js';
import { fileStorage } from '../storage.js';
import { parseJson } from '../utils/json.js';
import { getProductFileOrThrow, notFound, saveProductWorkbook, toProductFile } from './support.js';

/**
 * Everything the route modules share. Route handlers used to reach for module-level singletons in
 * server.ts; passing one context object keeps the modules independent and makes them testable with
 * a fake db.
 */
export type RouteContext = {
  db: AppDb;
  workflowFileSources: WorkflowFileSourceRegistry;
  workflowOperatorRuntime: WorkflowOperatorRuntime;
  workflowRunStore: WorkflowRunStore;
  workflowRunExecutor: WorkflowRunExecutor;
};

/** Tables a workflow definition is allowed to write to (see operator `db.upsert`). */
export const WORKFLOW_WRITABLE_TABLES: ReadonlySet<string> = new Set(['employees']);

export function createRouteContext(db: AppDb): RouteContext {
  const workflowFileSources = new WorkflowFileSourceRegistry();
  workflowFileSources.register({
    provider: 'product-files',
    async read(ref) {
      const fileKey = String(ref.key ?? '').trim();
      if (fileKey) {
        const file = await db.queryOne<Record<string, unknown>>(
          'select * from product_files where lower(logical_path) = lower($1)',
          [fileKey],
        );
        if (!file) throw notFound(`Product file not found: ${fileKey}`);
        return fileStorage.read(String(file.file_path));
      }
      const fileId = Number(ref.id);
      if (!Number.isInteger(fileId) || fileId <= 0) throw new Error('product-files source requires a positive id');
      const file = await getProductFileOrThrow(db, fileId);
      return fileStorage.read(String(file.file_path));
    },
  });

  const workflowOperatorRuntime: WorkflowOperatorRuntime = {
    extractSheetRangeAsDataFrame,
    rowsToDataFrame,
    dataFrameToWorkbookBuffer,
    readFile: (ref) => workflowFileSources.read(ref),
    async getProductFileBufferById(fileId) {
      const file = await getProductFileOrThrow(db, fileId);
      return fileStorage.read(String(file.file_path));
    },
    async saveGeneratedWorkbook(params) {
      const saved = await saveProductWorkbook(db, params);
      return toProductFile(saved.file);
    },
    upsertTableRows(params) {
      return upsertTableRows(db, params, WORKFLOW_WRITABLE_TABLES);
    },
    async invokeWorkflow(params) {
      const requestedKey = params.workflowId ? `id:${params.workflowId}` : String(params.workflowCode ?? '').trim();
      if (!requestedKey) {
        throw new Error('workflow.invoke requires workflowCode or workflowId');
      }
      if (params.invocationStack.includes(requestedKey)) {
        throw new Error(
          `workflow.invoke recursive workflow call detected: ${[...params.invocationStack, requestedKey].join(' -> ')}`,
        );
      }

      const workflowRow = params.workflowId
        ? await db.queryOne<Record<string, unknown>>('select * from workflow_definitions where id = $1', [
            params.workflowId,
          ])
        : await db.queryOne<Record<string, unknown>>(
            'select * from workflow_definitions where code = $1 and status = $2',
            [params.workflowCode, 'active'],
          );
      if (!workflowRow) {
        throw new Error(`workflow.invoke target workflow not found: ${params.workflowId ?? params.workflowCode}`);
      }

      const workflowId = Number(workflowRow.id);
      const workflowCode = String(workflowRow.code ?? '').trim();
      const workflowKeys = [requestedKey, workflowCode, `id:${workflowId}`].filter(Boolean);
      if (workflowKeys.some((key) => params.invocationStack.includes(key))) {
        throw new Error(
          `workflow.invoke recursive workflow call detected: ${[...params.invocationStack, workflowCode || `id:${workflowId}`].join(' -> ')}`,
        );
      }

      const storedTasks = normalizeWorkflowTasks(parseJson(workflowRow.tasks_json, []));
      const childRuntimeParamsSchema = parseJson(workflowRow.runtime_params_schema_json, {});
      const runtimeConfiguration = resolveWorkflowRuntimeConfiguration({
        tasks: storedTasks,
        runtimeParamsSchema: childRuntimeParamsSchema,
        runtimeParamsDefaults: parseJson(workflowRow.runtime_params_defaults_json, {}),
        runtimeParameters: filterWorkflowRuntimeParametersBySchema(params.runtimeParameters, childRuntimeParamsSchema),
      });
      const childResult = await executeWorkflowDefinition(runtimeConfiguration.tasks, workflowOperatorRuntime, {
        runtimeParameters: runtimeConfiguration.runtimeParameters,
        initialDataFrames: params.inputDataFrames,
        invocationStack: Array.from(new Set([...params.invocationStack, ...workflowKeys])),
      });

      if (childResult.errorMessage) {
        throw new Error(childResult.errorMessage);
      }

      if (params.outputTaskId) {
        const selected = childResult.taskResults[params.outputTaskId];
        if (!selected?.dataFrame) {
          throw new Error(`workflow.invoke output task not found or did not produce dataframe: ${params.outputTaskId}`);
        }
        return selected;
      }

      if (!childResult.result?.dataFrame) {
        throw new Error(
          `workflow.invoke target workflow did not produce dataframe output: ${workflowCode || workflowId}`,
        );
      }
      return childResult.result;
    },
  };

  const workflowRunStore = new WorkflowRunStore(db);
  const workflowRunExecutor = new WorkflowRunExecutor(workflowRunStore, workflowOperatorRuntime, undefined, {
    onRunFinalized: (run) => applyMonthlyRunPostProcessing(db, run),
  });

  return { db, workflowFileSources, workflowOperatorRuntime, workflowRunStore, workflowRunExecutor };
}

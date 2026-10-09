import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { FIVE_PERCENT_HOLDER_GLOBAL_PARAMETER_KEYS } from '../dataManagementWorkflow/workflowDefinitions.js';
import { parseFivePercentHoldersGrid } from '../fivePercentHolders/persistence.js';
import { toFixedValue } from '../esopPages.js';
import { toIsoTimestamp } from '../utils/timestamp.js';
import { isUniqueConstraintViolation, notFound, parseIdParam, updatedByFromRequest } from './support.js';
import { requireAdminUser } from './auth.js';
import type { RequestWithAuth } from './support.js';
import type { RouteContext } from './context.js';

/**
 * Global parameters and fixed values: the reconciliation baselines the workflows assert against,
 * plus the four 5% Holders fixed values read from the global parameter table.
 *
 * The 5% Holders helpers are exported because the 5% Holders data page (/api/five-percent-holders)
 * resolves the same values before it starts a run.
 */

export const fivePercentHolderGlobalParameterOrder = [
  FIVE_PERCENT_HOLDER_GLOBAL_PARAMETER_KEYS.gniCommonStock,
  FIVE_PERCENT_HOLDER_GLOBAL_PARAMETER_KEYS.gniTotalCses,
  FIVE_PERCENT_HOLDER_GLOBAL_PARAMETER_KEYS.songjiangMaCommonStock,
  FIVE_PERCENT_HOLDER_GLOBAL_PARAMETER_KEYS.songjiangMaTotalCses,
] as const;

const fixedValuePatchSchema = z.object({
  value: z.number(),
});

const globalParameterKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(
    /^[A-Za-z][A-Za-z0-9_.-]*$/,
    'Key must start with a letter and contain only letters, numbers, dots, dashes, or underscores',
  );

const globalParameterCreateSchema = z.object({
  key: globalParameterKeySchema,
  label: z.string().trim().min(1).max(200),
  value: z.number().finite(),
});

const globalParameterPatchSchema = fixedValuePatchSchema.extend({
  label: z.string().trim().min(1).max(200).optional(),
});

const fixedValueUpsertSchema = fixedValuePatchSchema.extend({
  key: z.enum([
    FIVE_PERCENT_HOLDER_GLOBAL_PARAMETER_KEYS.gniCommonStock,
    FIVE_PERCENT_HOLDER_GLOBAL_PARAMETER_KEYS.gniTotalCses,
    FIVE_PERCENT_HOLDER_GLOBAL_PARAMETER_KEYS.songjiangMaCommonStock,
    FIVE_PERCENT_HOLDER_GLOBAL_PARAMETER_KEYS.songjiangMaTotalCses,
  ]),
  label: z.string().trim().min(1).max(200).optional(),
});

const fixedValueLabels: Record<string, string> = {
  [FIVE_PERCENT_HOLDER_GLOBAL_PARAMETER_KEYS.gniCommonStock]: '5% Holders - GNI Group Ltd. Common Stock',
  [FIVE_PERCENT_HOLDER_GLOBAL_PARAMETER_KEYS.gniTotalCses]: '5% Holders - GNI Group Ltd. Total CSEs',
  [FIVE_PERCENT_HOLDER_GLOBAL_PARAMETER_KEYS.songjiangMaCommonStock]: '5% Holders - Songjiang Ma Common Stock',
  [FIVE_PERCENT_HOLDER_GLOBAL_PARAMETER_KEYS.songjiangMaTotalCses]: '5% Holders - Songjiang Ma Total CSEs',
};

const fixedValuePageKeyOrder = [
  'cullgen_common_stock',
  'gyre_2023_china_subplan_total',
  'warrants_convertible_preferred',
  'options_outstanding_cullgen',
  'options_available_cullgen',
] as const;

export const fivePercentHolderGlobalParameterKeys = Object.values(FIVE_PERCENT_HOLDER_GLOBAL_PARAMETER_KEYS);
const fivePercentHolderGlobalParameterKeySet = new Set<string>(fivePercentHolderGlobalParameterKeys);

export async function loadLatestFixedValuesByKey(
  db: RouteContext['db'],
  keys: readonly string[],
): Promise<Map<string, Record<string, unknown>>> {
  const rows = await db.query<Record<string, unknown>>(
    `select distinct on (key) *
      from global_parameters
     where key = any($1)
      order by key, updated_at desc, id desc`,
    [[...keys]],
  );
  return new Map(rows.filter((row) => String(row.updated_by ?? '') !== 'system').map((row) => [String(row.key), row]));
}

export function applyFivePercentHolderGlobalParameters(
  workbook: ReturnType<typeof parseFivePercentHoldersGrid>,
  fixedValues: Map<string, Record<string, unknown>>,
): ReturnType<typeof parseFivePercentHoldersGrid>['holders'] {
  let holderIndex = 0;
  return workbook.holders.map((row) => {
    if (row.rowType !== 'holder') return row;
    const commonStockKey =
      holderIndex === 0
        ? FIVE_PERCENT_HOLDER_GLOBAL_PARAMETER_KEYS.gniCommonStock
        : holderIndex === 1
          ? FIVE_PERCENT_HOLDER_GLOBAL_PARAMETER_KEYS.songjiangMaCommonStock
          : null;
    const totalCsesKey =
      holderIndex === 0
        ? FIVE_PERCENT_HOLDER_GLOBAL_PARAMETER_KEYS.gniTotalCses
        : holderIndex === 1
          ? FIVE_PERCENT_HOLDER_GLOBAL_PARAMETER_KEYS.songjiangMaTotalCses
          : null;
    holderIndex += 1;
    if (!commonStockKey || !totalCsesKey) return row;
    const commonStock = Number(fixedValues.get(commonStockKey)?.value);
    const totalCses = Number(fixedValues.get(totalCsesKey)?.value);
    return {
      ...row,
      commonStock: Number.isFinite(commonStock) ? commonStock : null,
      totalCses: Number.isFinite(totalCses) ? totalCses : null,
    };
  });
}

export function hasCompleteFivePercentHolderGlobalParameters(
  fixedValues: Map<string, Record<string, unknown>>,
): boolean {
  return fivePercentHolderGlobalParameterOrder.every((key) => Number.isFinite(Number(fixedValues.get(key)?.value)));
}

export function emptyFivePercentHolderRows(fixedValues: Map<string, Record<string, unknown>>) {
  const valueFor = (key: string): number | null => {
    const value = Number(fixedValues.get(key)?.value);
    return Number.isFinite(value) ? value : null;
  };
  return [
    {
      id: 1,
      rowType: 'holder' as const,
      name: 'GNI Group Ltd. **',
      commonStock: valueFor(FIVE_PERCENT_HOLDER_GLOBAL_PARAMETER_KEYS.gniCommonStock),
      totalCses: valueFor(FIVE_PERCENT_HOLDER_GLOBAL_PARAMETER_KEYS.gniTotalCses),
      pctOfClass: null,
      pctFullyDiluted: null,
      sc13Filing: null,
      note: null,
    },
    {
      id: 2,
      rowType: 'holder' as const,
      name: 'Songjiang Ma',
      commonStock: valueFor(FIVE_PERCENT_HOLDER_GLOBAL_PARAMETER_KEYS.songjiangMaCommonStock),
      totalCses: valueFor(FIVE_PERCENT_HOLDER_GLOBAL_PARAMETER_KEYS.songjiangMaTotalCses),
      pctOfClass: null,
      pctFullyDiluted: null,
      sc13Filing: null,
      note: null,
    },
  ];
}

const userIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export function registerParameterRoutes(app: FastifyInstance, ctx: RouteContext) {
  const { db } = ctx;

  app.get('/api/fixed-values', async () => {
    const rows = await db.query<Record<string, unknown>>(
      `select distinct on (key) *
         from global_parameters
        where key = any($1::text[])
        order by key, updated_at desc, id desc`,
      [[...fixedValuePageKeyOrder]],
    );
    const order: Record<string, number> = Object.fromEntries(fixedValuePageKeyOrder.map((key, index) => [key, index]));
    const items = rows
      .map((row) => toFixedValue(row as Parameters<typeof toFixedValue>[0]))
      .sort((left, right) => {
        const leftRank = order[left.key] ?? 2147483647;
        const rightRank = order[right.key] ?? 2147483647;
        if (leftRank !== rightRank) return leftRank - rightRank;
        const updatedDiff = Date.parse(toIsoTimestamp(right.updatedAt)) - Date.parse(toIsoTimestamp(left.updatedAt));
        if (updatedDiff !== 0) return updatedDiff;
        return left.key.localeCompare(right.key);
      });
    return { items };
  });

  app.get('/api/five-percent-holders/fixed-values', async () => {
    const rows = await db.query<Record<string, unknown>>(
      `select distinct on (key) *
         from global_parameters
        where key = any($1::text[])
        order by key, updated_at desc, id desc`,
      [[...fivePercentHolderGlobalParameterOrder]],
    );
    const order: Record<string, number> = Object.fromEntries(
      fivePercentHolderGlobalParameterOrder.map((key, index) => [key, index]),
    );
    const items = rows
      .map((row) => toFixedValue(row as Parameters<typeof toFixedValue>[0]))
      .sort((left, right) => {
        const leftRank = order[left.key] ?? 2147483647;
        const rightRank = order[right.key] ?? 2147483647;
        if (leftRank !== rightRank) return leftRank - rightRank;
        const updatedDiff = Date.parse(toIsoTimestamp(right.updatedAt)) - Date.parse(toIsoTimestamp(left.updatedAt));
        if (updatedDiff !== 0) return updatedDiff;
        return left.key.localeCompare(right.key);
      });
    return { items };
  });

  app.get('/api/global-parameters', async () => {
    const rows = await db.query<Record<string, unknown>>(
      `select distinct on (key) *
         from global_parameters
        where key <> all($1::text[])
        order by key, updated_at desc, id desc`,
      [fivePercentHolderGlobalParameterKeys],
    );
    const order: Record<string, number> = Object.fromEntries(fixedValuePageKeyOrder.map((key, index) => [key, index]));
    const items = rows
      .map((row) => toFixedValue(row as Parameters<typeof toFixedValue>[0]))
      .sort(
        (left, right) =>
          (order[left.key] ?? 2147483647) - (order[right.key] ?? 2147483647) || left.key.localeCompare(right.key),
      );
    return { items };
  });

  app.post('/api/global-parameters', async (request, reply) => {
    if (!requireAdminUser(request as typeof request & RequestWithAuth, reply)) return;
    const body = globalParameterCreateSchema.parse(request.body ?? {});
    if (fivePercentHolderGlobalParameterKeySet.has(body.key)) {
      return reply.code(400).send({ error: '5% Holder parameters must be maintained from the 5% Holders page' });
    }
    try {
      const row = await db.queryOne<Record<string, unknown>>(
        `with stamp as (select clock_timestamp() as value)
         insert into global_parameters (key, label, value, effective_from, editable, updated_by, updated_at)
         select $1, $2, $3, stamp.value::text, true, $4, stamp.value
           from stamp
         returning *`,
        [body.key, body.label, body.value, updatedByFromRequest(request as typeof request & RequestWithAuth)],
      );
      return reply.code(201).send(toFixedValue(row as Parameters<typeof toFixedValue>[0]));
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        return reply.code(409).send({ error: '相同 Key 的参数创建时间冲突，请重试' });
      }
      throw error;
    }
  });

  app.patch('/api/global-parameters/:id', async (request, reply) => {
    if (!requireAdminUser(request as typeof request & RequestWithAuth, reply)) return;
    const { id } = userIdParamSchema.parse(request.params);
    const body = globalParameterPatchSchema.parse(request.body ?? {});
    const row = await db.queryOne<Record<string, unknown>>(
      `update global_parameters
          set label = coalesce($1, label),
              value = $2,
              updated_by = $3,
              updated_at = current_timestamp
        where id = $4
          and editable = true
          and key <> all($5::text[])
          returning *`,
      [
        body.label ?? null,
        body.value,
        updatedByFromRequest(request as typeof request & RequestWithAuth),
        id,
        fivePercentHolderGlobalParameterKeys,
      ],
    );
    if (!row) throw notFound('Global Parameter not found or not editable');
    return toFixedValue(row as Parameters<typeof toFixedValue>[0]);
  });

  app.delete('/api/global-parameters/:id', async (request, reply) => {
    if (!requireAdminUser(request as typeof request & RequestWithAuth, reply)) return;
    const { id } = userIdParamSchema.parse(request.params);
    const row = await db.queryOne<{ id: number }>(
      `delete from global_parameters
        where id = $1
          and editable = true
          and key <> all($2::text[])
        returning id`,
      [id, fivePercentHolderGlobalParameterKeys],
    );
    if (!row) throw notFound('Global Parameter not found');
    return reply.code(204).send();
  });

  app.post('/api/fixed-values', async (request) => {
    const body = fixedValueUpsertSchema.parse(request.body);
    const row = await db.queryOne<Record<string, unknown>>(
      `with stamp as (select clock_timestamp() as value)
       insert into global_parameters (key, label, value, effective_from, editable, updated_by, updated_at)
       select $1, $2, $3, stamp.value::text, true, $4, stamp.value
         from stamp
       returning *`,
      [
        body.key,
        body.label ?? fixedValueLabels[body.key] ?? body.key,
        body.value,
        updatedByFromRequest(request as typeof request & RequestWithAuth),
      ],
    );
    return toFixedValue(row as Parameters<typeof toFixedValue>[0]);
  });

  app.patch('/api/fixed-values/:id', async (request) => {
    const { id } = request.params as { id: string };
    const body = fixedValuePatchSchema.parse(request.body);
    const row = await db.queryOne<Record<string, unknown>>(
      `update global_parameters
       set value = $1,
           updated_by = $2,
           updated_at = current_timestamp
       where id = $3 and editable = true
       returning *`,
      [body.value, updatedByFromRequest(request as typeof request & RequestWithAuth), Number(id)],
    );
    if (!row) throw notFound('Fixed value not found or not editable');
    return toFixedValue(row as Parameters<typeof toFixedValue>[0]);
  });
}

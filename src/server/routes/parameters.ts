import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { FIVE_PERCENT_HOLDER_GLOBAL_PARAMETER_KEYS } from '../dataManagementWorkflow/workflowDefinitions.js';
import { parseFivePercentHoldersGrid } from '../fivePercentHolders/persistence.js';
import { toFixedValue } from '../esopPages.js';
import { toIsoTimestamp } from '../utils/timestamp.js';
import { isUniqueConstraintViolation, notFound, updatedByFromRequest } from './support.js';
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

/**
 * 5% Holders baselines are share counts. 0 is how that field looks when nobody filled it in, and the run
 * would publish "Common Stock 0 / 0% of class" instead of asking for the number — so only a positive value
 * is accepted here. (`/api/fixed-values` only ever writes the four 5% Holder keys.)
 */
const fixedValuePatchSchema = z.object({
  value: z.number().finite().positive('5% Holders 固定值必须大于 0'),
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

/**
 * The five monthly Cap Table constants. They are stored per month on `monthly_run_instances` and edited
 * from the Monthly Update page; the `global_parameters` rows that share their names are read by nothing
 * (see `monthlyRunInstanceToRuntimeParameters`). Keep them out of the Global Parameter page so an admin
 * cannot "fix" a monthly run by editing a row the run never reads.
 */
export const monthlyFixedValueGlobalParameterKeys = fixedValuePageKeyOrder;

/**
 * Retired parameters kept in the table for history only. `series_b_preferred_stock` stopped being a
 * fixed value when the Read SERIES B child workflow took over (`Shares Issued` 合计 × 5), so nothing
 * reads it any more — editing it used to look like it changed the monthly summary.
 */
export const retiredGlobalParameterKeys = ['series_b_preferred_stock'] as const;

/** Everything the Global Parameter page must not offer to edit: dead rows, not configuration. */
export const unmanagedGlobalParameterKeys = [
  ...monthlyFixedValueGlobalParameterKeys,
  ...retiredGlobalParameterKeys,
] as readonly string[];

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

/**
 * A 5% holder baseline must be a positive share count: 0 (or a negative) is a value nobody filled in, and
 * the 5% Holders run would happily publish "Common Stock 0 / 0% of class" instead of asking for the number.
 */
export function isUsableFivePercentHolderValue(value: unknown): boolean {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}

export function hasCompleteFivePercentHolderGlobalParameters(
  fixedValues: Map<string, Record<string, unknown>>,
): boolean {
  return fivePercentHolderGlobalParameterOrder.every((key) =>
    isUsableFivePercentHolderValue(fixedValues.get(key)?.value),
  );
}

export function emptyFivePercentHolderRows(fixedValues: Map<string, Record<string, unknown>>) {
  const valueFor = (key: string): number | null => {
    const value = Number(fixedValues.get(key)?.value);
    return isUsableFivePercentHolderValue(value) ? value : null;
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
          and key <> all($2::text[])
        order by key, updated_at desc, id desc`,
      [fivePercentHolderGlobalParameterKeys, [...unmanagedGlobalParameterKeys]],
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
    if (unmanagedGlobalParameterKeys.includes(body.key)) {
      const retired = (retiredGlobalParameterKeys as readonly string[]).includes(body.key);
      return reply.code(400).send({
        error: retired
          ? 'This parameter is retired: Series B Preferred Stock is computed by the Read SERIES B workflow (Shares Issued × 5), so a fixed value here would not be read'
          : 'Monthly Cap Table constants are maintained per month on the Monthly Update page; this table is not read by the monthly workflow',
      });
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
          and key <> all($6::text[])
          returning *`,
      [
        body.label ?? null,
        body.value,
        updatedByFromRequest(request as typeof request & RequestWithAuth),
        id,
        fivePercentHolderGlobalParameterKeys,
        [...unmanagedGlobalParameterKeys],
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
          and key <> all($3::text[])
        returning id`,
      [id, fivePercentHolderGlobalParameterKeys, [...unmanagedGlobalParameterKeys]],
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

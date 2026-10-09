import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { normalizeEmployeeSourceFilter, normalizeExternalNumber } from '../employees.js';
import {
  conflict,
  normalizeEmployeeLabelColor,
  notFound,
  parseTags,
} from './support.js';
import { badRequest, latestWorkflowInputSourceBindings } from './support.js';
import { parseJson } from '../utils/json.js';
import type { EmployeeLabelRef } from './support.js';
import type { RouteContext } from './context.js';

const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(200).optional().default(20),
});

/**
 * Employee registry (merge/unlink linked identities, labels) and the employee label catalog.
 *
 * The employee list page reads /api/employees; labels are managed here and attached to grants by the
 * data pages through the label maps in support.ts.
 */

export function normalizeEmployeeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function employeeLabelIds(labels: EmployeeLabelRef[]): number[] {
  return labels.map((label) => label.id);
}

export function employeeLabelNames(labels: EmployeeLabelRef[]): string[] {
  return labels.map((label) => label.name);
}

async function listEmployeeLabels(db: RouteContext['db']) {
  const rows = await db.query<Record<string, unknown>>(
    `select l.id, l.name, l.color, l.created_at, l.updated_at, count(ela.employee_id)::int as employee_count
       from employee_label l
       left join employee_label_assignment ela on ela.label_id = l.id
      group by l.id
      order by lower(l.name), l.id`,
  );
  return rows.map((row) => ({
    id: Number(row.id),
    name: String(row.name ?? ''),
    color: normalizeEmployeeLabelColor(row.color),
    employeeCount: Number(row.employee_count ?? 0),
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
  }));
}

async function fetchEmployeeById(db: RouteContext['db'], employeeId: number) {
  const row = await db.queryOne<Record<string, unknown>>(
    `select ${employeeSelectColumns}
     from employees e
     left join equity_grants g on g.employee_id = e.id
     where e.id = $1
     group by e.id`,
    [employeeId],
  );
  return row ? toEmployee(row) : null;
}

function normalizeEmployeeLabelIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))];
}

async function assertEmployeeLabelsExist(db: RouteContext['db'], labelIds: number[]) {
  if (labelIds.length === 0) return;
  const rows = await db.query<{ id: number }>('select id from employee_label where id = any($1::int[])', [labelIds]);
  const existing = new Set(rows.map((row) => Number(row.id)));
  const missing = labelIds.filter((id) => !existing.has(id));
  if (missing.length) throw badRequest(`Employee label not found: ${missing.join(', ')}`);
}

async function replaceEmployeeLabels(db: RouteContext['db'], employeeId: number, labelIds: number[]) {
  await assertEmployeeLabelsExist(db, labelIds);
  await db.transaction(async (tx) => {
    await tx.execute('delete from employee_label_assignment where employee_id = $1', [employeeId]);
    for (const labelId of labelIds) {
      await tx.execute(
        'insert into employee_label_assignment (employee_id, label_id) values ($1, $2) on conflict do nothing',
        [employeeId, labelId],
      );
    }
  });
}

const employeeSelectColumns = `
    e.id,
    e.employee_name,
    e.user_id,
    e.source,
    e.employee_id,
    e.has_file_evidence,
    e.is_active,
    count(g.id)::int as grant_count,
    coalesce((
      select array_agg(distinct l.id)
      from employee_label_assignment ela
      join employee_label l on l.id = ela.label_id
      where ela.employee_id in (select m.id from employees m where m.id = e.id or m.merged_into_id = e.id)
    ), '{}') as label_ids,
    coalesce((
      select array_agg(distinct l.name order by l.name)
      from employee_label_assignment ela
      join employee_label l on l.id = ela.label_id
      where ela.employee_id in (select m.id from employees m where m.id = e.id or m.merged_into_id = e.id)
    ), '{}') as tags,
    coalesce((
      select json_agg(json_build_object('id', dl.id, 'name', dl.name, 'color', dl.color) order by dl.name)
      from (
        select distinct l.id, l.name, l.color
        from employee_label_assignment ela
        join employee_label l on l.id = ela.label_id
        where ela.employee_id in (select m.id from employees m where m.id = e.id or m.merged_into_id = e.id)
      ) dl
    ), '[]'::json) as labels,
    coalesce((
      select json_agg(json_build_object(
        'id', t.id, 'employeeId', t.employee_id, 'source', t.source, 'name', t.employee_name
      ) order by t.id)
      from employees t where t.merged_into_id = e.id
    ), '[]'::json) as linked_identities`;

export function toEmployee(row: Record<string, unknown>) {
  const linkedRaw = row.linked_identities;
  const linkedIdentities = Array.isArray(linkedRaw)
    ? linkedRaw.map((identity) => ({
        id: Number((identity as Record<string, unknown>).id),
        employeeId: String((identity as Record<string, unknown>).employeeId ?? ''),
        source: String((identity as Record<string, unknown>).source ?? ''),
        name: String((identity as Record<string, unknown>).name ?? ''),
      }))
    : [];
  const source = String(row.source ?? 'futu');
  const labelsRaw = parseJson<Array<Record<string, unknown>>>(row.labels, []);
  const labels = labelsRaw
    .map((label) => ({
      id: Number(label.id),
      name: String(label.name ?? '').trim(),
      color: normalizeEmployeeLabelColor(label.color),
    }))
    .filter((label) => Number.isInteger(label.id) && label.id > 0 && label.name !== '');
  return {
    id: Number(row.id),
    employeeNumber: String(row.employee_id ?? ''),
    employeeName: String(row.employee_name ?? ''),
    userId: row.user_id ? String(row.user_id) : null,
    labelIds: Array.isArray(row.label_ids) ? row.label_ids.map((id) => Number(id)).filter((id) => Number.isInteger(id)) : [],
    labels,
    tags: parseTags(row.tags),
    grantCount: Number(row.grant_count ?? 0),
    source: (source === 'shareworks' ? 'shareworks' : source === 'manual' ? 'manual' : 'futu') as
      | 'futu'
      | 'shareworks'
      | 'manual',
    hasFileEvidence: row.has_file_evidence === true || row.has_file_evidence === 'true',
    active: row.is_active === undefined ? true : row.is_active === true || row.is_active === 'true',
    linkedIdentities,
  };
}

export async function employeeNumberByName(db: RouteContext['db']): Promise<Map<string, string>> {
  const rows = await db.query<{ employee_id: string; employee_name: string }>(
    `select employee_id, employee_name
       from employees
      where btrim(coalesce(employee_id, '')) <> ''
        and btrim(coalesce(employee_name, '')) <> ''`,
  );
  const byName = new Map<string, string>();
  for (const row of rows) {
    const key = normalizeEmployeeName(String(row.employee_name ?? ''));
    if (!key || byName.has(key)) continue;
    byName.set(key, String(row.employee_id ?? ''));
  }
  return byName;
}

  

export function registerEmployeeRoutes(app: FastifyInstance, ctx: RouteContext) {
  const { db } = ctx;

app.get('/api/employee-labels', async () => ({ items: await listEmployeeLabels(db) }));


  app.post('/api/employee-labels', async (request, reply) => {
    const body = z.object({
      name: z.string().trim().min(1),
      color: z.string().optional(),
    }).parse(request.body ?? {});
    const color = body.color === undefined ? null : normalizeEmployeeLabelColor(body.color);
    const row = await db.queryOne<{ id: number }>(
      `insert into employee_label (name, color) values ($1, $2)
       on conflict (name) do update set updated_at = employee_label.updated_at
       returning id`,
      [body.name, color],
    );
    if (!row) throw new Error('Failed to create employee label');
    const items = await listEmployeeLabels(db);
    return reply.code(201).send({ items, item: items.find((label) => label.id === Number(row.id)) });
  });

  app.patch('/api/employee-labels/:id', async (request) => {
    const labelId = Number((request.params as { id: string }).id);
    const body = z.object({
      name: z.string().trim().min(1).optional(),
      color: z.string().optional(),
    }).parse(request.body ?? {});
    if (body.name === undefined && body.color === undefined) throw badRequest('Employee label update is empty');
    const color = body.color === undefined ? null : normalizeEmployeeLabelColor(body.color);
    if (body.name !== undefined) {
      const duplicate = await db.queryOne<{ id: number }>(
        'select id from employee_label where name = $1 and id <> $2 limit 1',
        [body.name, labelId],
      );
      if (duplicate) throw badRequest('Employee label name already exists');
    }
    const row = await db.queryOne<{ id: number }>(
      `update employee_label
          set name = coalesce($1, name),
              color = coalesce($2, color),
              updated_at = current_timestamp
        where id = $3
        returning id`,
      [body.name ?? null, color, labelId],
    );
    if (!row) throw notFound('Employee label not found');
    return { items: await listEmployeeLabels(db) };
  });

  app.delete('/api/employee-labels/:id', async (request, reply) => {
    const labelId = Number((request.params as { id: string }).id);
    await db.execute('delete from employee_label where id = $1', [labelId]);
    return reply.code(204).send();
  });

  app.get('/api/employees', async (request) => {
    const { page, pageSize } = paginationQuerySchema.parse(request.query ?? {});
    const { query = '', tag = '', source = '', sort = '', dir = '' } = request.query as {
      query?: string;
      tag?: string;
      source?: string;
      sort?: string;
      dir?: string;
    };
    const normalizedQuery = query.trim().toLowerCase();
    const normalizedLabelId = Number(tag);
    const labelIdFilter = Number.isInteger(normalizedLabelId) && normalizedLabelId > 0 ? normalizedLabelId : 0;
    const normalizedSource = normalizeEmployeeSourceFilter(source);
    const like = `%${normalizedQuery}%`;
    const offset = (page - 1) * pageSize;
    const sortColumn = sort === 'name' ? 'e.employee_name' : sort === 'empNo' ? 'e.employee_id' : 'e.id';
    const sortDir = dir === 'desc' ? 'desc' : 'asc';
    const matchClause = `
      e.merged_into_id is null
      and ($1::int = 0 or exists (
        select 1 from employee_label_assignment ela
        where ela.employee_id = e.id and ela.label_id = $1::int
      ))
      and (
        $2 = ''
        or lower(
          coalesce(e.employee_name, '') || ' ' ||
          coalesce(e.employee_id, '') || ' ' ||
          coalesce(e.user_id, '') || ' ' ||
          coalesce((
            select string_agg(l.name, ' ')
            from employee_label_assignment ela
            join employee_label l on l.id = ela.label_id
            where ela.employee_id = e.id
          ), '')
        ) like $3
      )
      and ($4 = '' or e.source = $4)`;
    const totalRow = await db.queryOne<{ count: number }>(
      `select count(*)::int as count from employees e where ${matchClause}`,
      [labelIdFilter, normalizedQuery, like, normalizedSource],
    );
    const rows = await db.query<Record<string, unknown>>(
      `select ${employeeSelectColumns}
       from employees e
       left join equity_grants g on g.employee_id = e.id
       where ${matchClause}
       group by e.id
       order by ${sortColumn} ${sortDir}, e.id ${sortDir}
       limit $5 offset $6`,
      [labelIdFilter, normalizedQuery, like, normalizedSource, pageSize, offset],
    );
    const inputSourceBindings = await latestWorkflowInputSourceBindings(db, 'employee-import');
    const sourceFiles = inputSourceBindings.map((binding) => binding.fileName).filter(Boolean) as string[];
    return {
      items: rows.map(toEmployee),
      sourceFiles,
      workflowSourceBindings: inputSourceBindings,
      resultFileName: null,
      resultFiles: [],
      total: Number(totalRow?.count ?? 0),
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(Number(totalRow?.count ?? 0) / pageSize)),
    };
  });

  app.post('/api/employees', async (request, reply) => {
    const body = z
      .object({
        employeeId: z.string().trim().min(1),
        employeeName: z.string().trim().min(1),
        userId: z.string().trim().optional().or(z.literal('')),
        labelIds: z.array(z.number().int().positive()).optional().default([]),
      })
      .parse(request.body);
    // Manual employees must carry an employee_id (工号) — it is the business key, not
    // system-generated. A duplicate employee_id is a conflict (409); the operator should
    // find the existing row instead.
    const employeeId = normalizeExternalNumber(body.employeeId);
    const existing = await db.queryOne<{ id: number }>('select id from employees where employee_id = $1', [employeeId]);
    if (existing) {
      const owner = await fetchEmployeeById(db, Number(existing.id));
      return reply.code(409).send({ error: '该工号已存在', employee: owner });
    }
    const row = await db.queryOne<{ id: number }>(
      `insert into employees (employee_id, source, employee_name, user_id, has_file_evidence)
       values ($1, 'manual', $2, $3, false)
       returning id`,
      [employeeId, body.employeeName, body.userId || null],
    );
    if (!row) throw new Error('Failed to create employee');
    await replaceEmployeeLabels(db, Number(row.id), normalizeEmployeeLabelIds(body.labelIds));
    const created = await fetchEmployeeById(db, Number(row.id));
    return reply.code(201).send(created);
  });

  app.patch('/api/employees/:id', async (request) => {
    const employeeId = Number((request.params as { id: string }).id);
    const body = z
      .object({
        employeeName: z.string().trim().min(1).optional(),
        userId: z.string().trim().optional().or(z.literal('')),
        labelIds: z.array(z.number().int().positive()).optional(),
        active: z.boolean().optional(),
      })
      .parse(request.body);

    const current = await db.queryOne<{ id: number }>('select id from employees where id = $1', [employeeId]);
    if (!current) throw notFound('Employee not found');

    // employee_id (工号) is the key and cannot change; name/user_id/labels/active are editable.
    await db.execute(
      `update employees
       set employee_name = coalesce($1, employee_name),
           user_id = coalesce($2, user_id),
           is_active = coalesce($3, is_active),
           updated_at = current_timestamp
       where id = $4`,
      [
        body.employeeName ?? null,
        body.userId === undefined ? null : body.userId || null,
        body.active ?? null,
        employeeId,
      ],
    );
    if (body.labelIds !== undefined) {
      await replaceEmployeeLabels(db, employeeId, normalizeEmployeeLabelIds(body.labelIds));
    }

    return fetchEmployeeById(db, employeeId);
  });

  app.post('/api/employees/:id/merge', async (request, reply) => {
    const rawTarget = String((request.params as { id: string }).id).trim();
    const body = z.object({ mergeFromId: z.number().int().positive() }).parse(request.body);
    const sourceId = body.mergeFromId;

    // Resolve the target by employee_id (工号) first, then fall back to internal row id.
    let targetId: number | null = null;
    const normalizedTarget = normalizeExternalNumber(rawTarget);
    if (normalizedTarget) {
      const idRow = await db.queryOne<{ id: number }>(
        'select id from employees where employee_id = $1 limit 1',
        [normalizedTarget],
      );
      if (idRow) targetId = Number(idRow.id);
    }
    if (targetId === null && /^\d+$/.test(rawTarget)) targetId = Number(rawTarget);
    if (targetId === null) return reply.code(404).send({ error: '找不到目标员工' });
    if (sourceId === targetId) return reply.code(400).send({ error: '不能与自身关联' });

    await db.transaction(async (tx) => {
      const target = await tx.queryOne<{ id: number }>('select id from employees where id = $1 and merged_into_id is null', [targetId]);
      const source = await tx.queryOne<{ id: number }>('select id from employees where id = $1 and merged_into_id is null', [sourceId]);
      if (!target) throw notFound('Target employee not found');
      if (!source) throw notFound('Source employee not found');

      // 关联只声明"同一人"：来源设为指向目标的 tombstone。不改写 equity_grants / 标签 / has_file_evidence
      // 等任何业务数据——展示时按 canonical 关联组读时聚合，取消关联(unlink)因此零副作用、可无损还原。
      await tx.execute(
        'update employees set merged_into_id = $1, is_active = false, updated_at = current_timestamp where id = $2',
        [targetId, sourceId],
      );
    });

    const merged = await fetchEmployeeById(db, targetId);
    return merged;
  });

  app.post('/api/employees/:id/unlink', async (request, reply) => {
    const rawTarget = String((request.params as { id: string }).id).trim();
    const body = z.object({ mergeFromId: z.number().int().positive() }).parse(request.body);
    const sourceId = body.mergeFromId;

    let targetId: number | null = null;
    const normalizedTarget = normalizeExternalNumber(rawTarget);
    if (normalizedTarget) {
      const idRow = await db.queryOne<{ id: number }>('select id from employees where employee_id = $1 limit 1', [normalizedTarget]);
      if (idRow) targetId = Number(idRow.id);
    }
    if (targetId === null && /^\d+$/.test(rawTarget)) targetId = Number(rawTarget);
    if (targetId === null) return reply.code(404).send({ error: '找不到目标员工' });

    const source = await db.queryOne<{ id: number; merged_into_id: number | null }>(
      'select id, merged_into_id from employees where id = $1',
      [sourceId],
    );
    if (!source) throw notFound('Source employee not found');
    if (source.merged_into_id === null || Number(source.merged_into_id) !== targetId) {
      return reply.code(400).send({ error: '该员工未关联到此目标' });
    }
    await db.execute(
      'update employees set merged_into_id = null, is_active = true, updated_at = current_timestamp where id = $1',
      [sourceId],
    );
    return fetchEmployeeById(db, targetId);
  });
}

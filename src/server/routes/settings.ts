import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  asBoolean,
  notFound,
} from './support.js';
import type { RouteContext } from './context.js';
import type { EmployeeMapping, ShareholderTag, TrackedPlan } from '../../shared/types.js';

/**
 * System settings tables (employee id mappings, tracked plans, shareholder tags).
 *
 * These endpoints have no dedicated UI page anymore - the employee/label pages own that data - but
 * they remain the supported API surface, so the response shapes stay typed.
 */

async function settingRows(db: RouteContext['db'], table: 'employee_mappings' | 'tracked_plans' | 'shareholder_tags') {
  return db.query<Record<string, unknown>>(`select * from ${table} order by id`);
}

export function registerSettingsRoutes(app: FastifyInstance, ctx: RouteContext) {
  const { db } = ctx;

  app.get('/api/settings/employee-mappings', async () => ({
    items: (await settingRows(db, 'employee_mappings')).map((row): EmployeeMapping => ({
      id: Number(row.id),
      name: String(row.display_name),
      empId: String(row.employee_id),
      futuId: String(row.futu_id ?? ''),
      shareworksId: String(row.shareworks_id ?? ''),
    })),
  }));

  app.post('/api/settings/employee-mappings', async (request, reply) => {
    const body = z
      .object({ name: z.string(), empId: z.string(), futuId: z.string().optional(), shareworksId: z.string().optional() })
      .parse(request.body);
    const row = await db.queryOne<{ id: number }>(
      'insert into employee_mappings (display_name, employee_id, futu_id, shareworks_id) values ($1, $2, $3, $4) returning id',
      [body.name, body.empId, body.futuId ?? '', body.shareworksId ?? ''],
    );
    return reply.code(201).send({ id: Number(row?.id), ...body });
  });

  app.patch('/api/settings/employee-mappings/:id', async (request) => {
    const { id } = request.params as { id: string };
    const body = z.object({ name: z.string(), empId: z.string(), futuId: z.string(), shareworksId: z.string() }).parse(request.body);
    await db.execute(
      'update employee_mappings set display_name = $1, employee_id = $2, futu_id = $3, shareworks_id = $4 where id = $5',
      [body.name, body.empId, body.futuId, body.shareworksId, Number(id)],
    );
    return { id: Number(id), ...body };
  });

  app.delete('/api/settings/employee-mappings/:id', async (request, reply) => {
    await db.execute('delete from employee_mappings where id = $1', [Number((request.params as { id: string }).id)]);
    return reply.code(204).send();
  });

  app.get('/api/settings/tracked-plans', async () => ({
    items: (await settingRows(db, 'tracked_plans')).map((row): TrackedPlan => ({
      id: Number(row.id),
      name: String(row.plan_name),
      createTime: String(row.created_at),
      status: String(row.status),
    })),
  }));

  app.post('/api/settings/tracked-plans', async (request, reply) => {
    const body = z.object({ name: z.string(), description: z.string().optional() }).parse(request.body);
    const createTime = new Date().toLocaleDateString('zh-CN');
    const row = await db.queryOne<{ id: number }>(
      'insert into tracked_plans (plan_name, description, status, created_at) values ($1, $2, $3, $4) returning id',
      [body.name, body.description ?? '', '生效中', createTime],
    );
    return reply.code(201).send({ id: Number(row?.id), name: body.name, createTime, status: '生效中' });
  });

  app.patch('/api/settings/tracked-plans/:id', async (request) => {
    const { id } = request.params as { id: string };
    const body = z.object({ name: z.string(), status: z.string().optional() }).parse(request.body);
    await db.execute('update tracked_plans set plan_name = $1, status = coalesce($2, status) where id = $3', [
      body.name,
      body.status ?? null,
      Number(id),
    ]);
    return { id: Number(id), ...body };
  });

  app.delete('/api/settings/tracked-plans/:id', async (request, reply) => {
    await db.execute('delete from tracked_plans where id = $1', [Number((request.params as { id: string }).id)]);
    return reply.code(204).send();
  });

  app.get('/api/settings/shareholders', async () => ({
    items: (await settingRows(db, 'shareholder_tags')).map((row): ShareholderTag => ({
      id: Number(row.id),
      name: String(row.name),
      identity: String(row.identity),
      track: asBoolean(row.tracked),
    })),
  }));

  app.post('/api/settings/shareholders', async (request, reply) => {
    const body = z.object({ name: z.string(), identity: z.string(), track: z.boolean() }).parse(request.body);
    const row = await db.queryOne<{ id: number }>(
      'insert into shareholder_tags (name, identity, tracked) values ($1, $2, $3) returning id',
      [body.name, body.identity, body.track],
    );
    return reply.code(201).send({ id: Number(row?.id), ...body });
  });

  app.patch('/api/settings/shareholders/:id', async (request) => {
    const { id } = request.params as { id: string };
    const body = z.object({ name: z.string().optional(), identity: z.string().optional(), track: z.boolean().optional() }).parse(request.body);
    const current = await db.queryOne<Record<string, unknown>>('select * from shareholder_tags where id = $1', [Number(id)]);
    if (!current) throw notFound('Shareholder not found');
    await db.execute('update shareholder_tags set name = $1, identity = $2, tracked = $3 where id = $4', [
      body.name ?? current.name,
      body.identity ?? current.identity,
      body.track === undefined ? asBoolean(current.tracked) : body.track,
      Number(id),
    ]);
    return {
      id: Number(id),
      name: body.name ?? current.name,
      identity: body.identity ?? current.identity,
      track: body.track ?? asBoolean(current.tracked),
    };
  });

  app.delete('/api/settings/shareholders/:id', async (request, reply) => {
    await db.execute('delete from shareholder_tags where id = $1', [Number((request.params as { id: string }).id)]);
    return reply.code(204).send();
  });
}


import type { FastifyInstance } from 'fastify';
import path from 'node:path';
import { z } from 'zod';
import type { DbClient } from '../db.js';
import { fileStorage } from '../storage.js';
import {
  canonicalProductFilePath,
  normalizeProductFileName,
  normalizeProductFolder,
  productFileCollisionKey,
} from '../fileIdentity.js';
import { extractSheetRangeAsDataFrame, previewWorkbookSheet, summarizeWorkbookAsync } from '../excel.js';
import { workbookSummaryFor } from '../workbookSummaryCache.js';
import { parseJson } from '../utils/json.js';
import { rewriteProductFileKey } from '../workflow/productFileKeyRewrite.js';
import {
  badRequest,
  conflict,
  getProductFileOrThrow,
  inputStorageFolderPrefix,
  normalizeProductFileStoragePrefix,
  notFound,
  parseIdParam,
  productFileDisplayPath,
  saveProductWorkbook,
  toProductFile,
  updateProductWorkbook,
} from './support.js';
import { requireAdminUser } from './auth.js';
import type { RequestWithAuth } from './support.js';
import type { RouteContext } from './context.js';

/**
 * Product file center: upload, rename, move, inline content editing, sheet previews and deletion.
 *
 * The product-file mapping/persistence helpers live in support.ts because the workflow runtime
 * (generated workbooks) and the transfer-plan import need the same code paths.
 */

async function rewriteProductFileKeyInWorkflows(tx: DbClient, oldKey: string, newKey: string): Promise<number> {
  const rows = await tx.query<{ id: number; tasks_json: unknown; runtime_params_defaults_json: unknown }>(
    'select id, tasks_json, runtime_params_defaults_json from workflow_definitions',
  );
  let rewrittenWorkflows = 0;
  for (const row of rows) {
    const tasks = rewriteProductFileKey(parseJson(row.tasks_json, {}), oldKey, newKey);
    const defaults = rewriteProductFileKey(parseJson(row.runtime_params_defaults_json, {}), oldKey, newKey);
    if (!tasks.changed && !defaults.changed) continue;
    rewrittenWorkflows += 1;
    await tx.execute(
      `update workflow_definitions
          set tasks_json = $2::jsonb,
              runtime_params_defaults_json = $3::jsonb,
              updated_at = current_timestamp
        where id = $1`,
      [row.id, JSON.stringify(tasks.value), JSON.stringify(defaults.value)],
    );
  }
  return rewrittenWorkflows;
}

const filePreviewQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

const fileSheetRangeQuerySchema = z.object({
  range: z.string().trim().min(1),
  headerRow: z.coerce.number().int().min(1).optional(),
});

const productFilePatchSchema = z.object({
  originalName: z.string().trim().min(1).max(255),
});

const productFileMoveSchema = z.object({
  folder: z.string().trim().max(512),
});

const productFileBulkDeleteSchema = z.object({
  ids: z.array(z.coerce.number().int().positive()).min(1).max(500),
});

export function registerFileRoutes(app: FastifyInstance, ctx: RouteContext) {
  const { db } = ctx;

  app.get('/api/files', async () => {
    const rows = await db.query<Record<string, unknown>>(
      'select * from product_files order by created_at desc, id desc',
    );
    return { files: rows.map(toProductFile) };
  });

  app.post('/api/files/upload', async (request, reply) => {
    let uploadedBy = 'Administrator';
    let folderPrefix: string | undefined;
    let conflictPolicy: 'error' | 'overwrite' = 'error';
    let uploaded: { fileName: string; buffer: Buffer; mimeType: string } | null = null;

    for await (const part of request.parts()) {
      if (part.type === 'file') {
        uploaded = {
          fileName: part.filename,
          buffer: await part.toBuffer(),
          mimeType: part.mimetype,
        };
      } else if (part.fieldname === 'uploadedBy' && typeof part.value === 'string' && part.value.trim()) {
        uploadedBy = part.value.trim();
      } else if (part.fieldname === 'folderPrefix' && typeof part.value === 'string' && part.value.trim()) {
        folderPrefix = part.value
          .trim()
          .replace(/\\/g, '/')
          .replace(/^\/+|\/+$/g, '');
      } else if (part.fieldname === 'conflictPolicy' && part.value === 'overwrite') {
        conflictPolicy = 'overwrite';
      }
    }

    if (!uploaded) return reply.code(400).send({ error: 'No file uploaded' });
    if (!/\.(xlsx|xls|csv)$/i.test(uploaded.fileName)) {
      return reply.code(400).send({ error: 'Only .xlsx, .xls, and .csv files are supported' });
    }
    if (conflictPolicy === 'overwrite' && !requireAdminUser(request as typeof request & RequestWithAuth, reply)) {
      return;
    }

    let saved;
    try {
      saved = await saveProductWorkbook(db, {
        originalName: uploaded.fileName,
        buffer: uploaded.buffer,
        mimeType: uploaded.mimeType,
        uploadedBy,
        folderPrefix: inputStorageFolderPrefix(folderPrefix),
        conflictPolicy,
      });
    } catch (error) {
      const uploadError = error as Error & { statusCode?: number; existingFile?: Record<string, unknown> };
      if (uploadError.statusCode === 409) {
        return reply.code(409).send({
          error: uploadError.message,
          code: 'FILE_ALREADY_EXISTS',
          existingFile: uploadError.existingFile ? toProductFile(uploadError.existingFile) : undefined,
        });
      }
      throw error;
    }

    return reply.code(201).send({
      file: toProductFile(saved.file),
      sheets: saved.summary.sheets,
    });
  });

  app.get('/api/files/:id', async (request) => {
    const { id } = request.params as { id: string };
    const file = await getProductFileOrThrow(db, Number(id));
    // Cached by content checksum, and parsed on a worker thread: the monthly page asks for a dozen
    // workbooks per render, and a synchronous parse would block the event loop (i.e. every other
    // request, including an operator's approval click) for as long as it runs.
    const summary = await workbookSummaryFor(
      { fileId: Number(id), stamp: String(file.checksum ?? file.file_path) },
      async () => summarizeWorkbookAsync(await fileStorage.read(String(file.file_path))),
    );
    return {
      file: toProductFile(file),
      sheets: summary.sheets,
    };
  });

  app.patch('/api/files/:id', async (request) => {
    const { id } = request.params as { id: string };
    const fileId = Number(id);
    const file = await getProductFileOrThrow(db, fileId);
    const body = productFilePatchSchema.parse(request.body ?? {});
    const originalName = normalizeProductFileName(body.originalName);
    const currentLogicalPath = String(file.logical_path ?? productFileDisplayPath(file));
    const directory = currentLogicalPath.split('/').slice(0, -1).join('/');
    const logicalPath = canonicalProductFilePath(directory, originalName);
    const existing = await db.queryOne<{ id: number }>(
      'select id from product_files where lower(logical_path) = lower($1) and id <> $2',
      [logicalPath, fileId],
    );
    if (existing) throw conflict(`File already exists: ${logicalPath}`);
    const oldFilePath = String(file.file_path);
    const buffer = await fileStorage.read(oldFilePath);
    const stored = await fileStorage.save('product', originalName, buffer, { prefix: directory });
    const ext = path.extname(originalName).toLowerCase();
    const row = await db.queryOne<Record<string, unknown>>(
      `update product_files
          set original_name = $2,
              stored_name = $2,
              file_ext = $3,
              file_path = $4,
              logical_path = $5,
              storage_backend = $6,
              created_at = current_timestamp
        where id = $1
        returning *`,
      [fileId, originalName, ext.replace(/^\./, ''), stored.filePath, logicalPath, stored.storageBackend],
    );
    if (!row) throw notFound('Product file not found');
    if (oldFilePath !== stored.filePath) await fileStorage.remove(oldFilePath);
    return { file: toProductFile(row) };
  });

  app.post('/api/files/:id/move', async (request, reply) => {
    const fileId = parseIdParam((request.params as { id: string }).id, 'file id');
    const file = await getProductFileOrThrow(db, fileId);
    const body = productFileMoveSchema.parse(request.body ?? {});
    const originalName = String(file.original_name);
    const oldLogicalPath = String(file.logical_path ?? productFileDisplayPath(file));

    let folderPrefix: string;
    try {
      const requestedFolder = normalizeProductFolder(body.folder);
      // Output workbooks stay in the output class; everything else is an input.
      folderPrefix = oldLogicalPath.startsWith('output/')
        ? normalizeProductFileStoragePrefix(requestedFolder)
        : inputStorageFolderPrefix(requestedFolder);
    } catch {
      throw badRequest('Invalid folder path');
    }

    const logicalPath = canonicalProductFilePath(folderPrefix, originalName);
    if (productFileCollisionKey(logicalPath) === productFileCollisionKey(oldLogicalPath)) {
      return { file: toProductFile(file), rewrittenWorkflows: 0 };
    }

    const existing = await db.queryOne<{ id: number }>(
      'select id from product_files where lower(logical_path) = lower($1) and id <> $2',
      [logicalPath, fileId],
    );
    if (existing) {
      const existingFile = await getProductFileOrThrow(db, existing.id);
      return reply.code(409).send({
        error: `File already exists: ${logicalPath}`,
        code: 'FILE_ALREADY_EXISTS',
        existingFile: toProductFile(existingFile),
      });
    }

    const oldFilePath = String(file.file_path);
    const buffer = await fileStorage.read(oldFilePath);
    const stored = await fileStorage.save('product', originalName, buffer, { prefix: folderPrefix });

    const moved = await db.transaction(async (tx) => {
      const row = await tx.queryOne<Record<string, unknown>>(
        `update product_files
            set file_path = $2,
                logical_path = $3,
                storage_backend = $4
          where id = $1
          returning *`,
        [fileId, stored.filePath, logicalPath, stored.storageBackend],
      );
      if (!row) throw notFound('Product file not found');
      const rewrittenWorkflows = await rewriteProductFileKeyInWorkflows(tx, oldLogicalPath, logicalPath);
      return { row, rewrittenWorkflows };
    });

    if (oldFilePath !== stored.filePath) await fileStorage.remove(oldFilePath);
    return { file: toProductFile(moved.row), rewrittenWorkflows: moved.rewrittenWorkflows };
  });

  app.get('/api/files/:id/content', async (request, reply) => {
    const { id } = request.params as { id: string };
    const file = await getProductFileOrThrow(db, Number(id));
    const buffer = await fileStorage.read(String(file.file_path));

    reply
      .header('Content-Type', String(file.mime_type ?? 'application/octet-stream'))
      .header('Content-Length', String(buffer.length))
      .header(
        'Content-Disposition',
        `inline; filename="${encodeURIComponent(String(file.original_name ?? 'workbook.xlsx'))}"`,
      );

    return reply.send(buffer);
  });

  app.put('/api/files/:id/content', async (request, reply) => {
    const { id } = request.params as { id: string };
    const fileId = Number(id);
    await getProductFileOrThrow(db, fileId);

    let uploadedBy = 'Administrator';
    let uploaded: { fileName: string; buffer: Buffer; mimeType: string } | null = null;

    for await (const part of request.parts()) {
      if (part.type === 'file') {
        uploaded = {
          fileName: part.filename,
          buffer: await part.toBuffer(),
          mimeType: part.mimetype,
        };
      } else if (part.fieldname === 'uploadedBy' && typeof part.value === 'string' && part.value.trim()) {
        uploadedBy = part.value.trim();
      }
    }

    if (!uploaded) return reply.code(400).send({ error: 'No file uploaded' });
    if (!/\.(xlsx|xls|csv)$/i.test(uploaded.fileName)) {
      return reply.code(400).send({ error: 'Only .xlsx, .xls, and .csv files are supported' });
    }

    const saved = await updateProductWorkbook(db, {
      fileId,
      originalName: uploaded.fileName,
      buffer: uploaded.buffer,
      mimeType: uploaded.mimeType,
      uploadedBy,
    });

    return reply.send({
      file: toProductFile(saved.file),
      sheets: saved.summary.sheets,
    });
  });

  app.get('/api/files/:id/sheets/:sheetName', async (request) => {
    const { id, sheetName } = request.params as { id: string; sheetName: string };
    const query = filePreviewQuerySchema.parse(request.query ?? {});
    const file = await getProductFileOrThrow(db, Number(id));
    const buffer = await fileStorage.read(String(file.file_path));
    return previewWorkbookSheet(buffer, sheetName, query.limit, query.offset);
  });

  app.get('/api/files/:id/sheets/:sheetName/range', async (request) => {
    const { id, sheetName } = request.params as { id: string; sheetName: string };
    const query = fileSheetRangeQuerySchema.parse(request.query ?? {});
    const file = await getProductFileOrThrow(db, Number(id));
    const buffer = await fileStorage.read(String(file.file_path));
    return extractSheetRangeAsDataFrame(buffer, sheetName, {
      range: query.range,
      headerRow: query.headerRow,
    });
  });

  app.delete('/api/files', async (request, reply) => {
    const { ids } = productFileBulkDeleteSchema.parse(request.body ?? {});
    const uniqueIds = [...new Set(ids)];
    const files = await db.transaction(async (tx) => {
      const rows = await tx.query<Record<string, unknown>>('select * from product_files where id = any($1::int[])', [
        uniqueIds,
      ]);
      if (rows.length > 0) {
        await tx.execute('delete from product_files where id = any($1::int[])', [uniqueIds]);
      }
      return rows;
    });

    await Promise.all(files.map((file) => fileStorage.remove(String(file.file_path))));
    return reply.send({ deletedIds: files.map((file) => Number(file.id)) });
  });

  app.delete('/api/files/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const fileId = Number(id);
    const file = await getProductFileOrThrow(db, fileId);
    await fileStorage.remove(String(file.file_path));
    await db.execute('delete from product_files where id = $1', [fileId]);
    return reply.code(204).send();
  });
}

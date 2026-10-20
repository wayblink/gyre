export type EsopPageKey = 'grant-record' | 'exercise-record' | 'sold-shares' | 'cancellation-record' | 'transfer-plan';

export type EsopWorkflowSourceBindings = Record<string, { fileId?: number; fileKey?: string } | undefined>;

/**
 * ESOP 页面 → 工作流 code 路由。
 *
 * 工作流定义（tasks / runtime_params_schema / 输入源清单）只存数据库（见 CLAUDE.md）。
 * 页面输入源清单由 server 从 DB workflow 的 runtime_params_schema.fileRefs.properties 推导，
 * 运行时参数由 buildFileRefsFromBindings（workflow/fileSources.ts）从已解析的文件绑定构造。
 * 这里只保留页面到工作流的路由映射（不是工作流定义）。
 */
export const ESOP_PAGE_WORKFLOW_CONFIGS: Record<EsopPageKey, { pageKey: EsopPageKey; workflowCode: string }> = {
  'grant-record': { pageKey: 'grant-record', workflowCode: 'esop-grant-record-sync' },
  'exercise-record': { pageKey: 'exercise-record', workflowCode: 'esop-exercise-record-sync' },
  'sold-shares': { pageKey: 'sold-shares', workflowCode: 'esop-sold-shares-sync' },
  'cancellation-record': { pageKey: 'cancellation-record', workflowCode: 'esop-cancellation-record-sync' },
  'transfer-plan': { pageKey: 'transfer-plan', workflowCode: 'esop-transfer-to-futu-sync' },
};

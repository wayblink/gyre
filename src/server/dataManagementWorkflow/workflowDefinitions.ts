export type DataManagementPageKey = 'employee' | 'plan-summary' | 'five-percent-holders';
export type DataManagementSourceBindings = Record<string, { fileId?: number; fileKey?: string } | undefined>;

/**
 * 数据归集页面 → 工作流 code 路由。
 *
 * 工作流定义（tasks / runtime_params_schema / 输入源清单）只存数据库（见 CLAUDE.md）。
 * 页面输入源清单由 server 从 DB workflow 的 runtime_params_schema.fileRefs.properties 推导，
 * 运行时参数由 buildFileRefsFromBindings（workflow/fileSources.ts）从已解析的文件绑定构造。
 * 这里只保留页面到工作流的路由映射（不是工作流定义）。
 */
export const DATA_MANAGEMENT_WORKFLOW_CONFIGS: Record<
  DataManagementPageKey,
  { pageKey: DataManagementPageKey; workflowCode: string }
> = {
  employee: { pageKey: 'employee', workflowCode: 'employee-import' },
  'plan-summary': { pageKey: 'plan-summary', workflowCode: 'plan-summary-sync' },
  'five-percent-holders': { pageKey: 'five-percent-holders', workflowCode: 'five-percent-holders-sync' },
};

/**
 * 5% Holders 工作流从 Global Parameter 读取的四个手工维护数字的参数 key。
 * 这不是工作流定义，是 Global Parameter 的 key 映射，seed 与 5% Holders service 均依赖它。
 */
export const FIVE_PERCENT_HOLDER_GLOBAL_PARAMETER_KEYS = {
  gniCommonStock: 'fivePercentHoldersGniCommonStock',
  gniTotalCses: 'fivePercentHoldersGniTotalCses',
  songjiangMaCommonStock: 'fivePercentHoldersSongjiangMaCommonStock',
  songjiangMaTotalCses: 'fivePercentHoldersSongjiangMaTotalCses',
} as const;

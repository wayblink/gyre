export type AppLanguage = 'zh-CN' | 'en-US';

export const LANGUAGE_STORAGE_KEY = 'captable.ui.language';

const STATIC_TEXT_TRANSLATIONS: Record<string, string> = {
  中文: '中文',
  语言: 'Language',
  切换界面显示语言: 'Switch the interface language',
  界面语言: 'Interface language',
  配色: 'Color Theme',
  控制品牌主色与强调色倾向: 'Control the brand and accent color',
  配色方案: 'Color scheme',
  登录: 'Log in',
  用户名: 'Username',
  密码: 'Password',
  显示名称: 'Display name',
  初始化密钥: 'Bootstrap secret',
  创建并登录: 'Create and log in',
  请先登录: 'Please log in first',
  账号: 'Account',
  退出登录: 'Log out',
  打开用户菜单: 'Open user menu',
  开发工具: 'Developer Tools',
  使用手册: 'Docs',
  文件中心: 'Files',
  文件列表: 'File list',
  表格列表: 'Browser',
  '搜索文件...': 'Search files...',
  上传目录: 'Upload folder',
  上传: 'Upload',
  '上传 Excel': 'Upload Excel',
  保存: 'Save',
  刷新: 'Refresh',
  列表: 'List',
  树状: 'Tree',
  收起: 'Collapse',
  展开: 'Expand',
  展开导航栏: 'Expand sidebar',
  收起导航栏: 'Collapse sidebar',
  收起表格列表: 'Collapse workbook list',
  '收起 Browser': 'Collapse Browser',
  '展开 Browser': 'Expand Browser',
  '展开 文件列表': 'Expand file list',
  正在加载输入定义: 'Loading input definitions',
  '正在加载输入定义...': 'Loading input definitions...',
  选择左侧文件后可在页面内查看完整: 'Select a file on the left to view the full workbook here.',
  '选择左侧文件后可在页面内查看完整 Excel 工作簿。': 'Select a file on the left to view the full Excel workbook here.',
  工作流: 'Workflow',
  导入: 'Import',
  新建: 'New',
  工作流名称: 'Workflow name',
  执行: 'Execute',
  删除: 'Delete',
  执行状态: 'Execution Status',
  准备执行: 'Ready to execute',
  添加节点: 'Add node',
  算子: 'Operators',
  输入: 'Input',
  计算: 'Transform',
  输出: 'Output',
  数据库: 'Database',
  断言: 'Validation',
  暂无工作流: 'No workflows',
  暂无描述: 'No description',
  个节点: 'nodes',
  复制: 'Duplicate',
  暂无可用算子: 'No available operators',
  请选择一个算子: 'Select an operator',
  个输入: 'inputs',
  个输出: 'outputs',
  未设置默认值: 'No default value',
  未设置默认文件: 'No default file',
  请选择文件: 'Select file',
  运行时参数: 'Runtime parameters',
  项参数: 'parameters',
  应用: 'Apply',
  '应用 JSON': 'Apply JSON',
  暂无运行时参数配置: 'No runtime parameter configuration',
  '运行时参数 JSON': 'Runtime parameters JSON',
  节点会按依赖顺序显示执行状态: 'Nodes will show execution status in dependency order.',
  请先创建或选择工作流: 'Create or select a workflow first',
  暂无输入: 'No inputs',
  输入检查: 'Input checks',
  暂无输入检查: 'No input checks',
  暂无参数: 'No parameters',
  当前输入暂无检查: 'No checks for this input',
  暂无执行依赖: 'No execution dependencies',
  没有更多可添加的候选节点: 'No more candidate nodes to add',
  预览失败: 'Preview failed',
  未知错误: 'Unknown error',
  任务已跳过后续流程: 'Task skipped downstream flow',
  任务完成: 'Task completed',
  '任务完成（包含 Warning）': 'Task completed with warning',
  当前工作流没有任务: 'The current workflow has no tasks',
  当前没有可继续的工作流运行: 'No resumable workflow run',
  请先执行工作流: 'Execute the workflow first and create the current run before running one step',
  工作流正在执行中: 'Workflow is running; cannot run one step at the same time',
  当前绑定还没有关联上游任务: 'The current binding is not linked to an upstream task',
  未找到绑定的上游任务: 'The bound upstream task was not found',
  暂无数据: 'No data',
  点击: 'Click',
  参数: 'Parameters',
  用法: 'Usage',
  配置步骤: 'Configuration steps',
  输入槽: 'Input slots',
  输出槽: 'Output slots',
  示例参数: 'Example params',
  暂无使用说明: 'No usage guide.',
  配置参数后连接输入输出槽: 'Configure parameters, then connect input and output slots.',
  请选择一个: 'Select an',
  暂无算子: 'No operators',
  删除工作流: 'Delete workflow',
  查看详情: 'View details',
  待启动: 'Not started',
  待复核: 'Pending review',
  已取消: 'Cancelled',
  暂无月度更新计划: 'No monthly update plans',
  暂无月度业务数据: 'No monthly business data',
  '暂无月度业务数据。请先创建 Monthly Update 或导入正式数据。': 'No monthly business data. Create a Monthly Update or import production data first.',
  请先创建: 'Create a Monthly Update or import production data first.',
  暂无备注: 'No notes. Click Add note in the upper right to add one.',
  '暂无备注，点击右上角添加备注按钮添加': 'No notes. Click Add note in the upper right to add one.',
  暂无符合条件的持仓记录: 'No matching holding records',
  暂无符合条件的: 'No matching',
  '暂无符合条件的 Shareworks 记录': 'No matching Shareworks records',
  暂无符合条件的合并记录: 'No matching merged records',
  暂无符合条件的行权记录: 'No matching exercise records',
  暂无符合条件的出售记录: 'No matching sold-share records',
  暂无符合条件的员工: 'No matching employees',
  暂无计划汇总数据: 'No plan summary data',
  '暂无 5% 股东记录': 'No 5% holder records',
  暂无固定参数配置: 'No fixed parameter configuration',
  手工: 'Manual',
  停用: 'Deactivate',
  启用: 'Activate',
  编辑: 'Edit',
  edit: 'Edit',
  是: 'Yes',
  否: 'No',
  生效中: 'Active',
  展开工作流列表: 'Expand workflow list',
  收起工作流列表: 'Collapse workflow list',
  '展开 Operators': 'Expand Operators',
  '收起 Operators': 'Collapse Operators',
  股权汇总: 'CapTable',
  股本汇总: 'Equity Summary',
  '展示月度 Capitalization Table Summary View，数据来自当前选择的 SourceFile。': 'View the monthly Capitalization Table Summary using the selected SourceFile.',
  月份: 'Month',
  默认快照数据: 'Default snapshot data',
  暂无汇总数据: 'No summary data',
  股本对账: 'Share Capital Reconciliation',
  期末股本数据: 'End-of-month share capital data',
  股权结构汇总: 'Ownership Summary',
  导出: 'Export',
  备注: 'Notes',
  添加备注: 'Add note',
  请输入备注内容: 'Enter note content',
  保存备注: 'Save note',
  取消: 'Cancel',
  查询: 'Search',
  新建月度更新: 'New Monthly Update',
  计划总数: 'Total Plans',
  已完成: 'Completed',
  进行中: 'In Progress',
  待处理: 'Pending',
  月度更新计划: 'Monthly Update Plan',
  按月份管理数据更新计划: 'Manage data update plans by month',
  新建月度更新计划: 'New Monthly Update Plan',
  月度更新: 'Monthly Update',
  月度运行: 'Monthly Run',
  配置输入源: 'Configure sources',
  刷新文件: 'Refresh files',
  输入配置: 'Input configuration',
  固定参数: 'Global Parameters',
  来自: 'From',
  '来自 Shareworks 的输入表': 'Input tables from Shareworks',
  '来自 Futu 的输入表': 'Input tables from Futu',
  运行历史: 'Run History',
  记录每次月度工作流执行的输入: 'Record inputs, outputs, and status for each monthly workflow run',
  为本次月度执行配置每个: 'Configure source files for each workflow input node in this monthly run.',
  '为本次月度执行配置每个 workflow 输入节点的文件来源。': 'Configure source files for each workflow input node in this monthly run.',
  新上传文件会进入当前月份目录: 'New uploads go into the current month folder; files from historical months can still be reused.',
  保存输入源: 'Save sources',
  账号信息: 'Account Information',
  管理当前登录账号的基础信息和联系方式: 'Manage the current account profile and contact details',
  账号名: 'Username',
  显示名: 'Display name',
  邮箱: 'Email',
  联系方式: 'Contact',
  修改密码: 'Change Password',
  保存账号信息: 'Save Account',
  请输入原密码: 'Enter the current password and confirm the new password twice',
  '请输入原密码，并确认两次新密码一致': 'Enter the current password and confirm the new password twice',
  当前密码: 'Current password',
  新密码: 'New password',
  确认新密码: 'Confirm new password',
  更新密码: 'Update Password',
  确认操作: 'Confirm action',
  确认: 'Confirm',
  关闭: 'Close',
  关闭通知: 'Close notification',
  提示: 'Info',
  完成: 'Completed',
  需要注意: 'Attention required',
  发生错误: 'Error',
  行权记录: 'Exercise Records',
  授予记录: 'Grant Records',
  'futu + shareworks 数据合并拼表。': 'Merge Futu and Shareworks data into a standardized table.',
  '展示 futu 的全部行权记录，覆盖 2023 年和 2025 年。': 'View all Futu exercise records covering 2023 and 2025.',
  '展示 Futu 全部行权记录，数据来自 Files 中的独立工作簿。': 'View all Futu exercise records from the workbook stored in Files.',
  卖出记录: 'Sold Share Records',
  'futu 卖出记录仅做管理。': 'Manage Futu sold-share records.',
  '展示 Futu 卖出汇总记录，数据来自 Files 中的独立工作簿。': 'View Futu sold-share summary records from the workbook stored in Files.',
  '2025年计划': '2025 Plan',
  '2025 年计划': '2025 Plan',
  '导入提醒、月度归属汇总和每月取消数量编辑入口。': 'Import reminders, monthly vesting summary, and monthly cancellation editing.',
  月度归属汇总: 'Monthly Vesting Summary',
  'Options cancelled/forfeited 可编辑；修改后 Transfer to Futu 将即时按 “In total + cancelled” 重新计算。': 'Options cancelled/forfeited is editable; after changes, Transfer to Futu is recalculated immediately as “In total + cancelled”.',
  '按月汇总归属记录，取消数量可直接编辑；数据来自 Files 中的独立工作簿。': 'Summarize monthly vesting records and edit cancellation quantities directly.',
  员工管理: 'Employee Management',
  '员工主数据由员工归集 workflow 从 ESOP 明细输入文件中生成，并支持手工补充。': 'Employee master data is generated from ESOP detail workflows and can be manually supplemented.',
  计划汇总: 'Plan Summary',
  '按 Plan Name 聚合授予、行权、取消及 outstanding 数量。': 'Aggregate grants, exercises, cancellations, and outstanding quantities by Plan Name.',
  '持股5%以上股东': '5% Holders',
  '由 Global Parameter 手工维护的 5% holder 数字与 Capitalization Summary 分母计算生成。': 'Generated from manually maintained Global Parameter holder numbers and Capitalization Summary denominators.',
  管理可以更改的全局参数: 'Manage Editable Global Parameters',
  'Data Management 下的全局参数维护页，用于管理月度流程中可由管理员调整的业务常量。': 'Maintain business constants that admins can adjust in the monthly process.',
  管理员可维护: 'Admin editable',
  系统各页面与工作流的使用说明: 'Usage guides for system pages and workflows, organized by topic.',
  '系统各页面与工作流的使用说明，按主题分多篇文档。': 'Usage guides for system pages and workflows, organized by topic.',
  搜索: 'Search',
  标签: 'Tag',
  激励类型: 'Incentive Type',
  授予年份: 'Grant Year',
  在职状态: 'Employment Status',
  在职: 'Active',
  离职: 'Terminated',
  新增员工: 'New Employee',
  编辑员工: 'Edit Employee',
  关联为同一人: 'Link as same person',
  关联: 'Link',
  目标员工工号: 'Target employee no.',
  将当前员工: 'Merge the current employee',
  '并入目标员工（保留目标为主记录，本记录成为其别名）。此操作不可撤销。': 'into the target employee. The target remains the primary record and this record becomes an alias. This action cannot be undone.',
  'Emp. No.（工号）': 'Emp. No.',
  '目标员工工号（Emp. No.）': 'Target employee no. (Emp. No.)',
  '员工姓名': 'Employee name',
  '员工身份ID': 'Employee identity ID',
  'futu员工ID号': 'Futu employee ID',
  'shareworks员工ID号': 'Shareworks employee ID',
  '计划名称': 'Plan name',
  '股东姓名': 'Shareholder name',
  '身份信息': 'Identity information',
  删除员工映射: 'Delete employee mapping',
  删除员工: 'Delete employee',
  删除计划: 'Delete plan',
  删除股东: 'Delete shareholder',
  删除备注: 'Delete note',
  删除月度运行实例: 'Delete monthly run instance',
  导入明细: 'Import detail',
  转置表格: 'Transpose table',
  恢复横向: 'Restore horizontal',
  新增全局参数: 'New Global Parameter',
  仅管理员可创建: 'Admins only',
  创建参数: 'Create Parameter',
  参数名称: 'Parameter name',
  '请完整填写 Key、Item 和 Value': 'Please fill in Key, Item, and Value',
  'Global Parameter 已新增': 'Global Parameter created',
  'Global Parameter 已删除': 'Global Parameter deleted',
  '删除 Global Parameter': 'Delete Global Parameter',
  '确定删除 Global Parameter': 'Delete Global Parameter',
  '由股权授予明细聚合生成': 'Aggregated from equity grant detail',
  '输入工号（新增后不可改）': 'Enter employee no. (cannot be changed after creation)',
  输入员工姓名: 'Enter employee name',
  输入用户: 'Enter user',
  用英文逗号分隔标签: 'Comma separated tags',
  '输入目标员工的工号 / Emp. No.': 'Enter target employee no. / Emp. No.',
};

const STATIC_TEXT_REVERSE = Object.fromEntries(
  Object.entries(STATIC_TEXT_TRANSLATIONS).map(([zh, en]) => [en, zh]),
) as Record<string, string>;

export function readStoredLanguage(): AppLanguage {
  try {
    return window.localStorage.getItem(LANGUAGE_STORAGE_KEY) === 'en-US' ? 'en-US' : 'zh-CN';
  } catch {
    return 'zh-CN';
  }
}

export function persistLanguage(language: AppLanguage) {
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // Ignore storage failures; the active page still updates immediately.
  }
}

export function translateRecord(copy: Record<AppLanguage, string>, language: AppLanguage): string {
  return copy[language] ?? copy['zh-CN'];
}

export function translateStaticText(text: string, language = readStoredLanguage()): string {
  const trimmed = text.trim();
  if (!trimmed) return text;
  const dictionary = language === 'en-US' ? STATIC_TEXT_TRANSLATIONS : STATIC_TEXT_REVERSE;
  const translated = dictionary[trimmed];
  if (!translated) return text;
  const prefix = text.match(/^\s*/)?.[0] ?? '';
  const suffix = text.match(/\s*$/)?.[0] ?? '';
  return `${prefix}${translated}${suffix}`;
}

export function applyStaticTranslations(root: ParentNode = document, language = readStoredLanguage()) {
  const elements = Array.from(root.querySelectorAll<HTMLElement>('*'));
  for (const element of elements) {
    if (element.closest('[data-no-static-translate]')) continue;
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      if (element.placeholder) element.placeholder = translateStaticText(element.placeholder, language);
    }
    for (const attr of ['title', 'aria-label']) {
      const value = element.getAttribute(attr);
      if (value) element.setAttribute(attr, translateStaticText(value, language));
    }
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || ['SCRIPT', 'STYLE'].includes(parent.tagName)) return NodeFilter.FILTER_REJECT;
      if (parent.closest('[data-no-static-translate]')) return NodeFilter.FILTER_REJECT;
      const value = node.nodeValue ?? '';
      return /[\p{Script=Han}]/u.test(value) || Object.prototype.hasOwnProperty.call(STATIC_TEXT_REVERSE, value.trim())
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_SKIP;
    },
  });

  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) {
    node.nodeValue = translateStaticText(node.nodeValue ?? '', language);
  }
}

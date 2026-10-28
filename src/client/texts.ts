import type { AppLanguage } from './i18n.js';

/**
 * Every bilingual string the client renders, in one table.
 *
 * Before this the copy lived in seven parallel tables (main.ts, monthlyRunPage, filePickerModal,
 * filesPage, fileMoveDialog, workflowUpdateModal, uploadProgress), each with its own `tt()` helper
 * and its own key vocabulary — so the same button was translated several times over, and nothing
 * stopped two modules from drifting apart on the same wording.
 *
 * Each namespace keeps its own keys, so a module reads `tt('cancel')` and gets *its* cancel button.
 * `createTexts()` returns the accessor; the key type comes from the table, so a typo is a compile
 * error rather than a silent fallback to Chinese.
 */

export const TEXTS = {
  /** main.ts: the app shell, page heroes, buttons, filters and modal labels. */
  main: {
    authUsername: { 'zh-CN': '用户名', 'en-US': 'Username' },
    authPassword: { 'zh-CN': '密码', 'en-US': 'Password' },
    authDisplayName: { 'zh-CN': '显示名称', 'en-US': 'Display name' },
    authBootstrapSecret: { 'zh-CN': '初始化密钥', 'en-US': 'Bootstrap secret' },
    login: { 'zh-CN': '登录', 'en-US': 'Log in' },
    createAndLogin: { 'zh-CN': '创建并登录', 'en-US': 'Create and log in' },
    collapseSidebar: { 'zh-CN': '收起导航栏', 'en-US': 'Collapse sidebar' },
    expandSidebar: { 'zh-CN': '展开导航栏', 'en-US': 'Expand sidebar' },
    devTools: { 'zh-CN': '仅管理员', 'en-US': 'Admin Only' },
    account: { 'zh-CN': '账号', 'en-US': 'Account' },
    logout: { 'zh-CN': '退出登录', 'en-US': 'Log out' },
    search: { 'zh-CN': '搜索', 'en-US': 'Search' },
    tag: { 'zh-CN': '标签', 'en-US': 'Tag' },
    incentiveType: { 'zh-CN': '激励类型', 'en-US': 'Incentive Type' },
    allTypes: { 'zh-CN': '全部类型', 'en-US': 'All Types' },
    grantYear: { 'zh-CN': '授予年份', 'en-US': 'Grant Year' },
    employmentStatus: { 'zh-CN': '在职状态', 'en-US': 'Employment Status' },
    month: { 'zh-CN': '月份', 'en-US': 'Month' },
    defaultSnapshot: { 'zh-CN': '默认快照数据', 'en-US': 'Default snapshot data' },
    currentView: { 'zh-CN': '当前视图：', 'en-US': 'Current view: ' },
    noSummaryData: { 'zh-CN': '暂无汇总数据', 'en-US': 'No summary data' },
    export: { 'zh-CN': '导出', 'en-US': 'Export' },
    update: { 'zh-CN': '更新', 'en-US': 'Update' },
    confirmAndRun: { 'zh-CN': '确认并运行', 'en-US': 'Confirm & Run' },
    save: { 'zh-CN': '保存', 'en-US': 'Save' },
    delete: { 'zh-CN': '删除', 'en-US': 'Delete' },
    actions: { 'zh-CN': '操作', 'en-US': 'Actions' },
    rows: { 'zh-CN': '行数', 'en-US': 'Rows' },
    first: { 'zh-CN': '« 首页', 'en-US': '« First' },
    previous: { 'zh-CN': '上一页', 'en-US': 'Previous' },
    next: { 'zh-CN': '下一页', 'en-US': 'Next' },
    last: { 'zh-CN': '末页 »', 'en-US': 'Last »' },
    language: { 'zh-CN': '语言', 'en-US': 'Language' },
    languageSubtitle: { 'zh-CN': '切换界面显示语言', 'en-US': 'Switch the interface language' },
    uiLanguage: { 'zh-CN': '界面语言', 'en-US': 'Interface language' },
    colorTheme: { 'zh-CN': '配色', 'en-US': 'Color Theme' },
    colorThemeSubtitle: { 'zh-CN': '控制品牌主色与强调色倾向', 'en-US': 'Control the brand and accent color' },
    colorScheme: { 'zh-CN': '配色方案', 'en-US': 'Color scheme' },
    current: { 'zh-CN': '当前', 'en-US': 'Current' },
    blueDesc: { 'zh-CN': '稳健的默认企业蓝', 'en-US': 'Stable default enterprise blue' },
    tealDesc: { 'zh-CN': '更偏产品和数据工具的青绿色强调', 'en-US': 'Teal accent for product and data tools' },
    amberDesc: {
      'zh-CN': '偏暖的金橙色强调，更接近演示型工作台',
      'en-US': 'Warm amber accent for demo-oriented workspaces',
    },
    accountInfo: { 'zh-CN': '账号信息', 'en-US': 'Account Information' },
    accountInfoSubtitle: {
      'zh-CN': '管理当前登录账号的基础信息和联系方式',
      'en-US': 'Manage the current account profile and contact details',
    },
    username: { 'zh-CN': '账号名', 'en-US': 'Username' },
    displayName: { 'zh-CN': '显示名', 'en-US': 'Display name' },
    email: { 'zh-CN': '邮箱', 'en-US': 'Email' },
    contact: { 'zh-CN': '联系方式', 'en-US': 'Contact' },
    changePassword: { 'zh-CN': '修改密码', 'en-US': 'Change Password' },
    saveAccount: { 'zh-CN': '保存账号信息', 'en-US': 'Save Account' },
    changePasswordSubtitle: {
      'zh-CN': '请输入原密码，并确认两次新密码一致',
      'en-US': 'Enter the current password and confirm the new password twice',
    },
    currentPassword: { 'zh-CN': '当前密码', 'en-US': 'Current password' },
    newPassword: { 'zh-CN': '新密码', 'en-US': 'New password' },
    confirmNewPassword: { 'zh-CN': '确认新密码', 'en-US': 'Confirm new password' },
    updatePassword: { 'zh-CN': '更新密码', 'en-US': 'Update Password' },
    userManagementSubtitle: {
      'zh-CN': '管理员创建、编辑、停用系统用户和角色',
      'en-US': 'Admins create, edit, deactivate system users and roles',
    },
    newUser: { 'zh-CN': '新增用户', 'en-US': 'New User' },
    role: { 'zh-CN': '角色', 'en-US': 'Role' },
    status: { 'zh-CN': '状态', 'en-US': 'Status' },
    lastLogin: { 'zh-CN': '最后登录', 'en-US': 'Last Login' },
    createdAt: { 'zh-CN': '创建时间', 'en-US': 'Created At' },
    active: { 'zh-CN': '启用', 'en-US': 'Active' },
    inactive: { 'zh-CN': '停用', 'en-US': 'Inactive' },
    allTags: { 'zh-CN': '全部标签', 'en-US': 'All Tags' },
    password: { 'zh-CN': '密码', 'en-US': 'Password' },
    optionalPassword: { 'zh-CN': '密码（留空则不修改）', 'en-US': 'Password (leave blank to keep)' },
    createUser: { 'zh-CN': '创建用户', 'en-US': 'Create User' },
    editUser: { 'zh-CN': '编辑用户', 'en-US': 'Edit User' },
    noUsers: { 'zh-CN': '暂无用户', 'en-US': 'No users' },
    sourceFile: { 'zh-CN': 'SourceFile', 'en-US': 'SourceFile' },
    // Caption of a month picker in a page hero. It needs its own key because the generic hero label
    // rule rewrites every metric span to "SourceFile".
    monthCaption: { 'zh-CN': '月份', 'en-US': 'Month' },
    sourceFiles: { 'zh-CN': 'SourceFiles', 'en-US': 'SourceFiles' },
    resultFile: { 'zh-CN': 'Output File', 'en-US': 'Output File' },
    captableHeroEyebrow: { 'zh-CN': '股本汇总', 'en-US': 'Equity Summary' },
    captableHeroText: {
      'zh-CN': '展示月度 Capitalization Table Summary View，数据来自当前选择的输出文件。',
      'en-US': 'View the monthly Capitalization Table Summary using the selected output file.',
    },
    grantHeroEyebrow: { 'zh-CN': '授予记录', 'en-US': 'Grant Records' },
    grantHeroText: {
      'zh-CN': '展示 Futu、Shareworks 及合并后的授予明细，数据来自对应 workflow 输出文件。',
      'en-US': 'View Futu, Shareworks, and merged grant details from workflow output files.',
    },
    exerciseHeroEyebrow: { 'zh-CN': '行权记录', 'en-US': 'Exercise Records' },
    exerciseHeroText: {
      'zh-CN': '展示 Futu 全部行权记录，数据来自 Files 中的独立工作簿。',
      'en-US': 'View all Futu exercise records from the workbook stored in Files.',
    },
    soldHeroEyebrow: { 'zh-CN': '卖出记录', 'en-US': 'Sold Share Records' },
    soldHeroText: {
      'zh-CN': '展示 Futu 卖出汇总记录，数据来自 Files 中的独立工作簿。',
      'en-US': 'View Futu sold-share summary records from the workbook stored in Files.',
    },
    cancellationHeroEyebrow: { 'zh-CN': '取消记录', 'en-US': 'Cancellation Records' },
    cancellationHeroText: {
      'zh-CN': '展示取消与恢复明细，数据来自 Files 中的取消与恢复报表。',
      'en-US': 'View cancel-and-restore detail records from the report stored in Files.',
    },
    transferHeroEyebrow: { 'zh-CN': '2025年计划', 'en-US': '2025 Plan' },
    transferHeroText: {
      'zh-CN': '按月汇总归属记录；取消数量需进入 Edit 模式修改，保存后生成新输入文件并运行 workflow。',
      'en-US':
        'Summarize monthly vesting records. Edit cancellations in Edit mode; saving creates a new input file and reruns the workflow.',
    },
    employeeHeroEyebrow: { 'zh-CN': '员工管理', 'en-US': 'Employee Management' },
    employeeHeroText: {
      'zh-CN': '员工主数据由员工归集 workflow 从 ESOP 明细输入文件中生成，并支持手工补充。',
      'en-US': 'Employee master data is generated from ESOP detail workflows and can be manually supplemented.',
    },
    planHeroEyebrow: { 'zh-CN': '计划汇总', 'en-US': 'Plan Summary' },
    planHeroText: {
      'zh-CN': '按 Plan Name 聚合授予、行权、取消及 outstanding 数量。',
      'en-US': 'Aggregate grants, exercises, cancellations, and outstanding quantities by Plan Name.',
    },
    holdersHeroEyebrow: { 'zh-CN': '持股5%以上股东', 'en-US': '5% Holders' },
    holdersHeroText: {
      'zh-CN': '由 Global Parameter 手工维护的 5% holder 数字与 Capitalization Summary 分母计算生成。',
      'en-US':
        'Generated from manually maintained Global Parameter holder numbers and Capitalization Summary denominators.',
    },
    fixedHeroEyebrow: { 'zh-CN': '管理可以更改的全局参数', 'en-US': 'Manage Editable Global Parameters' },
    fixedHeroText: {
      'zh-CN': 'Data Management 下的全局参数维护页，用于管理月度流程中可由管理员调整的业务常量。',
      'en-US': 'Maintain business constants that admins can adjust in the monthly process.',
    },
    docsHeroEyebrow: { 'zh-CN': '使用手册', 'en-US': 'Docs' },
    docsHeroText: {
      'zh-CN': '系统各页面与工作流的使用说明，按主题分多篇文档。',
      'en-US': 'Usage guides for system pages and workflows, organized by topic.',
    },
    esopHeroEyebrow: { 'zh-CN': '股权明细', 'en-US': 'ESOP Detail' },
    esopHeroText: {
      'zh-CN': '股权明细的业务总入口，包含授予、行权、卖出和 2025 转富途计划四类台账。',
      'en-US': 'The ESOP detail hub for grants, exercises, sold shares, and the 2025 transfer plan.',
    },
    dataManagementHeroText: {
      'zh-CN': '数据管理业务入口，维护 5% 股东与全局参数等可由管理员调整的数据。',
      'en-US': 'Data management hub for 5% holders and global parameters.',
    },
    chooseFromFilesCenter: { 'zh-CN': '从文件中心选择', 'en-US': 'Choose from the Files Center' },
    selected: { 'zh-CN': '已选择', 'en-US': 'Selected' },
    workflowProgress: { 'zh-CN': 'Workflow 进度', 'en-US': 'Workflow progress' },
    edit: { 'zh-CN': '编辑', 'en-US': 'Edit' },
    cancel: { 'zh-CN': '取消', 'en-US': 'Cancel' },
    newEmployee: { 'zh-CN': '新增员工', 'en-US': 'New Employee' },
    manageLabels: { 'zh-CN': '标签管理', 'en-US': 'Manage Labels' },
    labelManagementTitle: { 'zh-CN': '标签管理', 'en-US': 'Label Management' },
    newTag: { 'zh-CN': '新增标签', 'en-US': 'New Tag' },
    close: { 'zh-CN': '关闭', 'en-US': 'Close' },
    link: { 'zh-CN': '关联', 'en-US': 'Link' },
    planSummarySubtitle: { 'zh-CN': '由股权授予明细聚合生成', 'en-US': 'Aggregated from equity grant detail' },
    globalParameterTitle: { 'zh-CN': '参数', 'en-US': 'Global Parameter' },
    usernameAndDisplayNameRequired: {
      'zh-CN': '账号名和显示名不能为空',
      'en-US': 'Username and display name are required',
    },
    newUserPasswordRequired: { 'zh-CN': '新用户必须设置密码', 'en-US': 'Password is required for a new user' },
    userSaved: { 'zh-CN': '用户已保存', 'en-US': 'User saved' },
    userDeleted: { 'zh-CN': '用户已删除', 'en-US': 'User deleted' },
    rawFutuGrantData: { 'zh-CN': 'Futu 授予数据原始格式', 'en-US': 'Raw Futu grant data' },
    rawOptionsOsDetail: { 'zh-CN': 'Options OS Detail 原始格式', 'en-US': 'Raw Options OS Detail data' },
    standardizedFutuShareworksMerge: {
      'zh-CN': 'Futu + Shareworks 标准化拼表',
      'en-US': 'Standardized Futu + Shareworks merge',
    },
    rawFutuBciExercises: { 'zh-CN': 'Futu BCI Exercises to Date 原始格式', 'en-US': 'Raw Futu BCI Exercises to Date' },
    unlink: { 'zh-CN': '取消关联', 'en-US': 'Unlink' },
    unlinked: { 'zh-CN': '已取消关联', 'en-US': 'Unlinked' },
    confirmDeleteUser: { 'zh-CN': '确定删除用户【{username}】吗？', 'en-US': 'Delete user {username}?' },
    managedUserSubtitleEdit: { 'zh-CN': '留空密码则不修改', 'en-US': 'Leave password blank to keep it unchanged' },
    managedUserSubtitleCreate: { 'zh-CN': '默认角色为 user', 'en-US': 'Default role is user' },
    exerciseViewShareworksSubtitle: {
      'zh-CN': 'Executive Awards OS Only 原始格式（逐授予）',
      'en-US': 'Raw Executive Awards OS Only (per grant)',
    },
    exerciseViewMergeSubtitle: {
      'zh-CN': 'Futu 行权流水 + Shareworks 逐授予拼接',
      'en-US': 'Futu exercise transactions + Shareworks per-grant rows',
    },
    transferPlanEditStatusEditing: {
      'zh-CN': '编辑模式：仅 Options cancelled/forfeited 可修改。Confirm & Run 后会生成新的输入文件并运行 workflow。',
      'en-US':
        'Edit mode: only Options cancelled/forfeited is editable. Confirm & Run creates a new input file and runs the workflow.',
    },
    transferPlanEditStatusIdle: {
      'zh-CN': '页面按最新 workflow 结果文件渲染；如需调整取消数量，请进入 Edit 后 Confirm & Run。',
      'en-US':
        'This page renders the latest workflow result file. Use Edit, then Confirm & Run to adjust cancellations.',
    },
    paginationSummaryRecords: {
      'zh-CN': '显示 {start}-{end}，共 {total} 条记录',
      'en-US': 'Showing {start}-{end} of {total} records',
    },
    paginationSummaryRecordsEmpty: { 'zh-CN': '共 0 条记录', 'en-US': '0 records' },
    paginationSummaryEmployees: {
      'zh-CN': '显示 {start}-{end}，共 {total} 名员工',
      'en-US': 'Showing {start}-{end} of {total} employees',
    },
    paginationSummaryEmployeesEmpty: { 'zh-CN': '共 0 名员工', 'en-US': '0 employees' },
    transferPlanSavingStatus: {
      'zh-CN': '正在保存编辑、生成输入文件并运行 workflow...',
      'en-US': 'Saving edits, creating an input file, and running the workflow...',
    },
    transferPlanInvalidQuantity: { 'zh-CN': '请输入有效的取消数量', 'en-US': 'Enter a valid cancellation quantity' },
    transferPlanUpdated: { 'zh-CN': 'Transfer Plan 已更新', 'en-US': 'Transfer Plan updated' },
    transferPlanUpdatedWithWarnings: {
      'zh-CN': 'Transfer Plan 已更新（包含 Warning）',
      'en-US': 'Transfer Plan updated with warnings',
    },
    transferPlanProgressSubtitle: {
      'zh-CN': '正在根据编辑内容生成新的输入文件，并运行 Transfer Plan workflow。',
      'en-US': 'Creating a new input file from your edits and running the Transfer Plan workflow.',
    },
    employeeLabelModalTitleEdit: { 'zh-CN': '编辑标签', 'en-US': 'Edit Tag' },
    employeeLabelModalTitleCreate: { 'zh-CN': '新增标签', 'en-US': 'New Tag' },
    employeesPageModalTitleEdit: { 'zh-CN': '编辑员工', 'en-US': 'Edit Employee' },
    fixedValueEditInvalid: {
      'zh-CN': '请填写参数解释并输入有效数字',
      'en-US': 'Enter a description and a valid number',
    },
    fixedValueCreateInvalid: {
      'zh-CN': '请完整填写 Key、参数解释和 Value',
      'en-US': 'Fill in Key, description and Value',
    },
    fixedValueSaved: { 'zh-CN': 'Global Parameter 已保存', 'en-US': 'Global Parameter saved' },
    fixedValueCreated: { 'zh-CN': 'Global Parameter 已新增', 'en-US': 'Global Parameter created' },
    fixedValueDeleted: { 'zh-CN': 'Global Parameter 已删除', 'en-US': 'Global Parameter deleted' },
    fixedValueDeleteConfirm: {
      'zh-CN': '确定删除 Global Parameter「{label}」吗？此操作不可撤销。',
      'en-US': 'Delete Global Parameter “{label}”? This cannot be undone.',
    },
    deleteGlobalParameter: { 'zh-CN': '删除 Global Parameter', 'en-US': 'Delete Global Parameter' },
    holdersDraftInvalid: {
      'zh-CN': '请输入大于 0 的有效数字（0 等于没填，会让 5% Holders 的持股比例算成 0%）',
      'en-US': 'Enter a valid number greater than 0 (0 means unset and would report a 0% holding)',
    },
    holdersDraftCount: {
      'zh-CN': '5% Holders 需要编辑四个全局参数',
      'en-US': 'All four 5% Holders global parameters must be edited',
    },
    holdersSavedRunning: {
      'zh-CN': 'Global Parameter 已保存，正在运行 5% Holders workflow...',
      'en-US': 'Global Parameters saved; running the 5% Holders workflow...',
    },
    holdersUpdated: { 'zh-CN': '5% Holders 更新完成', 'en-US': '5% Holders update completed' },
    accountNameRequired: { 'zh-CN': '账号名和显示名不能为空', 'en-US': 'Username and display name are required' },
    accountSaved: { 'zh-CN': '账号信息已保存', 'en-US': 'Account information saved' },
    accountPasswordIncomplete: {
      'zh-CN': '请填写当前密码、新密码和确认新密码',
      'en-US': 'Fill in the current password, the new password and its confirmation',
    },
    accountPasswordMismatch: { 'zh-CN': '两次输入的新密码不一致', 'en-US': 'The new passwords do not match' },
    accountPasswordTooShort: {
      'zh-CN': '新密码长度至少为 8 位',
      'en-US': 'The new password must be at least 8 characters',
    },
    accountPasswordUpdated: { 'zh-CN': '密码已更新', 'en-US': 'Password updated' },
    holdersUpdatedWithWarnings: {
      'zh-CN': '5% Holders 更新完成（包含 Warning）',
      'en-US': '5% Holders update completed with warnings',
    },
    employeesPageModalTitleCreate: { 'zh-CN': '新增员工', 'en-US': 'New Employee' },
    employeeUnlinkConfirm: {
      'zh-CN': '确认取消该关联？取消后该编号恢复为独立员工，不影响授予/行权/卖出等任何业务记录。',
      'en-US':
        'Unlink this identity? It becomes a standalone employee again; grant/exercise/sale records are unaffected.',
    },
    transposeTable: { 'zh-CN': '转置表格', 'en-US': 'Transpose table' },
    restoreHorizontal: { 'zh-CN': '恢复横向', 'en-US': 'Restore horizontal' },
    employeeLabelModalSubtitle: {
      'zh-CN': '先创建标签，再分配给员工；名称或颜色变更会自动影响所有员工。',
      'en-US': 'Create labels first, then assign them to employees. Name or color changes apply to all employees.',
    },
    transferPlanConfirmAndRun: { 'zh-CN': 'Transfer Plan Confirm & Run', 'en-US': 'Transfer Plan Confirm & Run' },

    placeholderSearchHolder: { 'zh-CN': '按姓名、计划、授予编号搜索...', 'en-US': 'Search by name, plan, grant...' },
    placeholderFilterHoldingsTag: { 'zh-CN': '按员工标签筛选', 'en-US': 'Filter by employee tag' },
    placeholderSearchExercises: {
      'zh-CN': '按姓名、员工、授予编号搜索...',
      'en-US': 'Search by name, employee, grant...',
    },
    placeholderSearchSoldShares: {
      'zh-CN': '按姓名、员工、账号搜索...',
      'en-US': 'Search by name, employee, account...',
    },
    placeholderSearchEmployeesPage: {
      'zh-CN': '按姓名、工号、用户 ID 搜索...',
      'en-US': 'Search by name, employee no., user id...',
    },
    placeholderFilterEmployeesPageTag: { 'zh-CN': '按标签筛选', 'en-US': 'Filter by tag' },
    placeholderAccountEmail: { 'zh-CN': 'name@example.com', 'en-US': 'name@example.com' },
    placeholderAccountPhone: { 'zh-CN': '电话或 IM', 'en-US': 'Phone or IM' },
    placeholderManagedUserUsername: { 'zh-CN': '输入登录账号', 'en-US': 'Enter login username' },
    placeholderManagedUserDisplayName: { 'zh-CN': '输入显示名', 'en-US': 'Enter display name' },
    placeholderManagedUserEmail: { 'zh-CN': 'name@example.com', 'en-US': 'name@example.com' },
    placeholderManagedUserPhone: { 'zh-CN': '电话或 IM', 'en-US': 'Phone or IM' },
    placeholderEmployeesPageNumber: {
      'zh-CN': '输入工号（新增后不可改）',
      'en-US': 'Enter employee no. (cannot be changed after creation)',
    },
    placeholderEmployeesPageName: { 'zh-CN': '输入员工姓名', 'en-US': 'Enter employee name' },
    placeholderEmployeesPageUserId: { 'zh-CN': '输入用户 ID', 'en-US': 'Enter user id' },
    placeholderEmployeesMergeTargetNumber: {
      'zh-CN': '输入目标员工的工号 / Emp. No.',
      'en-US': 'Enter target employee no. / Emp. No.',
    },
  },
  /** Page titles, keyed by page (main.ts renders the sidebar, heroes and document title from these). */
  pageTitles: {
    captable: { 'zh-CN': '股权汇总', 'en-US': 'CapTable' },
    monthly: { 'zh-CN': '月度更新', 'en-US': 'Monthly Update' },
    monthlyrun: { 'zh-CN': '月度更新', 'en-US': 'Monthly Update' },
    'esop-detail': { 'zh-CN': 'ESOP 明细', 'en-US': 'ESOP Detail' },
    'grant-record': { 'zh-CN': '授予记录', 'en-US': 'Grant Record' },
    'exercise-record': { 'zh-CN': '行权记录', 'en-US': 'Exercise Record' },
    'sold-shares': { 'zh-CN': '卖出记录', 'en-US': 'Sold Shares' },
    'cancellation-record': { 'zh-CN': '取消记录', 'en-US': 'Cancellation Records' },
    'transfer-plan': { 'zh-CN': '2025 转仓至 Futu', 'en-US': '2025 Transfer to Futu' },
    'employee-management': { 'zh-CN': '员工管理', 'en-US': 'Employee Management' },
    'plan-summary': { 'zh-CN': '计划汇总', 'en-US': 'Plan Summary' },
    'five-percent-holders': { 'zh-CN': '5% 股东', 'en-US': '5% Holders' },
    'fixed-value': { 'zh-CN': '全局参数', 'en-US': 'Global Parameter' },
    'data-management': { 'zh-CN': '数据管理', 'en-US': 'Data Management' },
    files: { 'zh-CN': '文件中心', 'en-US': 'Files' },
    workflow: { 'zh-CN': '工作流', 'en-US': 'Workflow' },
    'user-management': { 'zh-CN': '用户管理', 'en-US': 'User Management' },
    docs: { 'zh-CN': '使用手册', 'en-US': 'Docs' },
    holdings: { 'zh-CN': '持仓明细', 'en-US': 'Holdings' },
    employees: { 'zh-CN': '员工列表', 'en-US': 'Employees' },
    account: { 'zh-CN': '账号设置', 'en-US': 'Account Settings' },
    settings: { 'zh-CN': '系统设置', 'en-US': 'Settings' },
  },

  /** monthlyRunPage.ts: the Monthly Update / Monthly Run pages. */
  monthlyRun: {
    selectMonth: { 'zh-CN': '请选择月份', 'en-US': 'Please select a month' },
    codeDefined: { 'zh-CN': '代码定义', 'en-US': 'Code defined' },
    noInputDefinitions: { 'zh-CN': '暂无输入定义', 'en-US': 'No input definitions' },
    loadingSourceConfig: { 'zh-CN': '正在加载 source 配置…', 'en-US': 'Loading source configuration…' },
    configureSourcesHint: {
      'zh-CN': '请先配置每个 workflow 输入节点需要使用的源文件。',
      'en-US': 'Configure the source files required by each workflow input node first.',
    },
    notConfigured: { 'zh-CN': '未配置', 'en-US': 'Not configured' },
    notUploaded: { 'zh-CN': '未上传', 'en-US': 'Not uploaded' },
    optionalNotConfigured: { 'zh-CN': '未配置（可选）', 'en-US': 'Not configured (optional)' },
    requiredBadge: { 'zh-CN': '必须', 'en-US': 'Required' },
    optionalBadge: { 'zh-CN': '可选', 'en-US': 'Optional' },
    optionalInherit: { 'zh-CN': '可选 · 继承', 'en-US': 'Optional · Inherit' },
    optionalValidation: { 'zh-CN': '可选 · 校验', 'en-US': 'Optional · Validation' },
    optionalSupplement: { 'zh-CN': '可选 · 补充', 'en-US': 'Optional · Supplement' },
    optionalSourceHint: {
      'zh-CN': '可选输入：未提供时运行会产生 warning，批准后跳过该输入对应的修正。',
      'en-US':
        'Optional input: if omitted, the run raises a warning and skips the adjustment associated with this input after approval.',
    },
    chooseUploadedFile: { 'zh-CN': '选择已上传文件', 'en-US': 'Choose uploaded file' },
    currentFile: { 'zh-CN': '当前文件', 'en-US': 'Current file' },
    uploadNewFile: { 'zh-CN': '上传新文件', 'en-US': 'Upload new file' },
    monthlyConstantsTitle: { 'zh-CN': '月度常量', 'en-US': 'Monthly Constants' },
    collapseMonthlyConstants: { 'zh-CN': '收起月度常量', 'en-US': 'Collapse Monthly Constants' },
    expandMonthlyConstants: { 'zh-CN': '展开月度常量', 'en-US': 'Expand Monthly Constants' },
    monthlyConstantsHeaderHelp: {
      'zh-CN': '这些常量按月份保存，并参与当月 Cap Table 计算；编辑某一行只会更新该行。',
      'en-US':
        'These constants are stored per month and used by the monthly Cap Table calculation; editing a row updates only that row.',
    },
    monthlyConstantName: { 'zh-CN': '常量', 'en-US': 'Constant' },
    monthlyConstantValue: { 'zh-CN': '数值', 'en-US': 'Value' },
    monthlyConstantInvalid: {
      'zh-CN': '请填写不小于 0 的数值（0 是合法值，例如合并发生前的 Cullgen Common Stock）',
      'en-US': 'Enter a number of 0 or more (0 is a legitimate value, e.g. Cullgen Common Stock before the merger)',
    },
    monthlyConstantActions: { 'zh-CN': '操作', 'en-US': 'Actions' },
    editMonthlyConstant: { 'zh-CN': '编辑', 'en-US': 'Edit' },
    saveMonthlyConstant: { 'zh-CN': '保存', 'en-US': 'Save' },
    cancelMonthlyConstant: { 'zh-CN': '取消', 'en-US': 'Cancel' },
    monthlyConstantsSaved: { 'zh-CN': '月度常量已保存', 'en-US': 'Monthly constants saved' },
    selectSourceFile: { 'zh-CN': '选择', 'en-US': 'Select' },
    defaultSheet: { 'zh-CN': '默认 Sheet', 'en-US': 'Default Sheet' },
    fileTemplateLabel: { 'zh-CN': '文件名参考', 'en-US': 'File name pattern' },
    sheetName: { 'zh-CN': 'Sheet 名称', 'en-US': 'Sheet name' },
    sheetNameRequired: { 'zh-CN': '请填写 Sheet 名称', 'en-US': 'Enter a sheet name' },
    inputSheet: { 'zh-CN': 'Sheet', 'en-US': 'Sheet' },
    sheetSaved: { 'zh-CN': '输入 Sheet 已保存', 'en-US': 'Input sheet saved' },
    sheetSaveFailed: { 'zh-CN': '输入 Sheet 保存失败', 'en-US': 'Failed to save input sheet' },
    copy: { 'zh-CN': '复制', 'en-US': 'Copy' },
    copiedFileName: { 'zh-CN': '文件名已复制', 'en-US': 'File name copied' },
    copyFileNameFailed: { 'zh-CN': '复制文件名失败', 'en-US': 'Failed to copy file name' },
    descriptionColumn: { 'zh-CN': '说明', 'en-US': 'Notes' },
    requiredHelp: { 'zh-CN': '说明列取值含义', 'en-US': 'Notes column value meanings' },
    requiredHelpHint: {
      'zh-CN':
        'Required：必需提供，缺少时不能执行。\nOptional · Inherit：继承上一轮输出，缺少时使用系统已保存结果。\nOptional · Validation：仅用于校验，不影响核心计算。\nOptional · Supplement：补充逻辑，用于联动更新【ESOP明细】，缺少不影响 CapTable 的计算。',
      'en-US':
        'Required: must be provided or execution is blocked.\nOptional · Inherit: carries forward the prior output when no new file is provided.\nOptional · Validation: used only for validation and does not affect core calculations.\nOptional · Supplement: supplementary logic that refreshes the ESOP detail pages; the cap table still calculates without it.',
    },
    removeConfigTitle: { 'zh-CN': '删除 Uploaded file 配置', 'en-US': 'Delete Uploaded file configuration' },
    removeConfigConfirm: { 'zh-CN': '确定删除', 'en-US': 'Delete the Uploaded file configuration for' },
    removeConfigSuffix: {
      'zh-CN': '的 Uploaded file 配置吗？文件中心里的文件不会被删除。',
      'en-US': '? The file in Files will not be deleted.',
    },
    removedConfig: {
      'zh-CN': '已删除 {label} 的 Uploaded file 配置',
      'en-US': 'Deleted the Uploaded file configuration for {label}',
    },
    chooseFileFor: { 'zh-CN': '请先为', 'en-US': 'Please select a file for' },
    uploadingInputTitle: { 'zh-CN': '正在上传月度输入文件', 'en-US': 'Uploading monthly input' },
    workflowVersionMismatch: {
      'zh-CN':
        '月度更新工作流版本不匹配：前端 UI 基于 v{expected} 编写，数据库中的工作流定义为 v{actual}。请先更新数据库中的工作流定义或前端代码，使两边版本一致后再执行。',
      'en-US':
        'Monthly workflow version mismatch: this UI was built for workflow definition v{expected}, but the database holds v{actual}. Update the workflow definition (or the UI) so both versions match before running Monthly Update.',
    },
    submittingRun: { 'zh-CN': '正在提交 Monthly Update...', 'en-US': 'Submitting Monthly Update...' },
    submittedRun: { 'zh-CN': 'Monthly Update 已提交', 'en-US': 'Monthly Update submitted' },
    emptyRunState: {
      'zh-CN': '执行后会在这里显示节点状态。',
      'en-US': 'Node status will appear here after execution.',
    },
    reviewRequired: { 'zh-CN': '需人工复核', 'en-US': 'review required' },
    reviewAndContinue: { 'zh-CN': '复核并继续', 'en-US': 'Review and continue' },
    skipDownstream: { 'zh-CN': '跳过后续', 'en-US': 'Skip downstream' },
    reviewSubmitting: { 'zh-CN': '正在提交复核…', 'en-US': 'Submitting the review decision…' },
    reviewFailed: { 'zh-CN': '复核提交失败', 'en-US': 'Could not submit the review decision' },
    continuingWorkflow: { 'zh-CN': '已通过复核，正在继续执行…', 'en-US': 'Approved — continuing the workflow…' },
    skippingDownstream: { 'zh-CN': '已跳过，正在收尾…', 'en-US': 'Skipped — finishing up…' },
    showWarningDetails: { 'zh-CN': '查看告警详情', 'en-US': 'View warning details' },
    hideWarningDetails: { 'zh-CN': '收起告警详情', 'en-US': 'Hide warning details' },
    noHistory: { 'zh-CN': '暂无执行历史', 'en-US': 'No execution history' },
    fileCount: { 'zh-CN': '个文件', 'en-US': 'files' },
    noInputSnapshot: { 'zh-CN': '暂无输入快照', 'en-US': 'No input snapshot' },
    loadingHistoryRun: { 'zh-CN': '正在加载历史执行记录...', 'en-US': 'Loading historical run...' },
    historyMissingRun: {
      'zh-CN': '该历史记录没有关联 workflow 执行记录',
      'en-US': 'This history record has no workflow run attached',
    },
    historyLoadFailed: { 'zh-CN': '加载历史执行记录失败', 'en-US': 'Failed to load historical run' },
    runHistory: { 'zh-CN': '运行历史', 'en-US': 'Run history' },
    cannotDeleteRunning: {
      'zh-CN': '正在执行的记录不能删除，请等它结束',
      'en-US': 'A run that is still executing cannot be deleted; wait for it to finish',
    },
    deleteWaitingApprovalNotice: {
      'zh-CN': '该记录正在等待复核：删除会直接结束这次运行（未完成的步骤标记为跳过），不会产出结果。',
      'en-US':
        'This run is waiting for review: deleting it ends the run immediately (unfinished steps are marked skipped) and produces no output.',
    },
    deleteHistoryTitle: { 'zh-CN': '删除运行历史及输出文件', 'en-US': 'Delete run history and output file' },
    deleteHistoryConfirm: { 'zh-CN': '确定删除这条运行历史吗？', 'en-US': 'Delete this run history?' },
    outputDeleteNotice: { 'zh-CN': '对应输出文件', 'en-US': 'The output file' },
    outputDeleteNoticeSuffix: { 'zh-CN': '也会被永久删除。', 'en-US': 'will also be permanently deleted.' },
    historyDeleted: {
      'zh-CN': '运行历史及对应输出文件已删除',
      'en-US': 'Run history and corresponding output file deleted',
    },
    previewExcel: { 'zh-CN': '预览', 'en-US': 'Preview' },
    delete: { 'zh-CN': '删除', 'en-US': 'Delete' },
  },
  /** filePickerModal.ts: the shared workbook tree picker (also used by the workflow page). */
  filePicker: {
    title: { 'zh-CN': '选择文件', 'en-US': 'Select file' },
    defaultFileTitle: { 'zh-CN': '选择默认文件', 'en-US': 'Select default file' },
    fileSourceTitle: { 'zh-CN': '选择文件来源', 'en-US': 'Select file source' },
    subtitle: {
      'zh-CN': '点击选择文件，也可以上传新文件或把文件移动到其他目录。',
      'en-US': 'Click a file to select it. You can also upload a new file or move a file to another folder.',
    },
    searchPlaceholder: { 'zh-CN': '搜索文件…', 'en-US': 'Search files…' },
    upload: { 'zh-CN': '上传新文件', 'en-US': 'Upload' },
    move: { 'zh-CN': '移动', 'en-US': 'Move' },
    clear: { 'zh-CN': '不使用文件', 'en-US': 'No file' },
    cancel: { 'zh-CN': '取消', 'en-US': 'Cancel' },
    confirm: { 'zh-CN': '选择', 'en-US': 'Select' },
    moveTitle: { 'zh-CN': '移动到目录', 'en-US': 'Move to folder' },
    newFolderLabel: { 'zh-CN': '或填写新目录路径', 'en-US': 'Or enter a new folder path' },
    moveConfirm: { 'zh-CN': '确认移动', 'en-US': 'Move' },
    empty: { 'zh-CN': '暂无文件', 'en-US': 'No files' },
    noSearchResults: { 'zh-CN': '没有匹配的文件', 'en-US': 'No matching files' },
    uploadingTitle: { 'zh-CN': '正在上传文件', 'en-US': 'Uploading file' },
    invalidFolder: { 'zh-CN': '目录路径不合法', 'en-US': 'Invalid folder path' },
    sameFolder: { 'zh-CN': '文件已经在该目录中', 'en-US': 'The file already lives in that folder' },
    moved: { 'zh-CN': '文件已移动', 'en-US': 'File moved' },
    movedWorkflows: { 'zh-CN': '个工作流的引用已同步更新', 'en-US': 'workflow(s) had their references updated' },
    moveFailed: { 'zh-CN': '移动文件失败', 'en-US': 'Failed to move the file' },
    overwriteTitle: { 'zh-CN': '文件已存在', 'en-US': 'File already exists' },
    overwriteConfirm: { 'zh-CN': '覆盖', 'en-US': 'Overwrite' },
    uploadFailed: { 'zh-CN': '上传失败', 'en-US': 'Upload failed' },
    uploaded: { 'zh-CN': '文件已上传', 'en-US': 'File uploaded' },
  },
  /** filesPage.ts: the Files Center. */
  files: {
    count: { 'zh-CN': '个', 'en-US': 'items' },
    chooseFile: {
      'zh-CN': '选择左侧文件后可在页面内查看完整 Excel 工作簿。',
      'en-US': 'Select a file on the left to view the full Excel workbook here.',
    },
    noFiles: { 'zh-CN': '尚未上传任何文件', 'en-US': 'No files uploaded yet' },
    noSearchResults: { 'zh-CN': '没有匹配的文件', 'en-US': 'No matching files' },
    listView: { 'zh-CN': '列表视图', 'en-US': 'List view' },
    treeView: { 'zh-CN': '树状视图', 'en-US': 'Tree view' },
    switchToListView: { 'zh-CN': '切换到列表视图', 'en-US': 'Switch to list view' },
    switchToTreeView: { 'zh-CN': '切换到树状视图', 'en-US': 'Switch to tree view' },
    editFileName: { 'zh-CN': '编辑文件名', 'en-US': 'Edit file name' },
    downloadFile: { 'zh-CN': '下载文件', 'en-US': 'Download file' },
    deleteFile: { 'zh-CN': '删除文件', 'en-US': 'Delete file' },
    deleteSelectedFiles: { 'zh-CN': '批量删除', 'en-US': 'Delete selected' },
    moveFile: { 'zh-CN': '移动到其他目录', 'en-US': 'Move to another folder' },
    moveSelectedFiles: { 'zh-CN': '批量移动', 'en-US': 'Move selected' },
    selectedFiles: { 'zh-CN': '已选择', 'en-US': 'selected' },
    selectAllFiles: { 'zh-CN': '全选文件', 'en-US': 'Select all files' },
    deleteSelectedConfirm: {
      'zh-CN': '确定删除选中的文件吗？此操作不可撤销。',
      'en-US': 'Delete the selected files? This action cannot be undone.',
    },
    fileName: { 'zh-CN': '文件名', 'en-US': 'File name' },
    saving: { 'zh-CN': '保存中...', 'en-US': 'Saving...' },
    save: { 'zh-CN': '保存', 'en-US': 'Save' },
    edit: { 'zh-CN': '编辑', 'en-US': 'Edit' },
    cancel: { 'zh-CN': '取消', 'en-US': 'Cancel' },
    readOnlyMode: { 'zh-CN': '只读预览', 'en-US': 'Read-only preview' },
    editingMode: { 'zh-CN': '编辑中', 'en-US': 'Editing' },
    readOnlyHint: {
      'zh-CN': '预览状态不可编辑，点击「编辑」后可修改',
      'en-US': 'Preview is read-only; click Edit to make changes',
    },
    discardEditTitle: { 'zh-CN': '放弃编辑', 'en-US': 'Discard changes' },
    discardEditConfirm: { 'zh-CN': '确定放弃未保存的修改吗？', 'en-US': 'Discard unsaved changes?' },
    discardEdit: { 'zh-CN': '放弃修改', 'en-US': 'Discard' },
    saved: { 'zh-CN': '文件已保存', 'en-US': 'File saved' },
    loading: { 'zh-CN': '加载中...', 'en-US': 'Loading...' },
    loadingFile: { 'zh-CN': '正在加载文件...', 'en-US': 'Loading file...' },
    fileLoadFailed: { 'zh-CN': '文件加载失败', 'en-US': 'Failed to load file' },
    cannotOpenFile: { 'zh-CN': '无法打开该文件：', 'en-US': 'Cannot open this file: ' },
    exportUnavailable: { 'zh-CN': '当前工作簿无法导出', 'en-US': 'The current workbook cannot be exported' },
    saveFailed: { 'zh-CN': '保存失败', 'en-US': 'Save failed' },
    deleteTitle: { 'zh-CN': '删除文件', 'en-US': 'Delete file' },
    deleteConfirm: { 'zh-CN': '确定删除文件', 'en-US': 'Delete file' },
    deleteConfirmSuffix: { 'zh-CN': '吗？', 'en-US': '?' },
    emptyFileName: { 'zh-CN': '文件名不能为空', 'en-US': 'File name cannot be empty' },
    renameFailed: { 'zh-CN': '修改文件名失败', 'en-US': 'Failed to rename file' },
    updatedAt: { 'zh-CN': '更新时间', 'en-US': 'Updated' },
    createdAt: { 'zh-CN': '创建时间', 'en-US': 'Created' },
    uploadingTitle: { 'zh-CN': '正在上传文件', 'en-US': 'Uploading file' },
    savingTitle: { 'zh-CN': '正在保存文件', 'en-US': 'Saving file' },
    savingCompleted: { 'zh-CN': '保存完成', 'en-US': 'Save completed' },
  },
  /** fileMoveDialog.ts: the move-files dialog. */
  fileMove: {
    title: { 'zh-CN': '移动文件', 'en-US': 'Move files' },
    singleSubtitle: {
      'zh-CN': '选择目标目录，或填写新的目录路径。',
      'en-US': 'Pick a target folder, or enter a new folder path.',
    },
    multiSubtitle: {
      'zh-CN': '所选文件会一起移动到目标目录。',
      'en-US': 'The selected files are moved to the target folder together.',
    },
    newFolderLabel: { 'zh-CN': '或填写新目录路径', 'en-US': 'Or enter a new folder path' },
    cancel: { 'zh-CN': '取消', 'en-US': 'Cancel' },
    confirm: { 'zh-CN': '移动', 'en-US': 'Move' },
    invalidFolder: { 'zh-CN': '目录路径不合法', 'en-US': 'Invalid folder path' },
    pickFolder: { 'zh-CN': '请选择目标目录', 'en-US': 'Pick a target folder' },
    sameFolder: { 'zh-CN': '文件已经在该目录中', 'en-US': 'The files already live in that folder' },
    moved: { 'zh-CN': '个文件已移动到', 'en-US': 'file(s) moved to' },
    rewritten: { 'zh-CN': '个工作流的引用已同步更新', 'en-US': 'workflow(s) had their references updated' },
    failed: { 'zh-CN': '个文件移动失败', 'en-US': 'file(s) could not be moved' },
    moveFailed: { 'zh-CN': '移动文件失败', 'en-US': 'Failed to move the files' },
    selectedFiles: { 'zh-CN': '已选择', 'en-US': 'Selected' },
    files: { 'zh-CN': '个文件', 'en-US': 'files' },
  },
  /** workflowUpdateModal.ts: the shared "update this page" workflow modal. */
  workflowUpdateModal: {
    chooseFromFilesCenter: { 'zh-CN': '从文件中心选择', 'en-US': 'Choose from the Files Center' },
    selectFile: { 'zh-CN': '选择文件…', 'en-US': 'Select file…' },
    planSummaryRuleNote: {
      'zh-CN': '说明：仅显示 Outstanding 不为 0 的计划。',
      'en-US': 'Note: only plans with non-zero Outstanding are shown.',
    },
    workflowProgress: { 'zh-CN': 'Workflow 进度', 'en-US': 'Workflow progress' },
    selected: { 'zh-CN': '已选择', 'en-US': 'Selected' },
    pickSource: { 'zh-CN': '请选择或上传 {label}', 'en-US': 'Select or upload {label}' },
    completedWithWarnings: { 'zh-CN': 'Workflow 完成（包含 Warning）', 'en-US': 'Workflow completed with warnings' },
    updateCompleted: { 'zh-CN': 'Workflow 更新完成', 'en-US': 'Workflow update completed' },
    noResultFiles: { 'zh-CN': '当前页面没有可导出的文件', 'en-US': 'This page has no exportable files' },
    exportingFiles: { 'zh-CN': '开始导出文件', 'en-US': 'Exporting file' },
    exportingFilesPlural: { 'zh-CN': '开始导出 {count} 个文件', 'en-US': 'Exporting {count} files' },
  },
  /** uploadProgress.ts: the upload progress toast. */
  uploadProgress: {
    title: { 'zh-CN': '正在上传文件', 'en-US': 'Uploading file' },
    preparing: { 'zh-CN': '准备上传...', 'en-US': 'Preparing upload...' },
    uploading: { 'zh-CN': '正在上传...', 'en-US': 'Uploading...' },
    completed: { 'zh-CN': '上传完成', 'en-US': 'Upload completed' },
  },
  /** tour.ts / tours.ts: guided walkthroughs. */
  tour: {
    topbarLabel: {
      'zh-CN': '功能引导',
      'en-US': 'Show a walkthrough of this page',
    },
    unavailable: {
      'zh-CN': '这个页面还没有引导',
      'en-US': 'No walkthrough for this page yet',
    },
    panelTitle: {
      'zh-CN': '功能引导',
      'en-US': 'Guided walkthroughs',
    },
    start: {
      'zh-CN': '开始',
      'en-US': 'Start',
    },
    restart: {
      'zh-CN': '再看一遍',
      'en-US': 'Show again',
    },
    captableTitle: {
      'zh-CN': '股权汇总：看懂本月资本表',
      'en-US': 'Equity summary: read the monthly cap table',
    },
    captableDescription: {
      'zh-CN': '从选月份到导出，一条主线。',
      'en-US': 'From picking the month to exporting it.',
    },
    captableMonthTitle: {
      'zh-CN': '先选月份',
      'en-US': 'Pick the month first',
    },
    captableMonthBody: {
      'zh-CN': '每个月一份快照。有数据的月份会显示一个 ✓，没有快照的月份点开会是空表。',
      'en-US':
        'Each month has its own snapshot. Months with data show a ✓; a month without one opens as an empty table.',
    },
    captableReconTitle: {
      'zh-CN': '先看核对表',
      'en-US': 'Check the reconciliation first',
    },
    captableReconBody: {
      'zh-CN': 'Shares OS Reconciliation 会列出各项股数与 Control Book 的差异。有差异时先查这里，再看下面的汇总。',
      'en-US':
        'Shares OS Reconciliation lists where share counts disagree with the control book. Look here before trusting the summary below.',
    },
    captableSummaryTitle: {
      'zh-CN': '再看汇总表',
      'en-US': 'Then the summary',
    },
    captableSummaryBody: {
      'zh-CN': '15 行的资本结构：已发行股份、各类期权、Series B、认股权证，以及完全稀释后的总数与占比。',
      'en-US':
        'A 15-row capital structure: shares outstanding, options by plan, Series B, warrants, plus fully diluted totals and percentages.',
    },
    captableExportTitle: {
      'zh-CN': '导出这一份',
      'en-US': 'Export it',
    },
    captableExportBody: {
      'zh-CN': '导出的是当前月份的汇总表，可以直接发给审计或投资人。',
      'en-US': 'Exports the summary for the selected month, ready to send to auditors or investors.',
    },
    captableToMonthlyTitle: {
      'zh-CN': '要更新就去月度',
      'en-US': 'Updating? Go to the monthly run',
    },
    captableToMonthlyBody: {
      'zh-CN': '汇总表的数字来自月度运行。想刷新，就从这里跳到月度更新页。',
      'en-US': 'These numbers come from the monthly run. Use this to jump there and refresh them.',
    },
    monthlyTitle: {
      'zh-CN': '月度更新：一次跑完一个月的账',
      'en-US': 'Monthly update: close a month in one run',
    },
    monthlyDescription: {
      'zh-CN': '输入文件 → 运行 → 审批 → 结果。',
      'en-US': 'Inputs, run, approve, results.',
    },
    monthlyMonthTitle: {
      'zh-CN': '选要跑的月份',
      'en-US': 'Pick the month to run',
    },
    monthlyMonthBody: {
      'zh-CN': '月度运行以「月」为单位：产出文件名带月份后缀，记录页也按月份取快照。',
      'en-US':
        'A monthly run is per month: output files carry the month suffix and the record pages read snapshots by month.',
    },
    monthlyInputsTitle: {
      'zh-CN': '输入文件清单',
      'en-US': 'The input list',
    },
    monthlyInputsBody: {
      'zh-CN':
        '这一块是本月要读的全部输入：一行一个源。\n五列分别是输入名称、说明、已上传文件、上传时间、操作。\n下面按列逐个看。',
      'en-US':
        'Every input this month’s run reads: one row per source.\nThe five columns are input name, description, uploaded file, uploaded at and actions.\nWe take them one by one next.',
    },
    monthlyConfigureTitle: {
      'zh-CN': '配置输入源',
      'en-US': 'Configure the sources',
    },
    monthlyConfigureBody: {
      'zh-CN': '在这里为每个源选文件、选 Sheet。已绑定的源可以从历史文件里挑，不用每次重新上传。',
      'en-US':
        'Pick the file and sheet per source here. A bound source can be re-pointed at an existing file instead of uploading again.',
    },
    monthlyConstantsTitle: {
      'zh-CN': '月度常量',
      'en-US': 'Monthly constants',
    },
    monthlyConstantsBody: {
      'zh-CN': '这些数值按月保存，新月份会继承上个月，可以在运行前改。',
      'en-US': 'These values are stored per month and inherited from the previous month; adjust them before running.',
    },
    monthlyRunTitle: {
      'zh-CN': '执行',
      'en-US': 'Run it',
    },
    monthlyRunBody: {
      'zh-CN': '点这里开跑。前置校验不过会直接告诉你缺哪个源、缺文件还是缺 Sheet。',
      'en-US':
        'Starts the run. Pre-flight failures name the offending source and whether the file or the sheet is missing.',
    },
    monthlyPanelTitle: {
      'zh-CN': '看运行面板',
      'en-US': 'Watch the run',
    },
    monthlyPanelBody: {
      'zh-CN': '逐个节点显示进度。遇到需要确认的告警会停下来等你批准——那是预期行为，不是失败。',
      'en-US':
        'Progress per task. When a warning needs a decision the run pauses for approval; that is expected, not a failure.',
    },
    recordsTitle: {
      'zh-CN': '四个记录页：按月看明细',
      'en-US': 'Record pages: details by month',
    },
    recordsDescription: {
      'zh-CN': '授予 / 行权 / 卖出 / 取消，操作方式一致。',
      'en-US': 'Grants, exercises, sold shares and cancellations all work the same way.',
    },
    recordMonthTitle: {
      'zh-CN': '每月一份快照',
      'en-US': 'One snapshot per month',
    },
    recordMonthBody: {
      'zh-CN':
        '每个月一份「截至当月」的累计快照：上月快照 + 本月增量按自然键幂等合并。有数据的月份带 ✓；切到空月份会提示「暂无记录」。',
      'en-US':
        'Each month holds a cumulative snapshot through that month: the previous snapshot merged with this month’s export, deduplicated on the natural key. Months with data carry a ✓; an empty month says so.',
    },
    recordSourceTitle: {
      'zh-CN': '数据来自哪个文件',
      'en-US': 'Which file the rows come from',
    },
    recordSourceBody: {
      'zh-CN': '这里列出当前页读的源文件。没上传过该月的文件，这一页当月就是空的。',
      'en-US': 'The source files this page reads. No file for that month means an empty page for that month.',
    },
    recordViewsTitle: {
      'zh-CN': '三个视图',
      'en-US': 'Three views',
    },
    recordViewsBody: {
      'zh-CN': 'Futu / Shareworks 各自一份原始视图，Merge 是两边对齐后的合并结果。',
      'en-US': 'Futu and Shareworks each have their own raw view; Merge lines the two up.',
    },
    recordTableTitle: {
      'zh-CN': '明细表',
      'en-US': 'The detail table',
    },
    recordTableBody: {
      'zh-CN': '按姓名、工号、授予编号搜索，也能按标签过滤。',
      'en-US': 'Search by name, employee number or grant number, and filter by tag.',
    },
    recordUpdateTitle: {
      'zh-CN': '需要更新就点这里',
      'en-US': 'Update it from here',
    },
    recordUpdateBody: {
      'zh-CN': '手动更新会带上当前选中的月份，产出该月的快照——和月度运行产出的是同一种文件。',
      'en-US':
        'A manual update carries the selected month and writes that month snapshot — the same kind of file the monthly run produces.',
    },
    overviewTitle: {
      'zh-CN': '系统总览：数据从哪来、到哪去',
      'en-US': 'System overview: where the data comes from and goes',
    },
    overviewDescription: {
      'zh-CN': '一次看完五个模块的分工。',
      'en-US': 'The five modules in one pass.',
    },
    overviewNavTitle: {
      'zh-CN': '左侧是五个模块',
      'en-US': 'Five modules on the left',
    },
    overviewNavBody: {
      'zh-CN':
        '股权汇总看结果，月度更新跑数据，ESOP 明细看四个记录页。\n再往下是员工、计划与股东维度的视图。\n管理员还会多出文件中心、工作流和用户管理。',
      'en-US':
        'Equity summary shows results, the monthly run produces them, ESOP detail holds the four record pages.\nFurther down are the employee, plan and holder views.\nAdmins also get Files, Workflows and Users.',
    },
    overviewHelpTitle: {
      'zh-CN': '随时可以再看',
      'en-US': 'Replay any time',
    },
    overviewHelpBody: {
      'zh-CN': '点这个问号播当前页的引导；完整列表在使用手册页顶部。',
      'en-US':
        'This question mark replays the current page’s walkthrough; the full list is at the top of the handbook.',
    },
    monthlyCreateTitle: {
      'zh-CN': '第一步：创建月度计划',
      'en-US': 'Step one: create the month',
    },
    monthlyCreateBody: {
      'zh-CN': '先在这里新建一个月度计划，选一个月份即可。创建后该月才会出现在本列表和运行页的月份选择器里。',
      'en-US':
        'Create the month here by picking it. Only then does it appear in this list and in the run page’s month picker.',
    },
    monthlyPlansTitle: {
      'zh-CN': '计划列表',
      'en-US': 'The plan list',
    },
    monthlyPlansBody: {
      'zh-CN': '每行是一个月份的运行计划及其状态。点月份或「查看详情」进入该月的执行页，「删除」移除这条计划。',
      'en-US':
        'One row per month with its status. Open the month, or its detail button, to run it; the delete button removes the plan.',
    },
    monthlyColFileTitle: {
      'zh-CN': '第一列：输入名称',
      'en-US': 'Column 1: input name',
    },
    monthlyColFileBody: {
      'zh-CN':
        '这一列是本月要读的输入文件。\n大部分需要你从 Futu、Shareworks、Control Book 等外部系统导出后再上传进来；\n少数由系统自动带出（没有文档图标），不需要你去找。',
      'en-US':
        'These are the input files this month’s run reads.\nMost have to be exported from another system — Futu, Shareworks, the control book — and uploaded here;\nthe few the system carries over itself have no document icon.',
    },
    monthlyColDescTitle: {
      'zh-CN': '第二列：说明',
      'en-US': 'Column 2: the description',
    },
    monthlyColDescBody: {
      'zh-CN':
        '说明列由三块组成：\n· 左边：必填 / 可选徽标\n· 中间：一句话说明这份文件的用途\n· 右边：若有文档图标，点开是它期望的文件名\n下面逐个拆开看。',
      'en-US':
        'The description column holds three things:\n· left — the required / optional badge\n· middle — one sentence on what the file is for\n· right — a document icon that reveals the expected file name\nWe take them in turn.',
    },
    monthlyBadgeTitle: {
      'zh-CN': '徽标：必填还是可选',
      'en-US': 'The badge: required or optional',
    },
    monthlyBadgeBody: {
      'zh-CN':
        '「必须」缺失就跑不了；「可选」分继承、补充、校验三类，分别是系统自动带出上月基表、提供时才参与计算、补齐未反映的取消数。缺失时，对应那一步直接跳过。',
      'en-US':
        'A required source blocks the run when missing; optional ones are inherited (carried over from last month), supplementary (used only when supplied) or validation (fills in missing cancellations), and the step is skipped when its source is absent.',
    },
    monthlyPurposeTitle: {
      'zh-CN': '用途文字',
      'en-US': 'The purpose text',
    },
    monthlyPurposeBody: {
      'zh-CN': '一句话说明这份文件来自哪个系统、喂给哪一步计算，方便判断该传哪一份导出。',
      'en-US':
        'One sentence on which system the file comes from and which step consumes it, so you know which export to upload.',
    },
    monthlyTemplateTitle: {
      'zh-CN': '文档图标：文件名模板',
      'en-US': 'The document icon: name pattern',
    },
    monthlyTemplateBody: {
      'zh-CN':
        '点开显示这个输入期望的文件名样式，例如 Control_Books_Detail_Data_DD.MM.YYYY_HH.mm.xlsx。\n没有图标的行表示系统自动带出，不需要上传。',
      'en-US':
        'Opens the expected file name, e.g. Control_Books_Detail_Data_DD.MM.YYYY_HH.mm.xlsx.\nRows without the icon are supplied by the system and need no upload.',
    },
    monthlyColUploadedTitle: {
      'zh-CN': '第三列：已上传文件',
      'en-US': 'Column 3: the uploaded file',
    },
    monthlyColUploadedBody: {
      'zh-CN': '当前绑定到这一行的文件；为空表示还没选。',
      'en-US': 'The file currently bound to this row; empty means nothing is selected yet.',
    },
    monthlyUploadedCellTitle: {
      'zh-CN': '文件名与快捷操作',
      'en-US': 'File name and shortcuts',
    },
    monthlyUploadedCellBody: {
      'zh-CN': '文件名过长会截断，鼠标悬停可看全名；旁边的复制按钮直接复制文件名，方便去文件中心找同一份。',
      'en-US':
        'Long names are truncated — hover to see the full one; the copy button puts the name on the clipboard so you can find it in Files.',
    },
    monthlySheetTitle: {
      'zh-CN': 'Sheet 选择器',
      'en-US': 'The sheet selector',
    },
    monthlySheetBody: {
      'zh-CN': '同一个 Excel 常含多个 sheet。默认值来自工作流定义，选错会直接导致当月数字不对。',
      'en-US':
        'One workbook often holds several sheets. The default comes from the workflow definition; picking the wrong one silently changes the month’s numbers.',
    },
    monthlyColTimeTitle: {
      'zh-CN': '第四列：上传时间',
      'en-US': 'Column 4: uploaded at',
    },
    monthlyColTimeBody: {
      'zh-CN': '这个文件上传到系统的时间。',
      'en-US': 'When this file was uploaded.',
    },
    monthlyActionsCellTitle: {
      'zh-CN': '第五列：操作',
      'en-US': 'Column 5: actions',
    },
    monthlyActionsCellBody: {
      'zh-CN':
        '「选择」用来换文件或重选 Sheet——可以从已上传的文件里挑，也可以现场上传；「删除」只解除绑定，文件中心里的原件不受影响。',
      'en-US':
        'Select swaps the file or re-picks the sheet — choose one already uploaded or upload a new one; delete only unbinds, the file stays in Files.',
    },
    employeesTitle: {
      'zh-CN': '员工管理：记录页的主数据',
      'en-US': 'Employee management: the record pages’ master data',
    },
    employeesDescription: {
      'zh-CN': '员工、标签、来源与合并。',
      'en-US': 'People, tags, sources and merges.',
    },
    employeesSearchTitle: {
      'zh-CN': '先搜人',
      'en-US': 'Search first',
    },
    employeesSearchBody: {
      'zh-CN': '按姓名或工号搜索。记录页的姓名匹配依赖这里的员工档案。',
      'en-US': 'Search by name or employee number. The record pages match names against these profiles.',
    },
    employeesSourceTitle: {
      'zh-CN': '按来源筛',
      'en-US': 'Filter by source',
    },
    employeesSourceBody: {
      'zh-CN': '区分 Futu 与 Shareworks 导入的员工，便于核对哪一侧缺人。',
      'en-US': 'Separates Futu and Shareworks imports so you can see which side is missing someone.',
    },
    employeesTagTitle: {
      'zh-CN': '标签',
      'en-US': 'Tags',
    },
    employeesTagBody: {
      'zh-CN': '标签会带到记录页做筛选，比如「离职」「顾问」。',
      'en-US': 'Tags carry over to the record pages as filters, e.g. departed or advisor.',
    },
    employeesLabelsTitle: {
      'zh-CN': '管理标签',
      'en-US': 'Manage tags',
    },
    employeesLabelsBody: {
      'zh-CN': '这里维护标签本身（名称、颜色、增删），改完所有页面一起生效。',
      'en-US': 'Maintain the tags themselves here — name, colour, add or remove — and every page follows.',
    },
    employeesAddTitle: {
      'zh-CN': '新增员工',
      'en-US': 'Add a person',
    },
    employeesAddBody: {
      'zh-CN': '手工补录员工；也可以在这里合并重复档案（合并后编号归并，记录不丢）。',
      'en-US': 'Add someone by hand, or merge duplicate profiles here — numbers merge and no records are lost.',
    },
    employeesTableTitle: {
      'zh-CN': '员工列表',
      'en-US': 'The employee list',
    },
    employeesTableBody: {
      'zh-CN': '每行一个员工，显示编号、姓名、来源和标签；点标签可继续筛选。',
      'en-US': 'One row per person with number, name, source and tags; click a tag to filter further.',
    },
    planSummaryTitle: {
      'zh-CN': '计划汇总：按计划看期权',
      'en-US': 'Plan summary: options per plan',
    },
    planSummaryDescription: {
      'zh-CN': '授予 / 取消 / 行权 / 在外，四个数看懂每个计划。',
      'en-US': 'Granted, cancelled, exercised, outstanding — four numbers per plan.',
    },
    planSummaryMonthTitle: {
      'zh-CN': '同样按月份',
      'en-US': 'Also per month',
    },
    planSummaryMonthBody: {
      'zh-CN': '和汇总表同一个月份口径，可以互相印证。',
      'en-US': 'Same month scoping as the summary, so the two can be cross-checked.',
    },
    planSummaryFileTitle: {
      'zh-CN': '数据来自哪份输出',
      'en-US': 'Which output it reads',
    },
    planSummaryFileBody: {
      'zh-CN': '这一页读的是月度运行产出的 Plan Summary 文件。',
      'en-US': 'This page reads the Plan Summary file produced by the monthly run.',
    },
    planSummaryMetricsTitle: {
      'zh-CN': '顶部四个合计',
      'en-US': 'The four totals',
    },
    planSummaryMetricsBody: {
      'zh-CN': '计划数、累计授予、累计行权、当前在外——先看合计，再看下面的分计划明细。',
      'en-US':
        'Plan count, total granted, total exercised and current outstanding — read the totals first, then the per-plan rows.',
    },
    planSummaryTableTitle: {
      'zh-CN': '分计划明细',
      'en-US': 'Per-plan detail',
    },
    planSummaryTableBody: {
      'zh-CN': '每行一个计划；取消数会扣减在外数量，所以「授予 − 取消 − 行权 = 在外」应当成立。',
      'en-US':
        'One row per plan; cancellations reduce the outstanding, so granted − cancelled − exercised should equal outstanding.',
    },
    planSummaryToMonthlyTitle: {
      'zh-CN': '数字不对就去月度',
      'en-US': 'Wrong numbers? Go to the monthly run',
    },
    planSummaryToMonthlyBody: {
      'zh-CN': '这一页只读，要重算就跳到月度更新重跑当月。',
      'en-US': 'This page is read-only; re-run the month from the monthly page to recompute.',
    },
    holdersTitle: {
      'zh-CN': '5% 股东：披露口径',
      'en-US': '5% holders: the disclosure view',
    },
    holdersDescription: {
      'zh-CN': '与汇总表分母对齐的持股 5% 以上股东。',
      'en-US': 'Holders above 5%, aligned with the summary denominator.',
    },
    holdersWhatTitle: {
      'zh-CN': '这一页是干什么的',
      'en-US': 'What this page is for',
    },
    holdersWhatBody: {
      'zh-CN': '按 SEC 披露口径单独维护的 5% 以上股东名单，用于对外披露与交叉核对。',
      'en-US': 'A separately maintained list of holders above 5% for SEC-style disclosure and cross-checking.',
    },
    holdersTableTitle: {
      'zh-CN': '股东明细',
      'en-US': 'The holder list',
    },
    holdersTableBody: {
      'zh-CN': '每行一个股东及其持股，合计会与汇总表的分母对照。',
      'en-US': 'One row per holder with their stake; the total is checked against the summary denominator.',
    },
    holdersUpdateTitle: {
      'zh-CN': '需要更新就点这里',
      'en-US': 'Update it from here',
    },
    holdersUpdateBody: {
      'zh-CN': '手动更新会重跑这份输出；数字来源是 Global Parameter 与 Capitalization Summary。',
      'en-US':
        'A manual update re-runs the output; the numbers come from Global Parameters and the Capitalization Summary.',
    },
    overviewCaptableTitle: {
      'zh-CN': '股权汇总：一切的落点',
      'en-US': 'Equity summary: where it all lands',
    },
    overviewCaptableBody: {
      'zh-CN': '结果视图。这里的每个数字都是月度运行算出来的，不是手填的。',
      'en-US': 'The results view. Every number here is computed by a monthly run, nothing is typed by hand.',
    },
    overviewMonthlyTitle: {
      'zh-CN': '月度更新：数据的入口',
      'en-US': 'Monthly update: the way in',
    },
    overviewMonthlyBody: {
      'zh-CN': '每月在这里上传 Futu / Shareworks / Control Book 等输入并跑一次，汇总表和记录页的快照都从这次运行产出。',
      'en-US':
        'Upload the Futu / Shareworks / Control Book inputs here each month and run it; the summary and the record snapshots all come out of that run.',
    },
    overviewEsopTitle: {
      'zh-CN': 'ESOP 明细：四个记录页',
      'en-US': 'ESOP detail: four record pages',
    },
    overviewEsopBody: {
      'zh-CN': '点开是授予、行权、卖出、取消四个记录页，都能按月份翻历史快照。',
      'en-US': 'Expands into grants, exercises, sold shares and cancellations, each with per-month snapshots.',
    },
    overviewEmployeesTitle: {
      'zh-CN': '员工管理：主数据',
      'en-US': 'Employee management: master data',
    },
    overviewEmployeesBody: {
      'zh-CN': '员工、标签、关联身份都在这里维护；记录页的标签筛选和合并视图依赖它。',
      'en-US':
        'People, tags and linked identities live here; the record pages’ tag filters and merged views depend on it.',
    },
    overviewPlanTitle: {
      'zh-CN': '计划汇总：按计划看期权',
      'en-US': 'Plan summary: options per plan',
    },
    overviewPlanBody: {
      'zh-CN': '把期权按计划聚合：授予、取消、行权、在外，看每个计划还剩多少。',
      'en-US': 'Aggregates options per plan — granted, cancelled, exercised, outstanding.',
    },
    overviewHoldersTitle: {
      'zh-CN': '5% 股东：披露口径',
      'en-US': '5% holders: the disclosure view',
    },
    overviewHoldersBody: {
      'zh-CN': '按对外披露口径单独维护的 5% 以上股东，与汇总表的分母对齐。',
      'en-US': 'Holders above 5%, maintained separately to line up with the summary denominator.',
    },
    overviewAdminTitle: {
      'zh-CN': '以下是管理员的工具',
      'en-US': 'What follows is admin-only',
    },
    overviewAdminBody: {
      'zh-CN': '文件中心、工作流、用户管理只对管理员显示，用来传文件、改工作流和管账号。',
      'en-US':
        'Files, workflows and user management appear for admins only: upload files, edit workflows, manage accounts.',
    },
    navOverview: {
      'zh-CN': '总览',
      'en-US': 'Overview',
    },
    navCaptable: {
      'zh-CN': '股权汇总',
      'en-US': 'Equity summary',
    },
    navMonthly: {
      'zh-CN': '月度更新',
      'en-US': 'Monthly update',
    },
    navEsop: {
      'zh-CN': 'ESOP 明细',
      'en-US': 'ESOP detail',
    },
    navEmployees: {
      'zh-CN': '员工管理',
      'en-US': 'Employees',
    },
    navPlan: {
      'zh-CN': '计划汇总',
      'en-US': 'Plan summary',
    },
    navHolders: {
      'zh-CN': '5% 股东',
      'en-US': '5% holders',
    },
    currentPage: {
      'zh-CN': '当前页',
      'en-US': 'This page',
    },
  },
};

export type TextNamespace = keyof typeof TEXTS;

export type TextKey<N extends TextNamespace> = keyof (typeof TEXTS)[N];

type AnyEntry = Record<AppLanguage, string>;

/**
 * Reads one entry and substitutes `{name}` placeholders.
 *
 * Messages that carry a value (a username in a confirmation, a count in a summary) need this; the
 * substitution used to be a private helper in main.ts, which meant every other module either
 * duplicated the replace() call or built the sentence by concatenation.
 */
export function createTextFormatter<N extends TextNamespace>(namespace: N) {
  const read = createTexts(namespace);
  return function tp(key: TextKey<N>, params: Record<string, string | number>, language: AppLanguage): string {
    return read(key, language).replace(/\{(\w+)\}/g, (_match, name: string) => String(params[name] ?? ''));
  };
}

/** Reads one entry, falling back to Chinese (and then to the key) so a gap is visible, not blank. */
export function createTexts<N extends TextNamespace>(namespace: N) {
  const group = TEXTS[namespace] as Record<string, AnyEntry>;
  return function t(key: TextKey<N>, language: AppLanguage): string {
    const entry = group[key as string];
    return entry?.[language] ?? entry?.['zh-CN'] ?? String(key);
  };
}

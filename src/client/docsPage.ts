import { marked } from 'marked';
import type { AppLanguage } from './i18n.js';

type DomGetter = <T extends HTMLElement>(id: string) => T;

type DocsPageDeps = {
  el: DomGetter;
  getLanguage?: () => AppLanguage;
  // Returns whether the current viewer is an admin. When omitted, admin-only pages
  // are shown (used by non-role-aware callers such as tests/tooling).
  isAdmin?: () => boolean;
};

type DocPage = {
  id: string;
  title: string;
  group: string;
  summary: string;
  body: string;
  // Admin-only pages document features that are hidden from regular users
  // (Files, Workflow). They are filtered out of the manual for non-admins.
  adminOnly?: boolean;
};

// User Guide content. Authored in Markdown and rendered with `marked`; content is
// first-party (trusted), so no sanitization step is required. Screenshots live under
// `public/guide/` and are referenced by their served path, e.g. `/guide/captable.png`.
const DOC_PAGES_ZH: DocPage[] = [
  {
    id: 'overview',
    title: '这是什么系统',
    group: '快速上手',
    summary: '一分钟了解系统能做什么',
    body: `# 这是什么系统

Gyre CapTable 是一套用来管理公司股权与员工持股（ESOP）数据的系统。它把来自 Futu、Shareworks、Control Book、历史 Capitalization Summary 等来源的 Excel 表格集中管理，自动完成抽取、清洗、汇总和校验，最后在各业务页面上呈现可核对、可导出的结果。

![登录后默认进入的股权汇总页](/guide/captable.png)
*打开系统后默认进入「股权汇总（CapTable）」页面*

## 你可以用它做什么

- 每月更新一次股权数据，得到最新的股本对账与 Capitalization Summary。
- 查看授予、行权、卖出、转仓等 ESOP 明细台账。
- 维护员工主数据、计划汇总、5% 股东与全局参数。
- 上传、预览和管理所有来源与产出的 Excel 文件。

## 数据是怎么流动的

1. 在 **文件中心** 上传来源 Excel。
2. 在 **月度更新** 里选择本月要用的文件并运行。
3. 系统自动抽取数据、计算汇总、校验结果，并生成新的 Excel。
4. 授予、行权、计划汇总、5% 股东、CapTable 等页面展示最新结果。

因为每一步都基于文件和运行记录，任何一个数字都能追溯到它来自哪份文件、哪一次运行。`,
  },
  {
    id: 'navigation',
    title: '界面与导航',
    group: '快速上手',
    summary: '认识左侧菜单、顶部栏和页面地址',
    body: `# 界面与导航

系统界面分为三块：左侧菜单、顶部栏和中间的主内容区。

![左侧菜单、顶部栏与用户菜单](/guide/user-menu.png)
*左侧是业务菜单，右上角是使用手册、设置与用户菜单*

## 左侧菜单

左侧菜单是主要入口，从上到下依次是：

- **股权汇总 / 月度更新**：每月更新与最终结果。
- **ESOP 明细**：授予记录、行权记录、卖出记录、2025 转仓至 Futu 四个明细页。
- **员工管理 / 计划汇总**：员工主数据与按计划的汇总。
- **Data Management**：数据管理入口，点进去是概览页，下含 **5% 股东** 与 **全局参数（Global Parameter）** 两个子页。

如果你是管理员，左侧菜单底部还会出现 **Admin Only** 分区（文件中心、工作流、用户管理），普通用户看不到这些入口。

菜单顶部的箭头可以收起 / 展开侧边栏，腾出更多阅读空间。

## 顶部栏

顶部栏右上角有三个入口：**使用手册**（本手册）、**设置**（语言与配色）、**用户头像**（账号与退出登录）。

## 页面地址

每个页面都有独立地址，例如 \`/grant-record\`、\`/files\`、\`/workflow\`，可以直接刷新，也可以把链接分享给同事。`,
  },
  {
    id: 'quickstart',
    title: '快速开始',
    group: '快速上手',
    summary: '五步走完第一次月度更新',
    body: `# 快速开始：走完一次月度更新

如果你是第一次使用，按下面五步就能得到本月的股权汇总结果。

![月度更新页](/guide/monthly.png)
*「月度更新」页按月份管理每一次数据更新*

1. 打开左侧 **月度更新**，点击 **新建月度更新**，选择月份（例如 2026-06）。
2. 在计划列表点 **查看详情**，进入该月的运行页面。
3. 在 **Input Configuration** 里，为 Control Book、Option Plans、Futu 等来源逐项用 **选择** 挑本月文件（需要时可在「选择」弹窗里上传新文件）。
4. 点右上角 **执行**，等待系统跑完抽取、计算与校验。
5. 运行成功后，打开 **股权汇总（CapTable）** 就能看到本月的股本对账与 Capitalization Summary。

如果运行中出现提示（warning），先按提示确认或修正再继续；如果运行失败，页面会给出错误原因，据此调整输入文件后重跑即可。`,
  },
  {
    id: 'monthly-flow',
    title: '月度更新与运行',
    group: '月度主流程',
    summary: '建立月份、配置文件、运行与回退',
    body: `# 月度更新与运行

**月度更新** 是系统的主线：每个月建立一个计划，配置好本月的输入文件，运行后得到最新的股权结果。

## 月度更新列表

进入 **月度更新** 页，顶部四张卡片显示计划总数、已完成、进行中、待处理数量；下面的列表是每个月的计划，可以 **查看详情**、**删除**，或用 **新建月度更新** 建立新的月份。

## 运行页面

点某个月的 **查看详情** 进入运行页面，它分成两部分：

![月度运行的输入配置与执行状态](/guide/monthly-run.png)
*运行页面：上方配置输入文件，下方查看执行状态*

- **Input Configuration**：按来源列出每份需要的文件，带 **Required** 的是必填项，**Optional** 可以留空。每行用 **选择** 从当月 input 目录挑选文件（需要上传新文件时，也在「选择」弹窗里完成）；**Control Book Summary** 是特例，从独立的 control_book 目录选择上月产出的 base。允许覆盖 Sheet 的输入源（Control Book、Option Plans、Futu Exercises、2025 BC Subplan Transfer 等）还能指定使用哪个 Sheet，并各有合理的默认 Sheet。
- **执行状态**：点 **执行** 后，这里会实时显示每个步骤的进度、成功或失败，以及产出的文件。

## 运行记录与回退

每次运行都会保留使用的输入文件、产出文件、状态、耗时和错误信息。删除某次月度运行时，系统会清理它的产出，并让该月回到上一份可用的成功结果，方便随时追溯与纠错。`,
  },
  {
    id: 'captable',
    title: '看懂 CapTable',
    group: '月度主流程',
    summary: '股本对账与股权结构汇总',
    body: `# 看懂 CapTable

**股权汇总（CapTable）** 展示某个月的核心结果，是月度更新跑完后最常查看的页面。

![CapTable 页面](/guide/captable.png)
*CapTable：上方是股本对账，下方是股权结构汇总*

## 页面结构

- 顶部的 **月份** 选择器：切换要查看的月份。
- **股本对账（Shares OS Reconciliation）**：对齐上月余额、本月新增和期末余额。
- **股权结构汇总（Capitalization Table Summary View）**：以 fully diluted 口径展示各类股份的数量与占比。

## 更新与导出

股权结构汇总卡片右上角有两个按钮：**Update** 跳转到月度更新流程去重新生成结果；**导出** 把当前汇总导出为 Excel。

页面默认显示所选月份最新一次成功运行的结果；如果该月还没有成功结果，会自动回退到最近一份可用的结果。`,
  },
  {
    id: 'esop-detail',
    title: 'ESOP 明细',
    group: '数据页面',
    summary: '授予 / 行权 / 卖出 / 转仓四个台账',
    body: `# ESOP 明细：授予 / 行权 / 卖出 / 转仓

**ESOP 明细** 下有四个台账页面，分别展示不同类型的持股数据。它们不是手工录入表，而是由月度流程自动生成的结果页。

![授予记录页](/guide/grant-record.png)
*授予记录：可切换 Futu / Shareworks / Merge 三个视图*

| 页面 | 展示内容 |
| --- | --- |
| 授予记录 | 授予明细，可切换 Futu、Shareworks、Merge（合并对齐）三个视图 |
| 行权记录 | Futu 行权记录 |
| 卖出记录 | Futu 卖出记录 |
| 2025 转仓至 Futu | 按月份汇总的转仓数据 |

## 通用操作

授予、行权、卖出三页用法一致：

- **搜索**：按姓名、编号、用户 ID 等查找；部分页面还能按 **员工标签** 或 **激励类型** 筛选。
- **SourceFiles**：页面顶部标注了本页数据来自哪些来源文件。
- **Update / 导出**：**Update** 重新选择来源并生成最新数据；**导出** 下载当前表格。

## 2025 转仓至 Futu

![2025 转仓至 Futu 页](/guide/transfer-plan.png)
*转仓页：按月份汇总，可编辑取消数量，并可切换转置表格*

转仓页顶部用卡片汇总总量、取消 / 作废、转入 Futu 与明细条数。表格里 **Options cancelled/forfeited** 一行可以直接编辑，修改后「Transfer to Futu」会即时重算。右上角 **转置表格** 可在横向与转置视图之间切换。`,
  },
  {
    id: 'employees',
    title: '员工管理',
    group: '数据页面',
    summary: '员工主数据、标签、关联与停用',
    body: `# 员工管理

**员工管理** 维护员工主数据。员工既可以由月度流程从 Futu / Shareworks 明细中自动归集，也可以手工新增。工号（Emp. No. / employee_id）是员工的唯一业务标识，创建后不能修改。

![员工管理页](/guide/employee-management.png)
*员工管理：搜索、标签筛选，以及编辑 / 关联 / 停用操作*

## 常用操作

- **搜索与筛选**：按姓名、工号、用户 ID 搜索，或按 **标签** 过滤。
- **标签管理**：点 **标签管理** 维护标签的名称与颜色（如「董监高」「已离职」）。
- **新增 / 编辑员工**：维护姓名、用户 ID、来源、状态与标签。
- **关联 / 取消关联**：把同一个人在 Futu、Shareworks 中的不同编号关联到同一名员工。关联只维护一张映射关系，**不会改动授予、行权、卖出等业务记录**；关联之后，在授予 / 行权 / 卖出等页面搜索其中任一编号时，会自动带出这个人所有关联编号的记录，并在这些记录上标注「关联」标识。关联可随时取消，取消后各编号恢复独立、互不带出。
- **停用**：离职或作废的员工用「停用」而不是删除，以保留历史可追溯。`,
  },
  {
    id: 'plan-holders-parameters',
    title: '计划汇总、5% 股东与全局参数',
    group: '数据页面',
    summary: '按计划看、按大股东看，以及可调参数',
    body: `# 计划汇总、5% 股东与全局参数

这三个页面分别回答「按计划看」「按大股东看」和「可调整的参数」三类问题。其中 **5% 股东** 与 **全局参数** 归在左侧 **Data Management** 菜单下。

## 计划汇总

按计划名称（Plan Name）汇总授予、行权、取消和 outstanding 数量，顶部卡片给出计划数与各项总量。

![计划汇总页](/guide/plan-summary.png)
*计划汇总：按 Plan Name 聚合各项数量*

## 5% 股东

按 EDGAR SC13 的口径展示持股 5% 以上的股东。它读取 Capitalization Summary 的分母，并结合全局参数（Global Parameter）中维护的数字，计算 Common Stock、Total CSEs、% of Class 和 % Fully Diluted。

![5% 股东页](/guide/five-percent-holders.png)
*5% 股东：按 EDGAR SC13 口径展示主要股东*

## 全局参数（Global Parameter）

维护可由管理员调整的业务常量，例如 Cullgen common stock、各类期权数量等。每个参数都有 Key、数值、生效月份和维护人。

![Global Parameter 页](/guide/global-parameter.png)
*Global Parameter：管理员可维护的全局业务常量*

计划汇总和 5% 股东都是结果页：改动来源文件或参数后，用页面上的 **Update** 重新生成即可。`,
  },
  {
    id: 'files',
    title: '文件中心',
    group: '文件与工作流',
    summary: '上传、浏览、在线预览与管理文件',
    adminOnly: true,
    body: `# 文件中心

**文件中心** 是所有来源文件和产出文件的统一管理处。月度更新和工作流都从这里读取和写回文件。

![文件中心页](/guide/files.png)
*文件中心：左侧是文件目录树，右侧可在线预览工作簿*

## 左侧：文件目录

- 文件按 **input / output / control_book** 等目录分组，可展开查看。每月月度运行产出的完整 EQ Control Book base 会写到 **control_book** 目录（文件名带年月），作为下个月运行时的 base 输入。
- 顶部可 **搜索**、**刷新**、**上传**（支持 \`.xlsx\`、\`.xls\`、\`.csv\`），也可 **新建** 文件。
- 每个文件项都可以重命名或删除。

## 右侧：在线预览

点开一个文件，右侧会打开工作簿，可以逐个 Sheet 查看内容，无需下载到本地。

打开时默认是 **只读预览**，不能改动单元格；需要修改时点工作簿上方的 **编辑**，改完点 **保存** 写回文件，或点 **取消** 放弃修改。

在月度更新的输入表里点击 Uploaded file 的文件名，也会跳到这里以只读方式预览该文件。

上传后的文件会成为「产品文件」，可以在月度更新或工作流里被选作输入。`,
  },
  {
    id: 'workflow',
    title: '工作流',
    group: '文件与工作流',
    summary: '可视化流程图：读文件、转换、校验、输出',
    adminOnly: true,
    body: `# 工作流

**工作流** 把「读取文件 → 转换 → 校验 → 输出 / 写库」的处理过程画成一张可视化流程图。日常月度更新背后运行的就是这些工作流；一般用户不需要改动它们，管理员可以在这里查看和维护。

![工作流页](/guide/workflow.png)
*工作流：左侧流程列表，中间画布，右侧算子库*

## 三栏布局

- **左侧**：工作流列表，可搜索、导入、复制或新建。
- **中间**：当前工作流的画布，展示各个节点（算子）如何连接，可 **执行**、**导出**、**保存**、**删除**。
- **右侧**：算子库，列出可用的处理节点，点 **Details** 查看每个算子的说明。

## 算子分工

不同算子各司其职：输入类算子从 Excel 抽取数据，计算类（SQL 等）算子做转换，校验类算子在异常时给出 warning 或直接拦截，输出类算子生成 Excel 或写回数据库。部分算子支持 **预览**，预览只看中间结果，不会写库或产出最终文件。`,
  },
  {
    id: 'settings',
    title: '语言、配色与账号',
    group: '设置',
    summary: '切换中英文、配色方案与账号',
    body: `# 语言、配色与账号

## 界面语言

顶部栏的 **设置** 里可以切换 **中文 / English**，整个界面（包括本手册）会立即跟随切换。表格中的许多字段名保留英文，是为了和来源 Excel、对外交付文件保持一致。

![系统设置页](/guide/settings.png)
*设置页：切换界面语言与配色方案*

## 配色

同样在 **设置** 里，可以选择 Blue、Teal、Amber 等配色方案，改变界面主色调。

## 账号

点右上角 **用户头像** 打开菜单，可进入 **账号** 页维护资料，或 **退出登录**。`,
  },
];

const DOC_PAGES_EN: DocPage[] = [
  {
    id: 'overview',
    title: 'What This System Does',
    group: 'Getting Started',
    summary: 'A one-minute overview of the system',
    body: `# What This System Does

Gyre CapTable is a system for managing a company's equity and employee stock (ESOP) data. It centralizes source Excel workbooks from Futu, Shareworks, Control Book, and prior Capitalization Summary files, automatically extracts, cleans, aggregates, and validates the data, and presents auditable, exportable results across the business pages.

![The Cap Table page shown right after opening the app](/guide/en/captable.png)
*Opening the app lands you on the CapTable page*

## What you can do with it

- Run a monthly equity update to get the latest shares reconciliation and Capitalization Summary.
- Review ESOP ledgers: grants, exercises, sold shares, and transfers.
- Maintain employee master data, plan summaries, 5% holders, and global parameters.
- Upload, preview, and manage every source and output workbook.

## How data flows

1. Upload source workbooks in **Files**.
2. In **Monthly Updates**, pick this month's files and run.
3. The system extracts data, computes summaries, validates results, and generates new Excel files.
4. Grant, exercise, plan summary, 5% holders, and CapTable pages show the latest results.

Because every step is based on files and run records, any number can be traced back to the file and the run it came from.`,
  },
  {
    id: 'navigation',
    title: 'Interface and Navigation',
    group: 'Getting Started',
    summary: 'The sidebar, top bar, and page URLs',
    body: `# Interface and Navigation

The interface has three parts: the left menu, the top bar, and the main content area.

![The sidebar, top bar, and user menu](/guide/en/user-menu.png)
*The left side is the business menu; the top-right holds Docs, Settings, and the user menu*

## Left menu

The left menu is the main navigation, from top to bottom:

- **CapTable / Monthly Updates**: monthly runs and final results.
- **ESOP Detail**: the Grant Record, Exercise to Date, Sold Shares, and 2025 Transfer to Futu pages.
- **Employee Management / Plan Summary**: employee master data and by-plan rollups.
- **Data Management**: a hub page whose children are **5% Holders** and **Global Parameter**.

If you are an administrator, an **Admin Only** section (Files, Workflow, User Management) also appears at the bottom of the left menu; regular users don't see these entries.

The arrow at the top of the menu collapses or expands the sidebar.

## Top bar

The top-right of the bar has three entries: **Docs** (this guide), **Settings** (language and theme), and the **user avatar** (account and logout).

## Page URLs

Every page has its own URL, such as \`/grant-record\`, \`/files\`, or \`/workflow\`, so pages can be refreshed or shared with colleagues.`,
  },
  {
    id: 'quickstart',
    title: 'Quick Start',
    group: 'Getting Started',
    summary: 'Run your first monthly update in five steps',
    body: `# Quick Start: Run a Monthly Update

If this is your first time, these five steps produce this month's equity results.

![The Monthly Updates page](/guide/en/monthly.png)
*The Monthly Updates page manages each data update by month*

1. Open **Monthly Updates**, click **New Monthly Update**, and pick a month (for example 2026-06).
2. In the plan list, click **View Details** to open that month's run page.
3. Under **Input Configuration**, use **Select** to pick this month's file for each source (Control Book, Option Plans, Futu, and so on); upload a new file inside the picker when needed.
4. Click **Run** in the top-right and wait for extraction, computation, and validation to finish.
5. Once the run succeeds, open **CapTable** to see this month's shares reconciliation and Capitalization Summary.

If a warning appears during the run, review and confirm or fix it before continuing. If the run fails, the page shows the reason so you can adjust the inputs and re-run.`,
  },
  {
    id: 'monthly-flow',
    title: 'Monthly Updates and Runs',
    group: 'Monthly Process',
    summary: 'Create a month, configure files, run, and roll back',
    body: `# Monthly Updates and Runs

**Monthly Updates** is the system's main line: each month you create a plan, configure its input files, and run it to get the latest equity results.

## The updates list

On the **Monthly Updates** page, four cards at the top show the total, completed, in-progress, and pending plan counts. Below is the list of monthly plans, where you can **View Details**, **Delete**, or use **New Monthly Update** to add a month.

## The run page

Clicking a month's **View Details** opens the run page, which has two parts:

![The Monthly Run input configuration and execution status](/guide/en/monthly-run.png)
*The run page: configure input files above, watch execution status below*

- **Input Configuration**: lists each required file by source; **Required** items are mandatory and **Optional** ones may be left empty. Each row's **Select** picks a file from the current month's input folder (uploading a new file happens inside the picker); **Control Book Summary** is the exception and is picked from the dedicated control_book folder (last month's produced base). Sources that allow a sheet override (Control Book, Option Plans, Futu Exercises, 2025 BC Subplan Transfer) can also choose which sheet to use, each with a sensible default sheet.
- **Execution status**: after you click **Run**, this shows each step's progress, success or failure, and the files produced, in real time.

## Run history and rollback

Every run keeps its input files, output files, status, duration, and error messages. When you delete a monthly run, the system cleans up its output and lets the month fall back to the previous successful result, so you can always trace and correct.`,
  },
  {
    id: 'captable',
    title: 'Reading the CapTable',
    group: 'Monthly Process',
    summary: 'Shares reconciliation and the summary view',
    body: `# Reading the CapTable

**CapTable** shows a month's core results and is the page you'll open most after a monthly update finishes.

![The CapTable page](/guide/en/captable.png)
*CapTable: shares reconciliation on top, ownership summary below*

## Page layout

- The **month** selector at the top switches which month you view.
- **Shares OS Reconciliation**: aligns last month's balance, new shares, and the ending balance.
- **Capitalization Table Summary View**: shows each share class's quantity and percentage on a fully diluted basis.

## Update and export

The ownership summary card has two buttons in its top-right: **Update** jumps to the monthly update flow to regenerate results, and **Export** downloads the current summary as Excel.

The page defaults to the latest successful run for the selected month; if the month has no successful result yet, it falls back to the most recent available result.`,
  },
  {
    id: 'esop-detail',
    title: 'ESOP Detail',
    group: 'Data Pages',
    summary: 'Grant, exercise, sold-share, and transfer ledgers',
    body: `# ESOP Detail: Grants / Exercises / Sold Shares / Transfers

**ESOP Detail** contains four ledger pages, each showing a different type of holding data. They are not manual entry tables — they are result pages generated automatically by the monthly process.

![The Grant Record page](/guide/en/grant-record.png)
*Grant Record: switch between the Futu, Shareworks, and Merge views*

| Page | Content |
| --- | --- |
| Grant Record | Grant details, with Futu, Shareworks, and Merge (normalized) views |
| Exercise to Date | Futu exercise records |
| Sold Shares | Futu sold-share records |
| 2025 Transfer to Futu | Transfer data summarized by month |

## Common actions

The grant, exercise, and sold-share pages work the same way:

- **Search**: find records by name, number, or user ID; some pages also filter by **employee label** or **incentive type**.
- **SourceFiles**: the top of the page shows which source files this page's data came from.
- **Update / Export**: **Update** reselects sources and regenerates the data; **Export** downloads the current table.

## 2025 Transfer to Futu

![The 2025 Transfer to Futu page](/guide/en/transfer-plan.png)
*Transfer page: summarized by month, editable cancellation quantity, and a transpose toggle*

The transfer page summarizes totals, cancellations/forfeitures, transfers to Futu, and detail record counts in cards at the top. The **Options cancelled/forfeited** row in the table is editable — changing it recalculates "Transfer to Futu" instantly. The **Transpose** button in the top-right switches between the horizontal and transposed views.`,
  },
  {
    id: 'employees',
    title: 'Employee Management',
    group: 'Data Pages',
    summary: 'Employee master data, labels, linking, deactivation',
    body: `# Employee Management

**Employee Management** maintains the employee master list. Employees can be collected automatically from Futu / Shareworks details by the monthly process, or added manually. The employee number (Emp. No. / employee_id) is the unique business identifier and cannot be changed after creation.

![The Employee Management page](/guide/en/employee-management.png)
*Employee Management: search, label filter, and edit / link / deactivate actions*

## Common actions

- **Search and filter**: search by name, employee number, or user ID, or filter by **label**.
- **Manage labels**: click **Manage Labels** to maintain label names and colors (such as "Director/Officer" or "Departed").
- **Add / edit employee**: maintain name, user ID, source, status, and labels.
- **Link / Unlink**: link the different Futu and Shareworks identifiers that belong to the same person. Linking only maintains a mapping and **does not touch grant, exercise, or sold-share records**; once linked, searching any one identifier on the grant / exercise / sold-share pages surfaces the records of every linked identifier of that person, each marked with a "Linked" badge. A link can be undone at any time, after which the identifiers are independent again.
- **Deactivate**: departed or invalid employees are deactivated rather than deleted, preserving traceability.`,
  },
  {
    id: 'plan-holders-parameters',
    title: 'Plan Summary, 5% Holders, and Global Parameter',
    group: 'Data Pages',
    summary: 'By plan, by major holder, and adjustable parameters',
    body: `# Plan Summary, 5% Holders, and Global Parameter

These three pages answer three questions: "by plan," "by major holder," and "which parameters can be adjusted." **5% Holders** and **Global Parameter** live under the **Data Management** menu.

## Plan Summary

Aggregates grants, exercises, cancellations, and outstanding quantities by Plan Name, with plan counts and totals in the cards at the top.

![The Plan Summary page](/guide/en/plan-summary.png)
*Plan Summary: quantities aggregated by Plan Name*

## 5% Holders

Shows shareholders above the 5% threshold in EDGAR SC13 style. It reads denominators from the Capitalization Summary and combines them with the numbers maintained in Global Parameter to compute Common Stock, Total CSEs, % of Class, and % Fully Diluted.

![The 5% Holders page](/guide/en/five-percent-holders.png)
*5% Holders: major shareholders in EDGAR SC13 style*

## Global Parameter

Maintains admin-adjustable business constants, such as Cullgen common stock and various option counts. Each parameter has a Key, value, effective month, and the person who maintained it.

![The Global Parameter page](/guide/en/global-parameter.png)
*Global Parameter: global business constants that admins can maintain*

Plan Summary and 5% Holders are result pages: after changing source files or parameters, use **Update** on the page to regenerate.`,
  },
  {
    id: 'files',
    title: 'Files',
    group: 'Files & Workflow',
    summary: 'Upload, browse, preview, and manage files',
    adminOnly: true,
    body: `# Files

**Files** is the single place that manages all source and output workbooks. Both Monthly Updates and Workflow read from and write back to it.

![The Files page](/guide/en/files.png)
*Files: a folder tree on the left, an in-browser workbook preview on the right*

## Left: the folder tree

- Files are grouped into folders like **input / output / control_book** that you can expand. Each month's full EQ Control Book base is written to the **control_book** folder (the file name carries the year-month) to serve as next month's base input.
- The top lets you **search**, **refresh**, and **upload** (\`.xlsx\`, \`.xls\`, \`.csv\`), or **create** a new file.
- Each file can be renamed or deleted.

## Right: in-browser preview

Open a file to view its workbook on the right, inspecting each sheet without downloading it.

Files open as a **read-only preview**, so cells cannot be changed. To make changes, click **Edit** above the workbook, then **Save** to write them back, or **Cancel** to discard them.

Clicking an uploaded file name in a Monthly Updates input table also jumps here and previews that file read-only.

Uploaded files become "product files" that can be selected as inputs in Monthly Updates or Workflow.`,
  },
  {
    id: 'workflow',
    title: 'Workflow',
    group: 'Files & Workflow',
    summary: 'The visual pipeline behind the monthly process',
    adminOnly: true,
    body: `# Workflow

**Workflow** draws the "read file → transform → validate → output / write database" process as a visual pipeline. These workflows are what run behind the daily monthly updates; regular users don't need to change them, but administrators can view and maintain them here.

![The Workflow page](/guide/en/workflow.png)
*Workflow: the pipeline list on the left, the canvas in the center, the operator library on the right*

## Three-column layout

- **Left**: the workflow list, which you can search, import, copy, or create.
- **Center**: the current workflow's canvas, showing how the nodes (operators) connect, with **Run**, **Export**, **Save**, and **Delete**.
- **Right**: the operator library, listing available processing nodes; click **Details** for each operator's description.

## What operators do

Each operator has a role: input operators extract data from Excel, compute operators (SQL and others) transform it, assert operators warn or block on anomalies, and output operators generate Excel or write back to the database. Some operators support **Preview**, which shows intermediate results only and does not write to the database or produce final files.`,
  },
  {
    id: 'settings',
    title: 'Language, Theme, and Account',
    group: 'Settings',
    summary: 'Switch language, theme, and manage your account',
    body: `# Language, Theme, and Account

## Interface language

The **Settings** entry in the top bar switches between **中文 / English**, and the whole interface — including this guide — follows immediately. Many table field names stay in English to stay aligned with source Excel and external deliverables.

![The Settings page](/guide/en/settings.png)
*Settings: switch the interface language and color theme*

## Theme

Also in **Settings**, you can choose a color theme such as Blue, Teal, or Amber to change the interface's accent color.

## Account

Click the **user avatar** in the top-right to open the menu, where you can open the **Account** page to maintain your profile, or **log out**.`,
  },
];

const DOC_GROUP_ORDER: Record<AppLanguage, string[]> = {
  'zh-CN': ['快速上手', '月度主流程', '数据页面', '文件与工作流', '设置'],
  'en-US': ['Getting Started', 'Monthly Process', 'Data Pages', 'Files & Workflow', 'Settings'],
};

// Pure selector: the doc pages a viewer should see, filtered by role. Regular
// (non-admin) users never see admin-only pages such as Files and Workflow.
export function visibleDocPages(language: AppLanguage, isAdmin: boolean): DocPage[] {
  const pages = language === 'en-US' ? DOC_PAGES_EN : DOC_PAGES_ZH;
  return isAdmin ? pages : pages.filter((doc) => !doc.adminOnly);
}

export function createDocsPage({ el, getLanguage, isAdmin }: DocsPageDeps) {
  const language = () => (getLanguage?.() === 'en-US' ? 'en-US' : 'zh-CN');
  const docs = () => visibleDocPages(language(), isAdmin?.() ?? true);
  const groupOrder = () => DOC_GROUP_ORDER[language()];
  let activeDocId = docs()[0]?.id ?? '';

  function renderNav() {
    const pages = docs();
    if (!pages.some((doc) => doc.id === activeDocId)) {
      activeDocId = pages[0]?.id ?? '';
    }
    const groups = groupOrder().filter((group) => pages.some((doc) => doc.group === group));
    el('docNav').innerHTML = groups
      .map((group) => {
        const items = pages.filter((doc) => doc.group === group)
          .map(
            (doc) => `
            <button type="button" class="doc-nav__item${doc.id === activeDocId ? ' is-active' : ''}" data-doc="${doc.id}">
              <span class="doc-nav__title">${doc.title}</span>
              <span class="doc-nav__summary">${doc.summary}</span>
            </button>`,
          )
          .join('');
        return `<div class="doc-nav__group"><div class="doc-nav__label">${group}</div>${items}</div>`;
      })
      .join('');

    el('docNav')
      .querySelectorAll<HTMLElement>('[data-doc]')
      .forEach((button) =>
        button.addEventListener('click', () => {
          const id = button.dataset.doc;
          if (id) selectDoc(id);
        }),
      );
  }

  function renderContent() {
    const pages = docs();
    const doc = pages.find((item) => item.id === activeDocId) ?? pages[0];
    if (!doc) return;
    const html = marked.parse(doc.body, { async: false }) as string;
    el('docContent').innerHTML = `<div class="doc-article">${html}</div>`;
    el('docContent').scrollTop = 0;
  }

  function selectDoc(id: string) {
    activeDocId = id;
    el('docNav')
      .querySelectorAll<HTMLElement>('[data-doc]')
      .forEach((button) => button.classList.toggle('is-active', button.dataset.doc === id));
    renderContent();
  }

  function render() {
    renderNav();
    renderContent();
  }

  return { render };
}

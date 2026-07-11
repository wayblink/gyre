import { marked } from 'marked';

type DomGetter = <T extends HTMLElement>(id: string) => T;

type DocsPageDeps = {
  el: DomGetter;
};

type DocPage = {
  id: string;
  title: string;
  group: string;
  summary: string;
  body: string;
};

// User Guide content. Authored in Markdown and rendered with `marked`; content is
// first-party (trusted), so no sanitization step is required.
const DOC_PAGES: DocPage[] = [
  {
    id: 'overview',
    title: '系统概览',
    group: '入门',
    summary: '产品是做什么的、整体结构',
    body: `# 系统概览

CapTable Equity Management 是一套**股权/期权（ESOP）管理系统**，把来自 Futu、Shareworks 等来源的明细数据汇集、对账，生成月度 Capitalization Summary，并维护员工、计划、5% 股东等业务主数据。

## 三层结构

| 层 | 作用 | 对应页面 |
| --- | --- | --- |
| 业务数据 | 查看/维护各类明细与主数据 | Captable、ESOP Detail、Employee Management、Plan Summary、5% Holders、Fixed Value |
| 流程 | 月度更新与工作流编排 | Monthly Updates、Workflow |
| 工具 | 文件管理、系统设置 | Files、Settings |

> **提示：** 左侧导航按上面的分组排列；带缩进的是子页面（如 ESOP Detail 下的 Grant Record / Exercise / Sold Shares / Transfer）。

## 数据从哪来

系统的员工与授予明细来自两套外部系统：

- **Futu（富途）**：中文姓名 + 工号（如 \`K00385\`），涵盖授予、行权、出售等明细。
- **Shareworks**：英文姓名 + SW 号（如 \`100010\`）。

同一个人在两边号码不同、姓名语言不同，通过「关联」在员工主数据里连成一个人。详见 [数据模型](#) 一节。`,
  },
  {
    id: 'navigation',
    title: '导航与登录',
    group: '入门',
    summary: '如何在页面间跳转、当前登录状态',
    body: `# 导航与登录

## 页面导航

左侧边栏列出所有页面，点击即可切换；地址栏会同步成 \`/<页面>\`（例如 \`/five-percent-holders\`），可直接收藏或分享链接。顶部标题会显示当前页面名称。

侧边栏可以用左上角的折叠按钮收起，给内容区腾出空间。

## 登录状态

> **开发期说明：** 登录功能当前**临时禁用**，打开即以「Developer」身份进入，无需账号密码。

产品成熟后，把服务端环境变量 \`AUTH_DISABLED=false\` 后重启即可恢复登录：届时会出现登录页、会话校验与账户管理。此开关不改动任何业务代码。`,
  },
  {
    id: 'captable',
    title: 'Captable',
    group: '页面指南',
    summary: '期末对账与 Capitalization Summary',
    body: `# Captable

Captable 是系统的汇总视图，展示某个月末（EOM）的：

- **Shares OS Reconciliation**：期初、本期新增、期末余额的对账。
- **Capitalization Table (Summary View)**：完全稀释口径下各类股本/激励的份额与占比。

页面顶部可切换月份与 Capitalization 的来源文件。数据由月度工作流计算生成（见 [Monthly Updates](#) 与 [工作流](#)）。`,
  },
  {
    id: 'monthly',
    title: 'Monthly Updates',
    group: '页面指南',
    summary: '月度更新计划与运行',
    body: `# Monthly Updates

月度更新页管理每个月的数据更新计划（Update Plan）及其运行历史。

## 典型流程

1. 选择/新建当月计划，上传当月来源文件（EQ Control Book、Futu Exercises、Option Plans Summary 等）。
2. 触发月度工作流运行；系统按算子链提取 → 计算 → 校验 → 产出。
3. 校验项若命中差异会以 **warning** 形式要求人工确认（如 1 股差异的 transfer 决策）。
4. 运行成功后产出 Capitalization Summary，供 Captable 页查看。

每次运行都会记录在运行历史中，包含来源文件、产出文件、状态与耗时。`,
  },
  {
    id: 'esop-detail',
    title: 'ESOP Detail',
    group: '页面指南',
    summary: 'Grant / Exercise / Sold / Transfer 明细',
    body: `# ESOP Detail

ESOP Detail 下有四个明细子页，都是文件驱动、可搜索、可分页：

| 子页 | 内容 |
| --- | --- |
| **Grant Record** | 授予记录，含 Futu / Shareworks / Merge 三个视图 |
| **Exercise to Date** | 累计行权明细 |
| **Sold Shares** | 出售明细 |
| **2025 Transfer to Futu** | 按期次的转移汇总，取消数可人工编辑 |

Grant Record 的 **Merge** 视图把 Futu 与 Shareworks 授予按统一列口径合并展示，便于跨来源核对。`,
  },
  {
    id: 'employees',
    title: 'Employee Management',
    group: '页面指南',
    summary: '员工主数据、来源、关联',
    body: `# Employee Management

员工主数据是一份**只进不出**的名单。

## 关键概念

- **Emp. No.（工号）= employee_id**：来自明细文件的业务键（Futu 工号 / SW 号），是员工的身份。系统内部另有一个无意义的自增 id 仅作技术主键。
- **Source**：标明该行来自 \`futu\` / \`shareworks\` / 手工。
- **Linked（关联标识）**：被「关联」并入本人的其他行（例如同一个人的 Shareworks 英文名条目）。

## 常用操作

| 操作 | 说明 |
| --- | --- |
| 排序 | 点 Employee Name / Emp. No. 表头可升降序 |
| 分页 | 支持每页 20 / 50 / 100，含首页/末页 |
| 新增 | 手工新增**必须填工号**；工号重复会拦截 |
| 编辑 | 姓名/标签可改，工号（键）不可改 |
| 关联 | 把当前行并入目标工号所属员工，用于打通 Futu / SW 同一人 |
| 停用 | 只进不出，用停用代替删除 |

> **为什么要关联？** 同一个人在 Futu 是中文名+工号、在 Shareworks 是英文名+SW 号，号码不同。导入时两边各自成行，用「关联」把它们认定为同一个人。`,
  },
  {
    id: 'plan-summary',
    title: 'Plan Summary',
    group: '页面指南',
    summary: '按计划汇总授予与行权',
    body: `# Plan Summary

按激励计划（Plan）汇总统计：授予数、已行权、已取消、Outstanding 等，并给出总计。用于快速掌握各计划的池子使用情况。`,
  },
  {
    id: 'five-percent',
    title: '5% Holders',
    group: '页面指南',
    summary: 'EDGAR SC13 口径的 5% 以上股东',
    body: `# 5% Holders

展示持股 5% 以上股东，数据来自 Gyre Cap Table 工作簿的「5% Holders」sheet（EDGAR SC13 申报口径）。

顶部卡片给出上下文：**As of** 日期、**Fully Diluted** 总数、**Common Stock OS**。表格逐行列出：

- Shareholder（股东）
- Common Stock（普通股）
- Total CSEs（普通股等价物合计）
- % of Class（占本类比例）
- % Fully Diluted（占完全稀释比例）
- SC13 Filing（申报文件与链接备注）

底部高亮行为 **Total >5%** 汇总。`,
  },
  {
    id: 'fixed-value',
    title: 'Fixed Value',
    group: '页面指南',
    summary: '月度流程中的可调常量',
    body: `# Fixed Value

维护月度计算中由管理员调整的业务常量（固定值），例如 Cullgen 的期权 outstanding / available 等。每条含 Key、Item、Value、生效起始与更新人，可编辑。这些值会被月度工作流的计算节点引用。`,
  },
  {
    id: 'workflows',
    title: '工作流与算子',
    group: '工作流',
    summary: '编排数据处理的可视化流程',
    body: `# 工作流与算子

工作流（Workflow）把「读文件 → 转换 → 校验 → 产出/写库」编排成一张可视化的算子图。每个节点是一个**通用算子**，通过配置复用，无需写代码。

## 算子类别

| 类别 | 算子 | 作用 |
| --- | --- | --- |
| 输入 | \`sheet.range.extract\` / \`sheet.sections.extract\` | 从 Excel 指定 sheet/范围提取 dataframe |
| 计算 | \`sql.compute\` | 把上游 dataframe 绑成表跑只读 SQL |
| 计算 | \`dataframe.union\` | 多个 dataframe 按列名对齐纵向合并 |
| 断言 | \`dataframe.assert\` / \`.sql.assert\` / \`.schema.assert\` / \`.shape.assert\` | 对数据做校验（block / warning） |
| 输出 | \`dataframe.persist.excel\` | 把结果落成 Excel 文件 |
| 数据库 | \`db.upsert\` | 按冲突键把 dataframe UPSERT 进白名单业务表 |

> **db.upsert 的安全边界：** 只能写服务端白名单里的表、必须指定冲突键、预览不写库。这样工作流才能安全地把数据写回业务库。

节点之间用输入槽连接；SQL/Union 之类算子可接多个上游。运行时可对某个节点做预览（不产生副作用），也可整流程执行。`,
  },
  {
    id: 'employee-import',
    title: '员工归集工作流',
    group: '工作流',
    summary: '换文件即幂等重导员工',
    body: `# 员工归集工作流（employee-import）

这是一条已内置的工作流，演示「换文件 → 重新归集进 employees 表」全部用通用算子实现：

\`\`\`text
Extract Futu 授予记录 ─┐
                       ├─ 各自 sql.compute 规范成 (employee_id, source, employee_name)
Extract Shareworks ────┘
        → dataframe.union（按列名对齐合并）
        → db.upsert employees（on conflict(employee_id)）
\`\`\`

## 用法

1. 在 **Files** 上传新的 Futu 授予报表 / Shareworks Cap Table。
2. 打开 **Workflow**，选择 \`Employee Import / 员工归集\`。
3. 把两个文件输入（\`fileRefs.futu_grants\` / \`fileRefs.shareworks\`）指向刚上传的文件，运行。

> **幂等：** 相同工号重跑只更新、不重复建行；新工号才插入。跨来源同人仍由 Employee Management 里的「关联」处理。`,
  },
  {
    id: 'files',
    title: 'Files',
    group: '工作流',
    summary: '上传与预览工作簿',
    body: `# Files

Files 页用于上传、预览、下载工作簿文件。上传后的文件成为 **product file**，可被工作流作为输入引用（通过运行时的 \`fileRefs\`）。支持在线预览表格内容。`,
  },
  {
    id: 'data-model',
    title: '数据模型与关联',
    group: '参考',
    summary: '员工身份、工号、关联/墓碑',
    body: `# 数据模型与关联

## 员工身份

- 身份键是 **employee_id（工号）**，直接来自明细文件，有业务含义。
- Futu 与 Shareworks 各用自己的号，各自成行；同一个人跨来源用「关联」连接。
- 数据库自增 \`id\` 只是技术主键，不对外体现。

## 关联（Merge）与墓碑

「关联」把 B 员工并入 A：B 的授予（grants）重指到 A，B 被标记为 \`merged_into\` 墓碑并停用（**只进不出**，不物理删除）。列表默认隐藏墓碑；A 的「Linked」列会列出被并入的其他标识。

## 只进不出

员工、关联都遵循「只进不出」：不做物理删除，用停用 / 墓碑保留可追溯性。`,
  },
];

const DOC_GROUP_ORDER = ['入门', '页面指南', '工作流', '参考'];

export function createDocsPage({ el }: DocsPageDeps) {
  let activeDocId = DOC_PAGES[0]?.id ?? '';
  let built = false;

  function renderNav() {
    const groups = DOC_GROUP_ORDER.filter((group) => DOC_PAGES.some((doc) => doc.group === group));
    el('docNav').innerHTML = groups
      .map((group) => {
        const items = DOC_PAGES.filter((doc) => doc.group === group)
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
    const doc = DOC_PAGES.find((item) => item.id === activeDocId) ?? DOC_PAGES[0];
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
    if (!built) {
      renderNav();
      built = true;
    }
    renderContent();
  }

  return { render };
}

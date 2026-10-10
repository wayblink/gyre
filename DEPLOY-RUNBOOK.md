# 云端部署执行手册

> 面向在云上执行部署的 agent。本文自包含：每条命令都可直接复制运行，每个破坏性操作前都有检查点。
> **不要跳过第 1 节的安全边界。** 遇到「停下来报告」的条件时，停下来，把输出原样贴回给需求方，不要自行决定继续。

- 适用代码版本：`feat/esop-workflows-docs-deploy` 分支 HEAD（见第 9 节）
- 部署形态：Fastify + 打包前端 + Postgres，单容器（Dockerfile 两阶段构建）
- 云上编排：`docker-compose.prod.yml`（app + postgres + Caddy 反代网）

---

## 0. 一分钟背景（为什么有这些步骤）

这次要发布的内容里，**只有一项是数据库变更**：工作流定义 `gyre-captable-summary-v2` 从 v18 升到 v19。

前端硬编码了 `MONTHLY_WORKFLOW_VERSION = 19`，服务端拿数据库里的 `workflow_definitions.version` 跟它比对。**不一致时月度更新页直接报「版本不匹配」并拒绝执行**（`POST /api/monthly-runs` 返回 409）。所以不更新数据库，整个月度功能不可用——这不是降级，是硬失效。

而应用启动时的 seed 逻辑是 `insert ... on conflict (code) do nothing`（见 `src/server/seed.ts` 的 `insertWorkflowDefinitionIfMissing`）：**只插入缺失的定义，绝不覆盖已有行**。所以 v19 必须显式发布，重启容器不会带上它。

其余改动（前端重构、页面拆分、i18n 合并、输入校验）都不碰数据库结构，随镜像一起上线即可。

---

## 1. 安全边界（先读这个）

### 允许执行

- 所有 `select` / `information_schema` 查询
- `docker compose ... up -d --build`、`restart`、`logs`、`ps`
- 第 4 节的工作流定义发布命令（它自身是单事务，失败自动 rollback）
- 第 2 节列出的文件删除（白名单制）

### 必须先报告、得到明确许可才能执行

| 操作                                                                   | 原因                                                          |
| ---------------------------------------------------------------------- | ------------------------------------------------------------- |
| 触发任何一次月度运行（`POST /api/monthly-runs`）                       | 会真实执行业务工作流、写文件、改 `monthly_run_instances` 状态 |
| `delete` / `update` / `drop` 任何业务表                                | 本手册没有需要你手写 DML 的步骤                               |
| `--force` 发布工作流定义                                               | 只有云端版本**高于** 19 时才需要，那是异常状态                |
| 修改 `AUTH_DISABLED`、`AUTH_BOOTSTRAP_SECRET`、`SESSION_COOKIE_SECURE` | 安全相关配置                                                  |
| 导入演示数据（`DEMO_SEED_ON_INIT=true` / `npm run seed:demo`）         | 会写业务数据                                                  |

### 停下来报告的条件

- 第 3 节预检 SQL ① 返回非 0
- `workflow_definitions` 里 `gyre-captable-summary-v2` 的 version **大于 19**
- 应用容器反复重启 / 健康检查不过
- `docker compose logs app` 里出现 `Runtime parameter reference not found` 或 `Missing element #`

---

## 2. 清理工作区杂物

### 2.1 为什么要清

根目录堆了一批本地截图、导出表格、部署 tar 包和临时脚本。`.dockerignore` 已经把它们挡在构建上下文外，**所以对镜像内容零影响**；清理解决的是工作区整洁和磁盘占用（约 32 MB）。

**这一步只影响执行部署的这台机器的工作区。** 如果云上是干净 clone，可以整节跳过。

### 2.2 删除白名单（只删这些）

在项目根目录执行：

```bash
cd <项目根目录>

rm -f \
  '0707新增页面.xlsx' \
  'global-parameter-after.png' \
  'global-parameter-edit-desktop-after.png' \
  'global-parameter-edit-desktop-final.png' \
  'global-parameter-edit-mobile-after.png' \
  'global-parameter-mobile.png' \
  'gyre-60627-captable-2026-05.png' \
  'docs-overview.png' \
  'docs-workflow.png' \
  'five-percent-holders.png' \
  'monthly-run-inline-sheet.png' \
  'gyre-cloud-HEAD.tar.gz' \
  'gyre-cloud-eaaa775.tar.gz' \
  'todo.md' \
  'shot.tmp.mjs' \
  'tmp-save-test.txt' \
  '~$reESOP管理系统需求文档0614.docx'

rm -rf test-results/

# macOS 目录描述文件（若存在）
find . -name '.DS_Store' -not -path './node_modules/*' -not -path './.git/*' -delete
```

### 2.3 禁止删除（这些是仓库资产或本地配置）

| 路径                                                   | 为什么不能删                                                            |
| ------------------------------------------------------ | ----------------------------------------------------------------------- |
| `database/*.xlsx`、`database/extracted-sheets/*.xlsx`  | 被 git 跟踪，且是运行时数据（Dockerfile 里 `COPY database ./database`） |
| `public/guide/**/*.png`、`public/guide/en/**/*.png`    | 被 git 跟踪，使用手册插图                                               |
| `GyreESOP管理系统需求文档0614.docx`                    | 被 git 跟踪的需求文档                                                   |
| `副本小北to丹宁-Gyre分析-0618wudn更新.xlsx`            | 被 git 跟踪                                                             |
| `deploy/`                                              | 被 git 跟踪（反代配置）                                                 |
| `.env`                                                 | 本地环境配置（gitignored，但删了本地起不来）                            |
| `data/`、`backups/`、`log/`、`tmp/`、`STATS/`、`dist/` | 运行产物 / 备份 / 日志，不在本次清理范围                                |

### 2.4 清理后自检

```bash
git status --short
# 期望：没有任何输出（干净工作区）
# 如果出现 ' D <路径>' 或 'D  <路径>'，说明误删了被跟踪文件，立即：
#   git checkout -- <路径>
```

---

## 3. 数据库预检（三项，任一异常就停）

在能连到云端 Postgres 的机器上执行。三条都为了确认 `schema.ts` 里的迁移语句能安全跑完。

```sql
-- ① employees.employee_id 有空值或重复 → create unique index 会失败
--    → 整个 schema 初始化失败 → 应用容器起不来。必须返回 0。
select count(*) as blocking_rows from (
  select employee_id from employees
   where employee_id is null or btrim(employee_id) = ''
  union all
  select employee_id from employees
   group by employee_id having count(*) > 1
) x;

-- ② employees.tags 列是否还在。返回 1 说明会触发一次「标签迁移」：
--    tags 内容搬进 employee_label / employee_label_assignment，然后 drop 掉该列。
--    建议先备份：create table employees_backup_tags as
--      select id, employee_name, tags from employees where tags is not null;
select count(*) as tags_column_exists
  from information_schema.columns
 where table_name = 'employees' and column_name = 'tags';

-- ③ 会被无条件 drop 的旧结构（存在即有数据丢失，先确认是否有价值）
select
  (select count(*) from information_schema.tables
    where table_name = 'employee_source_identities') as dropped_table_rows_source,
  (select count(*) from information_schema.columns
    where table_name = 'employees' and column_name = 'employee_number') as dropped_column_exists;
```

**判定**：① 必须为 0。② ③ 若为 1，先报告再继续。

同时记录当前状态，供第 6 节对比：

```sql
select id, code, version, status, updated_at
  from workflow_definitions
 where code = 'gyre-captable-summary-v2';

select count(*) as users from app_users;
select count(*) as employees from employees;
select count(*) as monthly_instances from monthly_run_instances;
```

---

## 4. 数据库变更：发布工作流定义 v19

### 4.1 方式 A（推荐）：在运行中的应用容器内执行

镜像里已经带了编译好的发布脚本和 `database/` 目录，且容器环境里已有 `DATABASE_URL`，不需要额外装任何东西。

```bash
cd <项目根目录>

# 先 dry-run：同一事务但 rollback，只验证能读、能连、版本没倒退
docker compose -f docker-compose.prod.yml exec app \
  node dist/src/server/workflow/publishWorkflowSeed.js gyre-captable-summary-v2 --dry-run

# 期望输出：
#   validated gyre-captable-summary-v2 v19 from database/workflows/gyre-captable-summary-v2.json (workflow_id=..., version_id=...)

# 确认无误后正式发布
docker compose -f docker-compose.prod.yml exec app \
  node dist/src/server/workflow/publishWorkflowSeed.js gyre-captable-summary-v2

# 期望输出：
#   published gyre-captable-summary-v2 v19 from database/workflows/gyre-captable-summary-v2.json (workflow_id=..., version_id=...)
```

> 注意：必须在**新镜像已经跑起来之后**执行（脚本和 `database/` 都在镜像里）。所以顺序是第 5 节先构建启动，再回到这里发布。

### 4.2 方式 B：从有源码的机器执行

需要该机器有仓库 checkout + `node_modules`（含 devDependency `tsx`），并且网络能直达云端数据库。

```bash
cd <项目根目录>
DATABASE_URL='postgres://captable:<密码>@<db-host>:5432/captable' \
  npm run workflow:publish-seed -- gyre-captable-summary-v2 --dry-run

DATABASE_URL='postgres://captable:<密码>@<db-host>:5432/captable' \
  npm run workflow:publish-seed -- gyre-captable-summary-v2
```

### 4.3 方式 C：纯 SQL 兜底（只有 psql 权限时）

脚本会同时更新 `workflow_definitions` 并在 `workflow_definition_versions` 插入一行；这个兜底只做前者。历史 run 靠 `version_id` 指向旧版本行，不依赖新行，所以功能上够用。

在有仓库的机器上生成 SQL（用带引号的 heredoc，避免 shell 引号转义出错）：

```bash
cat > /tmp/gen-publish-sql.mjs <<'MJS'
import { readFileSync } from 'node:fs';

const doc = JSON.parse(readFileSync('database/workflows/gyre-captable-summary-v2.json', 'utf8'));
// Postgres 字符串字面量：单引号包裹，内部单引号翻倍
const sqlStr = (value) => `'${String(value).replaceAll("'", "''")}'`;
const sqlJson = (value) => `'${JSON.stringify(value).replaceAll("'", "''")}'`;

process.stdout.write(
  'begin;\n' +
    'update workflow_definitions set\n' +
    `  version = ${doc.version},\n` +
    `  tasks_json = ${sqlJson(doc.tasks)}::jsonb,\n` +
    `  runtime_params_schema_json = ${sqlJson(doc.runtimeParamsSchema)}::jsonb,\n` +
    `  runtime_params_defaults_json = ${sqlJson(doc.runtimeParamsDefaults)}::jsonb,\n` +
    '  updated_at = current_timestamp\n' +
    `where code = ${sqlStr(doc.code)};\n` +
    'commit;\n',
);
MJS

node /tmp/gen-publish-sql.mjs > /tmp/publish-v19.sql

# 自检：应看到 where code = 'gyre-captable-summary-v2'
grep -o "where code = '[^']*'" /tmp/publish-v19.sql

# 确认无误后执行
psql "$DATABASE_URL" -f /tmp/publish-v19.sql
```

执行后按 6.2 节核对。注意：jsonb 不保留键顺序，所以校验时要用**深比较**（如 `assert.deepStrictEqual`），直接字符串比对会误报不一致。

### 4.4 这个变更具体改了什么

| 字段                                                                    | 变更                                                                                                                                                                      |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `version`                                                               | 18 → **19**                                                                                                                                                               |
| `runtime_params_schema_json.fileRefs.properties.*`                      | 10 个源全部新增 `allowSheetNameOverride: true` 与 `defaultSheetName`（月度输入源可选 sheet，并带默认值）                                                                  |
| `tasks_json`                                                            | `extract_previous_capitalization_summary` 的 `sheetName` 从写死的 `"Capitalization Summary"` 改为 `$fromRuntime: "fileRefs.previous_capitalization_summary.sheet"` 描述符 |
| `runtime_params_defaults_json.fileRefs.previous_capitalization_summary` | `{}` → `{"sheet": "Capitalization Summary"}`（否则上面的 `$fromRuntime` 解析不到会抛 `Runtime parameter reference not found`）                                            |
| `runtime_params_defaults_json.fileRefs.base_control_book`               | `key` 改为种子实际登记的 `control_book/EQ_Control_Book_Base_2026_01.xlsx`（原值 `input/2026-05/EQ Control Book.xlsx` 是输入文件，不是 base）                              |
| `runtime_params_defaults_json.fileRefs.base_futu_exercises`             | `key` 改为 `futu_exercises/Futu_Exercises_Base_2026_05.xlsx`（原值 `output/futu-exercises/Futu_Exercises_Base.xlsx` 没有任何任务会写出，见第 10 节）                      |
| `runtime_params_defaults_json.fileRefs.base_cancel_restore_report`      | 去掉硬编码的 `id: 206`（dev 库 id，换库后指向别的文件）；`key` 不变                                                                                                       |

**已存在的 `workflow_runs` 不受影响**：它们各自快照了 `tasks_snapshot_json`，并通过 `version_id` 指向 v17 的版本行，该行不会被删改。

---

## 5. 构建与发布

```bash
cd <项目根目录>

# 反代网只需建一次；已存在会报错，忽略即可
docker network create web 2>/dev/null || true

# 构建并滚动重启（数据卷 pgdata / appdata 不受影响）
AUTH_BOOTSTRAP_SECRET='<强随机口令>' \
  docker compose -f docker-compose.prod.yml up -d --build

docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs --tail=80 app
```

启动时应用会自动做这些（无需人工干预）：

| 动作                                 | 机制                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------- |
| 建表 / 加列                          | `schema.ts` 追加式 DDL，`create ... if not exists` + `add column if not exists`，幂等 |
| 插入缺失的工作流定义                 | `WORKFLOW_SEED_ON_INIT=true`（compose 默认开启）                                      |
| upsert `workflow_operators`          | `on conflict (code, version) do update`                                               |
| upsert `global_parameters` 的 label  | **value 永不被覆盖**，线上调过的数值安全                                              |
| `app_users.role` 默认值改为 `'user'` | `alter column ... set default`，只影响新建用户，已有管理员角色不变                    |

**启动成功后回到第 4 节执行发布**，然后继续第 6 节。

### 环境变量核对

`docker-compose.prod.yml` 已内置正确默认值，确认没有被外部 `.env` 覆盖：

| 变量                    | 期望值                           |
| ----------------------- | -------------------------------- |
| `AUTH_DISABLED`         | `false`                          |
| `WORKFLOW_SEED_ON_INIT` | `true`                           |
| `DEMO_SEED_ON_INIT`     | 不设置 / `false`                 |
| `STORAGE_DRIVER`        | `local`                          |
| `HOST` / `PORT`         | `0.0.0.0` / `60628`              |
| `SESSION_COOKIE_SECURE` | `true`（走 HTTPS）               |
| `AUTH_BOOTSTRAP_SECRET` | 已设置（compose 缺失时拒绝启动） |

---

## 6. 验证（从只读到写操作，逐层做）

### 6.1 容器与日志

```bash
docker compose -f docker-compose.prod.yml ps
# app 与 postgres 都应为 Up / healthy

docker compose -f docker-compose.prod.yml logs --tail=200 app | grep -iE 'error|fatal|unhandled|reference not found'
# 期望：无输出
```

### 6.2 数据库状态

```sql
-- version 必须是 19
select id, code, version, status, updated_at
  from workflow_definitions where code = 'gyre-captable-summary-v2';

-- v18 已 published；v17 仍在（历史 run 指着它）
select version, status, published_at
  from workflow_definition_versions
 where workflow_id = (select id from workflow_definitions where code = 'gyre-captable-summary-v2')
 order by version desc limit 3;

-- 新工作流定义已被 seed 插入（若之前缺失）
select code, version, status from workflow_definitions order by code;
```

### 6.3 HTTP 接口

```bash
BASE='https://<你的域名>'

# 健康检查（应返回 200，且响应里不含数据库连接串）
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/api/health"

# 未登录访问受保护接口应为 401（不是 500）
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/api/files"

# 关键：版本守卫两侧必须对上
curl -s "$BASE/api/monthly-runs/source-config" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print('workflowVersion =', d['workflowVersion'])
print('sources =', len(d['sources']))
print('全部可选 sheet:', all(s.get('allowSheetNameOverride') for s in d['sources']))
for s in d['sources']:
    print('  ', s['sourceKey'], '->', repr(s.get('defaultSheetName')))
"
```

**期望**：`workflowVersion = 19`、`sources = 10`、`全部可选 sheet: True`。

若这里是 17，说明第 4 节没生效——**不要继续**，回去重跑。

### 6.4 页面冒烟（只读）

用浏览器登录后逐页打开，确认无白屏、无控制台报错：

`股权汇总` → `月度更新` → `ESOP 明细` → `授予记录` → `行权记录` → `卖出记录` → `转仓计划` → `员工管理` → `计划汇总` → `5% 股东` → `全局参数` → `数据管理` → `文件中心` → `工作流` → `用户管理` → `使用手册` → `账号设置` → `系统设置`

在「月度更新」页额外确认：

- 顶部**没有**「版本不匹配」红色提示
- 「配置输入源」弹窗里，每个源选好文件后，该行出现 **输入 Sheet** 下拉，且默认选中配置的 sheet（如 `行权明细数据`、`27591`、`Capitalization Summary`）

### 6.5 月度运行冒烟（需需求方明确批准）

**默认不做。** 这一步会真实执行业务工作流并写文件。若需求方批准：

1. 先在「月度更新」页把 4 个必需本源选好（`incremental_control_book`、`option_plans_summary`、`incremental_futu_exercises`、`incremental_cancel_restore_report`）
2. 点执行
3. 期望：不再出现启动前被拒（`Missing source binding:` / `Missing source sheet name:` / `月度运行输入文件不可用：`）；若被拒，错误信息会**指名**是哪个源、缺文件还是缺 sheet
4. 观察运行面板，19 个步骤应逐个 completed

---

## 7. 回滚

### 7.1 只回滚工作流定义（保留新镜像）

前端常量是 18，回滚数据库到 17 会让月度页重新进入「版本不匹配」并拒绝执行。**所以单独回滚数据库没有意义**，必须连镜像一起回。

```bash
# 在容器内执行；--dry-run 先看会写成什么样
docker compose -f docker-compose.prod.yml exec app \
  node dist/src/server/workflow/publishWorkflowSeed.js gyre-captable-summary-v2 --dry-run --force
```

v17 的完整内容在 git 历史里：`git show 1bd4953^:database/workflows/gyre-captable-summary-v2.json`。需要真正回退时，把该文件写回 `database/workflows/` 并重新走第 4.1 节（脚本只在云端版本**高于** seed 时才要求 `--force`，这里正好是这种情形）。

### 7.2 回滚整个版本

```bash
# 回到上一个 commit 重新构建
git checkout 1bd4953^
AUTH_BOOTSTRAP_SECRET='<口令>' docker compose -f docker-compose.prod.yml up -d --build
```

数据卷 `pgdata` / `appdata` 不动。已产生的 `workflow_runs`、`monthly_run_history`、`product_files` 记录保留。

---

## 8. 完成标准（全部打勾才算完成）

- [ ] 第 3 节预检 ① 返回 0；② ③ 若为 1 已报告并得到许可
- [ ] `gyre-captable-summary-v2` 的 `version` = 19，`workflow_definition_versions` 有 v19 published
- [ ] `docker compose ps` 两个服务均 Up / healthy
- [ ] `app` 日志无 error / fatal / unhandled / reference not found
- [ ] `GET /api/monthly-runs/source-config` 返回 `workflowVersion = 19`、10 个源、全部 `allowSheetNameOverride: true`
- [ ] `GET /api/files` 未登录返回 401
- [ ] 「月度更新」页无版本不匹配提示，源配置里能看到 sheet 下拉且默认值正确
- [ ] 第 6.5 节若已执行：月度运行未被启动前校验拒绝，或拒绝信息指名了具体源
- [ ] 冷启动种子已注册：`select count(*) from product_files where uploaded_by = 'BaseSeed'` 返回 3（见 10.4）
- [ ] `git status --short` 干净（若执行了第 2 节）

---

---

## 9. 附：本次发布涉及的代码提交

```
fix: ship real cold-start base seeds for the inherit-type monthly sources
docs: add a cloud deployment runbook for the v18 workflow definition
1bd4953 fix: stop requiring a monthly sheet name the workflow already defaults
d660851 fix: name the source that blocks a monthly run, and honour its default sheet
642e6b8 feat: let every monthly input source pick its sheet, defaulting to the workflow's
c64fed8 fix: report a missing required monthly source as 400, not 500
2980563 fix: only report pre-flight file problems the run would actually fail on
a6c4605 fix: refuse a monthly run whose file inputs cannot resolve
```

更早的提交（`2a44847` 及之前）是纯前端重构与测试补强，不涉及数据库。

## 10. 冷启动 base 种子（`database/base-seeds/`）

### 10.1 为什么需要

月度工作流里有三个源标了 `optionalCategory: 'inherit'`——它们的语义是"继承上一个月合并产出的 base"：

| 源                           | 消费任务                      | base 由谁产出                                                         |
| ---------------------------- | ----------------------------- | --------------------------------------------------------------------- |
| `base_control_book`          | `invoke_control_book_merge`   | `control_book/EQ_Control_Book_Base_<yyyy_MM>.xlsx`                    |
| `base_futu_exercises`        | `invoke_futu_exercises_merge` | `futu_exercises/Futu_Exercises_Base_<yyyy_MM>.xlsx`                   |
| `base_cancel_restore_report` | `invoke_plan_summary_sync`    | `cancel_restore/Gyre_Therapeutics_Cancel_Restore_Base_<yyyy_MM>.xlsx` |

空库没有"上一个月"，第一次运行就没有 base 可继承，merge 子工作流会直接死在 extract 任务上。所以项目里带了一份**真实的** base 种子，初始化时注册进 `product_files`。

`previous_capitalization_summary` **不在种子集里**：它由运行期的 `injectPreviousMonthBase()` 从上月 Capitalization Summary 输出自动注入，放种子只会白占体积并且第一次运行后就过期。

### 10.2 种子集内容

```
database/base-seeds/
├── manifest.json                                          # 每个种子的契约、列、行数、sha256、base 月份
├── control_book/EQ_Control_Book_Base_2026_01.xlsx         # base_control_book
├── futu_exercises/Futu_Exercises_Base_2026_05.xlsx        # base_futu_exercises
└── input/cancel_restore/Gyre Therapeutics取消与恢复报表.xlsx   # base_cancel_restore_report
```

`manifest.json` 里每个种子都记录了**消费任务的抽取契约**（sheet、range、headerRow）和按该契约实测出的列名/行数/校验和。初始化注册前会重新校验：字节对不上、或按契约抽出来的行列数和清单不一致，就**跳过并告警**，不会注册一个会在空库上跑到一半才失败的表。

### 10.3 初始化时自动发生什么

`AppDb.init()` → `ensureWorkflowSeedData()` → `seedBaseSeedFiles()`：

1. 读 `database/base-seeds/manifest.json`
2. 对每个种子，若 `product_files` 已存在同 `logical_path` 的行 → **跳过**（已跑过月份的系统保留自己更新的 base）
3. 校验 sha256 与契约
4. 写入存储 + 插入 `product_files`（`uploaded_by = 'BaseSeed'`）

**幂等，可重复执行。** 不在数据库事务里（要写文件、要起 workbook worker）。

### 10.4 验证种子已生效

```sql
select logical_path, uploaded_by, workbook_sheet_count, workbook_row_count
  from product_files
 where uploaded_by = 'BaseSeed'
 order by logical_path;
```

期望 3 行。容器日志里对应：

```
[base-seeds] registered base_control_book @ control_book/EQ_Control_Book_Base_2026_01.xlsx (id=..., 63371 bytes, 1 sheets, 116 rows)
[base-seeds] registered base_futu_exercises @ futu_exercises/Futu_Exercises_Base_2026_05.xlsx (id=..., 394446 bytes, 1 sheets, 780 rows)
[base-seeds] registered base_cancel_restore_report @ input/cancel_restore/Gyre Therapeutics取消与恢复报表.xlsx (id=..., 77440 bytes, 1 sheets, 758 rows)
```

### 10.5 换一批种子 / 重新生成

```bash
# 在有数据的机器上，按当前系统重新导出（会覆盖 database/base-seeds/）
DATABASE_URL='...' npx tsx scripts/export-base-seeds.ts
git add database/base-seeds
```

注意：换了种子文件必须同步改 `gyre-captable-summary-v2` 的 `runtimeParamsDefaults.fileRefs.*.key`，否则默认值指向的路径和种子登记的路径不一致，冷启动依然解析不到。改完按第 4 节重新发布，并 bump 版本。

### 10.6 已知限制（需要需求方决策）

1. **`cancel_restore/` 目录从来没有产出过 base。** 现存的两个 `..._Cancel_Restore_Base_*.xlsx` 一个在 `input/cancel_restore/`（人工放置）、一个是我验证时产生的孤儿（已删）。而 `injectPreviousMonthBase()` 只在 `cancel_restore/` 下找。所以取消/恢复这条继承链**目前链不起来**，冷启动靠种子里的那份人工累计报表顶着。这是既有问题，不是本次引入。
2. **种子的 base 月份不一致**：control_book 是 2026-01、futu_exercises 是 2026-05。因为它们是各自链条上**最早的真实产出**。首次可运行月份因此不同（分别为 2026-02 与 2026-06），`manifest.json` 里的 `baseMonth` 记录了这个事实，没有粉饰。
3. 种子是快照，不会自动更新。系统正常按月跑起来后，新的 base 由工作流自己产出并被 `injectPreviousMonthBase()` 接管，种子只在冷启动那一瞬间有用。

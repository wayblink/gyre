# 云端部署执行手册

> 面向在云上执行部署的 agent。本文自包含：每条命令都可直接复制运行，每个破坏性操作前都有检查点。
> **不要跳过第 1 节的安全边界。** 遇到「停下来报告」的条件时，停下来，把输出原样贴回给需求方，不要自行决定继续。

- 适用代码版本：`feat/esop-workflows-docs-deploy` 分支 HEAD（见第 9 节提交清单）
- 上一轮部署的基线：`cb7bb44`（月度工作流 v43）
- 本轮目标：月度工作流 **v44**，另有 5 个子工作流要发布（`eq-control-book-incremental-merge`、`futu-exercises-incremental-merge`、`plan-summary-sync`、`read-series-b`、`gyre-therapeutics-cancel-restore-incremental-merge`）
- 部署形态：Fastify + 打包前端 + Postgres，单容器（Dockerfile 两阶段构建）
- 云上编排：`docker-compose.prod.yml`（app + postgres + Caddy 反代网）

---

## 0. 一分钟背景（为什么有这些步骤）

这一轮必须人工执行的一步仍然是**发布工作流定义**：`workflow_definitions` 的启动 seed 只插入缺失行、绝不覆盖已有行，而本轮 6 个定义的版本都变了（含月度主工作流）。

前端硬编码 `MONTHLY_WORKFLOW_VERSION = 44` 与服务端版本比对，不一致时月度页报「版本不匹配」并拒绝执行（409）——不发布就是硬失效。

**这一轮修的是线上已经暴露的三类故障**（详见 4.5）：

1. **可选输入被默认值劫持**：子工作流 `runtimeParamsDefaults.fileRefs.*` 里存着历史文件路径，父流程传「未配置（只有 sheet）」时被深合并补回，于是页面上标着「可选」的 SERIES B Control Book 实际去读 2026 年 9 月的旧导出，报 `Product file not found`。修法两层：引擎改成「文件身份只认调用方」＋ 把种子里所有历史文件默认值清掉。
2. **空输入把 SQL 结果列吃掉**：`sql.compute` 在 0 行输入时丢列，导致「本月没有取消与恢复报表」这种正常月份被 schema 守卫拦下。
3. **线上定义长期落后于仓库种子**：上一轮部署后，线上 `read-series-b` 还停在 v1、`plan-summary-sync` 停在 v1（还在找 `Options OS Detail` sheet），所以 `invoke_futu_exercises_merge` / `invoke_plan_summary_sync` 一直在失败。**本轮必须把 4.1 表里 6 个定义全部发布到位。**

本轮不含任何 `schema.ts` 变更，**没有手写 DDL**；也没有新增 `workflow_operators`，没有新增 npm 依赖。

记录页的「截至当月累计快照」语义（上一轮引入）本轮不变，操作规则仍见 11.1：快照落在 `<folder>/*_Base_YYYY_MM.xlsx`，由系统自动注入，**不需要也不要手工上传**。

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
| `--force` 发布工作流定义                                               | 只有云端版本**高于** 43 时才需要，那是异常状态                |
| 修改 `AUTH_DISABLED`、`AUTH_BOOTSTRAP_SECRET`、`SESSION_COOKIE_SECURE` | 安全相关配置                                                  |
| 导入演示数据（`DEMO_SEED_ON_INIT=true` / `npm run seed:demo`）         | 会写业务数据                                                  |

### 停下来报告的条件

- 第 3 节预检 SQL ① 返回非 0
- `workflow_definitions` 里 `gyre-captable-summary-v2` 的 version **大于 44**
- 4.1 表里任何一个定义的云端 version **高于**目标版本（说明云端不是从本轮基线 `cb7bb44` 起的）
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
  'gyre-cloud-44dcec8.tar.gz' \
  'gyre-cloud-7a48fe6.tar.gz' \
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

## 4. 数据库变更：发布工作流定义

### 4.1 要发布哪些

本轮 `database/workflows/*.json` 里有 6 个定义的版本变了，**全部都要发布**。其中前 4 个属于「线上落后于仓库种子」，不发布就修不好线上已经出现的失败步骤。

| code                                                 | 目标版本 | 线上现状（基线 `cb7bb44`） | 改了什么                                                                                |
| ---------------------------------------------------- | -------- | -------------------------- | --------------------------------------------------------------------------------------- |
| `gyre-captable-summary-v2`                           | **44**   | 43                         | `incremental_control_book` 默认值去掉 2026-05 历史文件（只留 sheet）；前端版本锁同步 44 |
| `read-series-b`                                      | **2**    | **1**                      | 改用 `sheet.optional-range.extract` + `emptyColumns`，默认值不再指向 2026-09 历史文件   |
| `futu-exercises-incremental-merge`                   | **5**    | **3**                      | 增量改可选抽取；默认值去掉 `input/2026-08/...` 历史文件                                 |
| `plan-summary-sync`                                  | **6**    | **1**                      | v5 起改吃 Option Plans + 取消恢复合并结果（v1 还在找 `Options OS Detail` sheet）        |
| `gyre-therapeutics-cancel-restore-incremental-merge` | **3**    | **1**                      | 增量改可选抽取；默认值去掉历史文件（只留 sheet）                                        |
| `eq-control-book-incremental-merge`                  | **5**    | **3**                      | 同月度：`incremental_control_book` 默认值去掉 2026-05 历史文件                          |

其余定义不需动（`esop-cancellation/sold-shares/grant/exercise-record-sync` = 7/8/12/12、`employee-import` 1、`option-plans-summary-values` 1、`five-percent-holders-sync` 1、`esop-transfer-to-futu-sync` 1、`gyre-therapeutics-cancel-restore-report-read` 1）；若云端缺失会被启动 seed 自动补上。

> 判断方法：`select code, version from workflow_definitions;` 与上表对比。低于目标版本的才需要发布；发布脚本拒绝版本倒退，重复执行是安全的。
>
> **任何一个定义高于目标版本 → 停下来报告**，说明云端不是从 `cb7bb44` 起的。
>
> 线上还留着一个旧版 `gyre-captable-summary`（v1，已被 v2 取代）。它不影响运行，本轮不删；删除属于破坏性操作，先取得许可。

### 4.2 方式 A（推荐）：在运行中的应用容器内执行

镜像里已经带了编译好的发布脚本和 `database/` 目录，且容器环境里已有 `DATABASE_URL`，不需要额外装任何东西。

```bash
cd <项目根目录>

# 本轮发布清单（6 个）
CODES='gyre-captable-summary-v2 read-series-b futu-exercises-incremental-merge
plan-summary-sync gyre-therapeutics-cancel-restore-incremental-merge
eq-control-book-incremental-merge'

# 1) 先全部 dry-run：同一事务但 rollback，只验证能读、能连、版本没倒退
for code in $CODES; do
  docker compose -f docker-compose.prod.yml exec app \
    node dist/src/server/workflow/publishWorkflowSeed.js "$code" --dry-run
done

# 期望：每个都输出
#   validated <code> v<N> from database/workflows/<code>.json (workflow_id=..., version_id=...)
# 其中 gyre-captable-summary-v2 必须是 v44、read-series-b v2、plan-summary-sync v6

# 2) 确认无误后正式发布
for code in $CODES; do
  docker compose -f docker-compose.prod.yml exec app \
    node dist/src/server/workflow/publishWorkflowSeed.js "$code"
done

# 期望：每个都输出
#   published <code> v<N> from database/workflows/<code>.json (workflow_id=..., version_id=...)
```

> 注意：必须在**新镜像已经跑起来之后**执行（脚本和 `database/` 都在镜像里）。所以顺序是第 5 节先构建启动，再回到这里发布。
>
> 若某个子工作流在云端还不存在，`published` 同样会成功（脚本会插入 definition + 首个 version 行）。

### 4.3 方式 B：从有源码的机器执行

需要该机器有仓库 checkout + `node_modules`（含 devDependency `tsx`），并且网络能直达云端数据库。

```bash
cd <项目根目录>
export DATABASE_URL='postgres://captable:<密码>@<db-host>:5432/captable'
for code in gyre-captable-summary-v2 read-series-b futu-exercises-incremental-merge \
            plan-summary-sync gyre-therapeutics-cancel-restore-incremental-merge \
            eq-control-book-incremental-merge; do
  npm run workflow:publish-seed -- "$code" --dry-run
done
# 逐条确认后去掉 --dry-run 再跑一遍
```

### 4.4 方式 C：纯 SQL 兜底（只有 psql 权限时）

脚本会同时更新 `workflow_definitions` 并在 `workflow_definition_versions` 插入一行；这个兜底只做前者。历史 run 靠 `version_id` 指向旧版本行，不依赖新行，所以功能上够用。

```bash
cat > /tmp/gen-publish-sql.mjs <<'MJS'
import { readFileSync } from 'node:fs';
const codes = process.argv.slice(2);
const sqlStr = (v) => `'${String(v).replaceAll("'", "''")}'`;
const sqlJson = (v) => `'${JSON.stringify(v).replaceAll("'", "''")}'`;
let out = 'begin;\n';
for (const code of codes) {
  const doc = JSON.parse(readFileSync(`database/workflows/${code}.json`, 'utf8'));
  out +=
    'update workflow_definitions set\n' +
    `  version = ${doc.version},\n` +
    `  tasks_json = ${sqlJson(doc.tasks)}::jsonb,\n` +
    `  runtime_params_schema_json = ${sqlJson(doc.runtimeParamsSchema)}::jsonb,\n` +
    `  runtime_params_defaults_json = ${sqlJson(doc.runtimeParamsDefaults)}::jsonb,\n` +
    '  updated_at = current_timestamp\n' +
    `where code = ${sqlStr(doc.code)};\n`;
}
out += 'commit;\n';
process.stdout.write(out);
MJS

node /tmp/gen-publish-sql.mjs \
  gyre-captable-summary-v2 read-series-b futu-exercises-incremental-merge \
  plan-summary-sync gyre-therapeutics-cancel-restore-incremental-merge \
  eq-control-book-incremental-merge > /tmp/publish.sql
grep -o "where code = '[^']*'" /tmp/publish.sql   # 自检，必须是 6 行
psql "$DATABASE_URL" -f /tmp/publish.sql
```

> jsonb 不保留键顺序，校验时要用**深比较**，直接字符串比对会误报。

### 4.5 这一轮到底改了什么

| 范围 | 变更                                                                                                                                                                                                                                                                              |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 引擎 | `runtimeParameters.ts`：`fileRefs.<源>` 的**文件身份**（`provider` / `key` / `id`）只认调用方传的值，`sheet` 等非身份字段仍可从默认值继承，`{}` 明确表示「没有文件」。此前是深合并，父流程传「未配置」也会被子流程默认值里的历史文件补回来                                        |
| 引擎 | `sqlUtils.ts`：`sql.compute` 在输入 0 行且语句是 `select * from <表>` 时，用来源表的 columns 作为输出列契约；此前 0 行会让结果丢光列，下游 schema 守卫直接 block                                                                                                                  |
| 种子 | 6 个工作流删掉 `runtimeParamsDefaults.fileRefs.*` 里的历史文件身份（`read-series-b`、`futu-exercises-incremental-merge`、`gyre-therapeutics-cancel-restore-incremental-merge`、`plan-summary-sync`、`gyre-captable-summary-v2`、`eq-control-book-incremental-merge`），只留 sheet |
| 前端 | `MONTHLY_WORKFLOW_VERSION` 43 → **44**，与月度定义版本锁死；运行历史里「需复核」（`waiting_approval`）的行现在可以删除（此前按钮被禁用），只有真正在执行的 `running` / `pending` 仍然锁住（见 8.1）                                                                               |
| 测试 | 新增 `workflowSeedDefaults.test.ts`（种子默认值不得带可选源的文件身份、不得指向 `input/YYYY-MM/`）；新增 `operators/sqlUtils.test.ts`（空结果保列能力）                                                                                                                           |

**已存在的 `workflow_runs` 不受影响**：它们各自快照了 `tasks_snapshot_json`，并通过 `version_id` 指向旧版本行。

线上那三个失败步骤在本轮之后的预期行为：

| 步骤                          | 修复前                                                                     | 修复后                                                   |
| ----------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------- |
| `invoke_read_series_b`        | `Product file not found: input/series-b/…16.09.2026…xlsx`                  | 未配置源 → 空表，Series B 计 0，步骤 completed           |
| `invoke_futu_exercises_merge` | `Product file not found: input/2026-08/Gyre Therapeutics员工行权记录.xlsx` | 未配置增量 → 该月快照 = base，步骤 completed             |
| `invoke_plan_summary_sync`    | `Sheet Options OS Detail not found`                                        | v6 定义从 Option Plans + 取消恢复合并结果取数，completed |
| 取消/恢复合并（本月无增量时） | schema 守卫报「缺少创建编号或变更日期字段」                                | 空增量也能正常合并，completed                            |

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

| 动作                                 | 机制                                                                                     |
| ------------------------------------ | ---------------------------------------------------------------------------------------- |
| 建表 / 加列                          | `schema.ts` 追加式 DDL，`create ... if not exists` + `add column if not exists`，幂等    |
| 插入缺失的工作流定义                 | `WORKFLOW_SEED_ON_INIT=true`（compose 默认开启）                                         |
| upsert `workflow_operators`          | `on conflict (code, version) do update`（本轮新增 `dataframe.keyed.merge` 已在注册表里） |
| upsert `global_parameters` 的 label  | **value 永不被覆盖**，线上调过的数值安全                                                 |
| `app_users.role` 默认值改为 `'user'` | `alter column ... set default`，只影响新建用户，已有管理员角色不变                       |

**启动成功后回到第 4 节执行发布**，然后继续第 6 节。

> 本轮**没有新增 npm 依赖、没有改 `schema.ts`、没有新增 `workflow_operators`**，镜像构建路径与上一轮完全一致（`npm ci` + 构建产物）。仍然要用仓库里的 `package-lock.json`，不要删掉它再 `npm install`。

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
-- ① 4.1 表里六个定义的版本必须与目标一致
select code, version, status
  from workflow_definitions
 where code in (
   'gyre-captable-summary-v2', 'read-series-b', 'futu-exercises-incremental-merge',
   'plan-summary-sync', 'gyre-therapeutics-cancel-restore-incremental-merge',
   'eq-control-book-incremental-merge'
 )
 order by code;
-- 期望：gyre-captable-summary-v2 = 44、read-series-b = 2、
--      futu-exercises-incremental-merge = 5、plan-summary-sync = 6、
--      gyre-therapeutics-cancel-restore-incremental-merge = 3、eq-control-book-incremental-merge = 5

-- ② 新算子已由启动时的 upsert 注册（授权记录依赖它）
select code, version from workflow_operators
 where code in ('dataframe.keyed.merge', 'dataframe.ensure.columns', 'dataframe.persist.excel');
-- 期望：3 行；空行说明 WORKFLOW_SEED_ON_INIT 没开

-- ③ 月度输入源个数（schema 里 20 个，其中 7 个 hidden）
select count(*) as sources from jsonb_object_keys(
  (select runtime_params_schema_json->'fileRefs'->'properties'
     from workflow_definitions where code = 'gyre-captable-summary-v2')
);
-- 期望：20
```

### 6.3 HTTP 接口

```bash
BASE='https://<你的域名>'

curl -s -o /dev/null -w '%{http_code}\n' "$BASE/api/health"     # 200
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/api/files"      # 未登录 401

# 版本守卫两侧必须对上
curl -s "$BASE/api/monthly-runs/source-config" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print('workflowVersion =', d['workflowVersion'])
print('sources =', len(d['sources']))
print('visible =', len([s for s in d['sources'] if not s.get('hidden')]))
print('required =', [s['sourceKey'] for s in d['sources'] if s.get('required')])
"
```

**期望**：`workflowVersion = 44`、`sources = 20`、`visible = 13`（7 个 base 隐藏）、`required = ['option_plans_summary', 'incremental_control_book']`。

```bash
# 月份标记：本轮新增 hasGrantData
curl -s "$BASE/api/months" | python3 -c "
import sys, json
months = json.load(sys.stdin)['months']
print('flags =', [k for k in months[0] if k.startswith('has')])
print('latest =', months[0])
"
```

**期望** flags 含 `hasCapTableData` / `hasPlanSummaryData` / `hasExerciseData` / `hasSoldSharesData` / `hasCancellationData` / `hasGrantData` 六项。空库全为 `false` 是正常的。

```bash
# 记录页接口都必须接受 month（空月份返回空集合而不是 500）
for path in 'exercises' 'exercises/shareworks' 'exercises/merge' 'sold-shares' \
            'cancellation-records' 'holdings' 'grants/shareworks' 'grants/merge'; do
  printf '%-24s ' "$path"
  curl -s -o /dev/null -w '%{http_code}\n' "$BASE/api/$path?month=2026-09&pageSize=1"
done
```

### 6.4 页面冒烟（只读）

用浏览器登录后逐页打开，确认无白屏、无控制台报错：

`股权汇总` → `月度更新` → `ESOP 明细` → `授予记录` → `行权记录` → `卖出记录` → `取消记录` → `转仓计划` → `员工管理` → `计划汇总` → `5% 股东` → `全局参数` → `数据管理` → `文件中心` → `工作流` → `用户管理` → `使用手册` → `账号设置` → `系统设置`

在「月度更新」页额外确认：

- 顶部**没有**「版本不匹配」红色提示
- 输入文件表格是 **13 行**（20 个源减去 7 个 hidden：`previous_capitalization_summary` + 6 个 `*_base`）
- 每个需要上传的源，说明文字右边有一个 📄 图标；点开显示「文件名参考」和对应的文件名模板；自动带出的源没有图标
- 「配置输入源」弹窗里，选好文件后出现 **输入 Sheet** 下拉，默认选中配置的 sheet

在四个记录页（授予 / 行权 / 卖出 / 取消）额外确认：

- hero 区有 **月份** 选择器（不是「SourceFile」字样）
- 切换到没有快照的月份时，表格显示「暂无符合条件的…记录」，而不是上一个月的数据
- 全年只有一个月有某一侧数据时（例如 2026-08 只有 Shareworks 授予），打开页面应**自动切到有数据的视图**并弹出提示；手动切回空视图时，空态里会写明「本月「X 视图」有 N 条记录」

### 6.5 月度运行冒烟（需需求方明确批准）

**默认不做。** 这一步会真实执行业务工作流、写文件、改实例状态。

若需求方批准：

1. 在「月度更新」页把两个必填源选好（`incremental_control_book`、`option_plans_summary`），按需补可选源
2. 点执行 → 期望 23 个步骤全部 completed（四个 `invoke_*_record_sync` 按是否配置源决定 completed 或跳过）。**本轮重点看这三步**：`invoke_read_series_b`、`invoke_futu_exercises_merge`、`invoke_plan_summary_sync` —— 修复前它们在线上会报 `Product file not found` / `Sheet Options OS Detail not found`，现在即使对应输入留空也必须 completed
3. 运行常在 `calc_control_book_metrics` 因 Omnibus 拼写变体停在 `waiting_approval`，批准后继续——**这是预期行为**
4. 跑完后该月的 `has*Data` 变为 true

**累计快照的特别说明**：记录页展示的是「截至当月」的数据，链是按月接力的。

- 空库第一次跑某个月：没有 base，该月快照 = 当月增量
- 要看到累计效果，**必须按月份升序逐月跑**（例如 2026-01 → 03 → 04 …）
- 校验累计是否生效：`select logical_path, workbook_row_count from product_files where logical_path like '%_Base_2026_08.xlsx'` —— 08 的行数应 ≥ 06 的行数（同一视图）

## 7. 回滚

### 7.1 只回滚工作流定义（保留新镜像）

**没有意义**：前端常量是 44，把数据库回滚到 43 或更早，月度页会重新进入「版本不匹配」并拒绝执行。要回滚定义就必须连镜像一起回。

### 7.2 回滚整个版本

```bash
# 回到本轮之前的基线
git checkout cb7bb44
AUTH_BOOTSTRAP_SECRET='<口令>' docker compose -f docker-compose.prod.yml up -d --build
```

镜像起来后，数据库里的定义仍是 v44，而旧镜像的前端期望 v43 → 月度页会报版本不匹配。**必须把定义也随之回退**：

容器里通常没有 `git`，所以顺序是「先让镜像带旧种子，再强制发布」：上一步 `git checkout cb7bb44` 已经让重新构建的镜像里装的是旧种子文件；容器跑起来后再对每个定义执行 `--force`（云端版本高于种子，不加 `--force` 会被拒绝）：

```bash
CODES='gyre-captable-summary-v2 read-series-b futu-exercises-incremental-merge
plan-summary-sync gyre-therapeutics-cancel-restore-incremental-merge
eq-control-book-incremental-merge'

for code in $CODES; do
  docker compose -f docker-compose.prod.yml exec app \
    node dist/src/server/workflow/publishWorkflowSeed.js "$code" --dry-run --force
done
# 逐个确认输出是 expected 的旧版本号（月度 = 43）后再正式发布
for code in $CODES; do
  docker compose -f docker-compose.prod.yml exec app \
    node dist/src/server/workflow/publishWorkflowSeed.js "$code" --force
done
```

> `--force` 是本节唯一许可的强制发布场景（云端 44/2/5/6/3/5 高于 `cb7bb44` 的 43/1/3/5/1/3）。回退后前端常量仍是旧镜像里的 43，两侧对上。

数据卷 `pgdata` / `appdata` 不动。已产生的 `workflow_runs`、`monthly_run_history`、`product_files` 记录保留；本轮新产生的带月份后缀的快照文件也可以留着（旧代码不会读它们，只是 Files 里多几个文件）。

## 8. 完成标准（全部打勾才算完成）

- [ ] 第 3 节预检 ① 返回 0；② ③ 若为 1 已报告并得到许可
- [ ] **六个定义已发布**，版本与 4.1 节一致（月度 = **44**，`read-series-b` 2、`futu-exercises-incremental-merge` 5、`plan-summary-sync` 6、`cancel-restore-incremental-merge` 3、`eq-control-book-incremental-merge` 5）
- [ ] `workflow_operators` 里有 `dataframe.keyed.merge`、`dataframe.ensure.columns`、`dataframe.persist.excel`（6.2 ②）
- [ ] 月度输入源 **20** 个（6.2 ③）
- [ ] `docker compose ps` 两个服务均 Up / healthy
- [ ] `app` 日志无 error / fatal / unhandled / reference not found
- [ ] `GET /api/monthly-runs/source-config` 返回 `workflowVersion = 44`、`sources = 20`、`visible = 13`、只有两个必填（6.3）
- [ ] `GET /api/months` 的标记里含 `hasGrantData` 在内的六个 `has*Data`（6.3）
- [ ] 八个记录页接口带 `?month=` 都返回 2xx（6.3）
- [ ] `GET /api/files` 未登录返回 401
- [ ] 月度工作流版本为 46；`Comment` 为 `Omnibus Inc.Pl.` 的运行不再停在复核；输入源显示「Futu Exercise Record」（见 8.3）
- [ ] 「需复核」的运行历史行，「删除」按钮可用，点删除后该行消失、对应 workflow run 变成 `skipped`（见 8.1）
- [ ] 停在「需复核」时，该行内部有「复核并继续 / 跳过后续」；点一下面板自己走到 23 / 23，全程无需刷新（见 8.2）
- [ ] 「月度更新」页无版本不匹配提示；输入表格 13 行；文件名模板图标只在需上传的行出现（6.4）
- [ ] 四个记录页都有「月份」选择器，无快照月份显示空提示；单侧有数据时自动换视图并提示（6.4）
- [ ] 顶栏「?」能打开引导下拉，条目按左侧导航分组，「当前页」标记跟随当前路由
- [ ] 第 6.5 节若已执行：月度 23 个步骤；记录页快照写在 `<folder>/*_Base_YYYY_MM.xlsx`，并按月累计
- [ ] 冷启动种子已注册：`select count(*) from product_files where uploaded_by = 'BaseSeed'` 返回 **9**（见 10.4）
- [ ] 错位 base 已搬迁：`input/cancel_restore/`、`input/futu_exercises/` 下不再有 `*_Base_*.xlsx`（见 10.8）
- [ ] `git status --short` 干净（若执行了第 2 节）

---

## 8.1 删除卡在「需复核」的月度运行

**现象**：在运行历史里点删除，返回 409「本次月度运行仍在执行中，不能删除；请等待它完成，或在工作流运行面板里取消后再删」。

**为什么会卡住**：某个断言节点按 `failureStrategy: 'warning'` 失败后，工作流会**暂停**在 `waiting_approval` 等人签核。旧代码把 `waiting_approval` 和 `running` 一起拦在删除守卫外，而运行面板上能结束它的只有「继续」「跳过」——这两个操作都会把工作流**往前推**并写出输出，跟"删除"的意图正好相反。于是这条记录既删不掉，也没法简单地丢弃。

**修法**：`DELETE /api/monthly-runs/:id` 现在会先结束这条记录——若它停在 `waiting_approval`，先 `cancelRun()` 把工作流收尾成 `skipped`（未完成的节点标记 skipped，已完成的保留），再走原来的删除逻辑。`cancelRun` 会触发 `applyMonthlyRunPostProcessing`，把历史行状态同步成 `skipped`，因此不会留下孤儿 run。

真正还在执行的（`running` / `pending`）仍然拒绝，但提示改成了可操作的文案。

**操作**：直接点「删除」，无需先点继续/跳过。本轮之前这个按钮在「需复核」行上是**禁用**的（`canDelete` 把 `waiting_approval` 也算作不可删），所以记录会一直卡着；现在只有 `running` / `pending` 锁住，需复核行可删，确认框会额外提示「删除会直接结束这次运行（未完成的步骤标记为跳过），不会产出结果」。删除后该次运行在运行历史里消失，工作流 run 以 `skipped` 收尾。

**若仍然 409**：`waiting_approval` 现在按 **workflow run 的真实状态**判定，不再看历史行那个滞后的 `status`。此前 `applyMonthlyRunPostProcessing` 有意把停在待复核的历史行留在 `running`，而删除判断读的就是历史行，于是「需复核」的行反而一直删不掉（`DELETE` 直接 409）。现在两处都以 run 为准：路由用 `monthly_run_history join workflow_runs` 判断是否要先 `cancelRun`，`deleteMonthlyRunHistory` 也用 `run.status` 做守卫。若删除依旧 409，说明该 run 真的是 `running`：去工作流运行面板取消，等终态后再删。

---

## 8.2 复核后工作流停住（「复核并继续」点了没反应、刷新页面才看到已完成）

**现象**：某节点停在「需复核」，点「复核并继续」后界面不动，一直停在 `12 / 23 需复核`；手动刷新页面后，这次运行其实早就 `completed` 了。

**根因是两个服务端竞态，不是界面刷新问题**：

1. **派发丢弃**。`InProcessWorkflowRunDispatcher.enqueue` 在 run 已激活时直接 `return`——而「人批准」几乎总是发生在触发那次执行还没走完的时候（断言节点刚抛 warning 就在等）。批准的 `startAsync` 因此被丢掉：批准记录写进去了，却没有任何执行接手这个 run。
2. **无条件回写 `waiting_approval`**。worker 抛 warning 后写 `status='waiting_approval'`，`finalizeRun` 也会写一次，都是「先读后写」。人在这中间的几秒里点了批准，于是这些写把已经批准（甚至已经在跑）的 run 又按回 `waiting_approval`，而且此时**没有 pending approval**——谁也唤不醒它。这就是「点了没反应、刷新后已完成」的真身。

**修法（服务端）**：

- 派发器不再丢弃：同一 run 在跑时收到的请求进 `requeued`，当前这轮结束后立刻重放（`all` 会吞并 `single`）。
- 落盘改成条件写：新的 `parkRunForApproval(runId, result?)` 只有**确实还存在 pending approval** 时才把 run 停成 `waiting_approval`（SQL 里 `exists (select 1 ... status = 'pending')`）。worker、`executeRunnableSteps`、`finalizeRun` 三处都改用它；写失败说明人已经批了，就继续往下跑，而不是停住。

**修法（界面）**：复核按钮只看「这次复核提交是否在飞」（`isSubmittingReview`），不再被页面自己的收尾工作挡住；点完立刻 POST，然后面板自己把这次 run 跟到终态（`followRun`）。跟随规则是：**只有「已停住且仍有 pending approval」的 run 才不轮询**（那种状态只能等人），其余非终态都继续读——包括批准后短暂出现的 `waiting_approval`（run 正在被唤醒）和历史遗留的「停住但无 pending」坏状态。回到标签页时（`visibilitychange` / `focus`）还会再读一次，兜住「另一个标签页做了决定」的情况。

**因此不需要让用户刷新**：面板不会提示「请刷新」或提供刷新按钮，它自己会追到 `23 / 23`。

**排查线上的同类残留**：`select r.id, r.status, (select count(*) from workflow_run_approvals a where a.run_id = r.id and a.status = 'pending') pending from workflow_runs r where r.status = 'waiting_approval' and pending = 0;` 命中的是旧的「停住但无 pending」坏 run，直接 `POST /api/workflow-runs/:id/retry-unfinished` 就能让它跑完（本轮实测 run 232 由 `waiting_approval` → `completed`，23/23）。

---

## 8.3 月度工作流 v45：`Omnibus Inc.Pl.` 等写法视为合法输入

**现象**：Control Book 的 `Comment` 写成 `Omnibus Inc.Pl.`（`Pl` 前少一个空格）时，月度运行仍停在 `calc_control_book_metrics` 要人复核，提示「发现 Omnibus 拼写变体」。

**根因**：该守卫（`guard_warn_control_book_comment_variants`，定义在 DB 工作流里）原先用**精确字符串白名单** `in ('Omnibus Inc. Pl', 'Omnibus Inc. Pl.')`，所以任何空格/标点差异都被当成拼写错误。

**改法（工作流定义，v44 → v45）**：判定改为「规范化后比较」——`lower([Comment]) like 'omnibus%inc%pl' or lower([Comment]) like 'omnibus%inc%pl.'`，即大小写、空格、点号差异一律视为格式差异，直接接受；只有单词本身不同（例如 `Ominibus`）才触发复核。同时更新了 failureMessage 与任务描述，说明这一口径。

> 注意：工作流引擎的 SQL 只允许只读查询，`replace()` 被列入禁用关键字（会被当成写语句），所以这里用 `like` 而不是字符串替换。

**必须同步的三处（否则月度页会 409）**：DB `workflow_definitions.version`、种子 `database/workflows/gyre-captable-summary-v2.json` 的 `version`、前端 `MONTHLY_WORKFLOW_VERSION`。三者不一致时月度页会报版本不匹配并拒绝执行。当前为 **v51**（v45 收紧了 Comment 判定，v46 只把输入源标签 `Futu Exercise Report` 改名为 `Futu Exercise Record`，v47 见 8.4，v48 见 8.5，v49 见 8.6，v50 见 8.7，v51 见 8.8）。

**验收**：

```sql
-- 应为 45
select code, version from workflow_definitions where code = 'gyre-captable-summary-v2';
```

执行一个月度运行，Control Book 里 `Comment` 为 `Omnibus Inc.Pl.` 的行**不应**再让运行停在复核；而 `Ominibus Inc. Pl` 这类真拼写差异仍会停下（`src/server/workflow/monthlyCommentVariant.test.ts` 覆盖了这两个方向）。

---

## 8.4 月度工作流 v47：月度常量为 0 时不再阻断（`Cullgen common stock does not match …`）

**现象**：月度页面「月度常量」里 `Cullgen Common Stock` 显示 0 时，运行走到第 12 步 `Calc Business Inputs` 直接 `Failed`，错误为
`Cullgen common stock does not match Global Parameter cullgen_common_stock (actual=0, expected=1)`。

**根因**：`calc_business_inputs` 的输入守卫 `guard_1` 拿「EQ Control Book 算出的 Cullgen common stock」与「月度常量 `fixedValues.cullgenCommonStock`」做等值断言，等值不成立就 block。这个报错里的 `actual=0 / expected=1` 是断言结果而不是股数，所以看不出是哪一边为 0。两种来源都会触发：

- 月度实例 `monthly_run_instances.cullgen_common_stock` 被存成了 0（页面此前允许保存 0，且 `inheritMonthlyFixedValues` 会把 0 原样继承给下个月，越传越远）；
- 月度常量本身没问题、Control Book 里没有 `Agr. & Pl. of Merger` 行（这种情况仍然应该阻断）。

**改法（工作流定义 v46 → v47 + 代码）**：

- 工作流（DB 定义）：`guard_1` / `guard_2` 的 SQL 改为「Control Book 算不出值 → block；常量是 0（未设置）→ 放行；两边都有值且不等 → block」；并各加一条 `failureStrategy: warning` 的守卫 `guard_warn_cullgen_baseline_unset` / `guard_warn_gyre_subplan_baseline_unset`，提示「常量未设置，本次按 Control Book 的值继续」。warning 需要运行页确认后继续，与 Omnibus 拼写提示的处理一致。
- 代码：页面 `parseMonthlyConstantValue` 拒绝 0（月度常量都是股本/期权数，0 不是合法基准值）；`upsertMonthlyRunInstance` 服务端同样拒绝（HTTP 400，提示里写明是哪个列）；`inheritMonthlyFixedValues` 遇到 0 回落到默认值，不再把一个空的基准值传染给以后的月份。已经存成 0 的老行不动（页面照常显示，运行按 warning 放行），管理员看到提示后自行改正。

**必须同步的三处**：DB `workflow_definitions.version`、`database/workflows/gyre-captable-summary-v2.json` 的 `version`、前端 `MONTHLY_WORKFLOW_VERSION` —— 现在都是 **47**。

**验收**：

```sql
-- 应为 47
select code, version from workflow_definitions where code = 'gyre-captable-summary-v2';
```

```bash
# 该月常量为 0 时仍应能出结果（停在复核 → 批准 → completed，汇总里 Cullgen common stock = 14450527）
curl -s -X POST "$BASE/api/monthly-runs" -H 'content-type: application/json' \
  -d '{"month":"2026-05","expectedWorkflowVersion":47}'
```

- `src/server/workflow/monthlyBaselineUnset.test.ts`：常量 0 → 阻断守卫通过、warning 守卫触发；常量非 0 且不一致 → 阻断；Control Book 缺值 → 阻断；并校验守卫通过引擎的 `normalizeInputGuards`（缺 `type` 的守卫会被静默丢掉，正是这一轮踩过的坑）。
- `src/client/monthlyRunPage.test.ts` / `src/server/monthlyRun/instanceStore.test.ts`：0 不能保存、0 不再被继承。

> 注意：守卫 JSON 必须有 `type: "dataframe.sql.assert"`。手写守卫漏掉 `type` 时，引擎在 `normalizeInputGuards` 里会把它丢掉，种子里看着有、运行时却完全不触发。

---

## 8.5 月度工作流 v48 + 参数校验：把「常量为 0」这一类问题一次清干净

**背景**：8.4 修的是「月度常量为 0 时被阻断」。顺着这条线把全部工作流守卫和参数入口审了一遍，又找到三类问题：会误阻断历史月份、会静默算错、以及一处「看起来能改、实际没人读」的死配置。

**工作流（v47 → v48）**：

| 位置 | 问题 | 改法 |
| --- | --- | --- |
| `calc_business_inputs` 的 `guard_1` / `guard_2` | 只有「常量 0 → warning」这一半 | 改成三方规则：两边都有值且不一致 → block；只有一边有值 → 用有值的一方 + warning；两边都没有 → block。`calc_business_inputs` 的 SQL 同时补上回退（Control Book 算不出 Cullgen / SubPlan 时用常量），否则守卫放行了、汇总里的这一列还是空 |
| `build_capitalization_summary` 的 `guard_warn_warrants_baseline_unset` / `guard_warn_cullgen_options_baseline_unset`（新增） | 认股权证、Cullgen 期权这两个常量被直接写进 Total Fully Diluted，为 0 时**静默少算**（认股权证 540,666 股） | 常量为 0（两个 Cullgen 期权常量都为 0）时给 warning，本次照常算但把「漏了一项」摆到运行页 |
| `build_capitalization_summary` 的 `guard_2`（Control Book transfer） | `bc_subplan_transfer_control_book > 0` 会**误阻断历史月份**：Control Book 里 Omnibus 行最早 2025-12，回算 2025-11 及更早时该值合法为 0 | 改成 `>= 0`：0 放行，只有空值（null）阻断 |
| `persist_capitalization_summary` 的 `guard_2`（Options Outstanding- Gyre） | 同上，`> 0` 会把「本月确实没有 Gyre 期权」当成数据错误 | 改成 `>= 0`：0 放行，负数（说明期权总数小于被扣减的 transfer）和空值仍阻断 |

**代码（不需要改工作流版本）**：

- 5% Holders 的四个全局参数：`src/client/fivePercentHoldersPage.ts` 的 `readDrafts`、`src/server/routes/parameters.ts` 的 `fixedValuePatchSchema` 都改成「必须大于 0」；`readDrafts()` 的调用也挪进了 `saveAndRun` 的 `try` 里——此前它在 `try` 外面抛错会变成未处理的 promise rejection，点「确认并运行」什么都不会发生、也看不到任何提示；`hasCompleteFivePercentHolderGlobalParameters` 与 `emptyFivePercentHolderRows` 把 0 视为**未配置**（页面上显示为空而不是 0 股）；`src/server/dataManagementWorkflow/service.ts` 的 `loadFivePercentHolderRuntimeOverrides` 把 0 当缺失直接拒绝启动。此前 0 会一路写进产出（Common Stock 0 / 持股比例 0%），既不阻断也不警告。
- Global Parameter 页面不再列出、也不再允许新建/修改/删除那 5 个月度常量与已退休的 `series_b_preferred_stock`（`unmanagedGlobalParameterKeys`，GET/POST/PATCH/DELETE 四处都排除了；两者的拒绝文案不同，后者会说明 Series B 现在由 Read SERIES B 子流程按 Shares Issued × 5 计算）。月份常量真正的位置是月度实例列，由月度页面维护；`global_parameters` 里同名的行**运行时没有任何代码读取**，此前却能被编辑，最容易让人以为「改了这里就能修好月度运行」。同时删掉了误导性的死函数 `loadMonthlyRunRuntimeFixedValues`（注释还写着「trigger time 从 Global Parameters 读」）。改完这一页会显示「暂无 Global Parameter 配置」——这是正常的：它现在只剩「新增自定义参数」的能力。
- 全局错误处理：`src/server/app.ts` 把 `ZodError` 映射成 **400**（此前请求体校验失败会以 500「服务器错误」返回，并带一坨 issue dump）。

**必须同步的三处**：DB `workflow_definitions.version`、`database/workflows/gyre-captable-summary-v2.json` 的 `version`、前端 `MONTHLY_WORKFLOW_VERSION` —— 现在都是 **48**。

**验收**：

```bash
# 1) 常量为 0：跑过去会停在复核，批准后 completed，且汇总里的 Cullgen common stock 取 Control Book 的 14,450,527
# 2) 认股权证常量为 0：在 build_capitalization_summary 停下，提示「本次 Total Fully Diluted 不含认股权证股数」
# 3) Global Parameter 列表里不再出现 cullgen_common_stock 等 5 个 key
curl -s "$BASE/api/global-parameters" | python3 -m json.tool | grep -c cullgen_common_stock   # 期望 0
```

- `src/server/workflow/monthlyBaselineUnset.test.ts`：三方规则、回退、认股权证/Cullgen 期权 warning、`>= 0` 的两处修复，以及一条结构性检查——任何 `{constants.X}` 占位符必须在用到它的那个 SQL 的 `constants` 里声明。（v48 第一版就因为 `calc_business_inputs` 的 SQL 引用了没声明的常量，单测全绿却在真实运行时报 `SQL constant placeholder is not configured`；这条检查就是为它加的。）
- `src/server/routes/parameters.test.ts`（新增）、`src/server/dataManagementWorkflow/service.test.ts`、`src/client/navigationLayout.test.ts`：0 不再被当作有效参数。

> 还有一处遗留：`GET /api/fixed-values` 现在没有调用方（5% 页面只用到它的 POST/PATCH），本轮没删，看到它列着那 5 个月度常量属于历史残留。

---

## 8.6 月度工作流 v49：Futu 行权数量按「运行月份」截断

**现象**：运营反馈 2026-01 的 `BCI Shares Held by Futu` 不对。业务口径是按**截止 2025 年 12 月底**的行权加总：
`7,815,396 − 2,796,246 = 5,019,150`；系统给出的是 `7,815,396 − 2,938,523 = 4,876,873`。

**根因**：`calc_futu_metrics` 对合并后的 Futu 行权表直接 `sum([Exercised Qty])`，**没有任何按 `Exercise Date` 的截断**；而同一份工作流里 Control Book 的每个指标（EOM、上月余额、BC Subplan 转移量）都带 `wf_month_key([As Of Date]) <= 运行月份`。底表是「到当日」的累计合并结果，所以拿一份含到 2026-05 的底表回算 1 月，等于把 2026-03(23,114) / 04(501) / 05(118,662) 的行权提前算进了扣减项，合计多扣 142,277 股。

> 注意：底表**文件名不能当 as-of 用**。`Futu_Exercises_Base_2026_01.xlsx` 里同样有 2026-03/04/05 的行权行、合计同样是 2,938,523，因为它是「上传的到当日导出 + 增量」合并出来的，命名只表示产出月份。换文件解决不了，只能按 `Exercise Date` 截断。

**改法（v48 → v49）**：

| 位置 | 变更 |
| --- | --- |
| `calc_futu_metrics` 的 SQL | 求和加 `wf_month_key([Exercise Date]) is null or <= {constants.workflowMonth}`（日期为空按计入，与 BC Subplan 那条口径一致，避免格式问题悄悄丢行）；同时输出 `futu_exercised_after_month_qty` / `futu_latest_exercise_month` 供排查 |
| `calc_futu_metrics` 的 `futu` 输入 | 新增 warning 守卫 `guard_warn_futu_exercises_after_month`：底表里存在晚于运行月份的行权行时，提示「已排除 N 行 / M 股（行权日期晚于 X，涉及月份：…）」 |

为什么它以前一直没被守卫发现：`Total Fully Diluted` 不含 BCI，而 `Assert Summary Total Calculation` 只校验「各行相加 = 合计」，BCI 与 `Common Shares OS` 同时偏移照样成立——属于静默算错。

**受影响的月份**（本地按最新底表重算的对照，误差 = 多算的行权/股数）：

| 月份 | 系统给出的已行权 | 按 ≤ 该月应有 | BCI 少算 |
| --- | --- | --- | --- |
| 2026-01 | 2,938,523 | 2,796,246 | 142,277 |
| 2026-03 | 3,034,475 | 2,819,360 | 215,115 |
| 2026-04 | 3,034,475 | 2,819,861 | 214,614 |
| 2026-05 | 3,034,475 | 2,938,523 | 95,952 |
| 2026-06 / 2026-08 | 3,034,475 / 3,116,984 | 同 | 0 |

**必须同步的三处**：DB `workflow_definitions.version`、`database/workflows/gyre-captable-summary-v2.json` 的 `version`、前端 `MONTHLY_WORKFLOW_VERSION` —— 现在都是 **49**。

**验收**（发布后）：

```sql
-- 应为 49
select code, version from workflow_definitions where code = 'gyre-captable-summary-v2';
```

重跑 2026-01 后，产物 `Capitalization Summary` 里应为：

- `BCI Shares Held by Futu` = **5,019,150**
- `Common Shares OS` = **76,801,823**（= 96,963,611 − 14,450,527 − 5,019,150 − 692,111）

运行页同时会停在复核，提示「已排除 3 行 / 142,277 股（行权日期晚于 2026-01，涉及月份：2026-03, 2026-04, 2026-05）」——这是预期行为，确认即可。`src/server/workflow/futuExerciseMonthCutoff.test.ts` 用运营给的这组数把两个方向都钉住了。

> 历史月份（2026-03/04/05）的已发布汇总仍是旧数，重跑会覆盖它们；是否批量重算由需求方决定。

---

## 8.7 月度工作流 v50：Cullgen common stock 在合并前就是 0（撤回「0 = 未设置」）

**现象**：运营把某个月的 `Cullgen Common Stock` 明确设成 0，页面弹出「请填写大于 0 的数值（0 表示未设置…）」，不允许保存。

**根因（两处叠加）**：

1. 8.4/8.5 里把「0」当成「没填」处理（三条守卫 + 页面校验 + 继承回落），这个前提是错的 —— 业务上 0 是合法值。
2. 真正的问题在 Control Book 侧：`cullgen_common_stock` 取的是 `max(Shares Issued where Trans. Type = 'Agr. & Pl. of Merger')` 的**全表口径**，而这一行是 **2026-05** 才出现的（EOM 从 2026-04 的 97,028,322 跳到 2026-05 的 111,488,849，差额正好 14,450,527）。所以回算 2026-05 之前的任何月份时，全表 max 仍然给出 14,450,527，运营填的 0 就被判成「不一致」而阻断。`gyre_2023_china_subplan_total` 同理（那一行是 2024-07）。

**改法（v49 → v50）**：

| 位置 | 变更 |
| --- | --- |
| `calc_control_book_metrics` | `cullgen_common_stock` / `gyre_2023_china_subplan_total` 加上 `wf_month_key([As of Date]) <= {constants.workflowMonth}` 截断并用 `coalesce(..., 0)`：合并前 = 0，合并当月及以后 = 14,450,527；SubPlan 行出现前 = 0 |
| `calc_business_inputs` | 去掉 8.5 加的「Control Book 算不出就回退常量」——有了截断后回退会把合并股数送给合并前的月份；直接用派生值 |
| `calc_business_inputs` 守卫 | 恢复严格比对（相等才通过），删除 `guard_warn_cullgen_baseline_unset` / `guard_warn_gyre_subplan_baseline_unset` 两条「0 = 未设置」warning |
| `build_capitalization_summary` | 删除 `guard_warn_warrants_baseline_unset` / `guard_warn_cullgen_options_baseline_unset`（同一错误前提） |
| 页面 / API | `parseMonthlyConstantValue` 与 `assertWritableMonthlyFixedValues` 接受 0（只拒绝空、负数、非数字）；继承时 0 照原样继承，只有 null / 负数才回落默认值 |

**必须同步的三处**：DB `workflow_definitions.version`、`database/workflows/gyre-captable-summary-v2.json`、前端 `MONTHLY_WORKFLOW_VERSION` —— 现在都是 **50**。

**验收**（2026-01，Cullgen 常量设为 0）：

- 保存 0 成功（PUT 200，页面提示「月度常量已保存」），运行不再卡在 `Calc Business Inputs`；
- 产物 `Capitalization Summary`：`Cullgen common stock` = **0**、`Common Shares OS` = **91,252,350**（96,963,611 − 0 − 5,019,150 − 692,111）、`Total Fully Diluted` 仍为 119,043,433。

> 注意：合并月（2026-05）及以后，常量必须填 14,450,527；填 0 会被守卫正确阻断。`src/server/workflow/monthlyControlBookBaseline.test.ts` 覆盖了这两个方向。

---

## 8.8 月度工作流 v51：BC Subplan transfer 去重（同一笔转账被 base 与增量各记一次）

**现象**：运营反馈 2026-01 的 `2025 BC Subplan shares transferred to Futu` 是 692,111，正确应为 630,454。

**根因**：`Comment` 匹配 Omnibus 的行被**加了两遍**。2026-01 那笔 61,657 股在合并后的 Control Book 里有两行，来源是两种导出格式：

| 来源 | Security | Trans. Type | Trans. No. | Broker No. | Shares Issued | Issued & Outstanding | Comment |
| --- | --- | --- | --- | --- | --- | --- | --- |
| base（Equiniti 明细） | GYRE | BOOK ENTRY ISSUANCE | 空 | 0000010072 | 61,657 | 96,963,611 | Omnibus Inc. Pl. |
| 当月增量（CB Details） | GYRE THERAPEUTICS INC (NEW) | O.I. | `-` | `-` | 61,657 | 96,963,611 | Omnibus Inc.Pl. |

`eq-control-book-incremental-merge` 的合并键要求 `Trans. Type` / `Trans. No.` / `Broker No.` / `Shares Retired` 全部相等，这四个字段在两种格式里都不同，join 匹配不上，于是增量那行被**追加**而不是更新 → 同一笔转账两行 → 求和 692,111（= 630,454 + 61,657）。

月份过滤没有问题：`2026-01 ≤ 2026-01` 本来就该计入，630,454 这个正确值里就包含这一笔（568,797 + 61,657）。时间线也吻合：2026-10-20 之前的运行一直是 630,454 / 660,844 / 695,165，从 10-20 那批开始才多出 61,657。

**改法（v50 → v51）**：

- `calc_control_book_metrics` 的 BC Subplan transfer 求和改为对**经济指纹**去重后再求和：按 `As of Date + Process Date + Shares Issued + Issued & Outstanding` 分组——同一笔转账不可能留下两条相同期末余额的记录；真正两笔同股数转账期末余额不同，仍各自计入。
- 新增 warning 守卫 `guard_warn_bc_subplan_transfer_duplicates`：发现重复组时列出「月份 / 股数」，说明已按一笔计入、建议清理源数据，确认后继续（不阻断）。重复行只与运行月份的取值范围有关（未来的重复不会提前报警）。

**重跑结果**（本地已执行，四个月都已覆盖）：

| 月份 | 旧值 | 新值 |
| --- | --- | --- |
| 2026-01 | 692,111 | **630,454** |
| 2026-03 | 722,501 | **660,844** |
| 2026-04 | 756,822 | **695,165** |
| 2026-05 | 756,822 | **695,165** |
| 2026-06 起 | 695,165 等 | 不变（这些 base 没有重复行） |

**必须同步的三处**：DB `workflow_definitions.version`、`database/workflows/gyre-captable-summary-v2.json`、前端 `MONTHLY_WORKFLOW_VERSION` —— 现在都是 **51**。

**验收**（2026-01）：

- 运行会停在 `Calc Control Book Metrics` 复核，提示「发现 1 组重复的 BC Subplan transfer，已按一笔计入：2026-01 / 61657 股」；
- 产物 `2025 BC Subplan shares transferred to Futu` = **630,454**，`Common Shares OS` = 91,314,007（96,963,611 − 0 − 5,019,150 − 630,454）。

> 后续若要治本：`eq-control-book-incremental-merge` 的合并键应忽略两种格式的呈现差异（`Trans. No.` 空 / `-`、`Broker No.`、`Trans. Type` 的别名），或把经济指纹纳入匹配。那会影响所有字段的合并判定，风险较大，建议单独立项。

---

## 9. 附：本次发布涉及的代码提交

本轮（`cb7bb44..HEAD`）：

- 引擎：`fix(workflow): a caller binding owns the file identity of a fileRef`（`runtimeParameters.ts`
  只从调用方取 `provider`/`key`/`id`，`{}` 明确表示「没有文件」）
- 引擎：`fix(workflow): keep the source columns of an empty select * result`（`sqlUtils.ts`）
- 种子：`fix(workflows): stop pinning historical files in runtime defaults`（6 个定义 + 版本号）
- 前端：`fix(monthly): pin the monthly workflow version to v44`
- 前端：`feat(monthly): let a run parked for review be deleted`（`waiting_approval` 行不再禁用删除）
- 测试：`test(workflow): guard seeds against pinned files and empty-result columns`

完整的 `git log cb7bb44..HEAD` 为准；更早的提交属于上一轮已上线的代码。

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
├── manifest.json                                                        # 契约、列、行数、sha256、base 月份
├── control_book/EQ_Control_Book_Base_2026_06.xlsx                       # base_control_book
├── futu_exercises/Futu_Exercises_Base_2026_06.xlsx                      # base_futu_exercises
├── cancel_restore/Gyre_Therapeutics_Cancel_Restore_Base_2026_06.xlsx    # base_cancel_restore_report
├── cancellation_record/Cancellation_Records_Base_2026_08.xlsx           # cancellation_record_base
├── sold_shares/Futu_Sold_Shares_Base_2026_08.xlsx                       # sold_shares_base
├── grant_record/Futu_Grants_Base_2026_08.xlsx                           # grant_record_futu_base
├── grant_record/Shareworks_Grants_Base_2026_08.xlsx                     # grant_record_shareworks_base
├── exercise_record/Futu_Exercises_Base_2026_08.xlsx                     # exercise_record_futu_base
└── exercise_record/Shareworks_Exec_Base_2026_08.xlsx                    # exercise_record_shareworks_base
```

| 源                                | 契约实测                                    | 行数 |
| --------------------------------- | ------------------------------------------- | ---- |
| `base_control_book`               | `EQ Control Book` / A9:L / 12 列            | 120  |
| `base_futu_exercises`             | `Futu BCI Exercises` / A1:N / 14 列         | 1025 |
| `base_cancel_restore_report`      | `取消与恢复明细` / A1:W / 23 列             | 758  |
| `cancellation_record_base`        | `Cancellation Records` / A1:W / 23 列       | 766  |
| `sold_shares_base`                | `Futu Sold Shares` / A1:S / 19 列           | 21   |
| `grant_record_futu_base`          | `Futu Grants` / A1:AG / 33 列               | 513  |
| `grant_record_shareworks_base`    | `Shareworks Grants` / A1:AB / 28 列         | 126  |
| `exercise_record_futu_base`       | `Futu BCI Exercises to Date` / A1:M / 13 列 | 88   |
| `exercise_record_shareworks_base` | `Shareworks Exec Option OS` / A1:V / 22 列  | 64   |

- 三个月度 `inherit` base 取 **2026-06** 的合并产出（首月可运行月份 = 2026-07）
- 六个记录页 base 取 **2026-08** 的累计快照（**截至 2026-08**，含此前全部记录）

**为什么带上记录页的 base。** 记录页的快照写在 `<folder>/<Name>_Base_YYYY_MM.xlsx`，下个月的合并就按这个路径去继承。空库没有任何 `*_Base_*.xlsx` 时，第一个月只能得到当月增量——把 2026-08 的快照作为种子放进去，新环境**第一次跑 2026-09 就能继承完整历史**，不需要人工上传任何 base。

`previous_capitalization_summary` 仍然**不在种子集里**：它由运行期从上一月 Capitalization Summary 输出自动注入，放种子只会白占体积并且第一月后就过期。

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

期望 **9 行**。容器日志里对应 9 条 `[base-seeds] registered …`：

```
[base-seeds] registered base_control_book @ control_book/EQ_Control_Book_Base_2026_06.xlsx (id=..., 65027 bytes, 1 sheets, 121 rows)
[base-seeds] registered base_futu_exercises @ futu_exercises/Futu_Exercises_Base_2026_06.xlsx (id=..., 519770 bytes, 1 sheets, 1025 rows)
[base-seeds] registered base_cancel_restore_report @ cancel_restore/Gyre_Therapeutics_Cancel_Restore_Base_2026_06.xlsx (id=..., 756036 bytes, 1 sheets, 758 rows)
[base-seeds] registered cancellation_record_base @ cancellation_record/Cancellation_Records_Base_2026_08.xlsx (id=..., 763992 bytes, 1 sheets, 766 rows)
[base-seeds] registered sold_shares_base @ sold_shares/Futu_Sold_Shares_Base_2026_08.xlsx (id=..., 29584 bytes, 1 sheets, 21 rows)
[base-seeds] registered grant_record_futu_base @ grant_record/Futu_Grants_Base_2026_08.xlsx (id=..., 639945 bytes, 1 sheets, 513 rows)
[base-seeds] registered grant_record_shareworks_base @ grant_record/Shareworks_Grants_Base_2026_08.xlsx (id=..., 127302 bytes, 1 sheets, 126 rows)
[base-seeds] registered exercise_record_futu_base @ exercise_record/Futu_Exercises_Base_2026_08.xlsx (id=..., 58347 bytes, 1 sheets, 88 rows)
[base-seeds] registered exercise_record_shareworks_base @ exercise_record/Shareworks_Exec_Base_2026_08.xlsx (id=..., 61558 bytes, 1 sheets, 64 rows)
```

### 10.5 换一批种子 / 重新生成

```bash
# 在有数据的机器上，按当前系统重新导出（会覆盖 database/base-seeds/）
DATABASE_URL='...' npx tsx scripts/export-base-seeds.ts
git add database/base-seeds
```

注意：换了种子文件必须同步改 `gyre-captable-summary-v2` 的 `runtimeParamsDefaults.fileRefs.*.key`，否则默认值指向的路径和种子登记的路径不一致，冷启动依然解析不到。改完按第 4 节重新发布，并 bump 版本。

导出后建议跑一次冷启动校验（用一次性数据库，避免污染现有数据）：

```bash
docker exec <postgres 容器> psql -U captable -d captable -c 'create database gyre_seedtest;'
BASE_SEED_TEST_DATABASE_URL='postgres://captable:captable@127.0.0.1:55433/gyre_seedtest' \
  DATABASE_URL="$BASE_SEED_TEST_DATABASE_URL" npx tsx --test src/server/baseSeeds.test.ts
# 期望 3 tests pass：契约自检、冷启动注册后每个种子都可抽取、错位 base 会被搬迁
```

### 10.6 已修复：cancel_restore base 一直写错目录

**现象**：`cancel_restore/` 目录从来是空的，看起来「取消与恢复合并从不产出 base」。

**根因**：`saveProductWorkbook()` 用 `normalizeProductFileStoragePrefix()` 归一化 `folderPrefix`，而那个函数有一张硬编码白名单——

```ts
if (normalized === 'output' || normalized.startsWith('output/')) return normalized;
if (normalized === 'input' || normalized.startsWith('input/')) return normalized;
if (normalized === 'control_book' || normalized.startsWith('control_book/')) return normalized;
return `input/${normalized}`; // ← 其余一律塞进 input/
```

`workbook.persist.excel` 的 `folderPrefix` 语义是「输出目录」，但走到这里被改写成 `input/<folder>`。于是 `cancel_restore` → `input/cancel_restore/`、`futu_exercises` → `input/futu_exercises/`，而 `injectPreviousMonthBase()` 只在 `cancel_restore/`、`futu_exercises/` 下找。

**base 每个月都正常产出了，只是落在没人查找的目录里**，继承链因此永远链不起来。`control_book` 侥幸在白名单里，所以一直正常。

**修法**：`saveProductWorkbook()` 新增 `declaredOutputFolder` 参数。工作流持久化路径（`context.ts` 的 `saveGeneratedWorkbook`）传 `true`，改用 `normalizeStorageFolderPrefix()`——只校验路径合法性（拒绝 `..` 等），不重写目录。HTTP 上传路径保持原行为：它们本来就会先用 `inputStorageFolderPrefix()` 归一化，语义上确实是「input 下的子目录」。

### 10.7 启动时自动搬迁错位 base（无需人工）

修复只让**今后**的 base 落在正确目录。修复前已经写错位置的历史 base 仍在 `input/cancel_restore/`、`input/futu_exercises/` 下，继承链依然接不上。

`relocateMisplacedBaseFiles()` 在初始化时把它们搬回工作流声明的目录：

- 只匹配 `*_Base_<yyyy_MM>.xlsx`（工作流产出），**同目录的人工上传不动**
- 连存储里的字节一起搬（`fileStorage` 按 `file_path` 寻址，只改库会让后续 overwrite 写到新路径、旧对象变孤儿）
- 目标路径已存在则跳过，不会覆盖
- 幂等，可重复执行

日志形如：

```
[base-seeds] relocated input/cancel_restore/Gyre_Therapeutics_Cancel_Restore_Base_2026_06.xlsx -> cancel_restore/Gyre_Therapeutics_Cancel_Restore_Base_2026_06.xlsx
[base-seeds] registered=3 relocated=1 skipped=0
```

**种子注册与错位 base 搬迁都由初始化自动完成**（幂等）。本轮人工要做的只有第 4 节的定义发布；种子逻辑与上一轮相同，若云端已有 3 个 `BaseSeed` 就会跳过。

### 10.8 验证搬迁生效

```sql
-- 应只剩人工上传，没有任何 *_Base_* 残留
select id, logical_path, uploaded_by from product_files
 where logical_path like 'input/cancel_restore/%' or logical_path like 'input/futu_exercises/%'
 order by logical_path;

-- 三个 base 都应在声明目录下
select logical_path, uploaded_by, workbook_row_count from product_files
 where logical_path ~ '/(control_book|futu_exercises|cancel_restore)/.*_Base_'
 order by logical_path;
```

若第一条仍返回 `*_Base_*.xlsx`，说明搬迁没跑（看容器日志有没有 `relocated`）。此时可用兜底 SQL——**只改 `logical_path`，不动 `file_path`**：读取走 `file_path` 所以不会坏，但存储对象还留在旧目录，属于可接受的降级。

```sql
update product_files
   set logical_path = 'cancel_restore/' || regexp_replace(logical_path, '^input/cancel_restore/', '')
 where logical_path ~ '^input/cancel_restore/.*_Base_\d{4}_\d{2}\.xlsx$'
   and not exists (
     select 1 from product_files p2
      where lower(p2.logical_path) = lower('cancel_restore/' || regexp_replace(product_files.logical_path, '^input/cancel_restore/', ''))
   );

update product_files
   set logical_path = 'futu_exercises/' || regexp_replace(logical_path, '^input/futu_exercises/', '')
 where logical_path ~ '^input/futu_exercises/.*_Base_\d{4}_\d{2}\.xlsx$'
   and not exists (
     select 1 from product_files p2
      where lower(p2.logical_path) = lower('futu_exercises/' || regexp_replace(product_files.logical_path, '^input/futu_exercises/', ''))
   );
```

### 10.9 遗留事项

1. 种子是快照，不自动更新。系统正常按月跑起来后，新 base 由工作流自己产出并被 `injectPreviousMonthBase()` 接管。
2. 首月可运行月份是 **2026-07**（种子是 2026-06 的 base）。

---

## 11. 本轮新增的运行时注意事项

### 11.1 记录页快照是「截至当月」的累计，输入要按月给增量

四个记录页（授予 / 行权 / 卖出 / 取消）的快照 = 上一月快照 + 本月导出，幂等合并。由此带来几条操作规则：

- **按月份升序跑**才能看到累计效果；跳着跑（比如先跑 8 月再跑 5 月）不会补上中间月份的数据
- base 由系统自动注入，页面上不显示，**不需要也不要手工上传**；想覆盖就显式选一个文件（显式绑定优先）
- 每个视图的快照写在 `<folder>/*_Base_YYYY_MM.xlsx`（`grant_record/` `exercise_record/` `sold_shares/` `cancellation_record/`），同一月重跑会**覆盖**同一路径（`overwrite`）
- `shareworks_grants` / `futu_grants` / `sold_shares_futu` / `incremental_futu_exercises` 这些是「当月增量或截至当月的全量导出」，两种都能吃（合并不产生重复行），但**不要把某个月的导出当作另一个月的增量**——数据会被贴错月份
- 空输入不会写入 0 行文件（`skipWhenEmpty`），所以某月没配置某视图时，该视图保留上一月的内容而不是被清空

### 11.2 `historical_runs` 没有 month 的老数据

本轮之前产生的 `workflow_runs` 都没有 `month` 参数，因此**不会出现在任何月份视图里**。这是有意的（不回填），不是数据丢失：文件仍在 Files 里。

### 11.3 月度会停在 `waiting_approval` 是预期行为

`calc_control_book_metrics` 发现 Control Book 的 Comment 列存在 Omnibus 拼写变体时会抛 warning 并暂停，等人批准。批准后继续；不批准就一直停着（删除该条月度记录也会把它收尾成 `skipped`，见 8.1）。

### 11.4 已知遗留（不影响本轮验收）

| 项                         | 说明                                                                                                                 |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 同月重复运行会累积快照文件 | 页面按 `finished_at` 取最新，功能无影响；Files 里会看到多份带版本号的文件                                            |
| 空行残留                   | Shareworks 两个视图的快照里可能带 1-2 行全空行（源表中间的空行），页面按工号/授予编号过滤，展示不受影响              |
| 2026-08 授予记录           | 该月 Shareworks 导出缺 `Middle Name` 列，已由 `dataframe.ensure.columns` 兜住；Futu 侧没有分月导出，故 Futu 视图为空 |
| 记录页同步失败会连坐整次月度 | 四个记录页 `workflow.invoke`（grant/exercise/sold-shares/cancellation）出错时该 run 直接 `failed`，主交付物也不出。这是**有意为之**（用户 2026-10-27 定调「同进同退」），不要改成静默放行；处理路径是修根因（如 #1825 的补列） |

### 11.5 本轮修复的三类线上故障（发布后应消失）

线上 2026-01 那次月度运行（workflow run 25）曾有三步 `failed`，本轮发布后应全部 completed：

| 步骤                          | 之前的确切报错                                                                           | 根因                                                                 |
| ----------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `invoke_read_series_b`        | `Product file not found: input/series-b/Control_Books_Detail_Data_16.09.2026_19.31.xlsx` | 线上 `read-series-b` 还是 v1（必填抽取 + 默认值硬编码 9 月历史文件） |
| `invoke_futu_exercises_merge` | `Product file not found: input/2026-08/Gyre Therapeutics员工行权记录.xlsx`               | 子流程默认值里的 2026-08 历史文件被深合并补回                        |
| `invoke_plan_summary_sync`    | `Sheet Options OS Detail not found`                                                      | 线上 `plan-summary-sync` 还是 v1，仍从 Shareworks 抓旧 sheet         |

排查这类「页面显示可选、运行却读历史文件」的问题，先比对**线上定义版本 vs 仓库种子版本**（`select code, version from workflow_definitions;` 对照 `database/workflows/*.json` 的 `version`），再比对 `runtimeParamsDefaults.fileRefs.*` 里有没有 `provider`/`key`/`id`。两者都不该有历史文件身份。

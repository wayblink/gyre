# 云端部署执行手册

> 面向在云上执行部署的 agent。本文自包含：每条命令都可直接复制运行，每个破坏性操作前都有检查点。
> **不要跳过第 1 节的安全边界。** 遇到「停下来报告」的条件时，停下来，把输出原样贴回给需求方，不要自行决定继续。

- 适用代码版本：`feat/esop-workflows-docs-deploy` 分支 HEAD `a9ced7d`（提交清单见第 9 节）
- 上一轮部署的基线：`44dcec8`（月度工作流定义 v20）
- 本轮目标：月度工作流定义 **v36**，另有 7 个子工作流定义需要发布
- 部署形态：Fastify + 打包前端 + Postgres，单容器（Dockerfile 两阶段构建）
- 云上编排：`docker-compose.prod.yml`（app + postgres + Caddy 反代网）

---

## 0. 一分钟背景（为什么有这些步骤）

这一轮只有一项**必须人工执行**的数据库变更：发布工作流定义。本轮涉及的 8 个定义版本都变了，而应用启动时的 seed 逻辑是 `insert ... on conflict (code) do nothing`——**只补缺失的定义，绝不覆盖已有行**。已有的（月度、行权、卖出、计划汇总等）必须显式发布，重启容器不会带上它们。

为什么必须发布，而不是「旧的就旧着用」：前端硬编码了 `MONTHLY_WORKFLOW_VERSION = 36`，服务端拿数据库里的 `workflow_definitions.version` 跟它比对。**不一致时月度更新页报「版本不匹配」并拒绝执行**（`POST /api/monthly-runs` 返回 409）。这不是降级，是硬失效。

本轮不含任何 `schema.ts` 变更（建表/加列都是更早的版本做的），所以**没有手写 DDL**；重启时应用会照旧执行幂等迁移。

其余改动（记录页月级快照、月度集成、输入源说明与文件名模板、若干 UI 修复）都在代码里，随镜像上线。

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
| `--force` 发布工作流定义                                               | 只有云端版本**高于** 36 时才需要，那是异常状态                |
| 修改 `AUTH_DISABLED`、`AUTH_BOOTSTRAP_SECRET`、`SESSION_COOKIE_SECURE` | 安全相关配置                                                  |
| 导入演示数据（`DEMO_SEED_ON_INIT=true` / `npm run seed:demo`）         | 会写业务数据                                                  |

### 停下来报告的条件

- 第 3 节预检 SQL ① 返回非 0
- `workflow_definitions` 里 `gyre-captable-summary-v2` 的 version **大于 36**
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
  'gyre-cloud-a9ced7d.tar.gz' \
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

本轮 `database/workflows/*.json` 里版本有变化的定义如下。**全部都要发布**——子工作流虽然由月度 invoke 调用，但它们读的也是 DB 里的定义，旧版本会让月度写不出记录页快照。

| code                                                   | 目标版本 | 说明                                            |
| ------------------------------------------------------ | -------- | ----------------------------------------------- |
| `gyre-captable-summary-v2`                             | **36**   | 月度主工作流（前端版本守卫比的就是它）          |
| `esop-exercise-record-sync`                            | **5**    | 行权记录（含 Shareworks 视图，可空输入不落盘）  |
| `esop-sold-shares-sync`                                | **3**    | 卖出记录                                        |
| `esop-cancellation-record-sync`                        | **2**    | 取消记录（本轮新增页面用）                      |
| `esop-grant-record-sync`                               | **6**    | 授予记录（含 `dataframe.ensure.columns` 新算子） |
| `read-series-b`                                        | **2**    | 月度子流程：Series B                           |
| `futu-exercises-incremental-merge`                     | **4**    | 月度子流程：富途行权增量合并                    |
| `gyre-therapeutics-cancel-restore-incremental-merge`   | **2**    | 月度子流程：取消与恢复增量合并                  |

其余定义（`plan-summary-sync`、`option-plans-summary-values`、`eq-control-book-incremental-merge`、`five-percent-holders-sync`、`esop-transfer-to-futu-sync`、`employee-import` 等）本轮未改版本；若云端缺失会被启动时的 seed 自动补上，**已存在且版本一致就不用动**。

> 判断方法：`select code, version from workflow_definitions;` 与上表对比。低于目标版本的才需要发布；发布脚本会拒绝版本倒退，所以重复执行是安全的。

### 4.2 方式 A（推荐）：在运行中的应用容器内执行

镜像里已经带了编译好的发布脚本和 `database/` 目录，且容器环境里已有 `DATABASE_URL`，不需要额外装任何东西。

```bash
cd <项目根目录>

# 1) 先全部 dry-run：同一事务但 rollback，只验证能读、能连、版本没倒退
for code in \
  gyre-captable-summary-v2 \
  esop-exercise-record-sync \
  esop-sold-shares-sync \
  esop-cancellation-record-sync \
  esop-grant-record-sync \
  read-series-b \
  futu-exercises-incremental-merge \
  gyre-therapeutics-cancel-restore-incremental-merge; do
  docker compose -f docker-compose.prod.yml exec app \
    node dist/src/server/workflow/publishWorkflowSeed.js "$code" --dry-run
done

# 期望：每个都输出
#   validated <code> v<N> from database/workflows/<code>.json (workflow_id=..., version_id=...)
# 其中 gyre-captable-summary-v2 必须是 v36

# 2) 确认无误后正式发布
for code in \
  gyre-captable-summary-v2 \
  esop-exercise-record-sync \
  esop-sold-shares-sync \
  esop-cancellation-record-sync \
  esop-grant-record-sync \
  read-series-b \
  futu-exercises-incremental-merge \
  gyre-therapeutics-cancel-restore-incremental-merge; do
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
for code in gyre-captable-summary-v2 esop-exercise-record-sync esop-sold-shares-sync \
            esop-cancellation-record-sync esop-grant-record-sync read-series-b \
            futu-exercises-incremental-merge gyre-therapeutics-cancel-restore-incremental-merge; do
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

node /tmp/gen-publish-sql.mjs gyre-captable-summary-v2 esop-grant-record-sync > /tmp/publish.sql
grep -o "where code = '[^']*'" /tmp/publish.sql   # 自检
psql "$DATABASE_URL" -f /tmp/publish.sql
```

> jsonb 不保留键顺序，校验时要用**深比较**，直接字符串比对会误报。

### 4.5 这一轮到底改了什么

| 范围 | 变更 |
| ---- | ---- |
| `gyre-captable-summary-v2` v20 → v36 | 输入源 10 → **14**（新增 `exercise_record_shareworks`、`sold_shares_futu`、`shareworks_grants`、`futu_grants`，全部可选且带文件名模板）；任务 19 → **23**（新增 4 个 `workflow.invoke`：行权/卖出/取消/授予记录同步）；`previous_capitalization_summary` 改为 `hidden: true`（系统自动注入，不再占一行） |
| 新增算子 | `dataframe.ensure.columns`：输入缺声明列时补空。由启动时的 `workflow_operators` upsert 自动注册，**无需手工操作**（第 6.2 节有校验 SQL） |
| 记录页月级快照 | 行权/卖出/取消/授予四个 sync 定义都加了 `month`、`monthUnderscore`、文件名月份后缀；输出文件名形如 `cancellation_records_2026_08.v20261020….xlsx` |
| 月度集成 | 月度运行结束时通过 `workflow.invoke` 调上述四个 sync，并把子流程 `persist` 产物按子节点 task id 级联到月度 run 上；`skipWhenEmpty` 保证未配置的源直接跳过、不产空快照、不阻断 |
| 记录页入口 | 四个页面都有月份选择器；`/api/holdings`、`/api/exercises(+shareworks/merge)`、`/api/sold-shares`、`/api/cancellation-records` 都接受 `?month=`；`/api/months` 增加 `hasExerciseData` / `hasSoldSharesData` / `hasCancellationData` / `hasGrantData` |
| 新增页面 | 「取消记录」（`/cancellation-record`，导航在「卖出记录」下面） |

**已存在的 `workflow_runs` 不受影响**：它们各自快照了 `tasks_snapshot_json`，并通过 `version_id` 指向旧版本行。

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
-- ① 八个定义的版本必须与第 4.1 节的表一致
select code, version, status
  from workflow_definitions
 where code in (
   'gyre-captable-summary-v2', 'esop-exercise-record-sync', 'esop-sold-shares-sync',
   'esop-cancellation-record-sync', 'esop-grant-record-sync', 'read-series-b',
   'futu-exercises-incremental-merge', 'gyre-therapeutics-cancel-restore-incremental-merge'
 )
 order by code;
-- 期望：gyre-captable-summary-v2 = 36，其余见 4.1 表格

-- ② v36 已 published；更早版本仍在（历史 run 指着各自版本）
select version, status, published_at
  from workflow_definition_versions
 where workflow_id = (select id from workflow_definitions where code = 'gyre-captable-summary-v2')
 order by version desc limit 3;

-- ③ 新算子已由启动时的 upsert 注册（grant v6 依赖它）
select code, version from workflow_operators where code = 'dataframe.ensure.columns';
-- 期望：1 行，v1.0.0；若为空说明 WORKFLOW_SEED_ON_INIT 没开或启动日志有错，先解决再继续

-- ④ 月度输入源个数（schema 里 14 个，含 1 个 hidden）
select jsonb_object_keys(runtime_params_schema_json->'fileRefs'->'properties') as source
  from workflow_definitions where code = 'gyre-captable-summary-v2';
-- 期望：14 行
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
print('required =', [s['sourceKey'] for s in d['sources'] if s.get('required')])
print('hidden =', [s['sourceKey'] for s in d['sources'] if s.get('hidden')])
for s in d['sources']:
    print('  ', s['sourceKey'], '| sheet:', repr(s.get('defaultSheetName')), '| template:', s.get('fileTemplate'))
"
```

**期望**：

- `workflowVersion = 36`
- `sources = 14`
- `required = ['incremental_control_book', 'option_plans_summary']`（**只有这两个必填**，其余都可选）
- `hidden = ['previous_capitalization_summary']`（系统自动注入，页面上不显示）

若 `workflowVersion` 还是 20，说明第 4 节没生效——**不要继续**，回去重跑。

```bash
# 月份标记接口（本轮新增四个 has*Data）
curl -s "$BASE/api/months" | python3 -c "
import sys, json
months = json.load(sys.stdin)['months']
keys = [k for k in months[0] if k.startswith('has')]
print('flags =', keys)
print('latest =', months[0])
"
```

**期望** `flags` 含 `hasCapTableData` / `hasPlanSummaryData` / `hasExerciseData` / `hasSoldSharesData` / `hasCancellationData` / `hasGrantData` 六项。新库这些标记全为 `false` 是正常的（还没有按下月的快照）。

```bash
# 新页面接口：未登录 401；登录后无快照月份返回空集合而不是 500
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/api/cancellation-records?month=2026-09"
```

### 6.4 页面冒烟（只读）

用浏览器登录后逐页打开，确认无白屏、无控制台报错：

`股权汇总` → `月度更新` → `ESOP 明细` → `授予记录` → `行权记录` → `卖出记录` → `取消记录` → `转仓计划` → `员工管理` → `计划汇总` → `5% 股东` → `全局参数` → `数据管理` → `文件中心` → `工作流` → `用户管理` → `使用手册` → `账号设置` → `系统设置`

在「月度更新」页额外确认：

- 顶部**没有**「版本不匹配」红色提示
- 输入文件表格是 **13 行**（14 个源减去 hidden 的 `previous_capitalization_summary`）
- 每个需要上传的源，说明文字右边有一个 📄 图标；点开显示「文件名参考」和对应的文件名模板；自动带出的源没有图标
- 「配置输入源」弹窗里，选好文件后出现 **输入 Sheet** 下拉，默认选中配置的 sheet

在四个记录页（授予 / 行权 / 卖出 / 取消）额外确认：

- hero 区有 **月份** 选择器（不是「SourceFile」字样）
- 切换到没有快照的月份时，表格显示「暂无符合条件的…记录」，而不是上一个月的数据

### 6.5 月度运行冒烟（需需求方明确批准）

**默认不做。** 这一步会真实执行业务工作流、写文件、改实例状态。

若需求方批准：

1. 在「月度更新」页把**两个必填源**选好（`incremental_control_book`、`option_plans_summary`），并按需补可选源
2. 点执行
3. 期望：不再出现启动前的拒绝（`Missing source binding:` / `Missing source sheet name:` / `月度运行输入文件不可用：`）
4. 运行面板应有 **23 个步骤**；四个 `invoke_*_record_sync` 只要对应源已配置就会 completed，未配置的直接跳过（不产空文件、不报错）
5. 跑完后 `/api/months` 里该月的 `has*Data` 应变为 `true`，对应记录页能看到当月快照

> 注意：月度运行常在 `calc_control_book_metrics` 因 Omnibus 拼写变体告警暂停在 `waiting_approval`，需要人工批准后继续——这是**预期行为**，不是故障。

## 7. 回滚

### 7.1 只回滚工作流定义（保留新镜像）

**没有意义**：前端常量是 36，把数据库回滚到 35 或更早，月度页会重新进入「版本不匹配」并拒绝执行。要回滚定义就必须连镜像一起回。

### 7.2 回滚整个版本

```bash
# 回到本轮之前的基线
git checkout 44dcec8
AUTH_BOOTSTRAP_SECRET='<口令>' docker compose -f docker-compose.prod.yml up -d --build
```

镜像起来后，数据库里的定义仍是 v36，而旧镜像的前端期望 v20 → 月度页会报版本不匹配。**必须把定义也随之回退**：

```bash
# 用基线里的 JSON 覆盖工作区里的种子文件，再强制发布（--force 因为云端版本高于种子）
git show 44dcec8:database/workflows/gyre-captable-summary-v2.json \
  > database/workflows/gyre-captable-summary-v2.json
docker compose -f docker-compose.prod.yml exec app \
  node dist/src/server/workflow/publishWorkflowSeed.js gyre-captable-summary-v2 --dry-run --force
docker compose -f docker-compose.prod.yml exec app \
  node dist/src/server/workflow/publishWorkflowSeed.js gyre-captable-summary-v2 --force
```

> `--force` 是本节唯一许可的强制发布场景（云端 36 高于种子 20）。子工作流的回退按同样方式逐个处理。

数据卷 `pgdata` / `appdata` 不动。已产生的 `workflow_runs`、`monthly_run_history`、`product_files` 记录保留；本轮新产生的带月份后缀的快照文件也可以留着（旧代码不会读它们，只是 Files 里多几个文件）。

## 8. 完成标准（全部打勾才算完成）

- [ ] 第 3 节预检 ① 返回 0；② ③ 若为 1 已报告并得到许可
- [ ] 八个定义已发布，版本与 4.1 节表格一致（`gyre-captable-summary-v2` = **36**）
- [ ] `workflow_operators` 里有 `dataframe.ensure.columns` v1.0.0（6.2 ③）
- [ ] `docker compose ps` 两个服务均 Up / healthy
- [ ] `app` 日志无 error / fatal / unhandled / reference not found
- [ ] `GET /api/monthly-runs/source-config` 返回 `workflowVersion = 36`、**14** 个源、只有两个必填、hidden 只有一处（6.3）
- [ ] `GET /api/months` 的标记里含 `hasGrantData` 在内的六个 `has*Data`（6.3）
- [ ] `/api/cancellation-records` 未登录 401、无快照月份返回空集合（6.3）
- [ ] `GET /api/files` 未登录返回 401
- [ ] 「月度更新」页无版本不匹配提示；输入表格 13 行；文件名模板图标只在需上传的行出现（6.4）
- [ ] 四个记录页都有「月份」选择器，无快照月份显示空提示（6.4）
- [ ] 第 6.5 节若已执行：月度 23 个步骤，四个 invoke 按配置情况 completed 或跳过
- [ ] 冷启动种子已注册：`select count(*) from product_files where uploaded_by = 'BaseSeed'` 返回 3（见 10.4）
- [ ] 错位 base 已搬迁：`input/cancel_restore/`、`input/futu_exercises/` 下不再有 `*_Base_*.xlsx`（见 10.8）
- [ ] `git status --short` 干净（若执行了第 2 节）

---

## 8.1 删除卡在「需复核」的月度运行

**现象**：在运行历史里点删除，返回 409「本次月度运行仍在执行中，不能删除；请等待它完成，或在工作流运行面板里取消后再删」。

**为什么会卡住**：某个断言节点按 `failureStrategy: 'warning'` 失败后，工作流会**暂停**在 `waiting_approval` 等人签核。旧代码把 `waiting_approval` 和 `running` 一起拦在删除守卫外，而运行面板上能结束它的只有「继续」「跳过」——这两个操作都会把工作流**往前推**并写出输出，跟"删除"的意图正好相反。于是这条记录既删不掉，也没法简单地丢弃。

**修法**：`DELETE /api/monthly-runs/:id` 现在会先结束这条记录——若它停在 `waiting_approval`，先 `cancelRun()` 把工作流收尾成 `skipped`（未完成的节点标记 skipped，已完成的保留），再走原来的删除逻辑。`cancelRun` 会触发 `applyMonthlyRunPostProcessing`，把历史行状态同步成 `skipped`，因此不会留下孤儿 run。

真正还在执行的（`running` / `pending`）仍然拒绝，但提示改成了可操作的文案。

**操作**：直接点删除即可，无需先点继续/跳过。删除后该次运行在运行历史里消失，工作流 run 以 `skipped` 收尾。

**若仍然 409**：说明这条记录确实是 `running`。去工作流运行面板找到对应 run，点取消，等状态变成终态后再删。

---

## 9. 附：本次发布涉及的代码提交

本轮（`44dcec8..a9ced7d`，24 个提交）：

```
a9ced7d fix(grant): tolerate an export that drops the Middle Name column
c7ab23f fix(grant): let the page run with only one optional source
8165f58 feat(monthly): invoke the grant record sync
112cb02 fix(ui): month picker caption rendered as "SourceFile" on every record page
7f90fa4 feat(grant): month picker on the grant record page
a5a4a2a feat(grant): resolve grant snapshots per month
8d0ff8e feat(grant): month snapshot support in the grant record sync
e8db15d refactor(months): stop hardcoding the monthly workflow code
4fdfa84 refactor(monthly): one reader for the file-name template; fix the dangling doc
a42c012 fix(workflow): cascade a child's files whatever its final result is
cf6cd6c fix(invoke): reject a skipWhenEmpty path nobody declares
a74c48d feat(persist): let an empty input leave the folder alone
272a5fa fix(monthly): wire the pattern icon in the configuration card too
9ccd36e style(monthly): put the file-name icon under the required/optional badge
6be9306 style(monthly): collapse the file-name pattern behind an icon
c23e7f3 feat(monthly): hide Previous Capitalization Summary from the input table
f2b8346 feat(monthly): no file-name pattern on inherited inputs
4357808 style(monthly): give the file-name pattern the input badge treatment
5ab35ef feat(monthly): show each input's file-name pattern
b8f1adf fix(months): count either exercise view when flagging a month
2dcf2d9 feat(monthly): invoke the record-page syncs instead of spawning runs
8807538 fix(monthly): give each record page its own month-tagged run
aff9fb1 refactor(monthly): read the exercise-record snapshot from the same Futu export
12f8ec3 checkpoint: monthly inputs, cancellation records page, and month snapshots
```

上一轮的基线 `44dcec8` 及其之前的提交不在此列（那次部署已经在云端生效）。

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
├── manifest.json                                              # 每个种子的契约、列、行数、sha256、base 月份
├── control_book/EQ_Control_Book_Base_2026_06.xlsx             # base_control_book
├── futu_exercises/Futu_Exercises_Base_2026_06.xlsx            # base_futu_exercises
└── cancel_restore/Gyre_Therapeutics_Cancel_Restore_Base_2026_06.xlsx  # base_cancel_restore_report
```

| 源                           | 契约实测                                    |
| ---------------------------- | ------------------------------------------- |
| `base_control_book`          | `EQ Control Book` / A9:L / 12 列 120 行     |
| `base_futu_exercises`        | `Futu BCI Exercises` / A1:N / 14 列 1025 行 |
| `base_cancel_restore_report` | `取消与恢复明细` / A1:W / 23 列 758 行      |

三个种子统一取 **2026-06** 的合并产出。

**为什么一个月份就够。** base 是「截至上月末的累计 to-date 状态」，不是当月快照；月度合并按自然键幂等，且增量只取当月行。所以拿 2026-06 的 base 去跑 2026-07、2026-09 或更晚都成立——**首月可运行月份统一是 2026-07**。已在 dev 库实测：2026-06 种子下，2026-07 与 2026-09 的计划里三个 `base_*` 都解析到真实文件。

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
[base-seeds] registered base_control_book @ control_book/EQ_Control_Book_Base_2026_06.xlsx (id=..., 65027 bytes, 1 sheets, 121 rows)
[base-seeds] registered base_futu_exercises @ futu_exercises/Futu_Exercises_Base_2026_06.xlsx (id=..., 519770 bytes, 1 sheets, 1025 rows)
[base-seeds] registered base_cancel_restore_report @ cancel_restore/Gyre_Therapeutics_Cancel_Restore_Base_2026_06.xlsx (id=..., 756036 bytes, 1 sheets, 758 rows)
```

### 10.5 换一批种子 / 重新生成

```bash
# 在有数据的机器上，按当前系统重新导出（会覆盖 database/base-seeds/）
DATABASE_URL='...' npx tsx scripts/export-base-seeds.ts
git add database/base-seeds
```

注意：换了种子文件必须同步改 `gyre-captable-summary-v2` 的 `runtimeParamsDefaults.fileRefs.*.key`，否则默认值指向的路径和种子登记的路径不一致，冷启动依然解析不到。改完按第 4 节重新发布，并 bump 版本。

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

### 11.1 记录页快照需要「按月」的输入

四个记录页（授予 / 行权 / 卖出 / 取消）按 `run.runtime_parameters_json->>'month'` 取快照。月度运行会把当前月份透传给子工作流，所以：

- 月度里**没有**配置某个记录页的源 → 该页当月为空，但**不会**产出一个 0 行的空文件去覆盖已有的快照（`skipWhenEmpty`）
- 想看到某月的记录页数据，就要么在月度里配置该月的源、要么在记录页手动「更新」并选好月份
- `shareworks_grants` / `futu_grants` / `sold_shares_futu` / `incremental_futu_exercises` 这些源都是按月不同的导出，**不要把某个月的文件复用到别的月份**（会得到数据正确、月份标签错误的快照）

### 11.2 `historical_runs` 没有 month 的老数据

本轮之前产生的 `workflow_runs` 都没有 `month` 参数，因此**不会出现在任何月份视图里**。这是有意的（不回填），不是数据丢失：文件仍在 Files 里。

### 11.3 月度会停在 `waiting_approval` 是预期行为

`calc_control_book_metrics` 发现 Control Book 的 Comment 列存在 Omnibus 拼写变体时会抛 warning 并暂停，等人批准。批准后继续；不批准就一直停着（删除该条月度记录也会把它收尾成 `skipped`，见 8.1）。

### 11.4 已知遗留（不影响本轮验收）

| 项 | 说明 |
| --- | --- |
| 同月重复运行会累积快照文件 | 页面按 `finished_at` 取最新，功能无影响；Files 里会看到多份带版本号的文件 |
| 空行残留 | Shareworks 两个视图的快照里可能带 1-2 行全空行（源表中间的空行），页面按工号/授予编号过滤，展示不受影响 |
| 2026-08 授予记录 | 该月 Shareworks 导出缺 `Middle Name` 列，已由 `dataframe.ensure.columns` 兜住；Futu 侧没有分月导出，故 Futu 视图为空 |

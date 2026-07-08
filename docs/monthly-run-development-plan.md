# 月度执行页 — 开发计划

> 状态：计划稿（待评审）｜最后更新：2026-06-28
> 范围：把已有 workflow 执行引擎接入月度业务，新增独立 tab 的"月度执行"页。本文件只做计划，不含代码。

## 1. 背景与目标

Gyre ESOP 系统每月需要：上传外部平台（Shareworks / Futu）导出的 xlsx 源数据 → 计算 → 产出结果 xlsx → 刷新首页 Cap Table Summary。底层 workflow 执行引擎（编排/执行/状态/审批/运行时参数/产物）已在提交 fbcf515 落地并通过测试，但业务侧还没有页面调用它：现有 Monthly Updates 页的"确认更新"走占位接口 generate-snapshot，只标记完成、不计算。

目标：新增独立 tab 的"月度执行"页，实现"选月 → 上传源 xlsx → 触发月度 workflow → 显示状态/步骤/审批 → 产出 xlsx 自动刷新 Summary → 记录执行历史"。先单开一页，后续替换现有 Monthly Updates。

## 2. 已确认的产品决策

1. 专用月度页 + 配好一个月度 workflow（把 id=159 `gyre-captable-summary` 参数化作为被调用工作流）。
2. 产出→Summary 用 xlsx 作载体：产出 xlsx 落 product_files → 自动调 `PUT /api/months/:month/capitalization-source` 设为当月数据源 → Summary 实时解析显示。**严格约束：历史快照/版本回看也以 xlsx 为载体（每月一份产出 xlsx 即快照），不写 calculation_snapshots、不建内部聚合表、不 hardcode。**
3. 执行历史用业务表 monthly_run_history（元数据审计，与决策 2 不冲突）。

## 3. 架构隔离原则（贯穿执行）

- 单向依赖：业务 → workflow 引擎，永不反向。引擎不感知 months / monthly_run_history / capitalization 等业务概念。
- 算子解耦：算子不 import 业务，副作用走 context.runtime 注入，业务语义数据驱动，业务专属算子走 registry 扩展点。
- 数据库：不拆物理 schema，单库 + workflow_ 前缀；业务→库只用逻辑 id 列、不加跨界外键（monthly_run_history.workflow_id / workflow_run_id 用纯 integer）。
- 本阶段以"代码隔离 + 单向依赖"为主；workflow 物理目录归位（src/workflow/）作为后续独立重构，与本功能不冲突、可并行。

## 4. 月度 workflow 参数化（id=159）

runtime_params_schema_json：
- month: { type: string, required: true }
- fileIds: { type: object, required: true, properties: { captable_book: { type: number, required: true } } }

runtime_params_defaults_json：{ "fileIds": { "captable_book": 7 } }（month 不设默认，强制必填）。

3 个 extract task（extract_control_book / extract_futu_exercises / extract_option_plans）的 params.fileId 由 7 改为 { "$fromRuntime": "fileIds.captable_book" }。SQL 里 hardcode 常数（7815396 / 14450527 / 133527447）V1 保留，后续以 fixedValues.* 参数化。

落库：写进 workflow seed（按 code 幂等 upsert），可版本控制、可重放，不手动 PATCH。注意尊重 UI 编辑：建议仅在该 workflow 尚未配置 runtime 参数时注入。

## 5. 数据模型：monthly_run_history（业务表，已落地于 schema.ts）

字段：id, month_id(FK months), month_key, workflow_id(逻辑id), workflow_run_id(逻辑id), source_file_id(FK product_files), produced_file_id(FK product_files), produced_sheet_name, operator, status, error_message, triggered_at, finished_at, runtime_parameters_json。只存元数据，不存 summary 结果。

## 6. API 设计（业务侧，前端只跟这组打交道）

- GET  /api/monthly-runs?month=YYYY-MM&limit=20  → { items: MonthlyRunHistoryRecord[] }
- GET  /api/monthly-runs/:id                      → MonthlyRunHistoryRecord
- POST /api/monthly-runs  body { month, sourceFileId, sheetName?, operator? } → 201 { history, executionResult }
- POST /api/monthly-runs/:id/approvals  body { taskIds?/taskId?, decision? } → WorkflowExecutionResult（透传库审批 + 回写 history 状态）

POST /api/monthly-runs 逻辑：校验 → getOrCreateMonth → 按 code 查 workflow（不 hardcode id）→ 插 history(running) → 复用引擎 execute（runtimeParameters={month, fileIds:{captable_book:sourceFileId}}）→ 回填 workflow_run_id → 返回。

## 7. 产出 → Summary（后端钩子，不依赖前端）

给引擎 WorkflowRunStore 增加可选回调 onRunFinalized?(run)，在 runScheduler.finalizeRun 终态分支触发。业务在 server.ts 注入 applyMonthlyRunPostProcessing(run)：
1. 查 monthly_run_history where workflow_run_id=run.id；非月度执行直接 return（引擎对此无感知）。
2. 镜像 run.status 到 history；非成功类只更新 status/error/finished。
3. 成功时：从 run.artifacts 取 persist_capitalization_summary 的 file artifact → fileId + metadata.range.sheetName；直接 SQL 更新该 month 的 capitalization_source_file_id/sheet_name；更新 history 的 produced_file_id 等。

已核实链路：dataframePersistExcel 返回 {kind:'file', file} → runStore.buildArtifactInput 在 kind==='file' 时写 artifactType:'file' + fileId:file.id + metadata.range。

## 8. 前端设计

- runClient（属引擎）：从 workflowPage 抽出无 UI 薄客户端 startRun / getRun / approveWarnings / pollUntilSettled({onUpdate})，workflowPage 与 monthlyRunPage 共用。
- monthlyRunPage（业务）：createMonthlyRunPage(deps) => { init, onActivate }。DOM：月份选择、文件上传、源信息、触发按钮、状态面板（步骤/警告/操作）、历史表。事件流：上传(POST /api/files/upload) → 触发(POST /api/monthly-runs) → pollUntilSettled(onUpdate=renderPanel) → waiting_approval 显示继续/跳过 → 终态成功 refreshProductFiles + refreshSummary(month) + 刷新历史表。
- main.ts 集成：pageTitles 加 monthlyRun；SPA fallback 页列表加 monthlyRun；activatePage 分支；启动 init()。

## 9. 类型（已落地于 src/shared/types.ts）

MonthlyRunStatus / MonthlyRunHistoryRecord / MonthlyRunTriggerRequest / MonthlyRunTriggerResponse / MonthlyRunApprovalRequest。现有 WorkflowRunArtifactRecord / WorkflowExecutionResult / WorkflowDefinition.runtimeParams* 已够用。

## 10. 分阶段任务

阶段一 地基（部分已完成）
- [x] 业务类型 MonthlyRun*（src/shared/types.ts，已在工作区）
- [x] monthly_run_history 表（schema.ts，去跨界 FK，已在工作区）
- [x] runtimeParameters 回归测试（6 个，已在工作区，typecheck/test 绿）
- [ ] workflow 159 参数化（seed 幂等 upsert + 3 个 extract task 的 $fromRuntime）

阶段二 后端逻辑 + API
- [ ] 引擎 onRunFinalized 钩子（runStore + runScheduler.finalizeRun）+ 测试
- [ ] monthlyRun/store.ts 的 applyMonthlyRunPostProcessing + history 读写 + 测试
- [ ] /api/monthly-runs 4 路由 + 抽 triggerWorkflowRun + 注入钩子

阶段三 前端
- [ ] 抽 runClient，workflowPage 改用它（保证回归）
- [ ] monthlyRunPage + index.html DOM + main.ts 集成

阶段四（后续独立重构）
- [ ] workflow 物理归位 src/workflow/，切 runStore→db 耦合，拆类型/路由/DDL

## 11. 测试策略（TDD）

先写测试再实现，参考现有 runScheduler.test.ts in-memory 风格：
- runtime 参数：$fromRuntime 注入、类型校验、必填缺失、未知 key（已有）。
- onRunFinalized：终态触发 / 非终态不触发。
- applyMonthlyRunPostProcessing：成功回写 months 数据源 + history；失败只写 status 不动 months；waiting_approval 保持 running。
- 纪律：测试既要 tsx --test 跑过，也要 tsc --noEmit 类型通过（字面量 schema 需显式类型标注，否则 tsx 过但 tsc 失败）。

## 12. 端到端验证

curl：确认 159 的 schema/$fromRuntime 已落库 → POST /api/files/upload 拿 SOURCE_ID → POST /api/monthly-runs {month, sourceFileId} → 轮询 GET /api/workflow-runs/:id 看 8 步与 artifacts → 必要时审批 → GET /api/monthly-runs/:id 确认 producedFileId、GET /api/months/:month/summary 确认 capitalizationSource.fileId===producedFileId。
浏览器：/monthlyRun 选月→上传→触发→状态推进→成功后 /summary 看到新数据源与新表数据；/files 看到产出 xlsx；历史表出现该次执行。

## 13. 风险与遗留

- workflow 159 可能被 UI 手动编辑过；seed 幂等 upsert 注意是否覆盖用户编辑（建议仅未配置 runtime 参数时注入）。
- 本地运行依赖 docker compose 的 Postgres(55432) + MinIO(29000)；后端启动会因 MinIO 未起而崩溃，需先 docker compose up -d。
- SQL hardcode 常数 V1 未参数化；后续以 fixedValues.* 处理。
- 多源文件（Shareworks / Futu 分开导出）暂按单一合并工作簿；fileIds 具名对象已预留扩展位。

## 14. 关键文件索引（现状）

- 引擎：src/server/workflow/{engine,runScheduler,runStore,runExecutor,runtimeParameters,runWorker}.ts、operators/*
- 运行时参数：src/server/workflow/runtimeParameters.ts（resolveWorkflowRuntimeConfiguration）
- 终态出口：src/server/workflow/runScheduler.ts（finalizeRun）
- 产物写入：src/server/workflow/runStore.ts（buildArtifactInput）、operators/dataframePersistExcel.ts
- 数据库/启动：src/server/db.ts（schemaSql + seedDatabase）、schema.ts、seed.ts（seedWorkflowData）
- 业务 API/页面：src/server/server.ts、src/client/main.ts、index.html、src/client/workflowPage.ts
- 共享类型：src/shared/types.ts、src/shared/workflowRunStatus.ts

# Gyre Cap Table — 项目约定（Project Spec）

## 硬性规则：工作流定义只存数据库，代码里一律不放

- 所有工作流定义（`tasks` / `runtime_params_schema` / `runtime_params_defaults`）**只存数据库**（表 `workflow_definitions`）。
- 代码中**一律不得**硬编码工作流定义，也**不得**通过代码 seed 工作流。
- 新增或修改工作流：直接改数据库（通过工作流编辑页面或 SQL / API），**不改代码**。
- 代码只应保留：通用算子实现（`src/server/workflow/operators/`）、工作流引擎、以及"从 DB 读取并执行工作流"的通用逻辑。

### 待清理 TODO（把下列代码内工作流定义迁移为纯 DB 驱动后删除）

- `src/server/monthlyRun/workflowDefinition.ts` / `workflowDefinitionV2.ts`（月度工作流定义、源定义、schema、defaults）
- `src/server/esopWorkflow/workflowDefinitions.ts`（ESOP 产品页 Update 工作流）
- `src/server/dataManagementWorkflow/workflowDefinitions.ts`（员工归集等 Update 工作流）
- `src/server/seed.ts` 中 seed 工作流定义的部分（`buildMonthlyWorkflowSeedDefinition` / `buildEsopPageWorkflowSeedDefinitions` / `buildDataManagementWorkflowSeedDefinitions`）
- 月度执行页面的输入源应改为**从 DB 工作流的 `runtime_params_schema` / `tasks` 推导**，而非代码常量 `MONTHLY_RUN_SOURCE_DEFINITIONS`；`monthly_run_instances` 的"每源一列"schema 亦应通用化（source key → file 映射）。

> 现状说明：上述代码内定义目前仍被 `server.ts` / `instanceStore.ts` / 各 `service.ts` 的运行时逻辑依赖（月度输入源渲染、产品页 Update）。删除需连带把这些运行时逻辑改为 DB 驱动，属独立任务，按本规则分批推进。

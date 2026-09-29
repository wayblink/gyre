# Gyre Cap Table — 项目约定（Project Spec）

## 硬性规则：工作流定义只存数据库，代码里一律不放

- 所有工作流定义（`tasks` / `runtime_params_schema` / `runtime_params_defaults`）**只存数据库**（表 `workflow_definitions`）。
- 代码中**一律不得**硬编码工作流定义，也**不得**通过代码 seed 工作流。
- 新增或修改工作流：直接改数据库（通过工作流编辑页面或 SQL / API），**不改代码**。
- 代码只应保留：通用算子实现（`src/server/workflow/operators/`）、工作流引擎、以及"从 DB 读取并执行工作流"的通用逻辑。

### 实现现状（已按硬规则完成）

工作流定义已全部移出代码，实现为 DB + JSON 种子驱动：

- **种子来源**：`database/workflows/*.json` 是各内置工作流的定义种子（由 `scripts/export-workflows.ts` 从 DB 导出）。空数据库启动时，`src/server/workflow/workflowSeedLoader.ts` 读取这些 JSON，经 `insertWorkflowDefinitionIfMissing`（`on conflict(code) do nothing`）导入——只补缺失，绝不覆盖已有行。
- **页面输入源**：ESOP / 数据归集 / 月度执行页面的输入源清单，全部从 DB 工作流的 `runtime_params_schema.fileRefs.properties` 推导（月度页面的富元数据 sourceGroup / taskId / required / hidden / defaultSheetName / allowSheetNameOverride / order 也存在该 schema 里）。代码只保留 `pageKey → workflowCode` 路由映射。
- **月度实例表**：`monthly_run_instances` 的输入源已通用化为子表 `monthly_run_instance_sources`（source_key → file/sheet 映射），不再按源硬编码物理列。
- 新增或修改工作流：改 DB（工作流编辑页面 / SQL / API）；若要让新环境也带上，跑 `scripts/export-workflows.ts` 重新导出 JSON 种子并提交。

> 代码中已无任何工作流的 `tasks` / `runtime_params_schema` / sources 定义。保留项：通用算子（`src/server/workflow/operators/`）、工作流引擎、JSON 种子加载器、页面路由映射、以及"从 DB 读取并执行 / 推导页面输入源"的通用逻辑。

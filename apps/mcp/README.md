# apps/mcp —【预留】MCP Server 接入位置

V0.1 **不部署** MCP Server。本目录说明将来如何安全地给 Codex、Claude 等 AI Agent 提供质检数据查询能力。

## 设计约束
1. **复用业务 Service，不直连数据库**：MCP 进程以 NestJS standalone application 方式启动，导入 `apps/api` 的业务模块（`InspectionsService`、`RollsService`、`ReviewsService` 等）。
2. **同一套权限**：每次调用构造 `Actor`（见 `apps/api/src/common/actor.ts`），使用专用"服务账号"并只授予只读角色（例如新增 `AI_READONLY`）。Service 层的 `InspectionAccess.canView / canReview` 等校验自然生效。
3. **不开放任意 SQL**：只暴露预定义工具，参数用 `packages/shared` 中的 Zod Schema 校验。
4. **不绕过审核流程**：V1 只提供查询类工具；任何写操作（如"建议退回"）只能生成待人工确认的记录，不能直接改变检验状态。
5. **审计**：每次工具调用写入 `audit_logs`（`actorId` = 服务账号，`action` = `mcp.<tool>`）。

## 候选工具
| 工具 | 说明 | 复用 |
|---|---|---|
| `get_roll_history(rollNo)` | 按卷号查询完整质检历史 | `RollsService.history` |
| `get_inspection(id)` | 检验详情（评分、疵点、审核记录，不含图片原图链接） | `InspectionsService.get` |
| `search_inspections(filters)` | 按面料 / 日期 / 结果筛选 | `InspectionsService.list` |
| `defect_statistics(fabricCode, from, to)` | 疵点类型分布（新增只读查询） | 新增 `AnalyticsService` |

## 将来的目录结构
```
apps/mcp/
  src/main.ts          # NestFactory.createApplicationContext(AppModule.register({ runWorkers: false }))
  src/tools/*.ts       # 每个工具一个文件：Zod 入参 → Service 调用 → 结果裁剪
  src/service-actor.ts # 构造只读服务账号 Actor
```

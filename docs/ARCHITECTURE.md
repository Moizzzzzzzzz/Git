# FabricQC 架构说明

## 1. 总体结构（模块化单体）

```
┌──────────────┐   HTTPS    ┌──────────────────────────────────────────────┐
│ 微信小程序    │──────────▶│ Nginx (TLS, /api 反代, 后台静态文件)            │
│ Taro4+React  │            └───────┬──────────────────────────────────────┘
└──────┬───────┘                    │
       │ 预签名 PUT 直传              ▼
       ▼                    ┌──────────────────────────────┐
┌──────────────┐            │ API (NestJS 模块化单体)        │
│ 腾讯云 COS    │◀──HEAD/签名─│  controllers → services       │
│ (S3 兼容)     │            │  quality-engine (纯函数包)     │
└──────────────┘            │  outbox dispatcher + BullMQ   │
                            └───────┬──────────────┬───────┘
┌──────────────┐  HTTPS            │              │
│ PC 管理后台    │───────────▶ Nginx  ▼              ▼
│ React+Vite    │            PostgreSQL 16      Redis 7 (BullMQ)
└──────────────┘                                  │
                                         微信 subscribeMessage.send
```

## 2. 仓库布局

```
apps/
  api/            NestJS 后端（含 Prisma schema / migrations / seed / 测试）
  admin/          PC 管理后台（React + Vite + Tailwind + shadcn/ui 风格组件）
  miniapp/        微信小程序（Taro 4 + React + TypeScript）
  mcp/            【预留】未来 MCP Server 入口说明，V0.1 不部署
packages/
  shared/         前后端共享：枚举、Zod Schema（DTO、模板、标准规则、草稿）、中文标签
  quality-engine/ 质量评分引擎（四分制 + 客户标准），纯 TypeScript，无 IO
deploy/
  docker-compose.yml       生产编排（api / admin+nginx / postgres / redis）
  docker-compose.dev.yml   本地开发依赖（postgres / redis / minio）
  nginx/                   Nginx 配置
  scripts/                 备份、恢复、部署脚本
docs/
```

## 3. 后端分层

```
Controller (HTTP、DTO 校验、取当前主体)
   └─▶ Application Service (业务规则、权限校验 assertCan(actor, …)、事务、审计)
          ├─▶ PrismaService (数据访问)
          ├─▶ QualityService → @fabricqc/quality-engine
          ├─▶ StorageService → StorageAdapter (S3 兼容：COS / MinIO)
          ├─▶ WechatGateway (code2Session / stable_token / subscribeMessage)
          └─▶ OutboxService (事务内写 notification_outbox)
Worker (同进程可开关)：OutboxDispatcher → BullMQ queue → NotificationProcessor → Channel adapters
```

- **权限在 Service 层强制**：每个业务方法接收 `Actor`（由服务端从会话加载的用户 ID + 角色 + 部门范围），不依赖 Controller。未来 MCP 入口复用同一套 Service，因此无法绕过权限和审核流程。
- Controller 仅负责协议转换；业务逻辑不写在 Controller。
- 输入校验统一使用 `packages/shared` 中的 Zod Schema（`ZodValidationPipe`），前端表单复用同一 Schema。

## 4. 身份与会话

| 项 | 设计 |
|---|---|
| PC 登录 | 用户名 + 密码（Argon2id），失败计数与锁定 |
| 小程序登录 | `Taro.login` → `/auth/wechat/login` → `code2Session` → (AppID, OpenID) 查 `wechat_identities` |
| 绑定 | 员工编号 + 一次性绑定码；码存 SHA-256 哈希；有效期、单次、错误次数上限；事务内校验唯一约束 |
| Access Token | JWT HS256，含 `sub`、`sid`；每次请求校验会话未撤销、用户为 ACTIVE；角色从数据库加载 |
| Refresh Token | 32 字节随机串，只存哈希；每次刷新轮换；旧令牌重放 → 撤销整个会话 |
| PC 刷新令牌 | httpOnly + SameSite=Strict Cookie，路径限定 `/api/auth` |
| 小程序刷新令牌 | 本地 Storage |
| 强制下线 / 禁用 | 撤销会话记录，下一次请求立即 401 |

## 5. 验布数据流

1. 质检员扫码 → `GET /rolls/by-qr/:code` → 返回布卷与当前用户在该布卷上的任务。
2. `POST /inspections` 开始检验：对四分制标准版本、客户标准版本、模板、面料/布卷规格做**快照**，创建 `DRAFT` 记录。
3. 小程序维护完整本地草稿（Storage），`PUT /inspections/:id/draft`（带 `baseVersion`）整体同步：段、测量、清单、疵点（以客户端 `clientId` upsert）、照片链接。返回服务端计算结果供预览。
4. 照片：`POST /media/upload-intents` 获得对象键与预签名 PUT URL（原图 + 缩略图）→ 小程序直传 → `POST /media/:id/confirm` 服务端 HEAD 校验对象存在与大小。
5. `POST /inspections/:id/submit`（幂等键）：完整性校验 → 引擎重新计算 → 写结果与修订快照 → 状态 SUBMITTED → 创建 `review_assignments` + 站内通知 + outbox，单事务提交。
6. 审核：`POST /reviews/:inspectionId/decide` → 写 `qc_reviews`、完成待办、更新检验与布卷状态、通知质检员（outbox）。

## 6. 质量评分引擎

纯函数 `evaluateInspection(input) → InspectionEvaluation`：

1. 计算受检长度（检验区段求和）与面积宽度（实测有效门幅均值 → 规格可裁门幅 → 规格门幅，记录所用依据）。
2. 每个疵点：匹配特殊规则（固定分 / 按尺寸分档 / 每线性单位计分）→ 否则按尺寸分档。
3. 按线性单位（默认 1 码）封顶【开发默认值：每码 4 分】。
4. 标准化：每 100 平方码 = 分数 × 3600 ÷ (受检码数 × 宽度英寸)；或每 100 平方米。
5. 四分制标准检查（阈值、严重度、测量限值……）与客户标准检查**分别**产出检查项列表和结论。
6. 综合：任一 FAIL → FAIL；否则任一 INCONCLUSIVE → INCONCLUSIVE；否则 PASS。非全检时附加警告。

规则 JSON 结构由 `packages/shared` 的 `standardRulesSchema` 定义，发布前校验。

## 7. 存储

`StorageAdapter` 接口：`presignPut`、`presignGet`、`headObject`、`deleteObject`。V0.1 实现 `S3CompatibleStorageAdapter`（AWS SDK v3）：
- 生产：腾讯云 COS（S3 兼容端点 `https://cos.<region>.myqcloud.com`，私有读写桶）。
- 开发 / 本地迁移：MinIO。
对象键由服务端生成：`inspections/{yyyy}/{mm}/{inspectionId}/{mediaId}.jpg`，客户端不能指定。数据库只保存对象键，不保存服务器本地路径。

## 8. 通知（Transactional Outbox）

- 业务事务内写 `notifications`（站内待办，立即可见）与 `notification_outbox`（`dedupeKey` 唯一）。
- `OutboxDispatcher` 每 3 秒以 `FOR UPDATE SKIP LOCKED` 领取 PENDING 行，投递到 BullMQ（`jobId = outboxId` 去重），标记 ENQUEUED。
- `NotificationProcessor` 对每位接收人逐通道发送；微信订阅消息需要：模板已配置、用户有剩余授权次数、用户已绑定微信。结果写 `notification_deliveries`（SENT / FAILED / SKIPPED）。
- 渠道适配器：`WechatSubscribeChannel`（实现）、`WecomChannel`（接口预留，未实现）。

## 9. 部署拓扑与资源

| 容器 | 镜像 | 内存上限 |
|---|---|---|
| nginx | nginx:1.27-alpine（含后台静态文件） | 64 MB |
| api | node:22-alpine（API + worker 同进程） | 768 MB |
| postgres | postgres:16-alpine | 1 GB |
| redis | redis:7-alpine（maxmemory 128MB） | 192 MB |

PostgreSQL、Redis 仅在 Docker 内部网络，不映射公网端口。数据卷：`pg_data`、`redis_data`。

## 10. 未来 MCP 接入位置

`apps/mcp`（预留）将作为独立进程，以 NestJS standalone application 方式导入 `apps/api` 的业务模块（Service 层），使用"服务账号 + 只读角色"构造 `Actor`。只暴露预定义工具（如"按卷号查询质检历史""统计某面料疵点分布"），**不开放任意 SQL**，不提供绕过审核的写操作。详见 `apps/mcp/README.md`。

## 11. 本地迁移

1. 新服务器安装 Docker → 拷贝仓库与 `.env` → `deploy/scripts/restore.sh` 恢复数据库 → `docker compose up -d`。
2. 图片继续使用 COS，或切换 MinIO（改 `STORAGE_*` 环境变量并迁移对象）。
3. 公网入口：域名解析或 Cloudflare Tunnel / frp 等安全隧道，API 域名不变，小程序无需改版。

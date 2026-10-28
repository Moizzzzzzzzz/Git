# 架构决策记录（ADR）

每条决策：背景 → 决策 → 影响。新增决策追加在末尾，不修改历史条目（如需推翻，新增一条并引用）。

## D-001 仓库根目录
- 背景：工作目录 `fabric-inspection-app` 为空。
- 决策：直接以该目录作为 FabricQC Monorepo 根目录（包名 `fabricqc`），不再嵌套子目录。

## D-002 包管理器：pnpm workspaces + 平铺 node_modules
- 决策：使用 pnpm 9，`.npmrc` 设置 `node-linker=hoisted`。
- 原因：Taro 4 的 webpack 构建对符号链接依赖兼容性不稳定；平铺布局同时兼容 NestJS、Vite、Prisma。

## D-003 共享校验使用 Zod，而非 class-validator
- 决策：DTO 和业务 Schema 定义在 `packages/shared`（Zod），后端通过 `ZodValidationPipe` 校验，后台表单复用。
- 影响：前后端同一份规则；标准规则 JSON 也用 Zod 严格校验。

## D-004 质量引擎独立为纯函数包
- 决策：`packages/quality-engine` 不依赖数据库和框架；服务端为权威计算，小程序可离线预览。
- 影响：单元测试覆盖全部规则；未来 MCP / 报表复用同一引擎。

## D-005 标准规则版本化 + 检验快照
- 决策：`standard_versions.rules` 保存规则 JSON，发布后不可变；检验开始时把标准版本、模板、规格快照到 `roll_inspections`。
- 影响：修改标准不会改变历史结论；提交时使用快照重新计算。

## D-006 对象存储使用 S3 兼容协议适配器
- 决策：通过 AWS SDK v3 访问 COS（S3 兼容端点）与 MinIO，统一 `StorageAdapter` 接口。小程序使用服务端签发的预签名 PUT URL 直传（`wx.request` PUT ArrayBuffer），服务端在 confirm 时 HEAD 校验。
- 原因：一个实现同时满足云上 COS 与本地 MinIO，本地开发可真实联调上传。
- 影响：需要在微信公众平台把 COS 桶域名加入 request 合法域名；COS 需配置 CORS（PC 后台查看图片用 GET 预签名链接）。
- 备选：COS STS 临时密钥 + COS 小程序 SDK；若后续需要分片上传大文件再评估。

## D-007 缩略图由客户端生成
- 决策：小程序用 `Taro.compressImage` 生成缩略图，与原图一起直传；不依赖 COS 数据万象。
- 原因：保持存储厂商无关，迁移到 MinIO 后仍可用。

## D-008 草稿整体同步
- 决策：`PUT /inspections/:id/draft` 提交完整草稿 + `baseVersion` 乐观锁；疵点以客户端生成的 `clientId` upsert。
- 原因：离线场景下最简单可靠，天然幂等，避免增量操作日志的复杂性。

## D-009 Outbox + BullMQ，worker 与 API 同进程（可开关）
- 决策：`RUN_WORKERS=true` 时 API 进程内运行 outbox 调度器和 BullMQ worker。
- 原因：4GB 服务器节省一个 Node 进程的内存；以后可以通过同一镜像、`RUN_WORKERS` 拆分独立 worker 容器。

## D-010 微信能力通过 WechatGateway 抽象，生产代码无模拟成功
- 决策：未配置 AppID/AppSecret 时，微信登录返回明确错误 `WECHAT_NOT_CONFIGURED`，不提供假登录。集成测试通过依赖注入替换 Gateway。
- 影响：本地开发需要微信测试号或正式 AppID 才能在开发者工具中走完整登录。

## D-011 二维码内容使用 HTTPS 链接
- 决策：二维码内容 `{QR_BASE_URL}/r/{qrCode}`，`qrCode` 为 10 位随机 Crockford Base32。
- 原因：小程序内 `scanCode` 可解析；将来可在公众平台配置"扫普通链接二维码打开小程序"，无需重印标签。

## D-012 PC 后台认证
- 决策：Access Token 存内存，Refresh Token 放 httpOnly + SameSite=Strict Cookie（路径 `/api/auth`），刷新接口另需 `X-Requested-With` 头。
- 原因：与小程序身份完全独立，防 XSS 窃取长期令牌、防 CSRF。

## D-013 Prisma 只映射表名为 snake_case
- 决策：模型使用 `@@map("snake_case")` 匹配需求中的表名；列名保持 camelCase。

## D-014 审核人路由
- 决策：任务指定审核人 → 质检员直属主管（`users.supervisorId`）→ 任务部门的 `QC_SUPERVISOR` → 全部 `QUALITY_MANAGER`。全部为空时提交失败并提示配置审核人（不允许"无人审核"）。

## D-015 开发默认值必须显式标记
- 决策：种子四分制标准 `isDevDefault=true`，名称含"开发默认"，后台醒目提示；数值参照 ASTM D5430 常见口径。工厂确认后另建正式标准。

## D-016 开发环境 S3 兼容存储镜像
- 背景：MinIO 官方已停止在 Docker Hub / quay.io 公开发布镜像（2026-10 实测拉取失败）。
- 决策：本地开发使用 `bitnamilegacy/minio:2025.4.22`（存档镜像，支持 `MINIO_DEFAULT_BUCKETS` 自动建桶），**只用于开发联调**。生产使用腾讯云 COS。
- 影响：将来迁移到工厂本地且不使用 COS 时，需要重新选型自托管 S3（如 SeaweedFS、Garage 或自行编译的 MinIO），`StorageAdapter` 无需修改，只改环境变量。

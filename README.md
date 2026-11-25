# FabricQC Lite V0.1

面料工厂智能验布管理系统：微信小程序现场验布 + PC 管理后台 + NestJS 后端。

| 目录 | 说明 |
|---|---|
| `apps/api` | NestJS + Prisma + PostgreSQL + Redis/BullMQ 后端 |
| `apps/admin` | PC 管理后台（React + Vite + Tailwind + shadcn/ui 风格组件） |
| `apps/miniapp` | 微信小程序（Taro 4 + React + TypeScript） |
| `apps/mcp` | 【预留】MCP Server 接入说明 |
| `packages/shared` | 共享枚举、Zod Schema、中文标签 |
| `packages/quality-engine` | 四分制 + 客户标准评分引擎（纯函数） |
| `deploy` | Docker、Nginx、备份恢复脚本 |
| `docs` | PRD、架构、任务、决策记录、运维手册 |

## 快速开始

```bash
cp .env.example .env && ln -sf ../../.env apps/api/.env   # 填写密钥类配置
pnpm install && pnpm dev:infra && pnpm build:packages
pnpm db:migrate && pnpm db:seed
pnpm dev:api      # http://localhost:3000/api/health
pnpm dev:admin    # http://localhost:5173
pnpm dev:miniapp  # 用微信开发者工具打开 apps/miniapp
pnpm check        # lint + 类型检查 + 测试 + 构建
```

详见 [docs/OPERATIONS.md](docs/OPERATIONS.md)。当前进度与阻塞项见 [docs/TASKS.md](docs/TASKS.md)。

> 种子数据中的四分制标准、检验模板、绑定码有效期等均为**开发默认值**，不是工厂正式验收标准。

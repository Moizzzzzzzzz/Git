# FabricQC API 生产镜像（多阶段构建，支持 linux/amd64 与 linux/arm64）
# 构建：docker compose -f deploy/docker-compose.yml build api
ARG NODE_IMAGE=node:22-alpine
ARG NPM_REGISTRY=https://registry.npmjs.org

FROM ${NODE_IMAGE} AS build
ARG NPM_REGISTRY
RUN apk add --no-cache openssl && npm install -g pnpm@9.15.9 --registry=${NPM_REGISTRY}
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/quality-engine/package.json packages/quality-engine/
COPY apps/api/package.json apps/api/
RUN pnpm config set registry ${NPM_REGISTRY} \
  && pnpm install --frozen-lockfile --filter "@fabricqc/api..."
COPY packages packages
COPY apps/api apps/api
RUN pnpm --filter @fabricqc/shared build \
  && pnpm --filter @fabricqc/quality-engine build \
  && pnpm --filter @fabricqc/api build
# 只保留生产依赖
RUN pnpm deploy --filter @fabricqc/api --prod /out \
  && cd /out && npx prisma generate --schema prisma/schema.prisma

FROM ${NODE_IMAGE}
RUN apk add --no-cache openssl tini
ENV NODE_ENV=production TZ=Asia/Shanghai
WORKDIR /app
COPY --from=build --chown=node:node /out /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
# 启动前执行数据库迁移（只应用新迁移，不会清空数据）
CMD ["sh", "-c", "node node_modules/prisma/build/index.js migrate deploy --schema prisma/schema.prisma && node dist/main.js"]

# Nginx：HTTPS 入口 + PC 管理后台静态文件 + /api 反向代理
ARG NODE_IMAGE=node:22-alpine
ARG NPM_REGISTRY=https://registry.npmjs.org

FROM ${NODE_IMAGE} AS build
ARG NPM_REGISTRY
RUN npm install -g pnpm@9.15.9 --registry=${NPM_REGISTRY}
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/admin/package.json apps/admin/
RUN pnpm config set registry ${NPM_REGISTRY} \
  && pnpm install --frozen-lockfile --filter "@fabricqc/admin..."
COPY packages/shared packages/shared
COPY apps/admin apps/admin
RUN pnpm --filter @fabricqc/admin build

FROM nginx:1.27-alpine
RUN mkdir -p /etc/nginx/fabricqc.d
COPY deploy/nginx/nginx.conf /etc/nginx/nginx.conf
COPY deploy/nginx/qr-landing.html /usr/share/nginx/html/qr-landing.html
COPY --from=build /app/apps/admin/dist /usr/share/nginx/html/admin
EXPOSE 80 443

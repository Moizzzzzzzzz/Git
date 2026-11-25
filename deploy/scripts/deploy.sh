#!/usr/bin/env bash
# 构建并启动（首次部署或升级）。首次部署后执行一次：deploy/scripts/deploy.sh --seed
# SKIP_BUILD=1：使用已导入的镜像（例如在本机构建后 docker save/load），不在服务器上构建
source "$(dirname "$0")/common.sh"
[ -f deploy/nginx/certs/fullchain.pem ] || { echo "缺少 HTTPS 证书 deploy/nginx/certs/fullchain.pem / privkey.pem，见 docs/OPERATIONS.md" >&2; exit 1; }
grep -q '^NODE_ENV=production' "$ENV_FILE" || echo "提示：.env 中 NODE_ENV 不是 production（容器内会强制为 production）"
if [ "${SKIP_BUILD:-0}" = "1" ]; then dc up -d --no-build; else dc build && dc up -d; fi
echo "等待 API 健康检查…"
for i in $(seq 1 30); do
  if dc exec -T api wget -qO- http://127.0.0.1:3000/api/health > /dev/null 2>&1; then echo "API 已就绪"; break; fi
  sleep 3
done
if [ "${1:-}" = "--seed" ]; then
  dc exec -T api node dist/cli/seed.js
fi
dc ps

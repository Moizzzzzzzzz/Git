#!/usr/bin/env bash
# 公共函数：读取 .env 中的单个变量（不 source，避免 JSON 值被 shell 解析）
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"
COMPOSE_FILE="${COMPOSE_FILE:-deploy/docker-compose.yml}"
ENV_FILE="${ENV_FILE:-.env}"
[ -f "$ENV_FILE" ] || { echo "找不到 $ENV_FILE" >&2; exit 1; }

env_get() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }
# COMPOSE_FILE 可用冒号分隔多个文件，例如 deploy/docker-compose.yml:deploy/docker-compose.small.yml
COMPOSE_ARGS=()
IFS=':' read -r -a _compose_files <<< "$COMPOSE_FILE"
for f in "${_compose_files[@]}"; do COMPOSE_ARGS+=(-f "$f"); done
dc() { docker compose "${COMPOSE_ARGS[@]}" --env-file "$ENV_FILE" "$@"; }

PGUSER="$(env_get POSTGRES_USER)"
PGDB="$(env_get POSTGRES_DB)"
psql_admin() { dc exec -T postgres psql -v ON_ERROR_STOP=1 -U "$PGUSER" -d postgres "$@"; }

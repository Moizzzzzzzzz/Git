#!/usr/bin/env bash
# 数据库恢复
#   恢复演练（不影响正式库）：deploy/scripts/restore.sh --check backups/xxx.dump
#   恢复到正式库（会覆盖当前数据，需二次确认）：deploy/scripts/restore.sh backups/xxx.dump
source "$(dirname "$0")/common.sh"

MODE="replace"
if [ "${1:-}" = "--check" ]; then MODE="check"; shift; fi
FILE="${1:-}"
[ -f "$FILE" ] || { echo "用法：$0 [--check] <备份文件.dump>" >&2; exit 1; }

dc exec -T postgres pg_restore --list < "$FILE" > /dev/null || { echo "备份文件无效：$FILE" >&2; exit 1; }

count_rows() {
  local db="$1"
  dc exec -T postgres psql -U "$PGUSER" -d "$db" -At -c "
    SELECT string_agg(t || '=' || n, ' ' ORDER BY t) FROM (
      SELECT 'users' t, count(*) n FROM users UNION ALL
      SELECT 'fabric_rolls', count(*) FROM fabric_rolls UNION ALL
      SELECT 'roll_inspections', count(*) FROM roll_inspections UNION ALL
      SELECT 'defects', count(*) FROM defects UNION ALL
      SELECT 'qc_reviews', count(*) FROM qc_reviews UNION ALL
      SELECT 'media_assets', count(*) FROM media_assets UNION ALL
      SELECT 'audit_logs', count(*) FROM audit_logs) s;"
}

if [ "$MODE" = "check" ]; then
  CHECK_DB="${PGDB}_restore_check"
  echo "恢复演练：还原到临时库 $CHECK_DB"
  psql_admin -c "DROP DATABASE IF EXISTS \"$CHECK_DB\";" -c "CREATE DATABASE \"$CHECK_DB\";" > /dev/null
  dc exec -T postgres pg_restore -U "$PGUSER" -d "$CHECK_DB" --no-owner --exit-on-error < "$FILE"
  echo "备份内容：$(count_rows "$CHECK_DB")"
  echo "当前正式库：$(count_rows "$PGDB")"
  psql_admin -c "DROP DATABASE \"$CHECK_DB\";" > /dev/null
  echo "恢复演练成功，临时库已删除。"
  exit 0
fi

echo "警告：将用 $FILE 覆盖数据库 $PGDB 的全部数据！"
echo "当前数据：$(count_rows "$PGDB")"
read -r -p "确认请输入数据库名 $PGDB：" answer
[ "$answer" = "$PGDB" ] || { echo "已取消"; exit 1; }

echo "1/4 先备份当前数据（防止误操作）"
BACKUP_DIR="${BACKUP_DIR:-backups}" "$(dirname "$0")/backup.sh"
echo "2/4 停止 API"
dc stop api || true
echo "3/4 重建数据库并还原"
psql_admin -c "DROP DATABASE IF EXISTS \"$PGDB\" WITH (FORCE);" -c "CREATE DATABASE \"$PGDB\";" > /dev/null
dc exec -T postgres pg_restore -U "$PGUSER" -d "$PGDB" --no-owner --exit-on-error < "$FILE"
echo "恢复后数据：$(count_rows "$PGDB")"
echo "4/4 启动 API（会自动应用比备份更新的迁移）"
dc start api || dc up -d api
echo "恢复完成。"

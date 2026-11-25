#!/usr/bin/env bash
# 数据库备份：pg_dump 自定义格式，自动校验并清理过期备份
# 用法：deploy/scripts/backup.sh            （生产）
#       COMPOSE_FILE=deploy/docker-compose.dev.yml deploy/scripts/backup.sh （开发）
# 建议 crontab：0 2 * * * cd /opt/fabricqc && deploy/scripts/backup.sh >> backups/backup.log 2>&1
source "$(dirname "$0")/common.sh"
BACKUP_DIR="${BACKUP_DIR:-backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
mkdir -p "$BACKUP_DIR"
FILE="$BACKUP_DIR/fabricqc-$(date +%Y%m%d-%H%M%S).dump"

echo "[$(date '+%F %T')] 开始备份数据库 $PGDB → $FILE"
dc exec -T postgres pg_dump -U "$PGUSER" -d "$PGDB" -Fc --no-owner > "$FILE.tmp"
# 校验备份文件可被 pg_restore 读取
dc exec -T postgres pg_restore --list < "$FILE.tmp" > /dev/null
mv "$FILE.tmp" "$FILE"
echo "[$(date '+%F %T')] 备份完成：$(du -h "$FILE" | cut -f1)"

find "$BACKUP_DIR" -name 'fabricqc-*.dump' -mtime +"$KEEP_DAYS" -print -delete | sed 's/^/已删除过期备份：/' || true
echo "提示：请定期把 $BACKUP_DIR 同步到服务器以外的位置（如 COS 另一个桶或工厂 NAS）。"

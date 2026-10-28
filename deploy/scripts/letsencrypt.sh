#!/usr/bin/env bash
# Let's Encrypt 免费证书：签发与续期，证书写入 deploy/nginx/certs/（fullchain.pem、privkey.pem）
#   首次签发（Nginx 尚未启动，占用 80 端口）：deploy/scripts/letsencrypt.sh issue <域名> [邮箱]
#   续期（Nginx 运行中，经 /.well-known/acme-challenge/）：deploy/scripts/letsencrypt.sh renew
#   建议 crontab：0 3 * * * cd /opt/fabricqc && deploy/scripts/letsencrypt.sh renew >> backups/cert.log 2>&1
# 运行即表示同意 Let's Encrypt 订阅协议（https://letsencrypt.org/repository/）。
# 服务器防火墙需开放 80 与 443。
source "$(dirname "$0")/common.sh"

LE_DIR="$ROOT_DIR/deploy/letsencrypt"
CERT_DIR="$ROOT_DIR/deploy/nginx/certs"
IMAGE="${CERTBOT_IMAGE:-certbot/certbot:v3.0.1}"
WEBROOT_VOLUME="${COMPOSE_PROJECT_NAME:-fabricqc}_certbot_www"
mkdir -p "$LE_DIR" "$CERT_DIR"

copy_certs() {
  local domain="$1"
  docker run --rm -v "$LE_DIR:/etc/letsencrypt" -v "$CERT_DIR:/certs" --entrypoint sh "$IMAGE" -c \
    "cp -L /etc/letsencrypt/live/$domain/fullchain.pem /certs/fullchain.pem && cp -L /etc/letsencrypt/live/$domain/privkey.pem /certs/privkey.pem && chmod 600 /certs/privkey.pem"
}

case "${1:-}" in
  issue)
    domain="${2:?用法：letsencrypt.sh issue <域名> [邮箱]}"
    email="${3:-}"
    if [ -n "$email" ]; then account=(--email "$email"); else account=(--register-unsafely-without-email); fi
    if dc ps --status running --services 2>/dev/null | grep -qx web; then
      docker volume create "$WEBROOT_VOLUME" > /dev/null
      docker run --rm -v "$LE_DIR:/etc/letsencrypt" -v "$WEBROOT_VOLUME:/var/www/certbot" "$IMAGE" \
        certonly --webroot -w /var/www/certbot -d "$domain" --agree-tos --non-interactive "${account[@]}"
    else
      docker run --rm -p 80:80 -v "$LE_DIR:/etc/letsencrypt" "$IMAGE" \
        certonly --standalone -d "$domain" --agree-tos --non-interactive "${account[@]}"
    fi
    echo "$domain" > "$LE_DIR/domain"
    copy_certs "$domain"
    if dc ps --status running --services 2>/dev/null | grep -qx web; then dc exec -T web nginx -s reload; fi
    echo "证书已写入 $CERT_DIR"
    ;;
  renew)
    [ -f "$LE_DIR/domain" ] || { echo "尚未签发证书，请先执行 issue" >&2; exit 1; }
    domain="$(cat "$LE_DIR/domain")"
    docker run --rm -v "$LE_DIR:/etc/letsencrypt" -v "$WEBROOT_VOLUME:/var/www/certbot" "$IMAGE" \
      renew --webroot -w /var/www/certbot --non-interactive --quiet
    copy_certs "$domain"
    dc exec -T web nginx -s reload
    echo "$(date '+%F %T') 续期检查完成：$domain"
    ;;
  *)
    echo "用法：$0 issue <域名> [邮箱] | renew" >&2
    exit 1
    ;;
esac

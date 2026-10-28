#!/usr/bin/env bash
# 在服务器上安全地设置 .env 中的单个变量（输入不回显），然后重启 API 使之生效。
# 用法：deploy/scripts/set-env.sh WECHAT_APP_SECRET
# 适合 AppSecret、COS 密钥等不应出现在聊天记录或 shell 历史中的值。
source "$(dirname "$0")/common.sh"
key="${1:?用法：set-env.sh <变量名>}"
[[ "$key" =~ ^[A-Z0-9_]+$ ]] || { echo "变量名只能包含大写字母、数字和下划线" >&2; exit 1; }
read -rsp "请输入 $key 的值（不显示）：" value
echo
[ -n "$value" ] || { echo "值为空，未修改" >&2; exit 1; }
python3 - "$ENV_FILE" "$key" "$value" <<'EOF'
import re, sys
path, key, value = sys.argv[1:4]
lines = open(path, encoding='utf-8').read().splitlines()
pat = re.compile(rf'^{re.escape(key)}=')
found = False
for i, line in enumerate(lines):
    if pat.match(line):
        lines[i] = f'{key}={value}'
        found = True
if not found:
    lines.append(f'{key}={value}')
open(path, 'w', encoding='utf-8').write('\n'.join(lines) + '\n')
EOF
chmod 600 "$ENV_FILE"
echo "已更新 $key，正在重启 API…"
dc up -d --no-build --force-recreate api
echo "完成"

# FabricQC 操作与运维手册

## 1. 本地开发（macOS Apple Silicon）

前置：Node.js 22、pnpm 9（`npm i -g pnpm@9.15.9`）、Docker Desktop。

```bash
cp .env.example .env            # 填写 JWT_ACCESS_SECRET、BIND_CODE_PEPPER、SEED_ADMIN_PASSWORD 等
ln -sf ../../.env apps/api/.env # Prisma CLI 读取
pnpm install
pnpm dev:infra                  # 启动 PostgreSQL / Redis / MinIO（仅监听 127.0.0.1）
pnpm build:packages             # 构建共享包
pnpm db:migrate                 # 应用数据库迁移
pnpm db:seed                    # 角色、管理员、疵点类型、默认模板、【开发默认】四分制
SEED_DEMO=true pnpm db:seed     # 可选：演示员工 / 面料 / 3 卷布
pnpm dev:api                    # http://localhost:3000/api/health
pnpm dev:admin                  # http://localhost:5173
pnpm dev:miniapp                # 编译到 apps/miniapp/dist，用微信开发者工具打开 apps/miniapp
```

开发环境 MinIO 控制台：http://127.0.0.1:9001（账号为 `.env` 中的 `STORAGE_ACCESS_KEY_ID` / `STORAGE_SECRET_ACCESS_KEY`）。

### 1.1 检查命令

```bash
pnpm check   # 构建共享包 → lint → 类型检查 → 全部测试 → 全部构建
```

API 集成测试使用独立数据库 `TEST_DATABASE_URL`（库名必须以 `_test` 结尾，测试会清空它）。

## 2. 需要你提供的配置

| 配置 | 用途 | 获取方式 |
|---|---|---|
| `WECHAT_APP_ID` / `WECHAT_APP_SECRET` | 小程序登录、订阅消息 | 微信公众平台 → 开发管理 → 开发设置。AppSecret 只放服务器 `.env` |
| `WECHAT_TPL_REVIEW_REQUEST` | 主管"待审核提醒" | 公众平台 → 订阅消息 → 选用模板（建议含：布卷号、面料、质检员、判定结果、提交时间） |
| `WECHAT_TPL_REVIEW_RESULT` | 质检员"审核结果通知" | 同上（建议含：布卷号、审核结果、审核人、审核意见、审核时间） |
| `*_FIELDS` | 模板字段映射 | 按实际模板的字段名（如 `thing1`、`time5`）填写 JSON，见下表 |
| `STORAGE_*` | 照片存储 | 腾讯云 COS：建私有读写桶（上海），子账号最小权限（该桶 PutObject/GetObject/HeadObject/DeleteObject） |
| 域名 + HTTPS 证书 | 小程序要求 HTTPS 合法域名 | 域名需 ICP 备案；证书放 `deploy/nginx/certs/fullchain.pem`、`privkey.pem` |
| 工厂正式质量标准 | 判定依据 | 由质量负责人确认后在后台新建并发布 |

订阅消息业务字段：

| 事件 | 可用业务字段 |
|---|---|
| 待审核提醒 | `rollNo` 布卷号、`fabricName` 面料、`inspectorName` 质检员、`overallResult` 系统判定、`submittedAt` 提交时间 |
| 审核结果通知 | `rollNo`、`decision` 审核结果、`reviewerName` 审核人、`comment` 审核意见、`decidedAt` 审核时间 |

字段按模板关键词自动截断：`thing` ≤20 字、`name` ≤10 字、`phrase` ≤5 个汉字、`character_string` ≤32 位、`time` 格式 `YYYY-MM-DD HH:mm`。

### 2.1 微信公众平台设置
1. **服务器域名**：
   - request 合法域名：`https://<你的域名>`、`https://<桶名>.cos.ap-shanghai.myqcloud.com`（照片直传与查看）
   - downloadFile 合法域名：`https://<桶名>.cos.ap-shanghai.myqcloud.com`
2. **用户隐私保护指引**：声明"相机（拍摄布卷与疵点照片）""相册（选择照片）"。
3. （可选）**扫普通链接二维码打开小程序**：规则前缀填 `{QR_BASE_URL}/r/`，校验文件放 `deploy/nginx/verify/`。
4. 把 `apps/miniapp/project.config.json` 的 `appid` 改为正式 AppID；`apps/miniapp/.env.production` 的 `TARO_APP_API_BASE_URL` 改为 `https://<你的域名>/api`。

### 2.2 腾讯云 COS 设置
- 桶权限：私有读写。
- CORS：来源填 PC 后台域名，方法 GET/PUT/HEAD，允许头 `*`（PC 后台查看图片使用预签名 GET）。
- `.env`：`STORAGE_PROVIDER=cos`、`STORAGE_ENDPOINT=https://cos.ap-shanghai.myqcloud.com`、`STORAGE_FORCE_PATH_STYLE=false`、`STORAGE_BUCKET=<name-appid>`。

## 3. 生产部署（Ubuntu Server 24.04，Docker Compose）

```bash
# 1. 安装 Docker（官方脚本或腾讯云镜像源）
# 2. 获取代码
sudo mkdir -p /opt/fabricqc && sudo chown $USER /opt/fabricqc && cd /opt/fabricqc
git clone <仓库地址> .
# 3. 配置
cp .env.example .env && chmod 600 .env
#   NODE_ENV=production、COOKIE_SECURE=true、PUBLIC_BASE_URL/CORS_ORIGINS/QR_BASE_URL=https://<域名>
#   POSTGRES_PASSWORD 使用 openssl rand -hex 24（避免 URL 特殊字符）
#   JWT_ACCESS_SECRET、BIND_CODE_PEPPER、SEED_ADMIN_PASSWORD、微信、COS 等
# 4. 证书：放到 deploy/nginx/certs/fullchain.pem 与 privkey.pem
# 5. 构建并启动（首次加 --seed 写入角色、管理员和默认数据）
deploy/scripts/deploy.sh --seed
```

- 腾讯云安全组只开放 22（建议限制来源 IP）、80、443；**不要**开放 5432、6379。
- 资源上限（`deploy/docker-compose.yml`）：postgres 1G、api 768M、redis 192M、web 64M，合计约 2GB，给 4GB 服务器留出余量。
- 国内服务器构建镜像默认使用 npmmirror（`NPM_REGISTRY` 可覆盖）。
- 升级：`git pull && deploy/scripts/deploy.sh`（API 启动时自动执行 `prisma migrate deploy`，只应用新迁移）。
- 日志：`docker compose -f deploy/docker-compose.yml --env-file .env logs -f api`

## 4. 备份与恢复

```bash
deploy/scripts/backup.sh                         # 备份到 backups/，保留 14 天（KEEP_DAYS 可调）
deploy/scripts/restore.sh --check backups/x.dump # 恢复演练：还原到临时库并对比行数，不影响正式库
deploy/scripts/restore.sh backups/x.dump         # 恢复正式库：需输入库名确认，会先自动备份当前数据
```

建议 crontab：`0 2 * * * cd /opt/fabricqc && deploy/scripts/backup.sh >> backups/backup.log 2>&1`，并把 `backups/` 同步到服务器以外（COS 另一个桶或工厂 NAS）。照片存于 COS，不在数据库备份内；COS 可开启版本控制或跨地域复制。

## 5. 迁移到工厂本地服务器

1. 本地服务器安装 Ubuntu 24.04 + Docker，拷贝仓库和 `.env`。
2. 云上执行 `deploy/scripts/backup.sh`，把备份文件拷到新服务器。
3. 新服务器先 `deploy/scripts/deploy.sh` 启动（空库），再 `deploy/scripts/restore.sh <备份>`。
4. 图片：继续使用 COS（无需迁移），或改用自托管 S3（修改 `STORAGE_*`，用 `rclone` 迁移对象）。
5. 公网入口：保持同一个 API 域名，解析到工厂公网 IP，或通过 Cloudflare Tunnel / frp 等安全隧道暴露 443；小程序无需重新发布。
6. 切换 DNS 前在新服务器执行 `curl https://<域名>/api/health` 确认。

## 6. 日常操作（管理员）

1. **建员工**：后台「员工与微信」→ 新建员工，勾选角色；质检主管可限定部门。需要 PC 登录的员工设置用户名和密码。
2. **微信绑定**：员工行点二维码图标生成 8 位绑定码（只显示一次，默认 24 小时有效、错 5 次作废）→ 员工打开小程序输入员工编号 + 绑定码。
3. **换手机 / 离职**：解绑微信（立即失效）；离职员工改为"停用"（立即撤销全部登录）。
4. **面料与布卷**：「面料与客户」建面料（门幅、可裁门幅、克重、默认标准）→「批次与布卷」登记或 CSV 批量导入 → 勾选布卷「打印标签」。
5. **质量标准**：「质量标准」中四分制标准由质量负责人确认后**新建版本 → 发布**；客户标准同理。已发布版本不可修改。
6. **任务**：「验布任务」→ 创建任务，选择面料、质检员、标准、模板和待分配布卷。
7. **审核**：主管在小程序「审核中心」或 PC「审核中心」处理；系统判定不合格但审核通过需填写让步理由。
8. **追溯**：「质检记录」输入卷号查询完整历史（每次提交、退回、审核、照片）。

## 7. 质检员小程序操作

首页「扫码验布」→ 选择检验方式（验布机 / 人工）和范围（全检 / 部分 / 抽检）→ 区段 → 检查 → 测量 → 疵点（米位、长宽、严重度、照片）→ 拍照 → 结果 → 提交审核。

- 所有录入**立即保存在手机本机**；顶部状态显示"本机已保存，待同步 / 同步中 / 已同步"。
- 断网可以继续录入和拍照；恢复网络后自动同步、自动上传照片。
- 只有服务器确认后才显示"已提交"。网络中断导致"无法确认是否提交成功"时，再点一次提交不会重复提交。
- 被退回的检验在任务中显示"已退回"，修改后重新提交。

## 8. 故障排查

| 现象 | 处理 |
|---|---|
| 小程序提示"服务器未配置微信小程序 AppID / AppSecret" | `.env` 填写后重启 api |
| 照片一直"上传失败" | 检查 COS 合法域名配置、`STORAGE_*`、桶 CORS；后台「系统设置」查看存储是否已配置 |
| 主管收不到微信提醒 | 主管需在小程序「审核中心」点击"接收提醒"（每次授权一条）；检查模板 ID 与字段映射；站内待办不受影响 |
| 提交时报"没有可用的审核人" | 给质检员设置直属主管，或为部门配置质检主管 / 质量经理 |
| `/api/health` 中 redis 为 down | 异步提醒暂停，数据不受影响；`docker compose ... restart redis` |

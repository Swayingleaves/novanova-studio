# Docker 完整部署指南

本文档介绍如何使用 Docker Compose 一键部署 Novanova Studio 的全部服务（PostgreSQL、Redis、后端、前端、Nginx）。

默认 `local` 配置档使用仓库内 Nginx 配置和桥接网络。当前线上部署使用 `production` 配置档，复用 Linux 宿主机的 HTTPS 配置及证书。两种配置均只使用 `docker-compose.yml`。

## 1. 准备环境

| 组件 | 要求 |
| --- | --- |
| 操作系统 | Linux（推荐 Ubuntu 22.04+） |
| Docker Engine | 24+ |
| Docker Compose | v2 |
| Nginx | 当前生产环境需保留宿主机站点配置与证书；本地配置档由容器提供代理 |

## 2. 获取源码与配置环境变量

```bash
git clone <仓库地址> novanova-studio
cd novanova-studio
```

创建 `.env` 并从样例复制：

```bash
cp .env.example .env
```

生成 `APP_SECRET_KEY`（用于签发 Bearer Token，不能留空）：

```bash
openssl rand -base64 48
```

将生成的值写入 `.env` 的 `APP_SECRET_KEY=` 后面。

### 必须检查的配置项

| 配置项 | 说明 |
| --- | --- |
| `APP_SECRET_KEY` | 必填，上一步生成的随机值。 |
| `FRONTEND_BASE_URL` | 必填，浏览器公开访问的前端根地址，例如 `https://www.example.com`；仅允许 HTTP(S)，不能包含路径、查询参数或片段。 |
| `ADMIN_INITIAL_EMAIL` / `ADMIN_INITIAL_PASSWORD` | 初始管理员账号，**部署到公网前必须修改默认密码**。 |
| `POSTGRES_USERNAME` / `POSTGRES_PASSWORD` | PostgreSQL 凭据，部署到公网前必须修改默认密码。 |
| `REDIS_PASSWORD` | 默认 Compose Redis 不启用认证，留空；仅填写此变量不会给 Redis 启用认证。 |
| `CORS_ALLOWED_ORIGIN_PATTERNS` | 改为实际的域名，例如 `https://www.yourdomain.com`。 |
| `TZ` | 容器和 Java 日志时区，默认是 `Asia/Shanghai`。 |
| `TRUSTED_PROXY_ADDRESSES` | 可选，Nginx 反代场景**建议配置**。本 Compose 中 Nginx 为 `network_mode: host`、经宿主机映射端口访问后端，**进入容器的连接源地址会被 Docker NAT 成 bridge 网关**（通常 `172.18.0.1`，用 `docker network inspect <网络名>` 查看 Gateway），因此应设为网关 IP 或网段 CIDR（如 `172.18.0.1` 或 `172.18.0.0/16`）。配置后"接口记录"与登录限流可解析出真实客户端 IP；不配置时记录到的是网关/代理地址。注意：不要把 `127.0.0.1` 配在这里，容器内看到的对端地址不会是它。 |
| `NEXT_PUBLIC_CREDIT_STORE_URL` | 可选，发卡网站地址；未配置时购买积分页面显示“没有配置发卡网站”。 |
| `ALIPAY_ENABLED` | 可选，设为 `true` 才启用支付宝电脑网站支付；启用时必须同时配置下列支付宝字段。 |
| `ALIPAY_APP_ID` / `ALIPAY_PRIVATE_KEY` / `ALIPAY_PUBLIC_KEY` | 支付宝开放平台应用标识、应用私钥和支付宝公钥；私钥只通过部署环境注入，不要写入镜像或仓库。 |
| `ALIPAY_GATEWAY_URL` | 支付宝网关地址；沙箱联调使用支付宝开放平台提供的沙箱网关。 |
| `ALIPAY_NOTIFY_URL` | 必填，形如 `https://域名/api/v1/payment/alipay/notify`，必须能被支付宝服务器公网访问。 |
| `ALIPAY_RETURN_URL` | 必填，形如 `https://域名/api/v1/payment/alipay/return`，用于同步回到前端购买页。 |
| `AI_TASK_POLLING_INTERVAL_SECONDS` | 所有 AI 异步任务状态轮询间隔（服务端渠道、内部等待、视频合成恢复和前端状态查询），单位为秒，必须大于 0，默认 `5`。 |

### Nginx 路径配置

Compose 中的 Nginx 容器会挂载以下宿主机目录，确保这些目录存在且配置正确：

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `NGINX_CONFIG_DIRECTORY` | `./nginx` | 当前生产显式使用 `/etc/nginx/conf.d`。 |
| `NGINX_STATIC_DIRECTORY` | `./volume/nginx_static`（样例） | 当前生产使用 `/usr/share/nginx/html`。 |
| `NGINX_LOG_DIRECTORY` | `./logs/nginx` | Nginx 日志目录。 |
| `NGINX_SSL_DIRECTORY` | `./volume/nginx_ssl`（样例） | 当前生产使用 `/etc/nginx/ssl`。 |

## 3. 构建并启动

普通新环境执行 `docker compose up -d --build`，默认入口为 `http://127.0.0.1:5554`。**已有线上数据库的生产更新不要直接执行
`docker compose up --build -d`**，应使用仓库根目录的分阶段发布脚本：

```bash
./deploy.sh v1.0.1-$(date +%Y%m%d-%H%M%S)
```

脚本会先在旧服务继续提供访问时构建镜像，再停止写入、生成 `pg_dump` 和完整数据库清单，
在隔离 PostgreSQL 中实际恢复并逐表比对，随后才把旧目录改名为
`/data/novanova-studio.bak`、切换新源码并启动服务。脚本禁止删除数据卷、禁止自动执行
未经审查的新迁移；任何校验失败都会中止切换并保留备份。

此脚本从本地 Git 工作区执行，专用于 `ubuntu@110.40.137.187` 的 `/data/novanova-studio`。服务器上的源码包不包含 `.git`，不要在服务器上重新打包。Windows 可用 Git Bash 执行 `bash deploy.sh <唯一版本标签>`。它打包当前工作区的已跟踪文件和发布脚本，不要求先提交，但不会上传本地 `.env`、数据库目录、日志或依赖。

当前生产 `.env` 由脚本在保留原密钥、邮件、OAuth2、支付及业务参数的基础上补齐：

| 参数 | 当前生产值 |
| --- | --- |
| `COMPOSE_PROFILES` | `production` |
| `FLYWAY_MIGRATION_LOCATION` | `classpath:db/migration` |
| `POSTGRES_PORT` / `REDIS_PORT` | `15432` / `16379`，只绑定 `127.0.0.1` |
| `SERVER_PORT` / `WEB_PORT` | `18080` / `15555` |
| `WEB_CONTAINER_NAME` / `WEB_IMAGE_NAME` | `novanovastudio-web` |
| `POSTGRES_CONTAINER_NAME` / `REDIS_CONTAINER_NAME` | `novanovastudio-pro-postgres` / `novanovastudio-pro-redis` |
| `SERVER_CONTAINER_NAME` / `SERVER_IMAGE_NAME` | `novanovastudio-pro-server` |
| `NGINX_CONTAINER_NAME` | `novanovastudio-pro-nginx` |

构建期间旧服务继续运行；从停写备份至验证完成期间网站处于维护窗口。脚本会保存数据库逻辑备份、实际恢复结果、逐表 SHA256 与序列状态，以及停止 PostgreSQL/Redis 后复制的完整数据目录。失败时保留现场，不自动回退应用、恢复数据库、执行 `repair` 或改写迁移历史。后续新增迁移需先审查并更新发布校验规则，不能直接绕过校验。

首次运行会构建 `web` 和 `server` 镜像，耗时取决于网络和机器性能。

查看服务状态：

```bash
docker compose ps
```

所有服务状态为 `Up` 且 `healthy`（PostgreSQL、Redis）即表示启动成功。

PostgreSQL 和 Redis 在 Compose 中均仅发布到宿主机 `127.0.0.1`，远程运维请使用 SSH 隧道。已有生产数据库的更新必须使用 `./deploy.sh <唯一版本标签>`；不要直接运行 `docker compose up`，避免跳过发布前备份与迁移校验。

## 4. 验证

```bash
curl http://127.0.0.1:18080/actuator/health
curl https://你的域名/api/v1/health
```

第一条应返回包含 `"status":"UP"` 的 Actuator 响应，第二条应返回业务响应
`{"code":0,"data":"ok","msg":"success"}`。生产端口以服务器 `.env` 为准，不能照抄本地的 8080。

## 5. 完成首次配置

1. 通过 Nginx 代理的域名访问前端页面。
2. 使用 `.env` 中的初始管理员账号登录。
3. 打开 **配置与用户偏好** → "我的渠道"，添加 AI 渠道并填写 API 地址、密钥和可用模型。
4. 在"我的模型"中配置文本、图像、视频模型的能力与默认项。
5. 需要上传素材或持久化生成媒体时，在"对象存储"中配置并设为默认对象存储。

### 支付宝沙箱联调

在支付宝开放平台创建电脑网站支付沙箱应用，将沙箱应用的 `app_id`、应用私钥、公钥和沙箱网关写入 `.env`。`ALIPAY_NOTIFY_URL` 必须使用已配置公网域名，不能填写 `localhost`、`127.0.0.1` 或容器内地址；若本地联调需要通知回调，请使用受信任的公网隧道。同步跳转只用于返回购买页，订单到账仍由异步通知或支付宝交易查询确认。生产环境禁止把应用私钥提交到 Git、Docker 镜像或日志。

## 6. 常用管理命令

```bash
# 停止所有服务
docker compose stop

# 重启所有服务
docker compose restart

# 查看日志
docker compose logs -f

# 仅查看某个服务的日志
docker compose logs -f server

# 当前生产代码更新（唯一版本标签）
./deploy.sh v1.0.1-$(date +%Y%m%d-%H%M%S)

# 停止并删除容器（数据卷不受影响）
docker compose down
```

## 7. 注意事项

- `.env`、AI 渠道密钥、对象存储密钥、证书私钥等**不要提交到 Git**。
- 浏览器可见的 `NEXT_PUBLIC_*` 环境变量不应用于保存任何密钥。
- 数据持久化在项目根目录的 `volume/` 下（PostgreSQL 和 Redis），`docker compose down` 不会删除数据卷。
- Agent 提示词文件挂载自 `server/config/prompts/`，修改后重启 `server` 容器即可生效。
- 继承企业版线上数据库时，`FLYWAY_MIGRATION_LOCATION` 必须保持
  `classpath:db/migration`，不能切换到 `db/migration-community`；已执行迁移文件的名称和
  内容也不能修改。
- 生产更新完成后保留 `/data/novanova-studio.bak` 和
  `/data/novanova-deployment-backups/<版本标签>`，确认新版本稳定后再按备份保留策略清理。

### 当前服务器的第三方登录网络限制

2026-11-02 发布前检查发现：服务器直连 `oauth2.googleapis.com:443` 和 `connect.linux.do:443` 超时，原服务日志已有 Google OAuth2 换取令牌超时；国内网站连接正常，服务器没有运行中的出网代理。原 OAuth2 配置会完整保留，但第三方登录仍需先恢复可用的出网网络后再验收。仅填写代理环境变量不代表 Java 响应式 HTTP 客户端已经使用代理；需要同时验证应用实际的令牌交换请求。不要通过关闭证书校验解决网络超时。

### 2026-11-02 生产发布核验

发布版本：`oss-20261102-01`。仅使用 `docker-compose.yml`，Web 容器及镜像为 `novanovastudio-web`。旧源码、原配置及停止后的原始数据目录位于 `/data/novanova-studio.bak`；逻辑备份、恢复验证及发布记录位于 `/data/novanova-deployment-backups/oss-20261102-01`。

- 企业版 V1–V76 校验通过，服务端确认数据库已是最新版本，没有执行新迁移。
- 停写时、隔离恢复后和冷拷贝启动后的 113 张表及 33 个序列清单完全一致。
- 数据摘要使用固定 UTC 偏移比较，避免 `/etc/localtime` 挂载导致同一时间输出不同偏移而误报；不调整业务时间或数据库数据。
- 原 `.env` 中已有参数逐项保留，样例中的缺失参数均已补齐；数据库与 Redis 端口限制为宿主机回环访问。
- 公网首页、登录页、文档页、前端脚本及健康接口通过；PostgreSQL、Redis 均健康。
- 管理员当前密码与 `.env` 初始化密码不同，密码摘要已确认完整保留。初始化密码只在首次创建账号时使用，后续登录应使用当前密码，本次未重置账号。

发布中时间显示偏移触发了一次校验中止；修正校验方法后，从已验证的备份阶段继续执行发布。初始源码包、修正后的源码包和继续执行脚本均保留在该次备份目录中，未对生产库执行逻辑恢复。

# Docker 完整部署指南

本文档介绍如何使用 Docker Compose 一键部署 Novanova Studio 的全部服务（PostgreSQL、Redis、后端、前端、Nginx）。

默认 `local` 配置档使用仓库内 Nginx 配置和桥接网络。`production` 配置档使用 Linux 宿主机的 HTTPS 配置及证书。两种配置均只使用 `docker-compose.yml`。

## 1. 准备环境

| 组件 | 要求 |
| --- | --- |
| 操作系统 | Linux（推荐 Ubuntu 22.04+） |
| Docker Engine | 24+ |
| Docker Compose | v2 |
| Nginx | 生产配置档需提供宿主机站点配置与证书；本地配置档由容器提供代理 |

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
| `EMAIL_ALLOWED_SUFFIXES` | 注册邮箱域名白名单，逗号分隔，支持 `qq.com` 或 `@qq.com`。邮箱验证码和 Google、linux.do 首次注册统一校验；已有账号登录和绑定不受影响。为空或包含独立 `*` 表示不限制，未设置时采用 `.env.example` 中的常见邮箱列表。 |
| `TRUSTED_PROXY_ADDRESSES` | 可选，Nginx 反代场景**建议配置**。本 Compose 中 Nginx 为 `network_mode: host`、经宿主机映射端口访问后端，**进入容器的连接源地址会被 Docker NAT 成 bridge 网关**（通常 `172.18.0.1`，用 `docker network inspect <网络名>` 查看 Gateway），因此应设为网关 IP 或网段 CIDR（如 `172.18.0.1` 或 `172.18.0.0/16`）。配置后"接口记录"与登录限流可解析出真实客户端 IP；不配置时记录到的是网关/代理地址。注意：不要把 `127.0.0.1` 配在这里，容器内看到的对端地址不会是它。 |
| `NEXT_PUBLIC_CREDIT_STORE_URL` | 可选，发卡网站地址；未配置时购买积分页面显示“没有配置发卡网站”。 |
| `ALIPAY_ENABLED` | 可选，设为 `true` 才启用支付宝电脑网站支付；启用时必须同时配置下列支付宝字段。 |
| `ALIPAY_APP_ID` / `ALIPAY_PRIVATE_KEY` / `ALIPAY_PUBLIC_KEY` | 支付宝开放平台应用标识、应用私钥和支付宝公钥；私钥只通过部署环境注入，不要写入镜像或仓库。 |
| `ALIPAY_GATEWAY_URL` | 支付宝网关地址；沙箱联调使用支付宝开放平台提供的沙箱网关。 |
| `ALIPAY_NOTIFY_URL` | 必填，形如 `https://域名/api/v1/payment/alipay/notify`，必须能被支付宝服务器公网访问。 |
| `ALIPAY_RETURN_URL` | 必填，形如 `https://域名/api/v1/payment/alipay/return`，用于同步回到前端购买页。 |
| `AI_TASK_POLLING_INTERVAL_SECONDS` | 所有 AI 异步任务状态轮询间隔（服务端渠道、内部等待、视频合成恢复和前端状态查询），单位为秒，必须大于 0，默认 `5`。 |

已有 `.env` 会覆盖新增的默认白名单；更新版本时，如需开放新增邮箱域名，请同步更新该配置。配置修改后须重新创建服务容器，单纯 `restart` 不会重新注入环境变量。当前默认列表为：

```dotenv
EMAIL_ALLOWED_SUFFIXES=qq.com,163.com,126.com,gmail.com,outlook.com,hotmail.com,foxmail.com,icloud.com,sina.com,aliyun.com,yeah.net,139.com,189.cn,sina.cn,vip.qq.com,vip.163.com,yahoo.com,live.com,msn.com,proton.me,protonmail.com
```

### Nginx 路径配置

Compose 中的 Nginx 容器会挂载以下宿主机目录，确保这些目录存在且配置正确：

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `NGINX_CONFIG_DIRECTORY` | `./nginx` | 生产配置档可设置为 `/etc/nginx/conf.d`。 |
| `NGINX_STATIC_DIRECTORY` | `./volume/nginx_static`（样例） | 生产配置档可设置为 `/usr/share/nginx/html`。 |
| `NGINX_LOG_DIRECTORY` | `./logs/nginx` | Nginx 日志目录。 |
| `NGINX_SSL_DIRECTORY` | `./volume/nginx_ssl`（样例） | 生产配置档可设置为 `/etc/nginx/ssl`。 |

## 3. 构建并启动

新环境执行以下命令，默认入口为 `http://127.0.0.1:5554`：

```bash
docker compose up -d --build
```

已有生产环境更新前，先备份并验证 PostgreSQL 和 Redis 数据，核对 `.env`、站点配置与 Flyway 迁移历史，再在维护窗口内更新应用。数据库备份必须实际恢复验证；不要删除数据目录、自动修复迁移历史或跳过数据一致性检查。

首次运行会构建 `web` 和 `server` 镜像，耗时取决于网络和机器性能。

查看服务状态：

```bash
docker compose ps
```

所有服务状态为 `Up` 且 `healthy`（PostgreSQL、Redis）即表示启动成功。

PostgreSQL 和 Redis 在 Compose 中均仅发布到宿主机 `127.0.0.1`，远程运维请使用 SSH 隧道。已有生产数据库的更新必须先完成备份、恢复验证与迁移历史校验。

## 4. 验证

```bash
curl http://127.0.0.1:8080/actuator/health
curl https://你的域名/api/v1/health
```

第一条应返回包含 `"status":"UP"` 的 Actuator 响应，第二条应返回业务响应
`{"code":0,"data":"ok","msg":"success"}`。实际端口以服务器 `.env` 为准。

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

# 更新应用（已有数据须先完成备份验证）
docker compose up -d --build server web

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
- 生产更新完成后保留源码、配置及数据库备份，确认新版本稳定后再按备份保留策略清理。

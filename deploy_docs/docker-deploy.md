# Docker 完整部署指南

本文档介绍如何使用 Docker Compose 一键部署 Novanova Studio 的全部服务（PostgreSQL、Redis、后端、前端、Nginx）。

> **注意**：此方式适用于 Linux 服务器环境。Nginx 使用 `network_mode: host` 并挂载宿主机 `/etc`、日志和证书目录，因此不适用于 Windows / macOS 本地开发。本地开发请参考 [Windows 本地启动](local-setup-windows.md) 或 [macOS / Linux 本地启动](local-setup-macos-linux.md)。

## 1. 准备环境

| 组件 | 要求 |
| --- | --- |
| 操作系统 | Linux（推荐 Ubuntu 22.04+） |
| Docker Engine | 24+ |
| Docker Compose | v2 |
| Nginx | 已安装并配置完成（Compose 中的 Nginx 容器使用 `network_mode: host` 共享宿主机网络） |

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
| `ADMIN_INITIAL_EMAIL` / `ADMIN_INITIAL_PASSWORD` | 初始管理员账号，**部署到公网前必须修改默认密码**。 |
| `POSTGRES_USERNAME` / `POSTGRES_PASSWORD` | PostgreSQL 凭据，部署到公网前必须修改默认密码。 |
| `REDIS_PASSWORD` | Redis 密码，公网环境建议设置。 |
| `CORS_ALLOWED_ORIGIN_PATTERNS` | 改为实际的域名，例如 `https://www.yourdomain.com`。 |

### Nginx 路径配置

Compose 中的 Nginx 容器会挂载以下宿主机目录，确保这些目录存在且配置正确：

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `NGINX_CONFIG_DIRECTORY` | `/etc/nginx/conf.d` | Nginx 配置文件目录。 |
| `NGINX_STATIC_DIRECTORY` | `/usr/share/nginx/html` | 静态资源目录。 |
| `NGINX_LOG_DIRECTORY` | `/var/log/nginx` | 日志目录。 |
| `NGINX_SSL_DIRECTORY` | `/etc/nginx/ssl` | SSL 证书目录。 |

## 3. 构建并启动

```bash
docker compose up --build -d
```

首次运行会构建 `web` 和 `server` 镜像，耗时取决于网络和机器性能。

查看服务状态：

```bash
docker compose ps
```

所有服务状态为 `Up` 且 `healthy`（PostgreSQL、Redis）即表示启动成功。

## 4. 验证

```bash
curl http://127.0.0.1:8080/api/v1/health
```

返回 `{"code":200,"data":"OK"}` 表示后端正常。

## 5. 完成首次配置

1. 通过 Nginx 代理的域名访问前端页面。
2. 使用 `.env` 中的初始管理员账号登录。
3. 打开 **配置与用户偏好** → "我的渠道"，添加 AI 渠道并填写 API 地址、密钥和可用模型。
4. 在"我的模型"中配置文本、图像、视频模型的能力与默认项。
5. 需要上传素材或持久化生成媒体时，在"对象存储"中配置并设为默认对象存储。

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

# 重新构建并启动（代码更新后）
docker compose up --build -d

# 停止并删除容器（数据卷不受影响）
docker compose down
```

## 7. 注意事项

- `.env`、AI 渠道密钥、对象存储密钥、证书私钥等**不要提交到 Git**。
- 浏览器可见的 `NEXT_PUBLIC_*` 环境变量不应用于保存任何密钥。
- 数据持久化在项目根目录的 `volume/` 下（PostgreSQL 和 Redis），`docker compose down` 不会删除数据卷。
- Agent 提示词文件挂载自 `server/config/prompts/`，修改后重启 `server` 容器即可生效。

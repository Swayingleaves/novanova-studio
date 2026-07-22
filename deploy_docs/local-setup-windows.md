# Windows 本地启动

以下步骤以 **Windows PowerShell** 为例。推荐的本地开发方式是：Docker 只运行 PostgreSQL 和 Redis，Java 服务端与 Next.js 前端分别在本机启动。这样既保留热更新，也避免 Nginx 的 Linux 宿主机依赖。

## 1. 准备环境

| 组件 | 要求 | 用途 |
| --- | --- | --- |
| Git | 当前稳定版本 | 获取源码。 |
| Docker Desktop 与 Docker Compose | 使用 Linux 容器 | 启动 PostgreSQL 17 与 Redis 8.6。 |
| JDK | 21 | 运行 Spring Boot 服务端。 |
| Maven | 3.9 或更高版本 | 启动服务端。 |
| Node.js | 22 | 运行 Next.js 前端。 |
| Corepack / pnpm | pnpm 11.7.0 | 安装与运行前端依赖。 |

进入项目根目录；首次获取源码时，将占位地址替换为实际仓库地址：

```powershell
git clone <仓库地址> novanova-studio
Set-Location novanova-studio
```

## 2. 创建本地环境变量

`.env` 已被 Git 忽略。首次使用时从样例创建，已有 `.env` 时不会被覆盖：

```powershell
if (!(Test-Path -LiteralPath .env)) {
    Copy-Item -LiteralPath .env.example -Destination .env
}
```

为 `APP_SECRET_KEY` 生成随机值并写入 `.env`。该密钥用于签发 Bearer Token，任何环境都不能留空：

```powershell
$secretBytes = [byte[]]::new(48)
$randomGenerator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$randomGenerator.GetBytes($secretBytes)
$randomGenerator.Dispose()
[Convert]::ToBase64String($secretBytes)
```

至少检查并按你的本机环境修改以下项：

| 配置项 | 本地默认值 | 说明 |
| --- | --- | --- |
| `APP_SECRET_KEY` | 无 | 必填，使用上一步生成的随机值。 |
| `SERVER_PORT` | `8080` | 服务端端口；前端默认代理到此端口。 |
| `POSTGRES_HOST` / `POSTGRES_PORT` | `127.0.0.1` / `5432` | PostgreSQL 连接地址。 |
| `REDIS_HOST` / `REDIS_PORT` | `127.0.0.1` / `6379` | Redis 连接地址。 |
| `ADMIN_INITIAL_EMAIL` / `ADMIN_INITIAL_PASSWORD` | `admin@admin.com` / `novanovastudio@pwss` | 仅在同邮箱账号不存在时创建初始管理员；本地可用，部署前必须修改。 |
| `CORS_ALLOWED_ORIGIN_PATTERNS` | 样例值 | 仅在浏览器绕过 Next.js 代理直接请求后端时，补充实际前端来源。 |

## 3. 启动 PostgreSQL 与 Redis

在项目根目录执行：

```powershell
docker compose up -d postgres redis
docker compose ps postgres redis
```

两个服务状态正常后，数据会保存在项目根目录的 `volume/` 下。停止本地依赖服务时使用以下命令，数据不会被删除：

```powershell
docker compose stop postgres redis
```

## 4. 启动服务端

保持命令在**项目根目录**执行。这样本地默认的 Agent 提示词路径 `server/config/prompts/` 与根目录 `.env` 都能按当前配置被读取：

```powershell
$env:JAVA_HOME = "$env:USERPROFILE\.jabba\jdk\openjdk@21.0.2"
$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"
java -version
mvn -f server/pom.xml spring-boot:run
```

如果 JDK 21 已经在系统 `PATH` 中，可省略前两行。服务启动后可在新的 PowerShell 窗口验证：

```powershell
Invoke-RestMethod http://127.0.0.1:8080/api/v1/health
```

默认 API 文档地址为 [http://127.0.0.1:8080/swagger/index.html](http://127.0.0.1:8080/swagger/index.html)。

## 5. 启动前端

打开第二个 PowerShell 窗口，从项目根目录执行：

```powershell
Set-Location web
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

前端默认运行在 [http://127.0.0.1:5555](http://127.0.0.1:5555)，开发模式会将 `/api/v1/*` 转发到 `http://127.0.0.1:8080`。

若你在 `.env` 中修改了 `SERVER_PORT`，请在启动前端前显式设置后端地址：

```powershell
$env:NEXT_PUBLIC_SERVER_URL = "http://127.0.0.1:<服务端端口>"
pnpm dev
```

## 6. 完成首次配置

1. 访问 [http://127.0.0.1:5555](http://127.0.0.1:5555)，使用 `.env` 中的初始管理员账号登录。
2. 打开 **配置与用户偏好**，在"我的渠道"中添加 AI 渠道并填写服务端 API 地址、密钥和可用模型。
3. 在"我的模型"中配置文本、图像、视频模型的能力与默认项；未配置可用默认模型时，Agent 与生成任务无法选择模型。
4. 需要上传素材或持久化生成媒体时，在"对象存储"中配置并设为默认对象存储。
5. 进入图片、视频或画布页面，开始对话式创作；管理员可在"系统管理"中维护用户、积分、公告和提示词库。

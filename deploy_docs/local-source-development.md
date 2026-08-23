# 本地源码启动与调试

本文档用于在本机直接运行 PostgreSQL、Redis、Spring Boot 服务端和 Next.js 前端，保留源码调试、自动重启和热更新能力。

## 1. 准备本机环境

| 组件 | 版本要求 | 用途 |
| --- | --- | --- |
| PostgreSQL | 17 | 保存用户、项目、任务和资产数据。 |
| Redis | 8.6 | 处理缓存、任务事件和 Redis Stream。 |
| JDK | 21 | 运行 Spring Boot 服务端。 |
| Maven | 3.9 或更高版本 | 安装依赖并启动服务端。 |
| Node.js | 22 | 运行 Next.js 前端。 |
| pnpm | 11.7.0 | 安装依赖并启动前端。 |
| FFmpeg | 当前稳定版本 | 视频合成节点使用 `ffmpeg` 合成视频，`ffprobe` 探测视频元数据。 |

PostgreSQL 和 Redis 需要作为本机服务运行。PostgreSQL 账号应当能够访问管理数据库，并在目标数据库不存在时具有创建权限。

### Windows：安装 FFmpeg 和 FFprobe

仅在本地调试视频合成功能时需要安装。`ffprobe.exe` 随 FFmpeg 安装包提供，无需单独安装。

在 PowerShell 中执行：

```powershell
winget install --id Gyan.FFmpeg.Shared -e
```

安装完成后关闭并重新打开终端，再验证：

```powershell
ffmpeg -version
ffprobe -version
```

如果命令未加入 `PATH`，可在启动服务前指定可执行文件的绝对路径：

```powershell
$env:AI_VIDEO_COMPOSITION_FFMPEG_EXECUTABLE = "C:\ffmpeg\bin\ffmpeg.exe"
$env:AI_VIDEO_COMPOSITION_FFPROBE_EXECUTABLE = "C:\ffmpeg\bin\ffprobe.exe"
```

从 IDE 调试服务端时，将上述两个环境变量添加到 Spring Boot 运行配置中。请按实际解压或安装目录替换路径。

## 2. 创建服务端本地环境变量

在项目根目录将 `.env.example` 复制为 `.env`。已有 `.env` 时不要覆盖。

macOS / Linux：

```bash
[ -f .env ] || cp .env.example .env
```

Windows PowerShell：

```powershell
if (!(Test-Path -LiteralPath .env)) {
    Copy-Item -LiteralPath .env.example -Destination .env
}
```

至少检查并配置以下内容：

| 配置项 | 说明 |
| --- | --- |
| `APP_SECRET_KEY` | 必填，设置为至少 32 字节的高强度随机值。 |
| `SERVER_PORT` | 保持为 `8080`，与前端默认代理地址一致。 |
| `POSTGRES_HOST` / `POSTGRES_PORT` | 本机 PostgreSQL 的地址和端口。 |
| `POSTGRES_USERNAME` / `POSTGRES_PASSWORD` | PostgreSQL 登录凭据。 |
| `POSTGRES_DATABASE` | 项目使用的数据库名称。 |
| `POSTGRES_ADMINISTRATOR_DATABASE` | 自动创建目标数据库时连接的管理数据库。 |
| `REDIS_HOST` / `REDIS_PORT` | 本机 Redis 的地址和端口。 |
| `REDIS_PASSWORD` / `REDIS_DATABASE` | Redis 密码和逻辑数据库编号。 |
| `AI_TASK_POLLING_INTERVAL_SECONDS` | 所有 AI 异步任务状态轮询间隔（服务端渠道、内部等待、视频合成恢复和前端状态查询），单位为秒，必须大于 0，默认 `3`。 |

### 生成 `APP_SECRET_KEY`

`APP_SECRET_KEY` 必须为至少 32 字节的高强度随机值。在 Windows PowerShell 中执行以下命令生成：

```powershell
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
($bytes | ForEach-Object { $_.ToString("x2") }) -join ''
```

如果已安装 OpenSSL，也可以使用更简洁的命令：

```powershell
openssl rand -hex 32
```

将输出的 64 位十六进制字符串填入 `.env` 的 `APP_SECRET_KEY`。该密钥用于签名和加密，生产环境务必妥善保管，不要提交到代码仓库。

## 3. 创建前端本地环境变量

Next.js 从 `web/` 目录启动时不会读取项目根目录的 `.env`。前端启动前必须将 `web/.env.example` 复制为 `web/.env.local`。已有 `web/.env.local` 时不要覆盖。

macOS / Linux：

```bash
[ -f web/.env.local ] || cp web/.env.example web/.env.local
```

Windows PowerShell：

```powershell
if (!(Test-Path -LiteralPath web/.env.local)) {
    Copy-Item -LiteralPath web/.env.example -Destination web/.env.local
}
```

检查 `web/.env.local` 中的以下配置：

| 配置项 | 说明 |
| --- | --- |
| `NEXT_PUBLIC_SERVER_URL` | 必填，设置为服务端地址，默认为 `http://127.0.0.1:8080`。 |
| `NEXT_PUBLIC_CREDIT_STORE_URL` | 可选，发卡网站地址；未配置时购买积分页面显示“没有配置发卡网站”。 |
| `NEXT_PUBLIC_ICP_RECORD_NUMBER` | 可选，前端页脚展示的 ICP 备案号。 |
| `NEXT_PUBLIC_GITHUB_URL` | 可选，前端展示的项目 GitHub 仓库地址。 |

`NEXT_PUBLIC_*` 变量会暴露给浏览器，不能用于保存密钥或其他敏感信息。

## 4. 检查本机依赖服务

启动 PostgreSQL 和 Redis 后，分别执行：

```bash
pg_isready -h 127.0.0.1 -p 5432
redis-cli -h 127.0.0.1 -p 6379 ping
```

PostgreSQL 应返回正在接受连接，Redis 应返回 `PONG`。如果 `.env` 使用了其他地址或端口，检查命令也需要使用对应值。

## 5. 启动和调试服务端

保持当前目录为**项目根目录**，使服务端能够读取根目录 `.env` 和 `server/config/prompts/` 下的 Agent 提示词文件：

```bash
java -version
mvn -f server/pom.xml spring-boot:run
```

需要断点调试时，在 IDE 中以 Debug 模式运行 `com.novanovastudio.NovanovaStudioServerApplication`，并将工作目录设置为项目根目录。Spring Boot DevTools 会在编译后的类发生变化时自动重启服务。

## 6. 启动和调试前端

打开另一个终端，从项目根目录执行：

```bash
cd web
pnpm install --frozen-lockfile
pnpm dev
```

Next.js 开发服务会监听源码变化并热更新页面。需要断点调试时，使用浏览器开发者工具加载 TypeScript Source Map（源码映射）。

## 7. 验证启动结果

| 地址 | 用途 |
| --- | --- |
| [http://127.0.0.1:5555](http://127.0.0.1:5555) | 前端开发页面。 |
| [http://127.0.0.1:8080/api/v1/health](http://127.0.0.1:8080/api/v1/health) | 服务端健康检查。 |
| [http://127.0.0.1:8080/swagger/index.html](http://127.0.0.1:8080/swagger/index.html) | Swagger API 文档。 |

登录时使用 `.env` 中的 `ADMIN_INITIAL_EMAIL` 和 `ADMIN_INITIAL_PASSWORD`。首次启动后，请在“配置与用户偏好”中配置 AI 渠道、模型和对象存储。

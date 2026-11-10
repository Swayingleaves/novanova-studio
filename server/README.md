# Novanova Studio Server

基于 JDK 21、Spring Boot 3.5 WebFlux、AgentScope Java、Redis 和 PostgreSQL 的服务端。

## 技术栈

- Web 框架：Spring Boot 3.5 WebFlux + Netty
- 数据访问：Spring Data R2DBC + PostgreSQL
- 迁移工具：Flyway
- 缓存与任务事件：Reactive Redis
- AI 编排：AgentScope Java
- API 文档：springdoc-openapi WebFlux UI

## 本地启动

```bash
cd server
mvn spring-boot:run
```

需要配置 `APP_SECRET_KEY`、PostgreSQL 和 Redis。接口前缀保持 `/api/v1`，响应结构保持 `{ code, data, msg }`，AI 任务事件通过 SSE `Flux` 推送。

### 支付宝沙箱配置

积分购买支持支付宝电脑网站支付和微信 Native 扫码支付。在管理后台「支付配置」填写对应渠道；沙箱联调时使用支付宝开放平台沙箱应用的应用标识、应用私钥、支付宝公钥和沙箱网关。通知地址必须是支付渠道可以访问的公网地址，不能使用 `localhost` 或内网地址。同步回跳只返回购买页，到账仍以异步通知或交易查询为准。私钥和 APIv3 密钥加密保存在数据库中，禁止提交到仓库、镜像或日志。

## 数据库

迁移脚本位于 `src/main/resources/db/migration/`，当前仅保留一个 `V1__Initial_Schema.sql` 初始化脚本。服务启动时会先连接 `POSTGRES_ADMINISTRATOR_DATABASE`（默认 `postgres`），目标 `POSTGRES_DATABASE` 不存在时自动创建，再由 Flyway 通过 JDBC 执行初始化；运行期业务读写统一通过 R2DBC 完成。

自动建库复用 `POSTGRES_USERNAME` 和 `POSTGRES_PASSWORD`，该账号必须具备管理数据库连接权限和 `CREATEDB` 权限。已有数据库不会被删除或重建；仍保留旧版 Flyway V1 至 V21 历史的数据库需要人工清空后再使用当前版本。

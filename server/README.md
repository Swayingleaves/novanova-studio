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

## 数据库

迁移脚本位于 `src/main/resources/db/migration/`，启动时由 Flyway 通过 JDBC 自动执行；运行期业务读写统一通过 R2DBC 完成。表名和字段名统一使用下划线，并为表和字段写注释。

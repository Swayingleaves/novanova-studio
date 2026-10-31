FROM maven:3.9.11-eclipse-temurin-21 AS builder

WORKDIR /app
COPY maven-settings.xml /opt/maven/settings.xml
COPY pom.xml .
COPY .mvn ./.mvn
COPY src ./src
# 直接打包并复用依赖缓存，避免预下载未使用的插件；并发构建时锁定仓库缓存。
RUN --mount=type=cache,id=novanova-studio-maven,target=/app/.maven-repository,sharing=locked mvn -B -ntp -s /opt/maven/settings.xml -DskipTests package

FROM eclipse-temurin:21-jre

# 默认使用中国标准时间，Compose 可通过 TZ 环境变量覆盖。
ENV TZ=Asia/Shanghai

# 画布视频合成任务使用FFmpeg和FFprobe处理本地临时媒体文件。
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /app/target/server-0.0.1-SNAPSHOT.jar /app/server.jar

EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/server.jar"]

FROM maven:3.9.11-eclipse-temurin-21 AS builder

WORKDIR /app
COPY maven-settings.xml /opt/maven/settings.xml
COPY pom.xml .
RUN --mount=type=cache,target=/root/.m2 mvn -q -s /opt/maven/settings.xml -DskipTests dependency:go-offline
COPY src ./src
RUN --mount=type=cache,target=/root/.m2 mvn -q -s /opt/maven/settings.xml -DskipTests package

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

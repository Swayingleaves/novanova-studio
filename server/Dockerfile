FROM maven:3.9.11-eclipse-temurin-21 AS builder

WORKDIR /app
COPY maven-settings.xml /opt/maven/settings.xml
COPY pom.xml .
RUN --mount=type=cache,target=/root/.m2 mvn -q -s /opt/maven/settings.xml -DskipTests dependency:go-offline
COPY src ./src
RUN --mount=type=cache,target=/root/.m2 mvn -q -s /opt/maven/settings.xml -DskipTests package

FROM eclipse-temurin:21-jre

WORKDIR /app
COPY --from=builder /app/target/server-0.0.1-SNAPSHOT.jar /app/server.jar

EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/server.jar"]

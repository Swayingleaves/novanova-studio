#!/usr/bin/env bash
# 固定线上环境的源码切换发布；任何阶段均禁止删除数据卷或自动恢复生产数据库。
set -Eeuo pipefail
umask 077

image_tag="${1:?缺少镜像版本标签}"
archive="${2:?缺少源码包路径}"
[[ "$image_tag" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,100}$ ]]
[[ "$archive" == /tmp/novanova-release.*.tar.gz && -f "$archive" ]]
directory='/data/novanova-studio'
backup='/data/novanova-studio.bak'
staging="/data/novanova-studio.release.${image_tag}"
snapshot="/data/novanova-deployment-backups/${image_tag}"
postgres='novanovastudio-pro-postgres'
redis='novanovastudio-pro-redis'
verifier="novanova-restore-check-${image_tag//./-}"
phase='准备'
stopped=false
verifier_started=false

# 按 Compose 服务标签读取现有容器，支持本次 Web 改名后的后续发布。
current_container() {
    local service="$1" containers
    mapfile -t containers < <(docker ps -aq --filter label=com.docker.compose.project=novanova-studio \
        --filter "label=com.docker.compose.service=$service" --filter label=com.docker.compose.oneoff=False)
    if [[ "${#containers[@]}" != 1 ]]; then
        printf '服务 %s 必须且只能有一个现有容器。\n' "$service" >&2
        return 1
    fi
    docker inspect --format '{{.Name}}' "${containers[0]}" | sed 's|^/||'
}

server_container="$(current_container server)"
web_container="$(current_container web)"
nginx_container="$(current_container nginx)"

# 每次操作都显式使用相同项目名和目录，禁止创建第二套生产服务。
compose() {
    docker compose --project-directory "$directory" --env-file "$directory/.env" --profile production \
        -p novanova-studio -f "$directory/docker-compose.yml" "$@"
}

# 校验失败即保留现场，不自动回退应用或覆盖生产数据。
recover() {
    local result="$?"
    trap - EXIT
    if [[ "$verifier_started" == true ]]; then
        docker rm -f "$verifier" >/dev/null 2>&1 || true
    fi
    if [[ "$result" != 0 ]]; then
        printf '发布失败，阶段：%s。所有源码目录与备份均保留。\n' "$phase" >&2
        if [[ "$stopped" == true ]]; then
            printf '维护窗口尚未结束，请先检查失败原因后继续发布；禁止自动恢复数据库。\n' >&2
        fi
    fi
    exit "$result"
}
trap recover EXIT

# 使用宿主机端口探测就绪状态，每次等待有明确的时间上限。
wait_health() {
    local address="$1" attempts="$2"
    for ((attempt=0; attempt<attempts; attempt++)); do
        if curl --fail --silent --max-time 5 "$address" > "$snapshot/health-response.json"; then
            return 0
        fi
        sleep 3
    done
    printf '服务健康检查超时：%s\n' "$address" >&2
    return 1
}

# 校验 Spring Boot Actuator 返回的健康状态，避免只有 HTTP 200 但依赖未就绪时放开入口。
wait_actuator_health() {
    local address="$1" attempts="$2"
    for ((attempt=0; attempt<attempts; attempt++)); do
        if curl --fail --silent --max-time 5 "$address" > "$snapshot/actuator-health.json" \
            && grep -Eq '"status"[[:space:]]*:[[:space:]]*"UP"' "$snapshot/actuator-health.json"; then
            return 0
        fi
        sleep 3
    done
    printf 'Actuator 健康检查超时或状态异常：%s\n' "$address" >&2
    return 1
}

exec 9>/data/novanova-deployment.lock
flock -n 9
[[ -d "$directory/volume/postgres_data" && -f "$directory/.env" ]]
[[ ! -e "$staging" && ! -e "$snapshot" ]]
! docker container inspect "$verifier" >/dev/null 2>&1
available="$(df --output=avail -k /data | tail -1)"
[[ "$available" -gt 8388608 ]]
old_tag="$(docker inspect --format '{{.Config.Image}}' "$server_container" | awk -F: '{print $NF}')"
[[ "$old_tag" != "$image_tag" ]]
if docker image inspect "novanovastudio-pro-server:$image_tag" >/dev/null 2>&1; then
    printf '服务端镜像标签已存在，必须使用唯一标签：%s\n' "$image_tag" >&2
    exit 1
fi
if docker image inspect "novanovastudio-web:$image_tag" >/dev/null 2>&1; then
    printf '前端镜像标签已存在，必须使用唯一标签：%s\n' "$image_tag" >&2
    exit 1
fi
postgres_image="$(docker inspect --format '{{.Image}}' "$postgres")"
[[ "$(docker image inspect postgres:17 --format '{{.Id}}')" == "$postgres_image" ]]
[[ "$(docker image inspect redis:8.6 --format '{{.Id}}')" == "$(docker inspect --format '{{.Image}}' "$redis")" ]]
username="$(docker exec "$postgres" printenv POSTGRES_USER)"
database="$(docker exec "$postgres" printenv POSTGRES_DB)"
mkdir -p "$staging" "$snapshot"
chmod 700 "$snapshot"
cp -p "$archive" "$snapshot/source.tar.gz"
sha256sum "$snapshot/source.tar.gz" > "$snapshot/source.sha256"
docker inspect --format '{{.Name}} {{.Image}} {{.Config.Image}}' \
    "$postgres" "$redis" "$server_container" "$web_container" "$nginx_container" > "$snapshot/images-before.txt"
cp -a /etc/nginx/conf.d "$snapshot/nginx-configuration"
tar -xzf "$archive" --no-same-owner -C "$staging"
chown -R ubuntu:ubuntu "$staging"
python3 "$staging/scripts/deployment-check.py" merge-environment \
    "$directory/.env" "$staging/.env" "$staging/.env.example" "$image_tag"
chown ubuntu:ubuntu "$staging/.env"
# 线上自定义提示词继续保留，新增加的提示词仍由新源码提供。
cp -a "$directory/server/config/prompts/." "$staging/server/config/prompts/"
for item in .agnes web/.source; do
    if [[ -e "$directory/$item" ]]; then
        mkdir -p "$(dirname "$staging/$item")"
        cp -a "$directory/$item" "$staging/$item"
    fi
done
IMAGE_TAG="$image_tag" docker compose --project-directory "$staging" --env-file "$staging/.env" \
    --profile production -p novanova-studio -f "$staging/docker-compose.yml" \
    config --format json > "$snapshot/compose.json"
python3 "$staging/scripts/deployment-check.py" configuration "$snapshot/compose.json" "$server_container"
python3 "$staging/scripts/deployment-check.py" migrations "$postgres" "$username" "$database" \
    "$staging/server/src/main/resources/db/migration"

phase='构建镜像，线上继续服务'
for service in server web; do
    printf '开始构建：%s\n' "$service"
    IMAGE_TAG="$image_tag" docker compose --progress plain --project-directory "$staging" \
        --env-file "$staging/.env" --profile production -p novanova-studio \
        -f "$staging/docker-compose.yml" build "$service"
done

phase='停止写入并备份数据库'
printf '构建完成，开始维护窗口与数据库备份。\n'
stopped=true
docker stop -t 90 "$nginx_container" "$web_container" "$server_container" > /dev/null
[[ "$(docker inspect --format '{{.State.Running}}' "$server_container")" == false ]]
# 应用停止后不应再有数据库客户端写入，存在外部连接时中止维护。
connections="$(docker exec "$postgres" psql -X -At -U "$username" -d "$database" -v ON_ERROR_STOP=1 \
    -c 'SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND backend_type = '\''client backend'\''')"
[[ "$connections" == 0 ]]
python3 "$staging/scripts/deployment-check.py" migrations "$postgres" "$username" "$database" \
    "$staging/server/src/main/resources/db/migration"
python3 "$staging/scripts/deployment-check.py" manifest "$postgres" "$username" "$database" "$snapshot/database-before.json"
docker exec "$postgres" pg_dump -U "$username" -d "$database" -Fc > "$snapshot/database.dump"
docker exec "$postgres" pg_dumpall -U "$username" --globals-only > "$snapshot/database-globals.sql"
docker exec -i "$postgres" pg_restore --list < "$snapshot/database.dump" > "$snapshot/database-dump.list"
[[ -s "$snapshot/database.dump" && -s "$snapshot/database-dump.list" ]]
sha256sum "$snapshot/database.dump" "$snapshot/database-globals.sql" > "$snapshot/database.sha256"

phase='在隔离数据库实际恢复备份'
mkdir "$snapshot/restore-postgres"
docker run -d --name "$verifier" --network none \
    -e POSTGRES_HOST_AUTH_METHOD=trust -e "POSTGRES_USER=$username" -e "POSTGRES_DB=$database" \
    --mount "type=bind,source=$snapshot/restore-postgres,target=/var/lib/postgresql/data" "$postgres_image" > /dev/null
verifier_started=true
ready=false
for ((attempt=0; attempt<60; attempt++)); do
    if docker exec "$verifier" pg_isready -h 127.0.0.1 -U "$username" -d "$database" > /dev/null 2>&1; then
        ready=true
        break
    fi
    sleep 1
done
[[ "$ready" == true ]]
docker exec -i "$verifier" pg_restore --exit-on-error --no-owner --no-acl -U "$username" -d "$database" \
    < "$snapshot/database.dump" > "$snapshot/restore.log" 2>&1
python3 "$staging/scripts/deployment-check.py" manifest "$verifier" "$username" "$database" "$snapshot/database-restored.json"
cmp "$snapshot/database-before.json" "$snapshot/database-restored.json"
docker stop -t 60 "$verifier" > /dev/null
docker rm "$verifier" > /dev/null
verifier_started=false

phase='停止数据服务并制作完整冷备'
docker stop -t 90 "$postgres" "$redis" > /dev/null
[[ "$(docker inspect --format '{{.State.Running}}' "$postgres")" == false ]]
[[ "$(docker inspect --format '{{.State.Running}}' "$redis")" == false ]]
cp -a "$directory/volume" "$staging/volume"
cp -a "$directory/logs" "$staging/logs"
diff -qr --no-dereference "$directory/volume" "$staging/volume"
sync
if [[ -e "$backup" ]]; then
    mv "$backup" "$snapshot/previous-source-backup"
fi
mv "$directory" "$backup"
if ! mv "$staging" "$directory"; then
    mv "$backup" "$directory"
    exit 1
fi
phase='启动数据服务并比较全部表内容'
compose up -d --no-build --pull never --force-recreate postgres redis
for ((attempt=0; attempt<90; attempt++)); do
    if [[ "$(docker inspect --format '{{.State.Health.Status}}' "$postgres")" == healthy && \
          "$(docker inspect --format '{{.State.Health.Status}}' "$redis")" == healthy ]]; then
        break
    fi
    sleep 2
done
[[ "$(docker inspect --format '{{.State.Health.Status}}' "$postgres")" == healthy ]]
[[ "$(docker inspect --format '{{.State.Health.Status}}' "$redis")" == healthy ]]
postgres_binding="$(docker inspect --format '{{range $port, $bindings := .HostConfig.PortBindings}}{{range $bindings}}{{printf "%s:%s:%s\n" $port .HostIp .HostPort}}{{end}}{{end}}' "$postgres")"
redis_binding="$(docker inspect --format '{{range $port, $bindings := .HostConfig.PortBindings}}{{range $bindings}}{{printf "%s:%s:%s\n" $port .HostIp .HostPort}}{{end}}{{end}}' "$redis")"
[[ "$postgres_binding" == '5432/tcp:127.0.0.1:15432' ]]
[[ "$redis_binding" == '6379/tcp:127.0.0.1:16379' ]]
python3 "$directory/scripts/deployment-check.py" manifest "$postgres" "$username" "$database" "$snapshot/database-after-copy.json"
cmp "$snapshot/database-before.json" "$snapshot/database-after-copy.json"
[[ "$(docker exec "$redis" redis-cli ping)" == PONG ]]

phase='启动应用并验证，入口尚未开放'
compose up -d --no-build --pull never --no-deps --force-recreate server
wait_actuator_health http://127.0.0.1:18080/actuator/health 100
python3 "$directory/scripts/deployment-check.py" migrations "$postgres" "$username" "$database" \
    "$directory/server/src/main/resources/db/migration"
[[ "$(current_container web)" == "$web_container" ]]
compose up -d --no-build --pull never --no-deps --force-recreate web
[[ "$(current_container web)" == novanovastudio-web ]]
wait_health http://127.0.0.1:15555/ 60
compose run --rm --no-deps nginx nginx -t
phase='开放入口并验证 HTTPS'
compose up -d --no-build --pull never --no-deps --force-recreate nginx
wait_health https://www.novanovastudio.cn/ 30
curl --fail --silent --show-error --max-time 15 https://www.novanovastudio.cn/api/v1/health > "$snapshot/public-health.json"
grep -Eq '"code"[[:space:]]*:[[:space:]]*0' "$snapshot/public-health.json"
compose ps
docker inspect --format '{{.Name}} {{json .HostConfig.PortBindings}}' "$postgres" "$redis" > "$snapshot/ports-after.txt"
printf '发布成功：%s\n旧源码及冷备：%s\n数据库备份及校验：%s\n' "$image_tag" "$backup" "$snapshot"
printf '%s\n' "$image_tag" > "$snapshot/SUCCESS"
rm -f "$archive"

#!/usr/bin/env bash

set -Eeuo pipefail

if [[ $# -ne 1 ]]; then
    printf '使用方式：%s <镜像版本标签|onlyRestart>\n' "$0" >&2
    exit 1
fi

operation="$1"
only_restart=false
image_tag=''
if [[ "$operation" == 'onlyRestart' ]]; then
    only_restart=true
else
    image_tag="$operation"
    if [[ ! "$image_tag" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]]; then
        printf '镜像版本标签不符合 Docker 标签规范：%s\n' "$image_tag" >&2
        exit 1
    fi
fi

remote_host='ubuntu@110.40.137.187'
remote_directory='/data/novanova-studio'
# 沿用线上已有的 Compose 项目标识，确保更新现有容器。
remote_compose_project='novanova-studio'
script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
local_archive_path=''
remote_archive_path=''
archive_uploaded=false

check_command() {
    local command_name="$1"

    if ! command -v "$command_name" >/dev/null 2>&1; then
        printf '未找到本地命令：%s\n' "$command_name" >&2
        exit 1
    fi
}

run_remote_command() {
    ssh -o BatchMode=yes -o ConnectTimeout=10 "$remote_host" "$1"
}

cleanup() {
    if [[ -n "$local_archive_path" ]]; then
        rm -f "$local_archive_path"
    fi

    if [[ "$archive_uploaded" == true ]] && ! run_remote_command "rm -f '$remote_archive_path'"; then
        printf '警告：远端临时源码包清理失败。\n' >&2
    fi
}

trap cleanup EXIT

check_command ssh

if [[ "$only_restart" == true ]]; then
    printf '仅重启远端全部服务，不上传源码或构建镜像...\n'
else
    printf '本次发布镜像标签：%s\n' "$image_tag"
fi

printf '检查远端 Docker Compose 环境...\n'
run_remote_command 'sudo -n docker compose version'

if [[ "$only_restart" == true ]]; then
    run_remote_command "cd '$remote_directory' && current_tag=\$(sudo -n docker inspect --format '{{.Config.Image}}' novanovastudio-pro-server 2>/dev/null | awk -F: '{print \$NF}') && sudo -n env IMAGE_TAG=\"\${current_tag:-latest}\" docker compose -p '$remote_compose_project' -f docker-compose.yml -f docker-compose-production.yml up -d"

    printf '检查服务状态...\n'
    run_remote_command "cd '$remote_directory' && sudo -n docker compose -p '$remote_compose_project' -f docker-compose.yml -f docker-compose-production.yml ps"
    printf '远端服务重启完成。\n'
    exit 0
fi

for command_name in scp tar; do
    check_command "$command_name"
done

local_archive_path="$(mktemp "${TMPDIR:-/tmp}/novanova-studio-pro.XXXXXX.tar.gz")"
remote_archive_path="/tmp/novanova-studio-pro.$(date +%s).$$.tar.gz"

printf '打包源码...\n'
tar_metadata_options=(--no-xattrs)
if [[ "$(uname -s)" == 'Darwin' ]]; then
    # macOS 文件可能带有 FinderInfo、隔离标记等扩展属性，不能随源码上传。
    tar_metadata_options+=(--no-fflags)
fi

COPYFILE_DISABLE=1 tar \
    "${tar_metadata_options[@]}" \
    --exclude='.git' \
    --exclude='.DS_Store' \
    --exclude='.idea' \
    --exclude='.codegraph' \
    --exclude='.claude' \
    --exclude='.codex' \
    --exclude='.impeccable' \
    --exclude='.trellis' \
    --exclude='.workbuddy' \
    --exclude='.next' \
    --exclude='node_modules' \
    --exclude='.pnpm-store' \
    --exclude='.maven-repository' \
    --exclude='out' \
    --exclude='data' \
    --exclude='volume' \
    --exclude='logs' \
    --exclude='.env' \
    --exclude='.env.example' \
    --exclude='.env.development.local' \
    --exclude='.env.test.local' \
    --exclude='.env.production.local' \
    --exclude='*.log' \
    --exclude='*.tsbuildinfo' \
    --exclude='server/target' \
    --exclude='artifacts' \
    -czf "$local_archive_path" \
    -C "$script_directory" \
    .

printf '上传源码...\n'
scp -o BatchMode=yes -o ConnectTimeout=10 "$local_archive_path" "$remote_host:$remote_archive_path"
archive_uploaded=true

printf '解压源码...\n'
run_remote_command "mkdir -p '$remote_directory' && tar -xzf '$remote_archive_path' --no-same-owner -C '$remote_directory'"

printf '构建并启动服务...\n'
run_remote_command "cd '$remote_directory' && sudo -n env IMAGE_TAG='$image_tag' docker compose -p '$remote_compose_project' -f docker-compose.yml -f docker-compose-production.yml up --build -d"

printf '检查服务状态...\n'
run_remote_command "cd '$remote_directory' && sudo -n env IMAGE_TAG='$image_tag' docker compose -p '$remote_compose_project' -f docker-compose.yml -f docker-compose-production.yml ps"

printf '发布完成。\n'

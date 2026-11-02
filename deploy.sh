#!/usr/bin/env bash
# 从当前工作区打包并调用线上分阶段发布，保留数据库与原生产配置。
set -Eeuo pipefail

if [[ $# != 1 || ! "$1" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,100}$ ]]; then
    printf '使用方式：%s <唯一镜像版本标签|onlyRestart>\n' "$0" >&2
    exit 1
fi

remote_host='ubuntu@110.40.137.187'
script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$script_directory"

if [[ "$1" == 'onlyRestart' ]]; then
    ssh -o BatchMode=yes "$remote_host" 'cd /data/novanova-studio && sudo -n docker compose --env-file .env -f docker-compose.yml --profile production -p novanova-studio restart server web nginx'
    exit 0
fi

image_tag="$1"
archive="$(mktemp "${TMPDIR:-/tmp}/novanova-release.XXXXXX.tar.gz")"
file_list="$(mktemp "${TMPDIR:-/tmp}/novanova-files.XXXXXX")"
trap 'rm -f "$archive" "$file_list"' EXIT
git ls-files -z -- . ':!docker-compose-production.yml' > "$file_list"
printf '%s\0' deploy.sh docker-compose.yml scripts/deployment-check.py scripts/deploy-production.sh >> "$file_list"
sort -zu "$file_list" -o "$file_list"
printf '打包当前源码及配置（不包含生产 .env 和数据目录）...\n'
COPYFILE_DISABLE=1 tar --null --no-recursion -czf "$archive" -T "$file_list"
remote_archive="/tmp/novanova-release.${image_tag}.$$.tar.gz"
scp -o BatchMode=yes -o ConnectTimeout=10 "$archive" "$remote_host:$remote_archive"
printf '执行生产发布：%s\n' "$image_tag"
ssh -o BatchMode=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=20 "$remote_host" \
    "tar -xOf '$remote_archive' scripts/deploy-production.sh | sudo -n bash -s -- '$image_tag' '$remote_archive'"

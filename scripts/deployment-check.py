#!/usr/bin/env python3
"""发布前补齐配置，核验迁移历史，并生成不含业务原文的数据库校验清单。"""

import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import zlib


# 使用固定偏移，避免宿主机 localtime 挂载影响容器时区文件及时间字段的输出。
SESSION_SETTINGS = "SET TIME ZONE INTERVAL '+00:00' HOUR TO MINUTE; "


def read_environment(path):
    """读取当前部署使用的单行环境变量，拒绝重复定义。"""
    result = {}
    for line in Path(path).read_text(encoding="utf-8-sig").splitlines():
        match = re.match(r"^\s*([A-Z][A-Z0-9_]*)\s*=(.*)$", line)
        if match:
            key, value = match.groups()
            if key in result:
                raise RuntimeError(f"环境变量重复定义：{key}")
            result[key] = value
    return result


def merge_environment(source, target, example, image_tag):
    """保留线上密钥和业务设置，只补齐缺失参数并明确本次生产版本。"""
    existing = read_environment(source)
    defaults = read_environment(example)
    required = ("APP_SECRET_KEY", "FRONTEND_BASE_URL", "POSTGRES_USERNAME",
                "POSTGRES_PASSWORD", "POSTGRES_DATABASE", "POSTGRES_PORT", "SERVER_PORT")
    for key in required:
        if not existing.get(key, "").strip(" '\""):
            raise RuntimeError(f"线上缺少必填配置：{key}，禁止用示例凭据补齐")
    location = existing.get("FLYWAY_MIGRATION_LOCATION", "classpath:db/migration").strip(" '\"")
    if location != "classpath:db/migration":
        raise RuntimeError("本生产发布仅支持原企业迁移历史，禁止切换目录")
    defaults.update({
        "FLYWAY_MIGRATION_LOCATION": "classpath:db/migration",
        "COMPOSE_PROFILES": "production",
        "POSTGRES_CONTAINER_NAME": "novanovastudio-pro-postgres",
        "REDIS_CONTAINER_NAME": "novanovastudio-pro-redis",
        "SERVER_CONTAINER_NAME": "novanovastudio-pro-server",
        "WEB_CONTAINER_NAME": "novanovastudio-web",
        "NGINX_CONTAINER_NAME": "novanovastudio-pro-nginx",
        "SERVER_IMAGE_NAME": "novanovastudio-pro-server",
        "WEB_IMAGE_NAME": "novanovastudio-web",
        "WEB_PORT": "15555",
        "NGINX_CONFIG_DIRECTORY": "/etc/nginx/conf.d",
        "NGINX_STATIC_DIRECTORY": "/usr/share/nginx/html",
        "NGINX_SSL_DIRECTORY": "/etc/nginx/ssl",
        "NGINX_LOG_DIRECTORY": "./logs/nginx",
    })
    defaults["IMAGE_TAG"] = image_tag
    production_values = {
        key: defaults[key] for key in (
            "COMPOSE_PROFILES", "POSTGRES_CONTAINER_NAME", "REDIS_CONTAINER_NAME",
            "SERVER_CONTAINER_NAME", "WEB_CONTAINER_NAME", "NGINX_CONTAINER_NAME",
            "SERVER_IMAGE_NAME", "WEB_IMAGE_NAME", "NGINX_CONFIG_DIRECTORY",
            "NGINX_STATIC_DIRECTORY", "NGINX_SSL_DIRECTORY", "NGINX_LOG_DIRECTORY",
        )
    }
    for key, value in production_values.items():
        if key not in ("WEB_CONTAINER_NAME", "WEB_IMAGE_NAME") and key in existing and existing[key].strip(" '\"") != value:
            raise RuntimeError(f"线上配置与当前生产 Compose 约定冲突：{key}")
    # 保留原凭据与业务设置，仅调整已明确约定的部署身份和版本。
    content = Path(source).read_text(encoding="utf-8-sig").rstrip("\n") + "\n"
    replacements = {**production_values, "IMAGE_TAG": image_tag}
    for key, value in replacements.items():
        pattern = rf"(?m)^\s*{re.escape(key)}\s*=.*$"
        if re.search(pattern, content):
            content = re.sub(pattern, f"{key}={value}", content)
        else:
            content += f"{key}={value}\n"
    additions = {
        key: value for key, value in defaults.items()
        if key not in existing and key not in replacements
    }
    content += "\n# 生产发布补齐参数，保留原密钥与业务配置。\n"
    content += "".join(f"{key}={value}\n" for key, value in additions.items())
    Path(target).write_text(content, encoding="utf-8")
    os.chmod(target, 0o600)
    print("已补齐非敏感参数：" + ", ".join(additions))


def query(container, username, database, statement):
    """通过容器内本地连接执行只读 SQL，失败立即终止。"""
    return subprocess.check_output([
        "docker", "exec", container, "psql", "-X", "-q", "-A", "-t",
        "-v", "ON_ERROR_STOP=1", "-U", username, "-d", database, "-c", SESSION_SETTINGS + statement,
    ], text=True)


def validate_migrations(container, username, database, directory):
    """逐项验证线上 Flyway CRC32 校验和，拒绝缺失、修改及未审查迁移。"""
    history = json.loads(query(container, username, database,
        "SELECT coalesce(json_agg(h ORDER BY installed_rank),'[]') FROM flyway_schema_history h"))
    files = {}
    for path in Path(directory).glob("V*__*.sql"):
        version = path.name.split("__", 1)[0][1:]
        checksum = 0
        for line in path.read_text(encoding="utf-8-sig").splitlines():
            checksum = zlib.crc32(line.encode("utf-8"), checksum)
        files[version] = (path.name, checksum if checksum < 2**31 else checksum - 2**32)
    versions = set()
    for migration in history:
        version = migration["version"]
        if not migration["success"] or migration["type"] != "SQL":
            raise RuntimeError("迁移历史存在失败记录或不支持的迁移类型")
        expected = (migration["script"], migration["checksum"])
        if files.get(version) != expected:
            raise RuntimeError(f"已执行迁移 V{version} 与待发布源码不一致")
        versions.add(version)
    if not history or set(files) != versions:
        raise RuntimeError("本次发布要求迁移版本完全一致，禁止自动执行未经审查的新迁移")
    print(f"迁移校验通过：{len(history)} 条历史，最高版本 V{history[-1]['version']}")


def database_manifest(container, username, database, output):
    """对全部公共表内容排序后计算 SHA256，并记录序列状态。"""
    names = json.loads(query(container, username, database,
        "SELECT coalesce(json_agg(tablename ORDER BY tablename),'[]') "
        "FROM pg_tables WHERE schemaname='public'"))
    manifest = {"tables": [], "sequences": []}
    for name in names:
        quoted = '"' + name.replace('"', '""') + '"'
        statement = (f"COPY (SELECT row_to_json(record)::text FROM public.{quoted} record "
                     'ORDER BY row_to_json(record)::text COLLATE "C") TO STDOUT')
        process = subprocess.Popen([
            "docker", "exec", container, "psql", "-X", "-q", "-A", "-t",
            "-v", "ON_ERROR_STOP=1", "-U", username, "-d", database, "-c", SESSION_SETTINGS + statement,
        ], stdout=subprocess.PIPE)
        checksum = hashlib.sha256()
        rows = 0
        while chunk := process.stdout.read(1024 * 1024):
            checksum.update(chunk)
            rows += chunk.count(b"\n")
        process.stdout.close()
        if process.wait() != 0:
            raise RuntimeError(f"表校验失败：{name}")
        manifest["tables"].append({"name": name, "rows": rows, "sha256": checksum.hexdigest()})
    sequences = json.loads(query(container, username, database,
        "SELECT coalesce(json_agg(sequencename ORDER BY sequencename),'[]') "
        "FROM pg_sequences WHERE schemaname='public'"))
    for name in sequences:
        quoted = '"' + name.replace('"', '""') + '"'
        value = query(container, username, database, f"SELECT last_value,is_called FROM public.{quoted}").strip()
        manifest["sequences"].append({"name": name, "state": value})
    Path(output).write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"已校验 {len(names)} 张表及 {len(sequences)} 个序列")


def validate_configuration(path, current_container):
    """检查渲染后的生产配置，确保身份、密钥与回环端口均保持正确。"""
    configuration = json.loads(Path(path).read_text())
    services = configuration["services"]
    inspected = json.loads(subprocess.check_output(["docker", "inspect", current_container]))[0]
    current = dict(item.split("=", 1) for item in inspected["Config"]["Env"] if "=" in item)
    environment = services["server"]["environment"]
    for key in ("APP_SECRET_KEY", "POSTGRES_USERNAME", "POSTGRES_PASSWORD", "POSTGRES_DATABASE",
                "ADMIN_INITIAL_PASSWORD", "EMAIL_SMTP_PASSWORD", "OAUTH2_GOOGLE_CLIENT_SECRET",
                "OAUTH2_LINUX_DO_CLIENT_SECRET", "ALIPAY_PRIVATE_KEY", "ALIPAY_PUBLIC_KEY"):
        if key in current and environment.get(key) != current[key]:
            raise RuntimeError(f"生产配置改变了正在使用的凭据：{key}")
    if environment["FLYWAY_MIGRATION_LOCATION"] != "classpath:db/migration":
        raise RuntimeError("迁移目录错误")
    for name, port in (("postgres", 15432), ("redis", 16379), ("server", 18080), ("web", 15555)):
        expected_name = "novanovastudio-web" if name == "web" else f"novanovastudio-pro-{name}"
        if services[name]["container_name"] != expected_name:
            raise RuntimeError(f"容器名称错误：{name}")
        ports = services[name]["ports"]
        if len(ports) != 1 or ports[0].get("host_ip") != "127.0.0.1" or int(ports[0]["published"]) != port:
            raise RuntimeError(f"生产端口绑定错误：{name}")
    nginx = services["nginx"]
    if "production" not in nginx.get("profiles", []) or nginx.get("network_mode") != "host":
        raise RuntimeError("生产 Nginx 配置档或宿主机网络错误")
    for name, image in (("server", "novanovastudio-pro-server"), ("web", "novanovastudio-web")):
        if services[name]["image"].split(":", 1)[0] != image:
            raise RuntimeError(f"生产镜像名称错误：{name}")
    if services["nginx"].get("container_name") != "novanovastudio-pro-nginx":
        raise RuntimeError("生产 Nginx 容器名称错误")
    mounts = {mount["target"]: mount["source"] for mount in nginx["volumes"]}
    for target in ("/etc/nginx/conf.d", "/etc/nginx/ssl", "/usr/share/nginx/html"):
        if mounts.get(target) != target:
            raise RuntimeError(f"Nginx 宿主机目录错误：{target}")
    print("生产容器、密钥、端口和 Nginx 挂载检查通过")


def main():
    """按子命令执行发布检查，异常由部署脚本处理。"""
    command, *arguments = sys.argv[1:]
    operations = {"merge-environment": merge_environment, "migrations": validate_migrations,
                  "manifest": database_manifest, "configuration": validate_configuration}
    operations[command](*arguments)


if __name__ == "__main__":
    main()

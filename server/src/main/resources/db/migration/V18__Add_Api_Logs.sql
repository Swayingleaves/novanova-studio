-- 接口访问日志表：记录所有 /api/** 请求元数据及失败响应正文，仅保留近 30 天
CREATE TABLE api_logs (
    id            BIGSERIAL PRIMARY KEY,
    http_method   VARCHAR(10)  NOT NULL,
    request_path  TEXT         NOT NULL,
    client_ip     VARCHAR(64)  NOT NULL,
    user_id       BIGINT       NULL,
    status_code   INTEGER      NOT NULL,
    success       BOOLEAN      NOT NULL,
    has_error     BOOLEAN      NOT NULL,
    error_content TEXT         NULL,
    request_body  TEXT         NULL,
    duration_ms   INTEGER      NOT NULL,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_api_logs_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
);

COMMENT ON TABLE api_logs IS '接口访问日志，记录所有 /api/** 请求元数据及失败响应正文，仅保留近 30 天';
COMMENT ON COLUMN api_logs.id            IS '主键';
COMMENT ON COLUMN api_logs.http_method   IS 'HTTP 方法（GET/POST 等，大写）';
COMMENT ON COLUMN api_logs.request_path  IS '请求地址（路径+查询参数已脱敏），如 /api/v1/xxx?a=1';
COMMENT ON COLUMN api_logs.client_ip     IS '访问者客户端 IP（含 X-Forwarded-For 解析）';
COMMENT ON COLUMN api_logs.user_id       IS '访问用户 ID，未登录为 NULL';
COMMENT ON COLUMN api_logs.status_code   IS 'HTTP 响应状态码';
COMMENT ON COLUMN api_logs.success       IS '是否成功（status_code < 400）';
COMMENT ON COLUMN api_logs.has_error     IS '是否有错误（status_code >= 400，等价于 NOT success）';
COMMENT ON COLUMN api_logs.error_content IS '失败响应正文（截断，最长 20000 字符）';
COMMENT ON COLUMN api_logs.request_body  IS '请求体/参数（脱敏并截断，最长 20000 字符；multipart 为摘要）';
COMMENT ON COLUMN api_logs.duration_ms   IS '请求耗时（毫秒）';
COMMENT ON COLUMN api_logs.created_at    IS '创建时间，用于保留期清理与默认排序';

-- 保留期清理与默认时间倒序查询
CREATE INDEX idx_api_logs_created_at ON api_logs (created_at DESC);
-- 按用户筛选
CREATE INDEX idx_api_logs_user_id    ON api_logs (user_id);
-- 按成功/失败状态筛选
CREATE INDEX idx_api_logs_status_code ON api_logs (status_code);

ALTER TABLE users
    ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN users.token_version IS '登录令牌版本，密码重置后递增以使旧令牌失效';

CREATE TABLE password_reset_tokens (
    user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE password_reset_tokens IS '密码重置令牌表，每个用户仅保留最新令牌';
COMMENT ON COLUMN password_reset_tokens.user_id IS '用户ID';
COMMENT ON COLUMN password_reset_tokens.token_hash IS '重置令牌SHA-256哈希';
COMMENT ON COLUMN password_reset_tokens.expires_at IS '过期时间';
COMMENT ON COLUMN password_reset_tokens.used_at IS '使用或失效时间';
COMMENT ON COLUMN password_reset_tokens.created_at IS '创建时间';
COMMENT ON COLUMN password_reset_tokens.updated_at IS '更新时间';

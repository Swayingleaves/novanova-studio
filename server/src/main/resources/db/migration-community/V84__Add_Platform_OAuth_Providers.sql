CREATE TABLE platform_oauth_providers (
    provider VARCHAR(32) PRIMARY KEY,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    client_id VARCHAR(255) NOT NULL DEFAULT '',
    client_secret_encrypted VARCHAR(1024) NOT NULL DEFAULT '',
    redirect_uri VARCHAR(512) NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
COMMENT ON TABLE platform_oauth_providers IS '平台 OAuth2 第三方登录渠道配置，每个内置渠道一行，取代原 .env 配置';
COMMENT ON COLUMN platform_oauth_providers.provider IS '渠道标识，与认证渠道实现保持一致：google 或 linuxDo';
COMMENT ON COLUMN platform_oauth_providers.enabled IS '是否启用该登录渠道';
COMMENT ON COLUMN platform_oauth_providers.client_id IS '第三方应用客户端 ID';
COMMENT ON COLUMN platform_oauth_providers.client_secret_encrypted IS 'AES-GCM 加密后的第三方应用客户端密钥，空字符串表示未配置';
COMMENT ON COLUMN platform_oauth_providers.redirect_uri IS '第三方登录回调地址，必须为指向本站回调路径的绝对地址';
COMMENT ON COLUMN platform_oauth_providers.updated_at IS '配置最后更新时间';

INSERT INTO platform_oauth_providers (provider) VALUES ('google'), ('linuxDo');

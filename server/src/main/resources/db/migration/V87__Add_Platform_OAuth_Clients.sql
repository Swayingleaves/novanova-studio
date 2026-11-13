CREATE TABLE platform_oauth_clients (
    client_id VARCHAR(64) PRIMARY KEY,
    display_name VARCHAR(50) NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    client_secret_encrypted VARCHAR(1024) NOT NULL,
    redirect_uris TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE platform_oauth_clients IS '对外 OAuth2 授权客户端，供其他系统使用本站账号登录';
COMMENT ON COLUMN platform_oauth_clients.client_id IS '客户端标识，由服务端生成，创建后不可修改';
COMMENT ON COLUMN platform_oauth_clients.display_name IS '应用名称，展示在授权确认页和管理后台';
COMMENT ON COLUMN platform_oauth_clients.enabled IS '是否允许该客户端发起授权';
COMMENT ON COLUMN platform_oauth_clients.client_secret_encrypted IS 'AES-GCM 加密后的客户端密钥';
COMMENT ON COLUMN platform_oauth_clients.redirect_uris IS '允许的回调地址 JSON 数组，授权时必须与其中一项全字匹配';
COMMENT ON COLUMN platform_oauth_clients.created_at IS '创建时间';
COMMENT ON COLUMN platform_oauth_clients.updated_at IS '最后更新时间';

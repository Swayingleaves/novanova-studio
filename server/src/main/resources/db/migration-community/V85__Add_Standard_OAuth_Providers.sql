CREATE TABLE platform_standard_oauth_providers (
    provider VARCHAR(30) PRIMARY KEY,
    display_name VARCHAR(50) NOT NULL DEFAULT '标准 OAuth2',
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    client_id VARCHAR(255) NOT NULL DEFAULT '',
    client_secret_encrypted VARCHAR(1024) NOT NULL DEFAULT '',
    redirect_uri VARCHAR(512) NOT NULL DEFAULT '',
    authorization_uri VARCHAR(512) NOT NULL DEFAULT '',
    token_uri VARCHAR(512) NOT NULL DEFAULT '',
    user_info_uri VARCHAR(512) NOT NULL DEFAULT '',
    scopes VARCHAR(255) NOT NULL DEFAULT 'profile email',
    client_authentication_method VARCHAR(32) NOT NULL DEFAULT 'client_secret_basic',
    user_name_attribute VARCHAR(64) NOT NULL DEFAULT 'sub',
    email_attribute VARCHAR(64) NOT NULL DEFAULT 'email',
    nickname_attribute VARCHAR(64) NOT NULL DEFAULT 'name',
    avatar_attribute VARCHAR(64) NOT NULL DEFAULT 'picture',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
COMMENT ON TABLE platform_standard_oauth_providers IS '平台标准 OAuth2 登录渠道配置，每个自定义渠道一行，由管理后台维护';
COMMENT ON COLUMN platform_standard_oauth_providers.provider IS '渠道标识，由管理后台生成，创建后不可修改';
COMMENT ON COLUMN platform_standard_oauth_providers.display_name IS '渠道名称，展示在管理后台与登录页';
COMMENT ON COLUMN platform_standard_oauth_providers.enabled IS '是否启用该登录渠道';
COMMENT ON COLUMN platform_standard_oauth_providers.client_id IS 'OAuth2 客户端 ID';
COMMENT ON COLUMN platform_standard_oauth_providers.client_secret_encrypted IS 'AES-GCM 加密后的 OAuth2 客户端密钥，空字符串表示未配置';
COMMENT ON COLUMN platform_standard_oauth_providers.redirect_uri IS '完整回调地址，路径必须为 /api/v1/auth/oauth/callback/{provider}';
COMMENT ON COLUMN platform_standard_oauth_providers.authorization_uri IS 'OAuth2 授权端点';
COMMENT ON COLUMN platform_standard_oauth_providers.token_uri IS 'OAuth2 令牌端点';
COMMENT ON COLUMN platform_standard_oauth_providers.user_info_uri IS 'OAuth2 用户信息端点，登录后通过该接口读取账号资料';
COMMENT ON COLUMN platform_standard_oauth_providers.scopes IS '授权范围，空格分隔，不允许包含 openid';
COMMENT ON COLUMN platform_standard_oauth_providers.client_authentication_method IS '令牌端点客户端认证方式：client_secret_basic 或 client_secret_post';
COMMENT ON COLUMN platform_standard_oauth_providers.user_name_attribute IS '用户信息接口返回 JSON 中的用户标识字段名';
COMMENT ON COLUMN platform_standard_oauth_providers.email_attribute IS '用户信息接口返回 JSON 中的邮箱字段名';
COMMENT ON COLUMN platform_standard_oauth_providers.nickname_attribute IS '用户信息接口返回 JSON 中的昵称字段名';
COMMENT ON COLUMN platform_standard_oauth_providers.avatar_attribute IS '用户信息接口返回 JSON 中的头像字段名';
COMMENT ON COLUMN platform_standard_oauth_providers.created_at IS '创建时间';
COMMENT ON COLUMN platform_standard_oauth_providers.updated_at IS '最后更新时间';

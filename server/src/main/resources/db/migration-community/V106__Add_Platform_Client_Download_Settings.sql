CREATE TABLE IF NOT EXISTS platform_client_download_settings (
    id SMALLINT PRIMARY KEY DEFAULT 1,
    mac_intel_url VARCHAR(1024),
    mac_apple_silicon_url VARCHAR(1024),
    windows_url VARCHAR(1024),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_platform_client_download_settings_singleton CHECK (id = 1)
);

COMMENT ON TABLE platform_client_download_settings IS '平台客户端下载链接配置，固定单行，由管理后台维护';
COMMENT ON COLUMN platform_client_download_settings.id IS '固定单行标识';
COMMENT ON COLUMN platform_client_download_settings.mac_intel_url IS 'Mac 英特尔芯片客户端下载链接';
COMMENT ON COLUMN platform_client_download_settings.mac_apple_silicon_url IS 'Mac M 系列芯片客户端下载链接';
COMMENT ON COLUMN platform_client_download_settings.windows_url IS 'Windows 客户端下载链接';
COMMENT ON COLUMN platform_client_download_settings.created_at IS '创建时间';
COMMENT ON COLUMN platform_client_download_settings.updated_at IS '更新时间';

INSERT INTO platform_client_download_settings(id, mac_intel_url, mac_apple_silicon_url, windows_url)
VALUES (1, NULL, NULL, NULL)
ON CONFLICT (id) DO NOTHING;

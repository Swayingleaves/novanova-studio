CREATE TABLE platform_external_link_config (
    id SMALLINT PRIMARY KEY DEFAULT 1,
    title VARCHAR(80) NOT NULL,
    url VARCHAR(2048) NOT NULL,
    description VARCHAR(1000) NOT NULL DEFAULT '',
    logo_url VARCHAR(2048) NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_platform_external_link_config_singleton CHECK (id = 1)
);

COMMENT ON TABLE platform_external_link_config IS '右上角展示外链配置，固定单行或零行，由管理后台维护';
COMMENT ON COLUMN platform_external_link_config.id IS '固定单行标识';
COMMENT ON COLUMN platform_external_link_config.title IS '入口按钮与弹窗标题';
COMMENT ON COLUMN platform_external_link_config.url IS '前往按钮跳转的目标地址';
COMMENT ON COLUMN platform_external_link_config.description IS '弹窗中的说明文字';
COMMENT ON COLUMN platform_external_link_config.logo_url IS '入口 logo 图片地址，为空时不展示 logo';
COMMENT ON COLUMN platform_external_link_config.created_at IS '创建时间';
COMMENT ON COLUMN platform_external_link_config.updated_at IS '更新时间';

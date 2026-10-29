CREATE TABLE platform_community_configs (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(60) NOT NULL,
    image_url VARCHAR(2048) NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
COMMENT ON TABLE platform_community_configs IS '平台全局社群配置，按排序值逐行展示在站点社群入口的悬浮面板中';
COMMENT ON COLUMN platform_community_configs.id IS '社群配置主键，整份配置保存时重建，不对外暴露';
COMMENT ON COLUMN platform_community_configs.name IS '社群名称，同一份配置内不区分大小写唯一';
COMMENT ON COLUMN platform_community_configs.image_url IS '社群二维码图片地址，仅接受 http 或 https 链接';
COMMENT ON COLUMN platform_community_configs.sort_order IS '展示排序值，按提交顺序从 0 递增';
COMMENT ON COLUMN platform_community_configs.created_at IS '创建时间';
COMMENT ON COLUMN platform_community_configs.updated_at IS '更新时间';
CREATE INDEX idx_platform_community_configs_order ON platform_community_configs(sort_order, id);

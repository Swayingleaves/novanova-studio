CREATE TABLE platform_navigation_menu_configs (
    menu_key VARCHAR(64) PRIMARY KEY,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_platform_navigation_menu_configs_sort_order CHECK (sort_order >= 0)
);

COMMENT ON TABLE platform_navigation_menu_configs IS '平台全局左侧导航菜单配置，控制应用主导航菜单项的显示开关与展示顺序';
COMMENT ON COLUMN platform_navigation_menu_configs.menu_key IS '导航菜单唯一标识，对应前端导航工具路由键';
COMMENT ON COLUMN platform_navigation_menu_configs.enabled IS '是否显示该菜单项：true显示、false隐藏';
COMMENT ON COLUMN platform_navigation_menu_configs.sort_order IS '展示排序值，按提交顺序从 0 递增';
COMMENT ON COLUMN platform_navigation_menu_configs.created_at IS '创建时间';
COMMENT ON COLUMN platform_navigation_menu_configs.updated_at IS '更新时间';

CREATE INDEX idx_platform_navigation_menu_configs_order ON platform_navigation_menu_configs(sort_order, menu_key);

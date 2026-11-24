CREATE TABLE IF NOT EXISTS platform_model_stats_settings (
    id SMALLINT PRIMARY KEY DEFAULT 1,
    success_rate_window_days INTEGER NOT NULL DEFAULT 3,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_platform_model_stats_settings_singleton CHECK (id = 1),
    CONSTRAINT ck_platform_model_stats_settings_window_days CHECK (success_rate_window_days >= 1 AND success_rate_window_days <= 365)
);

COMMENT ON TABLE platform_model_stats_settings IS '平台模型调用成功率统计配置，固定单行，由管理后台维护';
COMMENT ON COLUMN platform_model_stats_settings.id IS '固定单行标识';
COMMENT ON COLUMN platform_model_stats_settings.success_rate_window_days IS '模型调用成功率统计天数窗口，默认3天，范围1至365天';
COMMENT ON COLUMN platform_model_stats_settings.created_at IS '创建时间';
COMMENT ON COLUMN platform_model_stats_settings.updated_at IS '更新时间';

INSERT INTO platform_model_stats_settings(id, success_rate_window_days)
VALUES (1, 3)
ON CONFLICT (id) DO NOTHING;

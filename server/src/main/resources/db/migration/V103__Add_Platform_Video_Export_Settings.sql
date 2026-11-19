CREATE TABLE platform_video_export_settings (
    id SMALLINT PRIMARY KEY DEFAULT 1,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_platform_video_export_settings_singleton CHECK (id = 1)
);

COMMENT ON TABLE platform_video_export_settings IS '平台漫剧视觉分镜板导出视频开关配置，固定单行，由管理后台维护';
COMMENT ON COLUMN platform_video_export_settings.id IS '固定单行标识';
COMMENT ON COLUMN platform_video_export_settings.enabled IS '是否开启漫剧创作视觉分镜板导出视频功能：true开启、false关闭';
COMMENT ON COLUMN platform_video_export_settings.created_at IS '创建时间';
COMMENT ON COLUMN platform_video_export_settings.updated_at IS '更新时间';

INSERT INTO platform_video_export_settings(id, enabled)
VALUES (1, TRUE);

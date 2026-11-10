CREATE TABLE platform_timeout_settings (
    id SMALLINT PRIMARY KEY DEFAULT 1,
    ai_request_body_timeout_seconds INTEGER NOT NULL DEFAULT 60,
    storyboard_agent_timeout_seconds INTEGER NOT NULL DEFAULT 600,
    script_agent_timeout_seconds INTEGER NOT NULL DEFAULT 600,
    story_bible_agent_timeout_seconds INTEGER NOT NULL DEFAULT 600,
    task_wait_timeout_seconds INTEGER NOT NULL DEFAULT 300,
    video_task_wait_timeout_seconds INTEGER NOT NULL DEFAULT 900,
    video_composition_execution_timeout_seconds INTEGER NOT NULL DEFAULT 1800,
    tencent_cos_socket_timeout_milliseconds INTEGER NOT NULL DEFAULT 120000,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_platform_timeout_settings_singleton CHECK (id = 1),
    CONSTRAINT ck_platform_timeout_settings_range CHECK (
        ai_request_body_timeout_seconds BETWEEN 1 AND 86400
        AND storyboard_agent_timeout_seconds BETWEEN 1 AND 86400
        AND script_agent_timeout_seconds BETWEEN 1 AND 86400
        AND story_bible_agent_timeout_seconds BETWEEN 1 AND 86400
        AND task_wait_timeout_seconds BETWEEN 1 AND 86400
        AND video_task_wait_timeout_seconds BETWEEN 1 AND 86400
        AND video_composition_execution_timeout_seconds BETWEEN 1 AND 86400
        AND tencent_cos_socket_timeout_milliseconds BETWEEN 1 AND 3600000
    )
);

COMMENT ON TABLE platform_timeout_settings IS '全站超时设置，固定单行，由管理后台维护';
COMMENT ON COLUMN platform_timeout_settings.id IS '固定单行标识';
COMMENT ON COLUMN platform_timeout_settings.ai_request_body_timeout_seconds IS 'AI构造请求体和从响应提取媒体地址的超时秒数';
COMMENT ON COLUMN platform_timeout_settings.storyboard_agent_timeout_seconds IS '分镜 Agent 单次调用超时秒数';
COMMENT ON COLUMN platform_timeout_settings.script_agent_timeout_seconds IS '剧本 Agent 单次调用超时秒数';
COMMENT ON COLUMN platform_timeout_settings.story_bible_agent_timeout_seconds IS '故事知识库 Agent 单次调用超时秒数';
COMMENT ON COLUMN platform_timeout_settings.task_wait_timeout_seconds IS '图片等常规生成任务等待完成的超时秒数';
COMMENT ON COLUMN platform_timeout_settings.video_task_wait_timeout_seconds IS '视频生成任务等待完成的超时秒数';
COMMENT ON COLUMN platform_timeout_settings.video_composition_execution_timeout_seconds IS '视频合成和音频裁剪进程的执行超时秒数';
COMMENT ON COLUMN platform_timeout_settings.tencent_cos_socket_timeout_milliseconds IS '腾讯云 COS 单次请求读取超时毫秒数';
COMMENT ON COLUMN platform_timeout_settings.created_at IS '创建时间';
COMMENT ON COLUMN platform_timeout_settings.updated_at IS '更新时间';

INSERT INTO platform_timeout_settings(id)
VALUES (1);

CREATE TABLE ai_generation_tasks (
    id VARCHAR(64) PRIMARY KEY,
    user_id BIGINT NOT NULL,
    task_type VARCHAR(20) NOT NULL,
    model VARCHAR(128) NOT NULL,
    provider VARCHAR(50) NOT NULL DEFAULT '',
    status VARCHAR(20) NOT NULL,
    progress INTEGER NOT NULL DEFAULT 0,
    request_data JSONB NOT NULL,
    result_data JSONB,
    error_message VARCHAR(1000),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE ai_generation_tasks IS 'AI生成任务表';
COMMENT ON COLUMN ai_generation_tasks.id IS '任务ID';
COMMENT ON COLUMN ai_generation_tasks.user_id IS '用户ID';
COMMENT ON COLUMN ai_generation_tasks.task_type IS '任务类型：image图片，video视频，audio音频';
COMMENT ON COLUMN ai_generation_tasks.model IS '模型名称';
COMMENT ON COLUMN ai_generation_tasks.provider IS '模型渠道或供应商';
COMMENT ON COLUMN ai_generation_tasks.status IS '任务状态：pending等待，running执行中，success成功，failed失败，canceled已取消';
COMMENT ON COLUMN ai_generation_tasks.progress IS '任务进度，范围0-100';
COMMENT ON COLUMN ai_generation_tasks.request_data IS '脱敏后的请求摘要JSON';
COMMENT ON COLUMN ai_generation_tasks.result_data IS '生成结果JSON';
COMMENT ON COLUMN ai_generation_tasks.error_message IS '错误信息';
COMMENT ON COLUMN ai_generation_tasks.started_at IS '开始执行时间';
COMMENT ON COLUMN ai_generation_tasks.completed_at IS '完成时间';
COMMENT ON COLUMN ai_generation_tasks.created_at IS '创建时间';
COMMENT ON COLUMN ai_generation_tasks.updated_at IS '更新时间';
CREATE INDEX idx_ai_generation_tasks_user_type_created ON ai_generation_tasks(user_id, task_type, created_at);
CREATE INDEX idx_ai_generation_tasks_user_status_updated ON ai_generation_tasks(user_id, status, updated_at);
CREATE INDEX idx_ai_generation_tasks_status_updated ON ai_generation_tasks(status, updated_at);

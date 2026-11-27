-- 为漫剧项目增加AI制片助手会话标识，并新增单集一键出集流水线状态表

ALTER TABLE comic_drama_projects
    ADD COLUMN IF NOT EXISTS agent_session_id VARCHAR(64);

COMMENT ON COLUMN comic_drama_projects.agent_session_id IS '漫剧工作台绑定的AI制片助手会话ID';

CREATE TABLE IF NOT EXISTS comic_drama_episode_pipelines (
    id VARCHAR(64) PRIMARY KEY,
    script_project_id VARCHAR(64) NOT NULL REFERENCES comic_drama_projects(script_project_id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL,
    episode_id VARCHAR(64),
    execution_mode VARCHAR(24) NOT NULL DEFAULT 'review',
    current_step VARCHAR(32) NOT NULL DEFAULT 'pending',
    status VARCHAR(24) NOT NULL DEFAULT 'running',
    config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    progress_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    error_message TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comic_drama_episode_pipelines_project
    ON comic_drama_episode_pipelines (script_project_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_comic_drama_episode_pipelines_episode
    ON comic_drama_episode_pipelines (script_project_id, episode_id, updated_at DESC);

COMMENT ON TABLE comic_drama_episode_pipelines IS '漫剧单集一键出集流水线记录表';
COMMENT ON COLUMN comic_drama_episode_pipelines.id IS '流水线任务主键ID';
COMMENT ON COLUMN comic_drama_episode_pipelines.script_project_id IS '所属漫剧项目ID（关联共享剧本ID）';
COMMENT ON COLUMN comic_drama_episode_pipelines.user_id IS '发起用户ID';
COMMENT ON COLUMN comic_drama_episode_pipelines.episode_id IS '目标分集ID，为空表示全项目';
COMMENT ON COLUMN comic_drama_episode_pipelines.execution_mode IS '执行策略：review 关键节点停顿确认，auto 全自动直出';
COMMENT ON COLUMN comic_drama_episode_pipelines.current_step IS '当前执行阶段：pending/split/assets/paused/prompts/videos/export/completed/failed/canceled';
COMMENT ON COLUMN comic_drama_episode_pipelines.status IS '流水线状态：running/paused/completed/failed/canceled';
COMMENT ON COLUMN comic_drama_episode_pipelines.config_json IS '流水线配置（勾选步骤、模型、清晰度、时长档位等）';
COMMENT ON COLUMN comic_drama_episode_pipelines.progress_json IS '各阶段实时进度、数量统计与关联导出任务ID';
COMMENT ON COLUMN comic_drama_episode_pipelines.error_message IS '失败或中断时的错误说明';
COMMENT ON COLUMN comic_drama_episode_pipelines.created_at IS '创建时间';
COMMENT ON COLUMN comic_drama_episode_pipelines.updated_at IS '最近更新时间';

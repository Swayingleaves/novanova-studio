ALTER TABLE user_credit_transactions
    DROP CONSTRAINT ck_user_credit_transactions_generation_source;

ALTER TABLE user_credit_transactions
    ADD CONSTRAINT ck_user_credit_transactions_generation_source
        CHECK (generation_source IS NULL OR generation_source IN ('imagePage', 'videoPage', 'canvas', 'storyboard', 'drama'));

COMMENT ON COLUMN user_credit_transactions.generation_source IS '生成来源：imagePage、videoPage、canvas、storyboard、drama；历史流水为空';

CREATE TABLE drama_media (
    id VARCHAR(64) PRIMARY KEY,
    team_id BIGINT NOT NULL DEFAULT current_team_id() REFERENCES teams(id),
    project_id VARCHAR(64) NOT NULL REFERENCES drama_project(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id),
    version_id VARCHAR(64) NOT NULL,
    target_key VARCHAR(80) NOT NULL,
    media_type VARCHAR(16) NOT NULL,
    task_id VARCHAR(64) NOT NULL,
    model VARCHAR(200) NOT NULL,
    prompt TEXT NOT NULL,
    status VARCHAR(32) NOT NULL,
    result_url TEXT NOT NULL DEFAULT '',
    storage_key TEXT NOT NULL DEFAULT '',
    mime_type VARCHAR(120) NOT NULL DEFAULT '',
    error_message TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_drama_media_type CHECK (media_type IN ('image', 'video')),
    CONSTRAINT ck_drama_media_status CHECK (status IN ('pending', 'running', 'success', 'failed', 'canceled'))
);

COMMENT ON TABLE drama_media IS '智能短剧的图片和视频生成记录，一条记录对应一次真实模型任务';
COMMENT ON COLUMN drama_media.id IS '媒体记录ID';
COMMENT ON COLUMN drama_media.team_id IS '所属团队空间，零表示平台空间';
COMMENT ON COLUMN drama_media.project_id IS '所属短剧项目ID';
COMMENT ON COLUMN drama_media.user_id IS '发起用户ID';
COMMENT ON COLUMN drama_media.version_id IS '提示词来源的阶段版本ID';
COMMENT ON COLUMN drama_media.target_key IS '生成目标，例如 character:c1、location:l1、board:sh1、shot-image:sh1、shot-video:sh1';
COMMENT ON COLUMN drama_media.media_type IS '媒体类型：image 或 video';
COMMENT ON COLUMN drama_media.task_id IS '统一AI任务ID';
COMMENT ON COLUMN drama_media.model IS '本次使用的模型，格式为渠道ID::模型名';
COMMENT ON COLUMN drama_media.prompt IS '提交给模型的提示词';
COMMENT ON COLUMN drama_media.status IS '任务状态：pending、running、success、failed、canceled';
COMMENT ON COLUMN drama_media.result_url IS '生成结果地址，未完成时为空';
COMMENT ON COLUMN drama_media.storage_key IS '结果在对象存储中的键，没有时为空';
COMMENT ON COLUMN drama_media.mime_type IS '结果媒体类型';
COMMENT ON COLUMN drama_media.error_message IS '失败说明，成功时为空';
COMMENT ON COLUMN drama_media.created_at IS '创建时间';
COMMENT ON COLUMN drama_media.updated_at IS '最后同步时间';

CREATE INDEX idx_drama_media_project ON drama_media(project_id, created_at DESC);
CREATE UNIQUE INDEX uq_drama_media_open_target ON drama_media(project_id, target_key) WHERE status IN ('pending', 'running');

ALTER TABLE drama_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE drama_media FORCE ROW LEVEL SECURITY;
CREATE POLICY team_isolation ON drama_media USING (team_system_access() OR team_id = current_team_id()) WITH CHECK (team_system_access() OR team_id = current_team_id());

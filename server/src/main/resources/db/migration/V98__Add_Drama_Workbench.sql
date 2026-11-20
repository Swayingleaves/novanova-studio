ALTER TABLE creation_agent_request DROP CONSTRAINT ck_creation_agent_request_entry_source;
ALTER TABLE creation_agent_request ADD CONSTRAINT ck_creation_agent_request_entry_source
    CHECK (entry_source IN ('imagePage', 'videoPage', 'canvas', 'drama'));
COMMENT ON COLUMN creation_agent_request.entry_source IS '入口来源：imagePage、videoPage、canvas、drama';

CREATE TABLE drama_project (
    id VARCHAR(64) PRIMARY KEY,
    team_id BIGINT NOT NULL DEFAULT current_team_id() REFERENCES teams(id),
    user_id BIGINT NOT NULL REFERENCES users(id),
    name VARCHAR(120) NOT NULL,
    idea_text TEXT NOT NULL DEFAULT '',
    story_text TEXT NOT NULL DEFAULT '',
    text_model VARCHAR(200) NOT NULL,
    session_id VARCHAR(64) NOT NULL REFERENCES agent_session(id),
    current_stage VARCHAR(32) NOT NULL,
    status VARCHAR(32) NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    active_request_id VARCHAR(64),
    duration_seconds INTEGER NOT NULL DEFAULT 60,
    text_credits NUMERIC(20, 4) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_drama_project_stage CHECK (current_stage IN ('plan', 'script', 'cast', 'storyboard', 'shot', 'audio', 'preview')),
    CONSTRAINT ck_drama_project_status CHECK (status IN ('active', 'completed')),
    CONSTRAINT ck_drama_project_revision CHECK (revision > 0),
    CONSTRAINT ck_drama_project_duration CHECK (duration_seconds BETWEEN 15 AND 180),
    CONSTRAINT ck_drama_project_credits CHECK (text_credits >= 0)
);

COMMENT ON TABLE drama_project IS '智能短剧原型项目，不进入剧本或漫剧项目';
COMMENT ON COLUMN drama_project.id IS '项目ID';
COMMENT ON COLUMN drama_project.team_id IS '所属团队空间，零表示平台空间';
COMMENT ON COLUMN drama_project.user_id IS '创建用户ID';
COMMENT ON COLUMN drama_project.name IS '项目名称';
COMMENT ON COLUMN drama_project.idea_text IS '一句话创意';
COMMENT ON COLUMN drama_project.story_text IS '粘贴的故事正文，可为空';
COMMENT ON COLUMN drama_project.text_model IS '后续文本请求使用的模型，格式为渠道ID::模型名';
COMMENT ON COLUMN drama_project.session_id IS '关联的Agent会话ID';
COMMENT ON COLUMN drama_project.current_stage IS '当前等待确认的阶段';
COMMENT ON COLUMN drama_project.status IS '项目状态：active进行中，completed已完成';
COMMENT ON COLUMN drama_project.revision IS '乐观锁修订号，确认和编辑必须匹配';
COMMENT ON COLUMN drama_project.active_request_id IS '当前排队或运行中的主Agent请求ID，空表示空闲';
COMMENT ON COLUMN drama_project.duration_seconds IS '单集目标时长，单位秒';
COMMENT ON COLUMN drama_project.text_credits IS '本项目已结算的文本积分';
COMMENT ON COLUMN drama_project.created_at IS '创建时间';
COMMENT ON COLUMN drama_project.updated_at IS '最后更新时间';

CREATE INDEX idx_drama_project_user_updated ON drama_project(user_id, updated_at DESC);

CREATE TABLE drama_stage_version (
    id VARCHAR(64) PRIMARY KEY,
    team_id BIGINT NOT NULL DEFAULT current_team_id() REFERENCES teams(id),
    project_id VARCHAR(64) NOT NULL REFERENCES drama_project(id) ON DELETE CASCADE,
    stage VARCHAR(32) NOT NULL,
    version_number INTEGER NOT NULL,
    baseline_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    content_json JSONB NOT NULL,
    confirmation_status VARCHAR(32) NOT NULL,
    freshness VARCHAR(32) NOT NULL,
    source_request_id VARCHAR(64),
    confirmed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_drama_stage_version UNIQUE (project_id, stage, version_number),
    CONSTRAINT ck_drama_stage_version_stage CHECK (stage IN ('plan', 'script', 'cast', 'storyboard', 'shot', 'audio', 'preview')),
    CONSTRAINT ck_drama_stage_version_number CHECK (version_number > 0),
    CONSTRAINT ck_drama_stage_version_confirmation CHECK (confirmation_status IN ('pending', 'confirmed')),
    CONSTRAINT ck_drama_stage_version_freshness CHECK (freshness IN ('current', 'needs_update'))
);

COMMENT ON TABLE drama_stage_version IS '智能短剧阶段产物版本，旧版本及其确认记录保留';
COMMENT ON COLUMN drama_stage_version.id IS '版本ID';
COMMENT ON COLUMN drama_stage_version.team_id IS '所属团队空间，零表示平台空间';
COMMENT ON COLUMN drama_stage_version.project_id IS '所属短剧项目ID';
COMMENT ON COLUMN drama_stage_version.stage IS '制作阶段';
COMMENT ON COLUMN drama_stage_version.version_number IS '同一阶段内从1开始的版本号';
COMMENT ON COLUMN drama_stage_version.baseline_json IS '生成时引用的上游阶段版本ID';
COMMENT ON COLUMN drama_stage_version.content_json IS '服务端映射标识后的结构化产物';
COMMENT ON COLUMN drama_stage_version.confirmation_status IS '确认状态：pending待确认，confirmed已确认';
COMMENT ON COLUMN drama_stage_version.freshness IS '新鲜度：current可用，needs_update需按上游重新生成';
COMMENT ON COLUMN drama_stage_version.source_request_id IS '产出该版本的主Agent请求ID';
COMMENT ON COLUMN drama_stage_version.confirmed_at IS '确认时间，未确认时为空';
COMMENT ON COLUMN drama_stage_version.created_at IS '版本创建时间';

CREATE INDEX idx_drama_stage_version_project ON drama_stage_version(project_id, stage, version_number);

CREATE TABLE drama_client_request (
    client_request_id VARCHAR(64) PRIMARY KEY,
    team_id BIGINT NOT NULL DEFAULT current_team_id() REFERENCES teams(id),
    user_id BIGINT NOT NULL REFERENCES users(id),
    operation VARCHAR(32) NOT NULL,
    project_id VARCHAR(64),
    result_data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE drama_client_request IS '智能短剧创建和确认的稳定请求，重复提交返回同一结果';
COMMENT ON COLUMN drama_client_request.client_request_id IS '客户端稳定请求号';
COMMENT ON COLUMN drama_client_request.team_id IS '所属团队空间，零表示平台空间';
COMMENT ON COLUMN drama_client_request.user_id IS '请求用户ID';
COMMENT ON COLUMN drama_client_request.operation IS '操作类型：create或confirm';
COMMENT ON COLUMN drama_client_request.project_id IS '关联项目ID，创建完成前可为空';
COMMENT ON COLUMN drama_client_request.result_data IS '已完成操作的结果JSON';
COMMENT ON COLUMN drama_client_request.created_at IS '首次接收时间';

CREATE INDEX idx_drama_client_request_project ON drama_client_request(project_id);

DO $$
DECLARE table_name TEXT;
BEGIN
    FOREACH table_name IN ARRAY ARRAY['drama_project', 'drama_stage_version', 'drama_client_request'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
        EXECUTE format('CREATE POLICY team_isolation ON %I USING (team_system_access() OR team_id = current_team_id()) WITH CHECK (team_system_access() OR team_id = current_team_id())', table_name);
    END LOOP;
END $$;

CREATE TABLE novel_adaptation_drafts (
    draft_id VARCHAR(64) PRIMARY KEY REFERENCES script_ai_drafts(id) ON DELETE CASCADE,
    project_id VARCHAR(64) NOT NULL REFERENCES script_projects(id) ON DELETE CASCADE,
    stage VARCHAR(32) NOT NULL,
    settings JSONB NOT NULL,
    fact_snapshot JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_novel_adaptation_stage CHECK (stage IN ('outline', 'episodes', 'episode'))
);
COMMENT ON TABLE novel_adaptation_drafts IS '小说改编草稿的用户选择、已确认事实快照与阶段';
COMMENT ON COLUMN novel_adaptation_drafts.draft_id IS '复用的剧本AI草稿标识';
COMMENT ON COLUMN novel_adaptation_drafts.project_id IS '同一剧本项目标识';
COMMENT ON COLUMN novel_adaptation_drafts.stage IS '改编阶段：大纲、分集或单集';
COMMENT ON COLUMN novel_adaptation_drafts.settings IS '用户确认的改编形式、集数、时长、节奏与改编程度';
COMMENT ON COLUMN novel_adaptation_drafts.fact_snapshot IS '生成时选定事实的标识、修订号、名称、摘要与原文证据快照';
COMMENT ON COLUMN novel_adaptation_drafts.created_at IS '草稿创建时间';
CREATE INDEX idx_novel_adaptation_drafts_project ON novel_adaptation_drafts(project_id, created_at DESC);

CREATE TABLE novel_adaptation_sources (
    id VARCHAR(64) PRIMARY KEY,
    project_id VARCHAR(64) NOT NULL REFERENCES script_projects(id) ON DELETE CASCADE,
    draft_id VARCHAR(64) NOT NULL REFERENCES script_ai_drafts(id) ON DELETE CASCADE,
    target_type VARCHAR(32) NOT NULL,
    target_id VARCHAR(64) NOT NULL,
    fact_id VARCHAR(64) NOT NULL,
    fact_revision BIGINT NOT NULL,
    origin VARCHAR(24) NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_novel_adaptation_source UNIQUE (draft_id, target_type, target_id, fact_id),
    CONSTRAINT ck_novel_adaptation_origin CHECK (origin IN ('source', 'adaptation'))
);
COMMENT ON TABLE novel_adaptation_sources IS '正式改编产物到故事事实的追溯关联，保留创建时版本';
COMMENT ON COLUMN novel_adaptation_sources.id IS '关联标识';
COMMENT ON COLUMN novel_adaptation_sources.project_id IS '共享剧本项目标识';
COMMENT ON COLUMN novel_adaptation_sources.draft_id IS '来源改编草稿标识';
COMMENT ON COLUMN novel_adaptation_sources.target_type IS '正式内容类型';
COMMENT ON COLUMN novel_adaptation_sources.target_id IS '正式内容稳定标识';
COMMENT ON COLUMN novel_adaptation_sources.fact_id IS '故事知识库事实稳定标识';
COMMENT ON COLUMN novel_adaptation_sources.fact_revision IS '应用时引用的事实修订号';
COMMENT ON COLUMN novel_adaptation_sources.origin IS '来源性质，adaptation表示关联事实只是生成上下文，不代表逐句原文证据';
COMMENT ON COLUMN novel_adaptation_sources.active IS '是否为目标当前生效的事实关联，旧关联保留供历史追溯';
COMMENT ON COLUMN novel_adaptation_sources.created_at IS '关联创建时间';
CREATE INDEX idx_novel_adaptation_sources_fact ON novel_adaptation_sources(project_id, fact_id);
CREATE INDEX idx_novel_adaptation_sources_target ON novel_adaptation_sources(project_id, target_type, target_id);
CREATE INDEX idx_novel_adaptation_sources_active_fact ON novel_adaptation_sources(project_id, fact_id) WHERE active=TRUE;

CREATE TABLE novel_adaptation_asset_links (
    asset_id VARCHAR(64) PRIMARY KEY REFERENCES comic_drama_assets(id) ON DELETE CASCADE,
    project_id VARCHAR(64) NOT NULL REFERENCES script_projects(id) ON DELETE CASCADE,
    fact_id VARCHAR(64) NOT NULL,
    fact_revision BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_novel_adaptation_asset_fact UNIQUE (project_id, fact_id)
);
COMMENT ON TABLE novel_adaptation_asset_links IS '用户确认后建立的故事事实与漫剧视觉资产关联';
COMMENT ON COLUMN novel_adaptation_asset_links.asset_id IS '漫剧视觉资产标识';
COMMENT ON COLUMN novel_adaptation_asset_links.project_id IS '共享剧本项目标识';
COMMENT ON COLUMN novel_adaptation_asset_links.fact_id IS '故事知识库人物或地点标识';
COMMENT ON COLUMN novel_adaptation_asset_links.fact_revision IS '建立关联时的事实修订号';
COMMENT ON COLUMN novel_adaptation_asset_links.created_at IS '建立关联时间';
CREATE INDEX idx_novel_adaptation_asset_links_fact ON novel_adaptation_asset_links(project_id, fact_id);

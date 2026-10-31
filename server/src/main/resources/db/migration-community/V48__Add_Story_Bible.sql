ALTER TABLE script_source_documents ADD COLUMN confirmed_revision BIGINT;
COMMENT ON COLUMN script_source_documents.confirmed_revision IS '用户确认过的结构修订号，与当前修订号一致时才允许启动故事知识库分析';

ALTER TABLE script_source_import_tasks ADD COLUMN lease_until TIMESTAMPTZ;
COMMENT ON COLUMN script_source_import_tasks.lease_until IS '执行中任务的租约到期时间，过期后可被恢复扫描重新抢占';

CREATE TABLE story_bible_pricing (
    model_config_id VARCHAR(64) PRIMARY KEY REFERENCES platform_ai_model_configs(model_config_id) ON DELETE CASCADE,
    tiers JSONB NOT NULL DEFAULT '[]'::jsonb,
    revision BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
COMMENT ON TABLE story_bible_pricing IS '故事知识库分析按文本模型与计费字数分档的积分价格';
COMMENT ON COLUMN story_bible_pricing.model_config_id IS '文本模型配置标识';
COMMENT ON COLUMN story_bible_pricing.tiers IS '有序且不重叠的字数档位数组，元素为minChars、maxChars（为空表示无上限）与credits';
COMMENT ON COLUMN story_bible_pricing.revision IS '价格修订号，报价与提交时校验';
COMMENT ON COLUMN story_bible_pricing.created_at IS '创建时间';
COMMENT ON COLUMN story_bible_pricing.updated_at IS '更新时间';

CREATE TABLE story_bible_analysis_jobs (
    id VARCHAR(64) PRIMARY KEY,
    project_id VARCHAR(64) NOT NULL REFERENCES script_projects(id) ON DELETE CASCADE,
    document_id VARCHAR(64) NOT NULL REFERENCES script_source_documents(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id),
    client_request_id VARCHAR(64) NOT NULL,
    model_value VARCHAR(300) NOT NULL,
    model_config_id VARCHAR(64) NOT NULL,
    section_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    ranges JSONB NOT NULL DEFAULT '[]'::jsonb,
    billable_chars INTEGER NOT NULL,
    credits INTEGER NOT NULL,
    pricing_revision BIGINT NOT NULL,
    source_revision BIGINT NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'queued',
    stage VARCHAR(16) NOT NULL DEFAULT 'extract',
    processed_units INTEGER NOT NULL DEFAULT 0,
    total_units INTEGER NOT NULL DEFAULT 0,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    error_message TEXT NOT NULL DEFAULT '',
    lease_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_story_bible_job_request UNIQUE (user_id, client_request_id),
    CONSTRAINT ck_story_bible_job_status CHECK (status IN ('queued', 'running', 'retryable', 'completed', 'failed', 'canceled')),
    CONSTRAINT ck_story_bible_job_stage CHECK (stage IN ('extract', 'chapter', 'book', 'write', 'done')),
    CONSTRAINT ck_story_bible_job_amount CHECK (billable_chars > 0 AND credits >= 0)
);
COMMENT ON TABLE story_bible_analysis_jobs IS '故事知识库分析任务、计费快照与进度';
COMMENT ON COLUMN story_bible_analysis_jobs.id IS '分析任务标识，同时作为积分扣费与退款的操作标识';
COMMENT ON COLUMN story_bible_analysis_jobs.project_id IS '剧本项目标识';
COMMENT ON COLUMN story_bible_analysis_jobs.document_id IS '分析的导入原文标识';
COMMENT ON COLUMN story_bible_analysis_jobs.user_id IS '发起用户标识';
COMMENT ON COLUMN story_bible_analysis_jobs.client_request_id IS '客户端幂等请求标识';
COMMENT ON COLUMN story_bible_analysis_jobs.model_value IS '所选文本模型，格式为渠道标识::模型名称';
COMMENT ON COLUMN story_bible_analysis_jobs.model_config_id IS '所选文本模型配置标识，用于模型并发队列';
COMMENT ON COLUMN story_bible_analysis_jobs.section_ids IS '所选章节或场次标识，空数组表示全书';
COMMENT ON COLUMN story_bible_analysis_jobs.ranges IS '合并后的原文分析范围，元素为UTF-16起点含、终点不含的数组';
COMMENT ON COLUMN story_bible_analysis_jobs.billable_chars IS '计费字数，即范围内非空白Unicode字符数';
COMMENT ON COLUMN story_bible_analysis_jobs.credits IS '启动时预扣的积分';
COMMENT ON COLUMN story_bible_analysis_jobs.pricing_revision IS '报价时的价格修订号';
COMMENT ON COLUMN story_bible_analysis_jobs.source_revision IS '报价时的原文结构修订号';
COMMENT ON COLUMN story_bible_analysis_jobs.status IS '任务状态：排队、运行、可重试、完成、最终失败、取消';
COMMENT ON COLUMN story_bible_analysis_jobs.stage IS '当前阶段：片段提取、章节归并、全书归并、写入、结束';
COMMENT ON COLUMN story_bible_analysis_jobs.processed_units IS '已完成工作单元数';
COMMENT ON COLUMN story_bible_analysis_jobs.total_units IS '已规划工作单元数';
COMMENT ON COLUMN story_bible_analysis_jobs.attempt_count IS '执行尝试次数';
COMMENT ON COLUMN story_bible_analysis_jobs.error_message IS '最后一次失败原因';
COMMENT ON COLUMN story_bible_analysis_jobs.lease_until IS '执行租约到期时间';
COMMENT ON COLUMN story_bible_analysis_jobs.created_at IS '创建时间';
COMMENT ON COLUMN story_bible_analysis_jobs.updated_at IS '更新时间';
CREATE UNIQUE INDEX uq_story_bible_job_active ON story_bible_analysis_jobs(project_id) WHERE status IN ('queued', 'running', 'retryable');
CREATE INDEX idx_story_bible_jobs_project ON story_bible_analysis_jobs(project_id, created_at DESC);
CREATE INDEX idx_story_bible_jobs_recovery ON story_bible_analysis_jobs(status, updated_at);

CREATE TABLE story_bible_analysis_units (
    id VARCHAR(64) PRIMARY KEY,
    job_id VARCHAR(64) NOT NULL REFERENCES story_bible_analysis_jobs(id) ON DELETE CASCADE,
    unit_type VARCHAR(16) NOT NULL,
    unit_key VARCHAR(128) NOT NULL,
    seq INTEGER NOT NULL,
    input_snapshot JSONB NOT NULL,
    result JSONB,
    status VARCHAR(16) NOT NULL DEFAULT 'pending',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_story_bible_unit UNIQUE (job_id, unit_type, unit_key),
    CONSTRAINT ck_story_bible_unit_type CHECK (unit_type IN ('segment', 'chapter', 'book')),
    CONSTRAINT ck_story_bible_unit_status CHECK (status IN ('pending', 'completed'))
);
COMMENT ON TABLE story_bible_analysis_units IS '故事知识库分析工作单元与检查点';
COMMENT ON COLUMN story_bible_analysis_units.id IS '工作单元标识';
COMMENT ON COLUMN story_bible_analysis_units.job_id IS '所属分析任务标识';
COMMENT ON COLUMN story_bible_analysis_units.unit_type IS '单元类型：片段提取、章节归并、全书归并';
COMMENT ON COLUMN story_bible_analysis_units.unit_key IS '任务内稳定键，用于重复规划时幂等';
COMMENT ON COLUMN story_bible_analysis_units.seq IS '同类型单元的执行顺序';
COMMENT ON COLUMN story_bible_analysis_units.input_snapshot IS '输入范围与内容快照';
COMMENT ON COLUMN story_bible_analysis_units.result IS '模型结构化结果';
COMMENT ON COLUMN story_bible_analysis_units.status IS '单元状态';
COMMENT ON COLUMN story_bible_analysis_units.updated_at IS '更新时间';
CREATE INDEX idx_story_bible_units_job ON story_bible_analysis_units(job_id, unit_type, seq);

CREATE TABLE story_bible_items (
    id VARCHAR(64) PRIMARY KEY,
    project_id VARCHAR(64) NOT NULL REFERENCES script_projects(id) ON DELETE CASCADE,
    document_id VARCHAR(64) NOT NULL REFERENCES script_source_documents(id) ON DELETE CASCADE,
    item_type VARCHAR(16) NOT NULL,
    name VARCHAR(255) NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
    origin VARCHAR(16) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'pending',
    locked BOOLEAN NOT NULL DEFAULT FALSE,
    suggest_for_item_id VARCHAR(64) REFERENCES story_bible_items(id) ON DELETE CASCADE,
    match_key VARCHAR(255) NOT NULL,
    narrative_offset INTEGER,
    story_time VARCHAR(255) NOT NULL DEFAULT '',
    story_time_status VARCHAR(16) NOT NULL DEFAULT 'uncertain',
    story_order INTEGER,
    revision BIGINT NOT NULL DEFAULT 0,
    last_job_id VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_story_bible_item_type CHECK (item_type IN ('character', 'location', 'relationship', 'event', 'storyline')),
    CONSTRAINT ck_story_bible_item_origin CHECK (origin IN ('ai', 'manual')),
    CONSTRAINT ck_story_bible_item_status CHECK (status IN ('pending', 'confirmed', 'rejected')),
    CONSTRAINT ck_story_bible_item_time_status CHECK (story_time_status IN ('known', 'uncertain'))
);
COMMENT ON TABLE story_bible_items IS '故事知识库条目：人物、地点、关系、事件与故事线';
COMMENT ON COLUMN story_bible_items.id IS '条目标识';
COMMENT ON COLUMN story_bible_items.project_id IS '剧本项目标识';
COMMENT ON COLUMN story_bible_items.document_id IS '证据所在导入原文标识';
COMMENT ON COLUMN story_bible_items.item_type IS '条目类型';
COMMENT ON COLUMN story_bible_items.name IS '显示名称';
COMMENT ON COLUMN story_bible_items.summary IS '摘要描述';
COMMENT ON COLUMN story_bible_items.attributes IS '类型相关属性，如关系类型、事件说明、故事线说明';
COMMENT ON COLUMN story_bible_items.origin IS '来源：AI提取或人工创建';
COMMENT ON COLUMN story_bible_items.status IS '审阅状态：待确认、已确认、已拒绝；已拒绝记录用于抑制重复生成';
COMMENT ON COLUMN story_bible_items.locked IS '人工编辑或确认后锁定，重分析不再覆盖';
COMMENT ON COLUMN story_bible_items.suggest_for_item_id IS '针对已锁定条目的待审AI建议所指向的条目标识';
COMMENT ON COLUMN story_bible_items.match_key IS '归一化名称键，用于重分析匹配与拒绝抑制';
COMMENT ON COLUMN story_bible_items.narrative_offset IS '叙事位置，取首条证据在原文中的UTF-16起点';
COMMENT ON COLUMN story_bible_items.story_time IS '故事内发生时间的文字描述';
COMMENT ON COLUMN story_bible_items.story_time_status IS '故事时间是否已明确，不明确时保持待确认';
COMMENT ON COLUMN story_bible_items.story_order IS '人工调整的故事时间排序';
COMMENT ON COLUMN story_bible_items.revision IS '条目修订号，用于并发保护';
COMMENT ON COLUMN story_bible_items.last_job_id IS '最近一次写入该条目的分析任务标识';
COMMENT ON COLUMN story_bible_items.created_at IS '创建时间';
COMMENT ON COLUMN story_bible_items.updated_at IS '更新时间';
CREATE INDEX idx_story_bible_items_list ON story_bible_items(project_id, item_type, status, narrative_offset);
CREATE INDEX idx_story_bible_items_match ON story_bible_items(project_id, item_type, match_key);
CREATE INDEX idx_story_bible_items_suggest ON story_bible_items(suggest_for_item_id);

CREATE TABLE story_bible_aliases (
    id VARCHAR(64) PRIMARY KEY,
    item_id VARCHAR(64) NOT NULL REFERENCES story_bible_items(id) ON DELETE CASCADE,
    alias VARCHAR(255) NOT NULL,
    normalized_alias VARCHAR(255) NOT NULL,
    CONSTRAINT uq_story_bible_alias UNIQUE (item_id, normalized_alias)
);
COMMENT ON TABLE story_bible_aliases IS '人物与地点的别名';
COMMENT ON COLUMN story_bible_aliases.id IS '别名标识';
COMMENT ON COLUMN story_bible_aliases.item_id IS '所属条目标识';
COMMENT ON COLUMN story_bible_aliases.alias IS '原文中的称呼';
COMMENT ON COLUMN story_bible_aliases.normalized_alias IS '归一化称呼，用于匹配';
CREATE INDEX idx_story_bible_aliases_normalized ON story_bible_aliases(normalized_alias);

CREATE TABLE story_bible_links (
    id VARCHAR(64) PRIMARY KEY,
    item_id VARCHAR(64) NOT NULL REFERENCES story_bible_items(id) ON DELETE CASCADE,
    related_item_id VARCHAR(64) NOT NULL REFERENCES story_bible_items(id) ON DELETE CASCADE,
    role VARCHAR(24) NOT NULL,
    CONSTRAINT uq_story_bible_link UNIQUE (item_id, related_item_id, role),
    CONSTRAINT ck_story_bible_link_role CHECK (role IN ('relation_source', 'relation_target', 'participant', 'location', 'storyline_event'))
);
COMMENT ON TABLE story_bible_links IS '条目之间的关联：关系双方、事件参与者与地点、故事线包含的事件';
COMMENT ON COLUMN story_bible_links.id IS '关联标识';
COMMENT ON COLUMN story_bible_links.item_id IS '关系、事件或故事线条目标识';
COMMENT ON COLUMN story_bible_links.related_item_id IS '被关联的条目标识';
COMMENT ON COLUMN story_bible_links.role IS '关联角色';
CREATE INDEX idx_story_bible_links_related ON story_bible_links(related_item_id);

CREATE TABLE story_bible_evidences (
    id VARCHAR(64) PRIMARY KEY,
    item_id VARCHAR(64) NOT NULL REFERENCES story_bible_items(id) ON DELETE CASCADE,
    alias_id VARCHAR(64) REFERENCES story_bible_aliases(id) ON DELETE SET NULL,
    document_id VARCHAR(64) NOT NULL REFERENCES script_source_documents(id) ON DELETE CASCADE,
    start_offset INTEGER NOT NULL,
    end_offset INTEGER NOT NULL,
    quote TEXT NOT NULL,
    job_id VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_story_bible_evidence_span CHECK (start_offset >= 0 AND end_offset > start_offset)
);
COMMENT ON TABLE story_bible_evidences IS '条目的原文证据，偏移为规范化正文UTF-16起点含、终点不含';
COMMENT ON COLUMN story_bible_evidences.id IS '证据标识';
COMMENT ON COLUMN story_bible_evidences.item_id IS '所属条目标识';
COMMENT ON COLUMN story_bible_evidences.alias_id IS '证据对应的别名标识，拆分人物或地点时使用';
COMMENT ON COLUMN story_bible_evidences.document_id IS '原文标识';
COMMENT ON COLUMN story_bible_evidences.start_offset IS '原文起点，包含';
COMMENT ON COLUMN story_bible_evidences.end_offset IS '原文终点，不包含';
COMMENT ON COLUMN story_bible_evidences.quote IS '与原文范围完全一致的证据文字';
COMMENT ON COLUMN story_bible_evidences.job_id IS '写入证据的分析任务标识，人工证据为空';
COMMENT ON COLUMN story_bible_evidences.created_at IS '创建时间';
CREATE INDEX idx_story_bible_evidences_item ON story_bible_evidences(item_id, start_offset);
CREATE INDEX idx_story_bible_evidences_document ON story_bible_evidences(document_id, start_offset);

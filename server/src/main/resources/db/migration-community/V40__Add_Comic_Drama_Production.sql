CREATE TABLE comic_drama_projects (
    script_project_id VARCHAR(64) PRIMARY KEY REFERENCES script_projects(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    production_status VARCHAR(24) NOT NULL DEFAULT 'preparing',
    revision BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_comic_drama_projects_status CHECK (production_status IN ('preparing', 'producing', 'completed', 'paused'))
);

COMMENT ON TABLE comic_drama_projects IS '漫剧生产项目扩展表，与剧本项目一对一且不复制剧本内容';
COMMENT ON COLUMN comic_drama_projects.script_project_id IS '共享剧本项目ID及漫剧项目稳定标识';
COMMENT ON COLUMN comic_drama_projects.user_id IS '项目所属用户ID，用于严格归属校验';
COMMENT ON COLUMN comic_drama_projects.production_status IS '生产状态：preparing准备、producing制作、completed完成、paused暂停';
COMMENT ON COLUMN comic_drama_projects.revision IS '漫剧工作区乐观锁修订号';
COMMENT ON COLUMN comic_drama_projects.created_at IS '创建时间';
COMMENT ON COLUMN comic_drama_projects.updated_at IS '更新时间';
CREATE INDEX idx_comic_drama_projects_user_updated ON comic_drama_projects(user_id, updated_at DESC, script_project_id);

CREATE TABLE comic_drama_project_settings (
    script_project_id VARCHAR(64) PRIMARY KEY REFERENCES comic_drama_projects(script_project_id) ON DELETE CASCADE,
    project_type VARCHAR(32) NOT NULL DEFAULT 'comicDrama',
    target_episode_count INTEGER NOT NULL DEFAULT 1,
    episode_duration_seconds INTEGER NOT NULL DEFAULT 0,
    total_duration_seconds INTEGER NOT NULL DEFAULT 0,
    orientation VARCHAR(16) NOT NULL DEFAULT 'portrait',
    aspect_ratio VARCHAR(16) NOT NULL DEFAULT '9:16',
    visual_style TEXT NOT NULL DEFAULT '',
    period_atmosphere TEXT NOT NULL DEFAULT '',
    target_platform VARCHAR(120) NOT NULL DEFAULT '',
    use_case VARCHAR(200) NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_comic_drama_settings_episode_count CHECK (target_episode_count >= 1),
    CONSTRAINT ck_comic_drama_settings_durations CHECK (episode_duration_seconds >= 0 AND total_duration_seconds >= 0),
    CONSTRAINT ck_comic_drama_settings_orientation CHECK (orientation IN ('portrait', 'landscape', 'square'))
);

COMMENT ON TABLE comic_drama_project_settings IS '漫剧项目级生产设置表';
COMMENT ON COLUMN comic_drama_project_settings.script_project_id IS '所属共享剧本项目ID';
COMMENT ON COLUMN comic_drama_project_settings.project_type IS '项目类型';
COMMENT ON COLUMN comic_drama_project_settings.target_episode_count IS '目标集数';
COMMENT ON COLUMN comic_drama_project_settings.episode_duration_seconds IS '单集目标时长秒数';
COMMENT ON COLUMN comic_drama_project_settings.total_duration_seconds IS '整体目标时长秒数';
COMMENT ON COLUMN comic_drama_project_settings.orientation IS '画面方向：portrait竖屏、landscape横屏、square方形';
COMMENT ON COLUMN comic_drama_project_settings.aspect_ratio IS '画面宽高比';
COMMENT ON COLUMN comic_drama_project_settings.visual_style IS '项目默认视觉风格';
COMMENT ON COLUMN comic_drama_project_settings.period_atmosphere IS '时代与整体氛围';
COMMENT ON COLUMN comic_drama_project_settings.target_platform IS '目标发布平台';
COMMENT ON COLUMN comic_drama_project_settings.use_case IS '具体使用场景';
COMMENT ON COLUMN comic_drama_project_settings.updated_at IS '更新时间';

CREATE TABLE comic_drama_assets (
    id VARCHAR(64) PRIMARY KEY,
    script_project_id VARCHAR(64) NOT NULL REFERENCES comic_drama_projects(script_project_id) ON DELETE CASCADE,
    asset_type VARCHAR(20) NOT NULL,
    source_entity_id VARCHAR(64),
    name VARCHAR(200) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    voice_preference JSONB NOT NULL DEFAULT '{}'::jsonb,
    usage_status VARCHAR(20) NOT NULL DEFAULT 'active',
    revision BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_comic_drama_assets_type CHECK (asset_type IN ('character', 'scene', 'prop')),
    CONSTRAINT ck_comic_drama_assets_voice CHECK (jsonb_typeof(voice_preference) = 'object'),
    CONSTRAINT ck_comic_drama_assets_status CHECK (usage_status IN ('active', 'archived', 'needsUpdate'))
);

COMMENT ON TABLE comic_drama_assets IS '人物、场景和道具视觉资产表';
COMMENT ON COLUMN comic_drama_assets.id IS '资产稳定标识';
COMMENT ON COLUMN comic_drama_assets.script_project_id IS '所属共享剧本项目ID';
COMMENT ON COLUMN comic_drama_assets.asset_type IS '资产类型：character人物、scene场景、prop道具';
COMMENT ON COLUMN comic_drama_assets.source_entity_id IS '来源人物或地点稳定标识，不建立限制删除的外键';
COMMENT ON COLUMN comic_drama_assets.name IS '资产名称';
COMMENT ON COLUMN comic_drama_assets.description IS '资产视觉与用途描述';
COMMENT ON COLUMN comic_drama_assets.voice_preference IS '人物声音、语速、语气等偏好快照';
COMMENT ON COLUMN comic_drama_assets.usage_status IS '使用状态：active使用、archived归档、needsUpdate需要更新';
COMMENT ON COLUMN comic_drama_assets.revision IS '资产乐观锁修订号';
COMMENT ON COLUMN comic_drama_assets.created_at IS '创建时间';
COMMENT ON COLUMN comic_drama_assets.updated_at IS '更新时间';
CREATE INDEX idx_comic_drama_assets_project_type ON comic_drama_assets(script_project_id, asset_type, updated_at DESC, id);
CREATE INDEX idx_comic_drama_assets_source ON comic_drama_assets(script_project_id, source_entity_id);

CREATE TABLE comic_drama_asset_versions (
    id VARCHAR(64) PRIMARY KEY,
    asset_id VARCHAR(64) NOT NULL REFERENCES comic_drama_assets(id) ON DELETE CASCADE,
    version_name VARCHAR(160) NOT NULL,
    variant_type VARCHAR(40) NOT NULL DEFAULT 'default',
    appearance_description TEXT NOT NULL DEFAULT '',
    reference_media JSONB NOT NULL DEFAULT '[]'::jsonb,
    attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(20) NOT NULL DEFAULT 'draft',
    revision BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_comic_drama_asset_versions_media CHECK (jsonb_typeof(reference_media) = 'array'),
    CONSTRAINT ck_comic_drama_asset_versions_attributes CHECK (jsonb_typeof(attributes) = 'object'),
    CONSTRAINT ck_comic_drama_asset_versions_status CHECK (status IN ('draft', 'active', 'archived', 'needsUpdate'))
);

COMMENT ON TABLE comic_drama_asset_versions IS '视觉资产多版本表';
COMMENT ON COLUMN comic_drama_asset_versions.id IS '资产版本稳定标识';
COMMENT ON COLUMN comic_drama_asset_versions.asset_id IS '所属视觉资产ID';
COMMENT ON COLUMN comic_drama_asset_versions.version_name IS '版本名称，例如常服或雨夜';
COMMENT ON COLUMN comic_drama_asset_versions.variant_type IS '版本变化类型，例如服装、年龄、时间、天气或状态';
COMMENT ON COLUMN comic_drama_asset_versions.appearance_description IS '版本外观描述';
COMMENT ON COLUMN comic_drama_asset_versions.reference_media IS '主参考图、三视图、表情和动作等媒体引用数组';
COMMENT ON COLUMN comic_drama_asset_versions.attributes IS '版本扩展属性对象';
COMMENT ON COLUMN comic_drama_asset_versions.status IS '版本状态';
COMMENT ON COLUMN comic_drama_asset_versions.revision IS '资产版本乐观锁修订号';
COMMENT ON COLUMN comic_drama_asset_versions.created_at IS '创建时间';
COMMENT ON COLUMN comic_drama_asset_versions.updated_at IS '更新时间';
CREATE INDEX idx_comic_drama_asset_versions_asset_created ON comic_drama_asset_versions(asset_id, created_at DESC, id);

CREATE TABLE comic_drama_shot_drafts (
    id VARCHAR(64) PRIMARY KEY,
    script_project_id VARCHAR(64) NOT NULL REFERENCES comic_drama_projects(script_project_id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scope_type VARCHAR(20) NOT NULL,
    scope_id VARCHAR(64),
    base_project_revision BIGINT NOT NULL,
    instruction TEXT NOT NULL DEFAULT '',
    model VARCHAR(256) NOT NULL,
    draft_data JSONB NOT NULL,
    charged_credits INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    confirmed_at TIMESTAMPTZ,
    CONSTRAINT ck_comic_drama_shot_drafts_scope CHECK (scope_type IN ('project', 'episode', 'scene')),
    CONSTRAINT ck_comic_drama_shot_drafts_data CHECK (jsonb_typeof(draft_data) = 'object'),
    CONSTRAINT ck_comic_drama_shot_drafts_credits CHECK (charged_credits >= 0),
    CONSTRAINT ck_comic_drama_shot_drafts_status CHECK (status IN ('pending', 'confirmed', 'discarded'))
);

COMMENT ON TABLE comic_drama_shot_drafts IS '自动拆镜头的待确认结构化草稿表';
COMMENT ON COLUMN comic_drama_shot_drafts.id IS '镜头草稿稳定标识';
COMMENT ON COLUMN comic_drama_shot_drafts.script_project_id IS '所属共享剧本项目ID';
COMMENT ON COLUMN comic_drama_shot_drafts.user_id IS '草稿发起用户ID';
COMMENT ON COLUMN comic_drama_shot_drafts.scope_type IS '拆分范围：project项目、episode分集、scene场次';
COMMENT ON COLUMN comic_drama_shot_drafts.scope_id IS '分集或场次稳定标识';
COMMENT ON COLUMN comic_drama_shot_drafts.base_project_revision IS '生成草稿时的漫剧项目修订号';
COMMENT ON COLUMN comic_drama_shot_drafts.instruction IS '用户补充拆分要求';
COMMENT ON COLUMN comic_drama_shot_drafts.model IS '使用的渠道与文本模型';
COMMENT ON COLUMN comic_drama_shot_drafts.draft_data IS '允许用户编辑的镜头和候选资产草稿';
COMMENT ON COLUMN comic_drama_shot_drafts.charged_credits IS '本次生成实际扣除积分';
COMMENT ON COLUMN comic_drama_shot_drafts.status IS '状态：pending待确认、confirmed已确认、discarded已放弃';
COMMENT ON COLUMN comic_drama_shot_drafts.created_at IS '创建时间';
COMMENT ON COLUMN comic_drama_shot_drafts.confirmed_at IS '确认时间';
CREATE INDEX idx_comic_drama_shot_drafts_project_status ON comic_drama_shot_drafts(script_project_id, status, created_at DESC, id);

CREATE TABLE comic_drama_shots (
    id VARCHAR(64) PRIMARY KEY,
    script_project_id VARCHAR(64) NOT NULL REFERENCES comic_drama_projects(script_project_id) ON DELETE CASCADE,
    source_episode_id VARCHAR(64),
    source_scene_id VARCHAR(64),
    source_script_excerpt TEXT NOT NULL DEFAULT '',
    shot_number INTEGER NOT NULL,
    sort_order INTEGER NOT NULL,
    duration_seconds NUMERIC(8,2) NOT NULL DEFAULT 0,
    shot_size VARCHAR(40) NOT NULL DEFAULT '',
    composition TEXT NOT NULL DEFAULT '',
    visual_description TEXT NOT NULL DEFAULT '',
    action_description TEXT NOT NULL DEFAULT '',
    camera_movement TEXT NOT NULL DEFAULT '',
    lighting_atmosphere TEXT NOT NULL DEFAULT '',
    dialogue_voiceover TEXT NOT NULL DEFAULT '',
    sound_description TEXT NOT NULL DEFAULT '',
    style_override TEXT NOT NULL DEFAULT '',
    production_status VARCHAR(24) NOT NULL DEFAULT 'draft',
    revision BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_comic_drama_shots_number CHECK (shot_number >= 1),
    CONSTRAINT ck_comic_drama_shots_order CHECK (sort_order >= 0),
    CONSTRAINT ck_comic_drama_shots_duration CHECK (duration_seconds >= 0),
    CONSTRAINT ck_comic_drama_shots_status CHECK (production_status IN ('draft', 'ready', 'generating', 'completed', 'failed', 'needsUpdate'))
);

COMMENT ON TABLE comic_drama_shots IS '正式镜头清单关系表';
COMMENT ON COLUMN comic_drama_shots.id IS '镜头稳定标识';
COMMENT ON COLUMN comic_drama_shots.script_project_id IS '所属共享剧本项目ID';
COMMENT ON COLUMN comic_drama_shots.source_episode_id IS '来源分集稳定标识，不建立限制删除的外键';
COMMENT ON COLUMN comic_drama_shots.source_scene_id IS '来源场次稳定标识，不建立限制删除的外键';
COMMENT ON COLUMN comic_drama_shots.source_script_excerpt IS '来源剧本片段快照';
COMMENT ON COLUMN comic_drama_shots.shot_number IS '镜号';
COMMENT ON COLUMN comic_drama_shots.sort_order IS '项目内镜头排序';
COMMENT ON COLUMN comic_drama_shots.duration_seconds IS '预计镜头时长秒数';
COMMENT ON COLUMN comic_drama_shots.shot_size IS '景别';
COMMENT ON COLUMN comic_drama_shots.composition IS '画面构图与元素关系';
COMMENT ON COLUMN comic_drama_shots.visual_description IS '画面描述';
COMMENT ON COLUMN comic_drama_shots.action_description IS '人物或物体动作';
COMMENT ON COLUMN comic_drama_shots.camera_movement IS '摄影机运动';
COMMENT ON COLUMN comic_drama_shots.lighting_atmosphere IS '光线、天气与情绪氛围';
COMMENT ON COLUMN comic_drama_shots.dialogue_voiceover IS '对白与旁白';
COMMENT ON COLUMN comic_drama_shots.sound_description IS '环境音与关键音效';
COMMENT ON COLUMN comic_drama_shots.style_override IS '镜头级视觉风格覆盖';
COMMENT ON COLUMN comic_drama_shots.production_status IS '制作状态';
COMMENT ON COLUMN comic_drama_shots.revision IS '镜头乐观锁修订号';
COMMENT ON COLUMN comic_drama_shots.created_at IS '创建时间';
COMMENT ON COLUMN comic_drama_shots.updated_at IS '更新时间';
CREATE INDEX idx_comic_drama_shots_project_sort ON comic_drama_shots(script_project_id, sort_order, id);
CREATE INDEX idx_comic_drama_shots_scene ON comic_drama_shots(script_project_id, source_scene_id, sort_order);
CREATE INDEX idx_comic_drama_shots_status ON comic_drama_shots(script_project_id, production_status);

CREATE TABLE comic_drama_shot_asset_versions (
    shot_id VARCHAR(64) NOT NULL REFERENCES comic_drama_shots(id) ON DELETE CASCADE,
    asset_version_id VARCHAR(64) NOT NULL REFERENCES comic_drama_asset_versions(id) ON DELETE CASCADE,
    reference_role VARCHAR(40) NOT NULL DEFAULT 'subject',
    sort_order INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (shot_id, asset_version_id)
);

COMMENT ON TABLE comic_drama_shot_asset_versions IS '镜头实际引用的视觉资产版本关联表';
COMMENT ON COLUMN comic_drama_shot_asset_versions.shot_id IS '镜头ID';
COMMENT ON COLUMN comic_drama_shot_asset_versions.asset_version_id IS '视觉资产版本ID';
COMMENT ON COLUMN comic_drama_shot_asset_versions.reference_role IS '资产在镜头中的角色';
COMMENT ON COLUMN comic_drama_shot_asset_versions.sort_order IS '引用顺序';
CREATE INDEX idx_comic_drama_shot_asset_versions_asset ON comic_drama_shot_asset_versions(asset_version_id, shot_id);

CREATE TABLE comic_drama_prompt_versions (
    id VARCHAR(64) PRIMARY KEY,
    script_project_id VARCHAR(64) NOT NULL REFERENCES comic_drama_projects(script_project_id) ON DELETE CASCADE,
    shot_id VARCHAR(64) NOT NULL REFERENCES comic_drama_shots(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    source_type VARCHAR(20) NOT NULL,
    prompt_text TEXT NOT NULL,
    source_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    model VARCHAR(256) NOT NULL DEFAULT '',
    charged_credits INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'draft',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_comic_drama_prompt_versions UNIQUE (shot_id, version_number),
    CONSTRAINT ck_comic_drama_prompt_versions_number CHECK (version_number >= 1),
    CONSTRAINT ck_comic_drama_prompt_versions_source CHECK (source_type IN ('ai', 'manual')),
    CONSTRAINT ck_comic_drama_prompt_versions_snapshot CHECK (jsonb_typeof(source_snapshot) = 'object'),
    CONSTRAINT ck_comic_drama_prompt_versions_credits CHECK (charged_credits >= 0),
    CONSTRAINT ck_comic_drama_prompt_versions_status CHECK (status IN ('draft', 'adopted', 'superseded', 'needsUpdate'))
);

COMMENT ON TABLE comic_drama_prompt_versions IS '镜头提示词不可变版本表';
COMMENT ON COLUMN comic_drama_prompt_versions.id IS '提示词版本稳定标识';
COMMENT ON COLUMN comic_drama_prompt_versions.script_project_id IS '所属共享剧本项目ID';
COMMENT ON COLUMN comic_drama_prompt_versions.shot_id IS '所属镜头ID';
COMMENT ON COLUMN comic_drama_prompt_versions.version_number IS '镜头内提示词版本号';
COMMENT ON COLUMN comic_drama_prompt_versions.source_type IS '来源：ai模型合成、manual人工编辑';
COMMENT ON COLUMN comic_drama_prompt_versions.prompt_text IS '提示词正文';
COMMENT ON COLUMN comic_drama_prompt_versions.source_snapshot IS '剧本、镜头、资产和设置输入快照';
COMMENT ON COLUMN comic_drama_prompt_versions.model IS 'AI合成使用的渠道与模型';
COMMENT ON COLUMN comic_drama_prompt_versions.charged_credits IS 'AI合成实际扣除积分';
COMMENT ON COLUMN comic_drama_prompt_versions.status IS '状态：draft草稿、adopted采用、superseded旧版、needsUpdate需要更新';
COMMENT ON COLUMN comic_drama_prompt_versions.created_at IS '创建时间';
CREATE INDEX idx_comic_drama_prompt_versions_shot_created ON comic_drama_prompt_versions(shot_id, created_at DESC, id);

CREATE TABLE comic_drama_media_results (
    id VARCHAR(64) PRIMARY KEY,
    script_project_id VARCHAR(64) NOT NULL REFERENCES comic_drama_projects(script_project_id) ON DELETE CASCADE,
    target_type VARCHAR(20) NOT NULL,
    target_id VARCHAR(64) NOT NULL,
    media_type VARCHAR(16) NOT NULL,
    task_id VARCHAR(64),
    input_snapshot JSONB NOT NULL,
    result_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(20) NOT NULL DEFAULT 'queued',
    adopted BOOLEAN NOT NULL DEFAULT FALSE,
    failure_reason TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_comic_drama_media_target CHECK (target_type IN ('assetVersion', 'shot', 'voiceTrack', 'project')),
    CONSTRAINT ck_comic_drama_media_type CHECK (media_type IN ('image', 'video', 'audio', 'composite')),
    CONSTRAINT ck_comic_drama_media_input CHECK (jsonb_typeof(input_snapshot) = 'object'),
    CONSTRAINT ck_comic_drama_media_result CHECK (jsonb_typeof(result_data) = 'object'),
    CONSTRAINT ck_comic_drama_media_status CHECK (status IN ('quoted', 'queued', 'processing', 'completed', 'failed', 'needsUpdate'))
);

COMMENT ON TABLE comic_drama_media_results IS '图片、视频、声音与合成媒体任务及结果表';
COMMENT ON COLUMN comic_drama_media_results.id IS '媒体结果稳定标识';
COMMENT ON COLUMN comic_drama_media_results.script_project_id IS '所属共享剧本项目ID';
COMMENT ON COLUMN comic_drama_media_results.target_type IS '目标类型';
COMMENT ON COLUMN comic_drama_media_results.target_id IS '目标资产版本、镜头、声音轨或项目ID';
COMMENT ON COLUMN comic_drama_media_results.media_type IS '媒体类型';
COMMENT ON COLUMN comic_drama_media_results.task_id IS '现有AI任务稳定标识';
COMMENT ON COLUMN comic_drama_media_results.input_snapshot IS '发起任务时的完整输入快照';
COMMENT ON COLUMN comic_drama_media_results.result_data IS '任务输出或媒体引用对象';
COMMENT ON COLUMN comic_drama_media_results.status IS '任务状态，创建视频任务时不得直接记为完成';
COMMENT ON COLUMN comic_drama_media_results.adopted IS '是否被用户明确采用';
COMMENT ON COLUMN comic_drama_media_results.failure_reason IS '失败原因';
COMMENT ON COLUMN comic_drama_media_results.created_at IS '创建时间';
COMMENT ON COLUMN comic_drama_media_results.updated_at IS '更新时间';
CREATE INDEX idx_comic_drama_media_project_target ON comic_drama_media_results(script_project_id, target_type, target_id, created_at DESC);
CREATE INDEX idx_comic_drama_media_task ON comic_drama_media_results(task_id);
CREATE UNIQUE INDEX uq_comic_drama_media_adopted ON comic_drama_media_results(target_type, target_id, media_type) WHERE adopted = TRUE;

CREATE TABLE comic_drama_change_impacts (
    id VARCHAR(64) PRIMARY KEY,
    script_project_id VARCHAR(64) NOT NULL REFERENCES comic_drama_projects(script_project_id) ON DELETE CASCADE,
    source_type VARCHAR(32) NOT NULL,
    source_id VARCHAR(64),
    target_type VARCHAR(32) NOT NULL,
    target_id VARCHAR(64) NOT NULL,
    change_summary TEXT NOT NULL DEFAULT '',
    impact_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMPTZ,
    CONSTRAINT ck_comic_drama_change_impacts_snapshot CHECK (jsonb_typeof(impact_snapshot) = 'object'),
    CONSTRAINT ck_comic_drama_change_impacts_status CHECK (status IN ('pending', 'accepted', 'keptOld'))
);

COMMENT ON TABLE comic_drama_change_impacts IS '上游变化对下游生产数据的影响记录表';
COMMENT ON COLUMN comic_drama_change_impacts.id IS '影响记录稳定标识';
COMMENT ON COLUMN comic_drama_change_impacts.script_project_id IS '所属共享剧本项目ID';
COMMENT ON COLUMN comic_drama_change_impacts.source_type IS '变化来源类型';
COMMENT ON COLUMN comic_drama_change_impacts.source_id IS '变化来源稳定标识';
COMMENT ON COLUMN comic_drama_change_impacts.target_type IS '受影响目标类型';
COMMENT ON COLUMN comic_drama_change_impacts.target_id IS '受影响目标稳定标识';
COMMENT ON COLUMN comic_drama_change_impacts.change_summary IS '变化摘要和影响原因';
COMMENT ON COLUMN comic_drama_change_impacts.impact_snapshot IS '影响范围快照';
COMMENT ON COLUMN comic_drama_change_impacts.status IS '处理状态：pending待处理、accepted确认更新、keptOld保留旧结果';
COMMENT ON COLUMN comic_drama_change_impacts.created_at IS '创建时间';
COMMENT ON COLUMN comic_drama_change_impacts.resolved_at IS '处理时间';
CREATE INDEX idx_comic_drama_impacts_project_status ON comic_drama_change_impacts(script_project_id, status, created_at DESC, id);

CREATE TABLE comic_drama_canvas_bindings (
    id VARCHAR(64) PRIMARY KEY,
    script_project_id VARCHAR(64) NOT NULL REFERENCES comic_drama_projects(script_project_id) ON DELETE CASCADE,
    target_type VARCHAR(32) NOT NULL,
    target_id VARCHAR(64) NOT NULL,
    canvas_id VARCHAR(128) NOT NULL,
    node_id VARCHAR(128) NOT NULL,
    binding_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_comic_drama_canvas_bindings UNIQUE (script_project_id, canvas_id, node_id),
    CONSTRAINT ck_comic_drama_canvas_bindings_data CHECK (jsonb_typeof(binding_data) = 'object')
);

COMMENT ON TABLE comic_drama_canvas_bindings IS '漫剧结构化数据与无限画布节点绑定表';
COMMENT ON COLUMN comic_drama_canvas_bindings.id IS '绑定稳定标识';
COMMENT ON COLUMN comic_drama_canvas_bindings.script_project_id IS '所属共享剧本项目ID';
COMMENT ON COLUMN comic_drama_canvas_bindings.target_type IS '项目、剧本片段、资产、镜头或媒体等目标类型';
COMMENT ON COLUMN comic_drama_canvas_bindings.target_id IS '结构化目标稳定标识';
COMMENT ON COLUMN comic_drama_canvas_bindings.canvas_id IS '画布文档稳定标识';
COMMENT ON COLUMN comic_drama_canvas_bindings.node_id IS '画布节点稳定标识';
COMMENT ON COLUMN comic_drama_canvas_bindings.binding_data IS '绑定时的补充快照';
COMMENT ON COLUMN comic_drama_canvas_bindings.created_at IS '创建时间';
COMMENT ON COLUMN comic_drama_canvas_bindings.updated_at IS '更新时间';
CREATE INDEX idx_comic_drama_canvas_target ON comic_drama_canvas_bindings(script_project_id, target_type, target_id);

CREATE TABLE comic_drama_voice_tracks (
    id VARCHAR(64) PRIMARY KEY,
    script_project_id VARCHAR(64) NOT NULL REFERENCES comic_drama_projects(script_project_id) ON DELETE CASCADE,
    shot_id VARCHAR(64) REFERENCES comic_drama_shots(id) ON DELETE CASCADE,
    source_block_id VARCHAR(64),
    character_id VARCHAR(64),
    track_type VARCHAR(20) NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    voice_model VARCHAR(256) NOT NULL DEFAULT '',
    speech_rate NUMERIC(5,2) NOT NULL DEFAULT 1,
    tone VARCHAR(120) NOT NULL DEFAULT '',
    emotion VARCHAR(120) NOT NULL DEFAULT '',
    status VARCHAR(20) NOT NULL DEFAULT 'draft',
    revision BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_comic_drama_voice_tracks_type CHECK (track_type IN ('dialogue', 'narration', 'ambient', 'soundEffect', 'music')),
    CONSTRAINT ck_comic_drama_voice_tracks_rate CHECK (speech_rate > 0),
    CONSTRAINT ck_comic_drama_voice_tracks_status CHECK (status IN ('draft', 'ready', 'generating', 'completed', 'failed', 'needsUpdate'))
);

COMMENT ON TABLE comic_drama_voice_tracks IS 'P1结构化对白、旁白、环境音、音效与音乐轨表';
COMMENT ON COLUMN comic_drama_voice_tracks.id IS '声音轨稳定标识';
COMMENT ON COLUMN comic_drama_voice_tracks.script_project_id IS '所属共享剧本项目ID';
COMMENT ON COLUMN comic_drama_voice_tracks.shot_id IS '关联镜头ID';
COMMENT ON COLUMN comic_drama_voice_tracks.source_block_id IS '来源剧本正文块稳定标识，不建立限制删除的外键';
COMMENT ON COLUMN comic_drama_voice_tracks.character_id IS '说话人物稳定标识，不建立限制删除的外键';
COMMENT ON COLUMN comic_drama_voice_tracks.track_type IS '声音轨类型';
COMMENT ON COLUMN comic_drama_voice_tracks.content IS '对白、旁白、声音或音乐描述';
COMMENT ON COLUMN comic_drama_voice_tracks.voice_model IS '配音模型或音色标识';
COMMENT ON COLUMN comic_drama_voice_tracks.speech_rate IS '语速倍率';
COMMENT ON COLUMN comic_drama_voice_tracks.tone IS '语气';
COMMENT ON COLUMN comic_drama_voice_tracks.emotion IS '情绪';
COMMENT ON COLUMN comic_drama_voice_tracks.status IS '制作状态';
COMMENT ON COLUMN comic_drama_voice_tracks.revision IS '声音轨乐观锁修订号';
COMMENT ON COLUMN comic_drama_voice_tracks.created_at IS '创建时间';
COMMENT ON COLUMN comic_drama_voice_tracks.updated_at IS '更新时间';
CREATE INDEX idx_comic_drama_voice_tracks_project_shot ON comic_drama_voice_tracks(script_project_id, shot_id, created_at, id);

CREATE TABLE comic_drama_batch_tasks (
    id VARCHAR(64) PRIMARY KEY,
    script_project_id VARCHAR(64) NOT NULL REFERENCES comic_drama_projects(script_project_id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    batch_type VARCHAR(24) NOT NULL,
    scope_type VARCHAR(20) NOT NULL,
    scope_data JSONB NOT NULL,
    model_settings JSONB NOT NULL DEFAULT '{}'::jsonb,
    estimated_credits INTEGER NOT NULL DEFAULT 0,
    total_count INTEGER NOT NULL DEFAULT 0,
    queued_count INTEGER NOT NULL DEFAULT 0,
    processing_count INTEGER NOT NULL DEFAULT 0,
    completed_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    needs_update_count INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'quoted',
    confirmed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_comic_drama_batch_tasks_type CHECK (batch_type IN ('image', 'video', 'audio', 'prompt')),
    CONSTRAINT ck_comic_drama_batch_tasks_scope CHECK (scope_type IN ('shots', 'scene', 'episode', 'project')),
    CONSTRAINT ck_comic_drama_batch_tasks_scope_data CHECK (jsonb_typeof(scope_data) = 'object'),
    CONSTRAINT ck_comic_drama_batch_tasks_model CHECK (jsonb_typeof(model_settings) = 'object'),
    CONSTRAINT ck_comic_drama_batch_tasks_credits CHECK (estimated_credits >= 0),
    CONSTRAINT ck_comic_drama_batch_tasks_counts CHECK (total_count >= 0 AND queued_count >= 0 AND processing_count >= 0 AND completed_count >= 0 AND failed_count >= 0 AND needs_update_count >= 0),
    CONSTRAINT ck_comic_drama_batch_tasks_status CHECK (status IN ('quoted', 'queued', 'processing', 'completed', 'partialFailed', 'failed', 'cancelled'))
);

COMMENT ON TABLE comic_drama_batch_tasks IS 'P1批量生产报价、确认与进度统计表';
COMMENT ON COLUMN comic_drama_batch_tasks.id IS '批量任务稳定标识';
COMMENT ON COLUMN comic_drama_batch_tasks.script_project_id IS '所属共享剧本项目ID';
COMMENT ON COLUMN comic_drama_batch_tasks.user_id IS '任务发起用户ID';
COMMENT ON COLUMN comic_drama_batch_tasks.batch_type IS '批量类型：图片、视频、声音或提示词';
COMMENT ON COLUMN comic_drama_batch_tasks.scope_type IS '范围类型：镜头集合、场次、分集或项目';
COMMENT ON COLUMN comic_drama_batch_tasks.scope_data IS '用户明确选择的范围快照';
COMMENT ON COLUMN comic_drama_batch_tasks.model_settings IS '模型与生成设置快照';
COMMENT ON COLUMN comic_drama_batch_tasks.estimated_credits IS '确认前展示的预计积分';
COMMENT ON COLUMN comic_drama_batch_tasks.total_count IS '任务总数';
COMMENT ON COLUMN comic_drama_batch_tasks.queued_count IS '待生成数量';
COMMENT ON COLUMN comic_drama_batch_tasks.processing_count IS '生成中数量';
COMMENT ON COLUMN comic_drama_batch_tasks.completed_count IS '已完成数量';
COMMENT ON COLUMN comic_drama_batch_tasks.failed_count IS '失败数量';
COMMENT ON COLUMN comic_drama_batch_tasks.needs_update_count IS '需要更新数量';
COMMENT ON COLUMN comic_drama_batch_tasks.status IS '批量任务状态，未确认时仅为quoted报价';
COMMENT ON COLUMN comic_drama_batch_tasks.confirmed_at IS '用户明确确认执行时间';
COMMENT ON COLUMN comic_drama_batch_tasks.created_at IS '创建时间';
COMMENT ON COLUMN comic_drama_batch_tasks.updated_at IS '更新时间';
CREATE INDEX idx_comic_drama_batch_tasks_project_created ON comic_drama_batch_tasks(script_project_id, created_at DESC, id);
CREATE INDEX idx_comic_drama_batch_tasks_user_status ON comic_drama_batch_tasks(user_id, status, updated_at DESC);

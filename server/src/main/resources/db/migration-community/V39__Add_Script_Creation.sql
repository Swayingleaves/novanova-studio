CREATE TABLE script_projects (
    id VARCHAR(64) PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id),
    title VARCHAR(120) NOT NULL,
    content_type VARCHAR(32) NOT NULL DEFAULT 'comicDrama',
    genre VARCHAR(80) NOT NULL DEFAULT '',
    logline TEXT NOT NULL DEFAULT '',
    synopsis TEXT NOT NULL DEFAULT '',
    selling_points TEXT NOT NULL DEFAULT '',
    target_audience TEXT NOT NULL DEFAULT '',
    target_duration_seconds INTEGER NOT NULL DEFAULT 0,
    target_episode_count INTEGER NOT NULL DEFAULT 1,
    narrative_style TEXT NOT NULL DEFAULT '',
    theme TEXT NOT NULL DEFAULT '',
    main_plot TEXT NOT NULL DEFAULT '',
    main_conflict TEXT NOT NULL DEFAULT '',
    ending_direction TEXT NOT NULL DEFAULT '',
    stage VARCHAR(20) NOT NULL DEFAULT 'idea',
    completion_rate INTEGER NOT NULL DEFAULT 0,
    revision BIGINT NOT NULL DEFAULT 0,
    production_started_at TIMESTAMPTZ,
    status INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_script_projects_content_type CHECK (content_type IN ('comicDrama', 'liveActionShort', 'animation', 'advertisement', 'musicVideo', 'storyShort')),
    CONSTRAINT ck_script_projects_stage CHECK (stage IN ('idea', 'outline', 'writing', 'completed', 'production')),
    CONSTRAINT ck_script_projects_completion_rate CHECK (completion_rate BETWEEN 0 AND 100),
    CONSTRAINT ck_script_projects_target_duration CHECK (target_duration_seconds >= 0),
    CONSTRAINT ck_script_projects_target_episode_count CHECK (target_episode_count >= 1),
    CONSTRAINT ck_script_projects_status CHECK (status IN (0, 1))
);

COMMENT ON TABLE script_projects IS '剧本创作项目表';
COMMENT ON COLUMN script_projects.id IS '剧本项目稳定标识';
COMMENT ON COLUMN script_projects.user_id IS '项目所属用户ID';
COMMENT ON COLUMN script_projects.title IS '项目名称';
COMMENT ON COLUMN script_projects.content_type IS '内容形式：comicDrama漫剧、liveActionShort真人短剧、animation动画、advertisement广告、musicVideo音乐视频、storyShort故事短片';
COMMENT ON COLUMN script_projects.genre IS '故事题材';
COMMENT ON COLUMN script_projects.logline IS '一句话创意或一句话梗概';
COMMENT ON COLUMN script_projects.synopsis IS '完整故事简介';
COMMENT ON COLUMN script_projects.selling_points IS '故事核心卖点';
COMMENT ON COLUMN script_projects.target_audience IS '目标受众';
COMMENT ON COLUMN script_projects.target_duration_seconds IS '目标总时长秒数';
COMMENT ON COLUMN script_projects.target_episode_count IS '目标集数';
COMMENT ON COLUMN script_projects.narrative_style IS '叙事风格';
COMMENT ON COLUMN script_projects.theme IS '故事主题';
COMMENT ON COLUMN script_projects.main_plot IS '主线剧情';
COMMENT ON COLUMN script_projects.main_conflict IS '主要冲突';
COMMENT ON COLUMN script_projects.ending_direction IS '结局方向';
COMMENT ON COLUMN script_projects.stage IS '创作阶段：idea构思、outline大纲、writing编写、completed完成、production进入制作';
COMMENT ON COLUMN script_projects.completion_rate IS '按固定规则计算的项目完成度百分比';
COMMENT ON COLUMN script_projects.revision IS '项目乐观锁修订号';
COMMENT ON COLUMN script_projects.production_started_at IS '首次确认进入漫剧创作的时间';
COMMENT ON COLUMN script_projects.status IS '状态：1正常，0删除';
COMMENT ON COLUMN script_projects.created_at IS '创建时间';
COMMENT ON COLUMN script_projects.updated_at IS '更新时间';

CREATE INDEX idx_script_projects_user_status_updated ON script_projects(user_id, status, updated_at DESC, id);
CREATE INDEX idx_script_projects_user_stage ON script_projects(user_id, status, stage);
CREATE INDEX idx_script_projects_user_content_type ON script_projects(user_id, status, content_type);

CREATE TABLE script_templates (
    template_key VARCHAR(64) PRIMARY KEY,
    category VARCHAR(32) NOT NULL,
    name VARCHAR(80) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    content_type VARCHAR(32) NOT NULL,
    genre VARCHAR(80) NOT NULL,
    structure_type VARCHAR(32) NOT NULL,
    recommended_episode_count INTEGER NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    status INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT ck_script_templates_episode_count CHECK (recommended_episode_count >= 1),
    CONSTRAINT ck_script_templates_status CHECK (status IN (0, 1))
);

COMMENT ON TABLE script_templates IS '内置剧本模板表';
COMMENT ON COLUMN script_templates.template_key IS '模板稳定键';
COMMENT ON COLUMN script_templates.category IS '模板分类：shortDrama短剧、comicAnimation漫剧与动画、narrativeVideo叙事视频';
COMMENT ON COLUMN script_templates.name IS '模板名称';
COMMENT ON COLUMN script_templates.description IS '模板用途说明';
COMMENT ON COLUMN script_templates.content_type IS '模板默认内容形式';
COMMENT ON COLUMN script_templates.genre IS '模板默认题材';
COMMENT ON COLUMN script_templates.structure_type IS '模板默认结构类型';
COMMENT ON COLUMN script_templates.recommended_episode_count IS '推荐目标集数';
COMMENT ON COLUMN script_templates.sort_order IS '展示顺序';
COMMENT ON COLUMN script_templates.status IS '状态：1启用，0停用';

CREATE INDEX idx_script_templates_status_sort ON script_templates(status, sort_order, template_key);

CREATE TABLE script_template_sections (
    id VARCHAR(64) PRIMARY KEY,
    template_key VARCHAR(64) NOT NULL REFERENCES script_templates(template_key) ON DELETE CASCADE,
    title VARCHAR(120) NOT NULL,
    section_type VARCHAR(32) NOT NULL,
    guidance TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL
);

COMMENT ON TABLE script_template_sections IS '剧本模板结构段表';
COMMENT ON COLUMN script_template_sections.id IS '模板结构段稳定标识';
COMMENT ON COLUMN script_template_sections.template_key IS '所属模板稳定键';
COMMENT ON COLUMN script_template_sections.title IS '结构段标题';
COMMENT ON COLUMN script_template_sections.section_type IS '结构段类型';
COMMENT ON COLUMN script_template_sections.guidance IS '该结构段的写作提示';
COMMENT ON COLUMN script_template_sections.sort_order IS '结构段顺序';

CREATE INDEX idx_script_template_sections_template_sort ON script_template_sections(template_key, sort_order);

CREATE TABLE script_outline_sections (
    id VARCHAR(64) PRIMARY KEY,
    project_id VARCHAR(64) NOT NULL REFERENCES script_projects(id) ON DELETE CASCADE,
    section_type VARCHAR(32) NOT NULL,
    title VARCHAR(120) NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL
);

COMMENT ON TABLE script_outline_sections IS '剧本大纲结构段表';
COMMENT ON COLUMN script_outline_sections.id IS '大纲结构段稳定标识';
COMMENT ON COLUMN script_outline_sections.project_id IS '所属剧本项目ID';
COMMENT ON COLUMN script_outline_sections.section_type IS '结构段类型：act幕、mainPlot主线、subplot支线、characterArc人物成长线';
COMMENT ON COLUMN script_outline_sections.title IS '结构段标题';
COMMENT ON COLUMN script_outline_sections.content IS '结构段内容';
COMMENT ON COLUMN script_outline_sections.sort_order IS '结构段顺序';

CREATE INDEX idx_script_outline_sections_project_sort ON script_outline_sections(project_id, sort_order);

CREATE TABLE script_characters (
    id VARCHAR(64) PRIMARY KEY,
    project_id VARCHAR(64) NOT NULL REFERENCES script_projects(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    identity TEXT NOT NULL DEFAULT '',
    age VARCHAR(40) NOT NULL DEFAULT '',
    occupation VARCHAR(120) NOT NULL DEFAULT '',
    role_type VARCHAR(80) NOT NULL DEFAULT '',
    personality TEXT NOT NULL DEFAULT '',
    values_description TEXT NOT NULL DEFAULT '',
    goal TEXT NOT NULL DEFAULT '',
    desire TEXT NOT NULL DEFAULT '',
    fear TEXT NOT NULL DEFAULT '',
    motivation TEXT NOT NULL DEFAULT '',
    appearance_description TEXT NOT NULL DEFAULT '',
    habits TEXT NOT NULL DEFAULT '',
    speech_style TEXT NOT NULL DEFAULT '',
    background_story TEXT NOT NULL DEFAULT '',
    character_arc TEXT NOT NULL DEFAULT '',
    graph_position_x DOUBLE PRECISION NOT NULL DEFAULT 0,
    graph_position_y DOUBLE PRECISION NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL
);

COMMENT ON TABLE script_characters IS '剧本人物文字设定表';
COMMENT ON COLUMN script_characters.id IS '人物稳定标识';
COMMENT ON COLUMN script_characters.project_id IS '所属剧本项目ID';
COMMENT ON COLUMN script_characters.name IS '人物姓名';
COMMENT ON COLUMN script_characters.identity IS '人物身份';
COMMENT ON COLUMN script_characters.age IS '人物年龄描述';
COMMENT ON COLUMN script_characters.occupation IS '人物职业';
COMMENT ON COLUMN script_characters.role_type IS '人物在故事中的角色定位';
COMMENT ON COLUMN script_characters.personality IS '人物性格';
COMMENT ON COLUMN script_characters.values_description IS '人物价值观';
COMMENT ON COLUMN script_characters.goal IS '人物目标';
COMMENT ON COLUMN script_characters.desire IS '人物欲望';
COMMENT ON COLUMN script_characters.fear IS '人物恐惧';
COMMENT ON COLUMN script_characters.motivation IS '人物动机';
COMMENT ON COLUMN script_characters.appearance_description IS '外貌文字描述';
COMMENT ON COLUMN script_characters.habits IS '人物习惯';
COMMENT ON COLUMN script_characters.speech_style IS '人物语言特点';
COMMENT ON COLUMN script_characters.background_story IS '人物背景经历';
COMMENT ON COLUMN script_characters.character_arc IS '人物弧光，即故事中的变化过程';
COMMENT ON COLUMN script_characters.graph_position_x IS '人物关系图横坐标';
COMMENT ON COLUMN script_characters.graph_position_y IS '人物关系图纵坐标';
COMMENT ON COLUMN script_characters.sort_order IS '人物顺序';

CREATE INDEX idx_script_characters_project_sort ON script_characters(project_id, sort_order);

CREATE TABLE script_character_relations (
    id VARCHAR(64) PRIMARY KEY,
    project_id VARCHAR(64) NOT NULL REFERENCES script_projects(id) ON DELETE CASCADE,
    source_character_id VARCHAR(64) NOT NULL REFERENCES script_characters(id) ON DELETE RESTRICT,
    target_character_id VARCHAR(64) NOT NULL REFERENCES script_characters(id) ON DELETE RESTRICT,
    relationship_type VARCHAR(120) NOT NULL,
    relationship_direction VARCHAR(20) NOT NULL DEFAULT 'bidirectional',
    story_stage VARCHAR(120) NOT NULL DEFAULT '',
    conflict_description TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL,
    CONSTRAINT ck_script_character_relations_direction CHECK (relationship_direction IN ('directed', 'bidirectional')),
    CONSTRAINT ck_script_character_relations_characters CHECK (source_character_id <> target_character_id)
);

COMMENT ON TABLE script_character_relations IS '剧本人物关系表';
COMMENT ON COLUMN script_character_relations.id IS '人物关系稳定标识';
COMMENT ON COLUMN script_character_relations.project_id IS '所属剧本项目ID';
COMMENT ON COLUMN script_character_relations.source_character_id IS '关系起点人物ID';
COMMENT ON COLUMN script_character_relations.target_character_id IS '关系终点人物ID';
COMMENT ON COLUMN script_character_relations.relationship_type IS '关系类型';
COMMENT ON COLUMN script_character_relations.relationship_direction IS '关系方向：directed单向、bidirectional双向';
COMMENT ON COLUMN script_character_relations.story_stage IS '关系所处故事阶段';
COMMENT ON COLUMN script_character_relations.conflict_description IS '关系中的主要冲突';
COMMENT ON COLUMN script_character_relations.description IS '关系补充说明';
COMMENT ON COLUMN script_character_relations.sort_order IS '关系顺序';

CREATE INDEX idx_script_character_relations_project_sort ON script_character_relations(project_id, sort_order);
CREATE INDEX idx_script_character_relations_source ON script_character_relations(source_character_id);
CREATE INDEX idx_script_character_relations_target ON script_character_relations(target_character_id);

CREATE TABLE script_world_settings (
    project_id VARCHAR(64) PRIMARY KEY REFERENCES script_projects(id) ON DELETE CASCADE,
    era VARCHAR(160) NOT NULL DEFAULT '',
    region VARCHAR(240) NOT NULL DEFAULT '',
    social_background TEXT NOT NULL DEFAULT '',
    overall_tone TEXT NOT NULL DEFAULT ''
);

COMMENT ON TABLE script_world_settings IS '剧本世界观基础设定表';
COMMENT ON COLUMN script_world_settings.project_id IS '所属剧本项目ID';
COMMENT ON COLUMN script_world_settings.era IS '故事时代';
COMMENT ON COLUMN script_world_settings.region IS '故事地域';
COMMENT ON COLUMN script_world_settings.social_background IS '社会背景';
COMMENT ON COLUMN script_world_settings.overall_tone IS '世界观整体基调';

CREATE TABLE script_world_items (
    id VARCHAR(64) PRIMARY KEY,
    project_id VARCHAR(64) NOT NULL REFERENCES script_projects(id) ON DELETE CASCADE,
    item_type VARCHAR(32) NOT NULL,
    name VARCHAR(160) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL,
    CONSTRAINT ck_script_world_items_type CHECK (item_type IN ('rule', 'organization', 'faction', 'hierarchy', 'restriction', 'history'))
);

COMMENT ON TABLE script_world_items IS '世界规则、组织、势力、等级、限制和历史事件表';
COMMENT ON COLUMN script_world_items.id IS '世界观条目稳定标识';
COMMENT ON COLUMN script_world_items.project_id IS '所属剧本项目ID';
COMMENT ON COLUMN script_world_items.item_type IS '条目类型：rule规则、organization组织、faction势力、hierarchy等级、restriction限制、history历史事件';
COMMENT ON COLUMN script_world_items.name IS '条目名称';
COMMENT ON COLUMN script_world_items.description IS '条目说明';
COMMENT ON COLUMN script_world_items.sort_order IS '条目顺序';

CREATE INDEX idx_script_world_items_project_type_sort ON script_world_items(project_id, item_type, sort_order);

CREATE TABLE script_locations (
    id VARCHAR(64) PRIMARY KEY,
    project_id VARCHAR(64) NOT NULL REFERENCES script_projects(id) ON DELETE CASCADE,
    name VARCHAR(160) NOT NULL,
    space_purpose TEXT NOT NULL DEFAULT '',
    narrative_role TEXT NOT NULL DEFAULT '',
    default_time VARCHAR(120) NOT NULL DEFAULT '',
    weather VARCHAR(120) NOT NULL DEFAULT '',
    atmosphere TEXT NOT NULL DEFAULT '',
    key_objects TEXT NOT NULL DEFAULT '',
    main_events TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL
);

COMMENT ON TABLE script_locations IS '剧本场景地点文字设定表';
COMMENT ON COLUMN script_locations.id IS '地点稳定标识';
COMMENT ON COLUMN script_locations.project_id IS '所属剧本项目ID';
COMMENT ON COLUMN script_locations.name IS '地点名称';
COMMENT ON COLUMN script_locations.space_purpose IS '空间用途';
COMMENT ON COLUMN script_locations.narrative_role IS '叙事作用';
COMMENT ON COLUMN script_locations.default_time IS '默认时间';
COMMENT ON COLUMN script_locations.weather IS '天气设定';
COMMENT ON COLUMN script_locations.atmosphere IS '氛围设定';
COMMENT ON COLUMN script_locations.key_objects IS '关键物件文字说明';
COMMENT ON COLUMN script_locations.main_events IS '会在该地点发生的主要事件';
COMMENT ON COLUMN script_locations.sort_order IS '地点顺序';

CREATE INDEX idx_script_locations_project_sort ON script_locations(project_id, sort_order);

CREATE TABLE script_episodes (
    id VARCHAR(64) PRIMARY KEY,
    project_id VARCHAR(64) NOT NULL REFERENCES script_projects(id) ON DELETE CASCADE,
    episode_number INTEGER NOT NULL,
    title VARCHAR(160) NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    key_events TEXT NOT NULL DEFAULT '',
    main_conflict TEXT NOT NULL DEFAULT '',
    climax TEXT NOT NULL DEFAULT '',
    ending_hook TEXT NOT NULL DEFAULT '',
    target_duration_seconds INTEGER NOT NULL DEFAULT 0,
    completion_status VARCHAR(20) NOT NULL DEFAULT 'planning',
    sort_order INTEGER NOT NULL,
    CONSTRAINT ck_script_episodes_number CHECK (episode_number >= 1),
    CONSTRAINT ck_script_episodes_duration CHECK (target_duration_seconds >= 0),
    CONSTRAINT ck_script_episodes_status CHECK (completion_status IN ('planning', 'draft', 'complete'))
);

COMMENT ON TABLE script_episodes IS '剧本分集表';
COMMENT ON COLUMN script_episodes.id IS '分集稳定标识';
COMMENT ON COLUMN script_episodes.project_id IS '所属剧本项目ID';
COMMENT ON COLUMN script_episodes.episode_number IS '集号';
COMMENT ON COLUMN script_episodes.title IS '分集标题';
COMMENT ON COLUMN script_episodes.summary IS '分集剧情梗概';
COMMENT ON COLUMN script_episodes.key_events IS '分集关键事件';
COMMENT ON COLUMN script_episodes.main_conflict IS '分集主要冲突';
COMMENT ON COLUMN script_episodes.climax IS '分集高潮';
COMMENT ON COLUMN script_episodes.ending_hook IS '分集结尾悬念';
COMMENT ON COLUMN script_episodes.target_duration_seconds IS '分集目标时长秒数';
COMMENT ON COLUMN script_episodes.completion_status IS '完成状态：planning规划、draft草稿、complete完成';
COMMENT ON COLUMN script_episodes.sort_order IS '分集顺序';

CREATE INDEX idx_script_episodes_project_sort ON script_episodes(project_id, sort_order);

CREATE TABLE script_scenes (
    id VARCHAR(64) PRIMARY KEY,
    episode_id VARCHAR(64) NOT NULL REFERENCES script_episodes(id) ON DELETE CASCADE,
    location_id VARCHAR(64) REFERENCES script_locations(id) ON DELETE RESTRICT,
    scene_number INTEGER NOT NULL,
    title VARCHAR(160) NOT NULL DEFAULT '',
    interior_exterior VARCHAR(16) NOT NULL DEFAULT 'interior',
    time_description VARCHAR(120) NOT NULL DEFAULT '',
    scene_goal TEXT NOT NULL DEFAULT '',
    action_summary TEXT NOT NULL DEFAULT '',
    transition_description TEXT NOT NULL DEFAULT '',
    previous_relation TEXT NOT NULL DEFAULT '',
    next_relation TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL,
    CONSTRAINT ck_script_scenes_number CHECK (scene_number >= 1),
    CONSTRAINT ck_script_scenes_interior_exterior CHECK (interior_exterior IN ('interior', 'exterior', 'mixed'))
);

COMMENT ON TABLE script_scenes IS '剧本场次表，场次指同一时间和地点的一段连续剧情';
COMMENT ON COLUMN script_scenes.id IS '场次稳定标识';
COMMENT ON COLUMN script_scenes.episode_id IS '所属分集ID';
COMMENT ON COLUMN script_scenes.location_id IS '关联地点ID';
COMMENT ON COLUMN script_scenes.scene_number IS '当前分集中的场次编号';
COMMENT ON COLUMN script_scenes.title IS '场次标题';
COMMENT ON COLUMN script_scenes.interior_exterior IS '内外景：interior内景、exterior外景、mixed混合';
COMMENT ON COLUMN script_scenes.time_description IS '场次发生时间';
COMMENT ON COLUMN script_scenes.scene_goal IS '场次目标';
COMMENT ON COLUMN script_scenes.action_summary IS '场次动作概述';
COMMENT ON COLUMN script_scenes.transition_description IS '转场说明';
COMMENT ON COLUMN script_scenes.previous_relation IS '与前一场次的关系';
COMMENT ON COLUMN script_scenes.next_relation IS '与后一场次的关系';
COMMENT ON COLUMN script_scenes.sort_order IS '场次顺序';

CREATE INDEX idx_script_scenes_episode_sort ON script_scenes(episode_id, sort_order);
CREATE INDEX idx_script_scenes_location ON script_scenes(location_id);

CREATE TABLE script_scene_characters (
    scene_id VARCHAR(64) NOT NULL REFERENCES script_scenes(id) ON DELETE CASCADE,
    character_id VARCHAR(64) NOT NULL REFERENCES script_characters(id) ON DELETE RESTRICT,
    sort_order INTEGER NOT NULL,
    PRIMARY KEY (scene_id, character_id)
);

COMMENT ON TABLE script_scene_characters IS '场次出场人物关联表';
COMMENT ON COLUMN script_scene_characters.scene_id IS '场次ID';
COMMENT ON COLUMN script_scene_characters.character_id IS '出场人物ID';
COMMENT ON COLUMN script_scene_characters.sort_order IS '人物在场次中的顺序';

CREATE INDEX idx_script_scene_characters_character ON script_scene_characters(character_id);

CREATE TABLE script_blocks (
    id VARCHAR(64) PRIMARY KEY,
    scene_id VARCHAR(64) NOT NULL REFERENCES script_scenes(id) ON DELETE CASCADE,
    block_type VARCHAR(20) NOT NULL,
    character_id VARCHAR(64) REFERENCES script_characters(id) ON DELETE RESTRICT,
    content TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL,
    CONSTRAINT ck_script_blocks_type CHECK (block_type IN ('action', 'dialogue', 'narration', 'transition')),
    CONSTRAINT ck_script_blocks_dialogue_character CHECK (block_type = 'dialogue' OR character_id IS NULL)
);

COMMENT ON TABLE script_blocks IS '结构化剧本正文块表';
COMMENT ON COLUMN script_blocks.id IS '正文块稳定标识';
COMMENT ON COLUMN script_blocks.scene_id IS '所属场次ID';
COMMENT ON COLUMN script_blocks.block_type IS '正文块类型：action动作、dialogue对白、narration旁白、transition转场';
COMMENT ON COLUMN script_blocks.character_id IS '对白所属人物ID，非对白内容为空';
COMMENT ON COLUMN script_blocks.content IS '正文块内容';
COMMENT ON COLUMN script_blocks.sort_order IS '正文块顺序';

CREATE INDEX idx_script_blocks_scene_sort ON script_blocks(scene_id, sort_order);
CREATE INDEX idx_script_blocks_character ON script_blocks(character_id);

CREATE TABLE script_story_events (
    id VARCHAR(64) PRIMARY KEY,
    project_id VARCHAR(64) NOT NULL REFERENCES script_projects(id) ON DELETE CASCADE,
    outline_section_id VARCHAR(64) REFERENCES script_outline_sections(id) ON DELETE SET NULL,
    episode_id VARCHAR(64) REFERENCES script_episodes(id) ON DELETE SET NULL,
    scene_id VARCHAR(64) REFERENCES script_scenes(id) ON DELETE SET NULL,
    event_type VARCHAR(32) NOT NULL,
    title VARCHAR(160) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL,
    CONSTRAINT ck_script_story_events_type CHECK (event_type IN ('plot', 'conflict', 'suspense', 'twist', 'climax', 'ending'))
);

COMMENT ON TABLE script_story_events IS '故事关键事件及大纲、分集、场次关联表';
COMMENT ON COLUMN script_story_events.id IS '故事事件稳定标识';
COMMENT ON COLUMN script_story_events.project_id IS '所属剧本项目ID';
COMMENT ON COLUMN script_story_events.outline_section_id IS '关联大纲结构段ID';
COMMENT ON COLUMN script_story_events.episode_id IS '关联分集ID';
COMMENT ON COLUMN script_story_events.scene_id IS '关联场次ID';
COMMENT ON COLUMN script_story_events.event_type IS '事件类型：plot剧情、conflict冲突、suspense悬念、twist反转、climax高潮、ending结局';
COMMENT ON COLUMN script_story_events.title IS '事件标题';
COMMENT ON COLUMN script_story_events.description IS '事件说明';
COMMENT ON COLUMN script_story_events.sort_order IS '事件顺序';

CREATE INDEX idx_script_story_events_project_sort ON script_story_events(project_id, sort_order);
CREATE INDEX idx_script_story_events_episode ON script_story_events(episode_id);
CREATE INDEX idx_script_story_events_scene ON script_story_events(scene_id);

CREATE TABLE script_versions (
    id VARCHAR(64) PRIMARY KEY,
    project_id VARCHAR(64) NOT NULL REFERENCES script_projects(id) ON DELETE CASCADE,
    created_by_user_id BIGINT NOT NULL REFERENCES users(id),
    version_name VARCHAR(120) NOT NULL,
    change_source VARCHAR(20) NOT NULL,
    change_summary TEXT NOT NULL DEFAULT '',
    source_revision BIGINT NOT NULL,
    snapshot_data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_script_versions_source CHECK (change_source IN ('manual', 'ai')),
    CONSTRAINT ck_script_versions_snapshot CHECK (jsonb_typeof(snapshot_data) = 'object')
);

COMMENT ON TABLE script_versions IS '剧本命名版本与AI修改前快照表';
COMMENT ON COLUMN script_versions.id IS '版本稳定标识';
COMMENT ON COLUMN script_versions.project_id IS '所属剧本项目ID';
COMMENT ON COLUMN script_versions.created_by_user_id IS '版本创建用户ID';
COMMENT ON COLUMN script_versions.version_name IS '版本名称';
COMMENT ON COLUMN script_versions.change_source IS '版本来源：manual手动、ai应用AI修改前';
COMMENT ON COLUMN script_versions.change_summary IS '修改摘要';
COMMENT ON COLUMN script_versions.source_revision IS '快照对应项目修订号';
COMMENT ON COLUMN script_versions.snapshot_data IS '不可变的完整剧本快照';
COMMENT ON COLUMN script_versions.created_at IS '版本创建时间';

CREATE INDEX idx_script_versions_project_created ON script_versions(project_id, created_at DESC, id);

CREATE TABLE script_ai_drafts (
    id VARCHAR(64) PRIMARY KEY,
    project_id VARCHAR(64) NOT NULL REFERENCES script_projects(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id),
    action_type VARCHAR(40) NOT NULL,
    target_type VARCHAR(32) NOT NULL DEFAULT 'project',
    target_id VARCHAR(64),
    base_revision BIGINT NOT NULL,
    instruction TEXT NOT NULL DEFAULT '',
    source_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    draft_data JSONB NOT NULL,
    model VARCHAR(256) NOT NULL,
    charged_credits INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    applied_at TIMESTAMPTZ,
    CONSTRAINT ck_script_ai_drafts_source CHECK (jsonb_typeof(source_data) = 'object'),
    CONSTRAINT ck_script_ai_drafts_data CHECK (jsonb_typeof(draft_data) = 'object'),
    CONSTRAINT ck_script_ai_drafts_credits CHECK (charged_credits >= 0),
    CONSTRAINT ck_script_ai_drafts_status CHECK (status IN ('pending', 'applied', 'discarded'))
);

COMMENT ON TABLE script_ai_drafts IS '待用户确认的剧本AI结构化草稿表';
COMMENT ON COLUMN script_ai_drafts.id IS 'AI草稿稳定标识';
COMMENT ON COLUMN script_ai_drafts.project_id IS '所属剧本项目ID';
COMMENT ON COLUMN script_ai_drafts.user_id IS '发起AI操作的用户ID';
COMMENT ON COLUMN script_ai_drafts.action_type IS 'AI动作类型';
COMMENT ON COLUMN script_ai_drafts.target_type IS '草稿目标类型';
COMMENT ON COLUMN script_ai_drafts.target_id IS '草稿目标实体ID';
COMMENT ON COLUMN script_ai_drafts.base_revision IS '生成草稿时的项目修订号';
COMMENT ON COLUMN script_ai_drafts.instruction IS '用户补充要求';
COMMENT ON COLUMN script_ai_drafts.source_data IS '用于应用前冲突校验的原内容快照';
COMMENT ON COLUMN script_ai_drafts.draft_data IS 'AI返回并允许用户编辑的结构化草稿';
COMMENT ON COLUMN script_ai_drafts.model IS '生成草稿使用的渠道与文本模型';
COMMENT ON COLUMN script_ai_drafts.charged_credits IS '本次AI调用实际扣除积分';
COMMENT ON COLUMN script_ai_drafts.status IS '状态：pending待确认、applied已应用、discarded已放弃';
COMMENT ON COLUMN script_ai_drafts.created_at IS '创建时间';
COMMENT ON COLUMN script_ai_drafts.applied_at IS '确认应用时间';

CREATE INDEX idx_script_ai_drafts_project_status_created ON script_ai_drafts(project_id, status, created_at DESC, id);
CREATE INDEX idx_script_ai_drafts_user_created ON script_ai_drafts(user_id, created_at DESC);

CREATE TABLE script_analysis_reports (
    id VARCHAR(64) PRIMARY KEY,
    project_id VARCHAR(64) NOT NULL REFERENCES script_projects(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id),
    scope_type VARCHAR(20) NOT NULL,
    scope_id VARCHAR(64),
    summary TEXT NOT NULL DEFAULT '',
    model VARCHAR(256) NOT NULL,
    charged_credits INTEGER NOT NULL DEFAULT 0,
    source_revision BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_script_analysis_reports_scope CHECK (scope_type IN ('project', 'episode')),
    CONSTRAINT ck_script_analysis_reports_credits CHECK (charged_credits >= 0)
);

COMMENT ON TABLE script_analysis_reports IS '剧本专业分析报告表';
COMMENT ON COLUMN script_analysis_reports.id IS '分析报告稳定标识';
COMMENT ON COLUMN script_analysis_reports.project_id IS '所属剧本项目ID';
COMMENT ON COLUMN script_analysis_reports.user_id IS '发起分析的用户ID';
COMMENT ON COLUMN script_analysis_reports.scope_type IS '分析范围：project全项目、episode单集';
COMMENT ON COLUMN script_analysis_reports.scope_id IS '单集分析时的分集ID';
COMMENT ON COLUMN script_analysis_reports.summary IS '分析总结，不包含单一百分比评分';
COMMENT ON COLUMN script_analysis_reports.model IS '分析使用的渠道与文本模型';
COMMENT ON COLUMN script_analysis_reports.charged_credits IS '本次分析实际扣除积分';
COMMENT ON COLUMN script_analysis_reports.source_revision IS '分析对应项目修订号';
COMMENT ON COLUMN script_analysis_reports.created_at IS '创建时间';

CREATE INDEX idx_script_analysis_reports_project_created ON script_analysis_reports(project_id, created_at DESC, id);

CREATE TABLE script_analysis_issues (
    id VARCHAR(64) PRIMARY KEY,
    report_id VARCHAR(64) NOT NULL REFERENCES script_analysis_reports(id) ON DELETE CASCADE,
    category VARCHAR(32) NOT NULL,
    severity VARCHAR(16) NOT NULL,
    episode_id VARCHAR(64) REFERENCES script_episodes(id) ON DELETE SET NULL,
    scene_id VARCHAR(64) REFERENCES script_scenes(id) ON DELETE SET NULL,
    block_id VARCHAR(64) REFERENCES script_blocks(id) ON DELETE SET NULL,
    title VARCHAR(200) NOT NULL,
    reason TEXT NOT NULL,
    suggestion TEXT NOT NULL,
    sort_order INTEGER NOT NULL,
    CONSTRAINT ck_script_analysis_issues_severity CHECK (severity IN ('info', 'warning', 'important'))
);

COMMENT ON TABLE script_analysis_issues IS '剧本分析问题明细表';
COMMENT ON COLUMN script_analysis_issues.id IS '分析问题稳定标识';
COMMENT ON COLUMN script_analysis_issues.report_id IS '所属分析报告ID';
COMMENT ON COLUMN script_analysis_issues.category IS '问题类别：剧情、动机、节奏、逻辑、对白、悬念等';
COMMENT ON COLUMN script_analysis_issues.severity IS '问题程度：info提示、warning注意、important重要';
COMMENT ON COLUMN script_analysis_issues.episode_id IS '定位到的分集ID';
COMMENT ON COLUMN script_analysis_issues.scene_id IS '定位到的场次ID';
COMMENT ON COLUMN script_analysis_issues.block_id IS '定位到的正文块ID';
COMMENT ON COLUMN script_analysis_issues.title IS '问题标题';
COMMENT ON COLUMN script_analysis_issues.reason IS '判断依据与原因';
COMMENT ON COLUMN script_analysis_issues.suggestion IS '具体修改建议';
COMMENT ON COLUMN script_analysis_issues.sort_order IS '问题顺序';

CREATE INDEX idx_script_analysis_issues_report_sort ON script_analysis_issues(report_id, sort_order);

INSERT INTO script_templates(template_key, category, name, description, content_type, genre, structure_type, recommended_episode_count, sort_order) VALUES
('short-revenge', 'shortDrama', '复仇短剧', '围绕压制、反击与代价建立强冲突短剧骨架。', 'liveActionShort', '复仇', 'threeAct', 24, 10),
('short-rebirth', 'shortDrama', '重生短剧', '围绕已知命运、关键改写与连锁变化建立短剧骨架。', 'liveActionShort', '重生', 'threeAct', 24, 20),
('short-suspense', 'shortDrama', '悬疑短剧', '围绕谜面、误导、线索回收与真相建立短剧骨架。', 'liveActionShort', '悬疑', 'fiveAct', 20, 30),
('short-romance', 'shortDrama', '爱情短剧', '围绕相遇、阻力、误解与关系选择建立短剧骨架。', 'liveActionShort', '爱情', 'threeAct', 24, 40),
('short-urban', 'shortDrama', '都市短剧', '围绕现实身份、利益冲突与人物成长建立短剧骨架。', 'liveActionShort', '都市', 'threeAct', 24, 50),
('short-time-travel', 'shortDrama', '穿越短剧', '围绕时代错位、规则限制与目标达成建立短剧骨架。', 'liveActionShort', '穿越', 'fourPart', 24, 60),
('comic-fantasy', 'comicAnimation', '玄幻漫剧', '围绕力量规则、升级目标与阵营冲突建立漫剧骨架。', 'comicDrama', '玄幻', 'fourPart', 30, 110),
('comic-immortal', 'comicAnimation', '仙侠漫剧', '围绕修行体系、因果选择与宗门冲突建立漫剧骨架。', 'comicDrama', '仙侠', 'fourPart', 30, 120),
('comic-apocalypse', 'comicAnimation', '末世漫剧', '围绕生存规则、资源争夺与群体抉择建立漫剧骨架。', 'comicDrama', '末世', 'threeAct', 24, 130),
('comic-science-fiction', 'comicAnimation', '科幻动画', '围绕技术设定、伦理冲突与未知危机建立动画骨架。', 'animation', '科幻', 'fiveAct', 16, 140),
('comic-martial-arts', 'comicAnimation', '武侠动画', '围绕江湖秩序、恩怨选择与成长试炼建立动画骨架。', 'animation', '武侠', 'fourPart', 20, 150),
('comic-campus', 'comicAnimation', '校园动画', '围绕校园关系、成长困境与阶段变化建立动画骨架。', 'animation', '校园', 'threeAct', 16, 160),
('narrative-advertisement', 'narrativeVideo', '广告故事', '以受众痛点、情境转折与品牌价值建立短篇广告骨架。', 'advertisement', '广告', 'threeAct', 1, 210),
('narrative-music-video', 'narrativeVideo', '音乐视频', '以音乐段落、情绪推进与视觉母题建立叙事骨架。', 'musicVideo', '音乐视频', 'fourPart', 1, 220),
('narrative-promotion', 'narrativeVideo', '宣传片', '以核心信息、事实支撑与行动号召建立宣传片骨架。', 'advertisement', '宣传片', 'threeAct', 1, 230),
('narrative-story-short', 'narrativeVideo', '故事短片', '以人物目标、关键冲突与情感落点建立短片骨架。', 'storyShort', '故事短片', 'threeAct', 1, 240);

INSERT INTO script_template_sections(id, template_key, title, section_type, guidance, sort_order)
SELECT script_template.template_key || '-' || section.section_key, script_template.template_key, section.title, 'act', section.guidance, section.sort_order
FROM script_templates script_template
JOIN (VALUES
    ('threeAct', 'act-one', '第一幕：建立', '建立人物、世界规则、核心目标和触发事件。', 0),
    ('threeAct', 'act-two', '第二幕：对抗', '持续升级阻力、代价和人物选择，推动冲突走向不可回避。', 1),
    ('threeAct', 'act-three', '第三幕：解决', '兑现高潮、人物变化与结局，并回收主要伏笔。', 2),
    ('fourPart', 'part-one', '起：建立', '建立人物、世界规则和必须解决的问题。', 0),
    ('fourPart', 'part-two', '承：发展', '扩展人物关系与阻力，推动目标持续受挫。', 1),
    ('fourPart', 'part-three', '转：变化', '通过关键发现、选择或反转改变剧情方向。', 2),
    ('fourPart', 'part-four', '合：收束', '兑现高潮和人物变化，完成主线回收。', 3),
    ('fiveAct', 'act-one', '第一幕：铺陈', '建立人物、谜面、世界规则和触发事件。', 0),
    ('fiveAct', 'act-two', '第二幕：发展', '扩展线索、关系和初步阻力。', 1),
    ('fiveAct', 'act-three', '第三幕：升级', '让冲突、误导与代价达到不可逆的转折。', 2),
    ('fiveAct', 'act-four', '第四幕：高潮', '集中兑现真相、选择和核心冲突。', 3),
    ('fiveAct', 'act-five', '第五幕：结局', '完成余波、伏笔回收和最终情感落点。', 4)
) AS section(structure_type, section_key, title, guidance, sort_order)
ON section.structure_type = script_template.structure_type;

-- 小说改编扩展为整条剧本骨架流水线，新增概览、人物与关系、世界观与地点三个阶段。
ALTER TABLE novel_adaptation_drafts DROP CONSTRAINT ck_novel_adaptation_stage;
ALTER TABLE novel_adaptation_drafts ADD CONSTRAINT ck_novel_adaptation_stage
    CHECK (stage IN ('overview', 'characters', 'world', 'outline', 'episodes', 'episode'));
COMMENT ON COLUMN novel_adaptation_drafts.stage IS '改编阶段：故事概览、人物与关系、世界观与地点、故事大纲、分集规划或单集剧本';

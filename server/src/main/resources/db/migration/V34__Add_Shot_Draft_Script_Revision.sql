ALTER TABLE comic_drama_shot_drafts
    ADD COLUMN base_script_revision BIGINT NOT NULL DEFAULT 0;

COMMENT ON COLUMN comic_drama_shot_drafts.base_script_revision IS '生成镜头草稿时的共享剧本项目修订号，用于阻止确认陈旧草稿';

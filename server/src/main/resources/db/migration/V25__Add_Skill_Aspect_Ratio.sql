ALTER TABLE skills
    ADD COLUMN aspect_ratio VARCHAR(16) NOT NULL DEFAULT '16:9';

ALTER TABLE skills
    ADD CONSTRAINT ck_skills_aspect_ratio
    CHECK (aspect_ratio ~ '^[0-9]+:[0-9]+$');

COMMENT ON COLUMN skills.aspect_ratio IS '技能默认生成比例，例如16:9、9:16；图片和视频生成时优先使用';

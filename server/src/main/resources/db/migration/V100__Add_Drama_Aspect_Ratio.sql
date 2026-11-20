ALTER TABLE drama_project ADD COLUMN aspect_ratio VARCHAR(8) NOT NULL DEFAULT '9:16';
ALTER TABLE drama_project ADD CONSTRAINT ck_drama_project_aspect
    CHECK (aspect_ratio IN ('9:16', '16:9', '1:1', '3:4', '4:3', '21:9'));
COMMENT ON COLUMN drama_project.aspect_ratio IS '整集画幅比例。图片和视频生成都使用这个比例';

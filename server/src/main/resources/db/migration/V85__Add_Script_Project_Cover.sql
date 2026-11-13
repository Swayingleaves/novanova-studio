ALTER TABLE script_projects
    ADD COLUMN cover_url TEXT NOT NULL DEFAULT '';

COMMENT ON COLUMN script_projects.cover_url IS '项目封面图片的公开访问地址，空字符串表示未设置；漫剧项目与剧本一对一，直接使用同一封面';

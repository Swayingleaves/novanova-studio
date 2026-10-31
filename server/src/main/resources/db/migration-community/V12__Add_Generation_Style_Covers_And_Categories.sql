ALTER TABLE generation_styles
    ADD COLUMN cover_url TEXT NOT NULL DEFAULT '',
    ADD COLUMN category VARCHAR(100) NOT NULL DEFAULT '';

COMMENT ON COLUMN generation_styles.cover_url IS '风格封面公开访问地址';
COMMENT ON COLUMN generation_styles.category IS '风格分类';

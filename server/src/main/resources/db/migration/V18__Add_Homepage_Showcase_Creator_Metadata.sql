ALTER TABLE homepage_showcases
    ADD COLUMN category VARCHAR(50) NOT NULL DEFAULT '其他',
    ADD COLUMN creator_name VARCHAR(100) NOT NULL DEFAULT 'Novanova Studio';

COMMENT ON COLUMN homepage_showcases.category IS '作品分类，用于首页精彩创作筛选';
COMMENT ON COLUMN homepage_showcases.creator_name IS '创作者名称，用于首页精彩创作署名';

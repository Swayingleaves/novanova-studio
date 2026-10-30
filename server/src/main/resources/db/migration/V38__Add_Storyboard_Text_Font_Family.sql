ALTER TABLE comic_drama_timeline_texts
    ADD COLUMN font_family VARCHAR(32) NOT NULL DEFAULT 'notoSansSc';

ALTER TABLE comic_drama_timeline_texts
    ADD CONSTRAINT ck_comic_drama_timeline_texts_font_family
        CHECK (font_family IN ('notoSansSc', 'notoSerifSc', 'lxgwWenKai', 'inter', 'montserrat', 'lora', 'caveat'));

COMMENT ON COLUMN comic_drama_timeline_texts.font_family IS '文字字体标识，使用随产品分发的免费字体目录';

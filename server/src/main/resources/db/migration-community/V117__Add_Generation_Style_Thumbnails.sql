ALTER TABLE generation_styles
    ADD COLUMN cover_thumbnail BYTEA,
    ADD COLUMN thumbnail_version VARCHAR(64),
    ADD CONSTRAINT ck_generation_styles_thumbnail_pair CHECK (
        (cover_thumbnail IS NULL AND thumbnail_version IS NULL)
        OR (thumbnail_version IS NOT NULL AND cover_thumbnail IS NOT NULL AND octet_length(cover_thumbnail) BETWEEN 12 AND 262144)
    );

COMMENT ON COLUMN generation_styles.cover_thumbnail IS '风格封面 WebP 缩略图二进制数据，最大 256 KiB';
COMMENT ON COLUMN generation_styles.thumbnail_version IS '缩略图内容的 SHA-256 摘要，用于浏览器缓存版本';

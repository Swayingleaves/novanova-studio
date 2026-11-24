ALTER TABLE system_notifications
    ALTER COLUMN title SET DEFAULT '';

ALTER TABLE system_notifications
    ADD COLUMN IF NOT EXISTS image_url TEXT;

COMMENT ON COLUMN system_notifications.image_url IS '公告图片地址，可与标题、正文任意组合，三者至少填写一项';

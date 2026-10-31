-- 创作页（图片/视频共用）产品导览的完成版本，0 表示尚未完成。
ALTER TABLE users ADD COLUMN creation_tour_version INTEGER NOT NULL DEFAULT 0;
COMMENT ON COLUMN users.creation_tour_version IS '已完成创作页产品导览的版本，图片与视频创作页共用；0 表示尚未完成';

ALTER TABLE shared_work_media ADD COLUMN cover_object_key TEXT;
ALTER TABLE shared_work_media ADD COLUMN cover_mime_type TEXT;

COMMENT ON COLUMN shared_work_media.cover_object_key IS '视频分享副本的封面对象键，非视频或截帧失败时为空';
COMMENT ON COLUMN shared_work_media.cover_mime_type IS '封面媒体类型，没有封面时为空';

ALTER TABLE storage_objects
    ADD COLUMN file_name TEXT NOT NULL DEFAULT '',
    ADD COLUMN file_category VARCHAR(16) NOT NULL DEFAULT 'other'
        CHECK (file_category IN ('image', 'video', 'audio', 'document', 'other')),
    ADD COLUMN mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
    ADD COLUMN source_type VARCHAR(32) NOT NULL DEFAULT 'unrecorded'
        CHECK (source_type IN ('upload', 'generated', 'remoteImport', 'sourceImport', 'unrecorded'));

COMMENT ON COLUMN storage_objects.file_name IS '原始文件名，未记录原名时为实际对象键的文件名';
COMMENT ON COLUMN storage_objects.file_category IS '文件分类：图片、视频、音频、文档或其他';
COMMENT ON COLUMN storage_objects.mime_type IS '文件媒体类型，用于安全预览和下载';
COMMENT ON COLUMN storage_objects.source_type IS '文件来源：上传、生成、远程转存、原文导入或未记录';

UPDATE storage_objects SET file_name = regexp_replace(object_key, '^.*/', '');

-- 精确匹配空间、用户、配置及对象键；一个对象只选一份媒体元数据，避免重复引用放大用量。
WITH matched_media AS (
    SELECT DISTINCT ON (objects.id) objects.id, media.kind, media.mime_type, media.source_url,
        NULLIF(media.metadata->>'fileName', '') original_name
    FROM storage_objects objects JOIN media_files media
        ON media.team_id = objects.team_id AND media.user_id = objects.user_id
        AND media.object_storage_config_id = objects.storage_id AND media.object_storage_key = objects.object_key
    ORDER BY objects.id, media.created_at DESC, media.storage_key
)
UPDATE storage_objects objects SET
    file_name = COALESCE(media.original_name, objects.file_name),
    mime_type = COALESCE(NULLIF(media.mime_type, ''), 'application/octet-stream'),
    file_category = CASE
        WHEN media.mime_type LIKE 'image/%' OR media.kind IN ('image', 'avatar') THEN 'image'
        WHEN media.mime_type LIKE 'video/%' OR media.kind = 'video' THEN 'video'
        WHEN media.mime_type LIKE 'audio/%' OR media.kind = 'audio' THEN 'audio'
        WHEN media.mime_type LIKE 'text/%' OR media.mime_type IN ('application/pdf', 'application/msword', 'application/rtf')
            OR media.mime_type LIKE 'application/vnd.openxmlformats-officedocument.%'
            OR media.mime_type LIKE 'application/vnd.oasis.opendocument.%' THEN 'document'
        ELSE 'other' END,
    source_type = CASE WHEN NULLIF(media.source_url, '') IS NOT NULL THEN 'remoteImport' ELSE 'unrecorded' END
FROM matched_media media WHERE objects.id = media.id;

UPDATE storage_objects objects SET file_name = documents.file_name, file_category = 'document', source_type = 'sourceImport',
    mime_type = CASE documents.file_extension
        WHEN 'txt' THEN 'text/plain'
        WHEN 'docx' THEN 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        WHEN 'pdf' THEN 'application/pdf'
        ELSE 'application/octet-stream' END
FROM script_source_documents documents
WHERE objects.team_id = documents.team_id AND objects.user_id = documents.user_id
    AND objects.storage_id = documents.storage_config_id AND objects.object_key = documents.object_key;

CREATE INDEX idx_storage_objects_user_category ON storage_objects(team_id, user_id, file_category, stored_at DESC, id DESC)
    WHERE deleted_at IS NULL;
CREATE INDEX idx_storage_objects_user_size ON storage_objects(team_id, user_id, file_bytes DESC, id DESC)
    WHERE deleted_at IS NULL;

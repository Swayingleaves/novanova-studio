ALTER TABLE platform_oauth_clients
    ADD COLUMN logo_storage_key VARCHAR(128),
    ADD COLUMN logo_storage_id VARCHAR(64),
    ADD COLUMN logo_object_key VARCHAR(512),
    ADD COLUMN logo_mime_type VARCHAR(128),
    ADD COLUMN display_content VARCHAR(500);

COMMENT ON COLUMN platform_oauth_clients.logo_storage_key IS '应用图标的媒体存储键，用于识别管理员上传的图片；为空表示未配置图标';
COMMENT ON COLUMN platform_oauth_clients.logo_storage_id IS '应用图标所在的对象存储配置标识';
COMMENT ON COLUMN platform_oauth_clients.logo_object_key IS '应用图标的对象键，授权确认页按此签发读地址';
COMMENT ON COLUMN platform_oauth_clients.logo_mime_type IS '应用图标的媒体类型';
COMMENT ON COLUMN platform_oauth_clients.display_content IS '授权确认页展示的说明文字，为空时只显示默认授权说明';

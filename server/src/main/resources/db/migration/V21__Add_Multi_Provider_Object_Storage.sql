ALTER TABLE user_object_storage_configs RENAME COLUMN secret_id_encrypted TO access_key_encrypted;
ALTER TABLE user_object_storage_configs ADD COLUMN endpoint VARCHAR(500) NOT NULL DEFAULT '';

COMMENT ON COLUMN user_object_storage_configs.access_key_encrypted IS '加密后的对象存储访问密钥';
COMMENT ON COLUMN user_object_storage_configs.endpoint IS '对象存储服务Endpoint';

ALTER TABLE platform_object_storage_configs RENAME COLUMN secret_id_encrypted TO access_key_encrypted;
ALTER TABLE platform_object_storage_configs ADD COLUMN endpoint VARCHAR(500) NOT NULL DEFAULT '';

COMMENT ON COLUMN platform_object_storage_configs.access_key_encrypted IS '加密后的对象存储访问密钥';
COMMENT ON COLUMN platform_object_storage_configs.endpoint IS '对象存储服务Endpoint';

ALTER TABLE media_files RENAME COLUMN cos_url TO object_storage_url;
ALTER TABLE media_files RENAME COLUMN cos_key TO object_storage_key;
ALTER TABLE media_files ADD COLUMN object_storage_provider VARCHAR(30) NOT NULL DEFAULT '';

UPDATE media_files
SET object_storage_provider = 'tencentCos'
WHERE object_storage_url IS NOT NULL AND object_storage_url <> '';

COMMENT ON COLUMN media_files.object_storage_provider IS '对象存储服务商标识';
COMMENT ON COLUMN media_files.object_storage_url IS '对象存储公开访问URL';
COMMENT ON COLUMN media_files.object_storage_key IS '对象存储对象键';

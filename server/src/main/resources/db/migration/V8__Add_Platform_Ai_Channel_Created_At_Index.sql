-- 支持按创建时间倒序读取正常状态的全站AI渠道。
CREATE INDEX idx_platform_ai_channels_status_created_at
    ON platform_ai_channels(status, created_at DESC, id DESC);

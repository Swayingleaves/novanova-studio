ALTER TABLE platform_ai_channels
    ADD COLUMN IF NOT EXISTS model_groups JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN platform_ai_channels.model_groups IS '模型分组映射JSON（模型名到分组标识列表）';

ALTER TABLE user_ai_channels
    ADD COLUMN IF NOT EXISTS model_groups JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN user_ai_channels.model_groups IS '模型分组映射JSON（模型名到分组标识列表）';

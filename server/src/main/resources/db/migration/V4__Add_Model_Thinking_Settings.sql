ALTER TABLE platform_ai_model_configs
    ADD COLUMN thinking_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN reasoning_effort VARCHAR(10) NOT NULL DEFAULT 'high',
    ADD CONSTRAINT ck_platform_ai_model_configs_reasoning_effort CHECK (reasoning_effort IN ('high', 'max'));

COMMENT ON COLUMN platform_ai_model_configs.thinking_enabled IS '是否开启文本模型思考模式';
COMMENT ON COLUMN platform_ai_model_configs.reasoning_effort IS '文本模型思考强度：high、max';

ALTER TABLE user_ai_model_configs
    ADD COLUMN thinking_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN reasoning_effort VARCHAR(10) NOT NULL DEFAULT 'high',
    ADD CONSTRAINT ck_user_ai_model_configs_reasoning_effort CHECK (reasoning_effort IN ('high', 'max'));

COMMENT ON COLUMN user_ai_model_configs.thinking_enabled IS '是否开启文本模型思考模式';
COMMENT ON COLUMN user_ai_model_configs.reasoning_effort IS '文本模型思考强度：high、max';

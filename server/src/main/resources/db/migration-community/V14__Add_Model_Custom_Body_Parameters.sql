ALTER TABLE platform_ai_model_configs
    ADD COLUMN custom_body_parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD CONSTRAINT ck_platform_ai_model_configs_custom_body_parameters_object
        CHECK (jsonb_typeof(custom_body_parameters) = 'object');

COMMENT ON COLUMN platform_ai_model_configs.custom_body_parameters IS '模型JSON POST请求的自定义请求体参数，顶层必须为JSON对象';

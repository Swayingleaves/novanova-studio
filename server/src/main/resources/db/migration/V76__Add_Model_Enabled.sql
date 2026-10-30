ALTER TABLE platform_ai_model_configs
    ADD COLUMN is_enabled BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN platform_ai_model_configs.is_enabled IS '模型是否开启，关闭后不出现在用户的模型下拉选择中，默认开启';

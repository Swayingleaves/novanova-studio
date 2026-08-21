ALTER TABLE platform_ai_model_configs
    ADD COLUMN model_icon VARCHAR(64);

COMMENT ON COLUMN platform_ai_model_configs.model_icon IS '模型展示图标标识，为空时按模型名或渠道自动匹配，仅影响展示不影响调用';

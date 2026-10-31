ALTER TABLE platform_ai_model_configs
    ADD COLUMN display_name VARCHAR(255);

COMMENT ON COLUMN platform_ai_model_configs.display_name IS '模型展示名称，为空或与真实模型名相同时展示真实模型名，仅影响展示不影响调用';

ALTER TABLE platform_ai_model_configs
    ADD COLUMN IF NOT EXISTS description VARCHAR(500);

COMMENT ON COLUMN platform_ai_model_configs.description IS '模型说明，展示在生成页模型选择列表中，为空时不展示';

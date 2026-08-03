ALTER TABLE platform_ai_model_configs
    ADD COLUMN credit_unit VARCHAR(20) NOT NULL DEFAULT 'generation',
    ADD CONSTRAINT ck_platform_ai_model_configs_credit_unit CHECK (credit_unit IN ('generation', 'second'));

COMMENT ON COLUMN platform_ai_model_configs.credit_unit IS '积分计费单位：generation按次，second按视频秒数';

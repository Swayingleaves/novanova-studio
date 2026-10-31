ALTER TABLE platform_ai_model_configs
    ADD COLUMN image_billing_configuration JSONB;

COMMENT ON COLUMN platform_ai_model_configs.image_billing_configuration IS '图片模型按1K、2K、4K分辨率配置的积分单价表，空值回退到模型单价';

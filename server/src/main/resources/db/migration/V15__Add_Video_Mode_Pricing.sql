ALTER TABLE platform_ai_model_configs
    ADD COLUMN video_billing_configuration JSONB;

COMMENT ON COLUMN platform_ai_model_configs.video_billing_configuration IS '视频模型模式与分辨率分档计费配置，包含计费方式、最短生成秒数及模式价格表';

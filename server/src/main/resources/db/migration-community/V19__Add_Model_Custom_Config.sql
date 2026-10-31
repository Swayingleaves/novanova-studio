ALTER TABLE platform_ai_model_configs
    ADD COLUMN is_custom_model BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN custom_model_config JSONB;

COMMENT ON COLUMN platform_ai_model_configs.is_custom_model IS '是否启用自定义模型调用（独立于渠道格式），仅图片/视频模型支持';
COMMENT ON COLUMN platform_ai_model_configs.custom_model_config IS '自定义模型配置JSONB，按图片能力或视频模式分组的请求/响应模板集合';

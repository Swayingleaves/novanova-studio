ALTER TABLE platform_ai_model_configs
    ADD COLUMN image_size_mappings JSONB;

COMMENT ON COLUMN platform_ai_model_configs.image_size_mappings IS '图像模型的size尺寸映射，按画幅比例与1K、2K、4K档位保存像素尺寸，空值使用系统默认表，缺失档位不推算';

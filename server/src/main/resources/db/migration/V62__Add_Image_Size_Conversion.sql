ALTER TABLE platform_ai_model_configs
    ADD COLUMN convert_image_size_to_pixels BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN platform_ai_model_configs.convert_image_size_to_pixels IS '图像模型是否将size比例按1K、2K、4K分辨率转换为像素尺寸，默认关闭';

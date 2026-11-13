ALTER TABLE platform_external_link_config RENAME COLUMN logo_url TO cover_url;

COMMENT ON COLUMN platform_external_link_config.cover_url IS '弹窗中展示的封面图片地址，为空时不展示封面';

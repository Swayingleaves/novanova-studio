ALTER TABLE platform_navigation_menu_configs
    ADD COLUMN IF NOT EXISTS display_name VARCHAR(32),
    ADD COLUMN IF NOT EXISTS icon_key VARCHAR(64),
    ADD COLUMN IF NOT EXISTS badge_text VARCHAR(16),
    ADD COLUMN IF NOT EXISTS badge_color VARCHAR(32);

COMMENT ON COLUMN platform_navigation_menu_configs.display_name IS '自定义菜单显示名称，为空时沿用系统默认名称';
COMMENT ON COLUMN platform_navigation_menu_configs.icon_key IS '自定义菜单图标标识，为空时沿用系统默认图标';
COMMENT ON COLUMN platform_navigation_menu_configs.badge_text IS '右上角角标文案，为空时不显示角标';
COMMENT ON COLUMN platform_navigation_menu_configs.badge_color IS '右上角角标文字颜色（如十六进制色值），为空时沿用系统默认颜色';

UPDATE platform_navigation_menu_configs
SET badge_text = 'NEW'
WHERE menu_key IN ('drama', 'script', 'comic-drama')
  AND badge_text IS NULL;

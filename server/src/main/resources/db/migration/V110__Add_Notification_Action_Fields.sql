ALTER TABLE system_notifications
    ADD COLUMN IF NOT EXISTS action_label VARCHAR(32),
    ADD COLUMN IF NOT EXISTS target_path VARCHAR(255),
    ADD COLUMN IF NOT EXISTS target_model VARCHAR(255);

COMMENT ON COLUMN system_notifications.action_label IS '公告引导按钮文案，为空且配置了跳转路径时默认展示「去试一试」';
COMMENT ON COLUMN system_notifications.target_path IS '点击引导按钮或公告图片后跳转的站内页面路径，如 /image、/video';
COMMENT ON COLUMN system_notifications.target_model IS '跳转后自动预选的模型标识（channelId::modelName），为空时不切换模型';

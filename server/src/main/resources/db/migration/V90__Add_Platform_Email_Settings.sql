CREATE TABLE platform_email_settings (
    id SMALLINT PRIMARY KEY DEFAULT 1,
    smtp_host VARCHAR(255) NOT NULL DEFAULT '',
    smtp_port INTEGER NOT NULL DEFAULT 465,
    smtp_username VARCHAR(320) NOT NULL DEFAULT '',
    smtp_password TEXT NOT NULL DEFAULT '',
    from_email VARCHAR(320) NOT NULL DEFAULT '',
    allowed_suffixes VARCHAR(4000) NOT NULL DEFAULT 'qq.com,163.com,126.com,gmail.com,outlook.com,hotmail.com,foxmail.com,icloud.com,sina.com,aliyun.com,yeah.net,139.com,189.cn,sina.cn,vip.qq.com,vip.163.com,yahoo.com,live.com,msn.com,proton.me,protonmail.com',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_platform_email_settings_singleton CHECK (id = 1),
    CONSTRAINT ck_platform_email_settings_port CHECK (smtp_port BETWEEN 1 AND 65535)
);

COMMENT ON TABLE platform_email_settings IS '全站邮件服务配置，固定单行，由管理后台维护';
COMMENT ON COLUMN platform_email_settings.id IS '固定单行标识';
COMMENT ON COLUMN platform_email_settings.smtp_host IS 'SMTP 服务地址';
COMMENT ON COLUMN platform_email_settings.smtp_port IS 'SMTP 端口，SSL 通常使用 465';
COMMENT ON COLUMN platform_email_settings.smtp_username IS 'SMTP 登录用户名';
COMMENT ON COLUMN platform_email_settings.smtp_password IS '加密后的 SMTP 登录密码或授权码，空字符串表示未设置';
COMMENT ON COLUMN platform_email_settings.from_email IS '发件人邮箱';
COMMENT ON COLUMN platform_email_settings.allowed_suffixes IS '允许注册的邮箱后缀，逗号分隔；空值或包含独立星号表示不限制。默认值须与 RuntimeEmailSettings.DEFAULT_ALLOWED_SUFFIXES 一致';
COMMENT ON COLUMN platform_email_settings.created_at IS '创建时间';
COMMENT ON COLUMN platform_email_settings.updated_at IS '更新时间';

INSERT INTO platform_email_settings(id)
VALUES (1);

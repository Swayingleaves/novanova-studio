CREATE TABLE platform_payment_settings (
    id SMALLINT PRIMARY KEY DEFAULT 1,
    alipay_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    alipay_app_id VARCHAR(64) NOT NULL DEFAULT '',
    alipay_private_key TEXT NOT NULL DEFAULT '',
    alipay_public_key TEXT NOT NULL DEFAULT '',
    alipay_gateway_url VARCHAR(255) NOT NULL DEFAULT 'https://openapi.alipay.com/gateway.do',
    alipay_notify_url VARCHAR(500) NOT NULL DEFAULT '',
    alipay_return_url VARCHAR(500) NOT NULL DEFAULT '',
    wechat_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    wechat_app_id VARCHAR(64) NOT NULL DEFAULT '',
    wechat_merchant_id VARCHAR(32) NOT NULL DEFAULT '',
    wechat_merchant_serial_number VARCHAR(64) NOT NULL DEFAULT '',
    wechat_private_key TEXT NOT NULL DEFAULT '',
    wechat_api_v3_key TEXT NOT NULL DEFAULT '',
    wechat_public_key TEXT NOT NULL DEFAULT '',
    wechat_public_key_id VARCHAR(64) NOT NULL DEFAULT '',
    wechat_notify_url VARCHAR(500) NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_platform_payment_settings_singleton CHECK (id = 1)
);

COMMENT ON TABLE platform_payment_settings IS '全站支付宝与微信支付配置，固定单行，由管理后台维护';
COMMENT ON COLUMN platform_payment_settings.id IS '固定单行标识';
COMMENT ON COLUMN platform_payment_settings.alipay_enabled IS '是否启用支付宝电脑网站支付';
COMMENT ON COLUMN platform_payment_settings.alipay_app_id IS '支付宝开放平台应用标识';
COMMENT ON COLUMN platform_payment_settings.alipay_private_key IS '加密后的支付宝应用私钥，空字符串表示未设置';
COMMENT ON COLUMN platform_payment_settings.alipay_public_key IS '支付宝公钥，空字符串表示未设置';
COMMENT ON COLUMN platform_payment_settings.alipay_gateway_url IS '支付宝网关地址，沙箱环境可改为沙箱网关';
COMMENT ON COLUMN platform_payment_settings.alipay_notify_url IS '支付宝异步通知地址';
COMMENT ON COLUMN platform_payment_settings.alipay_return_url IS '支付宝同步回跳地址';
COMMENT ON COLUMN platform_payment_settings.wechat_enabled IS '是否启用微信 Native 扫码支付';
COMMENT ON COLUMN platform_payment_settings.wechat_app_id IS '已与商户号绑定的微信应用标识';
COMMENT ON COLUMN platform_payment_settings.wechat_merchant_id IS '普通商户号';
COMMENT ON COLUMN platform_payment_settings.wechat_merchant_serial_number IS '商户 API 证书序列号';
COMMENT ON COLUMN platform_payment_settings.wechat_private_key IS '加密后的商户 API 私钥 PEM，空字符串表示未设置';
COMMENT ON COLUMN platform_payment_settings.wechat_api_v3_key IS '加密后的 APIv3 密钥，空字符串表示未设置';
COMMENT ON COLUMN platform_payment_settings.wechat_public_key IS '微信支付公钥 PEM，空字符串表示未设置';
COMMENT ON COLUMN platform_payment_settings.wechat_public_key_id IS '微信支付公钥 ID，以 PUB_KEY_ID_ 开头';
COMMENT ON COLUMN platform_payment_settings.wechat_notify_url IS '微信支付通知地址';
COMMENT ON COLUMN platform_payment_settings.created_at IS '创建时间';
COMMENT ON COLUMN platform_payment_settings.updated_at IS '更新时间';

INSERT INTO platform_payment_settings (id)
VALUES (1);

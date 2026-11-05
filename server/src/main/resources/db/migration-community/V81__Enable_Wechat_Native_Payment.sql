-- 微信 Native 支付继续使用已有订单表，新增后台待支付扫描的部分索引。
CREATE INDEX idx_credit_purchase_orders_wechat_pending
    ON credit_purchase_orders(id)
    WHERE status = 'pending' AND payment_method = 'wechat' AND wallet_team_id = 0;

COMMENT ON INDEX idx_credit_purchase_orders_wechat_pending IS '微信支付后台按主键分页核对平台待支付订单';
COMMENT ON COLUMN credit_purchase_orders.payment_method IS '支付方式：alipay支付宝、wechat微信Native扫码支付';

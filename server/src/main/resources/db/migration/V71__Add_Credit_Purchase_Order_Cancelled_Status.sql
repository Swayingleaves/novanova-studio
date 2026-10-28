-- 积分购买订单增加「用户主动取消」状态，与超时关闭（closed）区分展示。
ALTER TABLE credit_purchase_orders DROP CONSTRAINT ck_credit_purchase_orders_status;

ALTER TABLE credit_purchase_orders
    ADD CONSTRAINT ck_credit_purchase_orders_status
        CHECK (status IN ('pending', 'processing', 'paid', 'closed', 'cancelled'));

COMMENT ON COLUMN credit_purchase_orders.status IS '订单状态：pending待支付、processing处理中、paid已支付、closed已关闭、cancelled已取消';

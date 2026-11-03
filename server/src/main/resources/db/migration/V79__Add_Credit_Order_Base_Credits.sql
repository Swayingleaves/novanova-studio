-- 记录下单时的商品基础积分，用于在商品赠送与首充赠送之间取较大额度。
ALTER TABLE credit_purchase_orders
    ADD COLUMN base_credits NUMERIC(24,6) NOT NULL DEFAULT 0
        CONSTRAINT ck_credit_purchase_orders_base_credits CHECK (base_credits >= 0);

COMMENT ON COLUMN credit_purchase_orders.base_credits IS '下单时的商品基础积分快照，与 credits 的差额即商品自带赠送积分';

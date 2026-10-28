-- 为积分商品增加赠送积分配置。
ALTER TABLE credit_products
    ADD COLUMN bonus_credits NUMERIC(24,6) NOT NULL DEFAULT 0 CHECK (bonus_credits >= 0);

COMMENT ON COLUMN credit_products.bonus_credits IS '购买商品时额外赠送的积分数量，购买后与基础积分一起到账';

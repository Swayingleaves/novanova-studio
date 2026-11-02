-- 账号首笔已支付订单的赠送比例，以及该次赠送的发放记录。
ALTER TABLE platform_credit_settings
    ADD COLUMN first_purchase_bonus_percent NUMERIC(5,2) NOT NULL DEFAULT 0
        CONSTRAINT ck_platform_credit_settings_first_purchase_bonus_percent
        CHECK (first_purchase_bonus_percent >= 0 AND first_purchase_bonus_percent <= 100);

COMMENT ON COLUMN platform_credit_settings.first_purchase_bonus_percent IS '账号首笔已支付订单的赠送比例，单位百分数，0 表示关闭赠送；赠送积分=支付金额×10×比例/100';

ALTER TABLE credit_purchase_orders
    ADD COLUMN first_purchase_bonus_credits NUMERIC(24,6) NOT NULL DEFAULT 0
        CONSTRAINT ck_credit_purchase_orders_first_purchase_bonus_credits
        CHECK (first_purchase_bonus_credits >= 0);

COMMENT ON COLUMN credit_purchase_orders.first_purchase_bonus_credits IS '该订单实际发放的首充赠送积分，未获得时为 0';

-- 每个用户最多一条带赠送的订单，作为并发场景下的最终兜底。
CREATE UNIQUE INDEX uk_credit_purchase_orders_first_purchase_bonus
    ON credit_purchase_orders(user_id) WHERE first_purchase_bonus_credits > 0;

ALTER TABLE user_credit_transactions
    DROP CONSTRAINT ck_user_credit_transactions_type;

ALTER TABLE user_credit_transactions
    ADD CONSTRAINT ck_user_credit_transactions_type
        CHECK (transaction_type IN (
            'initial_grant', 'task_charge', 'task_refund', 'admin_adjustment', 'card_redeem',
            'invitation_reward', 'daily_check_in', 'credit_expired', 'storage_charge', 'storage_purchase',
            'credit_purchase', 'first_purchase_bonus'
        ));

COMMENT ON COLUMN user_credit_transactions.transaction_type IS '流水类型：initial_grant、task_charge、task_refund、admin_adjustment、card_redeem、invitation_reward、daily_check_in、credit_expired、storage_charge、storage_purchase、credit_purchase、first_purchase_bonus';

ALTER TABLE users
    ADD COLUMN first_purchase_bonus_notice_seen_at TIMESTAMPTZ;

COMMENT ON COLUMN users.first_purchase_bonus_notice_seen_at IS '首充赠送弹窗关闭时间，为空表示从未展示';

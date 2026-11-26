-- 失败任务再次查询成功后补扣已退积分。同一任务只能补扣一次。
ALTER TABLE user_credit_transactions
    DROP CONSTRAINT ck_user_credit_transactions_type;

ALTER TABLE user_credit_transactions
    ADD CONSTRAINT ck_user_credit_transactions_type
        CHECK (transaction_type IN (
            'initial_grant', 'task_charge', 'task_refund', 'task_requery_charge', 'admin_adjustment', 'card_redeem',
            'invitation_reward', 'daily_check_in', 'credit_expired', 'storage_charge', 'storage_purchase',
            'credit_purchase', 'first_purchase_bonus'
        ));

COMMENT ON COLUMN user_credit_transactions.transaction_type IS '流水类型：initial_grant、task_charge、task_refund、task_requery_charge、admin_adjustment、card_redeem、invitation_reward、daily_check_in、credit_expired、storage_charge、storage_purchase、credit_purchase、first_purchase_bonus';

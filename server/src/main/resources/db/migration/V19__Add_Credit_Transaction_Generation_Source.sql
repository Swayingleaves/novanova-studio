ALTER TABLE user_credit_transactions
    ADD COLUMN generation_source VARCHAR(30),
    ADD CONSTRAINT ck_user_credit_transactions_generation_source
        CHECK (generation_source IS NULL OR generation_source IN ('imagePage', 'videoPage', 'canvas'));

COMMENT ON COLUMN user_credit_transactions.generation_source IS '生成来源：imagePage、videoPage、canvas；历史流水为空';

CREATE INDEX idx_user_credit_transactions_consumption
    ON user_credit_transactions(user_id, created_at DESC, id DESC)
    WHERE transaction_type = 'task_charge';

ALTER TABLE user_credit_transactions
    DROP CONSTRAINT ck_user_credit_transactions_generation_source;

ALTER TABLE user_credit_transactions
    ADD CONSTRAINT ck_user_credit_transactions_generation_source
        CHECK (generation_source IS NULL OR generation_source IN ('imagePage', 'videoPage', 'canvas', 'storyboard'));

COMMENT ON COLUMN user_credit_transactions.generation_source IS '生成来源：imagePage、videoPage、canvas、storyboard；历史流水为空';

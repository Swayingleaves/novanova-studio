ALTER TABLE users
    ADD COLUMN invitation_code VARCHAR(16),
    ADD COLUMN invited_by_user_id BIGINT REFERENCES users(id);

UPDATE users
SET invitation_code = UPPER(SUBSTRING(MD5(id::TEXT || ':' || RANDOM()::TEXT || ':' || CLOCK_TIMESTAMP()::TEXT), 1, 16));

ALTER TABLE users
    ALTER COLUMN invitation_code SET NOT NULL,
    ADD CONSTRAINT uk_users_invitation_code UNIQUE (invitation_code),
    ADD CONSTRAINT ck_users_inviter_not_self CHECK (invited_by_user_id IS NULL OR invited_by_user_id <> id);

COMMENT ON COLUMN users.invitation_code IS '用户唯一邀请码，用于生成长期有效的专属邀请链接';
COMMENT ON COLUMN users.invited_by_user_id IS '邀请人用户ID，仅在受邀请用户首次注册时写入';

CREATE INDEX idx_users_invited_by_user_id ON users(invited_by_user_id) WHERE invited_by_user_id IS NOT NULL;

ALTER TABLE platform_credit_settings
    ADD COLUMN invitation_reward_credits INTEGER NOT NULL DEFAULT 0,
    ADD CONSTRAINT ck_platform_credit_settings_invitation_reward CHECK (invitation_reward_credits >= 0);

COMMENT ON COLUMN platform_credit_settings.invitation_reward_credits IS '邀请新用户完成注册后发放给邀请人的积分，0表示不发放';

ALTER TABLE user_credit_transactions
    ADD COLUMN invited_user_id BIGINT REFERENCES users(id);

ALTER TABLE user_credit_transactions
    DROP CONSTRAINT ck_user_credit_transactions_type;

ALTER TABLE user_credit_transactions
    ADD CONSTRAINT ck_user_credit_transactions_type
        CHECK (transaction_type IN ('initial_grant', 'task_charge', 'task_refund', 'admin_adjustment', 'card_redeem', 'invitation_reward')),
    ADD CONSTRAINT ck_user_credit_transactions_invitation_reward
        CHECK ((transaction_type = 'invitation_reward') = (invited_user_id IS NOT NULL)),
    ADD CONSTRAINT ck_user_credit_transactions_invitation_users
        CHECK (invited_user_id IS NULL OR invited_user_id <> user_id);

COMMENT ON COLUMN user_credit_transactions.transaction_type IS '流水类型：initial_grant、task_charge、task_refund、admin_adjustment、card_redeem、invitation_reward';
COMMENT ON COLUMN user_credit_transactions.invited_user_id IS '邀请奖励关联的被邀请新用户ID，仅邀请奖励流水使用';

CREATE UNIQUE INDEX uk_user_credit_transactions_invitation_reward
    ON user_credit_transactions(invited_user_id)
    WHERE transaction_type = 'invitation_reward';

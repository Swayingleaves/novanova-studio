CREATE INDEX idx_user_credit_transactions_charge_created
    ON user_credit_transactions(created_at DESC, id DESC)
    WHERE transaction_type = 'task_charge';

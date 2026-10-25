-- 邮箱后缀仅用于收件人搜索，发送任务按明确选择的用户创建收件快照。
ALTER TABLE email_campaigns DROP COLUMN email_domains;

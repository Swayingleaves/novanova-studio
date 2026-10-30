-- 保留创建时的邮箱后缀筛选，并为收件人域名精确匹配提供索引。
ALTER TABLE email_campaigns ADD COLUMN email_domains TEXT[] NOT NULL DEFAULT '{}';
COMMENT ON COLUMN email_campaigns.email_domains IS '创建时选择的邮箱完整域名，统一小写，空数组表示不限制，多个域名取并集';

CREATE INDEX idx_users_email_domain ON users (lower(split_part(btrim(email), '@', 2)))
    WHERE email IS NOT NULL AND btrim(email) <> '';

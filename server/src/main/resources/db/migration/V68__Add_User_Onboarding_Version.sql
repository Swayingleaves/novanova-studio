-- 已完成的产品引导版本，0 表示尚未完成；引导改版时递增版本号，使旧用户重新看到新引导。
ALTER TABLE users ADD COLUMN onboarding_version INTEGER NOT NULL DEFAULT 0;
COMMENT ON COLUMN users.onboarding_version IS '已完成的产品引导版本，0 表示尚未完成；引导改版时递增版本号，使旧用户重新看到新引导';

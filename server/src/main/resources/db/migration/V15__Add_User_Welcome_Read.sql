ALTER TABLE users ADD COLUMN welcome_read_at TIMESTAMPTZ;

COMMENT ON COLUMN users.welcome_read_at IS '欢迎引导已读时间，NULL表示未读';

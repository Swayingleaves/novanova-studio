-- 永久容量替代新月费，已有月费账单保留原路结清。
CREATE TABLE storage_capacity_settings (
    team_id BIGINT PRIMARY KEY REFERENCES teams(id),
    free_bytes BIGINT NOT NULL DEFAULT 3000000000 CHECK (free_bytes >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
COMMENT ON TABLE storage_capacity_settings IS '每个空间独立配置的个人永久免费存储容量';
COMMENT ON COLUMN storage_capacity_settings.team_id IS '空间标识，零表示平台';
COMMENT ON COLUMN storage_capacity_settings.free_bytes IS '每人的免费字节数，修改后对该空间所有用户生效';
COMMENT ON COLUMN storage_capacity_settings.updated_at IS '配置更新时间';
INSERT INTO storage_capacity_settings(team_id) SELECT id FROM teams;
CREATE FUNCTION initialize_storage_capacity_settings() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO storage_capacity_settings(team_id) VALUES (NEW.id);
    RETURN NEW;
END $$;
COMMENT ON FUNCTION initialize_storage_capacity_settings() IS '新空间自动获得每人三十亿字节的永久免费容量';
CREATE TRIGGER initialize_storage_capacity_settings AFTER INSERT ON teams FOR EACH ROW EXECUTE FUNCTION initialize_storage_capacity_settings();

CREATE TABLE user_storage_capacity_accounts (
    team_id BIGINT NOT NULL DEFAULT current_team_id() REFERENCES teams(id),
    user_id BIGINT NOT NULL REFERENCES users(id),
    purchased_bytes BIGINT NOT NULL DEFAULT 0 CHECK (purchased_bytes >= 0),
    PRIMARY KEY(team_id, user_id)
);
COMMENT ON TABLE user_storage_capacity_accounts IS '个人永久扩容账户，行锁串行化购买与上传预占，成员移除不清除已购容量';
COMMENT ON COLUMN user_storage_capacity_accounts.team_id IS '容量可用的业务空间';
COMMENT ON COLUMN user_storage_capacity_accounts.user_id IS '容量所属用户';
COMMENT ON COLUMN user_storage_capacity_accounts.purchased_bytes IS '已购买的永久容量字节数';

CREATE TABLE storage_capacity_packages (
    id VARCHAR(64) PRIMARY KEY,
    team_id BIGINT NOT NULL DEFAULT current_team_id() REFERENCES teams(id),
    name VARCHAR(100) NOT NULL CHECK (length(trim(name)) > 0),
    capacity_gigabytes INTEGER NOT NULL CHECK (capacity_gigabytes > 0),
    credits NUMERIC(24,6) NOT NULL CHECK (credits > 0),
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
COMMENT ON TABLE storage_capacity_packages IS '由存储提供方维护的固定容量永久扩容套餐';
COMMENT ON COLUMN storage_capacity_packages.id IS '套餐标识';
COMMENT ON COLUMN storage_capacity_packages.team_id IS '套餐提供方及扣款钱包，零表示平台';
COMMENT ON COLUMN storage_capacity_packages.name IS '套餐展示名称';
COMMENT ON COLUMN storage_capacity_packages.capacity_gigabytes IS '每次购买增加的整数G容量，一G为十亿字节';
COMMENT ON COLUMN storage_capacity_packages.credits IS '每次购买所需积分';
COMMENT ON COLUMN storage_capacity_packages.enabled IS '是否上架';
COMMENT ON COLUMN storage_capacity_packages.revision IS '套餐版本，防止用户按旧价误购';
COMMENT ON COLUMN storage_capacity_packages.updated_at IS '最后修改时间';
CREATE INDEX idx_storage_capacity_packages_owner ON storage_capacity_packages(team_id, enabled);

CREATE TABLE storage_capacity_purchases (
    id VARCHAR(64) PRIMARY KEY,
    team_id BIGINT NOT NULL DEFAULT current_team_id() REFERENCES teams(id),
    user_id BIGINT NOT NULL REFERENCES users(id),
    client_request_id VARCHAR(64) NOT NULL,
    package_id VARCHAR(64) NOT NULL REFERENCES storage_capacity_packages(id),
    package_revision INTEGER NOT NULL,
    wallet_team_id BIGINT NOT NULL REFERENCES teams(id),
    capacity_bytes BIGINT NOT NULL CHECK (capacity_bytes > 0),
    credits NUMERIC(24,6) NOT NULL CHECK (credits > 0),
    package_snapshot JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(team_id, user_id, client_request_id)
);
COMMENT ON TABLE storage_capacity_purchases IS '永久扩容购买快照及请求幂等记录，独立保留审计';
COMMENT ON COLUMN storage_capacity_purchases.id IS '购买标识及积分流水结算标识';
COMMENT ON COLUMN storage_capacity_purchases.team_id IS '本次容量生效的空间';
COMMENT ON COLUMN storage_capacity_purchases.user_id IS '购买用户';
COMMENT ON COLUMN storage_capacity_purchases.client_request_id IS '同一用户空间内唯一的购买请求标识';
COMMENT ON COLUMN storage_capacity_purchases.package_id IS '购买的套餐标识';
COMMENT ON COLUMN storage_capacity_purchases.package_revision IS '购买时套餐版本';
COMMENT ON COLUMN storage_capacity_purchases.wallet_team_id IS '实际扣款及收入归属钱包';
COMMENT ON COLUMN storage_capacity_purchases.capacity_bytes IS '本次增加的永久容量字节数';
COMMENT ON COLUMN storage_capacity_purchases.credits IS '实际支付积分';
COMMENT ON COLUMN storage_capacity_purchases.package_snapshot IS '原始套餐名称、容量、价格及版本快照';
COMMENT ON COLUMN storage_capacity_purchases.created_at IS '购买时间';

CREATE TABLE storage_upload_reservations (
    id VARCHAR(64) PRIMARY KEY,
    team_id BIGINT NOT NULL DEFAULT current_team_id() REFERENCES teams(id),
    user_id BIGINT NOT NULL REFERENCES users(id),
    storage_id VARCHAR(64) NOT NULL REFERENCES platform_object_storage_configs(storage_id),
    object_key TEXT NOT NULL,
    file_bytes BIGINT NOT NULL CHECK (file_bytes >= 0),
    reservation_status VARCHAR(20) NOT NULL DEFAULT 'uploading' CHECK (reservation_status IN ('uploading', 'cleanup')),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP + INTERVAL '1 hour',
    deletion_error TEXT,
    last_attempt_at TIMESTAMPTZ,
    FOREIGN KEY(team_id, user_id) REFERENCES user_storage_capacity_accounts(team_id, user_id),
    UNIQUE(storage_id, object_key)
);
COMMENT ON TABLE storage_upload_reservations IS '上传前持久化预占，失败或租约过期后确认物理删除才释放容量';
COMMENT ON COLUMN storage_upload_reservations.id IS '上传租约标识';
COMMENT ON COLUMN storage_upload_reservations.team_id IS '预占所属空间';
COMMENT ON COLUMN storage_upload_reservations.user_id IS '预占所属用户';
COMMENT ON COLUMN storage_upload_reservations.storage_id IS '实际对象存储配置';
COMMENT ON COLUMN storage_upload_reservations.object_key IS '预先确定的实际对象键';
COMMENT ON COLUMN storage_upload_reservations.file_bytes IS '服务端获取的真实文件字节数';
COMMENT ON COLUMN storage_upload_reservations.reservation_status IS 'uploading上传中、cleanup等待物理删除';
COMMENT ON COLUMN storage_upload_reservations.expires_at IS '租约到期时间，运行中的上传每分钟续租';
COMMENT ON COLUMN storage_upload_reservations.deletion_error IS '最近的物理删除错误';
COMMENT ON COLUMN storage_upload_reservations.last_attempt_at IS '最后清理时间，失败轮转重试';
CREATE INDEX idx_storage_reservations_account ON storage_upload_reservations(team_id, user_id);
CREATE INDEX idx_storage_reservations_cleanup ON storage_upload_reservations(last_attempt_at NULLS FIRST, expires_at);

DO $$
DECLARE table_name TEXT;
BEGIN
    FOREACH table_name IN ARRAY ARRAY['storage_capacity_settings', 'user_storage_capacity_accounts', 'storage_capacity_purchases', 'storage_upload_reservations'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
        EXECUTE format('CREATE POLICY capacity_space_scope ON %I USING (team_system_access() OR team_id = current_team_id()) WITH CHECK (team_system_access() OR team_id = current_team_id())', table_name);
    END LOOP;
END $$;
ALTER TABLE storage_capacity_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage_capacity_packages FORCE ROW LEVEL SECURITY;
CREATE POLICY capacity_package_read ON storage_capacity_packages FOR SELECT USING (
    team_system_access() OR team_id = current_team_id() OR (team_id = 0 AND EXISTS (
        SELECT 1 FROM team_resource_grants WHERE team_id = current_team_id() AND resource_type = 'objectStorage'
    ))
);
CREATE POLICY capacity_package_write ON storage_capacity_packages FOR ALL USING (team_system_access() OR team_id = current_team_id())
    WITH CHECK (team_system_access() OR team_id = current_team_id());
ALTER TABLE user_credit_transactions DROP CONSTRAINT ck_user_credit_transactions_type;
ALTER TABLE user_credit_transactions ADD CONSTRAINT ck_user_credit_transactions_type CHECK (transaction_type IN (
    'initial_grant', 'task_charge', 'task_refund', 'admin_adjustment', 'card_redeem', 'invitation_reward',
    'daily_check_in', 'credit_expired', 'storage_charge', 'storage_purchase'));

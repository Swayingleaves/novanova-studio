-- 所有积分统一为六位小数，历史整数精确转换，不存在双写账户。
CREATE FUNCTION current_admin_team_filter() RETURNS BIGINT LANGUAGE sql STABLE AS $$
    SELECT COALESCE(NULLIF(current_setting('novanova.filter_team_id', TRUE), ''), '-1')::BIGINT
$$;
COMMENT ON FUNCTION current_admin_team_filter() IS '超级管理员的团队统计筛选，负一表示不限团队，不能用作成员鉴权';
CREATE UNIQUE INDEX uk_team_pending_invitation ON team_invitations(team_id, email) WHERE invitation_status = 'pending';
ALTER TABLE team_resource_preferences ADD COLUMN model_type VARCHAR(16) NOT NULL DEFAULT '';
COMMENT ON COLUMN team_resource_preferences.model_type IS '默认模型所属能力类型，对象存储为空字符串';
CREATE UNIQUE INDEX uk_team_default_model ON team_resource_preferences(team_id, model_type) WHERE resource_type = 'model' AND is_default;
ALTER TABLE team_resource_preferences ADD CONSTRAINT ck_team_default_enabled CHECK(NOT is_default OR enabled);
ALTER TABLE user_notification_reads DROP CONSTRAINT uk_user_notification_read;
ALTER TABLE user_notification_reads ADD CONSTRAINT uk_user_notification_read UNIQUE(team_id, user_id, notification_id);
ALTER TABLE script_source_documents DROP CONSTRAINT uq_script_source_request;
ALTER TABLE script_source_documents ADD CONSTRAINT uq_script_source_request UNIQUE(team_id, user_id, client_request_id);
ALTER TABLE story_bible_analysis_jobs DROP CONSTRAINT uq_story_bible_job_request;
ALTER TABLE story_bible_analysis_jobs ADD CONSTRAINT uq_story_bible_job_request UNIQUE(team_id, user_id, client_request_id);
ALTER TABLE novel_adaptation_jobs DROP CONSTRAINT uq_novel_adaptation_job_request;
ALTER TABLE novel_adaptation_jobs ADD CONSTRAINT uq_novel_adaptation_job_request UNIQUE(team_id, user_id, client_request_id);
DO $$
DECLARE amount_column RECORD;
BEGIN
    FOR amount_column IN SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND data_type IN ('integer', 'bigint') AND (
            column_name IN ('credit_cost', 'credit_balance', 'change_amount', 'balance_after', 'credits', 'granted_amount', 'remaining_amount', 'unit_price')
            OR column_name LIKE '%\_credits' ESCAPE '\'
        ) LOOP
        EXECUTE format('ALTER TABLE %I ALTER COLUMN %I TYPE NUMERIC(24,6) USING %I::NUMERIC(24,6)',
            amount_column.table_name, amount_column.column_name, amount_column.column_name);
    END LOOP;
END $$;

ALTER TABLE user_credit_accounts ADD COLUMN team_id BIGINT NOT NULL DEFAULT current_wallet_team_id() REFERENCES teams(id);
ALTER TABLE user_credit_accounts ADD COLUMN frozen BOOLEAN NOT NULL DEFAULT FALSE;
COMMENT ON COLUMN user_credit_accounts.team_id IS '钱包归属，零为跨团队通用的平台钱包，其他为独立团队钱包';
COMMENT ON COLUMN user_credit_accounts.frozen IS '是否因成员移除而冻结，冻结后只允许历史结算和退款';
ALTER TABLE user_credit_accounts DROP CONSTRAINT user_credit_accounts_pkey;
ALTER TABLE user_credit_accounts ADD PRIMARY KEY(user_id, team_id);
ALTER TABLE user_credit_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_credit_accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY wallet_scope ON user_credit_accounts USING (team_system_access() OR team_id IN (0, current_team_id()))
    WITH CHECK (team_system_access() OR team_id IN (0, current_team_id()));

ALTER TABLE user_credit_transactions ADD COLUMN team_id BIGINT NOT NULL DEFAULT current_team_id() REFERENCES teams(id);
ALTER TABLE user_credit_transactions ADD COLUMN wallet_team_id BIGINT NOT NULL DEFAULT current_wallet_team_id() REFERENCES teams(id);
ALTER TABLE user_credit_transactions ADD COLUMN beneficiary_team_id BIGINT NOT NULL DEFAULT current_wallet_team_id() REFERENCES teams(id);
ALTER TABLE user_credit_transactions ADD COLUMN resource_id VARCHAR(64);
ALTER TABLE user_credit_transactions ADD COLUMN billing_reference VARCHAR(100);
COMMENT ON COLUMN user_credit_transactions.team_id IS '消费或管理操作实际发生的空间，历史统计不依赖当前成员关系';
COMMENT ON COLUMN user_credit_transactions.wallet_team_id IS '实际发生变动的钱包归属，退款返回原钱包';
COMMENT ON COLUMN user_credit_transactions.beneficiary_team_id IS '实际扣款的收入归属，零表示平台，发放不计收入';
COMMENT ON COLUMN user_credit_transactions.resource_id IS '扣费对应的模型或对象存储配置标识';
COMMENT ON COLUMN user_credit_transactions.billing_reference IS '存储账单等业务的唯一结算标识';
ALTER TABLE user_credit_transactions DROP CONSTRAINT ck_user_credit_transactions_type;
ALTER TABLE user_credit_transactions ADD CONSTRAINT ck_user_credit_transactions_type CHECK (transaction_type IN (
    'initial_grant', 'task_charge', 'task_refund', 'admin_adjustment', 'card_redeem', 'invitation_reward',
    'daily_check_in', 'credit_expired', 'storage_charge'));
CREATE UNIQUE INDEX uk_credit_billing_reference ON user_credit_transactions(billing_reference) WHERE billing_reference IS NOT NULL;
CREATE INDEX idx_team_credit_created ON user_credit_transactions(team_id, created_at DESC, id DESC);
ALTER TABLE user_credit_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_credit_transactions FORCE ROW LEVEL SECURITY;
CREATE POLICY ledger_scope ON user_credit_transactions USING (team_system_access() OR team_id = current_team_id())
    WITH CHECK (team_system_access() OR team_id = current_team_id());

ALTER TABLE user_credit_grants ADD COLUMN team_id BIGINT NOT NULL DEFAULT 0 REFERENCES teams(id);
COMMENT ON COLUMN user_credit_grants.team_id IS '过期积分所属钱包，团队首期不发放活动积分，固定为平台钱包';
ALTER TABLE user_credit_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_credit_grants FORCE ROW LEVEL SECURITY;
CREATE POLICY grant_wallet_scope ON user_credit_grants USING (team_system_access() OR team_id IN (0, current_team_id()))
    WITH CHECK (team_system_access() OR team_id IN (0, current_team_id()));

CREATE TABLE storage_billing_rates (
    storage_id VARCHAR(64) NOT NULL REFERENCES platform_object_storage_configs(storage_id),
    effective_at TIMESTAMPTZ NOT NULL,
    credits_per_gigabyte_month NUMERIC(24,6) NOT NULL CHECK (credits_per_gigabyte_month >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(storage_id, effective_at)
);
COMMENT ON TABLE storage_billing_rates IS '显式启用并按生效日期保存的存储费率，下月改价不覆盖历史';
COMMENT ON COLUMN storage_billing_rates.storage_id IS '对象存储配置标识';
COMMENT ON COLUMN storage_billing_rates.effective_at IS '费率生效时间，首期启用后不补收历史费用';
COMMENT ON COLUMN storage_billing_rates.credits_per_gigabyte_month IS '每十亿字节存储一个自然月所需积分';
COMMENT ON COLUMN storage_billing_rates.created_at IS '费率设置时间';

CREATE TABLE storage_objects (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    team_id BIGINT NOT NULL DEFAULT current_team_id() REFERENCES teams(id),
    user_id BIGINT NOT NULL REFERENCES users(id),
    storage_id VARCHAR(64) NOT NULL REFERENCES platform_object_storage_configs(storage_id),
    owner_team_id BIGINT NOT NULL REFERENCES teams(id),
    object_key TEXT NOT NULL,
    file_bytes BIGINT NOT NULL CHECK (file_bytes >= 0),
    stored_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deletion_requested_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    deletion_error TEXT,
    deletion_last_attempt_at TIMESTAMPTZ,
    UNIQUE(storage_id, object_key)
);
COMMENT ON TABLE storage_objects IS '实际对象台账，同一个对象的多处业务引用不重复计量';
COMMENT ON COLUMN storage_objects.id IS '实际对象标识';
COMMENT ON COLUMN storage_objects.team_id IS '文件所属业务空间';
COMMENT ON COLUMN storage_objects.user_id IS '文件所属用户';
COMMENT ON COLUMN storage_objects.storage_id IS '实际存储配置标识';
COMMENT ON COLUMN storage_objects.owner_team_id IS '存储提供方与实际扣费钱包归属';
COMMENT ON COLUMN storage_objects.object_key IS '存储桶中的实际对象键';
COMMENT ON COLUMN storage_objects.file_bytes IS '文件实际大小，单位字节';
COMMENT ON COLUMN storage_objects.stored_at IS '对象写入确认时间';
COMMENT ON COLUMN storage_objects.deletion_requested_at IS '请求物理删除的时间';
COMMENT ON COLUMN storage_objects.deleted_at IS '物理删除确认时间，空表示仍占用空间';
COMMENT ON COLUMN storage_objects.deletion_error IS '最近物理删除错误，保留后续重试';
COMMENT ON COLUMN storage_objects.deletion_last_attempt_at IS '最近物理删除尝试时间，重试轮转避免失败对象阻塞其他清理';
CREATE INDEX idx_storage_objects_user_scope ON storage_objects(team_id, user_id, stored_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_storage_objects_pending_delete ON storage_objects(deletion_last_attempt_at NULLS FIRST, id) WHERE deletion_requested_at IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE media_files ADD COLUMN object_storage_config_id VARCHAR(64) REFERENCES platform_object_storage_configs(storage_id);
COMMENT ON COLUMN media_files.object_storage_config_id IS '实际上传使用的对象存储配置，远程链接为空，历史歧义由管理员明确确认';
CREATE INDEX idx_media_storage_unregistered ON media_files(team_id, object_storage_provider, bucket, region) WHERE object_storage_key IS NOT NULL AND object_storage_config_id IS NULL;

-- 原文保存了明确配置，媒体仅在完整存储身份唯一时登记；歧义不会静默指定收费方。
INSERT INTO storage_objects(team_id, user_id, storage_id, owner_team_id, object_key, file_bytes, stored_at)
SELECT documents.team_id, documents.user_id, storages.storage_id, storages.team_id, documents.object_key, documents.file_bytes, documents.created_at
FROM script_source_documents documents JOIN platform_object_storage_configs storages ON storages.storage_id = documents.storage_config_id
ON CONFLICT(storage_id, object_key) DO NOTHING;
WITH unique_storage AS (
    SELECT provider, bucket, region, MIN(storage_id) storage_id FROM platform_object_storage_configs
    WHERE team_id = 0 GROUP BY provider, bucket, region HAVING COUNT(*) = 1
)
UPDATE media_files media SET object_storage_config_id = storages.storage_id FROM unique_storage storages
WHERE media.object_storage_provider = storages.provider AND media.bucket = storages.bucket AND media.region = storages.region
  AND NULLIF(media.object_storage_key, '') IS NOT NULL AND media.team_id = 0;
INSERT INTO storage_objects(team_id, user_id, storage_id, owner_team_id, object_key, file_bytes, stored_at, deletion_requested_at)
SELECT DISTINCT ON(media.object_storage_config_id, media.object_storage_key) media.team_id, media.user_id, media.object_storage_config_id,
    storages.team_id, media.object_storage_key, media.bytes, media.created_at, CASE WHEN media.status = 0 THEN CURRENT_TIMESTAMP ELSE NULL END
FROM media_files media JOIN platform_object_storage_configs storages ON storages.storage_id = media.object_storage_config_id
ORDER BY media.object_storage_config_id, media.object_storage_key, media.created_at
ON CONFLICT(storage_id, object_key) DO NOTHING;
CREATE FUNCTION link_media_storage_object() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NULLIF(NEW.object_storage_key, '') IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM storage_objects WHERE storage_id = NEW.object_storage_config_id
            AND team_id = NEW.team_id AND user_id = NEW.user_id AND object_key = NEW.object_storage_key)
        THEN RAISE EXCEPTION '实际存储对象尚未登记或不属于当前用户空间' USING ERRCODE = '23514'; END IF;
    END IF;
    RETURN NEW;
END $$;
COMMENT ON FUNCTION link_media_storage_object() IS '媒体写入关联已登记实际对象，保留准确配置供物理删除与计量';
CREATE TRIGGER link_media_storage_object BEFORE INSERT OR UPDATE OF object_storage_key ON media_files FOR EACH ROW EXECUTE FUNCTION link_media_storage_object();

CREATE TABLE storage_bills (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    team_id BIGINT NOT NULL REFERENCES teams(id),
    user_id BIGINT NOT NULL REFERENCES users(id),
    owner_team_id BIGINT NOT NULL REFERENCES teams(id),
    billing_month DATE NOT NULL,
    credits NUMERIC(24,6) NOT NULL CHECK (credits >= 0),
    bill_status VARCHAR(20) NOT NULL DEFAULT 'unpaid' CHECK (bill_status IN ('unpaid', 'paid')),
    usage_details JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    paid_at TIMESTAMPTZ,
    UNIQUE(team_id, user_id, owner_team_id, billing_month)
);
COMMENT ON TABLE storage_bills IS '按用户、发生空间和收费方汇总的自然月账单，唯一约束防止重复出账';
COMMENT ON COLUMN storage_bills.id IS '账单标识';
COMMENT ON COLUMN storage_bills.team_id IS '费用发生空间';
COMMENT ON COLUMN storage_bills.user_id IS '应付用户';
COMMENT ON COLUMN storage_bills.owner_team_id IS '费用扣款钱包与收入归属';
COMMENT ON COLUMN storage_bills.billing_month IS '结算自然月的第一日';
COMMENT ON COLUMN storage_bills.credits IS '汇总并四舍五入至六位小数的应付积分';
COMMENT ON COLUMN storage_bills.bill_status IS '账单状态：unpaid待支付、paid已支付';
COMMENT ON COLUMN storage_bills.usage_details IS '实际对象、占用时长和有效费率的账单快照';
COMMENT ON COLUMN storage_bills.created_at IS '出账时间';
COMMENT ON COLUMN storage_bills.paid_at IS '实际扣款时间';
CREATE INDEX idx_storage_bills_debt ON storage_bills(user_id, owner_team_id, billing_month, id) WHERE bill_status = 'unpaid';

CREATE TABLE team_member_cleanup_jobs (
    team_id BIGINT NOT NULL REFERENCES teams(id),
    user_id BIGINT NOT NULL REFERENCES users(id),
    requested_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMPTZ,
    last_error TEXT,
    last_attempt_at TIMESTAMPTZ,
    PRIMARY KEY(team_id, user_id)
);
COMMENT ON TABLE team_member_cleanup_jobs IS '成员移除后的持久化清理任务，禁止清理尚未完成时重新加入';
COMMENT ON COLUMN team_member_cleanup_jobs.team_id IS '需要清理的团队';
COMMENT ON COLUMN team_member_cleanup_jobs.user_id IS '需要清理的成员';
COMMENT ON COLUMN team_member_cleanup_jobs.requested_at IS '清理请求时间';
COMMENT ON COLUMN team_member_cleanup_jobs.completed_at IS '业务内容与实际对象全部清理完成的时间';
COMMENT ON COLUMN team_member_cleanup_jobs.last_error IS '最近清理错误';
COMMENT ON COLUMN team_member_cleanup_jobs.last_attempt_at IS '最近尝试时间，失败任务轮转重试';
CREATE INDEX idx_member_cleanup_pending ON team_member_cleanup_jobs(last_attempt_at NULLS FIRST, requested_at) WHERE completed_at IS NULL;

ALTER TABLE ai_generation_tasks ADD COLUMN resource_owner_team_id BIGINT NOT NULL DEFAULT 0 REFERENCES teams(id);
ALTER TABLE ai_generation_tasks ADD COLUMN data_purged BOOLEAN NOT NULL DEFAULT FALSE;
COMMENT ON COLUMN ai_generation_tasks.data_purged IS '成员移除后创作请求及结果已清理，仅保留账本关联审计字段';
COMMENT ON COLUMN ai_generation_tasks.resource_owner_team_id IS '创建时模型提供方快照，用于原钱包扣费与退款';
ALTER TABLE ai_generation_tasks ADD COLUMN storage_id_snapshot VARCHAR(64);
ALTER TABLE video_composition_tasks ADD COLUMN storage_id_snapshot VARCHAR(64);
ALTER TABLE creation_agent_request ADD COLUMN storage_id_snapshot VARCHAR(64);
ALTER TABLE ai_generation_tasks ADD CONSTRAINT fk_ai_task_storage_snapshot FOREIGN KEY(storage_id_snapshot) REFERENCES platform_object_storage_configs(storage_id);
ALTER TABLE video_composition_tasks ADD CONSTRAINT fk_video_task_storage_snapshot FOREIGN KEY(storage_id_snapshot) REFERENCES platform_object_storage_configs(storage_id);
COMMENT ON COLUMN ai_generation_tasks.storage_id_snapshot IS '创建任务时选择的对象存储，后续修改默认项不改变该任务';
COMMENT ON COLUMN video_composition_tasks.storage_id_snapshot IS '创建合成任务时选择的对象存储配置标识';
COMMENT ON COLUMN creation_agent_request.storage_id_snapshot IS '创建主Agent请求时的对象存储，后续派生任务沿用';
CREATE FUNCTION capture_task_resources() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    SELECT storage_id INTO NEW.storage_id_snapshot FROM platform_object_storage_configs storages WHERE status = 1
      AND (storage_id = NULLIF(current_setting('novanova.storage_snapshot', TRUE), '')
        OR (NULLIF(current_setting('novanova.storage_snapshot', TRUE), '') IS NULL AND ((NEW.team_id = 0 AND storages.team_id = 0 AND is_default) OR (NEW.team_id > 0 AND EXISTS (
        SELECT 1 FROM team_resource_preferences preferences WHERE preferences.team_id = NEW.team_id
        AND resource_type = 'objectStorage' AND resource_id = storage_id AND enabled AND preferences.is_default))))) LIMIT 1;
    IF TG_TABLE_NAME = 'ai_generation_tasks' THEN
        SELECT team_id INTO NEW.resource_owner_team_id FROM platform_ai_model_configs WHERE model_config_id = NEW.model_config_id;
        NEW.resource_owner_team_id := COALESCE(NEW.resource_owner_team_id, 0);
    END IF;
    RETURN NEW;
END $$;
COMMENT ON FUNCTION capture_task_resources() IS '在创建事务中固定模型提供方和默认对象存储';
CREATE TRIGGER capture_task_resources BEFORE INSERT ON ai_generation_tasks FOR EACH ROW EXECUTE FUNCTION capture_task_resources();
CREATE TRIGGER capture_task_resources BEFORE INSERT ON video_composition_tasks FOR EACH ROW EXECUTE FUNCTION capture_task_resources();
CREATE TRIGGER capture_task_resources BEFORE INSERT ON creation_agent_request FOR EACH ROW EXECUTE FUNCTION capture_task_resources();

-- 专项文本价格跟随获授权的平台模型只读开放，不能由团队另建平台模型的价格。
CREATE POLICY granted_story_bible_pricing ON story_bible_pricing FOR SELECT USING (
    team_id = 0 AND EXISTS (SELECT 1 FROM platform_ai_model_configs models WHERE models.model_config_id = story_bible_pricing.model_config_id));
CREATE POLICY granted_episode_bodies_pricing ON episode_bodies_pricing FOR SELECT USING (
    team_id = 0 AND EXISTS (SELECT 1 FROM platform_ai_model_configs models WHERE models.model_config_id = episode_bodies_pricing.model_config_id));
CREATE FUNCTION check_pricing_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM platform_ai_model_configs models WHERE models.model_config_id = NEW.model_config_id AND models.team_id = NEW.team_id)
    THEN RAISE EXCEPTION '只能配置自有模型的专项价格' USING ERRCODE = '23514'; END IF;
    RETURN NEW;
END $$;
COMMENT ON FUNCTION check_pricing_owner() IS '专项价格只能由模型所属空间配置，团队不能覆盖平台模型定价';
CREATE TRIGGER check_pricing_owner BEFORE INSERT OR UPDATE ON story_bible_pricing FOR EACH ROW EXECUTE FUNCTION check_pricing_owner();
CREATE TRIGGER check_pricing_owner BEFORE INSERT OR UPDATE ON episode_bodies_pricing FOR EACH ROW EXECUTE FUNCTION check_pricing_owner();

CREATE FUNCTION enforce_team_member_limit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE maximum_members INTEGER;
BEGIN
    IF NEW.member_role = 'member' AND NEW.member_status <> 'removed' THEN
        SELECT member_limit INTO maximum_members FROM teams WHERE id = NEW.team_id FOR UPDATE;
        IF (SELECT COUNT(*) FROM team_members WHERE team_id = NEW.team_id AND user_id <> NEW.user_id
            AND member_role = 'member' AND member_status <> 'removed') >= maximum_members
        THEN RAISE EXCEPTION '团队子账号数量已达到上限' USING ERRCODE = '23514'; END IF;
    END IF;
    RETURN NEW;
END $$;
COMMENT ON FUNCTION enforce_team_member_limit() IS '成员写入持有团队行锁，数据库同时保护并发接受邀请与直接创建账号';
CREATE TRIGGER enforce_team_member_limit BEFORE INSERT OR UPDATE ON team_members FOR EACH ROW EXECUTE FUNCTION enforce_team_member_limit();

CREATE FUNCTION protect_occupied_storage_location() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF (NEW.provider, NEW.bucket, NEW.region, NEW.endpoint) IS DISTINCT FROM (OLD.provider, OLD.bucket, OLD.region, OLD.endpoint)
      AND EXISTS (SELECT 1 FROM storage_objects WHERE storage_id = OLD.storage_id AND deleted_at IS NULL)
    THEN RAISE EXCEPTION '存储仍有实际对象，请新增配置，不能更改原存储位置' USING ERRCODE = '23514'; END IF;
    RETURN NEW;
END $$;
COMMENT ON FUNCTION protect_occupied_storage_location() IS '防止修改存储位置使实际对象无法删除或计量，密钥可以正常轮换';
CREATE TRIGGER protect_occupied_storage_location BEFORE UPDATE ON platform_object_storage_configs FOR EACH ROW EXECUTE FUNCTION protect_occupied_storage_location();

CREATE FUNCTION prevent_removed_member_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE member_user BIGINT;
BEGIN
    member_user := (to_jsonb(NEW)->>'user_id')::BIGINT;
    IF NEW.team_id > 0 AND member_user IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM team_members WHERE team_id = NEW.team_id AND user_id = member_user AND member_status <> 'removed'
    ) THEN RAISE EXCEPTION '团队成员已停用，禁止新增业务数据' USING ERRCODE = '23514'; END IF;
    RETURN NEW;
END $$;
COMMENT ON FUNCTION prevent_removed_member_insert() IS '阻止成员移除之后仍在收尾的后台任务重新写入私有创作内容';
DO $$
DECLARE item RECORD;
BEGIN
    FOR item IN SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'team_id'
        AND table_name NOT IN ('user_credit_accounts', 'user_credit_transactions', 'user_credit_grants', 'storage_objects', 'storage_bills',
          'team_members', 'team_invitations', 'team_resource_grants', 'team_configuration_modes', 'team_resource_preferences', 'team_disabled_periods', 'team_member_cleanup_jobs')
        AND EXISTS (SELECT 1 FROM information_schema.columns user_columns WHERE user_columns.table_schema = 'public' AND user_columns.table_name = columns.table_name AND column_name = 'user_id')
    LOOP
        EXECUTE format('CREATE TRIGGER prevent_removed_member_insert BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION prevent_removed_member_insert()', item.table_name);
    END LOOP;
END $$;

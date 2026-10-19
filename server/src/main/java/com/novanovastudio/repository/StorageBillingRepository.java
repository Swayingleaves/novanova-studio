package com.novanovastudio.repository;

import com.alibaba.fastjson2.JSONObject;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.r2dbc.core.DatabaseClient;
import org.springframework.stereotype.Repository;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * 存储实际对象、有效费率和自然月账单的数据访问。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-18 10:00
 */
@Repository
@RequiredArgsConstructor
public class StorageBillingRepository {
    /** 数据库客户端。 */
    private final DatabaseClient databaseClient;
    /** 列表字段转换。 */
    private final TeamRepository teamRepository;

    /**
     * 判断成员在当前空间是否有欠费。
     * @param userId 用户标识
     * @param teamId 空间标识
     * @return 是否存在欠费
     */
    public Mono<Boolean> hasDebt(long userId, long teamId) {
        return databaseClient.sql("SELECT EXISTS(SELECT 1 FROM storage_bills WHERE user_id = :userId AND team_id = :teamId AND bill_status = 'unpaid' AND credits > 0) debt")
                .bind("userId", userId).bind("teamId", teamId).map((row, metadata) -> row.get("debt", Boolean.class)).one();
    }

    /**
     * 登记已经实际存储的对象，相同对象键不重复计量。
     * @param userId 文件所属用户
     * @param teamId 业务空间
     * @param storageId 存储配置
     * @param objectKey 实际对象键
     * @param bytes 实际大小
     * @return 完成信号
     */
    public Mono<Void> register(long userId, long teamId, String storageId, String objectKey, long bytes) {
        return databaseClient.sql("""
                INSERT INTO storage_objects(team_id, user_id, storage_id, owner_team_id, object_key, file_bytes)
                SELECT :teamId, :userId, storage_id, team_id, :key, :bytes FROM platform_object_storage_configs WHERE storage_id = :storageId
                ON CONFLICT(storage_id, object_key) DO NOTHING
                """).bind("teamId", teamId).bind("userId", userId).bind("storageId", storageId).bind("key", objectKey).bind("bytes", bytes)
                .fetch().rowsUpdated()
                .then(databaseClient.sql("UPDATE storage_objects SET deletion_requested_at = CURRENT_TIMESTAMP WHERE storage_id = :storageId AND object_key = :key AND team_id > 0 AND EXISTS (SELECT 1 FROM team_members members WHERE members.team_id = storage_objects.team_id AND members.user_id = storage_objects.user_id AND member_status = 'removed')")
                        .bind("storageId", storageId).bind("key", objectKey).fetch().rowsUpdated())
                .then().contextWrite(context -> context.put(com.novanovastudio.security.TeamScope.SYSTEM_KEY, true));
    }

    /**
     * 保存费率版本，不覆盖已开始的历史费率。
     * @param storageId 存储配置
     * @param effectiveAt 生效时间
     * @param rate 每GB月积分
     * @return 完成信号
     */
    public Mono<Void> saveRate(String storageId, OffsetDateTime effectiveAt, BigDecimal rate) {
        return databaseClient.sql("INSERT INTO storage_billing_rates(storage_id, effective_at, credits_per_gigabyte_month) VALUES (:id, :effective, :rate) ON CONFLICT(storage_id, effective_at) DO UPDATE SET credits_per_gigabyte_month = EXCLUDED.credits_per_gigabyte_month WHERE storage_billing_rates.effective_at > CURRENT_TIMESTAMP")
                .bind("id", storageId).bind("effective", effectiveAt).bind("rate", rate).fetch().rowsUpdated().then();
    }

    /**
     * 读取可见资源的费率历史。
     * @return 费率版本
     */
    public Flux<JSONObject> listRates() {
        return teamRepository.query("SELECT rates.storage_id, rates.effective_at, rates.credits_per_gigabyte_month::TEXT credits_per_gigabyte_month FROM storage_billing_rates rates JOIN platform_object_storage_configs storages ON storages.storage_id = rates.storage_id ORDER BY rates.effective_at DESC", Map.of());
    }

    /**
     * 列出历史存储身份尚未确认的用量分组，不返回成员私有内容。
     * @return 待确认存储分组
     */
    public Flux<JSONObject> unregisteredStorageGroups() {
        return teamRepository.query("SELECT object_storage_provider provider, bucket, region, COUNT(*) object_count, SUM(bytes)::TEXT file_bytes FROM media_files WHERE object_storage_config_id IS NULL AND NULLIF(object_storage_key, '') IS NOT NULL GROUP BY object_storage_provider, bucket, region", Map.of());
    }

    /**
     * 计费启用前确认历史文件不存在配置歧义。
     * @param storageId 待启用资源
     * @return 是否仍有待确认文件
     */
    public Mono<Boolean> hasUnregisteredMedia(String storageId) {
        return databaseClient.sql("SELECT EXISTS(SELECT 1 FROM media_files media JOIN platform_object_storage_configs storages ON storages.provider = media.object_storage_provider AND storages.bucket = media.bucket AND storages.region = media.region WHERE storages.storage_id = :storage AND media.object_storage_config_id IS NULL AND NULLIF(media.object_storage_key, '') IS NOT NULL) missing")
                .bind("storage", storageId).map((row, metadata) -> row.get("missing", Boolean.class)).one();
    }

    /**
     * 管理员明确指定历史存储身份对应的配置后补录对象台账。
     * @param storageId 管理员确认的配置
     * @return 完成信号
     */
    public Mono<Void> registerExistingMedia(String storageId) {
        return databaseClient.sql("UPDATE media_files media SET object_storage_config_id = storages.storage_id FROM platform_object_storage_configs storages WHERE storage_id = :storage AND media.team_id = storages.team_id AND media.object_storage_config_id IS NULL AND NULLIF(media.object_storage_key, '') IS NOT NULL AND media.object_storage_provider = storages.provider AND media.bucket = storages.bucket AND media.region = storages.region")
                .bind("storage", storageId).fetch().rowsUpdated()
                .then(databaseClient.sql("""
                    INSERT INTO storage_objects(team_id, user_id, storage_id, owner_team_id, object_key, file_bytes, stored_at, deletion_requested_at)
                    SELECT DISTINCT ON(media.object_storage_key) media.team_id, media.user_id, media.object_storage_config_id, storages.team_id,
                        media.object_storage_key, media.bytes, media.created_at, CASE WHEN media.status = 0 THEN CURRENT_TIMESTAMP ELSE NULL END
                    FROM media_files media JOIN platform_object_storage_configs storages ON storages.storage_id = media.object_storage_config_id
                    WHERE storages.storage_id = :storage ORDER BY media.object_storage_key, media.created_at
                    ON CONFLICT(storage_id, object_key) DO NOTHING
                    """).bind("storage", storageId).fetch().rowsUpdated()).then();
    }

    /**
     * 查询用户或团队的账单，调用者已经验证管理员权限。
     * @param teamId 发生空间
     * @param userId 用户标识，负一表示当前团队全部
     * @return 最近账单
     */
    public Flux<JSONObject> listBills(long teamId, long userId) {
        return teamRepository.query("SELECT id, user_id, team_id, owner_team_id, billing_month, credits::TEXT credits, bill_status, usage_details::TEXT usage_details, paid_at FROM storage_bills WHERE team_id = :teamId AND (:userId = -1 OR user_id = :userId) ORDER BY billing_month DESC, id DESC LIMIT 200", Map.of("teamId", teamId, "userId", userId));
    }

    /**
     * 查询实际文件占用，不包含只登记远程地址的记录。
     * @param teamId 业务空间
     * @param userId 用户标识，负一表示当前团队全部
     * @return 文件和字节汇总
     */
    public Flux<JSONObject> usage(long teamId, long userId) {
        return teamRepository.query("SELECT storage_id, owner_team_id, COUNT(*) object_count, SUM(file_bytes)::TEXT file_bytes FROM storage_objects WHERE team_id = :teamId AND (:userId = -1 OR user_id = :userId) AND deleted_at IS NULL GROUP BY storage_id, owner_team_id", Map.of("teamId", teamId, "userId", userId));
    }

    /**
     * 补结所有已结束自然月；金额按整月与收费方汇总后才取六位小数。
     * @return 新建账单数量
     */
    public Mono<Long> createMonthlyBills() {
        return databaseClient.sql("""
                WITH rate_periods AS (
                    SELECT rates.*, LEAD(effective_at, 1, 'infinity'::timestamptz) OVER(PARTITION BY storage_id ORDER BY effective_at) expires_at
                    FROM storage_billing_rates rates
                ), months AS (
                    SELECT month_start::DATE billing_month,
                        month_start AT TIME ZONE 'Asia/Shanghai' starts_at,
                        (month_start + INTERVAL '1 month') AT TIME ZONE 'Asia/Shanghai' ends_at
                    FROM generate_series(
                        (SELECT DATE_TRUNC('month', MIN(effective_at) AT TIME ZONE 'Asia/Shanghai') FROM storage_billing_rates),
                        DATE_TRUNC('month', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai') - INTERVAL '1 month', INTERVAL '1 month') month_start
                ), intervals AS (
                    SELECT objects.*, months.billing_month, months.starts_at, months.ends_at,
                        rates.credits_per_gigabyte_month,
                        GREATEST(objects.stored_at, months.starts_at, rates.effective_at) starts,
                        LEAST(COALESCE(objects.deleted_at, 'infinity'::timestamptz), months.ends_at, rates.expires_at) ends
                    FROM storage_objects objects JOIN rate_periods rates ON rates.storage_id = objects.storage_id
                    JOIN months ON objects.stored_at < months.ends_at
                        AND COALESCE(objects.deleted_at, 'infinity'::timestamptz) > months.starts_at
                        AND rates.effective_at < months.ends_at AND rates.expires_at > months.starts_at
                        AND NOT EXISTS (SELECT 1 FROM storage_bills settled WHERE settled.team_id = objects.team_id
                            AND settled.user_id = objects.user_id AND settled.owner_team_id = objects.owner_team_id
                            AND settled.billing_month = months.billing_month)
                ), amounts AS (
                    SELECT intervals.*, GREATEST(0, EXTRACT(EPOCH FROM (ends - starts)) - COALESCE((
                        SELECT SUM(GREATEST(0, EXTRACT(EPOCH FROM
                            (LEAST(ends, COALESCE(restored_at, 'infinity'::timestamptz)) - GREATEST(starts, disabled_at)))))
                        FROM team_disabled_periods periods WHERE periods.team_id = intervals.team_id
                          AND periods.disabled_at < ends AND COALESCE(periods.restored_at, 'infinity'::timestamptz) > starts
                    ), 0)) billable_seconds
                    FROM intervals WHERE ends > starts
                )
                INSERT INTO storage_bills(team_id, user_id, owner_team_id, billing_month, credits, usage_details, bill_status, paid_at)
                SELECT team_id, user_id, owner_team_id, billing_month,
                    ROUND(SUM(file_bytes::NUMERIC / 1000000000 * billable_seconds / EXTRACT(EPOCH FROM (ends_at - starts_at)) * credits_per_gigabyte_month), 6),
                    JSONB_AGG(JSONB_BUILD_OBJECT('objectId', id, 'storageId', storage_id, 'bytes', file_bytes, 'seconds', billable_seconds, 'rate', credits_per_gigabyte_month::TEXT)),
                    CASE WHEN ROUND(SUM(file_bytes::NUMERIC / 1000000000 * billable_seconds / EXTRACT(EPOCH FROM (ends_at - starts_at)) * credits_per_gigabyte_month), 6) = 0 THEN 'paid' ELSE 'unpaid' END,
                    CASE WHEN ROUND(SUM(file_bytes::NUMERIC / 1000000000 * billable_seconds / EXTRACT(EPOCH FROM (ends_at - starts_at)) * credits_per_gigabyte_month), 6) = 0 THEN CURRENT_TIMESTAMP ELSE NULL END
                FROM amounts GROUP BY team_id, user_id, owner_team_id, billing_month
                ON CONFLICT(team_id, user_id, owner_team_id, billing_month) DO NOTHING
                """).fetch().rowsUpdated();
    }

    /**
     * 按时间顺序查询未付款账单。
     * @return 最早的待付款账单
     */
    public Flux<JSONObject> unpaidBills() {
        return teamRepository.query("SELECT * FROM storage_bills WHERE bill_status = 'unpaid' AND credits > 0 ORDER BY billing_month, id", Map.of());
    }

    /**
     * 对单张账单加锁，重复支付不重复扣款。
     * @param id 账单标识
     * @return 未付款账单
     */
    public Mono<JSONObject> lockBill(long id) {
        return teamRepository.query("SELECT * FROM storage_bills WHERE id = :id AND bill_status = 'unpaid' FOR UPDATE", Map.of("id", id)).singleOrEmpty();
    }

    /**
     * 锁定原钱包并检查过期积分清理后的余额，余额不足不提前消耗发放批次。
     * @param bill 待支付账单
     * @return 是否可以全额支付
     */
    public Mono<Boolean> canPay(JSONObject bill) {
        return databaseClient.sql("""
                SELECT NOT EXISTS (SELECT 1 FROM storage_bills older WHERE older.user_id = :user AND older.owner_team_id = :owner
                    AND older.bill_status = 'unpaid' AND older.credits > 0 AND (older.billing_month, older.id) < (:month, :id))
                    AND accounts.credit_balance - COALESCE((SELECT SUM(remaining_amount) FROM user_credit_grants grants
                    WHERE grants.user_id = accounts.user_id AND grants.team_id = accounts.team_id AND expires_at <= CURRENT_TIMESTAMP), 0) >= :credits payable
                FROM user_credit_accounts accounts WHERE user_id = :user AND team_id = :owner FOR UPDATE
                """).bind("user", bill.getLongValue("userId")).bind("owner", bill.getLongValue("ownerTeamId"))
                .bind("month", java.time.LocalDate.parse(bill.getString("billingMonth"))).bind("id", bill.getLongValue("id"))
                .bind("credits", bill.getBigDecimal("credits")).map((row, metadata) -> row.get("payable", Boolean.class)).one().defaultIfEmpty(false);
    }

    /**
     * 记录账单支付结果。
     * @param bill 账单
     * @param balanceAfter 实际扣款后余额
     * @return 完成信号
     */
    public Mono<Void> markPaid(JSONObject bill, BigDecimal balanceAfter) {
        return databaseClient.sql("""
                INSERT INTO user_credit_transactions(user_id, team_id, wallet_team_id, beneficiary_team_id,
                    transaction_type, change_amount, balance_after, reason, billing_reference)
                VALUES (:userId, :teamId, :owner, :owner, 'storage_charge', :amount, :balance, '对象存储月度结算', :reference)
                """).bind("userId", bill.getLongValue("userId")).bind("teamId", bill.getLongValue("teamId"))
                .bind("owner", bill.getLongValue("ownerTeamId")).bind("amount", bill.getBigDecimal("credits").negate())
                .bind("balance", balanceAfter).bind("reference", "storage:" + bill.getLongValue("id"))
                .fetch().rowsUpdated().then(databaseClient.sql("UPDATE storage_bills SET bill_status = 'paid', paid_at = CURRENT_TIMESTAMP WHERE id = :id")
                        .bind("id", bill.getLongValue("id")).fetch().rowsUpdated()).then();
    }

    /**
     * 为媒体移除请求标记实际对象；待物理删除确认后才停止计费。
     * @param userId 当前用户
     * @param keys 媒体业务标识
     * @return 完成信号
     */
    public Mono<Void> requestMediaDeletion(long userId, java.util.List<String> keys) {
        if (keys.isEmpty()) return Mono.empty();
        return databaseClient.sql("UPDATE storage_objects objects SET deletion_requested_at = CURRENT_TIMESTAMP FROM media_files media WHERE media.user_id = :userId AND media.storage_key IN (:keys) AND media.team_id = current_team_id() AND objects.team_id = media.team_id AND objects.user_id = media.user_id AND objects.storage_id = media.object_storage_config_id AND objects.object_key = media.object_storage_key AND objects.deleted_at IS NULL")
                .bind("userId", userId).bind("keys", keys).fetch().rowsUpdated().then();
    }

    /**
     * 为写入成功但业务创建失败的对象登记可重试删除。
     * @param storageId 实际存储标识
     * @param objectKey 实际对象键
     * @return 标记完成信号
     */
    public Mono<Void> requestObjectDeletion(String storageId, String objectKey) {
        return databaseClient.sql("UPDATE storage_objects SET deletion_requested_at = COALESCE(deletion_requested_at, CURRENT_TIMESTAMP) WHERE storage_id = :storage AND object_key = :key AND deleted_at IS NULL")
                .bind("storage", storageId).bind("key", objectKey).fetch().rowsUpdated().then();
    }

    /** @return 待删除对象 */
    public Flux<JSONObject> pendingDeletions() {
        return teamRepository.query("SELECT * FROM storage_objects WHERE deletion_requested_at IS NOT NULL AND deleted_at IS NULL ORDER BY deletion_last_attempt_at NULLS FIRST, id LIMIT 200", Map.of());
    }

    /**
     * 保存删除结果。
     * @param id 对象标识
     * @param error 空字符串表示成功
     * @return 完成信号
     */
    public Mono<Void> deletionResult(long id, String error) {
        return databaseClient.sql("UPDATE storage_objects SET deletion_last_attempt_at = CURRENT_TIMESTAMP, deleted_at = CASE WHEN :error = '' THEN COALESCE(deleted_at, CURRENT_TIMESTAMP) ELSE deleted_at END, deletion_error = CASE WHEN deleted_at IS NULL THEN :error ELSE NULL END WHERE id = :id")
                .bind("id", id).bind("error", error).fetch().rowsUpdated().then();
    }
}

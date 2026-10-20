package com.novanovastudio.repository;

import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSON;
import com.novanovastudio.dto.StorageCapacityDtos;
import java.math.BigDecimal;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.r2dbc.core.DatabaseClient;
import org.springframework.stereotype.Repository;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * 个人容量账户、套餐、购买快照与上传租约数据访问。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-19 12:00
 */
@Repository
@RequiredArgsConstructor
public class StorageCapacityRepository {
    /** 参数化数据库操作。 */
    private final DatabaseClient databaseClient;
    /** 复用行字段的驼峰转换。 */
    private final TeamRepository teamRepository;

    /**
     * @param userId 用户标识
     * @return 创建并锁定容量账户的完成信号，必须处于事务中
     */
    public Mono<Void> lockAccount(long userId) {
        return databaseClient.sql("INSERT INTO user_storage_capacity_accounts(user_id) VALUES (:user) ON CONFLICT(team_id, user_id) DO NOTHING")
                .bind("user", userId).fetch().rowsUpdated()
                .then(databaseClient.sql("SELECT user_id FROM user_storage_capacity_accounts WHERE team_id = current_team_id() AND user_id = :user FOR UPDATE")
                        .bind("user", userId).map((row, metadata) -> row.get("user_id", Long.class)).one()).then();
    }

    /**
     * 当前空间免费、已购、已用、预占及总容量，单位字节。
     *
     * @param userId 用户标识
     * @return 当前空间免费、已购、已用、预占及总容量，单位字节
     */
    public Mono<JSONObject> capacity(long userId) {
        return teamRepository.query("""
                WITH object_totals AS (
                    SELECT file_category category, COUNT(*) file_count, SUM(file_bytes) used_bytes,
                        COALESCE(SUM(file_bytes) FILTER (WHERE deletion_requested_at IS NOT NULL), 0) pending_deletion_bytes
                    FROM storage_objects WHERE team_id = current_team_id() AND user_id = :user AND deleted_at IS NULL
                    GROUP BY file_category
                )
                SELECT settings.free_bytes::TEXT free_bytes, COALESCE(accounts.purchased_bytes, 0)::TEXT purchased_bytes,
                    (settings.free_bytes::NUMERIC + COALESCE(accounts.purchased_bytes, 0))::TEXT total_bytes,
                    COALESCE((SELECT SUM(used_bytes) FROM object_totals), 0)::TEXT used_bytes,
                    COALESCE((SELECT SUM(pending_deletion_bytes) FROM object_totals), 0)::TEXT pending_deletion_bytes,
                    (SELECT COALESCE(jsonb_agg(jsonb_build_object('category', category, 'fileCount', file_count, 'usedBytes', used_bytes::TEXT)), '[]'::JSONB)::TEXT FROM object_totals) categories,
                    COALESCE((SELECT SUM(file_bytes) FROM storage_upload_reservations WHERE team_id = current_team_id() AND user_id = :user), 0)::TEXT reserved_bytes
                FROM storage_capacity_settings settings LEFT JOIN user_storage_capacity_accounts accounts
                    ON accounts.team_id = settings.team_id AND accounts.user_id = :user
                WHERE settings.team_id = current_team_id()
                """, Map.of("user", userId)).single().map(capacity -> {
                    capacity.put("categories", JSON.parseArray(capacity.getString("categories")));
                    return capacity;
                });
    }

    /**
     * 当前空间免费容量字节数。
     *
     * @return 当前空间免费容量字节数
     */
    public Mono<Long> freeBytes() {
        return databaseClient.sql("SELECT free_bytes FROM storage_capacity_settings WHERE team_id = current_team_id()")
                .map((row, metadata) -> row.get("free_bytes", Long.class)).one();
    }

    /**
     * 配置保存完成信号。
     *
     * @param bytes 每人免费字节数
     * @return 配置保存完成信号
     */
    public Mono<Void> saveSettings(long bytes) {
        return databaseClient.sql("UPDATE storage_capacity_settings SET free_bytes = :bytes, updated_at = CURRENT_TIMESTAMP WHERE team_id = current_team_id()")
                .bind("bytes", bytes).fetch().rowsUpdated().then();
    }

    /**
     * 套餐列表。
     *
     * @param owner 提供方空间
     * @param onlyEnabled 是否仅返回上架套餐
     * @return 套餐列表
     */
    public Flux<JSONObject> packages(long owner, boolean onlyEnabled) {
        return teamRepository.query("SELECT id, team_id, name, capacity_gigabytes, credits::TEXT credits, enabled, revision FROM storage_capacity_packages WHERE team_id = :owner AND (NOT :enabled OR enabled) ORDER BY capacity_gigabytes, id",
                Map.of("owner", owner, "enabled", onlyEnabled));
    }

    /**
     * 套餐事务锁保护的当前版本，允许团队购买只读的平台套餐。
     *
     * @param id 套餐标识
     * @return 套餐事务锁保护的当前版本，允许团队购买只读的平台套餐
     */
    public Mono<JSONObject> lockPackage(String id) {
        // 行级安全禁止团队更新平台套餐，使用事务级咨询锁协调只读购买与所属方编辑。
        return databaseClient.sql("SELECT pg_advisory_xact_lock(hashtextextended('storage-capacity-package:' || :id, 0))")
                .bind("id", id).map((row, metadata) -> 1).one()
                .then(teamRepository.query("SELECT id, team_id, name, capacity_gigabytes, credits::TEXT credits, enabled, revision FROM storage_capacity_packages WHERE id = :id", Map.of("id", id)).singleOrEmpty());
    }

    /**
     * 创建完成信号。
     *
     * @param id 新套餐标识
     * @param request 套餐内容
     * @return 创建完成信号
     */
    public Mono<Void> createPackage(String id, StorageCapacityDtos.PackageRequest request) {
        return databaseClient.sql("INSERT INTO storage_capacity_packages(id, name, capacity_gigabytes, credits, enabled) VALUES (:id, :name, :capacity, :credits, :enabled)")
                .bind("id", id).bind("name", request.name().trim()).bind("capacity", request.capacityGigabytes())
                .bind("credits", request.credits()).bind("enabled", request.enabled()).fetch().rowsUpdated().then();
    }

    /**
     * 编辑完成信号。
     *
     * @param request 已验证版本及所有权的套餐内容
     * @return 编辑完成信号
     */
    public Mono<Void> updatePackage(StorageCapacityDtos.PackageRequest request) {
        return databaseClient.sql("UPDATE storage_capacity_packages SET name = :name, capacity_gigabytes = :capacity, credits = :credits, enabled = :enabled, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = :id AND team_id = current_team_id()")
                .bind("id", request.id()).bind("name", request.name().trim()).bind("capacity", request.capacityGigabytes())
                .bind("credits", request.credits()).bind("enabled", request.enabled()).fetch().rowsUpdated().then();
    }

    /**
     * 已完成购买记录。
     *
     * @param userId 当前用户
     * @param requestId 请求唯一标识
     * @return 已完成购买记录
     */
    public Mono<JSONObject> purchase(long userId, String requestId) {
        return teamRepository.query("SELECT id, package_id, package_revision, wallet_team_id, capacity_bytes::TEXT capacity_bytes, credits::TEXT credits FROM storage_capacity_purchases WHERE team_id = current_team_id() AND user_id = :user AND client_request_id = :request",
                Map.of("user", userId, "request", requestId)).singleOrEmpty();
    }

    /**
     * 购买快照及容量更新完成信号。
     *
     * @param id 购买标识
     * @param userId 当前用户
     * @param request 购买请求
     * @param item 套餐快照
     * @param bytes 增加字节数
     * @return 购买快照及容量更新完成信号
     */
    public Mono<Void> recordPurchase(String id, long userId, StorageCapacityDtos.PurchaseRequest request, JSONObject item, long bytes) {
        return databaseClient.sql("""
                INSERT INTO storage_capacity_purchases(id, user_id, client_request_id, package_id, package_revision, wallet_team_id, capacity_bytes, credits, package_snapshot)
                VALUES (:id, :user, :request, :package, :revision, :owner, :bytes, :credits, CAST(:snapshot AS JSONB))
                """).bind("id", id).bind("user", userId).bind("request", request.clientRequestId()).bind("package", request.packageId())
                .bind("revision", request.revision()).bind("owner", item.getLongValue("teamId")).bind("bytes", bytes)
                .bind("credits", item.getBigDecimal("credits")).bind("snapshot", item.toJSONString()).fetch().rowsUpdated()
                .then(databaseClient.sql("UPDATE user_storage_capacity_accounts SET purchased_bytes = purchased_bytes + :bytes WHERE team_id = current_team_id() AND user_id = :user")
                        .bind("bytes", bytes).bind("user", userId).fetch().rowsUpdated()).then();
    }

    /**
     * 积分流水完成信号。
     *
     * @param id 购买标识
     * @param userId 当前用户
     * @param item 套餐快照
     * @param balance 扣款后余额
     * @return 积分流水完成信号
     */
    public Mono<Void> recordTransaction(String id, long userId, JSONObject item, BigDecimal balance) {
        return databaseClient.sql("""
                INSERT INTO user_credit_transactions(user_id, wallet_team_id, beneficiary_team_id, transaction_type, change_amount, balance_after, reason, billing_reference)
                VALUES (:user, :owner, :owner, 'storage_purchase', :amount, :balance, :reason, :reference)
                """).bind("user", userId).bind("owner", item.getLongValue("teamId")).bind("amount", item.getBigDecimal("credits").negate())
                .bind("balance", balance).bind("reason", "永久存储扩容：" + item.getString("name") + "，增加 " + item.getInteger("capacityGigabytes") + " G")
                .bind("reference", "storage-purchase:" + id).fetch().rowsUpdated().then();
    }

    /**
     * 预占完成信号。
     *
     * @param id 租约标识
     * @param userId 用户标识
     * @param storageId 实际存储
     * @param key 对象键
     * @param bytes 实际字节数
     * @return 预占完成信号
     */
    public Mono<Void> reserve(String id, long userId, String storageId, String key, long bytes) {
        return databaseClient.sql("INSERT INTO storage_upload_reservations(id, user_id, storage_id, object_key, file_bytes) VALUES (:id, :user, :storage, :key, :bytes)")
                .bind("id", id).bind("user", userId).bind("storage", storageId).bind("key", key).bind("bytes", bytes).fetch().rowsUpdated().then();
    }

    /**
     * 续租影响行数，零表示已被清理任务接管。
     *
     * @param id 租约标识
     * @return 续租影响行数，零表示已被清理任务接管
     */
    public Mono<Long> renew(String id) {
        return databaseClient.sql("UPDATE storage_upload_reservations SET expires_at = CURRENT_TIMESTAMP + INTERVAL '1 hour' WHERE id = :id AND reservation_status = 'uploading'")
                .bind("id", id).fetch().rowsUpdated();
    }

    /**
     * 租约当前状态，完成事务中读取行锁。
     *
     * @param id 租约标识
     * @return 租约当前状态，完成事务中读取行锁
     */
    public Mono<String> lockReservation(String id) {
        return databaseClient.sql("SELECT reservation_status FROM storage_upload_reservations WHERE id = :id FOR UPDATE")
                .bind("id", id).map((row, metadata) -> row.get("reservation_status", String.class)).one();
    }

    /**
     * 预占释放完成信号，必须已登记对象或确认物理删除。
     *
     * @param id 租约标识
     * @return 预占释放完成信号，必须已登记对象或确认物理删除
     */
    public Mono<Void> release(String id) {
        return databaseClient.sql("DELETE FROM storage_upload_reservations WHERE id = :id").bind("id", id).fetch().rowsUpdated().then();
    }

    /**
     * 标记清理完成信号。
     *
     * @param id 租约标识
     * @return 标记清理完成信号
     */
    public Mono<Void> abandon(String id) {
        return databaseClient.sql("UPDATE storage_upload_reservations SET reservation_status = 'cleanup' WHERE id = :id")
                .bind("id", id).fetch().rowsUpdated().then();
    }

    /**
     * 已失败或进程中断的租约，保持预占直到删除成功。
     *
     * @return 已失败或进程中断的租约，保持预占直到删除成功
     */
    public Flux<JSONObject> pendingCleanup() {
        return teamRepository.query("UPDATE storage_upload_reservations SET reservation_status = 'cleanup', last_attempt_at = CURRENT_TIMESTAMP WHERE id IN (SELECT id FROM storage_upload_reservations WHERE reservation_status = 'cleanup' OR expires_at < CURRENT_TIMESTAMP ORDER BY last_attempt_at NULLS FIRST, expires_at LIMIT 100 FOR UPDATE SKIP LOCKED) RETURNING id, team_id, user_id, storage_id, object_key", Map.of());
    }

    /**
     * 错误保存完成信号。
     *
     * @param id 租约标识
     * @param message 删除错误
     * @return 错误保存完成信号
     */
    public Mono<Void> cleanupError(String id, String message) {
        return databaseClient.sql("UPDATE storage_upload_reservations SET deletion_error = :message, last_attempt_at = CURRENT_TIMESTAMP WHERE id = :id")
                .bind("id", id).bind("message", message).fetch().rowsUpdated().then();
    }
}

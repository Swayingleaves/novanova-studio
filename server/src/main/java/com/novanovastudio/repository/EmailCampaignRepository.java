package com.novanovastudio.repository;

import com.novanovastudio.dto.EmailCampaignDtos;
import com.novanovastudio.entity.EmailCampaignRecords;
import io.r2dbc.spi.Row;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.r2dbc.core.DatabaseClient;
import org.springframework.stereotype.Repository;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * 群发任务、收件快照与跨实例派发额度仓储。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-24 16:00
 */
@Repository
@RequiredArgsConstructor
public class EmailCampaignRepository {
    /** 任务分页仅查询汇总字段，避免重复读取正文与图片。 */
    private static final String CAMPAIGN_SELECT = """
            SELECT c.id, c.subject, c.recipient_mode, c.interval_seconds, c.status, c.recipient_count,
                   c.created_at, c.finished_at, COALESCE(u.nickname, '') AS created_by_name, totals.*
            FROM email_campaigns c LEFT JOIN users u ON u.id = c.created_by
            CROSS JOIN LATERAL (
                SELECT COUNT(*) FILTER (WHERE status = 'queued') AS queued_count,
                       COUNT(*) FILTER (WHERE status = 'sending') AS sending_count,
                       COUNT(*) FILTER (WHERE status = 'sent') AS sent_count,
                       COUNT(*) FILTER (WHERE status = 'failed') AS failed_count,
                       COUNT(*) FILTER (WHERE status = 'unknown') AS unknown_count,
                       COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled_count
                FROM email_deliveries WHERE campaign_id = c.id
            ) totals
            """;
    /** 有邮箱用户的固定筛选条件，搜索值始终使用绑定参数。 */
    private static final String USER_FILTER = """
            FROM users WHERE email IS NOT NULL AND btrim(email) <> ''
            AND (email ILIKE :keyword OR nickname ILIKE :keyword OR username ILIKE :keyword)
            """;
    /** 响应式数据库客户端。 */
    private final DatabaseClient databaseClient;

    /**
     * 锁定全局派发行，事务结束后立即释放，不跨邮件网络调用持锁。
     * @param skipLocked 是否在其他实例持锁时跳过
     * @return 成功锁定的标识，无可用锁时为空
     */
    public Mono<Integer> lockControl(boolean skipLocked) {
        return databaseClient.sql("SELECT id FROM email_dispatch_control WHERE id = 1 FOR UPDATE" + (skipLocked ? " SKIP LOCKED" : ""))
                .map((row, metadata) -> row.get("id", Integer.class)).one();
    }

    /**
     * 查询请求标识对应的既有任务，重复提交不新增任务。
     * @param requestId 防重复提交标识
     * @param userId 创建管理员
     * @return 已创建的任务主键
     */
    public Mono<Long> findByRequestId(UUID requestId, long userId) {
        return databaseClient.sql("SELECT id FROM email_campaigns WHERE request_id = :requestId AND created_by = :userId")
                .bind("requestId", requestId).bind("userId", userId).map((row, metadata) -> row.get("id", Long.class)).one();
    }

    /** @return 排队及执行中的任务总数 */
    public Mono<Long> countActive() {
        return databaseClient.sql("SELECT COUNT(*) FROM email_campaigns WHERE status IN ('queued', 'running')")
                .map((row, metadata) -> row.get(0, Long.class)).one();
    }

    /**
     * 新建不可变任务内容。
     * @param request 已校验的请求
     * @param bodyHtml 安全正文
     * @param fromEmail 发件地址
     * @param userId 创建管理员
     * @return 新任务主键，请求重复时为空
     */
    public Mono<Long> insertCampaign(EmailCampaignDtos.CreateRequest request, String bodyHtml, String fromEmail, long userId) {
        return databaseClient.sql("""
                INSERT INTO email_campaigns(request_id, subject, body_html, from_email, recipient_mode, interval_seconds, created_by)
                VALUES (:requestId, :subject, :bodyHtml, :fromEmail, :mode, :intervalSeconds, :userId)
                ON CONFLICT (request_id) DO NOTHING RETURNING id
                """).bind("requestId", request.requestId()).bind("subject", request.subject().trim())
                .bind("bodyHtml", bodyHtml).bind("fromEmail", fromEmail).bind("mode", request.recipientMode())
                .bind("intervalSeconds", request.intervalSeconds()).bind("userId", userId)
                .map((row, metadata) -> row.get("id", Long.class)).one();
    }

    /**
     * 在一次数据库插入中固定收件范围，后续新注册或邮箱修改不会改变任务。
     * @param campaignId 任务主键
     * @param allUsers 是否全部有邮箱用户
     * @param userIds 指定用户主键
     * @return 实际收件人数
     */
    public Mono<Long> snapshotRecipients(long campaignId, boolean allUsers, List<Long> userIds) {
        var query = databaseClient.sql("""
                INSERT INTO email_deliveries(campaign_id, user_id, email, nickname)
                SELECT :campaignId, id, lower(btrim(email)), COALESCE(nickname, '') FROM users
                WHERE email IS NOT NULL AND btrim(email) <> ''
                """ + (allUsers ? "" : " AND id IN (:userIds)"))
                .bind("campaignId", campaignId);
        if (!allUsers) query = query.bind("userIds", userIds);
        return query.fetch().rowsUpdated();
    }

    /**
     * 保存总人数。
     * @param campaignId 任务主键
     * @param count 实际收件人数
     * @return 完成信号
     */
    public Mono<Void> updateRecipientCount(long campaignId, int count) {
        return databaseClient.sql("UPDATE email_campaigns SET recipient_count = :count WHERE id = :id")
                .bind("count", count).bind("id", campaignId).fetch().rowsUpdated().then();
    }

    /**
     * 保存图片内容快照，邮件发送不再依赖对象存储链接。
     * @param campaignId 任务主键
     * @param image 图片快照
     * @return 完成信号
     */
    public Mono<Void> insertImage(long campaignId, EmailCampaignRecords.Image image) {
        return databaseClient.sql("INSERT INTO email_campaign_images(campaign_id, content_id, mime_type, image_data) VALUES (:id, :contentId, :mimeType, :data)")
                .bind("id", campaignId).bind("contentId", image.contentId()).bind("mimeType", image.mimeType()).bind("data", image.data())
                .fetch().rowsUpdated().then();
    }

    /**
     * 读取邮件内嵌图片。
     * @param campaignId 任务主键
     * @return 图片列表
     */
    public Flux<EmailCampaignRecords.Image> listImages(long campaignId) {
        return databaseClient.sql("SELECT content_id, mime_type, image_data FROM email_campaign_images WHERE campaign_id = :id ORDER BY content_id")
                .bind("id", campaignId).map((row, metadata) -> new EmailCampaignRecords.Image(row.get("content_id", String.class),
                        row.get("mime_type", String.class), row.get("image_data", byte[].class))).all();
    }

    /**
     * 搜索可收件的用户。
     * @param keyword 已标准化的搜索词
     * @param offset 分页偏移
     * @param pageSize 分页大小
     * @return 用户列表
     */
    public Flux<EmailCampaignDtos.RecipientUser> listUsers(String keyword, int offset, int pageSize) {
        return databaseClient.sql("SELECT id, COALESCE(nickname, '') AS nickname, email " + USER_FILTER + " ORDER BY id LIMIT :limit OFFSET :offset")
                .bind("keyword", "%" + keyword + "%").bind("limit", pageSize).bind("offset", offset)
                .map((row, metadata) -> new EmailCampaignDtos.RecipientUser(row.get("id", Long.class), row.get("nickname", String.class), row.get("email", String.class))).all();
    }

    /**
     * @param keyword 搜索词
     * @return 可收件用户总数
     */
    public Mono<Long> countUsers(String keyword) {
        return databaseClient.sql("SELECT COUNT(*) " + USER_FILTER).bind("keyword", "%" + keyword + "%")
                .map((row, metadata) -> row.get(0, Long.class)).one();
    }

    /**
     * @param offset 分页偏移
     * @param pageSize 分页大小
     * @return 任务汇总列表
     */
    public Flux<EmailCampaignDtos.Campaign> listCampaigns(int offset, int pageSize) {
        return databaseClient.sql(CAMPAIGN_SELECT + " ORDER BY c.created_at DESC, c.id DESC LIMIT :limit OFFSET :offset")
                .bind("limit", pageSize).bind("offset", offset).map((row, metadata) -> campaign(row)).all();
    }

    /** @return 任务总数 */
    public Mono<Long> countCampaigns() {
        return databaseClient.sql("SELECT COUNT(*) FROM email_campaigns").map((row, metadata) -> row.get(0, Long.class)).one();
    }

    /**
     * @param campaignId 任务主键
     * @return 任务汇总
     */
    public Mono<EmailCampaignDtos.Campaign> getCampaign(long campaignId) {
        return databaseClient.sql(CAMPAIGN_SELECT + " WHERE c.id = :id").bind("id", campaignId).map((row, metadata) -> campaign(row)).one();
    }

    /**
     * @param campaignId 任务主键
     * @return 正文与发件人快照
     */
    public Mono<EmailCampaignRecords.Content> getContent(long campaignId) {
        return databaseClient.sql("SELECT body_html, from_email FROM email_campaigns WHERE id = :id").bind("id", campaignId)
                .map((row, metadata) -> new EmailCampaignRecords.Content(row.get("body_html", String.class), row.get("from_email", String.class))).one();
    }

    /**
     * @param campaignId 任务主键
     * @param status 已校验的状态，空串表示全部
     * @param offset 分页偏移
     * @param pageSize 分页大小
     * @return 逐用户发送记录
     */
    public Flux<EmailCampaignDtos.Delivery> listDeliveries(long campaignId, String status, int offset, int pageSize) {
        return databaseClient.sql("SELECT * FROM email_deliveries WHERE campaign_id = :id" + (status.isEmpty() ? "" : " AND status = :status") + " ORDER BY id LIMIT :limit OFFSET :offset")
                .bindValues(status.isEmpty() ? java.util.Map.of("id", campaignId, "limit", pageSize, "offset", offset)
                        : java.util.Map.of("id", campaignId, "status", status, "limit", pageSize, "offset", offset))
                .map((row, metadata) -> new EmailCampaignDtos.Delivery(row.get("id", Long.class), row.get("user_id", Long.class),
                        row.get("nickname", String.class), row.get("email", String.class), row.get("status", String.class),
                        row.get("error_message", String.class), row.get("started_at", OffsetDateTime.class), row.get("finished_at", OffsetDateTime.class))).all();
    }

    /**
     * @param campaignId 任务主键
     * @param status 已校验的状态，空串表示全部
     * @return 发送记录总数
     */
    public Mono<Long> countDeliveries(long campaignId, String status) {
        var query = databaseClient.sql("SELECT COUNT(*) FROM email_deliveries WHERE campaign_id = :id" + (status.isEmpty() ? "" : " AND status = :status"))
                .bind("id", campaignId);
        if (!status.isEmpty()) query = query.bind("status", status);
        return query.map((row, metadata) -> row.get(0, Long.class)).one();
    }

    /**
     * 原子领取一位收件人，全局行锁保护额度检查与领取过程。
     * @param maximumPerMinute 连续一分钟额度
     * @param maximumPerHour 连续一小时额度
     * @param minimumIntervalSeconds 全局最小间隔
     * @return 本次领取的邮件，无可用额度或任务时为空
     */
    public Mono<EmailCampaignRecords.Dispatch> claimNext(int maximumPerMinute, int maximumPerHour, int minimumIntervalSeconds) {
        return databaseClient.sql("""
                WITH candidate AS (
                    SELECT d.id, c.id AS campaign_id, d.email, c.subject, c.body_html, c.from_email,
                           GREATEST(c.interval_seconds, :minimumInterval) AS interval_seconds
                    FROM email_campaigns c JOIN email_deliveries d ON d.campaign_id = c.id AND d.status = 'queued'
                    WHERE c.status IN ('queued', 'running')
                      AND (SELECT next_send_at FROM email_dispatch_control WHERE id = 1) <= CURRENT_TIMESTAMP
                      AND NOT EXISTS (SELECT 1 FROM email_deliveries WHERE status = 'sending')
                      AND (SELECT COUNT(*) FROM email_deliveries WHERE started_at > CURRENT_TIMESTAMP - INTERVAL '1 minute') < :minuteLimit
                      AND (SELECT COUNT(*) FROM email_deliveries WHERE started_at > CURRENT_TIMESTAMP - INTERVAL '1 hour') < :hourLimit
                    ORDER BY c.id, d.id LIMIT 1 FOR UPDATE OF c, d
                )
                UPDATE email_deliveries d SET status = 'sending', started_at = CURRENT_TIMESTAMP
                FROM candidate WHERE d.id = candidate.id
                RETURNING d.id, candidate.campaign_id, candidate.email, candidate.subject, candidate.body_html,
                          candidate.from_email, candidate.interval_seconds
                """).bind("minimumInterval", minimumIntervalSeconds).bind("minuteLimit", maximumPerMinute).bind("hourLimit", maximumPerHour)
                .map((row, metadata) -> new EmailCampaignRecords.Dispatch(row.get("id", Long.class), row.get("campaign_id", Long.class),
                        row.get("email", String.class), row.get("subject", String.class), row.get("body_html", String.class),
                        row.get("from_email", String.class), row.get("interval_seconds", Integer.class))).one()
                .flatMap(dispatch -> databaseClient.sql("UPDATE email_campaigns SET status = 'running' WHERE id = :id AND status = 'queued'")
                        .bind("id", dispatch.campaignId()).fetch().rowsUpdated()
                        .then(delayNextSend(dispatch.intervalSeconds())).thenReturn(dispatch));
    }

    /**
     * 记录单封结果，已过期的领取结果不得覆盖恢复状态。
     * @param deliveryId 发送记录主键
     * @param status 最终状态
     * @param errorMessage 结果说明，成功时为空
     * @return 完成信号
     */
    public Mono<Void> finishDelivery(long deliveryId, String status, String errorMessage) {
        var query = databaseClient.sql("UPDATE email_deliveries SET status = :status, error_message = :error, finished_at = CURRENT_TIMESTAMP WHERE id = :id AND status = 'sending'")
                .bind("id", deliveryId).bind("status", status);
        return R2dbcBindings.bindNullable(query, "error", errorMessage, String.class).fetch().rowsUpdated().then();
    }

    /**
     * 从发送完成时间重新计算间隔，避免慢邮件结束后立即发送下一封。
     * @param seconds 至少等待的秒数
     * @return 完成信号
     */
    public Mono<Void> delayNextSend(int seconds) {
        return databaseClient.sql("UPDATE email_dispatch_control SET next_send_at = GREATEST(next_send_at, CURRENT_TIMESTAMP + make_interval(secs => :seconds)) WHERE id = 1")
                .bind("seconds", seconds).fetch().rowsUpdated().then();
    }

    /**
     * 服务中断后不自动重发可能已被邮件服务器接受的邮件。
     * @return 标记为结果不确定的数量
     */
    public Mono<Long> recoverInterrupted() {
        return databaseClient.sql("""
                UPDATE email_deliveries d SET status = 'unknown', error_message = '发送过程超时或服务中断，请核对邮件服务器记录，系统不会自动重发', finished_at = CURRENT_TIMESTAMP
                WHERE d.id IN (SELECT id FROM email_deliveries WHERE status = 'sending' AND started_at < CURRENT_TIMESTAMP - INTERVAL '5 minutes')
                  AND d.status = 'sending'
                """).fetch().rowsUpdated();
    }

    /** @return 更新已无待处理收件人的任务后的完成信号 */
    public Mono<Void> completeCampaigns() {
        return databaseClient.sql("""
                UPDATE email_campaigns c SET status = 'completed', finished_at = CURRENT_TIMESTAMP
                WHERE c.id IN (
                    SELECT active.id FROM email_campaigns active WHERE active.status IN ('queued', 'running')
                      AND NOT EXISTS (SELECT 1 FROM email_deliveries d WHERE d.campaign_id = active.id AND d.status IN ('queued', 'sending'))
                ) AND c.status IN ('queued', 'running')
                """).fetch().rowsUpdated().then();
    }

    /**
     * 取消未派发的收件人，已开始的邮件保留真实发送结果。
     * @param campaignId 任务主键
     * @return 是否成功取消活动任务
     */
    public Mono<Boolean> cancelCampaign(long campaignId) {
        return databaseClient.sql("UPDATE email_campaigns SET status = 'cancelled', finished_at = CURRENT_TIMESTAMP WHERE id = :id AND status IN ('queued', 'running') RETURNING id")
                .bind("id", campaignId).map((row, metadata) -> row.get("id", Long.class)).one()
                .flatMap(id -> databaseClient.sql("UPDATE email_deliveries SET status = 'cancelled', finished_at = CURRENT_TIMESTAMP WHERE id IN (SELECT id FROM email_deliveries WHERE campaign_id = :id AND status = 'queued') AND status = 'queued'")
                        .bind("id", id).fetch().rowsUpdated().thenReturn(true)).defaultIfEmpty(false);
    }

    /**
     * @param row 数据库任务汇总行
     * @return 管理页面任务汇总
     */
    private EmailCampaignDtos.Campaign campaign(Row row) {
        return new EmailCampaignDtos.Campaign(row.get("id", Long.class), row.get("subject", String.class), row.get("recipient_mode", String.class),
                row.get("interval_seconds", Integer.class), row.get("status", String.class), row.get("recipient_count", Integer.class),
                row.get("queued_count", Long.class), row.get("sending_count", Long.class), row.get("sent_count", Long.class),
                row.get("failed_count", Long.class), row.get("unknown_count", Long.class), row.get("cancelled_count", Long.class),
                row.get("created_by_name", String.class), row.get("created_at", OffsetDateTime.class), row.get("finished_at", OffsetDateTime.class));
    }
}

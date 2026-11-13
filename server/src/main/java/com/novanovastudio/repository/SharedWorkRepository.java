package com.novanovastudio.repository;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.dto.SharedWorkDtos;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.r2dbc.core.DatabaseClient;
import org.springframework.stereotype.Repository;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * 作品快照、媒体关联与审核记录持久化，所有非公开操作显式限定空间。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-11-06 10:00
 */
@Repository
@RequiredArgsConstructor
public class SharedWorkRepository {
    /** 响应式数据库客户端。 */
    private final DatabaseClient databaseClient;
    /** 复用项目字段映射，数据库查询不会直接作为公开响应返回。 */
    private final TeamRepository queries;

    /**
     * 创建准备中的投稿，幂等键防止重复复制媒体。
     * @param code 服务端分享标识
     * @param userId 投稿用户
     * @param teamId 当前空间
     * @param creatorName 署名快照
     * @param request 投稿表单
     * @param snapshot 白名单内容快照
     * @return 创建是否成功
     */
    public Mono<Boolean> create(String code, long userId, long teamId, String creatorName,
                                SharedWorkDtos.SubmitRequest request, JSONObject snapshot) {
        return databaseClient.sql("""
                INSERT INTO shared_works(share_code, team_id, user_id, request_id, source_type, source_id, work_type,
                    title, description, category, creator_name, snapshot_data, work_status)
                VALUES (:code, :team, :user, :request, :sourceType, :sourceId, :kind, :title, :description,
                    :category, :creator, CAST(:snapshot AS jsonb), 'preparing')
                ON CONFLICT (team_id, user_id, request_id) DO NOTHING
                """).bind("code", code).bind("team", teamId).bind("user", userId).bind("request", request.requestId())
                .bind("sourceType", request.sourceType()).bind("sourceId", request.sourceId()).bind("kind", request.workType())
                .bind("title", request.title().trim()).bind("description", request.description() == null ? "" : request.description().trim())
                .bind("category", request.category()).bind("creator", creatorName).bind("snapshot", JSON.toJSONString(snapshot))
                .fetch().rowsUpdated().map(count -> count == 1);
    }

    /**
     * 读取当前用户本次幂等投稿。
     * @param userId 用户
     * @param teamId 空间
     * @param requestId 幂等标识
     * @return 内部作品记录
     */
    public Mono<JSONObject> findRequest(long userId, long teamId, String requestId) {
        return queries.query("SELECT * FROM shared_works WHERE user_id = :user AND team_id = :team AND request_id = :request",
                Map.of("user", userId, "team", teamId, "request", requestId)).singleOrEmpty();
    }

    /**
     * 读取作品，公开状态与作者权限由调用服务校验。
     * @param code 分享标识
     * @return 内部作品记录
     */
    public Mono<JSONObject> find(String code) {
        return queries.query("SELECT *, snapshot_data::text snapshot FROM shared_works WHERE share_code = :code", Map.of("code", code)).singleOrEmpty();
    }

    /**
     * 查询作品摘要，不加载大型画布快照。
     * @param userId 作者标识，审核列表传零
     * @param teamId 当前审核或发布空间
     * @param status 筛选状态，空串表示全部
     * @param offset 分页偏移
     * @param limit 每页数量
     * @return 作品摘要
     */
    public Flux<JSONObject> list(long userId, long teamId, String status, long offset, int limit) {
        return queries.query("""
                SELECT share_code, title, description, category, creator_name, work_type, work_status, review_reason, created_at, published_at
                FROM shared_works WHERE team_id = :team AND (:user = 0 OR user_id = :user)
                  AND (:user <> 0 OR work_status NOT IN ('preparing', 'failed')) AND (:status = '' OR work_status = :status)
                ORDER BY created_at DESC, share_code LIMIT :limit OFFSET :offset
                """, Map.of("team", teamId, "user", userId, "status", status, "limit", limit, "offset", offset));
    }

    /**
     * 统计限定空间内的作品。
     * @param userId 作者，审核列表传零
     * @param teamId 空间
     * @param status 状态
     * @return 总数
     */
    public Mono<Long> count(long userId, long teamId, String status) {
        return databaseClient.sql("SELECT COUNT(*) FROM shared_works WHERE team_id = :team AND (:user = 0 OR user_id = :user) AND (:user <> 0 OR work_status NOT IN ('preparing', 'failed')) AND (:status = '' OR work_status = :status)")
                .bind("team", teamId).bind("user", userId).bind("status", status).map((row, metadata) -> row.get(0, Long.class)).one();
    }

    /**
     * 上传前登记本次分配的专用对象键，异常退出后仍可清理。
     * @param code 分享标识
     * @param asset 媒体内部记录
     * @return 完成信号
     */
    public Mono<Void> addMedia(String code, JSONObject asset) {
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("INSERT INTO shared_work_media(share_code, asset_id, storage_id, object_key, file_name, mime_type, file_bytes, cover_object_key, cover_mime_type) VALUES (:code, :asset, :storage, :key, :name, :mime, :bytes, :cover, :coverMime)")
                .bind("code", code).bind("asset", asset.getString("assetId")).bind("storage", asset.getString("storageId"))
                .bind("key", asset.getString("objectKey")).bind("name", asset.getString("fileName"))
                .bind("mime", asset.getString("mimeType")).bind("bytes", asset.getLongValue("fileBytes"));
        spec = R2dbcBindings.bindNullable(spec, "cover", asset.getString("coverObjectKey"), String.class);
        spec = R2dbcBindings.bindNullable(spec, "coverMime", asset.getString("coverMimeType"), String.class);
        return spec.fetch().rowsUpdated().then();
    }

    /**
     * 回填媒体副本的封面对象键。
     * @param code 分享标识
     * @param assetId 媒体标识
     * @param coverObjectKey 封面对象键
     * @param coverMimeType 封面媒体类型
     * @return 完成信号
     */
    public Mono<Void> updateMediaCover(String code, String assetId, String coverObjectKey, String coverMimeType) {
        return databaseClient.sql("UPDATE shared_work_media SET cover_object_key = :cover, cover_mime_type = :mime WHERE share_code = :code AND asset_id = :asset")
                .bind("cover", coverObjectKey).bind("mime", coverMimeType).bind("code", code).bind("asset", assetId)
                .fetch().rowsUpdated().then();
    }

    /**
     * 读取仍未清理的媒体内部信息。
     * @param code 分享标识
     * @return 按标识稳定排序的媒体
     */
    public Flux<JSONObject> media(String code) {
        return queries.query("SELECT * FROM shared_work_media WHERE share_code = :code AND cleaned_at IS NULL ORDER BY asset_id", Map.of("code", code));
    }

    /**
     * 找出已提交但缺少封面的视频媒体，供补齐首页卡片封面。
     *
     * @param limit 单次最多处理条数
     * @return 待补封面的媒体记录
     */
    public Flux<JSONObject> missingVideoCovers(int limit) {
        return queries.query("""
                SELECT media.* FROM shared_work_media media JOIN shared_works works USING(share_code)
                WHERE media.cleaned_at IS NULL AND media.mime_type LIKE 'video/%'
                  AND (media.cover_object_key IS NULL OR media.cover_object_key = '')
                  AND works.work_status IN ('pending', 'published')
                ORDER BY works.published_at DESC NULLS LAST, media.share_code
                LIMIT :limit
                """, Map.of("limit", limit));
    }

    /**
     * 用期望状态进行原子更新，避免审核与撤回互相覆盖。
     * @param code 分享标识
     * @param teamId 操作空间
     * @param previous 期望状态
     * @param next 目标状态
     * @param reason 操作原因
     * @return 是否命中唯一作品
     */
    public Mono<Boolean> transition(String code, long teamId, String previous, String next, String reason) {
        return databaseClient.sql("""
                UPDATE shared_works SET work_status = :next, review_reason = :reason, updated_at = CURRENT_TIMESTAMP,
                    published_at = CASE WHEN :next = 'published' THEN CURRENT_TIMESTAMP ELSE published_at END
                WHERE share_code = :code AND team_id = :team AND work_status = :previous
                """).bind("next", next).bind("reason", reason).bind("code", code).bind("team", teamId)
                .bind("previous", previous).fetch().rowsUpdated().map(count -> count == 1);
    }

    /**
     * 记录状态操作审计。
     * @param code 分享标识
     * @param userId 操作人
     * @param previous 原状态
     * @param next 新状态
     * @param reason 原因
     * @return 完成信号
     */
    public Mono<Void> reviewLog(String code, long userId, String previous, String next, String reason) {
        return databaseClient.sql("INSERT INTO shared_work_reviews(share_code, operator_user_id, previous_status, next_status, reason) VALUES (:code, :user, :previous, :next, :reason)")
                .bind("code", code).bind("user", userId).bind("previous", previous).bind("next", next).bind("reason", reason)
                .fetch().rowsUpdated().then();
    }

    /**
     * 找出失败、撤回或进程中断的未完成媒体。
     * @return 待清理媒体
     */
    public Flux<JSONObject> cleanupMedia() {
        return queries.query("""
                SELECT media.* FROM shared_work_media media JOIN shared_works works USING(share_code)
                WHERE media.cleaned_at IS NULL AND (works.work_status IN ('failed', 'withdrawn')
                    OR (works.work_status = 'preparing' AND works.updated_at < CURRENT_TIMESTAMP - INTERVAL '2 hours'))
                LIMIT 200
                """, Map.of());
    }

    /**
     * 标记媒体已交给持久化删除队列。
     * @param code 作品标识
     * @param assetId 媒体标识
     * @return 完成信号
     */
    public Mono<Void> markCleaned(String code, String assetId) {
        return databaseClient.sql("UPDATE shared_work_media SET cleaned_at = CURRENT_TIMESTAMP WHERE share_code = :code AND asset_id = :asset")
                .bind("code", code).bind("asset", assetId).fetch().rowsUpdated().then();
    }

    /**
     * 为长媒体准备过程续租，防止清理器处理仍在工作的投稿。
     * @param code 分享标识
     * @return 完成信号
     */
    public Mono<Void> heartbeat(String code) {
        return databaseClient.sql("UPDATE shared_works SET updated_at = CURRENT_TIMESTAMP WHERE share_code = :code AND work_status = 'preparing'")
                .bind("code", code).fetch().rowsUpdated().then();
    }

    /** 将中断准备标记为失败，后续按媒体关联登记清理。 @return 状态更新完成信号 */
    public Mono<Void> expirePreparations() {
        return databaseClient.sql("UPDATE shared_works SET work_status = 'failed', review_reason = '准备过程已中断，请重新分享', updated_at = CURRENT_TIMESTAMP WHERE work_status = 'preparing' AND updated_at < CURRENT_TIMESTAMP - INTERVAL '2 hours'")
                .fetch().rowsUpdated().then();
    }

    /**
     * 首页只查官方顶部精选之外的内容，合并所有已公开投稿后统一筛选分页。
     * @param type 媒体类型
     * @param category 分类
     * @param keyword 搜索词
     * @param viewer 当前访客标识，未登录为零
     * @param offset 偏移
     * @param countOnly 是否只统计
     * @return 合并后的内部卡片记录，非统计查询附带点赞总数和当前访客点赞状态
     */
    public Flux<JSONObject> fantastic(String type, String category, String keyword, long viewer, long offset, boolean countOnly) {
        String projection = countOnly ? "COUNT(*) total" : """
                combined.*, COALESCE(likes.like_count, 0) like_count,
                EXISTS (SELECT 1 FROM fantastic_work_likes mine
                    WHERE mine.target_key = combined.source || ':' || combined.identifier AND mine.user_id = :viewer) liked""";
        String likesJoin = countOnly ? "" : """
                 LEFT JOIN (SELECT target_key, COUNT(*) like_count FROM fantastic_work_likes GROUP BY target_key) likes
                    ON likes.target_key = combined.source || ':' || combined.identifier""";
        String pagination = countOnly ? "" : " ORDER BY like_count DESC, display_time DESC, source, identifier LIMIT 8 OFFSET :offset";
        String sql = """
                WITH official AS (
                    SELECT *, ROW_NUMBER() OVER (ORDER BY sort_order, updated_at DESC, id DESC) position
                    FROM homepage_showcases WHERE deleted_at IS NULL AND status = 1
                ), combined AS (
                    SELECT 'official' source, id::text identifier, '' share_code, title, description, category, creator_name,
                        media_type work_type, media_url, thumbnail_url, target_path, prompt_content, updated_at display_time
                    FROM official WHERE position > 3
                    UNION ALL
                    SELECT 'user', share_code, share_code, title, description, category, creator_name, work_type,
                        '', '', '', '', published_at FROM shared_works WHERE work_status = 'published'
                ) SELECT %s FROM combined %s
                WHERE (:type = '' OR work_type = :type) AND (:category = '' OR category = :category)
                  AND (:keyword = '' OR STRPOS(LOWER(title || ' ' || description || ' ' || creator_name), LOWER(:keyword)) > 0)
                """.formatted(projection, likesJoin) + pagination;
        Map<String, Object> bindings = new java.util.HashMap<>(Map.of("type", type, "category", category, "keyword", keyword));
        if (!countOnly) { bindings.put("offset", offset); bindings.put("viewer", viewer); }
        return queries.query(sql, bindings);
    }

    /**
     * 切换点赞：首次写入，已点赞则删除，同一用户对同一内容始终只有一条记录。
     * @param targetKey 内容标识
     * @param userId 点赞用户
     * @return 切换后是否处于已点赞状态
     */
    public Mono<Boolean> toggleLike(String targetKey, long userId) {
        return databaseClient.sql("INSERT INTO fantastic_work_likes(target_key, user_id) VALUES (:target, :user) ON CONFLICT DO NOTHING")
                .bind("target", targetKey).bind("user", userId).fetch().rowsUpdated()
                .flatMap(changed -> changed == 1 ? Mono.just(true)
                        : databaseClient.sql("DELETE FROM fantastic_work_likes WHERE target_key = :target AND user_id = :user")
                        .bind("target", targetKey).bind("user", userId).fetch().rowsUpdated().thenReturn(false));
    }

    /**
     * 统计内容点赞总数。
     * @param targetKey 内容标识
     * @return 点赞总数
     */
    public Mono<Long> likeCount(String targetKey) {
        return databaseClient.sql("SELECT COUNT(*) FROM fantastic_work_likes WHERE target_key = :target")
                .bind("target", targetKey).map((row, metadata) -> row.get(0, Long.class)).one();
    }

    /**
     * 确认内容仍按当前规则在首页可见，避免为不存在或已下架的内容点赞。
     * @param targetKey 内容标识
     * @return 是否可见
     */
    public Mono<Boolean> fantasticVisible(String targetKey) {
        return databaseClient.sql("""
                SELECT EXISTS (
                    SELECT 1 FROM homepage_showcases WHERE 'official:' || id = :target AND deleted_at IS NULL AND status = 1
                    UNION ALL
                    SELECT 1 FROM shared_works WHERE 'user:' || share_code = :target AND work_status = 'published'
                )
                """).bind("target", targetKey).map((row, metadata) -> row.get(0, Boolean.class)).one();
    }

    /** @param id 复制任务 @param userId 接收者 @param manifest 对象预分配清单 @return 完成信号 */
    public Mono<Void> createCopy(String id, long userId, com.alibaba.fastjson2.JSONArray manifest) {
        return databaseClient.sql("INSERT INTO shared_work_copy_jobs(id, user_id, copy_status, media_manifest) VALUES (:id, :user, 'preparing', CAST(:manifest AS jsonb))")
                .bind("id", id).bind("user", userId).bind("manifest", JSON.toJSONString(manifest)).fetch().rowsUpdated().then();
    }

    /** @param id 复制任务 @param status 新状态 @return 完成信号 */
    public Mono<Void> copyStatus(String id, String status) {
        return databaseClient.sql("UPDATE shared_work_copy_jobs SET copy_status = :status, updated_at = CURRENT_TIMESTAMP WHERE id = :id")
                .bind("id", id).bind("status", status).fetch().rowsUpdated().then();
    }

    /** @return 失败或进程中断且需要回收的复制清单 */
    public Flux<JSONObject> unfinishedCopies() {
        return queries.query("SELECT id, user_id, media_manifest::text manifest FROM shared_work_copy_jobs WHERE copy_status = 'failed' OR (copy_status = 'preparing' AND updated_at < CURRENT_TIMESTAMP - INTERVAL '2 hours') LIMIT 100", Map.of());
    }

    /** @param id 已交给持久化删除队列的复制任务 @return 完成信号 */
    public Mono<Void> removeCopy(String id) {
        return databaseClient.sql("DELETE FROM shared_work_copy_jobs WHERE id = :id AND copy_status <> 'completed'").bind("id", id).fetch().rowsUpdated().then();
    }
}

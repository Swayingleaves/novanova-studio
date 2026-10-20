package com.novanovastudio.repository;

import com.alibaba.fastjson2.JSONObject;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.r2dbc.core.DatabaseClient;
import org.springframework.stereotype.Repository;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * 以实际对象台账查询和删除本人云文件，不依赖收藏或媒体引用的数量。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-20 12:00
 */
@Repository
@RequiredArgsConstructor
public class StorageFileRepository {
    /** 参数化数据库访问。 */
    private final DatabaseClient databaseClient;
    /** 驼峰字段映射。 */
    private final TeamRepository teamRepository;
    /** 列表和数量查询共用条件，所有查询均显式限定当前空间和本人。 */
    private static final String FILE_FILTER = " FROM storage_objects WHERE team_id = current_team_id() AND user_id = :user AND deleted_at IS NULL AND (:category = '' OR file_category = :category) AND (:keyword = '' OR POSITION(LOWER(:keyword) IN LOWER(file_name)) > 0)";

    /**
     * @param userId 当前用户
     * @param category 经过校验的分类
     * @param keyword 原样文件名搜索词，不解释为通配符
     * @return 匹配的物理对象数量
     */
    public Mono<Long> count(long userId, String category, String keyword) {
        return databaseClient.sql("SELECT COUNT(*) total" + FILE_FILTER).bind("user", userId)
                .bind("category", category).bind("keyword", keyword).map((row, metadata) -> row.get("total", Long.class)).one();
    }

    /**
     * @param userId 当前用户
     * @param category 文件分类
     * @param keyword 文件名搜索词
     * @param sort 经过服务校验的排序方式
     * @param offset 跳过条数
     * @param limit 返回条数
     * @return 不含存储凭证、对象键或长期访问地址的文件列表
     */
    public Flux<JSONObject> list(long userId, String category, String keyword, String sort, long offset, int limit) {
        String order = switch (sort) {
            case "oldest" -> "stored_at ASC, id ASC";
            case "largest" -> "file_bytes DESC, id DESC";
            case "smallest" -> "file_bytes ASC, id ASC";
            default -> "stored_at DESC, id DESC";
        };
        return teamRepository.query("SELECT id::TEXT object_id, file_name, file_category category, mime_type, source_type, file_bytes::TEXT file_bytes, stored_at, CASE WHEN deletion_requested_at IS NULL THEN 'available' WHEN NULLIF(deletion_error, '') IS NOT NULL THEN 'deletionFailed' ELSE 'pendingDeletion' END status"
                + FILE_FILTER + " ORDER BY " + order + " LIMIT :limit OFFSET :offset",
                Map.of("user", userId, "category", category, "keyword", keyword, "limit", limit, "offset", offset));
    }

    /**
     * 在短事务中锁定本人对象，协调签名和删除；已删除记录仍可用于幂等判断。
     * @param userId 当前用户
     * @param objectId 对象标识
     * @return 完整内部对象，不可直接返回客户端
     */
    public Mono<JSONObject> lockOwned(long userId, long objectId) {
        return teamRepository.query("SELECT id::TEXT object_id, storage_id, object_key, file_name, file_category category, mime_type, deletion_requested_at, deleted_at FROM storage_objects WHERE team_id = current_team_id() AND user_id = :user AND id = :id FOR UPDATE",
                Map.of("user", userId, "id", objectId)).singleOrEmpty();
    }

    /**
     * @param userId 当前用户
     * @param objectId 已校验所有权的对象标识
     * @return 标记完成信号，物理删除成功前仍占用容量
     */
    public Mono<Void> requestDeletion(long userId, long objectId) {
        return databaseClient.sql("UPDATE storage_objects SET deletion_requested_at = COALESCE(deletion_requested_at, CURRENT_TIMESTAMP), deletion_error = NULL, deletion_last_attempt_at = NULL WHERE team_id = current_team_id() AND user_id = :user AND id = :id AND deleted_at IS NULL")
                .bind("user", userId).bind("id", objectId).fetch().rowsUpdated().then();
    }
}

package com.novanovastudio.repository;

import com.alibaba.fastjson2.JSONObject;
import java.util.Map;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Repository;
import reactor.core.publisher.Mono;

/**
 * 从持久化任务恢复空间信息，表名仅允许固定业务白名单。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-18 10:00
 */
@Repository
@RequiredArgsConstructor
public class TeamTaskRepository {
    /** 已实现异步执行的业务表。 */
    private static final Set<String> TABLES = Set.of("ai_generation_tasks", "story_bible_analysis_jobs",
            "novel_adaptation_jobs", "script_source_import_tasks", "video_composition_tasks", "agent_session", "creation_agent_request");
    /** 统一结果映射。 */
    private final TeamRepository repository;

    /**
     * 使用当前空间的行级策略验证工具结果所指向的原会话。
     * @param userId 当前用户
     * @param sessionId 原会话标识
     * @return 是否拥有当前空间会话
     */
    public Mono<Boolean> ownsSession(long userId, String sessionId) {
        return repository.query("SELECT id FROM agent_session WHERE id = :id AND user_id = :userId", Map.of("id", sessionId, "userId", userId)).hasElements();
    }

    /**
     * 从原始任务读取空间和用户，调用方仅给此查询系统访问权限。
     * @param table 白名单任务表
     * @param taskId 任务标识
     * @return 任务创建时的归属
     */
    public Mono<JSONObject> findScope(String table, String taskId) {
        if (!TABLES.contains(table)) return Mono.error(new IllegalArgumentException("不支持的团队任务类型"));
        String selection = "script_source_import_tasks".equals(table)
                ? "SELECT tasks.team_id, documents.user_id FROM script_source_import_tasks tasks JOIN script_source_documents documents ON documents.id = tasks.document_id WHERE tasks.id = :id"
                : "SELECT team_id, user_id" + (Set.of("ai_generation_tasks", "video_composition_tasks", "creation_agent_request").contains(table) ? ", storage_id_snapshot" : "") + " FROM " + table + " WHERE id = :id";
        return repository.query(selection, Map.of("id", taskId)).singleOrEmpty();
    }
}

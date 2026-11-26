package com.novanovastudio.repository;

import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.r2dbc.core.DatabaseClient;
import org.springframework.stereotype.Repository;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * 按媒体存储键、对象键和历史地址检查仍然有效的业务引用。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-11-26 21:38
 */
@Repository
@RequiredArgsConstructor
public class StorageReferenceRepository {

    /** 读取引用时显式限定媒体所有者和团队空间。 */
    private final DatabaseClient databaseClient;

    /** 对一批候选对象只扫描一次当前用户的业务快照。 */
    private static final String REFERENCE_LOOKUP = """
            WITH targets AS (%s),
            snapshots AS (
                SELECT asset_data AS data FROM assets WHERE team_id = :teamId AND user_id = :userId AND status = 1
                UNION ALL SELECT project_data FROM canvas_projects WHERE team_id = :teamId AND user_id = :userId AND status = 1
                UNION ALL SELECT log_data FROM generation_logs WHERE team_id = :teamId AND user_id = :userId AND status = 1
                UNION ALL SELECT request_data FROM ai_generation_tasks
                    WHERE team_id = :teamId AND user_id = :userId AND status IN ('pending', 'queued', 'running')
                UNION ALL SELECT source_storage_keys FROM video_composition_tasks
                    WHERE team_id = :teamId AND user_id = :userId AND status IN ('pending', 'queued', 'running')
                UNION ALL SELECT result.result_data FROM comic_drama_media_results result
                    JOIN comic_drama_projects project USING (script_project_id)
                    WHERE project.team_id = :teamId AND project.user_id = :userId
                UNION ALL SELECT version.reference_media FROM comic_drama_asset_versions version
                    JOIN comic_drama_assets asset ON asset.id = version.asset_id
                    JOIN comic_drama_projects project ON project.script_project_id = asset.script_project_id
                    WHERE project.team_id = :teamId AND project.user_id = :userId
            ),
            reference_values AS (
                SELECT item.value #>> '{}' AS value
                FROM snapshots CROSS JOIN LATERAL jsonb_path_query(data, 'strict $.** ? (@.type() == "string")') item(value)
                UNION ALL SELECT storage_key FROM drama_media WHERE team_id = :teamId AND user_id = :userId
                UNION ALL SELECT result_url FROM drama_media WHERE team_id = :teamId AND user_id = :userId
                UNION ALL SELECT voice.audio_storage_key FROM comic_drama_voice_tracks voice
                    JOIN comic_drama_projects project USING (script_project_id)
                    WHERE project.team_id = :teamId AND project.user_id = :userId
                UNION ALL SELECT cover_url FROM script_projects WHERE team_id = :teamId AND user_id = :userId AND status = 1
                UNION ALL SELECT cover_url FROM generation_styles WHERE team_id = :teamId AND deleted_at IS NULL
                UNION ALL SELECT cover_url FROM skills WHERE team_id = :teamId AND deleted_at IS NULL
                UNION ALL SELECT cover_url FROM prompt_library WHERE team_id = :teamId AND deleted_at IS NULL
                UNION ALL SELECT media_url FROM homepage_showcases WHERE team_id = :teamId AND deleted_at IS NULL
                UNION ALL SELECT thumbnail_url FROM homepage_showcases WHERE team_id = :teamId AND deleted_at IS NULL
            ),
            normalized_references AS MATERIALIZED (
                SELECT DISTINCT split_part(split_part(value, '?', 1), '#', 1) AS value FROM reference_values
                WHERE length(value) BETWEEN 1 AND 2048
            )
            SELECT DISTINCT target.identifier FROM targets target
            WHERE EXISTS (
                SELECT 1 FROM normalized_references reference
                WHERE reference.value IN (target.storage_key, target.object_key, target.cover_key,
                    split_part(split_part(target.object_url, '?', 1), '#', 1),
                    split_part(split_part(target.source_url, '?', 1), '#', 1))
            ) OR EXISTS (
                SELECT 1 FROM script_source_documents document JOIN script_projects project ON project.id = document.project_id
                WHERE project.team_id = :teamId AND project.user_id = :userId AND project.status = 1
                  AND document.storage_config_id = target.storage_id AND document.object_key = target.object_key
            ) OR EXISTS (
                SELECT 1 FROM platform_oauth_clients client
                WHERE client.logo_storage_id = target.storage_id AND client.logo_object_key = target.object_key
            ) OR EXISTS (
                SELECT 1 FROM shared_work_media media JOIN shared_works work USING (share_code)
                WHERE media.storage_id = target.storage_id AND media.cleaned_at IS NULL
                  AND work.work_status NOT IN ('withdrawn', 'failed')
                  AND (work.work_status <> 'preparing' OR work.updated_at >= CURRENT_TIMESTAMP - INTERVAL '2 hours')
                  AND (media.object_key IN (target.object_key, target.cover_key)
                       OR media.cover_object_key IN (target.object_key, target.cover_key))
            ) OR EXISTS (
                SELECT 1 FROM shared_work_copy_jobs copy
                WHERE copy.copy_status = 'preparing' AND copy.updated_at >= CURRENT_TIMESTAMP - INTERVAL '2 hours'
                  AND (copy.media_manifest @> jsonb_build_array(jsonb_build_object('targetStorageId', target.storage_id, 'targetObjectKey', target.object_key))
                       OR copy.media_manifest @> jsonb_build_array(jsonb_build_object('targetStorageId', target.storage_id, 'targetObjectKey', target.cover_key)))
            )
            """;

    /**
     * 筛出仍被引用的媒体，调用方只回收其余候选。
     *
     * @param teamId 媒体所属空间
     * @param userId 媒体所属用户
     * @param storageKeys 候选媒体键
     * @return 仍被引用的候选媒体键
     */
    public Flux<String> referencedMedia(long teamId, long userId, List<String> storageKeys) {
        if (storageKeys.isEmpty()) return Flux.empty();
        return scopedQuery(teamId, userId, """
                SELECT media.storage_key AS identifier, media.storage_key, media.object_storage_config_id AS storage_id,
                       media.object_storage_key AS object_key, media.metadata->>'coverObjectKey' AS cover_key,
                       media.object_storage_url AS object_url, media.source_url
                FROM media_files media
                WHERE media.team_id = :teamId AND media.user_id = :userId AND media.storage_key IN (:storageKeys)
                """)
                .bind("storageKeys", storageKeys).map((row, metadata) -> row.get("identifier", String.class)).all();
    }

    /**
     * 对象台账的任意文件都可查询，包括没有媒体记录的原文或分享副本。
     *
     * @param teamId 对象所属空间
     * @param userId 对象所属用户
     * @param objectIds 台账对象标识
     * @return 仍被引用的对象标识
     */
    public Flux<Long> referencedObjects(long teamId, long userId, List<Long> objectIds) {
        if (objectIds.isEmpty()) return Flux.empty();
        return scopedQuery(teamId, userId, """
                SELECT file.id AS identifier, media.storage_key, file.storage_id, file.object_key,
                       media.metadata->>'coverObjectKey' AS cover_key, media.object_storage_url AS object_url, media.source_url
                FROM storage_objects file LEFT JOIN media_files media
                  ON media.team_id = file.team_id AND media.user_id = file.user_id AND media.object_storage_config_id = file.storage_id
                 AND (media.object_storage_key = file.object_key OR media.metadata->>'coverObjectKey' = file.object_key)
                WHERE file.team_id = :teamId AND file.user_id = :userId AND file.id IN (:objectIds)
                """)
                .bind("objectIds", objectIds).map((row, metadata) -> row.get("identifier", Long.class)).all();
    }

    /**
     * 绑定业务作用域，候选的查询结构由仓储内部提供。
     *
     * @param teamId 业务空间
     * @param userId 文件所属用户
     * @param targets 固定候选查询
     * @return 引用查询规格
     */
    private DatabaseClient.GenericExecuteSpec scopedQuery(long teamId, long userId, String targets) {
        return databaseClient.sql(REFERENCE_LOOKUP.formatted(targets)).bind("teamId", teamId).bind("userId", userId);
    }
}

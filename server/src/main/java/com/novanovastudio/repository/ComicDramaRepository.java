package com.novanovastudio.repository;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.dto.AiTaskDtos;
import com.novanovastudio.dto.ComicDramaDtos;
import com.novanovastudio.dto.StoryboardDtos;
import io.r2dbc.spi.Row;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.r2dbc.core.DatabaseClient;
import org.springframework.stereotype.Repository;
import org.springframework.util.StringUtils;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * 漫剧生产关系数据仓储。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-09-21 10:20
 */
@Repository
@RequiredArgsConstructor
public class ComicDramaRepository {

    /** 响应式数据库客户端。 */
    private final DatabaseClient databaseClient;

    /** 漫剧项目数据库记录。 */
    public record ProjectRecord(String projectId, Long userId, String title, String productionStatus,
                                long revision, int textTrackCount, OffsetDateTime createdAt, OffsetDateTime updatedAt) {
    }

    /** 分镜生成需要的共享剧本正文与项目视觉风格。 */
    public record ShotGenerationSource(String scriptContent, String visualStyle, long scriptRevision) {
    }

    /**
     * 分页查询当前用户的漫剧项目。
     *
     * @param userId 当前用户ID
     * @param keyword 标题搜索词
     * @param offset 分页偏移
     * @param limit 每页数量
     * @return 项目摘要流
     */
    public Flux<ComicDramaDtos.ProjectSummary> listProjects(Long userId, String keyword, int offset, int limit) {
        return databaseClient.sql("""
                SELECT c.script_project_id, s.title, st.project_type, c.production_status stage, c.revision, c.updated_at,
                       assets.asset_count,shots.shot_count,shots.completed_count,impacts.impact_count,media.running_count,
                       CASE WHEN assets.asset_count+shots.shot_count=0 THEN 0 ELSE
                           ((assets.ready_count+shots.completed_count)*100/(assets.asset_count+shots.shot_count))::INTEGER
                       END completion_rate,
                       CASE WHEN s.synopsis='' OR NOT EXISTS (SELECT 1 FROM script_episodes e WHERE e.project_id=s.id) THEN 'missing'
                            WHEN NOT EXISTS (SELECT 1 FROM script_characters ch WHERE ch.project_id=s.id)
                              OR NOT EXISTS (SELECT 1 FROM script_locations lo WHERE lo.project_id=s.id) THEN 'attention'
                            ELSE 'ready' END readiness
                FROM comic_drama_projects c
                JOIN script_projects s ON s.id=c.script_project_id AND s.status=1
                JOIN comic_drama_project_settings st ON st.script_project_id=c.script_project_id
                CROSS JOIN LATERAL (SELECT COUNT(*)::INTEGER asset_count,
                    COUNT(*) FILTER (WHERE usage_status='active')::INTEGER ready_count
                    FROM comic_drama_assets WHERE script_project_id=c.script_project_id) assets
                CROSS JOIN LATERAL (SELECT COUNT(*)::INTEGER shot_count,
                    COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM comic_drama_media_results adopted
                        WHERE adopted.script_project_id=c.script_project_id AND adopted.target_type='shot'
                          AND adopted.target_id=sh.id AND adopted.status='completed' AND adopted.adopted=TRUE))::INTEGER completed_count
                    FROM comic_drama_shots sh WHERE sh.script_project_id=c.script_project_id) shots
                CROSS JOIN LATERAL (SELECT COUNT(*) FILTER (WHERE status='pending')::INTEGER impact_count
                    FROM comic_drama_change_impacts WHERE script_project_id=c.script_project_id) impacts
                CROSS JOIN LATERAL (SELECT COUNT(*) FILTER (WHERE status IN ('queued','processing'))::INTEGER running_count
                    FROM comic_drama_media_results WHERE script_project_id=c.script_project_id) media
                WHERE c.user_id=:userId AND (:keyword='' OR s.title ILIKE '%' || :keyword || '%')
                ORDER BY c.updated_at DESC, c.script_project_id OFFSET :offset LIMIT :limit
                """).bind("userId", userId).bind("keyword", text(keyword)).bind("offset", offset).bind("limit", limit)
                .map((row, metadata) -> new ComicDramaDtos.ProjectSummary(
                        row.get("script_project_id", String.class), row.get("script_project_id", String.class),
                        row.get("title", String.class), row.get("project_type", String.class), row.get("stage", String.class),
                        value(row, "completion_rate", Integer.class, 0),
                        value(row, "asset_count", Integer.class, 0), value(row, "shot_count", Integer.class, 0),
                        value(row, "completed_count", Integer.class, 0), value(row, "impact_count", Integer.class, 0),
                        value(row, "running_count", Integer.class, 0), row.get("readiness", String.class),
                        value(row, "revision", Long.class, 0L), row.get("updated_at", OffsetDateTime.class))).all();
    }

    /**
     * 统计当前用户漫剧项目数量。
     *
     * @param userId 当前用户ID
     * @param keyword 标题搜索词
     * @return 项目总数
     */
    public Mono<Long> countProjects(Long userId, String keyword) {
        return databaseClient.sql("""
                SELECT COUNT(*) total FROM comic_drama_projects c JOIN script_projects s ON s.id=c.script_project_id
                WHERE c.user_id=:userId AND s.status=1 AND (:keyword='' OR s.title ILIKE '%' || :keyword || '%')
                """).bind("userId", userId).bind("keyword", text(keyword))
                .map((row, metadata) -> value(row, "total", Long.class, 0L)).one();
    }

    /**
     * 初始化当前用户拥有的共享剧本项目。
     *
     * @param userId 当前用户ID
     * @param projectId 共享剧本项目ID
     * @param projectType 项目类型
     * @return 初始化完成信号
     */
    public Mono<Void> initializeProject(Long userId, String projectId, String projectType) {
        Mono<Long> projectInsert = databaseClient.sql("""
                INSERT INTO comic_drama_projects(script_project_id, user_id)
                SELECT id, user_id FROM script_projects WHERE id=:projectId AND user_id=:userId AND status=1
                ON CONFLICT (script_project_id) DO NOTHING
                """).bind("projectId", projectId).bind("userId", userId).fetch().rowsUpdated();
        Mono<Long> settingsInsert = databaseClient.sql("""
                INSERT INTO comic_drama_project_settings(script_project_id, project_type, target_episode_count,
                    total_duration_seconds, episode_duration_seconds)
                SELECT p.id, :projectType, p.target_episode_count, p.target_duration_seconds,
                       CASE WHEN p.target_episode_count > 0 THEN p.target_duration_seconds / p.target_episode_count ELSE 0 END
                FROM script_projects p JOIN comic_drama_projects c ON c.script_project_id=p.id
                WHERE p.id=:projectId AND c.user_id=:userId
                ON CONFLICT (script_project_id) DO NOTHING
                """).bind("projectType", projectType).bind("projectId", projectId).bind("userId", userId).fetch().rowsUpdated();
        return projectInsert.then(settingsInsert).then();
    }

    /**
     * 按当前用户查询漫剧项目。
     *
     * @param userId 当前用户ID
     * @param projectId 项目ID
     * @return 项目记录
     */
    public Mono<ProjectRecord> getProject(Long userId, String projectId) {
        return databaseClient.sql("""
                SELECT c.script_project_id, c.user_id, s.title, c.production_status, c.revision, c.text_track_count,
                       c.created_at, c.updated_at
                FROM comic_drama_projects c JOIN script_projects s ON s.id=c.script_project_id AND s.status=1
                WHERE c.script_project_id=:projectId AND c.user_id=:userId
                """).bind("projectId", projectId).bind("userId", userId).map((row, metadata) -> new ProjectRecord(
                        row.get("script_project_id", String.class), row.get("user_id", Long.class), row.get("title", String.class),
                        row.get("production_status", String.class), value(row, "revision", Long.class, 0L),
                        value(row, "text_track_count", Integer.class, 1),
                        row.get("created_at", OffsetDateTime.class), row.get("updated_at", OffsetDateTime.class))).one();
    }

    /**
     * 使用乐观锁推进项目修订号。
     *
     * @param userId 当前用户ID
     * @param projectId 项目ID
     * @param expectedRevision 期望修订号
     * @return 新修订号，冲突时为空
     */
    public Mono<Long> advanceRevision(Long userId, String projectId, long expectedRevision) {
        return databaseClient.sql("""
                UPDATE comic_drama_projects SET revision=revision+1, updated_at=CURRENT_TIMESTAMP
                WHERE script_project_id=:projectId AND user_id=:userId AND revision=:expectedRevision
                RETURNING revision
                """).bind("projectId", projectId).bind("userId", userId).bind("expectedRevision", expectedRevision)
                .map((row, metadata) -> value(row, "revision", Long.class, 0L)).one();
    }

    /** 查询项目生产设置。 */
    public Mono<ComicDramaDtos.ProductionSettings> getSettings(String projectId) {
        return databaseClient.sql("SELECT * FROM comic_drama_project_settings WHERE script_project_id=:projectId")
                .bind("projectId", projectId).map((row, metadata) -> new ComicDramaDtos.ProductionSettings(
                        row.get("project_type", String.class), value(row, "target_episode_count", Integer.class, 1),
                        value(row, "episode_duration_seconds", Integer.class, 0), value(row, "total_duration_seconds", Integer.class, 0),
                        row.get("orientation", String.class), row.get("aspect_ratio", String.class),
                        row.get("visual_style", String.class), row.get("period_atmosphere", String.class),
                        row.get("target_platform", String.class), row.get("use_case", String.class))).one();
    }

    /** 更新项目生产设置。 */
    public Mono<Void> updateSettings(String projectId, ComicDramaDtos.ProductionSettings settings) {
        return databaseClient.sql("""
                UPDATE comic_drama_project_settings SET project_type=:projectType, target_episode_count=:episodeCount,
                    episode_duration_seconds=:episodeDuration, total_duration_seconds=:totalDuration,
                    orientation=:orientation, aspect_ratio=:aspectRatio, visual_style=:visualStyle,
                    period_atmosphere=:atmosphere, target_platform=:targetPlatform, use_case=:useCase, updated_at=CURRENT_TIMESTAMP
                WHERE script_project_id=:projectId
                """).bind("projectType", settings.projectType()).bind("episodeCount", settings.targetEpisodeCount())
                .bind("episodeDuration", settings.episodeTargetDuration()).bind("totalDuration", settings.overallDuration())
                .bind("orientation", settings.orientation()).bind("aspectRatio", settings.aspectRatio())
                .bind("visualStyle", text(settings.visualStyle())).bind("atmosphere", text(settings.eraAtmosphere()))
                .bind("targetPlatform", text(settings.targetPlatform())).bind("useCase", text(settings.useCase()))
                .bind("projectId", projectId).fetch().rowsUpdated().then();
    }

    /** 查询项目视觉资产。 */
    public Flux<ComicDramaDtos.Asset> listAssets(String projectId, String assetType) {
        return databaseClient.sql("""
                SELECT * FROM comic_drama_assets WHERE script_project_id=:projectId
                AND (:assetType='' OR asset_type=:assetType) ORDER BY asset_type, updated_at DESC, id
                """).bind("projectId", projectId).bind("assetType", text(assetType))
                .map((row, metadata) -> mapAsset(row)).all();
    }

    /** 查询单个视觉资产。 */
    public Mono<ComicDramaDtos.Asset> getAsset(String projectId, String assetId) {
        return databaseClient.sql("SELECT * FROM comic_drama_assets WHERE script_project_id=:projectId AND id=:assetId")
                .bind("projectId", projectId).bind("assetId", assetId).map((row, metadata) -> mapAsset(row)).one();
    }

    /**
     * 校验视觉资产来源实体属于当前共享剧本。
     *
     * @param projectId 共享剧本项目标识
     * @param asset 待保存的视觉资产
     * @return 来源为空或归属正确时返回true
     */
    public Mono<Boolean> validateAssetSourceReference(String projectId, ComicDramaDtos.Asset asset) {
        if (asset == null || asset.assetType() == null) {
            return Mono.just(false);
        }
        if (asset.sourceEntityId() == null || asset.sourceEntityId().isBlank()) {
            return Mono.just(true);
        }
        String sceneExists = "EXISTS (SELECT 1 FROM script_scenes s JOIN script_episodes e ON e.id=s.episode_id "
                + "WHERE e.project_id=:projectId AND s.id=:sourceEntityId)";
        String locationExists = "EXISTS (SELECT 1 FROM script_locations WHERE project_id=:projectId AND id=:sourceEntityId)";
        String characterExists = "EXISTS (SELECT 1 FROM script_characters WHERE project_id=:projectId AND id=:sourceEntityId)";
        String sql = switch (asset.assetType()) {
            case "character" -> "SELECT " + characterExists + " AS valid";
            case "scene" -> "SELECT (" + locationExists + " OR " + sceneExists + ") AS valid";
            case "prop" -> "SELECT (" + characterExists + " OR " + locationExists + " OR " + sceneExists + ") AS valid";
            default -> null;
        };
        if (sql == null) {
            return Mono.just(false);
        }
        return databaseClient.sql(sql).bind("projectId", projectId).bind("sourceEntityId", asset.sourceEntityId())
                .map((row, metadata) -> Boolean.TRUE.equals(row.get("valid", Boolean.class))).one();
    }

    /** 新增或按实体修订号更新视觉资产。 */
    public Mono<Long> saveAsset(String projectId, ComicDramaDtos.Asset asset) {
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("""
                INSERT INTO comic_drama_assets(id, script_project_id, asset_type, source_entity_id, name, description,
                    voice_preference, usage_status) VALUES (:id,:projectId,:assetType,:sourceEntityId,:name,:description,
                    CAST(:voicePreference AS jsonb),:usageStatus)
                ON CONFLICT (id) DO UPDATE SET asset_type=EXCLUDED.asset_type, source_entity_id=EXCLUDED.source_entity_id,
                    name=EXCLUDED.name, description=EXCLUDED.description, voice_preference=EXCLUDED.voice_preference,
                    usage_status=EXCLUDED.usage_status, revision=comic_drama_assets.revision+1, updated_at=CURRENT_TIMESTAMP
                WHERE comic_drama_assets.script_project_id=EXCLUDED.script_project_id AND comic_drama_assets.revision=:revision
                RETURNING revision
                """).bind("id", asset.id()).bind("projectId", projectId).bind("assetType", asset.assetType());
        spec = bindNullable(spec, "sourceEntityId", asset.sourceEntityId(), String.class);
        return spec.bind("name", asset.name()).bind("description", text(asset.description()))
                .bind("voicePreference", json(asset.voicePreference())).bind("usageStatus", asset.usageStatus())
                .bind("revision", asset.revision()).map((row, metadata) -> value(row, "revision", Long.class, 0L)).one();
    }

    /** 将镜头草稿返回的新资产严格插入当前项目，不覆盖已有稳定标识。 */
    public Mono<Long> createShotDraftAsset(String projectId, ComicDramaDtos.Asset asset) {
        return databaseClient.sql("""
                INSERT INTO comic_drama_assets(id,script_project_id,asset_type,source_entity_id,name,description,
                    voice_preference,usage_status)
                VALUES (:id,:projectId,:assetType,NULL,:name,:description,CAST(:voicePreference AS jsonb),'active')
                ON CONFLICT (id) DO NOTHING
                """).bind("id", asset.id()).bind("projectId", projectId).bind("assetType", asset.assetType())
                .bind("name", asset.name()).bind("description", text(asset.description()))
                .bind("voicePreference", json(asset.voicePreference())).fetch().rowsUpdated();
    }

    /** 查询资产全部版本。 */
    public Flux<ComicDramaDtos.AssetVersion> listAssetVersions(String projectId, String assetId) {
        return databaseClient.sql("""
                SELECT v.* FROM comic_drama_asset_versions v JOIN comic_drama_assets a ON a.id=v.asset_id
                WHERE a.script_project_id=:projectId AND v.asset_id=:assetId ORDER BY v.created_at DESC, v.id
                """).bind("projectId", projectId).bind("assetId", assetId)
                .map((row, metadata) -> mapAssetVersion(row)).all();
    }

    /** 查询单个资产版本。 */
    public Mono<ComicDramaDtos.AssetVersion> getAssetVersion(String projectId, String versionId) {
        return databaseClient.sql("""
                SELECT v.* FROM comic_drama_asset_versions v JOIN comic_drama_assets a ON a.id=v.asset_id
                WHERE a.script_project_id=:projectId AND v.id=:versionId
                """).bind("projectId", projectId).bind("versionId", versionId)
                .map((row, metadata) -> mapAssetVersion(row)).one();
    }

    /** 新增或按实体修订号更新资产版本。 */
    public Mono<Long> saveAssetVersion(ComicDramaDtos.AssetVersion version) {
        return databaseClient.sql("""
                INSERT INTO comic_drama_asset_versions(id,asset_id,version_name,variant_type,appearance_description,
                    reference_media,attributes,status) VALUES (:id,:assetId,:name,:variant,:description,
                    CAST(:media AS jsonb),CAST(:attributes AS jsonb),:status)
                ON CONFLICT (id) DO UPDATE SET version_name=EXCLUDED.version_name, variant_type=EXCLUDED.variant_type,
                    appearance_description=EXCLUDED.appearance_description, reference_media=EXCLUDED.reference_media,
                    attributes=EXCLUDED.attributes, status=EXCLUDED.status,
                    revision=comic_drama_asset_versions.revision+1, updated_at=CURRENT_TIMESTAMP
                WHERE comic_drama_asset_versions.asset_id=EXCLUDED.asset_id AND comic_drama_asset_versions.revision=:revision
                RETURNING revision
                """).bind("id", version.id()).bind("assetId", version.assetId()).bind("name", version.versionName())
                .bind("variant", version.variantType()).bind("description", text(version.appearanceDescription()))
                .bind("media", JSON.toJSONString(version.referenceMedia() == null ? List.of() : version.referenceMedia()))
                .bind("attributes", json(version.attributes())).bind("status", version.status()).bind("revision", version.revision())
                .map((row, metadata) -> value(row, "revision", Long.class, 0L)).one();
    }

    /** 为镜头草稿资产创建不可覆盖的初始版本。 */
    public Mono<Long> createShotDraftAssetVersion(ComicDramaDtos.AssetVersion version) {
        return databaseClient.sql("""
                INSERT INTO comic_drama_asset_versions(id,asset_id,version_name,variant_type,appearance_description,
                    reference_media,attributes,status)
                VALUES (:id,:assetId,:name,:variant,:description,CAST(:media AS jsonb),CAST(:attributes AS jsonb),'active')
                ON CONFLICT (id) DO NOTHING
                """).bind("id", version.id()).bind("assetId", version.assetId()).bind("name", version.versionName())
                .bind("variant", version.variantType()).bind("description", text(version.appearanceDescription()))
                .bind("media", JSON.toJSONString(version.referenceMedia() == null ? List.of() : version.referenceMedia()))
                .bind("attributes", json(version.attributes())).fetch().rowsUpdated();
    }

    /** 加载指定范围的共享剧本正文与视觉风格。 */
    public Mono<ShotGenerationSource> getShotGenerationSource(String projectId, String episodeId, String sceneId) {
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("""
                SELECT COALESCE(string_agg(CASE WHEN b.block_type='dialogue' THEN COALESCE(ch.name || '：','') || b.content
                     ELSE b.content END, E'\n' ORDER BY e.sort_order, sc.sort_order, b.sort_order), '') script_content,
                       st.visual_style, p.revision script_revision
                FROM comic_drama_project_settings st
                JOIN script_projects p ON p.id=st.script_project_id
                LEFT JOIN script_episodes e ON e.project_id=st.script_project_id
                LEFT JOIN script_scenes sc ON sc.episode_id=e.id
                LEFT JOIN script_blocks b ON b.scene_id=sc.id
                LEFT JOIN script_characters ch ON ch.id=b.character_id
                WHERE st.script_project_id=:projectId AND (:episodeId IS NULL OR e.id=:episodeId)
                      AND (:sceneId IS NULL OR sc.id=:sceneId)
                GROUP BY st.visual_style,p.revision
                """).bind("projectId", projectId);
        spec = bindNullable(spec, "episodeId", episodeId, String.class);
        spec = bindNullable(spec, "sceneId", sceneId, String.class);
        return spec.map((row, metadata) -> new ShotGenerationSource(
                row.get("script_content", String.class), row.get("visual_style", String.class),
                value(row, "script_revision", Long.class, 0L))).one();
    }

    /** 查询来源场次所属分集，避免正式镜头丢失分集关联。 */
    public Mono<String> getSceneEpisodeId(String projectId, String sceneId) {
        return databaseClient.sql("""
                SELECT e.id FROM script_scenes s JOIN script_episodes e ON e.id=s.episode_id
                WHERE e.project_id=:projectId AND s.id=:sceneId
                """).bind("projectId", projectId).bind("sceneId", sceneId)
                .map((row, metadata) -> row.get("id", String.class)).one();
    }

    /** 查询镜头实际引用的资产版本并转换为分镜Agent资产输入。 */
    public Flux<StoryboardDtos.StoryboardAsset> listShotStoryboardAssets(String projectId, String shotId) {
        return databaseClient.sql("""
                SELECT v.id,a.asset_type,a.name,v.version_name,v.appearance_description
                FROM comic_drama_shot_asset_versions sav
                JOIN comic_drama_asset_versions v ON v.id=sav.asset_version_id
                JOIN comic_drama_assets a ON a.id=v.asset_id
                JOIN comic_drama_shots sh ON sh.id=sav.shot_id
                WHERE sh.script_project_id=:projectId AND sh.id=:shotId ORDER BY sav.sort_order,v.id
                """).bind("projectId", projectId).bind("shotId", shotId)
                .map((row, metadata) -> new StoryboardDtos.StoryboardAsset(row.get("id", String.class),
                        row.get("asset_type", String.class), row.get("name", String.class) + "-" + row.get("version_name", String.class),
                        row.get("appearance_description", String.class))).all();
    }

    /** 保存待确认镜头草稿。 */
    public Mono<Void> createShotDraft(Long userId, ComicDramaDtos.ShotDraft draft) {
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("""
                INSERT INTO comic_drama_shot_drafts(id,script_project_id,user_id,scope_type,scope_id,
                    base_project_revision,base_script_revision,instruction,model,draft_data,charged_credits)
                VALUES (:id,:projectId,:userId,:scopeType,:scopeId,:baseRevision,:baseScriptRevision,:instruction,:model,
                    CAST(:draftData AS jsonb),:chargedCredits)
                """).bind("id", draft.id()).bind("projectId", draft.projectId()).bind("userId", userId)
                .bind("scopeType", draft.scopeType());
        spec = bindNullable(spec, "scopeId", draft.scopeId(), String.class);
        return spec.bind("baseRevision", draft.baseProjectRevision()).bind("baseScriptRevision", draft.baseScriptRevision())
                .bind("instruction", text(draft.instruction()))
                .bind("model", draft.model()).bind("draftData", json(draft.draftData()))
                .bind("chargedCredits", draft.chargedCredits()).fetch().rowsUpdated().then();
    }

    /** 查询当前用户待确认镜头草稿。 */
    public Mono<ComicDramaDtos.ShotDraft> getPendingShotDraft(Long userId, String projectId, String draftId) {
        return databaseClient.sql("""
                SELECT * FROM comic_drama_shot_drafts WHERE script_project_id=:projectId AND user_id=:userId
                AND id=:draftId AND status='pending'
                """).bind("projectId", projectId).bind("userId", userId).bind("draftId", draftId)
                .map((row, metadata) -> mapShotDraft(row)).one();
    }

    /** 查询项目镜头草稿历史。 */
    public Flux<ComicDramaDtos.ShotDraft> listShotDrafts(String projectId) {
        return databaseClient.sql("SELECT * FROM comic_drama_shot_drafts WHERE script_project_id=:projectId ORDER BY created_at DESC,id")
                .bind("projectId", projectId).map((row, metadata) -> mapShotDraft(row)).all();
    }

    /** 标记镜头草稿已确认。 */
    public Mono<Long> confirmShotDraft(String projectId, String draftId) {
        return databaseClient.sql("""
                UPDATE comic_drama_shot_drafts SET status='confirmed', confirmed_at=CURRENT_TIMESTAMP
                WHERE script_project_id=:projectId AND id=:draftId AND status='pending'
                  AND base_project_revision=(SELECT revision FROM comic_drama_projects WHERE script_project_id=:projectId)
                  AND base_script_revision=(SELECT revision FROM script_projects WHERE id=:projectId AND status=1)
                """).bind("projectId", projectId).bind("draftId", draftId).fetch().rowsUpdated();
    }

    /** 在剧本与漫剧修订均未变化时保存镜头草稿编辑结果。 */
    public Mono<Long> updateShotDraft(String projectId, String draftId, long expectedRevision, JSONObject draftData) {
        return databaseClient.sql("""
                UPDATE comic_drama_shot_drafts
                SET draft_data=CAST(:draftData AS jsonb),base_project_revision=:nextRevision
                WHERE script_project_id=:projectId AND id=:draftId AND status='pending'
                  AND base_project_revision=:expectedRevision
                  AND base_script_revision=(SELECT revision FROM script_projects WHERE id=:projectId AND status=1)
                """).bind("projectId", projectId).bind("draftId", draftId)
                .bind("expectedRevision", expectedRevision).bind("nextRevision", expectedRevision + 1)
                .bind("draftData", json(draftData)).fetch().rowsUpdated();
    }

    /** 标记待确认镜头草稿已放弃。 */
    public Mono<Long> discardShotDraft(String projectId, String draftId, long expectedRevision) {
        return databaseClient.sql("""
                UPDATE comic_drama_shot_drafts SET status='discarded'
                WHERE script_project_id=:projectId AND id=:draftId AND status='pending'
                  AND base_project_revision=:expectedRevision
                  AND base_script_revision=(SELECT revision FROM script_projects WHERE id=:projectId AND status=1)
                """).bind("projectId", projectId).bind("draftId", draftId)
                .bind("expectedRevision", expectedRevision).fetch().rowsUpdated();
    }

    /** 查询镜头列表。 */
    public Flux<ComicDramaDtos.Shot> listShots(String projectId, String episodeId, String sceneId) {
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("""
                SELECT sh.*, COALESCE(jsonb_agg(sav.asset_version_id ORDER BY sav.sort_order)
                    FILTER (WHERE sav.asset_version_id IS NOT NULL), '[]'::jsonb) asset_version_ids
                FROM comic_drama_shots sh LEFT JOIN comic_drama_shot_asset_versions sav ON sav.shot_id=sh.id
                WHERE sh.script_project_id=:projectId AND (:episodeId IS NULL OR sh.source_episode_id=:episodeId)
                    AND (:sceneId IS NULL OR sh.source_scene_id=:sceneId)
                GROUP BY sh.id ORDER BY sh.sort_order, sh.id
                """).bind("projectId", projectId);
        spec = bindNullable(spec, "episodeId", episodeId, String.class);
        spec = bindNullable(spec, "sceneId", sceneId, String.class);
        return spec.map((row, metadata) -> mapShot(row)).all();
    }

    /** 查询单个镜头。 */
    public Mono<ComicDramaDtos.Shot> getShot(String projectId, String shotId) {
        return databaseClient.sql("""
                SELECT sh.*, COALESCE(jsonb_agg(sav.asset_version_id ORDER BY sav.sort_order)
                    FILTER (WHERE sav.asset_version_id IS NOT NULL), '[]'::jsonb) asset_version_ids
                FROM comic_drama_shots sh LEFT JOIN comic_drama_shot_asset_versions sav ON sav.shot_id=sh.id
                WHERE sh.script_project_id=:projectId AND sh.id=:shotId GROUP BY sh.id
                """).bind("projectId", projectId).bind("shotId", shotId).map((row, metadata) -> mapShot(row)).one();
    }

    /** 新增或按实体修订号更新正式镜头。 */
    public Mono<Long> saveShot(String projectId, ComicDramaDtos.Shot shot) {
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("""
                INSERT INTO comic_drama_shots(id,script_project_id,source_episode_id,source_scene_id,source_script_excerpt,
                    shot_number,sort_order,duration_seconds,shot_size,composition,visual_description,action_description,
                    camera_movement,lighting_atmosphere,dialogue_voiceover,sound_description,style_override,production_status)
                VALUES (:id,:projectId,:episodeId,:sceneId,:excerpt,:shotNumber,:sortOrder,:duration,:shotSize,:composition,
                    :visual,:action,:camera,:lighting,:dialogue,:sound,:style,:status)
                ON CONFLICT (id) DO UPDATE SET source_episode_id=EXCLUDED.source_episode_id, source_scene_id=EXCLUDED.source_scene_id,
                    source_script_excerpt=EXCLUDED.source_script_excerpt, shot_number=EXCLUDED.shot_number,
                    sort_order=EXCLUDED.sort_order,duration_seconds=EXCLUDED.duration_seconds,shot_size=EXCLUDED.shot_size,
                    composition=EXCLUDED.composition,visual_description=EXCLUDED.visual_description,
                    action_description=EXCLUDED.action_description,camera_movement=EXCLUDED.camera_movement,
                    lighting_atmosphere=EXCLUDED.lighting_atmosphere,dialogue_voiceover=EXCLUDED.dialogue_voiceover,
                    sound_description=EXCLUDED.sound_description,style_override=EXCLUDED.style_override,
                    production_status=EXCLUDED.production_status,revision=comic_drama_shots.revision+1,updated_at=CURRENT_TIMESTAMP
                WHERE comic_drama_shots.script_project_id=EXCLUDED.script_project_id AND comic_drama_shots.revision=:revision
                RETURNING revision
                """).bind("id", shot.id()).bind("projectId", projectId);
        spec = bindNullable(spec, "episodeId", shot.sourceEpisodeId(), String.class);
        spec = bindNullable(spec, "sceneId", shot.sourceSceneId(), String.class);
        return spec.bind("excerpt", text(shot.sourceScriptExcerpt())).bind("shotNumber", shot.shotNumber())
                .bind("sortOrder", shot.sortOrder()).bind("duration", shot.durationSeconds()).bind("shotSize", text(shot.shotSize()))
                .bind("composition", text(shot.composition())).bind("visual", text(shot.visualDescription()))
                .bind("action", text(shot.actionDescription())).bind("camera", text(shot.cameraMovement()))
                .bind("lighting", text(shot.lightingAtmosphere())).bind("dialogue", text(shot.dialogueVoiceover()))
                .bind("sound", text(shot.soundDescription())).bind("style", text(shot.styleOverride()))
                .bind("status", shot.productionStatus()).bind("revision", shot.revision())
                .map((row, metadata) -> value(row, "revision", Long.class, 0L)).one();
    }

    /** 替换镜头引用的当前项目资产版本。 */
    public Mono<Long> replaceShotAssetVersions(String projectId, String shotId, List<String> versionIds) {
        Mono<Void> delete = databaseClient.sql("DELETE FROM comic_drama_shot_asset_versions WHERE shot_id=:shotId")
                .bind("shotId", shotId).fetch().rowsUpdated().then();
        return delete.thenMany(Flux.fromIterable(versionIds == null ? List.<String>of() : versionIds).index())
                .concatMap(item -> databaseClient.sql("""
                        INSERT INTO comic_drama_shot_asset_versions(shot_id,asset_version_id,sort_order)
                        SELECT :shotId,v.id,:sortOrder
                        FROM comic_drama_asset_versions v
                        JOIN comic_drama_assets a ON a.id=v.asset_id
                        WHERE v.id=:versionId AND a.script_project_id=:projectId
                        """).bind("shotId", shotId).bind("versionId", item.getT2())
                        .bind("sortOrder", item.getT1().intValue()).bind("projectId", projectId)
                        .fetch().rowsUpdated()).reduce(0L, Long::sum);
    }

    /** 按给定稳定标识顺序更新镜头排序。 */
    public Mono<Void> reorderShots(String projectId, List<String> shotIds) {
        return Flux.fromIterable(shotIds).index().concatMap(item -> databaseClient.sql("""
                UPDATE comic_drama_shots SET sort_order=:sortOrder, shot_number=:shotNumber, updated_at=CURRENT_TIMESTAMP
                WHERE script_project_id=:projectId AND id=:shotId
                """).bind("sortOrder", item.getT1().intValue()).bind("shotNumber", item.getT1().intValue() + 1)
                .bind("projectId", projectId).bind("shotId", item.getT2()).fetch().rowsUpdated()).then();
    }

    /** 删除项目内指定镜头。 */
    public Mono<Long> deleteShot(String projectId, String shotId) {
        return databaseClient.sql("DELETE FROM comic_drama_shots WHERE script_project_id=:projectId AND id=:shotId")
                .bind("projectId", projectId).bind("shotId", shotId).fetch().rowsUpdated();
    }

    /** 查询镜头删除前关联的媒体结果。 */
    public Mono<ComicDramaDtos.ShotDeleteImpact> getShotDeleteImpact(String projectId, String shotId) {
        return databaseClient.sql("""
                SELECT sh.id shot_id, COUNT(m.id)::INTEGER affected_count,
                       COALESCE(jsonb_agg(m.id) FILTER (WHERE m.id IS NOT NULL), '[]'::jsonb) media_ids
                FROM comic_drama_shots sh LEFT JOIN comic_drama_media_results m
                  ON m.script_project_id=sh.script_project_id AND m.target_type='shot' AND m.target_id=sh.id
                WHERE sh.script_project_id=:projectId AND sh.id=:shotId GROUP BY sh.id
                """).bind("projectId", projectId).bind("shotId", shotId)
                .map((row, metadata) -> {
                    JSONArray mediaIds = array(row, "media_ids");
                    return new ComicDramaDtos.ShotDeleteImpact(row.get("shot_id", String.class),
                            value(row, "affected_count", Integer.class, 0), mediaIds.toJavaList(String.class), true);
                }).one();
    }

    /** 查询镜头下一个提示词版本号。 */
    public Mono<Integer> nextPromptVersion(String projectId, String shotId) {
        return databaseClient.sql("""
                SELECT COALESCE(MAX(version_number),0)+1 next_version FROM comic_drama_prompt_versions
                WHERE script_project_id=:projectId AND shot_id=:shotId
                """).bind("projectId", projectId).bind("shotId", shotId)
                .map((row, metadata) -> value(row, "next_version", Integer.class, 1)).one();
    }

    /** 保存镜头提示词新版本。 */
    public Mono<Void> createPromptVersion(String projectId, ComicDramaDtos.PromptVersion prompt) {
        Mono<Long> supersede = "adopted".equals(prompt.status())
                ? databaseClient.sql("""
                    UPDATE comic_drama_prompt_versions SET status='superseded'
                    WHERE script_project_id=:projectId AND shot_id=:shotId AND status='adopted'
                    """).bind("projectId", projectId).bind("shotId", prompt.shotId()).fetch().rowsUpdated()
                : Mono.just(0L);
        Mono<Long> insert = databaseClient.sql("""
                INSERT INTO comic_drama_prompt_versions(id,script_project_id,shot_id,version_number,source_type,
                    prompt_text,source_snapshot,model,charged_credits,status)
                VALUES (:id,:projectId,:shotId,:versionNumber,:sourceType,:prompt,CAST(:snapshot AS jsonb),:model,:credits,:status)
                """).bind("id", prompt.id()).bind("projectId", projectId).bind("shotId", prompt.shotId())
                .bind("versionNumber", prompt.versionNumber()).bind("sourceType", prompt.sourceType())
                .bind("prompt", prompt.prompt()).bind("snapshot", json(prompt.sourceSnapshot())).bind("model", text(prompt.model()))
                .bind("credits", prompt.chargedCredits()).bind("status", prompt.status()).fetch().rowsUpdated();
        return supersede.then(insert).then();
    }

    /** 查询镜头当前采用的提示词。 */
    public Mono<ComicDramaDtos.PromptVersion> getLatestPrompt(String projectId, String shotId) {
        return databaseClient.sql("""
                SELECT * FROM comic_drama_prompt_versions
                WHERE script_project_id=:projectId AND shot_id=:shotId AND status='adopted'
                ORDER BY version_number DESC LIMIT 1
                """).bind("projectId", projectId).bind("shotId", shotId).map((row, metadata) -> mapPrompt(row)).one();
    }

    /** 查询项目提示词版本，可按镜头过滤。 */
    public Flux<ComicDramaDtos.PromptVersion> listPromptVersions(String projectId, String shotId) {
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("""
                SELECT * FROM comic_drama_prompt_versions
                WHERE script_project_id=:projectId AND (:shotId IS NULL OR shot_id=:shotId)
                ORDER BY shot_id, version_number DESC, created_at DESC, id
                """).bind("projectId", projectId);
        spec = bindNullable(spec, "shotId", shotId, String.class);
        return spec.map((row, metadata) -> mapPrompt(row)).all();
    }

    /** 保存媒体任务记录。 */
    public Mono<Void> createMediaResult(String projectId, ComicDramaDtos.MediaResult media) {
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("""
                INSERT INTO comic_drama_media_results(id,script_project_id,target_type,target_id,media_type,task_id,
                    input_snapshot,result_data,status,adopted,failure_reason)
                VALUES (:id,:projectId,:targetType,:targetId,:mediaType,:taskId,CAST(:input AS jsonb),
                    CAST(:result AS jsonb),:status,:adopted,:failureReason)
                """).bind("id", media.id()).bind("projectId", projectId).bind("targetType", media.targetType())
                .bind("targetId", media.targetId()).bind("mediaType", media.mediaType());
        spec = bindNullable(spec, "taskId", media.taskId(), String.class);
        return spec.bind("input", json(media.inputSnapshot())).bind("result", json(media.resultData()))
                .bind("status", media.status()).bind("adopted", media.adopted())
                .bind("failureReason", text(media.failureReason())).fetch().rowsUpdated().then();
    }

    /** 查询项目媒体任务与结果。 */
    public Flux<ComicDramaDtos.MediaResult> listMedia(String projectId, String shotId, String assetId) {
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("""
                SELECT m.* FROM comic_drama_media_results m
                LEFT JOIN comic_drama_asset_versions v ON m.target_type='assetVersion' AND v.id=m.target_id
                WHERE m.script_project_id=:projectId AND (:shotId IS NULL OR (m.target_type='shot' AND m.target_id=:shotId))
                    AND (:assetId IS NULL OR v.asset_id=:assetId) ORDER BY m.created_at DESC, m.id
                """).bind("projectId", projectId);
        spec = bindNullable(spec, "shotId", shotId, String.class);
        spec = bindNullable(spec, "assetId", assetId, String.class);
        return spec.map((row, metadata) -> mapMedia(row)).all();
    }

    /** 查询镜头引用的各资产版本的最新已完成参考图（按引用顺序排列）。 */
    public Flux<AiTaskDtos.AiTaskMediaReference> listShotAssetReferenceImages(String projectId, String shotId) {
        return databaseClient.sql("""
                WITH shot_assets AS (
                    SELECT v.id AS version_id,
                           v.version_name,
                           a.name AS asset_name,
                           v.reference_media,
                           sav.sort_order,
                           sav.reference_role
                    FROM comic_drama_shot_asset_versions sav
                    JOIN comic_drama_asset_versions v ON v.id = sav.asset_version_id
                    JOIN comic_drama_assets a ON a.id = v.asset_id
                    WHERE sav.shot_id = :shotId AND a.script_project_id = :projectId
                )
                SELECT sa.version_id,
                       sa.asset_name || '-' || sa.version_name AS name,
                       sa.reference_role,
                       sa.reference_media,
                       m.result_data
                FROM shot_assets sa
                LEFT JOIN LATERAL (
                    SELECT mr.result_data
                    FROM comic_drama_media_results mr
                    WHERE mr.script_project_id = :projectId
                      AND mr.target_type = 'assetVersion'
                      AND mr.target_id = sa.version_id
                      AND mr.media_type = 'image'
                      AND mr.status IN ('completed','needsUpdate')
                    ORDER BY mr.adopted DESC, mr.created_at DESC
                    LIMIT 1
                ) m ON TRUE
                ORDER BY sa.sort_order, sa.version_id
                """).bind("projectId", projectId).bind("shotId", shotId)
                // 该行可能既没有已生成图、reference_media 也为空，必须用 Optional 兜住而不是把 null 交给下游（r2dbc 的 map 收到 null 会抛空值校验异常）
                .map((row, metadata) -> {
                    String versionId = row.get("version_id", String.class);
                    String name = row.get("name", String.class);
                    String role = row.get("reference_role", String.class);
                    JSONObject resultData = object(row, "result_data");
                    JSONArray refMediaArray = array(row, "reference_media");
                    return Optional.ofNullable(extractMediaReference(versionId, name, role, resultData, refMediaArray));
                })
                .all().filter(Optional::isPresent).map(Optional::get);
    }

    /** 查询镜头自身已完成的分镜画面图片（若有）。 */
    public Mono<AiTaskDtos.AiTaskMediaReference> getShotStoryboardImage(String projectId, String shotId) {
        return databaseClient.sql("""
                SELECT id, result_data FROM comic_drama_media_results
                WHERE script_project_id = :projectId AND target_type = 'shot' AND target_id = :shotId
                  AND media_type = 'image' AND status IN ('completed','needsUpdate')
                ORDER BY adopted DESC, created_at DESC LIMIT 1
                """).bind("projectId", projectId).bind("shotId", shotId)
                .map((row, metadata) -> {
                    String mediaId = row.get("id", String.class);
                    JSONObject resultData = object(row, "result_data");
                    return Optional.ofNullable(extractMediaReference(mediaId, "分镜画面", "first_frame", resultData, null));
                })
                .all().filter(Optional::isPresent).map(Optional::get).next();
    }

    /** 查询镜头视频生成所需的全部参考图（分镜图优先置首，后接关联资产图）。 */
    public Mono<List<AiTaskDtos.AiTaskMediaReference>> listShotReferencesForVideo(String projectId, String shotId) {
        return Mono.zip(
                getShotStoryboardImage(projectId, shotId).map(Optional::of).defaultIfEmpty(Optional.empty()),
                listShotAssetReferenceImages(projectId, shotId).collectList()
        ).map(tuple -> {
            List<AiTaskDtos.AiTaskMediaReference> result = new ArrayList<>();
            tuple.getT1().ifPresent(result::add);
            result.addAll(tuple.getT2());
            return result;
        });
    }

    /** 从媒体结果或参考媒体数组中解析出首个有效媒体引用。 */
    private AiTaskDtos.AiTaskMediaReference extractMediaReference(String id, String name, String role,
                                                                   JSONObject resultData, JSONArray refMediaArray) {
        if (resultData != null && !resultData.isEmpty()) {
            JSONObject item = resultData.getJSONObject("item");
            if (item == null) {
                JSONArray items = resultData.getJSONArray("items");
                if (items != null && !items.isEmpty()) {
                    item = items.getJSONObject(0);
                }
            }
            if (item != null) {
                String url = item.getString("url");
                String storageKey = item.getString("storageKey");
                String mimeType = item.getString("mimeType");
                if (StringUtils.hasText(url) || StringUtils.hasText(storageKey)) {
                    return new AiTaskDtos.AiTaskMediaReference(id, name,
                            StringUtils.hasText(mimeType) ? mimeType : "image/png",
                            storageKey, url, StringUtils.hasText(role) ? role : "subject");
                }
            }
        }
        if (refMediaArray != null && !refMediaArray.isEmpty()) {
            for (int i = 0; i < refMediaArray.size(); i++) {
                JSONObject ref = refMediaArray.getJSONObject(i);
                if (ref != null) {
                    String url = ref.getString("url");
                    String storageKey = ref.getString("storageKey");
                    String mimeType = ref.getString("mimeType");
                    if (StringUtils.hasText(url) || StringUtils.hasText(storageKey)) {
                        return new AiTaskDtos.AiTaskMediaReference(id, name,
                                StringUtils.hasText(mimeType) ? mimeType : "image/png",
                                storageKey, url, StringUtils.hasText(role) ? role : "subject");
                    }
                }
            }
        }
        return null;
    }

    /**
     * 按底层任务标识同步漫剧媒体状态、结果和失败原因。
     *
     * @param projectId 漫剧项目ID
     * @param taskId 底层AI任务ID
     * @param status 漫剧媒体状态
     * @param resultData 底层任务结果
     * @param failureReason 失败原因
     * @return 更新行数
     */
    public Mono<Long> updateMediaTaskState(String projectId, String taskId, String status,
                                             JSONObject resultData, String failureReason) {
        return databaseClient.sql("""
                UPDATE comic_drama_media_results
                SET status=:status, result_data=CAST(:resultData AS jsonb), failure_reason=:failureReason,
                    updated_at=CURRENT_TIMESTAMP
                WHERE script_project_id=:projectId AND task_id=:taskId
                RETURNING target_type, target_id
                """).bind("projectId", projectId).bind("taskId", taskId).bind("status", status)
                .bind("resultData", json(resultData)).bind("failureReason", text(failureReason))
                .map((row, metadata) -> {
                    String targetType = row.get("target_type", String.class);
                    String targetId = row.get("target_id", String.class);
                    return "shot".equals(targetType) ? targetId : "";
                }).all().collectList()
                .flatMap(shotIds -> {
                    if (shotIds.isEmpty()) {
                        return Mono.just(0L);
                    }
                    return Flux.fromIterable(shotIds.stream().filter(StringUtils::hasText).distinct().toList())
                            .concatMap(shotId -> refreshShotProductionStatus(projectId, shotId))
                            .then(Mono.just((long) shotIds.size()));
                });
    }

    /** 在AI任务入队前将底层任务绑定到预先持久化的媒体记录。 */
    public Mono<Long> attachMediaTask(String projectId, String mediaId, String taskId, String status) {
        return databaseClient.sql("""
                WITH updated_media AS (
                UPDATE comic_drama_media_results SET task_id=:taskId,status=:status,updated_at=CURRENT_TIMESTAMP
                WHERE script_project_id=:projectId AND id=:mediaId AND task_id IS NULL
                RETURNING target_type,target_id
                ), updated_shot AS (
                UPDATE comic_drama_shots SET production_status='generating',updated_at=CURRENT_TIMESTAMP
                WHERE id IN (SELECT target_id FROM updated_media WHERE target_type='shot')
                    AND production_status<>'needsUpdate'
                ) SELECT COUNT(*) AS updated_rows FROM updated_media
                """).bind("projectId", projectId).bind("mediaId", mediaId).bind("taskId", taskId)
                .bind("status", status).map((row, metadata) -> value(row, "updated_rows", Long.class, 0L)).one();
    }

    /** 记录媒体子任务在创建或入队阶段的失败。 */
    public Mono<Void> failMediaResult(String projectId, String mediaId, String failureReason) {
        return databaseClient.sql("""
                UPDATE comic_drama_media_results SET status='failed',failure_reason=:failureReason,updated_at=CURRENT_TIMESTAMP
                WHERE script_project_id=:projectId AND id=:mediaId
                RETURNING target_type,target_id
                """).bind("projectId", projectId).bind("mediaId", mediaId)
                .bind("failureReason", text(failureReason))
                .map((row, metadata) -> {
                    String targetType = row.get("target_type", String.class);
                    String targetId = row.get("target_id", String.class);
                    return "shot".equals(targetType) ? targetId : "";
                }).one()
                .flatMap(shotId -> StringUtils.hasText(shotId) ? refreshShotProductionStatus(projectId, shotId) : Mono.empty());
    }

    /** 将一个媒体版本设为目标当前采用版本。 */
    public Mono<Long> adoptMedia(String projectId, String mediaId) {
        Mono<String> status = databaseClient.sql("""
                SELECT status FROM comic_drama_media_results
                WHERE script_project_id=:projectId AND id=:mediaId
                """).bind("projectId", projectId).bind("mediaId", mediaId)
                .map((row, metadata) -> row.get("status", String.class)).one();
        Mono<Long> clear = databaseClient.sql("""
                UPDATE comic_drama_media_results SET adopted=FALSE, updated_at=CURRENT_TIMESTAMP
                WHERE script_project_id=:projectId AND (target_type,target_id,media_type)=(
                    SELECT target_type,target_id,media_type FROM comic_drama_media_results
                    WHERE script_project_id=:projectId AND id=:mediaId)
                """).bind("projectId", projectId).bind("mediaId", mediaId).fetch().rowsUpdated();
        return status.flatMap(currentStatus -> "completed".equals(currentStatus)
                ? clear.then(databaseClient.sql("""
                UPDATE comic_drama_media_results SET adopted=TRUE, updated_at=CURRENT_TIMESTAMP
                WHERE script_project_id=:projectId AND id=:mediaId RETURNING target_id
                """).bind("projectId", projectId).bind("mediaId", mediaId)
                .map((row, metadata) -> row.get("target_id", String.class)).one())
                .flatMap(targetId -> refreshShotProductionStatus(projectId, targetId).thenReturn(1L))
                : Mono.just(-1L));
    }

    /** 刷新镜头生产状态：优先保留needsUpdate；有生成中任务为generating；有完成/采用版本为completed；全失败为failed；否则保持原状。 */
    public Mono<Void> refreshShotProductionStatus(String projectId, String shotId) {
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("""
                UPDATE comic_drama_shots sh SET production_status = CASE
                    WHEN sh.production_status = 'needsUpdate' THEN 'needsUpdate'
                    WHEN EXISTS (
                        SELECT 1 FROM comic_drama_media_results m
                        WHERE m.script_project_id = :projectId AND m.target_type = 'shot' AND m.target_id = sh.id
                          AND m.status IN ('queued', 'processing')
                    ) THEN 'generating'
                    WHEN EXISTS (
                        SELECT 1 FROM comic_drama_media_results m
                        WHERE m.script_project_id = :projectId AND m.target_type = 'shot' AND m.target_id = sh.id
                          AND m.status = 'completed' AND m.adopted = TRUE
                    ) THEN 'completed'
                    WHEN EXISTS (
                        SELECT 1 FROM comic_drama_media_results m
                        WHERE m.script_project_id = :projectId AND m.target_type = 'shot' AND m.target_id = sh.id
                          AND m.status = 'completed'
                    ) THEN 'completed'
                    WHEN EXISTS (
                        SELECT 1 FROM comic_drama_media_results m
                        WHERE m.script_project_id = :projectId AND m.target_type = 'shot' AND m.target_id = sh.id
                          AND m.status = 'failed'
                    ) THEN 'failed'
                    ELSE sh.production_status
                END,
                updated_at = CURRENT_TIMESTAMP
                WHERE sh.script_project_id = :projectId
                  AND (:shotId IS NULL OR sh.id = :shotId)
                  AND sh.production_status <> 'needsUpdate'
                """).bind("projectId", projectId);
        spec = bindNullable(spec, "shotId", shotId, String.class);
        return spec.fetch().rowsUpdated().then();
    }

    /** 查询上游变化影响项。 */
    public Flux<ComicDramaDtos.ChangeImpact> listImpacts(String projectId) {
        return databaseClient.sql("SELECT * FROM comic_drama_change_impacts WHERE script_project_id=:projectId ORDER BY created_at DESC,id")
                .bind("projectId", projectId).map((row, metadata) -> mapImpact(row)).all();
    }

    /**
     * 按上游来源批量写入去重后的下游影响，供用户在「待更新项」中确认，不改动任何下游数据状态。
     *
     * @param projectId 共享剧本项目ID
     * @param sourceType 上游来源类型
     * @param sourceIds 上游来源稳定标识
     * @param summary 变化摘要
     * @return 新增影响记录数量
     */
    public Mono<Long> markUpstreamChanges(String projectId, String sourceType, List<String> sourceIds, String summary) {
        List<String> normalizedIds = sourceIds.isEmpty() ? List.of(projectId) : sourceIds;
        return Flux.fromIterable(normalizedIds).concatMap(sourceId -> markOneUpstreamChange(
                projectId, sourceType, sourceId, summary)).reduce(0L, Long::sum);
    }

    /** 按单一来源稳定标识计算影响范围，仅登记待确认项。 */
    private Mono<Long> markOneUpstreamChange(String projectId, String sourceType, String sourceId, String summary) {
        String shotPredicate = switch (sourceType) {
            case "overview", "versionRestore" -> "TRUE";
            case "episode" -> "sh.source_episode_id=:sourceId";
            case "scene" -> "sh.source_scene_id=:sourceId";
            case "character", "world", "asset", "assetVersion" -> "EXISTS (SELECT 1 FROM comic_drama_shot_asset_versions sav JOIN comic_drama_asset_versions av ON av.id=sav.asset_version_id JOIN comic_drama_assets a ON a.id=av.asset_id WHERE sav.shot_id=sh.id AND (a.source_entity_id=:sourceId OR a.id=:sourceId OR av.id=:sourceId))";
            default -> "FALSE";
        };
        String assetTargetPredicate = switch (sourceType) {
            case "overview", "versionRestore" -> "TRUE";
            case "character", "world" -> "a.source_entity_id=:sourceId";
            default -> "FALSE";
        };
        String assetMediaPredicate = switch (sourceType) {
            case "overview", "versionRestore" -> "TRUE";
            case "character", "world" -> "a.source_entity_id=:sourceId";
            case "asset" -> "a.id=:sourceId";
            case "assetVersion" -> "av.id=:sourceId";
            default -> "FALSE";
        };
        String targetQuery = """
                SELECT 'shot' target_type,sh.id target_id FROM comic_drama_shots sh
                    WHERE sh.script_project_id=:projectId AND (%s)
                UNION ALL SELECT 'asset',a.id FROM comic_drama_assets a
                    WHERE a.script_project_id=:projectId AND (%s)
                UNION ALL SELECT 'promptVersion',p.id FROM comic_drama_prompt_versions p
                    JOIN comic_drama_shots sh ON sh.id=p.shot_id WHERE p.script_project_id=:projectId AND (%s)
                UNION ALL SELECT 'media',m.id FROM comic_drama_media_results m
                    LEFT JOIN comic_drama_shots sh ON m.target_type='shot' AND sh.id=m.target_id
                    LEFT JOIN comic_drama_asset_versions av ON m.target_type='assetVersion' AND av.id=m.target_id
                    LEFT JOIN comic_drama_assets a ON a.id=av.asset_id
                    WHERE m.script_project_id=:projectId AND ((sh.id IS NOT NULL AND (%s)) OR (a.id IS NOT NULL AND (%s))
                        OR (m.target_type='assetVersion' AND m.target_id=:sourceId))
                UNION ALL SELECT 'voiceTrack',v.id FROM comic_drama_voice_tracks v
                    LEFT JOIN comic_drama_shots sh ON sh.id=v.shot_id
                    WHERE v.script_project_id=:projectId AND ((sh.id IS NOT NULL AND (%s))
                        OR (:sourceType='character' AND v.character_id=:sourceId)
                        OR :sourceType IN ('overview','versionRestore'))
                """.formatted(shotPredicate, assetTargetPredicate, shotPredicate, shotPredicate, assetMediaPredicate, shotPredicate);
        JSONObject snapshot = new JSONObject();
        snapshot.put("sourceId", sourceId);
        // 只登记影响项供用户在「待更新项」里确认，绝不改动下游实体自身的状态：
        // 否则上游一次变更就会把已完成/已采用的镜头、资产、提示词、媒体和声音轨直接标记成需要更新，
        // 表现为用户已有成果凭空消失且不可逆。
        return databaseClient.sql("""
                INSERT INTO comic_drama_change_impacts(id,script_project_id,source_type,source_id,target_type,target_id,
                    change_summary,impact_snapshot,status)
                SELECT md5(random()::text || clock_timestamp()::text || target.target_id),:projectId,:sourceType,
                    :sourceId,target.target_type,target.target_id,:summary,CAST(:snapshot AS jsonb),'pending'
                FROM (
                """ + targetQuery + """
                ) target WHERE NOT EXISTS (SELECT 1 FROM comic_drama_change_impacts i
                    WHERE i.script_project_id=:projectId AND i.source_type=:sourceType AND i.source_id=:sourceId
                      AND i.target_type=target.target_type AND i.target_id=target.target_id AND i.status='pending')
                """).bind("projectId", projectId).bind("sourceType", sourceType).bind("sourceId", sourceId)
                .bind("summary", summary).bind("snapshot", snapshot.toJSONString()).fetch().rowsUpdated();
    }

    /** 确认更新或保留旧结果并关闭影响项。 */
    public Mono<Long> resolveImpacts(String projectId, String scope, String targetId, String resolution) {
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("""
                UPDATE comic_drama_change_impacts SET status=:status,resolved_at=CURRENT_TIMESTAMP
                WHERE script_project_id=:projectId AND status='pending'
                    AND (:scope='all' OR target_type=:scope) AND (:targetId IS NULL OR target_id=:targetId)
                """).bind("projectId", projectId).bind("scope", scope)
                .bind("status", "keepOld".equals(resolution) ? "keptOld" : "accepted");
        spec = bindNullable(spec, "targetId", targetId, String.class);
        return spec.fetch().rowsUpdated();
    }

    /** 查询声音轨。 */
    public Flux<ComicDramaDtos.VoiceTrack> listVoiceTracks(String projectId, String shotId) {
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("""
                SELECT * FROM comic_drama_voice_tracks WHERE script_project_id=:projectId
                AND (:shotId IS NULL OR shot_id=:shotId) ORDER BY created_at,id
                """).bind("projectId", projectId);
        spec = bindNullable(spec, "shotId", shotId, String.class);
        return spec.map((row, metadata) -> mapVoiceTrack(row)).all();
    }

    /**
     * 新增或按实体修订号更新声音轨及其音频排期。
     *
     * @param projectId 所属漫剧项目标识
     * @param voiceTrack 声音条目及可选音频编排
     * @return 保存后的实体修订号
     */
    public Mono<Long> saveVoiceTrack(String projectId, ComicDramaDtos.VoiceTrack voiceTrack) {
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("""
                INSERT INTO comic_drama_voice_tracks(id,script_project_id,shot_id,source_block_id,character_id,
                    track_type,content,voice_model,speech_rate,tone,emotion,status,audio_storage_key,audio_duration_ms,
                    timeline_start_ms,trim_start_ms,trim_end_ms)
                VALUES (:id,:projectId,:shotId,:sourceBlockId,:characterId,:trackType,:content,:voiceModel,:speechRate,:tone,:emotion,:status,
                    :audioStorageKey,:audioDurationMs,:timelineStartMs,:trimStartMs,:trimEndMs)
                ON CONFLICT (id) DO UPDATE SET shot_id=EXCLUDED.shot_id,source_block_id=EXCLUDED.source_block_id,
                    character_id=EXCLUDED.character_id,track_type=EXCLUDED.track_type,content=EXCLUDED.content,
                    voice_model=EXCLUDED.voice_model,speech_rate=EXCLUDED.speech_rate,tone=EXCLUDED.tone,
                    emotion=EXCLUDED.emotion,status=EXCLUDED.status,audio_storage_key=EXCLUDED.audio_storage_key,
                    audio_duration_ms=EXCLUDED.audio_duration_ms,timeline_start_ms=EXCLUDED.timeline_start_ms,
                    trim_start_ms=EXCLUDED.trim_start_ms,trim_end_ms=EXCLUDED.trim_end_ms,
                    revision=comic_drama_voice_tracks.revision+1,
                    updated_at=CURRENT_TIMESTAMP
                WHERE comic_drama_voice_tracks.script_project_id=EXCLUDED.script_project_id AND comic_drama_voice_tracks.revision=:revision
                RETURNING revision
                """).bind("id", voiceTrack.id()).bind("projectId", projectId);
        spec = bindNullable(spec, "shotId", voiceTrack.shotId(), String.class);
        spec = bindNullable(spec, "sourceBlockId", voiceTrack.sourceBlockId(), String.class);
        spec = bindNullable(spec, "characterId", voiceTrack.characterId(), String.class);
        spec = bindNullable(spec, "audioStorageKey", voiceTrack.audioStorageKey(), String.class);
        spec = bindNullable(spec, "audioDurationMs", voiceTrack.audioDurationMs(), Long.class);
        spec = bindNullable(spec, "timelineStartMs", voiceTrack.timelineStartMs(), Long.class);
        spec = bindNullable(spec, "trimStartMs", voiceTrack.trimStartMs(), Long.class);
        spec = bindNullable(spec, "trimEndMs", voiceTrack.trimEndMs(), Long.class);
        return spec.bind("trackType", voiceTrack.trackType()).bind("content", text(voiceTrack.content()))
                .bind("voiceModel", text(voiceTrack.voiceModel())).bind("speechRate", voiceTrack.speechRate())
                .bind("tone", text(voiceTrack.tone())).bind("emotion", text(voiceTrack.emotion()))
                .bind("status", voiceTrack.status()).bind("revision", voiceTrack.revision())
                .map((row, metadata) -> value(row, "revision", Long.class, 0L)).one();
    }

    /** 校验声音轨的镜头、人物与正文块均属于同一共享剧本项目。 */
    public Mono<Boolean> validateVoiceTrackReferences(String projectId, ComicDramaDtos.VoiceTrack voiceTrack) {
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("""
                SELECT ((:shotId IS NULL OR EXISTS (
                            SELECT 1 FROM comic_drama_shots WHERE id=:shotId AND script_project_id=:projectId))
                    AND (:characterId IS NULL OR EXISTS (
                            SELECT 1 FROM script_characters WHERE id=:characterId AND project_id=:projectId))
                    AND (:sourceBlockId IS NULL OR EXISTS (
                            SELECT 1 FROM script_blocks b
                            JOIN script_scenes s ON s.id=b.scene_id
                            JOIN script_episodes e ON e.id=s.episode_id
                            WHERE b.id=:sourceBlockId AND e.project_id=:projectId))) AS valid
                """).bind("projectId", projectId);
        spec = bindNullable(spec, "shotId", voiceTrack.shotId(), String.class);
        spec = bindNullable(spec, "characterId", voiceTrack.characterId(), String.class);
        spec = bindNullable(spec, "sourceBlockId", voiceTrack.sourceBlockId(), String.class);
        return spec.map((row, metadata) -> Boolean.TRUE.equals(row.get("valid", Boolean.class))).one();
    }

    /**
     * 查询项目的全部时间轴文字片段。
     *
     * @param projectId 所属漫剧项目标识
     * @return 按轨道及起点排序的文字片段流
     */
    public Flux<ComicDramaDtos.TimelineText> listTimelineTexts(String projectId) {
        return databaseClient.sql("""
                SELECT * FROM comic_drama_timeline_texts
                WHERE script_project_id=:projectId ORDER BY track_number,start_ms,id
                """).bind("projectId", projectId).map((row, metadata) -> mapTimelineText(row)).all();
    }

    /**
     * 按片段修订号保存时间轴文字。
     *
     * @param projectId 所属漫剧项目标识
     * @param timelineText 待保存的文字片段
     * @return 保存后的实体修订号
     */
    public Mono<Long> saveTimelineText(String projectId, ComicDramaDtos.TimelineText timelineText) {
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("""
                INSERT INTO comic_drama_timeline_texts(id,script_project_id,content,start_ms,end_ms,track_number,position_x,position_y,
                    font_size,font_family,color,alignment,background_color)
                VALUES (:id,:projectId,:content,:startMs,:endMs,:trackNumber,:positionX,:positionY,:fontSize,:fontFamily,:color,:alignment,:backgroundColor)
                ON CONFLICT (id) DO UPDATE SET content=EXCLUDED.content,start_ms=EXCLUDED.start_ms,end_ms=EXCLUDED.end_ms,
                    track_number=EXCLUDED.track_number,position_x=EXCLUDED.position_x,position_y=EXCLUDED.position_y,font_size=EXCLUDED.font_size,font_family=EXCLUDED.font_family,
                    color=EXCLUDED.color,alignment=EXCLUDED.alignment,background_color=EXCLUDED.background_color,
                    revision=comic_drama_timeline_texts.revision+1,updated_at=CURRENT_TIMESTAMP
                WHERE comic_drama_timeline_texts.script_project_id=EXCLUDED.script_project_id
                    AND comic_drama_timeline_texts.revision=:revision
                RETURNING revision
                """).bind("id", timelineText.id()).bind("projectId", projectId)
                .bind("content", timelineText.content().trim()).bind("startMs", timelineText.startMs())
                .bind("endMs", timelineText.endMs()).bind("trackNumber", timelineText.trackNumber())
                .bind("positionX", timelineText.positionX())
                .bind("positionY", timelineText.positionY()).bind("fontSize", timelineText.fontSize())
                .bind("fontFamily", timelineText.fontFamily())
                .bind("color", timelineText.color()).bind("alignment", timelineText.alignment())
                .bind("revision", timelineText.revision());
        spec = bindNullable(spec, "backgroundColor", timelineText.backgroundColor(), String.class);
        return spec.map((row, metadata) -> value(row, "revision", Long.class, 0L)).one();
    }

    /**
     * 删除项目所属的时间轴文字片段。
     *
     * @param projectId 所属漫剧项目标识
     * @param timelineTextId 待删除文字片段标识
     * @return 删除的记录数量
     */
    public Mono<Long> deleteTimelineText(String projectId, String timelineTextId) {
        return databaseClient.sql("""
                DELETE FROM comic_drama_timeline_texts WHERE script_project_id=:projectId AND id=:timelineTextId
                """).bind("projectId", projectId).bind("timelineTextId", timelineTextId).fetch().rowsUpdated();
    }

    /**
     * 判断同一文字轨道是否已有时间重叠的其他片段。
     *
     * @param projectId 所属漫剧项目标识
     * @param timelineText 待保存文字片段
     * @return 是否存在重叠片段
     */
    public Mono<Boolean> hasTimelineTextOverlap(String projectId, ComicDramaDtos.TimelineText timelineText) {
        return databaseClient.sql("""
                SELECT EXISTS (SELECT 1 FROM comic_drama_timeline_texts
                    WHERE script_project_id=:projectId AND track_number=:trackNumber AND id<>:id
                      AND start_ms<:endMs AND end_ms>:startMs) AS present
                """).bind("projectId", projectId).bind("trackNumber", timelineText.trackNumber())
                .bind("id", timelineText.id()).bind("startMs", timelineText.startMs())
                .bind("endMs", timelineText.endMs())
                .map((row, metadata) -> Boolean.TRUE.equals(row.get("present", Boolean.class))).one();
    }

    /**
     * 增加项目文字轨道数量。
     *
     * @param projectId 所属漫剧项目标识
     * @param count 新轨道数量
     * @return 更新完成信号
     */
    public Mono<Void> setTextTrackCount(String projectId, int count) {
        return databaseClient.sql("""
                UPDATE comic_drama_projects SET text_track_count=:count WHERE script_project_id=:projectId
                """).bind("count", count).bind("projectId", projectId).fetch().rowsUpdated().then();
    }

    /**
     * 删除指定新增文字轨道，并将更高编号的轨道顺序前移。
     *
     * @param projectId 所属漫剧项目标识
     * @param trackNumber 待删除轨道编号
     * @return 删除完成信号
     */
    public Mono<Void> deleteTextTrack(String projectId, int trackNumber) {
        return databaseClient.sql("""
                DELETE FROM comic_drama_timeline_texts
                WHERE script_project_id=:projectId AND track_number=:trackNumber
                """).bind("projectId", projectId).bind("trackNumber", trackNumber).fetch().rowsUpdated()
                .then(databaseClient.sql("""
                        UPDATE comic_drama_timeline_texts SET track_number=track_number-1, revision=revision+1,
                            updated_at=CURRENT_TIMESTAMP
                        WHERE script_project_id=:projectId AND track_number>:trackNumber
                        """).bind("projectId", projectId).bind("trackNumber", trackNumber).fetch().rowsUpdated())
                .then(databaseClient.sql("""
                        UPDATE comic_drama_projects SET text_track_count=text_track_count-1
                        WHERE script_project_id=:projectId
                        """).bind("projectId", projectId).fetch().rowsUpdated()).then();
    }

    /** 校验镜头的来源分集与场次属于当前共享剧本。 */
    public Mono<Boolean> validateShotSourceReferences(String projectId, ComicDramaDtos.Shot shot) {
        return validateShotSourceReferences(projectId, shot.sourceEpisodeId(), shot.sourceSceneId());
    }

    /** 校验给定来源分集与场次标识属于当前共享剧本。 */
    public Mono<Boolean> validateShotSourceReferences(String projectId, String episodeId, String sceneId) {
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("""
                SELECT ((:episodeId IS NULL OR EXISTS (
                            SELECT 1 FROM script_episodes WHERE id=:episodeId AND project_id=:projectId))
                    AND (:sceneId IS NULL OR EXISTS (
                            SELECT 1 FROM script_scenes s JOIN script_episodes e ON e.id=s.episode_id
                            WHERE s.id=:sceneId AND e.project_id=:projectId
                              AND (:episodeId IS NULL OR s.episode_id=:episodeId)))) AS valid
                """).bind("projectId", projectId);
        spec = bindNullable(spec, "episodeId", episodeId, String.class);
        spec = bindNullable(spec, "sceneId", sceneId, String.class);
        return spec.map((row, metadata) -> Boolean.TRUE.equals(row.get("valid", Boolean.class))).one();
    }

    /** 根据当前生产数据重新计算漫剧项目生产状态。 */
    public Mono<Void> refreshProjectProductionStatus(String projectId) {
        return refreshShotProductionStatus(projectId, null).then(databaseClient.sql("""
                UPDATE comic_drama_projects c SET production_status=CASE
                    WHEN c.production_status='paused' THEN 'paused'
                    WHEN EXISTS (SELECT 1 FROM comic_drama_shots sh WHERE sh.script_project_id=c.script_project_id)
                      AND NOT EXISTS (SELECT 1 FROM comic_drama_shots sh WHERE sh.script_project_id=c.script_project_id
                          AND NOT EXISTS (SELECT 1 FROM comic_drama_media_results m
                              WHERE m.script_project_id=c.script_project_id AND m.target_type='shot'
                                AND m.target_id=sh.id AND m.status='completed' AND m.adopted=TRUE))
                      AND NOT EXISTS (SELECT 1 FROM comic_drama_change_impacts i
                          WHERE i.script_project_id=c.script_project_id AND i.status='pending') THEN 'completed'
                    WHEN EXISTS (SELECT 1 FROM comic_drama_assets a WHERE a.script_project_id=c.script_project_id)
                      OR EXISTS (SELECT 1 FROM comic_drama_shots sh WHERE sh.script_project_id=c.script_project_id)
                      OR EXISTS (SELECT 1 FROM comic_drama_media_results m WHERE m.script_project_id=c.script_project_id)
                        THEN 'producing'
                    ELSE 'preparing' END,
                    updated_at=CURRENT_TIMESTAMP
                WHERE c.script_project_id=:projectId
                """).bind("projectId", projectId).fetch().rowsUpdated().then());
    }

    /** 查询批量任务。 */
    public Flux<ComicDramaDtos.BatchTask> listBatchTasks(String projectId) {
        return databaseClient.sql("SELECT * FROM comic_drama_batch_tasks WHERE script_project_id=:projectId ORDER BY created_at DESC,id")
                .bind("projectId", projectId).map((row, metadata) -> mapBatchTask(row)).all();
    }

    /** 保存已由用户确认的批量任务计划。 */
    public Mono<Void> createBatchTask(Long userId, String projectId, ComicDramaDtos.BatchTask task) {
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("""
                INSERT INTO comic_drama_batch_tasks(id,script_project_id,user_id,batch_type,scope_type,scope_data,
                    model_settings,estimated_credits,total_count,queued_count,status,confirmed_at)
                VALUES (:id,:projectId,:userId,:batchType,:scopeType,CAST(:scope AS jsonb),CAST(:settings AS jsonb),
                    :credits,:totalCount,:queuedCount,:status,:confirmedAt)
                """).bind("id", task.id()).bind("projectId", projectId).bind("userId", userId)
                .bind("batchType", task.batchType()).bind("scopeType", task.scopeType()).bind("scope", json(task.scope()))
                .bind("settings", json(task.modelSettings())).bind("credits", task.estimatedCredits())
                .bind("totalCount", task.totalCount()).bind("queuedCount", task.queuedCount()).bind("status", task.status());
        spec = bindNullable(spec, "confirmedAt", task.confirmedAt(), OffsetDateTime.class);
        return spec.fetch().rowsUpdated().then();
    }

    /** 更新批量任务的可见子任务进度。 */
    public Mono<Void> updateBatchTaskProgress(String projectId, String taskId, int queuedCount,
                                               int failedCount, String status) {
        return databaseClient.sql("""
                UPDATE comic_drama_batch_tasks
                SET queued_count=:queuedCount,failed_count=:failedCount,status=:status,updated_at=CURRENT_TIMESTAMP
                WHERE script_project_id=:projectId AND id=:taskId
                """).bind("projectId", projectId).bind("taskId", taskId).bind("queuedCount", queuedCount)
                .bind("failedCount", failedCount).bind("status", status).fetch().rowsUpdated().then();
    }

    /** 根据批量任务引用的媒体记录重新计算进度与状态。 */
    public Mono<Void> refreshBatchTaskProgress(String projectId) {
        return databaseClient.sql("""
                WITH progress AS (
                    SELECT b.id,
                        COUNT(*) FILTER (WHERE m.status='queued')::INTEGER queued_count,
                        COUNT(*) FILTER (WHERE m.status='processing')::INTEGER processing_count,
                        COUNT(*) FILTER (WHERE m.status='completed')::INTEGER completed_count,
                        COUNT(*) FILTER (WHERE m.status='failed')::INTEGER failed_count,
                        COUNT(*) FILTER (WHERE m.status='needsUpdate')::INTEGER needs_update_count
                    FROM comic_drama_batch_tasks b
                    CROSS JOIN LATERAL jsonb_array_elements_text(
                        COALESCE(b.model_settings->'mediaResultIds','[]'::jsonb)) AS media_item(media_id)
                    LEFT JOIN comic_drama_media_results m ON m.id=media_item.media_id
                    WHERE b.script_project_id=:projectId
                    GROUP BY b.id
                )
                UPDATE comic_drama_batch_tasks b SET queued_count=p.queued_count,
                    processing_count=p.processing_count,completed_count=p.completed_count,
                    failed_count=p.failed_count,needs_update_count=p.needs_update_count,
                    status=CASE
                        WHEN p.completed_count=b.total_count THEN 'completed'
                        WHEN p.failed_count=b.total_count THEN 'failed'
                        WHEN p.failed_count>0 AND p.queued_count+p.processing_count+p.completed_count>0 THEN 'partialFailed'
                        WHEN p.processing_count>0 THEN 'processing'
                        ELSE 'queued' END,
                    updated_at=CURRENT_TIMESTAMP
                FROM progress p WHERE b.id=p.id
                """).bind("projectId", projectId).fetch().rowsUpdated().then();
    }

    /** 查询画布绑定。 */
    public Flux<ComicDramaDtos.CanvasBinding> listCanvasBindings(String projectId) {
        return databaseClient.sql("SELECT * FROM comic_drama_canvas_bindings WHERE script_project_id=:projectId ORDER BY created_at,id")
                .bind("projectId", projectId).map((row, metadata) -> mapCanvasBinding(row)).all();
    }

    /** 创建或更新画布节点绑定。 */
    public Mono<ComicDramaDtos.CanvasBinding> bindCanvas(String projectId, ComicDramaDtos.CanvasBinding binding) {
        return databaseClient.sql("""
                INSERT INTO comic_drama_canvas_bindings(id,script_project_id,target_type,target_id,canvas_id,node_id,binding_data)
                VALUES (:id,:projectId,:targetType,:targetId,:canvasId,:nodeId,CAST(:data AS jsonb))
                ON CONFLICT (script_project_id,canvas_id,node_id) DO UPDATE SET target_type=EXCLUDED.target_type,
                    target_id=EXCLUDED.target_id,binding_data=EXCLUDED.binding_data,updated_at=CURRENT_TIMESTAMP
                RETURNING *
                """).bind("id", binding.id()).bind("projectId", projectId).bind("targetType", binding.entityType())
                .bind("targetId", binding.entityId()).bind("canvasId", binding.canvasProjectId()).bind("nodeId", binding.nodeId())
                .bind("data", json(binding.bindingData())).map((row, metadata) -> mapCanvasBinding(row)).one();
    }

    /** 校验待绑定的结构化实体属于当前漫剧项目。 */
    public Mono<Boolean> existsProjectEntity(String projectId, String entityType, String entityId) {
        String sql = switch (entityType) {
            case "project" -> "SELECT EXISTS (SELECT 1 FROM comic_drama_projects WHERE script_project_id=:projectId AND script_project_id=:entityId) AS present";
            case "asset" -> "SELECT EXISTS (SELECT 1 FROM comic_drama_assets WHERE script_project_id=:projectId AND id=:entityId) AS present";
            case "assetVersion" -> "SELECT EXISTS (SELECT 1 FROM comic_drama_asset_versions v JOIN comic_drama_assets a ON a.id=v.asset_id WHERE a.script_project_id=:projectId AND v.id=:entityId) AS present";
            case "shot" -> "SELECT EXISTS (SELECT 1 FROM comic_drama_shots WHERE script_project_id=:projectId AND id=:entityId) AS present";
            case "promptVersion" -> "SELECT EXISTS (SELECT 1 FROM comic_drama_prompt_versions WHERE script_project_id=:projectId AND id=:entityId) AS present";
            case "media" -> "SELECT EXISTS (SELECT 1 FROM comic_drama_media_results WHERE script_project_id=:projectId AND id=:entityId) AS present";
            case "voiceTrack" -> "SELECT EXISTS (SELECT 1 FROM comic_drama_voice_tracks WHERE script_project_id=:projectId AND id=:entityId) AS present";
            case "character" -> "SELECT EXISTS (SELECT 1 FROM script_characters WHERE project_id=:projectId AND id=:entityId) AS present";
            case "episode" -> "SELECT EXISTS (SELECT 1 FROM script_episodes WHERE project_id=:projectId AND id=:entityId) AS present";
            case "scene" -> "SELECT EXISTS (SELECT 1 FROM script_scenes s JOIN script_episodes e ON e.id=s.episode_id WHERE e.project_id=:projectId AND s.id=:entityId) AS present";
            case "scriptBlock" -> "SELECT EXISTS (SELECT 1 FROM script_blocks b JOIN script_scenes s ON s.id=b.scene_id JOIN script_episodes e ON e.id=s.episode_id WHERE e.project_id=:projectId AND b.id=:entityId) AS present";
            default -> null;
        };
        if (sql == null) {
            return Mono.just(false);
        }
        return databaseClient.sql(sql).bind("projectId", projectId).bind("entityId", entityId)
                .map((row, metadata) -> Boolean.TRUE.equals(row.get("present", Boolean.class))).one();
    }

    /** 查询相邻镜头的资产版本连续性问题。 */
    public Flux<ComicDramaDtos.ContinuityIssue> listContinuityIssues(String projectId) {
        return databaseClient.sql("""
                WITH ordered AS (
                    SELECT id, source_scene_id, sort_order, lag(id) OVER (ORDER BY sort_order,id) previous_id,
                           lag(source_scene_id) OVER (ORDER BY sort_order,id) previous_scene_id
                    FROM comic_drama_shots WHERE script_project_id=:projectId
                ), versions AS (
                    SELECT sh.id shot_id, a.id asset_id, v.id version_id
                    FROM comic_drama_shots sh JOIN comic_drama_shot_asset_versions sav ON sav.shot_id=sh.id
                    JOIN comic_drama_asset_versions v ON v.id=sav.asset_version_id JOIN comic_drama_assets a ON a.id=v.asset_id
                    WHERE sh.script_project_id=:projectId
                )
                SELECT o.previous_id,o.id shot_id,v1.asset_id,v1.version_id previous_version,v2.version_id current_version
                FROM ordered o JOIN versions v1 ON v1.shot_id=o.previous_id JOIN versions v2 ON v2.shot_id=o.id AND v2.asset_id=v1.asset_id
                WHERE o.previous_id IS NOT NULL AND o.source_scene_id IS NOT DISTINCT FROM o.previous_scene_id
                    AND v1.version_id<>v2.version_id
                """).bind("projectId", projectId).map((row, metadata) -> new ComicDramaDtos.ContinuityIssue(
                        "assetVersion", "warning", row.get("previous_id", String.class), row.get("shot_id", String.class),
                        "相邻镜头资产版本发生变化", "同一场次相邻镜头引用了同一资产的不同视觉版本：" + row.get("asset_id", String.class),
                        "确认变化符合剧情，或统一为同一资产版本。")).all();
    }

    /** 映射视觉资产记录。 */
    private ComicDramaDtos.Asset mapAsset(Row row) {
        return new ComicDramaDtos.Asset(row.get("id", String.class), row.get("asset_type", String.class),
                row.get("source_entity_id", String.class), row.get("name", String.class), row.get("description", String.class),
                object(row, "voice_preference"), row.get("usage_status", String.class), value(row, "revision", Long.class, 0L),
                row.get("created_at", OffsetDateTime.class), row.get("updated_at", OffsetDateTime.class));
    }

    /** 映射视觉资产版本记录。 */
    private ComicDramaDtos.AssetVersion mapAssetVersion(Row row) {
        JSONArray media = array(row, "reference_media");
        return new ComicDramaDtos.AssetVersion(row.get("id", String.class), row.get("asset_id", String.class),
                row.get("version_name", String.class), row.get("variant_type", String.class),
                row.get("appearance_description", String.class), media.toJavaList(JSONObject.class), object(row, "attributes"),
                row.get("status", String.class), value(row, "revision", Long.class, 0L),
                row.get("created_at", OffsetDateTime.class), row.get("updated_at", OffsetDateTime.class));
    }

    /** 映射镜头草稿记录。 */
    private ComicDramaDtos.ShotDraft mapShotDraft(Row row) {
        return new ComicDramaDtos.ShotDraft(row.get("id", String.class), row.get("script_project_id", String.class),
                row.get("scope_type", String.class), row.get("scope_id", String.class),
                value(row, "base_project_revision", Long.class, 0L),
                value(row, "base_script_revision", Long.class, 0L), row.get("instruction", String.class),
                row.get("model", String.class), object(row, "draft_data"), value(row, "charged_credits", Integer.class, 0),
                row.get("status", String.class), row.get("created_at", OffsetDateTime.class),
                row.get("confirmed_at", OffsetDateTime.class));
    }

    /** 映射正式镜头记录。 */
    private ComicDramaDtos.Shot mapShot(Row row) {
        return new ComicDramaDtos.Shot(row.get("id", String.class), row.get("source_episode_id", String.class),
                row.get("source_scene_id", String.class), row.get("source_script_excerpt", String.class),
                value(row, "shot_number", Integer.class, 1), value(row, "sort_order", Integer.class, 0),
                value(row, "duration_seconds", BigDecimal.class, BigDecimal.ZERO), row.get("shot_size", String.class),
                row.get("composition", String.class), row.get("visual_description", String.class),
                row.get("action_description", String.class), row.get("camera_movement", String.class),
                row.get("lighting_atmosphere", String.class), row.get("dialogue_voiceover", String.class),
                row.get("sound_description", String.class), row.get("style_override", String.class),
                row.get("production_status", String.class), array(row, "asset_version_ids").toJavaList(String.class),
                value(row, "revision", Long.class, 0L), row.get("created_at", OffsetDateTime.class),
                row.get("updated_at", OffsetDateTime.class));
    }

    /** 映射提示词版本记录。 */
    private ComicDramaDtos.PromptVersion mapPrompt(Row row) {
        return new ComicDramaDtos.PromptVersion(row.get("id", String.class), row.get("shot_id", String.class),
                value(row, "version_number", Integer.class, 1), row.get("source_type", String.class),
                row.get("prompt_text", String.class), object(row, "source_snapshot"), row.get("model", String.class),
                value(row, "charged_credits", Integer.class, 0), row.get("status", String.class),
                row.get("created_at", OffsetDateTime.class));
    }

    /** 映射媒体结果记录。 */
    private ComicDramaDtos.MediaResult mapMedia(Row row) {
        return new ComicDramaDtos.MediaResult(row.get("id", String.class), row.get("target_type", String.class),
                row.get("target_id", String.class), row.get("media_type", String.class), row.get("task_id", String.class),
                object(row, "input_snapshot"), object(row, "result_data"), row.get("status", String.class),
                Boolean.TRUE.equals(row.get("adopted", Boolean.class)), row.get("failure_reason", String.class),
                row.get("created_at", OffsetDateTime.class), row.get("updated_at", OffsetDateTime.class));
    }

    /** 映射变化影响记录。 */
    private ComicDramaDtos.ChangeImpact mapImpact(Row row) {
        return new ComicDramaDtos.ChangeImpact(row.get("id", String.class), row.get("source_type", String.class),
                row.get("source_id", String.class), row.get("target_type", String.class), row.get("target_id", String.class),
                row.get("change_summary", String.class), object(row, "impact_snapshot"), row.get("status", String.class),
                row.get("created_at", OffsetDateTime.class), row.get("resolved_at", OffsetDateTime.class));
    }

    /** 映射声音轨记录。 */
    private ComicDramaDtos.VoiceTrack mapVoiceTrack(Row row) {
        return new ComicDramaDtos.VoiceTrack(row.get("id", String.class), row.get("shot_id", String.class),
                row.get("source_block_id", String.class), row.get("character_id", String.class), row.get("track_type", String.class),
                row.get("content", String.class), row.get("voice_model", String.class),
                value(row, "speech_rate", BigDecimal.class, BigDecimal.ONE), row.get("tone", String.class),
                row.get("emotion", String.class), row.get("status", String.class), value(row, "revision", Long.class, 0L),
                row.get("audio_storage_key", String.class), row.get("audio_duration_ms", Long.class),
                row.get("timeline_start_ms", Long.class), row.get("trim_start_ms", Long.class), row.get("trim_end_ms", Long.class),
                row.get("created_at", OffsetDateTime.class), row.get("updated_at", OffsetDateTime.class));
    }

    /**
     * 将数据库行映射为时间轴文字片段。
     *
     * @param row 文字片段数据库行
     * @return 时间轴文字片段
     */
    private ComicDramaDtos.TimelineText mapTimelineText(Row row) {
        return new ComicDramaDtos.TimelineText(row.get("id", String.class), row.get("content", String.class),
                value(row, "start_ms", Long.class, 0L), value(row, "end_ms", Long.class, 0L),
                value(row, "track_number", Integer.class, 0),
                row.get("position_x", BigDecimal.class), row.get("position_y", BigDecimal.class),
                value(row, "font_size", Integer.class, 36), row.get("font_family", String.class), row.get("color", String.class),
                row.get("alignment", String.class), row.get("background_color", String.class),
                value(row, "revision", Long.class, 0L), row.get("created_at", OffsetDateTime.class),
                row.get("updated_at", OffsetDateTime.class));
    }

    /** 映射批量任务记录。 */
    private ComicDramaDtos.BatchTask mapBatchTask(Row row) {
        return new ComicDramaDtos.BatchTask(row.get("id", String.class), row.get("batch_type", String.class),
                row.get("scope_type", String.class), object(row, "scope_data"), object(row, "model_settings"),
                value(row, "estimated_credits", Integer.class, 0), value(row, "total_count", Integer.class, 0),
                value(row, "queued_count", Integer.class, 0), value(row, "processing_count", Integer.class, 0),
                value(row, "completed_count", Integer.class, 0), value(row, "failed_count", Integer.class, 0),
                value(row, "needs_update_count", Integer.class, 0), row.get("status", String.class),
                row.get("confirmed_at", OffsetDateTime.class), row.get("created_at", OffsetDateTime.class),
                row.get("updated_at", OffsetDateTime.class));
    }

    /** 映射画布绑定记录。 */
    private ComicDramaDtos.CanvasBinding mapCanvasBinding(Row row) {
        return new ComicDramaDtos.CanvasBinding(row.get("id", String.class), row.get("target_type", String.class),
                row.get("target_id", String.class), row.get("canvas_id", String.class), row.get("node_id", String.class),
                object(row, "binding_data"), row.get("created_at", OffsetDateTime.class),
                row.get("updated_at", OffsetDateTime.class));
    }

    /** 将可空参数安全绑定到数据库语句。 */
    private <T> DatabaseClient.GenericExecuteSpec bindNullable(DatabaseClient.GenericExecuteSpec spec, String name,
                                                                T value, Class<T> type) {
        return value == null || value instanceof String string && string.isBlank()
                ? spec.bindNull(name, type) : spec.bind(name, value);
    }

    /** 读取行字段并提供非空默认值。 */
    private <T> T value(Row row, String column, Class<T> type, T defaultValue) {
        T result = row.get(column, type);
        return result == null ? defaultValue : result;
    }

    /** 读取JSON对象字段。 */
    private JSONObject object(Row row, String column) {
        JSONObject value = JSON.parseObject(RowMappers.jsonText(row, column));
        return value == null ? new JSONObject() : value;
    }

    /** 读取JSON数组字段。 */
    private JSONArray array(Row row, String column) {
        JSONArray value = JSON.parseArray(RowMappers.jsonText(row, column));
        return value == null ? new JSONArray() : value;
    }

    /** 序列化JSON对象并保证数据库收到对象。 */
    private String json(JSONObject value) {
        return value == null ? "{}" : value.toJSONString();
    }

    /** 标准化可选文本。 */
    private String text(String value) {
        return value == null ? "" : value.trim();
    }
}

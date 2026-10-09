package com.novanovastudio.repository;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.dto.ScriptDtos;
import io.r2dbc.spi.Row;
import java.time.OffsetDateTime;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.r2dbc.core.DatabaseClient;
import org.springframework.stereotype.Repository;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * 剧本创作关系数据仓储。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-09-20 10:30
 */
@Repository
@RequiredArgsConstructor
public class ScriptRepository {

    /** 响应式数据库客户端。 */
    private final DatabaseClient databaseClient;

    /** 剧本项目数据库记录。 */
    public record ProjectRecord(String id, Long userId, ScriptDtos.ProjectOverview overview, String stage,
                                int completionRate, long revision, OffsetDateTime productionStartedAt,
                                OffsetDateTime createdAt, OffsetDateTime updatedAt) {
    }

    /** 场次与所属分集数据库记录。 */
    public record SceneParentRecord(String sceneId, String episodeId) {
    }

    /**
     * 查询当前用户的剧本项目。
     *
     * @param userId Long 用户ID
     * @param keyword String 搜索关键字
     * @param stage String 阶段筛选
     * @param contentType String 内容形式筛选
     * @param offset int 分页偏移
     * @param limit int 每页数量
     * @return Flux<ProjectSummary> 项目摘要流
     */
    public Flux<ScriptDtos.ProjectSummary> listProjects(Long userId, String keyword, String stage,
                                                        String contentType, int offset, int limit) {
        String filter = projectFilter();
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("""
                SELECT p.id, p.title, p.content_type, p.genre, p.logline, p.stage, p.completion_rate,
                       p.target_episode_count, p.production_started_at, p.revision, p.updated_at,
                       COUNT(e.id)::INTEGER AS episode_count
                FROM script_projects p
                LEFT JOIN script_episodes e ON e.project_id = p.id
                WHERE p.user_id = :userId AND p.status = 1
                """ + filter + """
                GROUP BY p.id
                ORDER BY p.updated_at DESC, p.id
                OFFSET :offset LIMIT :limit
                """).bind("userId", userId).bind("offset", offset).bind("limit", limit);
        spec = bindProjectFilter(spec, keyword, stage, contentType);
        return spec.map((row, metadata) -> new ScriptDtos.ProjectSummary(
                row.get("id", String.class), row.get("title", String.class), row.get("content_type", String.class),
                row.get("genre", String.class), row.get("logline", String.class), row.get("stage", String.class),
                value(row, "completion_rate", Integer.class, 0), value(row, "episode_count", Integer.class, 0),
                value(row, "target_episode_count", Integer.class, 1), row.get("production_started_at", OffsetDateTime.class) != null,
                value(row, "revision", Long.class, 0L), row.get("updated_at", OffsetDateTime.class))).all();
    }

    /**
     * 查询符合条件的项目总数。
     *
     * @param userId 当前用户标识
     * @param keyword 搜索关键字
     * @param stage 阶段筛选
     * @param contentType 内容形式筛选
     * @return 项目总数
     */
    public Mono<Long> countProjects(Long userId, String keyword, String stage, String contentType) {
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("""
                SELECT COUNT(*) AS total FROM script_projects p
                WHERE p.user_id = :userId AND p.status = 1
                """ + projectFilter()).bind("userId", userId);
        spec = bindProjectFilter(spec, keyword, stage, contentType);
        return spec.map((row, metadata) -> value(row, "total", Long.class, 0L)).one();
    }

    /**
     * 查询启用的剧本模板。
     *
     * @return 模板数据流
     */
    public Flux<ScriptDtos.ScriptTemplate> listTemplates() {
        return databaseClient.sql("""
                SELECT template_key, category, name, description, content_type, genre, structure_type,
                       recommended_episode_count
                FROM script_templates WHERE status = 1 ORDER BY sort_order, template_key
                """).map((row, metadata) -> new ScriptDtos.ScriptTemplate(
                row.get("template_key", String.class), row.get("category", String.class), row.get("name", String.class),
                row.get("description", String.class), row.get("content_type", String.class), row.get("genre", String.class),
                row.get("structure_type", String.class), value(row, "recommended_episode_count", Integer.class, 1), List.of())).all();
    }

    /**
     * 查询模板结构段。
     *
     * @param templateKey 模板稳定键
     * @return 模板结构段数据流
     */
    public Flux<ScriptDtos.TemplateSection> listTemplateSections(String templateKey) {
        return databaseClient.sql("""
                SELECT id, title, section_type, guidance, sort_order FROM script_template_sections
                WHERE template_key = :templateKey ORDER BY sort_order, id
                """).bind("templateKey", templateKey).map((row, metadata) -> new ScriptDtos.TemplateSection(
                row.get("id", String.class), row.get("title", String.class), row.get("section_type", String.class),
                row.get("guidance", String.class), value(row, "sort_order", Integer.class, 0))).all();
    }

    /**
     * 查询指定模板。
     *
     * @param templateKey 模板稳定键
     * @return 启用的模板
     */
    public Mono<ScriptDtos.ScriptTemplate> getTemplate(String templateKey) {
        return databaseClient.sql("""
                SELECT template_key, category, name, description, content_type, genre, structure_type,
                       recommended_episode_count
                FROM script_templates WHERE template_key = :templateKey AND status = 1
                """).bind("templateKey", templateKey).map((row, metadata) -> new ScriptDtos.ScriptTemplate(
                row.get("template_key", String.class), row.get("category", String.class), row.get("name", String.class),
                row.get("description", String.class), row.get("content_type", String.class), row.get("genre", String.class),
                row.get("structure_type", String.class), value(row, "recommended_episode_count", Integer.class, 1), List.of())).one();
    }

    /**
     * 创建剧本项目。
     *
     * @param project 项目数据库记录
     * @return 创建完成信号
     */
    public Mono<Void> createProject(ProjectRecord project) {
        ScriptDtos.ProjectOverview overview = project.overview();
        return databaseClient.sql("""
                INSERT INTO script_projects(id, user_id, title, content_type, genre, logline, synopsis,
                    target_duration_seconds, target_episode_count,
                    narrative_style, theme, main_plot, main_conflict, ending_direction)
                VALUES (:id, :userId, :title, :contentType, :genre, :logline, :synopsis,
                    :targetDurationSeconds, :targetEpisodeCount, :narrativeStyle,
                    :theme, :mainPlot, :mainConflict, :endingDirection)
                """).bind("id", project.id()).bind("userId", project.userId()).bind("title", overview.title())
                .bind("contentType", overview.contentType()).bind("genre", text(overview.genre()))
                .bind("logline", text(overview.logline())).bind("synopsis", text(overview.synopsis()))
                .bind("targetDurationSeconds", overview.targetDurationSeconds()).bind("targetEpisodeCount", overview.targetEpisodeCount())
                .bind("narrativeStyle", text(overview.narrativeStyle())).bind("theme", text(overview.theme()))
                .bind("mainPlot", text(overview.mainPlot())).bind("mainConflict", text(overview.mainConflict()))
                .bind("endingDirection", text(overview.endingDirection())).fetch().rowsUpdated().then();
    }

    /**
     * 按当前用户查询项目。
     *
     * @param userId 当前用户标识
     * @param projectId 剧本项目标识
     * @return 项目数据库记录
     */
    public Mono<ProjectRecord> getProject(Long userId, String projectId) {
        return databaseClient.sql("""
                SELECT * FROM script_projects WHERE id = :projectId AND user_id = :userId AND status = 1
                """).bind("projectId", projectId).bind("userId", userId)
                .map((row, metadata) -> mapProject(row)).one();
    }

    /**
     * 按当前修订号软删除当前用户的单个项目。
     *
     * @param userId 当前用户标识
     * @param projectId 待删除项目标识
     * @param expectedRevision 期望修订号
     * @return 更新后的项目修订号和时间，未命中时为空
     */
    public Mono<ScriptDtos.DeletedProjectResult> deleteProject(Long userId, String projectId, long expectedRevision) {
        return databaseClient.sql("""
                UPDATE script_projects SET status = 0, revision = revision + 1, updated_at = CURRENT_TIMESTAMP
                WHERE user_id = :userId AND status = 1 AND id = :projectId AND revision = :expectedRevision
                RETURNING id, revision, updated_at
                """).bind("userId", userId).bind("projectId", projectId).bind("expectedRevision", expectedRevision)
                .map((row, metadata) -> new ScriptDtos.DeletedProjectResult(row.get("id", String.class),
                        value(row, "revision", Long.class, 0L), row.get("updated_at", OffsetDateTime.class))).one();
    }

    /**
     * 使用乐观锁更新故事概览并递增修订号。
     *
     * @param userId 当前用户标识
     * @param projectId 剧本项目标识
     * @param expectedRevision 期望修订号
     * @param overview 故事概览
     * @return 数据库更新行数
     */
    public Mono<Long> updateOverview(Long userId, String projectId, long expectedRevision, ScriptDtos.ProjectOverview overview) {
        return databaseClient.sql("""
                UPDATE script_projects SET title=:title, content_type=:contentType, genre=:genre, logline=:logline,
                    synopsis=:synopsis,
                    target_duration_seconds=:targetDurationSeconds, target_episode_count=:targetEpisodeCount,
                    narrative_style=:narrativeStyle, theme=:theme, main_plot=:mainPlot, main_conflict=:mainConflict,
                    ending_direction=:endingDirection, revision=revision+1, updated_at=CURRENT_TIMESTAMP
                WHERE id=:projectId AND user_id=:userId AND status=1 AND revision=:expectedRevision
                """).bind("title", overview.title()).bind("contentType", overview.contentType())
                .bind("genre", text(overview.genre())).bind("logline", text(overview.logline()))
                .bind("synopsis", text(overview.synopsis())).bind("targetDurationSeconds", overview.targetDurationSeconds())
                .bind("targetEpisodeCount", overview.targetEpisodeCount()).bind("narrativeStyle", text(overview.narrativeStyle()))
                .bind("theme", text(overview.theme())).bind("mainPlot", text(overview.mainPlot()))
                .bind("mainConflict", text(overview.mainConflict())).bind("endingDirection", text(overview.endingDirection()))
                .bind("projectId", projectId).bind("userId", userId).bind("expectedRevision", expectedRevision)
                .fetch().rowsUpdated();
    }

    /**
     * 使用乐观锁锁定一次区块修改并递增修订号。
     *
     * @param userId 当前用户标识
     * @param projectId 剧本项目标识
     * @param expectedRevision 期望修订号
     * @return 数据库更新行数
     */
    public Mono<Long> advanceRevision(Long userId, String projectId, long expectedRevision) {
        return databaseClient.sql("""
                UPDATE script_projects SET revision=revision+1, updated_at=CURRENT_TIMESTAMP
                WHERE id=:projectId AND user_id=:userId AND status=1 AND revision=:expectedRevision
                """).bind("projectId", projectId).bind("userId", userId).bind("expectedRevision", expectedRevision)
                .fetch().rowsUpdated();
    }

    /**
     * 更新计算得到的阶段与完成度。
     *
     * @param projectId 剧本项目标识
     * @param stage 自动推导阶段
     * @param completionRate 完成度
     * @return 更新完成信号
     */
    public Mono<Void> updateProgress(String projectId, String stage, int completionRate) {
        return databaseClient.sql("""
                UPDATE script_projects SET stage=:stage, completion_rate=:completionRate, updated_at=CURRENT_TIMESTAMP
                WHERE id=:projectId
                """).bind("stage", stage).bind("completionRate", completionRate).bind("projectId", projectId)
                .fetch().rowsUpdated().then();
    }

    /**
     * 标记项目进入漫剧制作并递增修订号。
     *
     * @param userId 当前用户标识
     * @param projectId 剧本项目标识
     * @param expectedRevision 期望修订号
     * @return 数据库更新行数
     */
    public Mono<Long> enterProduction(Long userId, String projectId, long expectedRevision) {
        return databaseClient.sql("""
                UPDATE script_projects SET stage='production', production_started_at=COALESCE(production_started_at, CURRENT_TIMESTAMP),
                    revision=revision+1, updated_at=CURRENT_TIMESTAMP
                WHERE id=:projectId AND user_id=:userId AND status=1 AND revision=:expectedRevision
                """).bind("projectId", projectId).bind("userId", userId).bind("expectedRevision", expectedRevision)
                .fetch().rowsUpdated();
    }

    /**
     * 查询项目大纲结构段。
     *
     * @param projectId 剧本项目标识
     * @return 大纲结构段数据流
     */
    public Flux<ScriptDtos.OutlineSection> listOutlineSections(String projectId) {
        return databaseClient.sql("""
                SELECT id, section_type, title, content, sort_order FROM script_outline_sections
                WHERE project_id=:projectId ORDER BY sort_order, id
                """).bind("projectId", projectId).map((row, metadata) -> new ScriptDtos.OutlineSection(
                row.get("id", String.class), row.get("section_type", String.class), row.get("title", String.class),
                row.get("content", String.class), value(row, "sort_order", Integer.class, 0))).all();
    }

    /**
     * 查询项目故事事件。
     *
     * @param projectId 剧本项目标识
     * @return 故事事件数据流
     */
    public Flux<ScriptDtos.StoryEvent> listStoryEvents(String projectId) {
        return databaseClient.sql("""
                SELECT id, outline_section_id, episode_id, scene_id, event_type, title, description, sort_order
                FROM script_story_events WHERE project_id=:projectId ORDER BY sort_order, id
                """).bind("projectId", projectId).map((row, metadata) -> new ScriptDtos.StoryEvent(
                row.get("id", String.class), row.get("outline_section_id", String.class), row.get("episode_id", String.class),
                row.get("scene_id", String.class), row.get("event_type", String.class), row.get("title", String.class),
                row.get("description", String.class), value(row, "sort_order", Integer.class, 0))).all();
    }

    /**
     * 检查稳定标识是否已经属于其他剧本项目。
     * <p>
     * 正式实体使用全局主键；保存前必须拒绝把其他项目的标识静默当作当前项目数据写入。
     *
     * @param projectId 当前剧本项目标识
     * @param resourceType 资源类型：outline、event、character、relation、worldItem、location、episode、scene、block
     * @param ids 待检查的稳定标识
     * @return Mono&lt;Long&gt; 属于其他项目的标识数量
     */
    public Mono<Long> countIdsOwnedByAnotherProject(String projectId, String resourceType, List<String> ids) {
        if (ids.isEmpty()) {
            return Mono.just(0L);
        }
        String placeholders = R2dbcBindings.namedPlaceholders("resourceId", ids.size());
        String sql = switch (resourceType) {
            case "outline" -> "SELECT COUNT(*) AS total FROM script_outline_sections WHERE id IN (" + placeholders + ") AND project_id <> :projectId";
            case "event" -> "SELECT COUNT(*) AS total FROM script_story_events WHERE id IN (" + placeholders + ") AND project_id <> :projectId";
            case "character" -> "SELECT COUNT(*) AS total FROM script_characters WHERE id IN (" + placeholders + ") AND project_id <> :projectId";
            case "relation" -> "SELECT COUNT(*) AS total FROM script_character_relations WHERE id IN (" + placeholders + ") AND project_id <> :projectId";
            case "worldItem" -> "SELECT COUNT(*) AS total FROM script_world_items WHERE id IN (" + placeholders + ") AND project_id <> :projectId";
            case "location" -> "SELECT COUNT(*) AS total FROM script_locations WHERE id IN (" + placeholders + ") AND project_id <> :projectId";
            case "episode" -> "SELECT COUNT(*) AS total FROM script_episodes WHERE id IN (" + placeholders + ") AND project_id <> :projectId";
            case "scene" -> "SELECT COUNT(*) AS total FROM script_scenes s JOIN script_episodes e ON e.id = s.episode_id WHERE s.id IN (" + placeholders + ") AND e.project_id <> :projectId";
            case "block" -> "SELECT COUNT(*) AS total FROM script_blocks b JOIN script_scenes s ON s.id = b.scene_id JOIN script_episodes e ON e.id = s.episode_id WHERE b.id IN (" + placeholders + ") AND e.project_id <> :projectId";
            default -> throw new IllegalArgumentException("不支持的剧本资源类型：" + resourceType);
        };
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql(sql).bind("projectId", projectId);
        return R2dbcBindings.bindList(spec, "resourceId", ids)
                .map((row, metadata) -> value(row, "total", Long.class, 0L)).one();
    }

    /**
     * 检查场次或正文块标识是否已经属于另一父级实体。
     *
     * @param parentId 当前分集或场次标识
     * @param resourceType scene为场次、block为正文块
     * @param ids 待保存的稳定标识
     * @return Mono&lt;Long&gt; 已被其他父级占用的标识数量
     */
    public Mono<Long> countIdsOwnedByAnotherParent(String parentId, String resourceType, List<String> ids) {
        if (ids.isEmpty()) {
            return Mono.just(0L);
        }
        String table = switch (resourceType) {
            case "scene" -> "script_scenes";
            case "block" -> "script_blocks";
            default -> throw new IllegalArgumentException("不支持的剧本资源类型：" + resourceType);
        };
        String column = "scene".equals(resourceType) ? "episode_id" : "scene_id";
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("SELECT COUNT(*) AS total FROM " + table
                + " WHERE id IN (" + R2dbcBindings.namedPlaceholders("resourceId", ids.size()) + ") AND " + column + " <> :parentId")
                .bind("parentId", parentId);
        return R2dbcBindings.bindList(spec, "resourceId", ids)
                .map((row, metadata) -> value(row, "total", Long.class, 0L)).one();
    }

    /**
     * 查询项目内所有场次及其所属分集。
     *
     * @param projectId 剧本项目标识
     * @return Flux&lt;SceneParentRecord&gt; 场次父级记录流
     */
    public Flux<SceneParentRecord> listSceneParents(String projectId) {
        return databaseClient.sql("""
                SELECT s.id AS scene_id, s.episode_id FROM script_scenes s
                JOIN script_episodes e ON e.id = s.episode_id
                WHERE e.project_id=:projectId ORDER BY e.sort_order, s.sort_order, s.id
                """).bind("projectId", projectId).map((row, metadata) -> new SceneParentRecord(
                        row.get("scene_id", String.class), row.get("episode_id", String.class))).all();
    }

    /**
     * 替换项目大纲和故事事件。
     *
     * @param projectId 剧本项目标识
     * @param sections 大纲结构段
     * @param events 故事事件
     * @return 替换完成信号
     */
    public Mono<Void> replaceOutline(String projectId, List<ScriptDtos.OutlineSection> sections, List<ScriptDtos.StoryEvent> events) {
        return databaseClient.sql("DELETE FROM script_story_events WHERE project_id=:projectId").bind("projectId", projectId).fetch().rowsUpdated()
                .then(databaseClient.sql("DELETE FROM script_outline_sections WHERE project_id=:projectId").bind("projectId", projectId).fetch().rowsUpdated())
                .thenMany(Flux.fromIterable(sections).concatMap(section -> databaseClient.sql("""
                        INSERT INTO script_outline_sections(id, project_id, section_type, title, content, sort_order)
                        VALUES (:id,:projectId,:sectionType,:title,:content,:sortOrder)
                        """).bind("id", section.id()).bind("projectId", projectId).bind("sectionType", section.sectionType())
                        .bind("title", section.title()).bind("content", text(section.content())).bind("sortOrder", section.sortOrder())
                        .fetch().rowsUpdated())).then()
                .thenMany(Flux.fromIterable(events).concatMap(event -> insertStoryEvent(projectId, event))).then();
    }

    /**
     * 查询项目人物。
     *
     * @param projectId 剧本项目标识
     * @return 人物数据流
     */
    public Flux<ScriptDtos.Character> listCharacters(String projectId) {
        return databaseClient.sql("""
                SELECT * FROM script_characters WHERE project_id=:projectId ORDER BY sort_order, id
                """).bind("projectId", projectId).map((row, metadata) -> new ScriptDtos.Character(
                row.get("id", String.class), row.get("name", String.class), row.get("identity", String.class),
                row.get("age", String.class), row.get("occupation", String.class), row.get("role_type", String.class),
                row.get("personality", String.class), row.get("values_description", String.class), row.get("goal", String.class),
                row.get("desire", String.class), row.get("fear", String.class), row.get("motivation", String.class),
                row.get("appearance_description", String.class), row.get("habits", String.class), row.get("speech_style", String.class),
                row.get("background_story", String.class), row.get("character_arc", String.class),
                value(row, "sort_order", Integer.class, 0))).all();
    }

    /**
     * 查询人物关系。
     *
     * @param projectId 剧本项目标识
     * @return 人物关系数据流
     */
    public Flux<ScriptDtos.CharacterRelation> listCharacterRelations(String projectId) {
        return databaseClient.sql("""
                SELECT * FROM script_character_relations WHERE project_id=:projectId ORDER BY sort_order, id
                """).bind("projectId", projectId).map((row, metadata) -> new ScriptDtos.CharacterRelation(
                row.get("id", String.class), row.get("source_character_id", String.class), row.get("target_character_id", String.class),
                row.get("relationship_type", String.class), row.get("relationship_direction", String.class), row.get("story_stage", String.class),
                row.get("conflict_description", String.class), row.get("description", String.class),
                value(row, "sort_order", Integer.class, 0))).all();
    }

    /**
     * 查询待删除人物的正文和场次引用数量。
     *
     * @param projectId 剧本项目标识
     * @param characterIds 待删除人物标识
     * @return 引用总数
     */
    public Mono<Long> countCharacterReferences(String projectId, List<String> characterIds) {
        if (characterIds.isEmpty()) return Mono.just(0L);
        String scenePlaceholders = R2dbcBindings.namedPlaceholders("sceneCharacterId", characterIds.size());
        String blockPlaceholders = R2dbcBindings.namedPlaceholders("blockCharacterId", characterIds.size());
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("""
                SELECT (SELECT COUNT(*) FROM script_scene_characters sc
                        JOIN script_scenes s ON s.id=sc.scene_id JOIN script_episodes e ON e.id=s.episode_id
                        WHERE e.project_id=:projectId AND sc.character_id IN (
                """ + scenePlaceholders + ")) + (SELECT COUNT(*) FROM script_blocks b JOIN script_scenes s ON s.id=b.scene_id " +
                "JOIN script_episodes e ON e.id=s.episode_id WHERE e.project_id=:projectId AND b.character_id IN (" + blockPlaceholders + ")) AS total")
                .bind("projectId", projectId);
        spec = R2dbcBindings.bindList(spec, "sceneCharacterId", characterIds);
        spec = R2dbcBindings.bindList(spec, "blockCharacterId", characterIds);
        return spec.map((row, metadata) -> value(row, "total", Long.class, 0L)).one();
    }

    /**
     * 查询人物被正文引用的前五个具体位置，供删除阻止信息展示。
     *
     * @param projectId 剧本项目标识
     * @param characterIds 待删除人物标识
     * @return 包含集号、场号与引用类型的位置流
     */
    public Flux<String> listCharacterReferenceLocations(String projectId, List<String> characterIds) {
        if (characterIds.isEmpty()) return Flux.empty();
        String scenePlaceholders = R2dbcBindings.namedPlaceholders("sceneCharacterId", characterIds.size());
        String blockPlaceholders = R2dbcBindings.namedPlaceholders("blockCharacterId", characterIds.size());
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("""
                SELECT episode_number, scene_number, reference_type FROM (
                    SELECT e.episode_number, s.scene_number, '出场' AS reference_type
                    FROM script_scene_characters sc JOIN script_scenes s ON s.id = sc.scene_id
                    JOIN script_episodes e ON e.id = s.episode_id
                    WHERE e.project_id = :projectId AND sc.character_id IN (
                """ + scenePlaceholders + """ 
                    ) UNION ALL
                    SELECT e.episode_number, s.scene_number, '对白' AS reference_type
                    FROM script_blocks b JOIN script_scenes s ON s.id = b.scene_id
                    JOIN script_episodes e ON e.id = s.episode_id
                    WHERE e.project_id = :projectId AND b.character_id IN (
                """ + blockPlaceholders + """
                    )
                ) references_by_scene ORDER BY episode_number, scene_number, reference_type LIMIT 5
                """).bind("projectId", projectId);
        spec = R2dbcBindings.bindList(spec, "sceneCharacterId", characterIds);
        return R2dbcBindings.bindList(spec, "blockCharacterId", characterIds)
                .map((row, metadata) -> "第" + value(row, "episode_number", Integer.class, 0)
                        + "集第" + value(row, "scene_number", Integer.class, 0)
                        + "场（" + row.get("reference_type", String.class) + "）").all();
    }

    /**
     * 按稳定标识替换人物及人物关系。
     *
     * @param projectId 剧本项目标识
     * @param characters 人物设定
     * @param relations 人物关系
     * @return 替换完成信号
     */
    public Mono<Void> replaceCharacters(String projectId, List<ScriptDtos.Character> characters,
                                        List<ScriptDtos.CharacterRelation> relations) {
        return databaseClient.sql("DELETE FROM script_character_relations WHERE project_id=:projectId").bind("projectId", projectId).fetch().rowsUpdated()
                .thenMany(Flux.fromIterable(characters).concatMap(character -> insertCharacter(projectId, character))).then()
                .then(deleteCharactersNotIn(projectId, characters.stream().map(ScriptDtos.Character::id).toList()))
                .thenMany(Flux.fromIterable(relations).concatMap(relation -> insertCharacterRelation(projectId, relation))).then();
    }

    /**
     * 查询世界观基础设定。
     *
     * @param projectId 剧本项目标识
     * @return 世界观基础设定
     */
    public Mono<ScriptDtos.WorldSetting> getWorldSetting(String projectId) {
        return databaseClient.sql("SELECT * FROM script_world_settings WHERE project_id=:projectId").bind("projectId", projectId)
                .map((row, metadata) -> new ScriptDtos.WorldSetting(row.get("era", String.class), row.get("region", String.class),
                        row.get("social_background", String.class), row.get("overall_tone", String.class))).one()
                .defaultIfEmpty(new ScriptDtos.WorldSetting("", "", "", ""));
    }

    /**
     * 查询世界观条目。
     *
     * @param projectId 剧本项目标识
     * @return 世界观条目数据流
     */
    public Flux<ScriptDtos.WorldItem> listWorldItems(String projectId) {
        return databaseClient.sql("SELECT * FROM script_world_items WHERE project_id=:projectId ORDER BY sort_order,id")
                .bind("projectId", projectId).map((row, metadata) -> new ScriptDtos.WorldItem(
                        row.get("id", String.class), row.get("item_type", String.class), row.get("name", String.class),
                        row.get("description", String.class), value(row, "sort_order", Integer.class, 0))).all();
    }

    /**
     * 查询场景地点。
     *
     * @param projectId 剧本项目标识
     * @return 场景地点数据流
     */
    public Flux<ScriptDtos.Location> listLocations(String projectId) {
        return databaseClient.sql("SELECT * FROM script_locations WHERE project_id=:projectId ORDER BY sort_order,id")
                .bind("projectId", projectId).map((row, metadata) -> new ScriptDtos.Location(
                        row.get("id", String.class), row.get("name", String.class), row.get("space_purpose", String.class),
                        row.get("narrative_role", String.class), row.get("default_time", String.class), row.get("weather", String.class),
                        row.get("atmosphere", String.class), row.get("key_objects", String.class), row.get("main_events", String.class),
                        value(row, "sort_order", Integer.class, 0))).all();
    }

    /**
     * 查询待删除地点的场次引用数量。
     *
     * @param projectId 剧本项目标识
     * @param locationIds 待删除地点标识
     * @return 引用总数
     */
    public Mono<Long> countLocationReferences(String projectId, List<String> locationIds) {
        if (locationIds.isEmpty()) return Mono.just(0L);
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("""
                SELECT COUNT(*) AS total FROM script_scenes s JOIN script_episodes e ON e.id=s.episode_id
                WHERE e.project_id=:projectId AND s.location_id IN (
                """ + R2dbcBindings.namedPlaceholders("locationId", locationIds.size()) + ")").bind("projectId", projectId);
        return R2dbcBindings.bindList(spec, "locationId", locationIds).map((row, metadata) -> value(row, "total", Long.class, 0L)).one();
    }

    /**
     * 查询地点被场次引用的前五个具体位置，供删除阻止信息展示。
     *
     * @param projectId 剧本项目标识
     * @param locationIds 待删除地点标识
     * @return 包含集号与场号的位置流
     */
    public Flux<String> listLocationReferenceLocations(String projectId, List<String> locationIds) {
        if (locationIds.isEmpty()) return Flux.empty();
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("""
                SELECT e.episode_number, s.scene_number FROM script_scenes s
                JOIN script_episodes e ON e.id = s.episode_id
                WHERE e.project_id = :projectId AND s.location_id IN (
                """ + R2dbcBindings.namedPlaceholders("locationId", locationIds.size()) + """
                ) ORDER BY e.episode_number, s.scene_number LIMIT 5
                """).bind("projectId", projectId);
        return R2dbcBindings.bindList(spec, "locationId", locationIds)
                .map((row, metadata) -> "第" + value(row, "episode_number", Integer.class, 0)
                        + "集第" + value(row, "scene_number", Integer.class, 0) + "场").all();
    }

    /**
     * 替换世界观基础设定、条目和地点。
     *
     * @param projectId 剧本项目标识
     * @param worldSetting 世界观基础设定
     * @param worldItems 世界观条目
     * @param locations 场景地点
     * @return 替换完成信号
     */
    public Mono<Void> replaceWorld(String projectId, ScriptDtos.WorldSetting worldSetting,
                                   List<ScriptDtos.WorldItem> worldItems, List<ScriptDtos.Location> locations) {
        return databaseClient.sql("""
                INSERT INTO script_world_settings(project_id,era,region,social_background,overall_tone)
                VALUES (:projectId,:era,:region,:socialBackground,:overallTone)
                ON CONFLICT (project_id) DO UPDATE SET era=EXCLUDED.era,region=EXCLUDED.region,
                    social_background=EXCLUDED.social_background,overall_tone=EXCLUDED.overall_tone
                """).bind("projectId", projectId).bind("era", text(worldSetting.era())).bind("region", text(worldSetting.region()))
                .bind("socialBackground", text(worldSetting.socialBackground())).bind("overallTone", text(worldSetting.overallTone()))
                .fetch().rowsUpdated()
                .then(databaseClient.sql("DELETE FROM script_world_items WHERE project_id=:projectId").bind("projectId", projectId).fetch().rowsUpdated())
                .thenMany(Flux.fromIterable(worldItems).concatMap(item -> insertWorldItem(projectId, item))).then()
                .thenMany(Flux.fromIterable(locations).concatMap(location -> insertLocation(projectId, location))).then()
                .then(deleteLocationsNotIn(projectId, locations.stream().map(ScriptDtos.Location::id).toList()));
    }

    /**
     * 查询分集摘要。
     *
     * @param projectId 剧本项目标识
     * @return 分集摘要数据流
     */
    public Flux<ScriptDtos.EpisodeSummary> listEpisodes(String projectId) {
        return databaseClient.sql("SELECT * FROM script_episodes WHERE project_id=:projectId ORDER BY sort_order,id")
                .bind("projectId", projectId).map((row, metadata) -> mapEpisode(row)).all();
    }

    /**
     * 查询单集摘要并限定所属项目。
     *
     * @param projectId 剧本项目标识
     * @param episodeId 分集稳定标识
     * @return 分集摘要
     */
    public Mono<ScriptDtos.EpisodeSummary> getEpisode(String projectId, String episodeId) {
        return databaseClient.sql("SELECT * FROM script_episodes WHERE id=:episodeId AND project_id=:projectId")
                .bind("episodeId", episodeId).bind("projectId", projectId).map((row, metadata) -> mapEpisode(row)).one();
    }

    /**
     * 查询单集场次，不包含正文块和人物。
     *
     * @param episodeId 分集稳定标识
     * @return 场次数据流
     */
    public Flux<ScriptDtos.Scene> listScenes(String episodeId) {
        return databaseClient.sql("SELECT * FROM script_scenes WHERE episode_id=:episodeId ORDER BY sort_order,id")
                .bind("episodeId", episodeId).map((row, metadata) -> new ScriptDtos.Scene(
                        row.get("id", String.class), row.get("location_id", String.class), value(row, "scene_number", Integer.class, 1),
                        row.get("title", String.class), row.get("interior_exterior", String.class), row.get("time_description", String.class),
                        row.get("scene_goal", String.class), row.get("action_summary", String.class), row.get("transition_description", String.class),
                        row.get("previous_relation", String.class), row.get("next_relation", String.class),
                        value(row, "sort_order", Integer.class, 0), List.of(), List.of())).all();
    }

    /**
     * 查询场次出场人物。
     *
     * @param sceneId 场次稳定标识
     * @return 人物标识数据流
     */
    public Flux<String> listSceneCharacterIds(String sceneId) {
        return databaseClient.sql("SELECT character_id FROM script_scene_characters WHERE scene_id=:sceneId ORDER BY sort_order")
                .bind("sceneId", sceneId).map((row, metadata) -> row.get("character_id", String.class)).all();
    }

    /**
     * 查询场次正文块。
     *
     * @param sceneId 场次稳定标识
     * @return 正文块数据流
     */
    public Flux<ScriptDtos.ScriptBlock> listBlocks(String sceneId) {
        return databaseClient.sql("SELECT * FROM script_blocks WHERE scene_id=:sceneId ORDER BY sort_order,id")
                .bind("sceneId", sceneId).map((row, metadata) -> new ScriptDtos.ScriptBlock(
                        row.get("id", String.class), row.get("block_type", String.class), row.get("character_id", String.class),
                        row.get("content", String.class), value(row, "origin", String.class, "original"),
                        value(row, "sort_order", Integer.class, 0))).all();
    }

    /**
     * 保存或新建单集，并按稳定标识更新场次和正文块。
     *
     * @param projectId 剧本项目标识
     * @param detail 单集完整内容
     * @return 保存完成信号
     */
    public Mono<Void> replaceEpisode(String projectId, ScriptDtos.EpisodeDetail detail) {
        ScriptDtos.EpisodeSummary episode = detail.episode();
        return saveEpisodeSummary(projectId, episode)
                .thenMany(Flux.fromIterable(detail.scenes()).concatMap(scene -> saveScene(episode.id(), scene))).then()
                .then(deleteScenesNotIn(episode.id(), detail.scenes().stream().map(ScriptDtos.Scene::id).toList()));
    }

    /**
     * 替换项目分集规划，并保留仍存在分集的场次正文。
     *
     * @param projectId 剧本项目标识
     * @param episodes 分集规划
     * @return 替换完成信号
     */
    public Mono<Void> replaceEpisodePlan(String projectId, List<ScriptDtos.EpisodeSummary> episodes) {
        return Flux.fromIterable(episodes).concatMap(episode -> saveEpisodeSummary(projectId, episode)).then()
                .then(deleteEpisodesNotIn(projectId, episodes.stream().map(ScriptDtos.EpisodeSummary::id).toList()));
    }

    /**
     * 保存分集摘要。
     *
     * @param projectId 剧本项目标识
     * @param episode 分集摘要
     * @return 数据库更新行数
     */
    private Mono<Long> saveEpisodeSummary(String projectId, ScriptDtos.EpisodeSummary episode) {
        return databaseClient.sql("""
                INSERT INTO script_episodes(id,project_id,episode_number,title,summary,key_events,main_conflict,climax,ending_hook,
                    target_duration_seconds,completion_status,sort_order)
                VALUES (:id,:projectId,:episodeNumber,:title,:summary,:keyEvents,:mainConflict,:climax,:endingHook,
                    :targetDurationSeconds,:completionStatus,:sortOrder)
                ON CONFLICT (id) DO UPDATE SET episode_number=EXCLUDED.episode_number,title=EXCLUDED.title,summary=EXCLUDED.summary,
                    key_events=EXCLUDED.key_events,main_conflict=EXCLUDED.main_conflict,climax=EXCLUDED.climax,ending_hook=EXCLUDED.ending_hook,
                    target_duration_seconds=EXCLUDED.target_duration_seconds,completion_status=EXCLUDED.completion_status,sort_order=EXCLUDED.sort_order
                WHERE script_episodes.project_id=EXCLUDED.project_id
                """).bind("id", episode.id()).bind("projectId", projectId).bind("episodeNumber", episode.episodeNumber())
                .bind("title", episode.title()).bind("summary", text(episode.summary())).bind("keyEvents", text(episode.keyEvents()))
                .bind("mainConflict", text(episode.mainConflict())).bind("climax", text(episode.climax())).bind("endingHook", text(episode.endingHook()))
                .bind("targetDurationSeconds", episode.targetDurationSeconds()).bind("completionStatus", episode.completionStatus())
                .bind("sortOrder", episode.sortOrder()).fetch().rowsUpdated();
    }

    /**
     * 调整全部分集顺序。
     *
     * @param projectId 剧本项目标识
     * @param episodeIds 按新顺序排列的分集标识
     * @return 调整完成信号
     */
    public Mono<Void> reorderEpisodes(String projectId, List<String> episodeIds) {
        return Flux.range(0, episodeIds.size()).concatMap(index -> databaseClient.sql("""
                UPDATE script_episodes SET sort_order=:sortOrder,episode_number=:episodeNumber
                WHERE id=:episodeId AND project_id=:projectId
                """).bind("sortOrder", index).bind("episodeNumber", index + 1).bind("episodeId", episodeIds.get(index))
                .bind("projectId", projectId).fetch().rowsUpdated()).then();
    }

    /**
     * 删除指定分集。
     *
     * @param projectId 剧本项目标识
     * @param episodeId 分集稳定标识
     * @return 数据库删除行数
     */
    public Mono<Long> deleteEpisode(String projectId, String episodeId) {
        return databaseClient.sql("DELETE FROM script_episodes WHERE id=:episodeId AND project_id=:projectId")
                .bind("episodeId", episodeId).bind("projectId", projectId).fetch().rowsUpdated();
    }

    /**
     * 删除项目全部正式内容，供版本恢复事务重新写入。
     *
     * @param projectId 剧本项目标识
     * @return 清理完成信号
     */
    public Mono<Void> clearProjectContent(String projectId) {
        return databaseClient.sql("DELETE FROM script_story_events WHERE project_id=:projectId").bind("projectId", projectId).fetch().rowsUpdated()
                .then(databaseClient.sql("DELETE FROM script_outline_sections WHERE project_id=:projectId").bind("projectId", projectId).fetch().rowsUpdated())
                .then(databaseClient.sql("DELETE FROM script_episodes WHERE project_id=:projectId").bind("projectId", projectId).fetch().rowsUpdated())
                .then(databaseClient.sql("DELETE FROM script_character_relations WHERE project_id=:projectId").bind("projectId", projectId).fetch().rowsUpdated())
                .then(databaseClient.sql("DELETE FROM script_characters WHERE project_id=:projectId").bind("projectId", projectId).fetch().rowsUpdated())
                .then(databaseClient.sql("DELETE FROM script_world_items WHERE project_id=:projectId").bind("projectId", projectId).fetch().rowsUpdated())
                .then(databaseClient.sql("DELETE FROM script_locations WHERE project_id=:projectId").bind("projectId", projectId).fetch().rowsUpdated())
                .then(databaseClient.sql("DELETE FROM script_world_settings WHERE project_id=:projectId").bind("projectId", projectId).fetch().rowsUpdated()).then();
    }

    /**
     * 创建不可变版本快照。
     *
     * @param id 版本稳定标识
     * @param projectId 剧本项目标识
     * @param userId 创建用户标识
     * @param name 版本名称
     * @param source 版本来源
     * @param summary 修改说明
     * @param revision 来源修订号
     * @param snapshot 完整项目快照
     * @return 创建完成信号
     */
    public Mono<Void> createVersion(String id, String projectId, Long userId, String name, String source,
                                    String summary, long revision, JSONObject snapshot) {
        return databaseClient.sql("""
                INSERT INTO script_versions(id,project_id,created_by_user_id,version_name,change_source,change_summary,source_revision,snapshot_data)
                VALUES (:id,:projectId,:userId,:name,:source,:summary,:revision,CAST(:snapshot AS jsonb))
                """).bind("id", id).bind("projectId", projectId).bind("userId", userId).bind("name", name)
                .bind("source", source).bind("summary", text(summary)).bind("revision", revision)
                .bind("snapshot", JSON.toJSONString(snapshot)).fetch().rowsUpdated().then();
    }

    /**
     * 查询项目版本摘要。
     *
     * @param projectId 剧本项目标识
     * @return 版本摘要数据流
     */
    public Flux<ScriptDtos.VersionSummary> listVersions(String projectId) {
        return databaseClient.sql("""
                SELECT id,version_name,change_source,change_summary,source_revision,created_at FROM script_versions
                WHERE project_id=:projectId ORDER BY created_at DESC,id
                """).bind("projectId", projectId).map((row, metadata) -> new ScriptDtos.VersionSummary(
                        row.get("id", String.class), row.get("version_name", String.class), row.get("change_source", String.class),
                        row.get("change_summary", String.class), value(row, "source_revision", Long.class, 0L),
                        row.get("created_at", OffsetDateTime.class))).all();
    }

    /**
     * 查询版本详情。
     *
     * @param projectId 剧本项目标识
     * @param versionId 版本稳定标识
     * @return 版本详情
     */
    public Mono<ScriptDtos.VersionDetail> getVersion(String projectId, String versionId) {
        return databaseClient.sql("SELECT id,version_name,change_source,change_summary,source_revision,snapshot_data::text AS snapshot_data,created_at FROM script_versions WHERE id=:versionId AND project_id=:projectId")
                .bind("versionId", versionId).bind("projectId", projectId).map((row, metadata) -> new ScriptDtos.VersionDetail(
                        row.get("id", String.class), row.get("version_name", String.class), row.get("change_source", String.class),
                        row.get("change_summary", String.class), value(row, "source_revision", Long.class, 0L),
                        JSON.parseObject(row.get("snapshot_data", String.class)), row.get("created_at", OffsetDateTime.class))).one();
    }

    /**
     * 创建待确认AI草稿。
     *
     * @param userId 当前用户标识
     * @param draft AI草稿
     * @return 创建完成信号
     */
    public Mono<Void> createAiDraft(Long userId, ScriptDtos.AiDraft draft) {
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("""
                INSERT INTO script_ai_drafts(id,project_id,user_id,action_type,target_type,target_id,base_revision,instruction,
                    source_data,draft_data,model,charged_credits,status)
                VALUES (:id,:projectId,:userId,:actionType,:targetType,:targetId,:baseRevision,:instruction,
                    CAST(:sourceData AS jsonb),CAST(:draftData AS jsonb),:model,:chargedCredits,'pending')
                """).bind("id", draft.id()).bind("projectId", draft.projectId()).bind("userId", userId)
                .bind("actionType", draft.actionType()).bind("targetType", draft.targetType());
        spec = R2dbcBindings.bindNullable(spec, "targetId", draft.targetId(), String.class);
        return spec.bind("baseRevision", draft.baseRevision()).bind("instruction", text(draft.instruction()))
                .bind("sourceData", JSON.toJSONString(draft.sourceData())).bind("draftData", JSON.toJSONString(draft.draftData()))
                .bind("model", draft.model()).bind("chargedCredits", draft.chargedCredits()).fetch().rowsUpdated().then();
    }

    /**
     * 查询项目AI草稿。
     *
     * @param projectId 剧本项目标识
     * @return AI草稿数据流
     */
    public Flux<ScriptDtos.AiDraft> listAiDrafts(String projectId) {
        return databaseClient.sql("SELECT id,project_id,action_type,target_type,target_id,base_revision,instruction,source_data::text AS source_data,draft_data::text AS draft_data,model,charged_credits,status,created_at FROM script_ai_drafts WHERE project_id=:projectId ORDER BY created_at DESC,id")
                .bind("projectId", projectId).map((row, metadata) -> mapAiDraft(row)).all();
    }

    /**
     * 查询待确认AI草稿。
     *
     * @param projectId 剧本项目标识
     * @param draftId 草稿稳定标识
     * @return 待确认草稿
     */
    public Mono<ScriptDtos.AiDraft> getPendingAiDraft(String projectId, String draftId) {
        return databaseClient.sql("SELECT id,project_id,action_type,target_type,target_id,base_revision,instruction,source_data::text AS source_data,draft_data::text AS draft_data,model,charged_credits,status,created_at FROM script_ai_drafts WHERE id=:draftId AND project_id=:projectId AND status='pending'")
                .bind("draftId", draftId).bind("projectId", projectId).map((row, metadata) -> mapAiDraft(row)).one();
    }

    /**
     * 更新AI草稿状态与用户编辑后的草稿数据。
     *
     * @param projectId 剧本项目标识
     * @param draftId 草稿稳定标识
     * @param status 新状态
     * @param draftData 用户确认后的草稿数据
     * @return 数据库更新行数
     */
    public Mono<Long> updateAiDraftStatus(String projectId, String draftId, String status, JSONObject draftData) {
        return databaseClient.sql("""
                UPDATE script_ai_drafts SET status=:status,draft_data=CAST(:draftData AS jsonb),
                    applied_at=CASE WHEN :status='applied' THEN CURRENT_TIMESTAMP ELSE applied_at END
                WHERE id=:draftId AND project_id=:projectId AND status='pending'
                """).bind("status", status).bind("draftData", JSON.toJSONString(draftData == null ? new JSONObject() : draftData))
                .bind("draftId", draftId).bind("projectId", projectId).fetch().rowsUpdated();
    }

    /**
     * 创建分析报告及问题明细。
     *
     * @param report 分析报告
     * @param userId 当前用户标识
     * @return 创建完成信号
     */
    public Mono<Void> createAnalysisReport(ScriptDtos.AnalysisReport report, Long userId) {
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("""
                INSERT INTO script_analysis_reports(id,project_id,user_id,scope_type,scope_id,summary,model,charged_credits,source_revision)
                VALUES (:id,:projectId,:userId,:scopeType,:scopeId,:summary,:model,:chargedCredits,:sourceRevision)
                """).bind("id", report.id()).bind("projectId", report.projectId()).bind("userId", userId)
                .bind("scopeType", report.scopeType());
        spec = R2dbcBindings.bindNullable(spec, "scopeId", report.scopeId(), String.class);
        return spec.bind("summary", text(report.summary())).bind("model", report.model()).bind("chargedCredits", report.chargedCredits())
                .bind("sourceRevision", report.sourceRevision()).fetch().rowsUpdated()
                .thenMany(Flux.fromIterable(report.issues()).concatMap(issue -> insertAnalysisIssue(report.id(), issue))).then();
    }

    /**
     * 查询分析报告摘要列表。
     *
     * @param projectId 剧本项目标识
     * @return 分析报告摘要数据流
     */
    public Flux<ScriptDtos.AnalysisReport> listAnalysisReports(String projectId) {
        return databaseClient.sql("SELECT * FROM script_analysis_reports WHERE project_id=:projectId ORDER BY created_at DESC,id")
                .bind("projectId", projectId).map((row, metadata) -> new ScriptDtos.AnalysisReport(
                        row.get("id", String.class), row.get("project_id", String.class), row.get("scope_type", String.class),
                        row.get("scope_id", String.class), row.get("summary", String.class), row.get("model", String.class),
                        value(row, "charged_credits", Integer.class, 0), value(row, "source_revision", Long.class, 0L),
                        row.get("created_at", OffsetDateTime.class), List.of())).all();
    }

    /**
     * 查询分析报告。
     *
     * @param projectId 剧本项目标识
     * @param reportId 分析报告标识
     * @return 分析报告
     */
    public Mono<ScriptDtos.AnalysisReport> getAnalysisReport(String projectId, String reportId) {
        return databaseClient.sql("SELECT * FROM script_analysis_reports WHERE id=:reportId AND project_id=:projectId")
                .bind("reportId", reportId).bind("projectId", projectId).map((row, metadata) -> new ScriptDtos.AnalysisReport(
                        row.get("id", String.class), row.get("project_id", String.class), row.get("scope_type", String.class),
                        row.get("scope_id", String.class), row.get("summary", String.class), row.get("model", String.class),
                        value(row, "charged_credits", Integer.class, 0), value(row, "source_revision", Long.class, 0L),
                        row.get("created_at", OffsetDateTime.class), List.of())).one();
    }

    /**
     * 查询分析报告问题。
     *
     * @param reportId 分析报告标识
     * @return 分析问题数据流
     */
    public Flux<ScriptDtos.AnalysisIssue> listAnalysisIssues(String reportId) {
        return databaseClient.sql("SELECT * FROM script_analysis_issues WHERE report_id=:reportId ORDER BY sort_order,id")
                .bind("reportId", reportId).map((row, metadata) -> new ScriptDtos.AnalysisIssue(
                        row.get("id", String.class), row.get("category", String.class), row.get("severity", String.class),
                        row.get("episode_id", String.class), row.get("scene_id", String.class), row.get("block_id", String.class),
                        row.get("title", String.class), row.get("reason", String.class), row.get("suggestion", String.class),
                        value(row, "sort_order", Integer.class, 0))).all();
    }

    /**
     * 插入故事事件。
     *
     * @param projectId 剧本项目标识
     * @param event 故事事件
     * @return 数据库更新行数
     */
    private Mono<Long> insertStoryEvent(String projectId, ScriptDtos.StoryEvent event) {
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("""
                INSERT INTO script_story_events(id,project_id,outline_section_id,episode_id,scene_id,event_type,title,description,sort_order)
                VALUES (:id,:projectId,:outlineSectionId,:episodeId,:sceneId,:eventType,:title,:description,:sortOrder)
                """).bind("id", event.id()).bind("projectId", projectId);
        spec = R2dbcBindings.bindNullable(spec, "outlineSectionId", blankToNull(event.outlineSectionId()), String.class);
        spec = R2dbcBindings.bindNullable(spec, "episodeId", blankToNull(event.episodeId()), String.class);
        spec = R2dbcBindings.bindNullable(spec, "sceneId", blankToNull(event.sceneId()), String.class);
        return spec.bind("eventType", event.eventType()).bind("title", event.title()).bind("description", text(event.description()))
                .bind("sortOrder", event.sortOrder()).fetch().rowsUpdated();
    }

    /**
     * 按稳定标识插入或更新人物。
     *
     * @param projectId 剧本项目标识
     * @param character 人物设定
     * @return 数据库更新行数
     */
    private Mono<Long> insertCharacter(String projectId, ScriptDtos.Character character) {
        return databaseClient.sql("""
                INSERT INTO script_characters(id,project_id,name,identity,age,occupation,role_type,personality,values_description,
                    goal,desire,fear,motivation,appearance_description,habits,speech_style,background_story,character_arc,
                    sort_order)
                VALUES (:id,:projectId,:name,:identity,:age,:occupation,:roleType,:personality,:valuesDescription,
                    :goal,:desire,:fear,:motivation,:appearanceDescription,:habits,:speechStyle,:backgroundStory,:characterArc,
                    :sortOrder)
                ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,identity=EXCLUDED.identity,age=EXCLUDED.age,
                    occupation=EXCLUDED.occupation,role_type=EXCLUDED.role_type,personality=EXCLUDED.personality,
                    values_description=EXCLUDED.values_description,goal=EXCLUDED.goal,desire=EXCLUDED.desire,fear=EXCLUDED.fear,
                    motivation=EXCLUDED.motivation,appearance_description=EXCLUDED.appearance_description,habits=EXCLUDED.habits,
                    speech_style=EXCLUDED.speech_style,background_story=EXCLUDED.background_story,character_arc=EXCLUDED.character_arc,
                    sort_order=EXCLUDED.sort_order
                WHERE script_characters.project_id=EXCLUDED.project_id
                """).bind("id", character.id()).bind("projectId", projectId).bind("name", character.name())
                .bind("identity", text(character.identity())).bind("age", text(character.age())).bind("occupation", text(character.occupation()))
                .bind("roleType", text(character.roleType())).bind("personality", text(character.personality()))
                .bind("valuesDescription", text(character.valuesDescription())).bind("goal", text(character.goal()))
                .bind("desire", text(character.desire())).bind("fear", text(character.fear())).bind("motivation", text(character.motivation()))
                .bind("appearanceDescription", text(character.appearanceDescription())).bind("habits", text(character.habits()))
                .bind("speechStyle", text(character.speechStyle())).bind("backgroundStory", text(character.backgroundStory()))
                .bind("characterArc", text(character.characterArc())).bind("sortOrder", character.sortOrder()).fetch().rowsUpdated();
    }

    /**
     * 插入人物关系。
     *
     * @param projectId 剧本项目标识
     * @param relation 人物关系
     * @return 数据库更新行数
     */
    private Mono<Long> insertCharacterRelation(String projectId, ScriptDtos.CharacterRelation relation) {
        return databaseClient.sql("""
                INSERT INTO script_character_relations(id,project_id,source_character_id,target_character_id,relationship_type,
                    relationship_direction,story_stage,conflict_description,description,sort_order)
                VALUES (:id,:projectId,:sourceCharacterId,:targetCharacterId,:relationshipType,:relationshipDirection,
                    :storyStage,:conflictDescription,:description,:sortOrder)
                """).bind("id", relation.id()).bind("projectId", projectId).bind("sourceCharacterId", relation.sourceCharacterId())
                .bind("targetCharacterId", relation.targetCharacterId()).bind("relationshipType", relation.relationshipType())
                .bind("relationshipDirection", relation.relationshipDirection()).bind("storyStage", text(relation.storyStage()))
                .bind("conflictDescription", text(relation.conflictDescription())).bind("description", text(relation.description()))
                .bind("sortOrder", relation.sortOrder()).fetch().rowsUpdated();
    }

    /**
     * 插入世界观条目。
     *
     * @param projectId 剧本项目标识
     * @param item 世界观条目
     * @return 数据库更新行数
     */
    private Mono<Long> insertWorldItem(String projectId, ScriptDtos.WorldItem item) {
        return databaseClient.sql("""
                INSERT INTO script_world_items(id,project_id,item_type,name,description,sort_order)
                VALUES (:id,:projectId,:itemType,:name,:description,:sortOrder)
                """).bind("id", item.id()).bind("projectId", projectId).bind("itemType", item.itemType())
                .bind("name", item.name()).bind("description", text(item.description())).bind("sortOrder", item.sortOrder())
                .fetch().rowsUpdated();
    }

    /**
     * 按稳定标识插入或更新地点。
     *
     * @param projectId 剧本项目标识
     * @param location 场景地点
     * @return 数据库更新行数
     */
    private Mono<Long> insertLocation(String projectId, ScriptDtos.Location location) {
        return databaseClient.sql("""
                INSERT INTO script_locations(id,project_id,name,space_purpose,narrative_role,default_time,weather,atmosphere,key_objects,main_events,sort_order)
                VALUES (:id,:projectId,:name,:spacePurpose,:narrativeRole,:defaultTime,:weather,:atmosphere,:keyObjects,:mainEvents,:sortOrder)
                ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,space_purpose=EXCLUDED.space_purpose,
                    narrative_role=EXCLUDED.narrative_role,default_time=EXCLUDED.default_time,weather=EXCLUDED.weather,
                    atmosphere=EXCLUDED.atmosphere,key_objects=EXCLUDED.key_objects,main_events=EXCLUDED.main_events,
                    sort_order=EXCLUDED.sort_order WHERE script_locations.project_id=EXCLUDED.project_id
                """).bind("id", location.id()).bind("projectId", projectId).bind("name", location.name())
                .bind("spacePurpose", text(location.spacePurpose())).bind("narrativeRole", text(location.narrativeRole()))
                .bind("defaultTime", text(location.defaultTime())).bind("weather", text(location.weather()))
                .bind("atmosphere", text(location.atmosphere())).bind("keyObjects", text(location.keyObjects()))
                .bind("mainEvents", text(location.mainEvents())).bind("sortOrder", location.sortOrder()).fetch().rowsUpdated();
    }

    /**
     * 按稳定标识保存场次及其人物、正文块。
     *
     * @param episodeId 分集稳定标识
     * @param scene 场次完整内容
     * @return 保存完成信号
     */
    private Mono<Void> saveScene(String episodeId, ScriptDtos.Scene scene) {
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("""
                INSERT INTO script_scenes(id,episode_id,location_id,scene_number,title,interior_exterior,time_description,
                    scene_goal,action_summary,transition_description,previous_relation,next_relation,sort_order)
                VALUES (:id,:episodeId,:locationId,:sceneNumber,:title,:interiorExterior,:timeDescription,
                    :sceneGoal,:actionSummary,:transitionDescription,:previousRelation,:nextRelation,:sortOrder)
                ON CONFLICT (id) DO UPDATE SET location_id=EXCLUDED.location_id,scene_number=EXCLUDED.scene_number,
                    title=EXCLUDED.title,interior_exterior=EXCLUDED.interior_exterior,time_description=EXCLUDED.time_description,
                    scene_goal=EXCLUDED.scene_goal,action_summary=EXCLUDED.action_summary,
                    transition_description=EXCLUDED.transition_description,previous_relation=EXCLUDED.previous_relation,
                    next_relation=EXCLUDED.next_relation,sort_order=EXCLUDED.sort_order
                WHERE script_scenes.episode_id=EXCLUDED.episode_id
                """).bind("id", scene.id()).bind("episodeId", episodeId);
        spec = R2dbcBindings.bindNullable(spec, "locationId", blankToNull(scene.locationId()), String.class);
        return spec.bind("sceneNumber", scene.sceneNumber()).bind("title", text(scene.title()))
                .bind("interiorExterior", scene.interiorExterior()).bind("timeDescription", text(scene.timeDescription()))
                .bind("sceneGoal", text(scene.sceneGoal())).bind("actionSummary", text(scene.actionSummary()))
                .bind("transitionDescription", text(scene.transitionDescription())).bind("previousRelation", text(scene.previousRelation()))
                .bind("nextRelation", text(scene.nextRelation())).bind("sortOrder", scene.sortOrder()).fetch().rowsUpdated()
                .then(databaseClient.sql("DELETE FROM script_scene_characters WHERE scene_id=:sceneId")
                        .bind("sceneId", scene.id()).fetch().rowsUpdated())
                .thenMany(Flux.range(0, scene.characterIds().size()).concatMap(index -> databaseClient.sql("""
                        INSERT INTO script_scene_characters(scene_id,character_id,sort_order) VALUES (:sceneId,:characterId,:sortOrder)
                        """).bind("sceneId", scene.id()).bind("characterId", scene.characterIds().get(index))
                        .bind("sortOrder", index).fetch().rowsUpdated())).then()
                .thenMany(Flux.fromIterable(scene.blocks()).concatMap(block -> saveBlock(scene.id(), block))).then()
                .then(deleteBlocksNotIn(scene.id(), scene.blocks().stream().map(ScriptDtos.ScriptBlock::id).toList()));
    }

    /**
     * 按稳定标识保存正文块。
     *
     * @param sceneId 场次稳定标识
     * @param block 正文块
     * @return 数据库更新行数
     */
    private Mono<Long> saveBlock(String sceneId, ScriptDtos.ScriptBlock block) {
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("""
                INSERT INTO script_blocks(id,scene_id,block_type,character_id,content,origin,sort_order)
                VALUES (:id,:sceneId,:blockType,:characterId,:content,:origin,:sortOrder)
                ON CONFLICT (id) DO UPDATE SET block_type=EXCLUDED.block_type,character_id=EXCLUDED.character_id,
                    content=EXCLUDED.content,origin=EXCLUDED.origin,sort_order=EXCLUDED.sort_order
                WHERE script_blocks.scene_id=EXCLUDED.scene_id
                """).bind("id", block.id()).bind("sceneId", sceneId).bind("blockType", block.blockType());
        spec = R2dbcBindings.bindNullable(spec, "characterId", blankToNull(block.characterId()), String.class);
        return spec.bind("content", text(block.content()))
                .bind("origin", "adapted".equals(block.origin()) ? "adapted" : "original")
                .bind("sortOrder", block.sortOrder()).fetch().rowsUpdated();
    }

    /**
     * 删除本次保存未包含的场次。
     *
     * @param episodeId 分集稳定标识
     * @param sceneIds 本次保留的场次标识
     * @return 删除完成信号
     */
    private Mono<Void> deleteScenesNotIn(String episodeId, List<String> sceneIds) {
        if (sceneIds.isEmpty()) {
            return databaseClient.sql("DELETE FROM script_scenes WHERE episode_id=:episodeId")
                    .bind("episodeId", episodeId).fetch().rowsUpdated().then();
        }
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("""
                DELETE FROM script_scenes WHERE episode_id=:episodeId AND id NOT IN (
                """ + R2dbcBindings.namedPlaceholders("sceneId", sceneIds.size()) + ")").bind("episodeId", episodeId);
        return R2dbcBindings.bindList(spec, "sceneId", sceneIds).fetch().rowsUpdated().then();
    }

    /**
     * 删除本次分集规划未包含的分集。
     *
     * @param projectId 剧本项目标识
     * @param episodeIds 本次保留的分集标识
     * @return 删除完成信号
     */
    private Mono<Void> deleteEpisodesNotIn(String projectId, List<String> episodeIds) {
        if (episodeIds.isEmpty()) {
            return databaseClient.sql("DELETE FROM script_episodes WHERE project_id=:projectId")
                    .bind("projectId", projectId).fetch().rowsUpdated().then();
        }
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("""
                DELETE FROM script_episodes WHERE project_id=:projectId AND id NOT IN (
                """ + R2dbcBindings.namedPlaceholders("episodeId", episodeIds.size()) + ")").bind("projectId", projectId);
        return R2dbcBindings.bindList(spec, "episodeId", episodeIds).fetch().rowsUpdated().then();
    }

    /**
     * 删除本次保存未包含的正文块。
     *
     * @param sceneId 场次稳定标识
     * @param blockIds 本次保留的正文块标识
     * @return 删除完成信号
     */
    private Mono<Void> deleteBlocksNotIn(String sceneId, List<String> blockIds) {
        if (blockIds.isEmpty()) {
            return databaseClient.sql("DELETE FROM script_blocks WHERE scene_id=:sceneId")
                    .bind("sceneId", sceneId).fetch().rowsUpdated().then();
        }
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("""
                DELETE FROM script_blocks WHERE scene_id=:sceneId AND id NOT IN (
                """ + R2dbcBindings.namedPlaceholders("blockId", blockIds.size()) + ")").bind("sceneId", sceneId);
        return R2dbcBindings.bindList(spec, "blockId", blockIds).fetch().rowsUpdated().then();
    }

    /**
     * 插入分析问题。
     *
     * @param reportId 分析报告标识
     * @param issue 分析问题
     * @return 数据库更新行数
     */
    private Mono<Long> insertAnalysisIssue(String reportId, ScriptDtos.AnalysisIssue issue) {
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("""
                INSERT INTO script_analysis_issues(id,report_id,category,severity,episode_id,scene_id,block_id,title,reason,suggestion,sort_order)
                VALUES (:id,:reportId,:category,:severity,:episodeId,:sceneId,:blockId,:title,:reason,:suggestion,:sortOrder)
                """).bind("id", issue.id()).bind("reportId", reportId).bind("category", issue.category()).bind("severity", issue.severity());
        spec = R2dbcBindings.bindNullable(spec, "episodeId", blankToNull(issue.episodeId()), String.class);
        spec = R2dbcBindings.bindNullable(spec, "sceneId", blankToNull(issue.sceneId()), String.class);
        spec = R2dbcBindings.bindNullable(spec, "blockId", blankToNull(issue.blockId()), String.class);
        return spec.bind("title", issue.title()).bind("reason", issue.reason()).bind("suggestion", issue.suggestion())
                .bind("sortOrder", issue.sortOrder()).fetch().rowsUpdated();
    }

    /**
     * 删除本次保存未包含且已确认无正文引用的人物。
     *
     * @param projectId 剧本项目标识
     * @param characterIds 本次保留的人物标识
     * @return 删除完成信号
     */
    private Mono<Void> deleteCharactersNotIn(String projectId, List<String> characterIds) {
        if (characterIds.isEmpty()) {
            return databaseClient.sql("DELETE FROM script_characters WHERE project_id=:projectId")
                    .bind("projectId", projectId).fetch().rowsUpdated().then();
        }
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("""
                DELETE FROM script_characters WHERE project_id=:projectId AND id NOT IN (
                """ + R2dbcBindings.namedPlaceholders("characterId", characterIds.size()) + ")").bind("projectId", projectId);
        return R2dbcBindings.bindList(spec, "characterId", characterIds).fetch().rowsUpdated().then();
    }

    /**
     * 删除本次保存未包含且已确认无场次引用的地点。
     *
     * @param projectId 剧本项目标识
     * @param locationIds 本次保留的地点标识
     * @return 删除完成信号
     */
    private Mono<Void> deleteLocationsNotIn(String projectId, List<String> locationIds) {
        if (locationIds.isEmpty()) {
            return databaseClient.sql("DELETE FROM script_locations WHERE project_id=:projectId")
                    .bind("projectId", projectId).fetch().rowsUpdated().then();
        }
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("""
                DELETE FROM script_locations WHERE project_id=:projectId AND id NOT IN (
                """ + R2dbcBindings.namedPlaceholders("locationId", locationIds.size()) + ")").bind("projectId", projectId);
        return R2dbcBindings.bindList(spec, "locationId", locationIds).fetch().rowsUpdated().then();
    }

    /**
     * 映射剧本项目记录。
     *
     * @param row 数据库行
     * @return 项目数据库记录
     */
    private ProjectRecord mapProject(Row row) {
        ScriptDtos.ProjectOverview overview = new ScriptDtos.ProjectOverview(
                row.get("title", String.class), row.get("content_type", String.class), row.get("genre", String.class),
                row.get("logline", String.class), row.get("synopsis", String.class),
                value(row, "target_duration_seconds", Integer.class, 0),
                value(row, "target_episode_count", Integer.class, 1), row.get("narrative_style", String.class),
                row.get("theme", String.class), row.get("main_plot", String.class), row.get("main_conflict", String.class),
                row.get("ending_direction", String.class));
        return new ProjectRecord(row.get("id", String.class), row.get("user_id", Long.class), overview,
                row.get("stage", String.class), value(row, "completion_rate", Integer.class, 0),
                value(row, "revision", Long.class, 0L), row.get("production_started_at", OffsetDateTime.class),
                row.get("created_at", OffsetDateTime.class), row.get("updated_at", OffsetDateTime.class));
    }

    /**
     * 映射分集摘要。
     *
     * @param row 数据库行
     * @return 分集摘要
     */
    private ScriptDtos.EpisodeSummary mapEpisode(Row row) {
        return new ScriptDtos.EpisodeSummary(row.get("id", String.class), value(row, "episode_number", Integer.class, 1),
                row.get("title", String.class), row.get("summary", String.class), row.get("key_events", String.class),
                row.get("main_conflict", String.class), row.get("climax", String.class), row.get("ending_hook", String.class),
                value(row, "target_duration_seconds", Integer.class, 0), row.get("completion_status", String.class),
                value(row, "sort_order", Integer.class, 0));
    }

    /**
     * 映射AI草稿。
     *
     * @param row 数据库行
     * @return AI草稿
     */
    private ScriptDtos.AiDraft mapAiDraft(Row row) {
        return new ScriptDtos.AiDraft(row.get("id", String.class), row.get("project_id", String.class),
                row.get("action_type", String.class), row.get("target_type", String.class), row.get("target_id", String.class),
                value(row, "base_revision", Long.class, 0L), row.get("instruction", String.class),
                JSON.parseObject(row.get("source_data", String.class)), JSON.parseObject(row.get("draft_data", String.class)),
                row.get("model", String.class), value(row, "charged_credits", Integer.class, 0),
                row.get("status", String.class), row.get("created_at", OffsetDateTime.class));
    }

    /**
     * 构建项目筛选SQL片段。
     *
     * @return 项目筛选SQL片段
     */
    private String projectFilter() {
        return " AND (:keyword = '' OR p.title ILIKE '%' || :keyword || '%' OR p.logline ILIKE '%' || :keyword || '%')" +
                " AND (:stage = '' OR p.stage = :stage) AND (:contentType = '' OR p.content_type = :contentType) ";
    }

    /**
     * 绑定项目筛选参数。
     *
     * @param spec 数据库执行规格
     * @param keyword 搜索关键字
     * @param stage 阶段筛选
     * @param contentType 内容形式筛选
     * @return 已绑定参数的执行规格
     */
    private DatabaseClient.GenericExecuteSpec bindProjectFilter(DatabaseClient.GenericExecuteSpec spec, String keyword,
                                                                String stage, String contentType) {
        return spec.bind("keyword", text(keyword)).bind("stage", text(stage)).bind("contentType", text(contentType));
    }

    /**
     * 读取允许为空的行值。
     *
     * @param row 数据库行
     * @param column 列名
     * @param type 目标类型
     * @param defaultValue 空值时的默认值
     * @param <T> 返回类型
     * @return 数据库值或默认值
     */
    private <T> T value(Row row, String column, Class<T> type, T defaultValue) {
        T result = row.get(column, type);
        return result == null ? defaultValue : result;
    }

    /**
     * 将空文本规范为空字符串。
     *
     * @param value 原文本
     * @return 非空裁剪文本
     */
    private String text(String value) {
        return value == null ? "" : value.trim();
    }

    /**
     * 将空白文本规范为空值。
     *
     * @param value 原文本
     * @return 规范文本或空值
     */
    private String blankToNull(String value) {
        String result = text(value);
        return result.isEmpty() ? null : result;
    }
}

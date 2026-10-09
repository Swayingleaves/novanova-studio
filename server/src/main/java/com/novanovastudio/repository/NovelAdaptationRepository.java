package com.novanovastudio.repository;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.dto.NovelAdaptationDtos;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.r2dbc.core.DatabaseClient;
import org.springframework.stereotype.Repository;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * 小说改编草稿与正式产物来源关联的数据库访问。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-09-28 18:00
 */
@Repository
@RequiredArgsConstructor
public class NovelAdaptationRepository {
    /** 响应式数据库客户端。 */
    private final DatabaseClient databaseClient;

    /**
     * 保存改编草稿使用的设定和事实快照。
     *
     * @param draftId 剧本草稿标识
     * @param projectId 共享项目标识
     * @param stage 改编阶段
     * @param settings 用户选择的改编设置
     * @param facts 已确认事实快照
     * @return 写入完成信号
     */
    public Mono<Void> saveDraft(String draftId, String projectId, String stage, NovelAdaptationDtos.Settings settings,
                                List<NovelAdaptationDtos.Fact> facts) {
        return databaseClient.sql("INSERT INTO novel_adaptation_drafts(draft_id,project_id,stage,settings,fact_snapshot) VALUES (:draftId,:projectId,:stage,CAST(:settings AS jsonb),CAST(:facts AS jsonb))")
                .bind("draftId", draftId).bind("projectId", projectId).bind("stage", stage)
                .bind("settings", JSON.toJSONString(settings)).bind("facts", JSON.toJSONString(facts))
                .fetch().rowsUpdated().then();
    }

    /**
     * 校验生成期间所选事实仍为已确认的同一修订。
     *
     * @param projectId 共享项目标识
     * @param facts 生成前的事实快照
     * @return 全部未变化时完成
     */
    public Mono<Void> requireCurrentFacts(String projectId, List<NovelAdaptationDtos.Fact> facts) {
        return databaseClient.sql("SELECT COUNT(*) AS stale_count FROM jsonb_to_recordset(CAST(:facts AS jsonb)) AS f(id text, revision bigint) LEFT JOIN story_bible_items i ON i.id=f.id AND i.project_id=:projectId WHERE i.id IS NULL OR i.status<>'confirmed' OR i.revision<>f.revision")
                .bind("facts", JSON.toJSONString(facts)).bind("projectId", projectId)
                .map((row, metadata) -> row.get("stale_count", Long.class)).one()
                .flatMap(stale -> stale > 0 ? Mono.error(new BusinessException(ErrorCode.DATA_CONFLICT,
                        "故事事实已发生变化，请重新生成改编草稿")) : Mono.empty());
    }

    /**
     * 禁止改编草稿应用覆盖已有正式阶段内容；只允许向空白阶段写入。
     *
     * @param projectId 共享项目标识
     * @param stage 改编阶段
     * @param targetId 单集目标标识，可为空
     * @return 阶段为空时完成
     */
    public Mono<Void> requireEmptyTarget(String projectId, String stage, String targetId) {
        String query = switch (stage) {
            case "outline" -> "SELECT (EXISTS(SELECT 1 FROM script_outline_sections WHERE project_id=:projectId) OR EXISTS(SELECT 1 FROM script_story_events WHERE project_id=:projectId)) AS occupied";
            case "episodes" -> "SELECT EXISTS(SELECT 1 FROM script_episodes WHERE project_id=:projectId) AS occupied";
            case "episode" -> "SELECT EXISTS(SELECT 1 FROM script_scenes WHERE episode_id=:targetId) AS occupied";
            default -> throw new BusinessException(ErrorCode.PARAM_INVALID, "不支持的改编阶段");
        };
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql(query).bind("projectId", projectId);
        if ("episode".equals(stage)) spec = spec.bind("targetId", targetId);
        return spec.map((row, metadata) -> row.get("occupied", Boolean.class)).one()
                .flatMap(occupied -> Boolean.TRUE.equals(occupied)
                        ? Mono.error(new BusinessException(ErrorCode.DATA_CONFLICT,
                        "当前阶段已有正式内容，改编草稿不能覆盖人工内容")) : Mono.empty());
    }

    /**
     * 查询项目改编草稿及其事实快照，供用户审阅来源。
     *
     * @param projectId 共享项目标识
     * @return 改编草稿来源列表
     */
    /**
     * 列出一键改编任务产出的草稿。
     *
     * @param jobId String 任务标识
     * @return Flux<JobDraft> 草稿摘要
     */
    public Flux<NovelAdaptationDtos.JobDraft> listJobDrafts(String jobId) {
        return databaseClient.sql("SELECT d.draft_id,d.stage,a.status FROM novel_adaptation_drafts d "
                        + "JOIN script_ai_drafts a ON a.id=d.draft_id WHERE d.job_id=:jobId ORDER BY d.created_at")
                .bind("jobId", jobId)
                .map((row, metadata) -> new NovelAdaptationDtos.JobDraft(row.get("draft_id", String.class),
                        row.get("stage", String.class), row.get("status", String.class)))
                .all();
    }

    /** 保存成功的生成批次，事实快照与目标标识共同确定完成记录。 */
    public record DraftCheckpoint(String stage, String targetId, String status, long baseRevision,
                                  JSONObject sourceData, List<NovelAdaptationDtos.Fact> facts) { }

    /**
     * 查询任务所有成功保存的草稿批次，恢复时精确跳过阶段、分集与事实范围相同的调用。
     * @param jobId String 任务标识
     * @return Flux&lt;DraftCheckpoint&gt; 已保存的批次信息
     */
    public Flux<DraftCheckpoint> listCheckpoints(String jobId) {
        return databaseClient.sql("SELECT d.stage,a.target_id,a.status,a.base_revision,a.source_data::text AS source_data,"
                        + "d.fact_snapshot::text AS facts FROM novel_adaptation_drafts d JOIN script_ai_drafts a ON a.id=d.draft_id "
                        + "WHERE d.job_id=:jobId ORDER BY d.created_at,a.id")
                .bind("jobId", jobId).map((row, metadata) -> new DraftCheckpoint(row.get("stage", String.class),
                        row.get("target_id", String.class), row.get("status", String.class), row.get("base_revision", Long.class),
                        JSON.parseObject(row.get("source_data", String.class)),
                        JSON.parseArray(row.get("facts", String.class), NovelAdaptationDtos.Fact.class))).all();
    }

    /**
     * 把草稿归入一键改编任务，任务按草稿归属查询停点内容。
     *
     * @param draftId String 草稿标识
     * @param jobId String 任务标识
     * @return Mono<Void> 更新结果
     */
    public Mono<Void> attachJob(String draftId, String jobId) {
        return databaseClient.sql("UPDATE novel_adaptation_drafts SET job_id=:jobId WHERE draft_id=:draftId")
                .bind("jobId", jobId).bind("draftId", draftId).fetch().rowsUpdated().then();
    }

    /**
     * 删除项目内待审的改编草稿。一键改编每次启动都整体重建，
     * 清掉上次失败或中断留下的草稿，避免旧修订的草稿混入停点确认。
     *
     * @param projectId String 项目标识
     * @return Mono&lt;Long&gt; 删除的草稿数量
     */
    public Mono<Long> deletePendingAdaptationDrafts(String projectId) {
        return databaseClient.sql("DELETE FROM script_ai_drafts WHERE status='pending' AND id IN "
                        + "(SELECT draft_id FROM novel_adaptation_drafts WHERE project_id=:projectId)")
                .bind("projectId", projectId).fetch().rowsUpdated();
    }

    public Flux<NovelAdaptationDtos.DraftSource> listDraftSources(String projectId) {
        return databaseClient.sql("SELECT d.draft_id,d.stage,d.settings::text AS settings,d.fact_snapshot::text AS facts,a.status FROM novel_adaptation_drafts d JOIN script_ai_drafts a ON a.id=d.draft_id WHERE d.project_id=:projectId AND a.status='pending' ORDER BY d.created_at DESC")
                .bind("projectId", projectId).map((row, metadata) -> new NovelAdaptationDtos.DraftSource(
                        row.get("draft_id", String.class), row.get("stage", String.class),
                        JSON.parseObject(row.get("settings", String.class), NovelAdaptationDtos.Settings.class),
                        JSON.parseArray(row.get("facts", String.class), NovelAdaptationDtos.Fact.class),
                        row.get("status", String.class))).all();
    }

    /**
     * 在剧本草稿应用事务中保存正式内容的事实关联；普通剧本草稿没有改编记录时不写入。
     *
     * @param draftId 剧本草稿标识
     * @param projectId 共享项目标识
     * @param targetType 正式目标类型
     * @param targetId 正式目标标识
     * @param draftData 用户确认后的草稿数据
     * @param changedTargetIds 本次实际更新的正式目标标识
     * @return 写入完成信号
     */
    public Mono<Void> recordApplied(String draftId, String projectId, String targetType, String targetId, JSONObject draftData,
                                    List<String> changedTargetIds) {
        return databaseClient.sql("SELECT fact_snapshot::text AS facts FROM novel_adaptation_drafts WHERE draft_id=:draftId AND project_id=:projectId")
                .bind("draftId", draftId).bind("projectId", projectId)
                .map((row, metadata) -> row.get("facts", String.class)).one()
                .flatMap(factJson -> {
                    List<NovelAdaptationDtos.Fact> facts = JSON.parseArray(factJson, NovelAdaptationDtos.Fact.class);
                    List<Target> targets = new ArrayList<>();
                    String mappedType = switch (targetType) {
                        case "episodes" -> "episode";
                        case "outline" -> "outline";
                        case "characters" -> "character";
                        case "world" -> "location";
                        case "overview" -> "overview";
                        default -> "scene";
                    };
                    changedTargetIds.forEach(id -> targets.add(new Target("episode".equals(targetType) && targetId.equals(id)
                            ? "episode" : mappedType, id)));
                    if (targets.isEmpty()) {
                        return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "改编草稿没有可追溯的正式目标"));
                    }
                    return requireCurrentFacts(projectId, facts)
                            .thenMany(Flux.fromIterable(targets).distinct(Target::typeAndId)
                                    .concatMap(target -> databaseClient.sql("UPDATE novel_adaptation_sources SET active=FALSE WHERE project_id=:projectId AND active=TRUE AND target_type=:targetType AND target_id=:targetId")
                                            .bind("projectId", projectId).bind("targetType", target.type()).bind("targetId", target.id())
                                            .fetch().rowsUpdated()))
                            .thenMany(Flux.fromIterable(targets).concatMap(target -> Flux.fromIterable(facts)
                            .concatMap(fact -> databaseClient.sql("INSERT INTO novel_adaptation_sources(id,project_id,draft_id,target_type,target_id,fact_id,fact_revision,origin) VALUES (:id,:projectId,:draftId,:targetType,:targetId,:factId,:revision,'adaptation') ON CONFLICT (draft_id,target_type,target_id,fact_id) DO NOTHING")
                                    .bind("id", UUID.randomUUID().toString()).bind("projectId", projectId)
                                    .bind("draftId", draftId).bind("targetType", target.type()).bind("targetId", target.id())
                                    .bind("factId", fact.id()).bind("revision", fact.revision())
                                    .fetch().rowsUpdated()))).then();
                }).then();
    }

    /**
     * 仅对小说改编草稿校验正式阶段仍为空，普通剧本草稿继续使用原有规则。
     *
     * @param draftId 剧本草稿标识
     * @param projectId 共享项目标识
     * @param targetType 草稿目标类型
     * @param targetId 单集目标标识
     * @return 目标仍可安全写入时完成
     */
    public Mono<Void> requireTargetSelectionForDraft(String draftId, String projectId, String targetType, String targetId,
                                                     List<String> selectedTargetIds) {
        return databaseClient.sql("SELECT stage FROM novel_adaptation_drafts WHERE draft_id=:draftId AND project_id=:projectId")
                .bind("draftId", draftId).bind("projectId", projectId)
                .map((row, metadata) -> row.get("stage", String.class)).one()
                .flatMap(stage -> {
                    String expectedTargetType = switch (stage) {
                        case "overview" -> "overview";
                        case "characters" -> "characters";
                        case "world" -> "world";
                        case "outline" -> "outline";
                        case "episodes" -> "episodes";
                        default -> "episode";
                    };
                    if (!expectedTargetType.equals(targetType)) {
                        return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "改编草稿目标与阶段不一致"));
                    }
                    return Mono.empty();
                }).then();
    }

    /**
     * 查询已应用产物的来源及事实修订差异。
     *
     * @param projectId 共享项目标识
     * @return 来源与待更新状态
     */
    public Flux<NovelAdaptationDtos.SourceImpact> listSourceImpacts(String projectId) {
        return databaseClient.sql("""
                WITH source_targets AS (
                    SELECT s.target_type,s.target_id,s.fact_id,s.fact_revision FROM novel_adaptation_sources s
                    WHERE s.project_id=:projectId AND s.active=TRUE
                    UNION
                    SELECT 'shot',sh.id,s.fact_id,s.fact_revision FROM novel_adaptation_sources s
                    JOIN comic_drama_shots sh ON sh.script_project_id=s.project_id
                        AND ((s.target_type='scene' AND sh.source_scene_id=s.target_id)
                            OR (s.target_type='episode' AND sh.source_episode_id=s.target_id))
                    WHERE s.project_id=:projectId AND s.active=TRUE
                    UNION
                    SELECT 'asset',l.asset_id,l.fact_id,l.fact_revision FROM novel_adaptation_asset_links l
                    WHERE l.project_id=:projectId
                )
                SELECT s.target_type,s.target_id,s.fact_id,s.fact_revision,i.name AS fact_name,
                    i.revision AS current_revision,i.status AS fact_status
                FROM source_targets s LEFT JOIN story_bible_items i ON i.id=s.fact_id AND i.project_id=:projectId
                ORDER BY s.target_type,s.target_id,s.fact_id
                """)
                .bind("projectId", projectId).map((row, metadata) -> {
                    Long current = row.get("current_revision", Long.class);
                    String status = row.get("fact_status", String.class);
                    long recorded = row.get("fact_revision", Long.class);
                    return new NovelAdaptationDtos.SourceImpact(row.get("target_type", String.class),
                            row.get("target_id", String.class), row.get("fact_id", String.class),
                            row.get("fact_name", String.class), recorded, current,
                            current == null || current != recorded || !"confirmed".equals(status));
                }).all();
    }

    /**
     * 在用户确认后关联知识库事实与视觉资产，拒绝重复关联。
     *
     * @param projectId 共享项目标识
     * @param factId 事实标识
     * @param factRevision 确认时的事实修订号
     * @param assetId 视觉资产标识
     * @return 写入完成信号
     */
    public Mono<Void> linkAsset(String projectId, String factId, long factRevision, String assetId) {
        return databaseClient.sql("INSERT INTO novel_adaptation_asset_links(asset_id,project_id,fact_id,fact_revision) SELECT :assetId,:projectId,i.id,i.revision FROM story_bible_items i WHERE i.id=:factId AND i.project_id=:projectId AND i.status='confirmed' AND i.revision=:revision ON CONFLICT DO NOTHING")
                .bind("assetId", assetId).bind("projectId", projectId).bind("factId", factId)
                .bind("revision", factRevision).fetch().rowsUpdated()
                .flatMap(count -> count == 1 ? Mono.empty() : Mono.error(new BusinessException(ErrorCode.DATA_CONFLICT,
                        "故事事实已变化或视觉资产已关联，请刷新后重试")));
    }

    /**
     * 查询项目中的视觉资产事实关联和待审影响。
     *
     * @param projectId 共享项目标识
     * @return 资产关联列表
     */
    public Flux<NovelAdaptationDtos.AssetLink> listAssetLinks(String projectId) {
        return databaseClient.sql("SELECT l.asset_id,l.fact_id,l.fact_revision,i.name AS fact_name,i.revision AS current_revision,i.status AS fact_status,a.name AS asset_name FROM novel_adaptation_asset_links l JOIN comic_drama_assets a ON a.id=l.asset_id AND a.script_project_id=l.project_id LEFT JOIN story_bible_items i ON i.id=l.fact_id AND i.project_id=l.project_id WHERE l.project_id=:projectId ORDER BY l.created_at DESC")
                .bind("projectId", projectId).map((row, metadata) -> {
                    Long revision = row.get("current_revision", Long.class);
                    long recorded = row.get("fact_revision", Long.class);
                    return new NovelAdaptationDtos.AssetLink(row.get("asset_id", String.class),
                            row.get("fact_id", String.class), recorded, row.get("fact_name", String.class),
                            row.get("asset_name", String.class), revision == null || revision != recorded
                                    || !"confirmed".equals(row.get("fact_status", String.class)));
                }).all();
    }

    /**
     * 提取结构化产物的稳定标识。
     *
     * @param targets 目标标识列表
     * @param items 草稿条目数组
     * @return void 无返回值
     */
    private void addIds(List<Target> targets, String targetType, JSONArray items) {
        if (items == null) return;
        items.forEach(value -> {
            if (value instanceof JSONObject item && item.getString("id") != null) {
                targets.add(new Target(targetType, item.getString("id")));
            }
        });
    }

    /** 正式内容的类型与稳定标识。 */
    private record Target(String type, String id) {
        private String typeAndId() { return type + ":" + id; }
    }
}

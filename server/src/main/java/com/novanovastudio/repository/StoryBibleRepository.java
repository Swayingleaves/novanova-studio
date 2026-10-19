package com.novanovastudio.repository;

import java.math.BigDecimal;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.dto.StoryBibleDtos;
import io.r2dbc.spi.Row;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.r2dbc.core.DatabaseClient;
import org.springframework.stereotype.Repository;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * 故事知识库价格、分析任务与条目的数据库访问。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-09-27 00:00
 */
@Repository
@RequiredArgsConstructor
public class StoryBibleRepository {
    /** 条目查询公共列，附带别名、证据数与待审建议数。 */
    private static final String ITEM_COLUMNS = "i.*,COALESCE((SELECT jsonb_agg(a.alias ORDER BY a.alias) FROM story_bible_aliases a WHERE a.item_id=i.id),'[]'::jsonb)::text AS alias_list,"
            + "(SELECT COUNT(*) FROM story_bible_evidences e WHERE e.item_id=i.id) AS evidence_count,"
            + "(SELECT COUNT(*) FROM story_bible_items s WHERE s.suggest_for_item_id=i.id AND s.status='pending') AS suggestion_count";

    /** 响应式数据库客户端。 */
    private final DatabaseClient databaseClient;

    /** 价格配置。 */
    public record Pricing(String modelConfigId, List<StoryBibleDtos.PricingTier> tiers, long revision,
                          StoryBibleDtos.QuickConfiguration quickConfiguration) { }

    /** 分析任务。 */
    public record Job(String id, String projectId, String documentId, long userId, String clientRequestId,
                      String modelValue, String modelConfigId, List<String> sectionIds, List<int[]> ranges,
                      int billableChars, BigDecimal credits, long pricingRevision, long sourceRevision, String status,
                      String stage, int processedUnits, int totalUnits, int attemptCount, String errorMessage,
                      String createdAt, StoryBibleDtos.QuickConfiguration quickConfiguration,
                      int supplementCalls, int initialBatchCount) { }

    /** 分析工作单元。 */
    public record Unit(String id, String unitType, String unitKey, int seq, JSONObject snapshot, JSONObject result,
                       String status) { }

    /** 取消结算按初始批次统计，拆批后的所有叶子单元成功才算原批次成功。 */
    public record BatchSettlement(long completedBatches) { }

    /** 条目行。 */
    public record Item(String id, String projectId, String documentId, String itemType, String name, String summary,
                       JSONObject attributes, String origin, String status, boolean locked, String suggestForItemId,
                       String matchKey, Integer narrativeOffset, String storyTime, String storyTimeStatus,
                       Integer storyOrder, long revision) { }

    /** 写入分析结果时用于匹配的条目索引。 */
    public record MatchEntry(String id, String itemType, String status, boolean locked, String origin, String matchKey,
                             List<String> aliasKeys) { }

    /** 已确认条目的标识、类型与证据条数，改编时用于按板块分流、分批与分档。 */
    public record ItemTypeRef(String id, String itemType, int evidenceCount) { }

    // ---------------------------------------------------------------- 价格

    /**
     * 列出全部价格配置。
     * @return Flux<Pricing> 价格配置
     */
    public Flux<Pricing> listPricing() {
        return databaseClient.sql("SELECT model_config_id,tiers::text AS tiers,revision,quick_configuration::text AS quick_configuration FROM story_bible_pricing")
                .map((row, metadata) -> mapPricing(row)).all();
    }

    /**
     * 读取单个模型价格配置。
     * @param modelConfigId String 模型配置标识
     * @return Mono<Pricing> 价格配置
     */
    public Mono<Pricing> findPricing(String modelConfigId) {
        return databaseClient.sql("SELECT model_config_id,tiers::text AS tiers,revision,quick_configuration::text AS quick_configuration FROM story_bible_pricing WHERE model_config_id=:id")
                .bind("id", modelConfigId).map((row, metadata) -> mapPricing(row)).one();
    }

    /**
     * 按修订号保存价格配置，首次保存要求修订号为0。
     * @param modelConfigId String 模型配置标识
     * @param tiers List<PricingTier> 价格档位
     * @param expectedRevision long 期望修订号
     * @param configuration QuickConfiguration 快速分析配置，空值禁用快速模式
     * @return Mono<Boolean> 是否保存成功
     */
    public Mono<Boolean> savePricing(String modelConfigId, List<StoryBibleDtos.PricingTier> tiers, long expectedRevision,
                                     StoryBibleDtos.QuickConfiguration configuration) {
        String sql = expectedRevision == 0
                ? "INSERT INTO story_bible_pricing(model_config_id,tiers,revision,quick_configuration) VALUES (:id,:tiers::jsonb,1,:configuration::jsonb) ON CONFLICT (model_config_id) DO NOTHING"
                : "UPDATE story_bible_pricing SET tiers=:tiers::jsonb,quick_configuration=:configuration::jsonb,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE model_config_id=:id AND revision=:revision";
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql(sql).bind("id", modelConfigId).bind("tiers", JSON.toJSONString(tiers));
        spec = bindNullable(spec, "configuration", configuration == null ? null : JSON.toJSONString(configuration), String.class);
        if (expectedRevision != 0) {
            spec = spec.bind("revision", expectedRevision);
        }
        return spec.fetch().rowsUpdated().map(count -> count > 0);
    }

    // ---------------------------------------------------------------- 任务

    /**
     * 按客户端请求标识查询任务。
     * @param userId long 用户标识
     * @param clientRequestId String 请求标识
     * @return Mono<Job> 任务
     */
    public Mono<Job> findJobByRequest(long userId, String clientRequestId) {
        return databaseClient.sql("SELECT * FROM story_bible_analysis_jobs WHERE user_id=:userId AND client_request_id=:requestId")
                .bind("userId", userId).bind("requestId", clientRequestId).map((row, metadata) -> mapJob(row)).one();
    }

    /**
     * 按项目读取任务，未指定任务时返回最近一次任务。
     * @param projectId String 项目标识
     * @param jobId String 任务标识，可为空
     * @return Mono<Job> 任务
     */
    public Mono<Job> findJob(String projectId, String jobId) {
        if (jobId == null) {
            return databaseClient.sql("SELECT * FROM story_bible_analysis_jobs WHERE project_id=:projectId ORDER BY created_at DESC LIMIT 1")
                    .bind("projectId", projectId).map((row, metadata) -> mapJob(row)).one();
        }
        return databaseClient.sql("SELECT * FROM story_bible_analysis_jobs WHERE project_id=:projectId AND id=:id")
                .bind("projectId", projectId).bind("id", jobId).map((row, metadata) -> mapJob(row)).one();
    }

    /**
     * 按任务标识读取任务。
     * @param jobId String 任务标识
     * @return Mono<Job> 任务
     */
    public Mono<Job> findJobById(String jobId) {
        return databaseClient.sql("SELECT * FROM story_bible_analysis_jobs WHERE id=:id")
                .bind("id", jobId).map((row, metadata) -> mapJob(row)).one();
    }

    /**
     * 新增分析任务。
     * @param job Job 任务
     * @return Mono<Void> 写入结果
     */
    public Mono<Void> insertJob(Job job) {
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("INSERT INTO story_bible_analysis_jobs(id,project_id,document_id,user_id,client_request_id,model_value,model_config_id,section_ids,ranges,billable_chars,credits,pricing_revision,source_revision,quick_configuration,initial_batch_count) VALUES (:id,:projectId,:documentId,:userId,:requestId,:model,:modelConfigId,:sectionIds::jsonb,:ranges::jsonb,:chars,:credits,:pricingRevision,:sourceRevision,:configuration::jsonb,:initialBatchCount)")
                .bind("id", job.id()).bind("projectId", job.projectId()).bind("documentId", job.documentId())
                .bind("userId", job.userId()).bind("requestId", job.clientRequestId()).bind("model", job.modelValue())
                .bind("modelConfigId", job.modelConfigId()).bind("sectionIds", JSON.toJSONString(job.sectionIds()))
                .bind("ranges", JSON.toJSONString(job.ranges())).bind("chars", job.billableChars()).bind("credits", job.credits())
                .bind("pricingRevision", job.pricingRevision()).bind("sourceRevision", job.sourceRevision())
                .bind("initialBatchCount", job.initialBatchCount());
        return bindNullable(spec, "configuration", job.quickConfiguration() == null ? null : JSON.toJSONString(job.quickConfiguration()), String.class)
                .fetch().rowsUpdated().then();
    }

    /**
     * 抢占排队中或租约已过期的任务。
     * @param jobId String 任务标识
     * @param leaseSeconds int 租约秒数
     * @return Mono<Boolean> 是否抢占成功
     */
    public Mono<Boolean> claimJob(String jobId, int leaseSeconds) {
        return databaseClient.sql("UPDATE story_bible_analysis_jobs SET status='running',attempt_count=attempt_count+1,lease_until=CURRENT_TIMESTAMP+make_interval(secs=>:lease),updated_at=CURRENT_TIMESTAMP WHERE id=:id AND (status='queued' OR (status='running' AND lease_until<CURRENT_TIMESTAMP))")
                .bind("id", jobId).bind("lease", leaseSeconds).fetch().rowsUpdated().map(count -> count > 0);
    }

    /**
     * 续期执行租约。
     * @param jobId String 任务标识
     * @param leaseSeconds int 租约秒数
     * @return Mono<Void> 更新结果
     */
    public Mono<Void> renewJobLease(String jobId, int leaseSeconds) {
        return databaseClient.sql("UPDATE story_bible_analysis_jobs SET lease_until=CURRENT_TIMESTAMP+make_interval(secs=>:lease) WHERE id=:id AND status='running'")
                .bind("id", jobId).bind("lease", leaseSeconds).fetch().rowsUpdated().then();
    }

    /**
     * 读取任务状态。
     * @param jobId String 任务标识
     * @return Mono<String> 状态
     */
    public Mono<String> jobStatus(String jobId) {
        return databaseClient.sql("SELECT status FROM story_bible_analysis_jobs WHERE id=:id")
                .bind("id", jobId).map((row, metadata) -> row.get("status", String.class)).one();
    }

    /**
     * 更新任务阶段与进度。
     * @param jobId String 任务标识
     * @param stage String 阶段
     * @return Mono<Void> 更新结果
     */
    public Mono<Void> updateProgress(String jobId, String stage) {
        return databaseClient.sql("UPDATE story_bible_analysis_jobs SET stage=:stage,processed_units=(SELECT COUNT(*) FROM story_bible_analysis_units WHERE job_id=:id AND status='completed'),total_units=(SELECT COUNT(*) FROM story_bible_analysis_units WHERE job_id=:id),updated_at=CURRENT_TIMESTAMP WHERE id=:id AND status='running'")
                .bind("id", jobId).bind("stage", stage).fetch().rowsUpdated().then();
    }

    /**
     * 按允许的原状态转换任务状态。
     * @param jobId String 任务标识
     * @param fromStatuses List<String> 允许的原状态
     * @param toStatus String 新状态
     * @param message String 失败原因
     * @return Mono<Boolean> 是否更新成功
     */
    public Mono<Boolean> transitJob(String jobId, List<String> fromStatuses, String toStatus, String message) {
        return databaseClient.sql("UPDATE story_bible_analysis_jobs SET status=:to,error_message=:message,lease_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=:id AND status IN (:from)")
                .bind("id", jobId).bind("to", toStatus).bind("message", message).bind("from", fromStatuses)
                .fetch().rowsUpdated().map(count -> count > 0);
    }

    /**
     * 列出排队中或租约已过期的任务。
     * @return Flux<Job> 可恢复任务
     */
    public Flux<Job> recoverableJobs() {
        return databaseClient.sql("SELECT * FROM story_bible_analysis_jobs WHERE status='queued' OR (status='running' AND lease_until<CURRENT_TIMESTAMP) ORDER BY created_at")
                .map((row, metadata) -> mapJob(row)).all();
    }

    // ---------------------------------------------------------------- 工作单元

    /**
     * 幂等写入工作单元。
     * @param jobId String 任务标识
     * @param unitType String 单元类型
     * @param unitKey String 单元键
     * @param seq int 顺序
     * @param snapshot JSONObject 输入快照
     * @return Mono<Void> 写入结果
     */
    public Mono<Void> insertUnit(String jobId, String unitType, String unitKey, int seq, JSONObject snapshot) {
        return databaseClient.sql("INSERT INTO story_bible_analysis_units(id,job_id,unit_type,unit_key,seq,input_snapshot) VALUES (:id,:jobId,:type,:key,:seq,:snapshot::jsonb) ON CONFLICT (job_id,unit_type,unit_key) DO NOTHING")
                .bind("id", UUID.randomUUID().toString()).bind("jobId", jobId).bind("type", unitType).bind("key", unitKey)
                .bind("seq", seq).bind("snapshot", snapshot.toJSONString()).fetch().rowsUpdated().then();
    }

    /**
     * 按顺序列出某类工作单元。
     * @param jobId String 任务标识
     * @param unitType String 单元类型
     * @return Flux<Unit> 工作单元
     */
    public Flux<Unit> listUnits(String jobId, String unitType) {
        return databaseClient.sql("SELECT id,unit_type,unit_key,seq,input_snapshot::text AS snapshot,result::text AS result,status FROM story_bible_analysis_units WHERE job_id=:jobId AND unit_type=:type ORDER BY seq")
                .bind("jobId", jobId).bind("type", unitType).map((row, metadata) -> {
                    String result = row.get("result", String.class);
                    return new Unit(row.get("id", String.class), row.get("unit_type", String.class), row.get("unit_key", String.class),
                            row.get("seq", Integer.class), JSON.parseObject(row.get("snapshot", String.class)),
                            result == null ? null : JSON.parseObject(result), row.get("status", String.class));
                }).all();
    }

    /**
     * 保存工作单元结果并标记完成。
     * @param unitId String 单元标识
     * @param result JSONObject 结果
     * @return Mono<Void> 更新结果
     */
    public Mono<Void> completeUnit(String unitId, JSONObject result) {
        return databaseClient.sql("UPDATE story_bible_analysis_units SET result=:result::jsonb,status='completed',updated_at=CURRENT_TIMESTAMP WHERE id=:id")
                .bind("id", unitId).bind("result", result.toJSONString()).fetch().rowsUpdated().then();
    }

    /**
     * 在任务行锁保护下统计取消结算批次，排除拆分检查点和有缺口的结果。
     *
     * @param jobId String 分析任务标识
     * @return Mono&lt;BatchSettlement&gt; 全部叶子结果成功的初始批数
     */
    public Mono<BatchSettlement> batchSettlement(String jobId) {
        return databaseClient.sql("""
                SELECT COUNT(*) FILTER (WHERE completed) AS completed_batches
                FROM (
                    SELECT regexp_replace(unit_key, '[ab]+$', '') AS initial_key,
                           bool_and(status = 'completed' AND COALESCE(result ? 'candidates', FALSE))
                               FILTER (WHERE COALESCE(result->>'split', 'false') <> 'true') AS completed
                    FROM story_bible_analysis_units
                    WHERE job_id = :id AND unit_type = 'batch'
                    GROUP BY regexp_replace(unit_key, '[ab]+$', '')
                ) batches
                """).bind("id", jobId)
                .map((row, metadata) -> new BatchSettlement(row.get("completed_batches", Long.class))).one();
    }

    /**
     * 锁定当前执行尝试的任务行，串行提交批次并与取消互斥，调用方必须开启事务。
     * @param job Job 执行快照
     * @return Mono<Boolean> 是否仍拥有执行权
     */
    public Mono<Boolean> lockRunningJob(Job job) {
        return databaseClient.sql("SELECT id FROM story_bible_analysis_jobs WHERE id=:id AND status='running' AND attempt_count=:attempt FOR UPDATE")
                .bind("id", job.id()).bind("attempt", job.attemptCount()).map((row, metadata) -> true).one().defaultIfEmpty(false);
    }

    /**
     * 在任务锁保护下预留一次补分析调用，额度跨续跑持久保存。
     * @param jobId String 任务标识
     * @param maximum int 最多补分析调用次数
     * @return Mono<Boolean> 是否取得额度
     */
    public Mono<Boolean> reserveSupplement(String jobId, int maximum) {
        return databaseClient.sql("UPDATE story_bible_analysis_jobs SET supplement_calls=supplement_calls+1 WHERE id=:id AND status='running' AND supplement_calls<:maximum")
                .bind("id", jobId).bind("maximum", maximum).fetch().rowsUpdated().map(count -> count > 0);
    }

    /**
     * 仅在执行尝试仍有效时结束快速任务，缺口存在则标记部分完成。
     * @param job Job 执行快照
     * @param partial boolean 是否存在未覆盖片段
     * @return Mono<Boolean> 是否完成状态转换
     */
    public Mono<Boolean> finishQuickJob(Job job, boolean partial) {
        return databaseClient.sql("UPDATE story_bible_analysis_jobs SET status=:status,stage='done',error_message=:message,lease_until=NULL,processed_units=total_units,updated_at=CURRENT_TIMESTAMP WHERE id=:id AND status='running' AND attempt_count=:attempt")
                .bind("id", job.id()).bind("attempt", job.attemptCount())
                .bind("status", partial ? "partial" : "completed")
                .bind("message", partial ? "部分章节片段缺少可核对的原文结果，请查看缺口" : "")
                .fetch().rowsUpdated().map(count -> count > 0);
    }

    /**
     * 查询快速模式未覆盖的片段。
     * @param jobId String 任务标识
     * @return Flux&lt;AnalysisGap&gt; 缺口
     */
    public Flux<StoryBibleDtos.AnalysisGap> listGaps(String jobId) {
        return databaseClient.sql("SELECT input_snapshot::text AS snapshot,result::text AS result FROM story_bible_analysis_units WHERE job_id=:id AND unit_type='batch' AND (status='pending' OR result->>'gap'='true') ORDER BY seq")
                .bind("id", jobId).map((row, metadata) -> {
                    JSONObject snapshot = JSON.parseObject(row.get("snapshot", String.class));
                    JSONObject result = JSON.parseObject(row.get("result", String.class));
                    return snapshot.getJSONArray("parts").toJavaList(JSONObject.class).stream()
                            .map(part -> new StoryBibleDtos.AnalysisGap(part.getString("sectionId"), part.getString("title"),
                                    part.getIntValue("start"), part.getIntValue("end"), result == null ? "尚未完成" : result.getString("reason"))).toList();
                }).all().flatMapIterable(parts -> parts);
    }

    // ---------------------------------------------------------------- 条目

    /**
     * 分页查询条目，不含待审建议。
     * @param projectId String 项目标识
     * @param itemType String 条目类型，可为空
     * @param status String 状态，为空时排除已拒绝
     * @param keyword String 关键字，可为空
     * @param storyOrder boolean 是否按故事时间排序
     * @param offset int 偏移
     * @param limit int 数量
     * @return Flux<ItemSummary> 条目
     */
    public Flux<StoryBibleDtos.ItemSummary> listItems(String projectId, String itemType, String status, String keyword,
                                                      boolean storyOrder, int offset, int limit) {
        String order = storyOrder
                ? " ORDER BY i.story_order NULLS LAST,CASE i.story_time_status WHEN 'known' THEN 0 ELSE 1 END,i.narrative_offset NULLS LAST,i.name"
                : " ORDER BY i.narrative_offset NULLS LAST,i.name";
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("SELECT " + ITEM_COLUMNS + " FROM story_bible_items i"
                        + itemFilter(itemType, status, keyword) + order + " LIMIT :limit OFFSET :offset")
                .bind("limit", limit).bind("offset", offset);
        return bindItemFilter(spec, projectId, itemType, status, keyword).map((row, metadata) -> mapSummary(row)).all();
    }

    /**
     * 列出项目中故事发生时间尚未确认的已确认事件，供改编一致性检查。
     *
     * @param projectId 剧本项目标识
     * @return 时间待确认事件
     */
    public Flux<StoryBibleDtos.ItemSummary> listUncertainEvents(String projectId) {
        return databaseClient.sql("SELECT " + ITEM_COLUMNS + " FROM story_bible_items i WHERE i.project_id=:projectId AND i.item_type='event' AND i.status='confirmed' AND i.story_time_status<>'known' ORDER BY i.narrative_offset NULLS LAST,i.id")
                .bind("projectId", projectId).map((row, metadata) -> mapSummary(row)).all();
    }

    /**
     * 统计条目数量。
     * @param projectId String 项目标识
     * @param itemType String 条目类型
     * @param status String 状态
     * @param keyword String 关键字
     * @return Mono<Long> 数量
     */
    /**
     * 列出项目已确认条目的标识与类型。
     *
     * @param projectId String 项目标识
     * @return Flux<ItemTypeRef> 条目标识与类型
     */
    public Flux<ItemTypeRef> listConfirmedItemTypes(String projectId) {
        return databaseClient.sql("SELECT i.id,i.item_type,"
                        + "(SELECT count(*) FROM story_bible_evidences e WHERE e.item_id=i.id) AS evidence_count "
                        + "FROM story_bible_items i WHERE i.project_id=:projectId AND i.status='confirmed'")
                .bind("projectId", projectId)
                .map((row, metadata) -> new ItemTypeRef(row.get("id", String.class),
                        row.get("item_type", String.class), row.get("evidence_count", Long.class).intValue()))
                .all();
    }

    public Mono<Long> countItems(String projectId, String itemType, String status, String keyword) {
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("SELECT COUNT(*) AS total FROM story_bible_items i" + itemFilter(itemType, status, keyword));
        return bindItemFilter(spec, projectId, itemType, status, keyword).map((row, metadata) -> row.get("total", Long.class)).one();
    }

    /**
     * 一次读取项目全部已确认条目，供逐集正文批量按分集裁剪事实范围。
     * <p>
     * 逐集生成需要把上千条事实按分集收敛，逐条 getItem 会让单集准备阶段产生上千次查询，
     * 因此这里一次取全会话再在内存里索引。
     *
     * @param projectId String 项目标识
     * @return Flux&lt;Item&gt; 全部已确认条目
     */
    public Flux<Item> listConfirmedItems(String projectId) {
        return databaseClient.sql("SELECT * FROM story_bible_items WHERE project_id=:projectId "
                        + "AND status='confirmed' AND suggest_for_item_id IS NULL "
                        + "ORDER BY narrative_offset NULLS LAST,id")
                .bind("projectId", projectId).map((row, metadata) -> mapItem(row)).all();
    }

    /**
     * 读取项目内条目。
     * @param projectId String 项目标识
     * @param itemId String 条目标识
     * @return Mono<Item> 条目
     */
    public Mono<Item> getItem(String projectId, String itemId) {
        return databaseClient.sql("SELECT * FROM story_bible_items WHERE project_id=:projectId AND id=:id")
                .bind("projectId", projectId).bind("id", itemId).map((row, metadata) -> mapItem(row)).one();
    }

    /**
     * 读取条目摘要。
     * @param itemId String 条目标识
     * @return Mono<ItemSummary> 条目摘要
     */
    public Mono<StoryBibleDtos.ItemSummary> getSummary(String itemId) {
        return databaseClient.sql("SELECT " + ITEM_COLUMNS + " FROM story_bible_items i WHERE i.id=:id")
                .bind("id", itemId).map((row, metadata) -> mapSummary(row)).one();
    }

    /**
     * 列出条目的待审建议。
     * @param itemId String 目标条目标识
     * @return Flux<ItemSummary> 建议
     */
    public Flux<StoryBibleDtos.ItemSummary> listSuggestions(String itemId) {
        return databaseClient.sql("SELECT " + ITEM_COLUMNS + " FROM story_bible_items i WHERE i.suggest_for_item_id=:id AND i.status='pending' ORDER BY i.created_at")
                .bind("id", itemId).map((row, metadata) -> mapSummary(row)).all();
    }

    /**
     * 新增条目。
     * @param item Item 条目
     * @param jobId String 写入的任务标识，人工条目为空
     * @return Mono<Void> 写入结果
     */
    public Mono<Void> insertItem(Item item, String jobId) {
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("INSERT INTO story_bible_items(id,project_id,document_id,item_type,name,summary,attributes,origin,status,locked,suggest_for_item_id,match_key,narrative_offset,story_time,story_time_status,story_order,last_job_id) VALUES (:id,:projectId,:documentId,:type,:name,:summary,:attributes::jsonb,:origin,:status,:locked,:suggestFor,:matchKey,:narrativeOffset,:storyTime,:storyTimeStatus,:storyOrder,:jobId)")
                .bind("id", item.id()).bind("projectId", item.projectId()).bind("documentId", item.documentId())
                .bind("type", item.itemType()).bind("name", item.name()).bind("summary", item.summary())
                .bind("attributes", item.attributes().toJSONString()).bind("origin", item.origin()).bind("status", item.status())
                .bind("locked", item.locked()).bind("matchKey", item.matchKey()).bind("storyTime", item.storyTime())
                .bind("storyTimeStatus", item.storyTimeStatus());
        spec = bindNullable(spec, "suggestFor", item.suggestForItemId(), String.class);
        spec = bindNullable(spec, "narrativeOffset", item.narrativeOffset(), Integer.class);
        spec = bindNullable(spec, "storyOrder", item.storyOrder(), Integer.class);
        spec = bindNullable(spec, "jobId", jobId, String.class);
        return spec.fetch().rowsUpdated().then();
    }

    /**
     * 按修订号更新条目内容。
     * @param item Item 新内容，revision为期望修订号
     * @param jobId String 写入的任务标识，人工编辑为空
     * @return Mono<Boolean> 是否更新成功
     */
    public Mono<Boolean> updateItem(Item item, String jobId) {
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("UPDATE story_bible_items SET name=:name,summary=:summary,attributes=:attributes::jsonb,status=:status,locked=:locked,match_key=:matchKey,story_time=:storyTime,story_time_status=:storyTimeStatus,story_order=:storyOrder,last_job_id=COALESCE(:jobId,last_job_id),revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=:id AND revision=:revision")
                .bind("id", item.id()).bind("revision", item.revision()).bind("name", item.name()).bind("summary", item.summary())
                .bind("attributes", item.attributes().toJSONString()).bind("status", item.status()).bind("locked", item.locked())
                .bind("matchKey", item.matchKey()).bind("storyTime", item.storyTime()).bind("storyTimeStatus", item.storyTimeStatus());
        spec = bindNullable(spec, "storyOrder", item.storyOrder(), Integer.class);
        spec = bindNullable(spec, "jobId", jobId, String.class);
        return spec.fetch().rowsUpdated().map(count -> count > 0);
    }

    /**
     * 分析写入时更新未锁定的AI条目，条目已被人工锁定时不更新。
     * @param item Item 新内容
     * @param jobId String 任务标识
     * @return Mono<Boolean> 是否更新成功
     */
    public Mono<Boolean> updateAiItem(Item item, String jobId) {
        return databaseClient.sql("UPDATE story_bible_items SET name=:name,summary=CASE WHEN :summary='' THEN summary ELSE :summary END,attributes=:attributes::jsonb,status='pending',match_key=:matchKey,story_time=:storyTime,story_time_status=:storyTimeStatus,last_job_id=:jobId,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=:id AND locked=FALSE")
                .bind("id", item.id()).bind("name", item.name()).bind("summary", item.summary())
                .bind("attributes", item.attributes().toJSONString()).bind("matchKey", item.matchKey())
                .bind("storyTime", item.storyTime()).bind("storyTimeStatus", item.storyTimeStatus()).bind("jobId", jobId)
                .fetch().rowsUpdated().map(count -> count > 0);
    }

    /**
     * 按修订号更新状态与锁定标记。
     * @param itemId String 条目标识
     * @param expectedRevision long 期望修订号
     * @param status String 新状态
     * @return Mono<Boolean> 是否更新成功
     */
    public Mono<Boolean> updateStatus(String itemId, long expectedRevision, String status) {
        return databaseClient.sql("UPDATE story_bible_items SET status=:status,locked=TRUE,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=:id AND revision=:revision")
                .bind("id", itemId).bind("revision", expectedRevision).bind("status", status)
                .fetch().rowsUpdated().map(count -> count > 0);
    }

    /**
     * 删除条目。
     * @param itemId String 条目标识
     * @return Mono<Void> 删除结果
     */
    public Mono<Void> deleteItem(String itemId) {
        return databaseClient.sql("DELETE FROM story_bible_items WHERE id=:id").bind("id", itemId).fetch().rowsUpdated().then();
    }

    /**
     * 按修订号删除条目。
     * @param itemId String 条目标识
     * @param expectedRevision long 期望修订号
     * @return Mono<Boolean> 是否删除成功
     */
    public Mono<Boolean> deleteItemAt(String itemId, long expectedRevision) {
        return databaseClient.sql("DELETE FROM story_bible_items WHERE id=:id AND revision=:revision")
                .bind("id", itemId).bind("revision", expectedRevision).fetch().rowsUpdated().map(count -> count > 0);
    }

    /**
     * 把条目的待审建议转给另一个条目。
     * @param fromItemId String 原目标条目
     * @param toItemId String 新目标条目
     * @return Mono<Void> 更新结果
     */
    public Mono<Void> moveSuggestions(String fromItemId, String toItemId) {
        return databaseClient.sql("UPDATE story_bible_items SET suggest_for_item_id=:to WHERE suggest_for_item_id=:from")
                .bind("from", fromItemId).bind("to", toItemId).fetch().rowsUpdated().then();
    }

    /**
     * 删除目标条目的待审建议，保留已拒绝建议用于抑制。
     * @param itemId String 目标条目标识
     * @return Mono<Void> 删除结果
     */
    public Mono<Void> deletePendingSuggestions(String itemId) {
        return databaseClient.sql("DELETE FROM story_bible_items WHERE suggest_for_item_id=:id AND status='pending'")
                .bind("id", itemId).fetch().rowsUpdated().then();
    }

    /**
     * 读取项目全部非建议条目的匹配索引。
     * @param projectId String 项目标识
     * @return Flux<MatchEntry> 匹配索引
     */
    public Flux<MatchEntry> listMatchEntries(String projectId) {
        return databaseClient.sql("SELECT i.id,i.item_type,i.status,i.locked,i.origin,i.match_key,COALESCE((SELECT jsonb_agg(a.normalized_alias) FROM story_bible_aliases a WHERE a.item_id=i.id),'[]'::jsonb)::text AS alias_keys FROM story_bible_items i WHERE i.project_id=:projectId AND i.suggest_for_item_id IS NULL ORDER BY i.created_at")
                .bind("projectId", projectId).map((row, metadata) -> new MatchEntry(row.get("id", String.class),
                        row.get("item_type", String.class), row.get("status", String.class),
                        Boolean.TRUE.equals(row.get("locked", Boolean.class)), row.get("origin", String.class),
                        row.get("match_key", String.class), JSON.parseArray(row.get("alias_keys", String.class), String.class))).all();
    }

    /**
     * 以最早证据位置刷新项目内条目的叙事位置。
     * @param projectId String 项目标识
     * @return Mono<Void> 更新结果
     */
    public Mono<Void> refreshNarrativeOffsets(String projectId) {
        return databaseClient.sql("UPDATE story_bible_items i SET narrative_offset=(SELECT MIN(e.start_offset) FROM story_bible_evidences e WHERE e.item_id=i.id) WHERE i.project_id=:projectId")
                .bind("projectId", projectId).fetch().rowsUpdated().then();
    }

    // ---------------------------------------------------------------- 别名、关联与证据

    /**
     * 列出条目别名。
     * @param itemId String 条目标识
     * @return Flux<Alias> 别名
     */
    public Flux<StoryBibleDtos.Alias> listAliases(String itemId) {
        return databaseClient.sql("SELECT id,alias FROM story_bible_aliases WHERE item_id=:id ORDER BY alias")
                .bind("id", itemId).map((row, metadata) -> new StoryBibleDtos.Alias(row.get("id", String.class), row.get("alias", String.class))).all();
    }

    /**
     * 幂等新增别名。
     * @param itemId String 条目标识
     * @param alias String 别名
     * @param normalized String 归一化别名
     * @return Mono<Void> 写入结果
     */
    public Mono<Void> insertAlias(String itemId, String alias, String normalized) {
        return databaseClient.sql("INSERT INTO story_bible_aliases(id,item_id,alias,normalized_alias) VALUES (:id,:itemId,:alias,:normalized) ON CONFLICT (item_id,normalized_alias) DO NOTHING")
                .bind("id", UUID.randomUUID().toString()).bind("itemId", itemId).bind("alias", alias).bind("normalized", normalized)
                .fetch().rowsUpdated().then();
    }

    /**
     * 删除不在保留列表中的别名。
     * @param itemId String 条目标识
     * @param keepNormalized List<String> 保留的归一化别名
     * @return Mono<Void> 删除结果
     */
    public Mono<Void> deleteAliasesExcept(String itemId, List<String> keepNormalized) {
        if (keepNormalized.isEmpty()) {
            return databaseClient.sql("DELETE FROM story_bible_aliases WHERE item_id=:id").bind("id", itemId).fetch().rowsUpdated().then();
        }
        return databaseClient.sql("DELETE FROM story_bible_aliases WHERE item_id=:id AND normalized_alias NOT IN (:keep)")
                .bind("id", itemId).bind("keep", keepNormalized).fetch().rowsUpdated().then();
    }

    /**
     * 把别名转移到另一个条目，目标已有的同名别名直接丢弃。
     * @param fromItemId String 原条目
     * @param toItemId String 目标条目
     * @param aliasIds List<String> 指定别名，为空表示全部
     * @return Mono<Void> 更新结果
     */
    public Mono<Void> moveAliases(String fromItemId, String toItemId, List<String> aliasIds) {
        String scope = aliasIds == null ? "" : " AND id IN (:aliasIds)";
        DatabaseClient.GenericExecuteSpec dropDuplicates = databaseClient.sql("DELETE FROM story_bible_aliases s WHERE item_id=:from" + scope + " AND EXISTS (SELECT 1 FROM story_bible_aliases t WHERE t.item_id=:to AND t.normalized_alias=s.normalized_alias)")
                .bind("from", fromItemId).bind("to", toItemId);
        DatabaseClient.GenericExecuteSpec move = databaseClient.sql("UPDATE story_bible_aliases SET item_id=:to WHERE item_id=:from" + scope)
                .bind("from", fromItemId).bind("to", toItemId);
        if (aliasIds != null) {
            dropDuplicates = dropDuplicates.bind("aliasIds", aliasIds);
            move = move.bind("aliasIds", aliasIds);
        }
        return dropDuplicates.fetch().rowsUpdated().then(move.fetch().rowsUpdated()).then();
    }

    /**
     * 列出条目发出的关联。
     * @param itemId String 条目标识
     * @return Flux<Link> 关联
     */
    public Flux<StoryBibleDtos.Link> listLinks(String itemId) {
        return databaseClient.sql("SELECT l.related_item_id AS other_id,r.name,r.item_type,l.role FROM story_bible_links l JOIN story_bible_items r ON r.id=l.related_item_id WHERE l.item_id=:id ORDER BY l.role,r.name")
                .bind("id", itemId).map((row, metadata) -> mapLink(row)).all();
    }

    /**
     * 列出引用该条目的关系、事件与故事线。
     * @param itemId String 条目标识
     * @return Flux<Link> 反向关联
     */
    public Flux<StoryBibleDtos.Link> listReferencedBy(String itemId) {
        return databaseClient.sql("SELECT l.item_id AS other_id,r.name,r.item_type,l.role FROM story_bible_links l JOIN story_bible_items r ON r.id=l.item_id WHERE l.related_item_id=:id AND r.status<>'rejected' ORDER BY r.narrative_offset NULLS LAST LIMIT 200")
                .bind("id", itemId).map((row, metadata) -> mapLink(row)).all();
    }

    /**
     * 删除条目发出的全部关联。
     * @param itemId String 条目标识
     * @return Mono<Void> 删除结果
     */
    public Mono<Void> deleteLinks(String itemId) {
        return databaseClient.sql("DELETE FROM story_bible_links WHERE item_id=:id").bind("id", itemId).fetch().rowsUpdated().then();
    }

    /**
     * 幂等新增关联。
     * @param itemId String 条目标识
     * @param relatedItemId String 被关联条目标识
     * @param role String 关联角色
     * @return Mono<Void> 写入结果
     */
    public Mono<Void> insertLink(String itemId, String relatedItemId, String role) {
        return databaseClient.sql("INSERT INTO story_bible_links(id,item_id,related_item_id,role) VALUES (:id,:itemId,:relatedId,:role) ON CONFLICT (item_id,related_item_id,role) DO NOTHING")
                .bind("id", UUID.randomUUID().toString()).bind("itemId", itemId).bind("relatedId", relatedItemId).bind("role", role)
                .fetch().rowsUpdated().then();
    }

    /**
     * 把指向原条目的关联改指向目标条目。
     * @param fromItemId String 原条目
     * @param toItemId String 目标条目
     * @return Mono<Void> 更新结果
     */
    public Mono<Void> repointLinks(String fromItemId, String toItemId) {
        return databaseClient.sql("DELETE FROM story_bible_links s WHERE related_item_id=:from AND EXISTS (SELECT 1 FROM story_bible_links t WHERE t.item_id=s.item_id AND t.related_item_id=:to AND t.role=s.role)")
                .bind("from", fromItemId).bind("to", toItemId).fetch().rowsUpdated()
                .then(databaseClient.sql("UPDATE story_bible_links SET related_item_id=:to WHERE related_item_id=:from")
                        .bind("from", fromItemId).bind("to", toItemId).fetch().rowsUpdated()).then();
    }

    /**
     * 查询条目是否属于项目且未被拒绝。
     * @param projectId String 项目标识
     * @param itemIds List<String> 条目标识
     * @return Flux<Item> 条目
     */
    public Flux<Item> findItems(String projectId, List<String> itemIds) {
        if (itemIds.isEmpty()) {
            return Flux.empty();
        }
        return databaseClient.sql("SELECT * FROM story_bible_items WHERE project_id=:projectId AND id IN (:ids)")
                .bind("projectId", projectId).bind("ids", itemIds).map((row, metadata) -> mapItem(row)).all();
    }

    /**
     * 在事务中锁定项目条目，供批量审阅校验并发修订号。
     * @param projectId String 项目标识
     * @param itemIds List<String> 条目标识
     * @return Flux<Item> 已锁定条目
     */
    public Flux<Item> findItemsForUpdate(String projectId, List<String> itemIds) {
        if (itemIds.isEmpty()) {
            return Flux.empty();
        }
        return databaseClient.sql("SELECT * FROM story_bible_items WHERE project_id=:projectId AND id IN (:ids) FOR UPDATE")
                .bind("projectId", projectId).bind("ids", itemIds).map((row, metadata) -> mapItem(row)).all();
    }

    /**
     * 列出项目中指定类型的全部待确认条目，供全量确认读取当前修订号。
     * @param projectId String 项目标识
     * @param itemType String 条目类型
     * @return Flux<Item> 待确认条目
     */
    public Flux<Item> listPendingItems(String projectId, String itemType) {
        return databaseClient.sql("SELECT * FROM story_bible_items WHERE project_id=:projectId AND item_type=:itemType AND status='pending' ORDER BY id")
                .bind("projectId", projectId).bind("itemType", itemType).map((row, metadata) -> mapItem(row)).all();
    }

    /**
     * 列出条目证据。
     * @param itemId String 条目标识
     * @param limit int 数量上限
     * @return Flux<Evidence> 证据
     */
    public Flux<StoryBibleDtos.Evidence> listEvidences(String itemId, int limit) {
        return databaseClient.sql("SELECT id,alias_id,start_offset,end_offset,quote FROM story_bible_evidences WHERE item_id=:id ORDER BY start_offset LIMIT :limit")
                .bind("id", itemId).bind("limit", limit).map((row, metadata) -> new StoryBibleDtos.Evidence(row.get("id", String.class),
                        row.get("alias_id", String.class), row.get("start_offset", Integer.class), row.get("end_offset", Integer.class),
                        row.get("quote", String.class))).all();
    }

    /**
     * 列出条目及其已拒绝建议已占用的证据位置，用于过滤重复建议。
     * @param itemId String 条目标识
     * @return Flux<String> 起点:终点
     */
    public Flux<String> knownEvidenceSpans(String itemId) {
        return databaseClient.sql("SELECT e.start_offset||':'||e.end_offset AS span FROM story_bible_evidences e JOIN story_bible_items i ON i.id=e.item_id WHERE i.id=:id OR i.suggest_for_item_id=:id")
                .bind("id", itemId).map((row, metadata) -> row.get("span", String.class)).all();
    }

    /**
     * 新增证据，别名标识按归一化别名在同一语句内解析。
     * @param itemId String 条目标识
     * @param documentId String 原文标识
     * @param evidence CandidateEvidence 证据
     * @param normalizedAlias String 归一化别名，可为空
     * @param jobId String 任务标识，人工证据为空
     * @return Mono<Void> 写入结果
     */
    public Mono<Void> insertEvidence(String itemId, String documentId, StoryBibleDtos.CandidateEvidence evidence,
                                     String normalizedAlias, String jobId) {
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("INSERT INTO story_bible_evidences(id,item_id,alias_id,document_id,start_offset,end_offset,quote,job_id) VALUES (:id,:itemId,(SELECT a.id FROM story_bible_aliases a WHERE a.item_id=:itemId AND a.normalized_alias=:alias),:documentId,:start,:end,:quote,:jobId)")
                .bind("id", UUID.randomUUID().toString()).bind("itemId", itemId).bind("documentId", documentId)
                .bind("start", evidence.start()).bind("end", evidence.end()).bind("quote", evidence.quote());
        spec = bindNullable(spec, "alias", normalizedAlias, String.class);
        spec = bindNullable(spec, "jobId", jobId, String.class);
        return spec.fetch().rowsUpdated().then();
    }

    /**
     * 转移证据，已存在相同位置的证据直接丢弃。
     * @param fromItemId String 原条目
     * @param toItemId String 目标条目
     * @param evidenceIds List<String> 指定证据，为空表示全部
     * @param aliasIds List<String> 同时转移这些别名下的证据，可为空
     * @return Mono<Void> 更新结果
     */
    public Mono<Void> moveEvidences(String fromItemId, String toItemId, List<String> evidenceIds, List<String> aliasIds) {
        String scope = evidenceIds == null ? "" : " AND (id IN (:evidenceIds) OR alias_id IN (:aliasIds))";
        DatabaseClient.GenericExecuteSpec dropDuplicates = databaseClient.sql("DELETE FROM story_bible_evidences s WHERE item_id=:from" + scope + " AND EXISTS (SELECT 1 FROM story_bible_evidences t WHERE t.item_id=:to AND t.start_offset=s.start_offset AND t.end_offset=s.end_offset)")
                .bind("from", fromItemId).bind("to", toItemId);
        DatabaseClient.GenericExecuteSpec move = databaseClient.sql("UPDATE story_bible_evidences SET item_id=:to WHERE item_id=:from" + scope)
                .bind("from", fromItemId).bind("to", toItemId);
        if (evidenceIds != null) {
            // IN子句不能绑定空列表，用不可能出现的标识占位。
            List<String> evidences = evidenceIds.isEmpty() ? List.of("-") : evidenceIds;
            List<String> aliases = aliasIds == null || aliasIds.isEmpty() ? List.of("-") : aliasIds;
            dropDuplicates = dropDuplicates.bind("evidenceIds", evidences).bind("aliasIds", aliases);
            move = move.bind("evidenceIds", evidences).bind("aliasIds", aliases);
        }
        return dropDuplicates.fetch().rowsUpdated().then(move.fetch().rowsUpdated()).then();
    }

    // ---------------------------------------------------------------- 映射

    /**
     * 构造条目过滤条件。
     * @param itemType String 类型
     * @param status String 状态
     * @param keyword String 关键字
     * @return String WHERE子句
     */
    private String itemFilter(String itemType, String status, String keyword) {
        StringBuilder where = new StringBuilder(" WHERE i.project_id=:projectId AND i.suggest_for_item_id IS NULL");
        if (itemType != null) {
            where.append(" AND i.item_type=:itemType");
        }
        where.append(status == null ? " AND i.status<>'rejected'" : " AND i.status=:status");
        if (keyword != null) {
            where.append(" AND (position(lower(:keyword) in lower(i.name))>0 OR EXISTS (SELECT 1 FROM story_bible_aliases a WHERE a.item_id=i.id AND position(lower(:keyword) in lower(a.alias))>0))");
        }
        return where.toString();
    }

    /**
     * 绑定条目过滤参数。
     * @param spec GenericExecuteSpec 查询
     * @param projectId String 项目标识
     * @param itemType String 类型
     * @param status String 状态
     * @param keyword String 关键字
     * @return GenericExecuteSpec 查询
     */
    private DatabaseClient.GenericExecuteSpec bindItemFilter(DatabaseClient.GenericExecuteSpec spec, String projectId,
                                                             String itemType, String status, String keyword) {
        spec = spec.bind("projectId", projectId);
        if (itemType != null) {
            spec = spec.bind("itemType", itemType);
        }
        if (status != null) {
            spec = spec.bind("status", status);
        }
        if (keyword != null) {
            spec = spec.bind("keyword", keyword);
        }
        return spec;
    }

    /**
     * 绑定可空参数。
     * @param spec GenericExecuteSpec 语句
     * @param name String 参数名
     * @param value Object 参数值
     * @param type Class<?> 参数类型
     * @return GenericExecuteSpec 语句
     */
    private DatabaseClient.GenericExecuteSpec bindNullable(DatabaseClient.GenericExecuteSpec spec, String name, Object value, Class<?> type) {
        return value == null ? spec.bindNull(name, type) : spec.bind(name, value);
    }

    /**
     * 转换价格行。
     * @param row Row 数据库行
     * @return Pricing 价格配置
     */
    private Pricing mapPricing(Row row) {
        return new Pricing(row.get("model_config_id", String.class),
                JSON.parseArray(row.get("tiers", String.class), StoryBibleDtos.PricingTier.class), row.get("revision", Long.class),
                JSON.parseObject(row.get("quick_configuration", String.class), StoryBibleDtos.QuickConfiguration.class));
    }

    /**
     * 转换任务行。
     * @param row Row 数据库行
     * @return Job 任务
     */
    private Job mapJob(Row row) {
        List<int[]> ranges = new ArrayList<>();
        for (Object item : JSON.parseArray(row.get("ranges", String.class))) {
            JSONArray range = (JSONArray) item;
            ranges.add(new int[]{range.getIntValue(0), range.getIntValue(1)});
        }
        OffsetDateTime createdAt = row.get("created_at", OffsetDateTime.class);
        return new Job(row.get("id", String.class), row.get("project_id", String.class), row.get("document_id", String.class),
                row.get("user_id", Long.class), row.get("client_request_id", String.class), row.get("model_value", String.class),
                row.get("model_config_id", String.class), JSON.parseArray(row.get("section_ids", String.class), String.class), ranges,
                row.get("billable_chars", Integer.class), row.get("credits", BigDecimal.class), row.get("pricing_revision", Long.class),
                row.get("source_revision", Long.class), row.get("status", String.class), row.get("stage", String.class),
                row.get("processed_units", Integer.class), row.get("total_units", Integer.class), row.get("attempt_count", Integer.class),
                row.get("error_message", String.class), Objects.toString(createdAt, null),
                JSON.parseObject(row.get("quick_configuration", String.class), StoryBibleDtos.QuickConfiguration.class),
                row.get("supplement_calls", Integer.class), row.get("initial_batch_count", Integer.class));
    }

    /**
     * 转换条目行。
     * @param row Row 数据库行
     * @return Item 条目
     */
    private Item mapItem(Row row) {
        return new Item(row.get("id", String.class), row.get("project_id", String.class), row.get("document_id", String.class),
                row.get("item_type", String.class), row.get("name", String.class), row.get("summary", String.class),
                JSON.parseObject(row.get("attributes", String.class)), row.get("origin", String.class), row.get("status", String.class),
                Boolean.TRUE.equals(row.get("locked", Boolean.class)), row.get("suggest_for_item_id", String.class),
                row.get("match_key", String.class), row.get("narrative_offset", Integer.class), row.get("story_time", String.class),
                row.get("story_time_status", String.class), row.get("story_order", Integer.class), row.get("revision", Long.class));
    }

    /**
     * 转换条目摘要行。
     * @param row Row 数据库行
     * @return ItemSummary 条目摘要
     */
    private StoryBibleDtos.ItemSummary mapSummary(Row row) {
        Item item = mapItem(row);
        return new StoryBibleDtos.ItemSummary(item.id(), item.itemType(), item.name(), item.summary(), item.attributes(),
                item.origin(), item.status(), item.locked(), item.suggestForItemId(), item.narrativeOffset(), item.storyTime(),
                item.storyTimeStatus(), item.storyOrder(), item.revision(),
                JSON.parseArray(row.get("alias_list", String.class), String.class),
                row.get("evidence_count", Long.class).intValue(), row.get("suggestion_count", Long.class).intValue());
    }

    /**
     * 转换关联行。
     * @param row Row 数据库行
     * @return Link 关联
     */
    private StoryBibleDtos.Link mapLink(Row row) {
        return new StoryBibleDtos.Link(row.get("other_id", String.class), row.get("name", String.class),
                row.get("item_type", String.class), row.get("role", String.class));
    }
}

package com.novanovastudio.repository;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.dto.WholeBookAdaptationDtos.*;
import com.novanovastudio.service.WholeBookAdaptationPlanner;
import java.time.OffsetDateTime;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.r2dbc.core.DatabaseClient;
import org.springframework.stereotype.Repository;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * 全书改编快照、生成单元及阶段认领的数据访问。
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-01 16:00
 */
@Repository
@RequiredArgsConstructor
public class WholeBookAdaptationRepository {
    /** 数据库访问。 */
    private final DatabaseClient databaseClient;
    /** 沿用现有事实映射，避免复制实体读取逻辑。 */
    private final StoryBibleRepository storyBibleRepository;
    /** 不可变输入及人工确认规划。 */
    public record Workflow(String jobId, long revision, List<StoryBibleRepository.Item> facts,
                           List<JSONObject> links, JSONObject entityMapping, Strategy strategy,
                           List<Slot> slots, List<String> episodeIds, int unitPrice) { }
    /** 已计划或已完成的生成单元。 */
    public record Unit(String key, String phase, String stage, int sequence, JSONObject input,
                       JSONObject output, String draftId, String chargeId, OffsetDateTime completedAt) { }

    /**
     * 读取已确认事实，排除建议项并按原文顺序稳定排序。
     * @param projectId String 项目标识
     * @return Flux<Item> 全部事实
     */
    public Flux<StoryBibleRepository.Item> facts(String projectId) {
        return databaseClient.sql("SELECT id FROM story_bible_items WHERE project_id=:project AND status='confirmed' AND suggest_for_item_id IS NULL ORDER BY narrative_offset NULLS LAST,id")
                .bind("project", projectId).map((row, metadata) -> row.get("id", String.class)).all()
                .concatMap(id -> storyBibleRepository.getItem(projectId, id));
    }
    /**
     * 读取事实关联用于逐集选择人物与地点。
     * @param projectId String 项目标识
     * @return Flux<JSONObject> 关联快照
     */
    public Flux<JSONObject> links(String projectId) {
        return databaseClient.sql("SELECT l.item_id,l.related_item_id,l.role FROM story_bible_links l JOIN story_bible_items i ON i.id=l.item_id JOIN story_bible_items r ON r.id=l.related_item_id WHERE i.project_id=:project AND r.project_id=:project AND i.status='confirmed' AND r.status='confirmed' AND i.suggest_for_item_id IS NULL AND r.suggest_for_item_id IS NULL ORDER BY l.item_id,l.related_item_id,l.role")
                .bind("project", projectId).map((row, metadata) -> JSONObject.of("itemId", row.get("item_id", String.class),
                        "relatedItemId", row.get("related_item_id", String.class), "role", row.get("role", String.class))).all();
    }
    /**
     * 判断任务是否属于逐集正文批量，用于队列分发执行器。
     * <p>
     * 全书改编与正文批量共用任务表与工作流快照，只有正文批量会写入目标分集，
     * 因此用目标分集是否为空区分，而不是新增任务类型列。
     *
     * @param jobId String 任务标识
     * @return Mono&lt;Boolean&gt; 是否为正文批量任务
     */
    public Mono<Boolean> isEpisodeBodies(String jobId) {
        return databaseClient.sql("SELECT jsonb_array_length(episode_ids) > 0 AS bodies FROM novel_adaptation_workflows WHERE job_id=:job")
                .bind("job", jobId).map((row, metadata) -> Boolean.TRUE.equals(row.get("bodies", Boolean.class)))
                .one().defaultIfEmpty(Boolean.FALSE);
    }

    /**
     * 判断任务是否属于全书改编流程，用于队列分发新旧执行器。
     * @param jobId String 任务标识
     * @return Mono&lt;Boolean&gt; 是否存在工作流快照
     */
    public Mono<Boolean> exists(String jobId) {
        return databaseClient.sql("SELECT 1 FROM novel_adaptation_workflows WHERE job_id=:job").bind("job", jobId)
                .map((row, metadata) -> Boolean.TRUE).one().defaultIfEmpty(Boolean.FALSE);
    }
    /**
     * 创建工作流输入，调用前置于任务创建事务中。
     * @param workflow Workflow 全书输入快照
     * @return Mono<Void> 保存结果
     */
    public Mono<Void> insert(Workflow workflow) {
        // 分集标识必须单独绑定：记录组件没有 getter，序列化整个 Workflow 会把它丢成空数组，
        // 队列据此判断是否正文批量任务，丢了会让任务被派给全书改编执行器。
        return databaseClient.sql("INSERT INTO novel_adaptation_workflows(job_id,base_revision,fact_snapshot,link_snapshot,entity_mapping,episode_ids,unit_price) VALUES (:job,:revision,CAST(:facts AS jsonb),CAST(:links AS jsonb),CAST(:mapping AS jsonb),CAST(:episodes AS jsonb),:price)")
                .bind("job", workflow.jobId()).bind("revision", workflow.revision()).bind("facts", JSON.toJSONString(workflow.facts()))
                .bind("links", JSON.toJSONString(workflow.links())).bind("mapping", workflow.entityMapping().toJSONString())
                .bind("episodes", JSON.toJSONString(workflow.episodeIds()))
                .bind("price", workflow.unitPrice()).fetch().rowsUpdated().then();
    }
    /**
     * 读取工作流快照。
     * @param jobId String 任务标识
     * @return Mono<Workflow> 输入快照
     */
    public Mono<Workflow> find(String jobId) {
        return databaseClient.sql("SELECT * FROM novel_adaptation_workflows WHERE job_id=:job").bind("job", jobId)
                .map((row, metadata) -> new Workflow(jobId, row.get("base_revision", Long.class),
                        JSON.parseArray(RowMappers.jsonText(row, "fact_snapshot"), StoryBibleRepository.Item.class),
                        JSON.parseArray(RowMappers.jsonText(row, "link_snapshot"), JSONObject.class),
                        JSON.parseObject(RowMappers.jsonText(row, "entity_mapping")),
                        JSON.parseObject(RowMappers.jsonText(row, "strategy"), Strategy.class),
                        JSON.parseArray(RowMappers.jsonText(row, "episode_slots"), Slot.class),
                        JSON.parseArray(RowMappers.jsonText(row, "episode_ids"), String.class),
                        row.get("unit_price", Integer.class))).one();
    }
    /**
     * 持久化阶段单元，报价确认事务与预扣共用规划。
     * @param jobId String 任务
     * @param phase String 阶段
     * @param units List<Unit> 服务端生成计划
     * @param chargeId String 预扣标识
     * @return Mono<Void> 保存结果
     */
    public Mono<Void> plan(String jobId, String phase, List<WholeBookAdaptationPlanner.Unit> units, String chargeId) {
        return Flux.range(0, units.size()).concatMap(index -> {
            var unit = units.get(index);
            return databaseClient.sql("INSERT INTO novel_adaptation_units(job_id,unit_key,phase,stage,sequence,input_snapshot,charge_id) VALUES (:job,:key,:phase,:stage,:sequence,CAST(:input AS jsonb),:charge)")
                    .bind("job", jobId).bind("key", unit.key()).bind("phase", phase).bind("stage", unit.stage())
                    .bind("sequence", index).bind("input", unit.input().toJSONString()).bind("charge", chargeId).fetch().rowsUpdated();
        }).then();
    }
    /**
     * 读取全部单元，恢复以成功输出判断。
     * @param jobId String 任务标识
     * @return Flux<Unit> 单元
     */
    public Flux<Unit> units(String jobId) {
        return databaseClient.sql("SELECT * FROM novel_adaptation_units WHERE job_id=:job ORDER BY CASE phase WHEN 'materials' THEN 0 WHEN 'planning' THEN 1 ELSE 2 END,sequence")
                .bind("job", jobId).map((row, metadata) -> new Unit(row.get("unit_key", String.class), row.get("phase", String.class),
                        row.get("stage", String.class), row.get("sequence", Integer.class), JSON.parseObject(RowMappers.jsonText(row, "input_snapshot")),
                        JSON.parseObject(RowMappers.jsonText(row, "output_snapshot")), row.get("draft_id", String.class),
                        row.get("charge_id", String.class), row.get("completed_at", OffsetDateTime.class))).all();
    }
    /**
     * 原子保存成功输出并再次验证任务仍运行，取消后不结算迟到产物。
     * @param jobId String 任务
     * @param unit Unit 单元
     * @param output JSONObject 校验输出
     * @param draftId String 可选草稿
     * @return Mono<Boolean> 是否成功写入
     */
    public Mono<Boolean> complete(String jobId, Unit unit, JSONObject output, String draftId) {
        var spec = databaseClient.sql("UPDATE novel_adaptation_units SET output_snapshot=CAST(:output AS jsonb),draft_id=:draft,completed_at=CURRENT_TIMESTAMP WHERE job_id=:job AND unit_key=:key AND output_snapshot IS NULL AND EXISTS(SELECT 1 FROM novel_adaptation_jobs WHERE id=:job AND status='running')")
                .bind("job", jobId).bind("key", unit.key()).bind("output", output.toJSONString());
        spec = draftId == null ? spec.bindNull("draft", String.class) : spec.bind("draft", draftId);
        return spec.fetch().rowsUpdated().map(count -> count == 1);
    }
    /**
     * 锁定任务行，将完成保存、取消和确认操作串行化。
     * @param jobId String 任务
     * @return Mono<String> 当前状态
     */
    public Mono<String> lock(String jobId) {
        return databaseClient.sql("SELECT status FROM novel_adaptation_jobs WHERE id=:job FOR UPDATE").bind("job", jobId)
                .map((row, metadata) -> row.get("status", String.class)).one();
    }
    /**
     * 在保存与替换事务中锁定项目修订，避免校验后人工修改。
     * @param projectId String 项目
     * @return Mono<Long> 已锁定修订
     */
    public Mono<Long> lockProject(String projectId) {
        return databaseClient.sql("SELECT revision FROM script_projects WHERE id=:project FOR UPDATE")
                .bind("project", projectId).map((row, metadata) -> row.get("revision", Long.class)).one();
    }
    /**
     * 记录全局策略，保持为待人工确认结果。
     * @param jobId String 任务
     * @param strategy Strategy 统一策略
     * @return Mono<Void> 保存结果
     */
    public Mono<Void> strategy(String jobId, Strategy strategy) {
        return databaseClient.sql("UPDATE novel_adaptation_workflows SET strategy=CAST(:strategy AS jsonb) WHERE job_id=:job")
                .bind("job", jobId).bind("strategy", JSON.toJSONString(strategy)).fetch().rowsUpdated().then();
    }
    /**
     * 固定分集与生成基线。
     * @param jobId String 任务
     * @param revision long 项目基线
     * @param slots List<Slot> 固定分集
     * @return Mono<Void> 保存结果
     */
    public Mono<Void> configuration(String jobId, long revision, List<Slot> slots) {
        return databaseClient.sql("UPDATE novel_adaptation_workflows SET base_revision=:revision,episode_slots=CAST(:slots AS jsonb) WHERE job_id=:job")
                .bind("job", jobId).bind("revision", revision).bind("slots", JSON.toJSONString(slots)).fetch().rowsUpdated().then();
    }
    /**
     * 逐集正文批量的目标分集与生成基线，与固定分集分开保存。
     * @param jobId String 任务
     * @param revision long 项目基线
     * @param episodeIds List&lt;String&gt; 目标分集标识，顺序即生成顺序
     * @return Mono&lt;Void&gt; 保存结果
     */
    public Mono<Void> episodeSlots(String jobId, long revision, List<String> episodeIds) {
        return databaseClient.sql("UPDATE novel_adaptation_workflows SET base_revision=:revision,episode_ids=CAST(:episodes AS jsonb) WHERE job_id=:job")
                .bind("job", jobId).bind("revision", revision).bind("episodes", JSON.toJSONString(episodeIds))
                .fetch().rowsUpdated().then();
    }
    /**
     * 持久化逐集正文单元，已成功单元保持原样，未完成单元更新预扣标识后继续。
     * <p>
     * 重复规划同一批分集不能整体重插：已完成单元的输出是唯一成功依据，覆盖会让续跑重复扣费。
     *
     * @param jobId String 任务
     * @param phase String 阶段
     * @param stage String 单元阶段名
     * @param episodeIds List&lt;String&gt; 目标分集标识，顺序即生成顺序
     * @param chargeId String 预扣标识
     * @return Mono&lt;Void&gt; 保存结果
     */
    public Mono<Void> planEpisodes(String jobId, String phase, String stage, List<String> episodeIds, String chargeId) {
        return Flux.range(0, episodeIds.size()).concatMap(index -> databaseClient.sql(
                        "INSERT INTO novel_adaptation_units(job_id,unit_key,phase,stage,sequence,input_snapshot,charge_id) "
                                + "VALUES (:job,:key,:phase,:stage,:sequence,CAST(:input AS jsonb),:charge) "
                                + "ON CONFLICT (job_id,unit_key) DO UPDATE SET charge_id=EXCLUDED.charge_id "
                                + "WHERE novel_adaptation_units.output_snapshot IS NULL")
                .bind("job", jobId).bind("key", "episode:" + episodeIds.get(index)).bind("phase", phase)
                .bind("stage", stage).bind("sequence", index)
                .bind("input", JSONObject.of("episodeId", episodeIds.get(index)).toJSONString())
                .bind("charge", chargeId).fetch().rowsUpdated()).then();
    }
    /**
     * 保存逐集正文的生成产出，此时单元只完成生成，还没有写入正式剧本。
     * @param jobId String 任务
     * @param unit Unit 单元
     * @param draftId String 待审草稿
     * @return Mono&lt;Boolean&gt; 是否成功写入
     */
    public Mono<Boolean> generate(String jobId, Unit unit, String draftId) {
        return databaseClient.sql("UPDATE novel_adaptation_units SET output_snapshot=CAST(:output AS jsonb),draft_id=:draft "
                        + "WHERE job_id=:job AND unit_key=:key AND output_snapshot IS NULL "
                        + "AND EXISTS(SELECT 1 FROM novel_adaptation_jobs WHERE id=:job AND status='running')")
                .bind("job", jobId).bind("key", unit.key())
                .bind("output", JSONObject.of("draftId", draftId).toJSONString()).bind("draft", draftId)
                .fetch().rowsUpdated().map(count -> count == 1);
    }

    /**
     * 标记单元已完成写入，逐集正文以它为最终成功依据，续跑不会重复写入。
     * @param jobId String 任务
     * @param unit Unit 单元
     * @return Mono&lt;Boolean&gt; 是否成功标记
     */
    public Mono<Boolean> markApplied(String jobId, Unit unit) {
        return databaseClient.sql("UPDATE novel_adaptation_units SET completed_at=CURRENT_TIMESTAMP "
                        + "WHERE job_id=:job AND unit_key=:key AND output_snapshot IS NOT NULL AND completed_at IS NULL "
                        + "AND EXISTS(SELECT 1 FROM novel_adaptation_jobs WHERE id=:job AND status='running')")
                .bind("job", jobId).bind("key", unit.key())
                .fetch().rowsUpdated().map(count -> count == 1);
    }

    /**
     * 读取逐集正文批量的任务修订基线，供前端提示草稿是否基于最新内容。
     * @param jobId String 任务
     * @return Mono&lt;Long&gt; 基线修订号
     */
    public Mono<Long> baseRevision(String jobId) {
        return databaseClient.sql("SELECT base_revision FROM novel_adaptation_workflows WHERE job_id=:job")
                .bind("job", jobId).map((row, metadata) -> row.get("base_revision", Long.class)).one();
    }

    /**
     * 统计指定阶段已规划的单元数，用于续跑时校准总进度。
     * @param jobId String 任务
     * @param phase String 阶段
     * @return Mono&lt;Integer&gt; 单元数
     */
    public Mono<Integer> countUnits(String jobId, String phase) {
        return databaseClient.sql("SELECT COUNT(*) AS total FROM novel_adaptation_units WHERE job_id=:job AND phase=:phase")
                .bind("job", jobId).bind("phase", phase)
                .map((row, metadata) -> row.get("total", Integer.class)).one();
    }

    /**
     * 把已完成单元的输出作为生成依据，续跑时不能因为跳过而丢依赖。
     * @param jobId String 任务
     * @param phase String 阶段
     * @param stage String 单元阶段名
     * @return Flux&lt;JSONObject&gt; 已完成输出，按执行顺序
     */
    public Flux<JSONObject> completedOutputs(String jobId, String phase, String stage) {
        return databaseClient.sql("SELECT output_snapshot::text AS output FROM novel_adaptation_units "
                        + "WHERE job_id=:job AND phase=:phase AND stage=:stage AND output_snapshot IS NOT NULL ORDER BY sequence")
                .bind("job", jobId).bind("phase", phase).bind("stage", stage)
                .map((row, metadata) -> JSON.parseObject(row.get("output", String.class))).all();
    }

    /**
     * 读取项目最近一次已应用任务的指定阶段单元输出。
     * <p>
     * 逐集正文批量是独立任务，单元按 job_id 归属：拿正文任务自己的 jobId 查规划阶段的单元永远查不到，
     * 事件取舍结果会整批落空。这里改为按项目回溯，取最近一次「应用替换」已完成（status=completed）
     * 的任务，也就是已经把分集规划写进正式项目的那一次。
     *
     * @param projectId String 剧本项目标识
     * @param phase String 阶段
     * @param stage String 单元阶段名
     * @return Flux&lt;JSONObject&gt; 该任务已完成输出，按执行顺序
     */
    public Flux<JSONObject> latestCompletedOutputs(String projectId, String phase, String stage) {
        return databaseClient.sql("SELECT output_snapshot::text AS output FROM novel_adaptation_units "
                        + "WHERE phase=:phase AND stage=:stage AND output_snapshot IS NOT NULL AND job_id=("
                        + "SELECT id FROM novel_adaptation_jobs WHERE project_id=:project AND phase=:phase "
                        + "AND status='completed' ORDER BY created_at DESC LIMIT 1) ORDER BY sequence")
                .bind("project", projectId).bind("phase", phase).bind("stage", stage)
                .map((row, metadata) -> JSON.parseObject(row.get("output", String.class))).all();
    }

    /**
     * 清理本阶段没有成功输出的单元，供重新规划目标范围时避免残留旧目标。
     * @param jobId String 任务
     * @param phase String 阶段
     * @return Mono&lt;Void&gt; 删除结果
     */
    public Mono<Void> removePendingUnits(String jobId, String phase) {
        return databaseClient.sql("DELETE FROM novel_adaptation_units WHERE job_id=:job AND phase=:phase AND output_snapshot IS NULL")
                .bind("job", jobId).bind("phase", phase).fetch().rowsUpdated().then();
    }
    /**
     * 进入下一阶段或失败续跑，费用只包含本次未完成单元。
     * @param job Job 当前任务
     * @param phase String 目标阶段
     * @param calls int 本次调用数
     * @param credits int 本次积分
     * @return Mono<Boolean> 是否认领成功
     */
    public Mono<Boolean> advance(NovelAdaptationJobRepository.Job job, String phase, int calls, int credits) {
        return databaseClient.sql("UPDATE novel_adaptation_jobs SET phase=:phase,stage=:stage,status='queued',total_units=:calls,estimated_calls=:calls,processed_units=0,settled_calls=0,credits=:credits,retry_count=retry_count+1,error_message='',lease_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=:job AND status=:status AND phase=:previous AND retry_count=:attempt")
                .bind("job", job.id()).bind("phase", phase).bind("stage", "materials".equals(phase) ? "material" : "planning".equals(phase) ? "overview" : "episode")
                .bind("calls", calls).bind("credits", credits).bind("status", job.status()).bind("previous", job.phase()).bind("attempt", job.retryCount())
                .fetch().rowsUpdated().map(count -> count == 1);
    }
    /**
     * 为失败阶段的未完成单元绑定新的计费尝试，成功单元不变。
     * @param jobId String 任务
     * @param phase String 阶段
     * @param chargeId String 新预扣标识
     * @return Mono<Void> 更新结果
     */
    public Mono<Void> reassign(String jobId, String phase, String chargeId) {
        return databaseClient.sql("UPDATE novel_adaptation_units SET charge_id=:charge WHERE job_id=:job AND phase=:phase AND output_snapshot IS NULL")
                .bind("job", jobId).bind("phase", phase).bind("charge", chargeId).fetch().rowsUpdated().then();
    }
    /**
     * 使被替换的旧大纲、分集及正文来源失效，历史记录仍保留。
     * @param projectId String 项目
     * @return Mono<Void> 更新结果
     */
    public Mono<Void> deactivateSources(String projectId) {
        return databaseClient.sql("UPDATE novel_adaptation_sources SET active=FALSE WHERE project_id=:project AND target_type IN ('overview','outline','episode','scene')")
                .bind("project", projectId).fetch().rowsUpdated().then();
    }
}

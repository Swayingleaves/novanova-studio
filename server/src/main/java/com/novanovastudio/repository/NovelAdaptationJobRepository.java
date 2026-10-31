package com.novanovastudio.repository;

import java.math.BigDecimal;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import io.r2dbc.spi.Row;
import java.time.OffsetDateTime;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.r2dbc.core.DatabaseClient;
import org.springframework.stereotype.Repository;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * 小说改编一键流水线任务的数据访问。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-09-29 15:00
 */
@Repository
@RequiredArgsConstructor
public class NovelAdaptationJobRepository {

    /** 数据库访问。 */
    private final DatabaseClient databaseClient;

    /** 任务行。 */
    public record Job(String id, String projectId, long userId, String clientRequestId, String modelValue,
                      String modelConfigId, JSONObject settings, List<String> factIds, String phase, String stage,
                      String status, int totalUnits, int processedUnits, int estimatedCalls, int settledCalls,
                      BigDecimal credits, String errorMessage, OffsetDateTime createdAt, int retryCount) { }

    /** 查询列，保持与映射顺序一致。 */
    private static final String COLUMNS = "id,project_id,user_id,client_request_id,model_value,model_config_id,"
            + "settings,fact_ids,phase,stage,status,total_units,processed_units,estimated_calls,settled_calls,"
            + "credits,error_message,created_at,retry_count";

    /**
     * 创建任务，重复的客户端请求标识不重复插入。
     *
     * @param job Job 待创建的任务
     * @return Mono<Void> 创建结果
     */
    public Mono<Void> insert(Job job) {
        return databaseClient.sql("INSERT INTO novel_adaptation_jobs(id,project_id,user_id,client_request_id,"
                        + "model_value,model_config_id,settings,fact_ids,phase,stage,status,total_units,estimated_calls,credits) "
                        + "VALUES (:id,:projectId,:userId,:clientRequestId,:modelValue,:modelConfigId,"
                        + "CAST(:settings AS jsonb),CAST(:factIds AS jsonb),:phase,:stage,'queued',:totalUnits,:estimatedCalls,:credits) "
                        + "ON CONFLICT (team_id,user_id,client_request_id) DO NOTHING")
                .bind("id", job.id()).bind("projectId", job.projectId()).bind("userId", job.userId())
                .bind("clientRequestId", job.clientRequestId()).bind("modelValue", job.modelValue())
                .bind("modelConfigId", job.modelConfigId())
                .bind("settings", JSON.toJSONString(job.settings()))
                .bind("factIds", JSON.toJSONString(job.factIds()))
                .bind("phase", job.phase()).bind("stage", job.stage())
                .bind("totalUnits", job.totalUnits()).bind("estimatedCalls", job.estimatedCalls())
                .bind("credits", job.credits())
                .fetch().rowsUpdated().then();
    }

    /**
     * 按稳定客户端请求标识幂等创建任务，重复提交时保留原任务并刷新设置快照。
     *
     * @param job Job 待创建的任务
     * @return Mono&lt;Void&gt; 创建结果
     */
    public Mono<Void> save(Job job) {
        return databaseClient.sql("INSERT INTO novel_adaptation_jobs(id,project_id,user_id,client_request_id,"
                        + "model_value,model_config_id,settings,fact_ids,phase,stage,status,total_units,estimated_calls,credits) "
                        + "VALUES (:id,:projectId,:userId,:clientRequestId,:modelValue,:modelConfigId,"
                        + "CAST(:settings AS jsonb),CAST(:factIds AS jsonb),:phase,:stage,'queued',:totalUnits,:estimatedCalls,:credits) "
                        + "ON CONFLICT (id) DO UPDATE SET settings=EXCLUDED.settings")
                .bind("id", job.id()).bind("projectId", job.projectId()).bind("userId", job.userId())
                .bind("clientRequestId", job.clientRequestId()).bind("modelValue", job.modelValue())
                .bind("modelConfigId", job.modelConfigId())
                .bind("settings", JSON.toJSONString(job.settings()))
                .bind("factIds", JSON.toJSONString(job.factIds()))
                .bind("phase", job.phase()).bind("stage", job.stage())
                .bind("totalUnits", job.totalUnits()).bind("estimatedCalls", job.estimatedCalls())
                .bind("credits", job.credits())
                .fetch().rowsUpdated().then();
    }

    /**
     * 按客户端请求标识读取任务，用于幂等提交。
     *
     * @param userId Long 用户标识
     * @param clientRequestId String 客户端请求标识
     * @return Mono<Job> 任务
     */
    public Mono<Job> findByRequest(long userId, String clientRequestId) {
        return databaseClient.sql("SELECT " + COLUMNS + " FROM novel_adaptation_jobs WHERE user_id=:userId AND client_request_id=:clientRequestId")
                .bind("userId", userId).bind("clientRequestId", clientRequestId)
                .map((row, metadata) -> mapJob(row)).one();
    }

    /**
     * 读取项目最近一次指定阶段的任务，用于刷新后恢复正文批量的进度卡片。
     *
     * @param projectId String 项目标识
     * @param phase String 流水线阶段
     * @return Mono&lt;Job&gt; 最近任务
     */
    public Mono<Job> findLatestByPhase(String projectId, String phase) {
        return databaseClient.sql("SELECT " + COLUMNS + " FROM novel_adaptation_jobs WHERE project_id=:projectId AND phase=:phase "
                        + "ORDER BY created_at DESC LIMIT 1")
                .bind("projectId", projectId).bind("phase", phase).map((row, metadata) -> mapJob(row)).one();
    }

    /**
     * 只更新已处理单元数，保留当前单元阶段名。
     * <p>
     * 进度写入不能顺带改写阶段：同一阶段内各分集的单元阶段名一致，但写入时点可能晚于阶段推进，
     * 用通用更新会把已经推进的阶段回退成上一个名字。
     *
     * @param jobId String 任务标识
     * @param processedUnits int 已完成调用数
     * @param totalUnits int 已规划调用数
     * @return Mono&lt;Void&gt; 更新结果
     */
    public Mono<Void> progress(String jobId, int processedUnits, int totalUnits) {
        return databaseClient.sql("UPDATE novel_adaptation_jobs SET processed_units=:processedUnits,"
                        + "total_units=:totalUnits,settled_calls=:processedUnits,updated_at=CURRENT_TIMESTAMP "
                        + "WHERE id=:id AND status='running'")
                .bind("id", jobId).bind("processedUnits", processedUnits).bind("totalUnits", totalUnits)
                .fetch().rowsUpdated().then();
    }

    /**
     * 推进任务到指定阶段并重置进度，只允许从排队中或运行中转入。
     *
     * @param jobId String 任务标识
     * @param phase String 目标阶段
     * @return Mono&lt;Boolean&gt; 是否推进成功
     */
    public Mono<Boolean> stagePhase(String jobId, String phase) {
        return databaseClient.sql("UPDATE novel_adaptation_jobs SET phase=:phase,status='running',"
                        + "processed_units=0,settled_calls=0,updated_at=CURRENT_TIMESTAMP "
                        + "WHERE id=:id AND status IN ('queued','running')")
                .bind("id", jobId).bind("phase", phase).fetch().rowsUpdated().map(count -> count == 1);
    }

    /**
     * 读取任务。
     *
     * @param jobId String 任务标识
     * @return Mono<Job> 任务
     */
    public Mono<Job> find(String jobId) {
        return databaseClient.sql("SELECT " + COLUMNS + " FROM novel_adaptation_jobs WHERE id=:id")
                .bind("id", jobId).map((row, metadata) -> mapJob(row)).one();
    }

    /**
     * 读取项目当前未结束的任务，包含等待人工确认的阶段。
     *
     * @param projectId String 项目标识
     * @return Mono<Job> 活跃任务
     */
    public Mono<Job> findActive(String projectId) {
        return databaseClient.sql("SELECT " + COLUMNS + " FROM novel_adaptation_jobs WHERE project_id=:projectId "
                        + "AND status IN ('queued','running','awaiting') ORDER BY created_at DESC LIMIT 1")
                .bind("projectId", projectId).map((row, metadata) -> mapJob(row)).one();
    }

    /**
     * 优先读取进行中的任务，否则读取最近任务，保证失败卡片刷新后仍可恢复。
     * @param projectId String 项目标识
     * @return Mono&lt;Job&gt; 当前或最近任务
     */
    public Mono<Job> findLatest(String projectId) {
        return databaseClient.sql("SELECT " + COLUMNS + " FROM novel_adaptation_jobs WHERE project_id=:projectId "
                        + "ORDER BY CASE WHEN status IN ('queued','running','awaiting') THEN 0 ELSE 1 END,created_at DESC LIMIT 1")
                .bind("projectId", projectId).map((row, metadata) -> mapJob(row)).one();
    }

    /**
     * 按预期续跑次数认领失败任务，保留阶段并校准草稿进度和剩余预算。
     * @param job Job 报价时的失败任务
     * @param completedCalls int 已持久化的成功调用数
     * @param remainingCalls int 后续预计调用数
     * @param totalCredits int 按原单价计算的完整计划积分
     * @return Mono&lt;Boolean&gt; 是否成功转为排队状态
     */
    public Mono<Boolean> retry(Job job, int completedCalls, int remainingCalls, BigDecimal totalCredits) {
        return databaseClient.sql("UPDATE novel_adaptation_jobs SET status='queued',error_message='',lease_until=NULL,"
                        + "retry_count=retry_count+1,processed_units=:completed,settled_calls=:completed,"
                        + "total_units=:total,estimated_calls=:total,credits=:credits,updated_at=CURRENT_TIMESTAMP "
                        + "WHERE id=:id AND status='failed' AND retry_count=:retryCount")
                .bind("id", job.id()).bind("retryCount", job.retryCount()).bind("completed", completedCalls)
                .bind("total", completedCalls + remainingCalls).bind("credits", totalCredits)
                .fetch().rowsUpdated().map(count -> count == 1);
    }

    /**
     * 读取待恢复的任务，用于服务重启后继续执行。
     *
     * @return Flux<Job> 任务列表
     */
    public Flux<Job> listRecoverable() {
        return databaseClient.sql("SELECT " + COLUMNS + " FROM novel_adaptation_jobs "
                        + "WHERE status='queued' OR (status='running' AND (lease_until IS NULL OR lease_until<CURRENT_TIMESTAMP))")
                .map((row, metadata) -> mapJob(row)).all();
    }

    /**
     * 抢占执行租约，排队中或租约过期的任务可被认领。
     *
     * @param jobId String 任务标识
     * @param leaseSeconds int 租约秒数
     * @return Mono<Boolean> 是否认领成功
     */
    public Mono<Boolean> claim(String jobId, int leaseSeconds) {
        return databaseClient.sql("UPDATE novel_adaptation_jobs SET status='running',"
                        + "lease_until=CURRENT_TIMESTAMP+make_interval(secs=>:lease),updated_at=CURRENT_TIMESTAMP "
                        + "WHERE id=:id AND (status='queued' OR (status='running' AND (lease_until IS NULL OR lease_until<CURRENT_TIMESTAMP)))")
                .bind("id", jobId).bind("lease", leaseSeconds).fetch().rowsUpdated().map(count -> count > 0);
    }

    /**
     * 续期执行租约。
     *
     * @param jobId String 任务标识
     * @param leaseSeconds int 租约秒数
     * @return Mono<Void> 更新结果
     */
    public Mono<Void> renewLease(String jobId, int leaseSeconds) {
        return databaseClient.sql("UPDATE novel_adaptation_jobs SET lease_until=CURRENT_TIMESTAMP+make_interval(secs=>:lease) "
                        + "WHERE id=:id AND status='running'")
                .bind("id", jobId).bind("lease", leaseSeconds).fetch().rowsUpdated().then();
    }

    /**
     * 读取任务状态，用于执行中检测取消。
     *
     * @param jobId String 任务标识
     * @return Mono<String> 状态
     */
    public Mono<String> status(String jobId) {
        return databaseClient.sql("SELECT status FROM novel_adaptation_jobs WHERE id=:id")
                .bind("id", jobId).map((row, metadata) -> row.get("status", String.class)).one();
    }

    /**
     * 更新当前阶段与调用进度。
     *
     * @param jobId String 任务标识
     * @param phase String 流水线阶段
     * @param stage String 改编阶段
     * @param processedUnits int 已完成调用数
     * @param totalUnits int 已规划调用数
     * @return Mono<Void> 更新结果
     */
    public Mono<Void> updateProgress(String jobId, String phase, String stage, int processedUnits, int totalUnits) {
        return databaseClient.sql("UPDATE novel_adaptation_jobs SET phase=:phase,stage=:stage,"
                        + "processed_units=:processedUnits,total_units=:totalUnits,settled_calls=:processedUnits,updated_at=CURRENT_TIMESTAMP "
                        + "WHERE id=:id AND status='running'")
                .bind("id", jobId).bind("phase", phase).bind("stage", stage)
                .bind("processedUnits", processedUnits).bind("totalUnits", totalUnits)
                .fetch().rowsUpdated().then();
    }

    /**
     * 进入等待人工确认并释放租约，此时任务不再被任何执行者续期。
     *
     * @param jobId String 任务标识
     * @param phase String 流水线阶段
     * @param stage String 改编阶段
     * @param processedUnits int 已完成调用数
     * @return Mono<Boolean> 是否成功进入等待
     */
    public Mono<Boolean> await(String jobId, String phase, String stage, int processedUnits) {
        return databaseClient.sql("UPDATE novel_adaptation_jobs SET status='awaiting',phase=:phase,stage=:stage,"
                        + "processed_units=:processedUnits,settled_calls=:processedUnits,lease_until=NULL,updated_at=CURRENT_TIMESTAMP "
                        + "WHERE id=:id AND status='running'")
                .bind("id", jobId).bind("phase", phase).bind("stage", stage).bind("processedUnits", processedUnits)
                .fetch().rowsUpdated().map(count -> count > 0);
    }

    /**
     * 人工确认后把等待中的任务重新排队并推进到下一阶段，由调度器继续执行。
     *
     * @param jobId String 任务标识
     * @param phase String 下一个流水线阶段
     * @return Mono<Boolean> 是否成功重新排队
     */
    public Mono<Boolean> resume(String jobId, String phase) {
        return databaseClient.sql("UPDATE novel_adaptation_jobs SET status='queued',phase=:phase,updated_at=CURRENT_TIMESTAMP "
                        + "WHERE id=:id AND status='awaiting'")
                .bind("id", jobId).bind("phase", phase).fetch().rowsUpdated().map(count -> count > 0);
    }

    /**
     * 人工确认后推进到下一阶段并登记本阶段预算，只允许从等待确认状态转入。
     * <p>
     * 阶段推进递增续跑计数，让前端能感知停点已推进；credits 覆盖为本阶段预扣额，
     * 各阶段金额由单元上的预扣标识分别核算与退款。
     *
     * @param jobId String 任务标识
     * @param phase String 下一阶段
     * @param totalUnits int 本阶段规划单元数
     * @param credits int 本阶段预扣积分
     * @return Mono&lt;Boolean&gt; 是否成功推进
     */
    public Mono<Boolean> stage(String jobId, String phase, int totalUnits, BigDecimal credits) {
        return databaseClient.sql("UPDATE novel_adaptation_jobs SET status='queued',phase=:phase,"
                        + "total_units=:totalUnits,estimated_calls=:totalUnits,processed_units=0,settled_calls=0,"
                        + "credits=:credits,retry_count=retry_count+1,updated_at=CURRENT_TIMESTAMP "
                        + "WHERE id=:id AND status='awaiting'")
                .bind("id", jobId).bind("phase", phase).bind("totalUnits", totalUnits).bind("credits", credits)
                .fetch().rowsUpdated().map(count -> count > 0);
    }

    /**
     * 登记失败或取消的任务重新排队，保留全部已完成单元。
     *
     * @param jobId String 任务标识
     * @return Mono&lt;Boolean&gt; 是否重新排队成功
     */
    public Mono<Boolean> requeue(String jobId) {
        return databaseClient.sql("UPDATE novel_adaptation_jobs SET status='queued',error_message='',lease_until=NULL,"
                        + "retry_count=retry_count+1,updated_at=CURRENT_TIMESTAMP "
                        + "WHERE id=:id AND status IN ('failed','canceled')")
                .bind("id", jobId).fetch().rowsUpdated().map(count -> count == 1);
    }

    /**
     * 结束任务，仅允许从运行中或等待确认转入完成、失败或取消。
     *
     * @param jobId String 任务标识
     * @param status String 目标状态
     * @param errorMessage String 失败原因
     * @param settledCalls int 已结算调用数
     * @return Mono<Boolean> 是否成功结束
     */
    public Mono<Boolean> finish(String jobId, String status, String errorMessage, int settledCalls) {
        return databaseClient.sql("UPDATE novel_adaptation_jobs SET status=:status,error_message=:errorMessage,"
                        + "processed_units=:settledCalls,settled_calls=:settledCalls,lease_until=NULL,updated_at=CURRENT_TIMESTAMP "
                        + "WHERE id=:id AND status IN ('queued','running','awaiting')")
                .bind("id", jobId).bind("status", status).bind("errorMessage", errorMessage)
                .bind("settledCalls", settledCalls)
                .fetch().rowsUpdated().map(count -> count > 0);
    }

    /** 映射任务行，jsonb 列必须按文本读取。 */
    private Job mapJob(Row row) {
        return new Job(row.get("id", String.class), row.get("project_id", String.class),
                row.get("user_id", Long.class), row.get("client_request_id", String.class),
                row.get("model_value", String.class), row.get("model_config_id", String.class),
                JSON.parseObject(RowMappers.jsonText(row, "settings")),
                JSON.parseArray(RowMappers.jsonText(row, "fact_ids"), String.class),
                row.get("phase", String.class), row.get("stage", String.class), row.get("status", String.class),
                row.get("total_units", Integer.class), row.get("processed_units", Integer.class),
                row.get("estimated_calls", Integer.class), row.get("settled_calls", Integer.class),
                row.get("credits", BigDecimal.class), row.get("error_message", String.class),
                row.get("created_at", OffsetDateTime.class), row.get("retry_count", Integer.class));
    }
}

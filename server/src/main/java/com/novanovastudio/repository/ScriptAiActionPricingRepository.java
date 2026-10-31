package com.novanovastudio.repository;

import com.alibaba.fastjson2.JSON;
import io.r2dbc.spi.Row;
import java.math.BigDecimal;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.r2dbc.core.DatabaseClient;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.reactive.TransactionalOperator;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * 剧本 AI 助手动作定价仓储，空间可见性由数据库行级权限约束。
 * <p>
 * 一个文本模型对应一组动作价格，保存时整组替换：同一模型的所有动作共享同一个修订号，
 * 因此并发保存靠该修订号判断，而不是逐行动作版本。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-29 10:30
 */
@Repository
@RequiredArgsConstructor
public class ScriptAiActionPricingRepository {

    /** 数据库客户端。 */
    private final DatabaseClient databaseClient;

    /** 事务操作器，整组替换必须在同一事务内完成。 */
    private final TransactionalOperator transactionalOperator;

    /** 保存时提交的单条动作价格。 */
    public record Entry(String actionType, BigDecimal credits) { }

    /** 已保存的单条动作价格。 */
    public record Pricing(String modelConfigId, String actionType, BigDecimal credits, long revision) { }

    /**
     * 列出当前空间可见的全部动作价格。
     *
     * @return Flux&lt;Pricing&gt; 动作价格
     */
    public Flux<Pricing> listPricing() {
        return databaseClient.sql("SELECT model_config_id,action_type,credits,revision FROM script_ai_action_pricing")
                .map((row, metadata) -> mapPricing(row)).all();
    }

    /**
     * 读取单个模型的全部动作价格。
     *
     * @param modelConfigId String 模型配置标识
     * @return Flux&lt;Pricing&gt; 该模型已定价的动作，未配置时为空
     */
    public Flux<Pricing> findPricing(String modelConfigId) {
        return databaseClient.sql("SELECT model_config_id,action_type,credits,revision FROM script_ai_action_pricing WHERE model_config_id=:id")
                .bind("id", modelConfigId).map((row, metadata) -> mapPricing(row)).all();
    }

    /**
     * 按期望修订号整组替换某个模型的动作价格，首次保存要求修订号为零。
     * <p>
     * 事务用 {@code transactional()} 直接包装整条 Mono：不能用 {@code execute(...).next()}，
     * 那会在拿到首个元素后取消上游，触发事务回滚，写入看似成功却一行都不落库。
     *
     * @param modelConfigId String 模型配置标识
     * @param entries List&lt;Entry&gt; 本次要生效的完整动作价格
     * @param expectedRevision long 期望修订号
     * @return Mono&lt;Boolean&gt; 是否保存成功，修订号不一致时为 false
     */
    public Mono<Boolean> savePricing(String modelConfigId, List<Entry> entries, long expectedRevision) {
        Mono<Boolean> operation = currentRevision(modelConfigId)
                .flatMap(current -> current == expectedRevision
                        ? replacePricing(modelConfigId, entries, current + 1).thenReturn(true)
                        : Mono.just(false));
        return operation.as(transactionalOperator::transactional);
    }

    /**
     * 读取该模型当前的修订号，从未定价时为零。
     *
     * @param modelConfigId String 模型配置标识
     * @return Mono&lt;Long&gt; 当前修订号
     */
    private Mono<Long> currentRevision(String modelConfigId) {
        return databaseClient.sql("SELECT COALESCE(MAX(revision),0) AS revision FROM script_ai_action_pricing WHERE model_config_id=:id")
                .bind("id", modelConfigId)
                .map((row, metadata) -> {
                    Long revision = row.get("revision", Long.class);
                    return revision == null ? 0L : revision;
                }).one().defaultIfEmpty(0L);
    }

    /**
     * 删除旧价后整组写入，新写入的行共用同一个修订号。
     *
     * @param modelConfigId String 模型配置标识
     * @param entries List&lt;Entry&gt; 完整动作价格
     * @param revision long 本次写入的修订号
     * @return Mono&lt;Void&gt; 写入完成信号
     */
    private Mono<Void> replacePricing(String modelConfigId, List<Entry> entries, long revision) {
        return databaseClient.sql("DELETE FROM script_ai_action_pricing WHERE model_config_id=:id")
                .bind("id", modelConfigId).fetch().rowsUpdated().then()
                .then(entries.isEmpty() ? Mono.<Void>empty() : insertPricing(modelConfigId, entries, revision));
    }

    /**
     * 用一次数组展开写入全部动作价格，避免逐行往返。
     *
     * @param modelConfigId String 模型配置标识
     * @param entries List&lt;Entry&gt; 完整动作价格
     * @param revision long 本次写入的修订号
     * @return Mono&lt;Void&gt; 写入完成信号
     */
    private Mono<Void> insertPricing(String modelConfigId, List<Entry> entries, long revision) {
        return databaseClient.sql("INSERT INTO script_ai_action_pricing(model_config_id,action_type,credits,revision) "
                        + "SELECT :id,item->>'actionType',(item->>'credits')::numeric,:revision "
                        + "FROM jsonb_array_elements(CAST(:items AS jsonb)) AS item")
                .bind("id", modelConfigId).bind("revision", revision).bind("items", JSON.toJSONString(entries))
                .fetch().rowsUpdated().then();
    }

    /**
     * 映射价格行。
     *
     * @param row 数据库行
     * @return 动作价格
     */
    private Pricing mapPricing(Row row) {
        Long revision = row.get("revision", Long.class);
        return new Pricing(row.get("model_config_id", String.class), row.get("action_type", String.class),
                row.get("credits", BigDecimal.class), revision == null ? 0L : revision);
    }
}

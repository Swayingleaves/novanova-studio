package com.novanovastudio.repository;

import io.r2dbc.spi.Row;
import java.math.BigDecimal;
import lombok.RequiredArgsConstructor;
import org.springframework.r2dbc.core.DatabaseClient;
import org.springframework.stereotype.Repository;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * 漫剧最终提示词专项定价仓储，空间可见性由数据库行级权限约束。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-28 15:00
 */
@Repository
@RequiredArgsConstructor
public class ComicDramaFinalPromptPricingRepository {
    /** 数据库客户端。 */
    private final DatabaseClient databaseClient;

    /**
     * 列出当前空间可见的价格。
     * @return 已配置的价格
     */
    public Flux<Pricing> listPricing() {
        return databaseClient.sql("SELECT model_config_id,credits,revision FROM comic_drama_final_prompt_pricing")
                .map((row, metadata) -> mapPricing(row)).all();
    }

    /**
     * 读取模型的完整价格快照。
     * @param modelConfigId 模型配置标识
     * @return 价格及修订号，未配置时为空
     */
    public Mono<Pricing> findPricing(String modelConfigId) {
        return databaseClient.sql("SELECT model_config_id,credits,revision FROM comic_drama_final_prompt_pricing WHERE model_config_id=:id")
                .bind("id", modelConfigId).map((row, metadata) -> mapPricing(row)).one();
    }

    /**
     * 按期望修订号保存，首次保存要求修订号为零。
     * @param modelConfigId 模型配置标识
     * @param credits 每镜头积分
     * @param expectedRevision 期望价格修订号
     * @return 本次保存后的快照，并发冲突时为空
     */
    public Mono<Pricing> savePricing(String modelConfigId, BigDecimal credits, long expectedRevision) {
        String sql = expectedRevision == 0
                ? "INSERT INTO comic_drama_final_prompt_pricing(model_config_id,credits,revision) VALUES (:id,:credits,1) ON CONFLICT (model_config_id) DO NOTHING"
                : "UPDATE comic_drama_final_prompt_pricing SET credits=:credits,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE model_config_id=:id AND revision=:revision";
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql(sql + " RETURNING model_config_id,credits,revision")
                .bind("id", modelConfigId).bind("credits", credits);
        if (expectedRevision != 0) spec = spec.bind("revision", expectedRevision);
        return spec.map((row, metadata) -> mapPricing(row)).one();
    }

    /**
     * 映射非空价格字段。
     * @param row 数据库行
     * @return 完整价格快照
     */
    private Pricing mapPricing(Row row) {
        return new Pricing(row.get("model_config_id", String.class), row.get("credits", BigDecimal.class),
                row.get("revision", Long.class));
    }

    /** 不可变模型价格快照。 */
    public record Pricing(String modelConfigId, BigDecimal credits, long revision) { }
}

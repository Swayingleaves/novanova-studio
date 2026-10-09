package com.novanovastudio.repository;

import io.r2dbc.spi.Row;
import lombok.RequiredArgsConstructor;
import org.springframework.r2dbc.core.DatabaseClient;
import org.springframework.stereotype.Repository;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * 分集正文生成按文本模型维护的每集积分定价。
 * <p>
 * 一集一次模型调用，因此定价是单一数值而不是按字数分档；未配置的模型不参与报价。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-09 09:20
 */
@Repository
@RequiredArgsConstructor
public class EpisodeBodiesPricingRepository {

    /** 数据库客户端。 */
    private final DatabaseClient databaseClient;

    /**
     * 列出全部定价。
     *
     * @return Flux&lt;Pricing&gt; 定价配置
     */
    public Flux<Pricing> listPricing() {
        return databaseClient.sql("SELECT model_config_id,credits,revision FROM episode_bodies_pricing")
                .map((row, metadata) -> mapPricing(row)).all();
    }

    /**
     * 读取单个模型的定价。
     *
     * @param modelConfigId String 模型配置标识
     * @return Mono&lt;Pricing&gt; 定价配置，未配置时为空
     */
    public Mono<Pricing> findPricing(String modelConfigId) {
        return databaseClient.sql("SELECT model_config_id,credits,revision FROM episode_bodies_pricing WHERE model_config_id=:id")
                .bind("id", modelConfigId).map((row, metadata) -> mapPricing(row)).one();
    }

    /**
     * 按修订号保存定价，首次保存要求修订号为 0。
     *
     * @param modelConfigId String 模型配置标识
     * @param credits int 每集积分
     * @param expectedRevision long 期望修订号
     * @return Mono&lt;Boolean&gt; 是否保存成功
     */
    public Mono<Boolean> savePricing(String modelConfigId, int credits, long expectedRevision) {
        String sql = expectedRevision == 0
                ? "INSERT INTO episode_bodies_pricing(model_config_id,credits,revision) VALUES (:id,:credits,1) ON CONFLICT (model_config_id) DO NOTHING"
                : "UPDATE episode_bodies_pricing SET credits=:credits,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE model_config_id=:id AND revision=:revision";
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql(sql).bind("id", modelConfigId).bind("credits", credits);
        if (expectedRevision != 0) {
            spec = spec.bind("revision", expectedRevision);
        }
        return spec.fetch().rowsUpdated().map(count -> count > 0);
    }

    /** 组装定价行，缺省值兜住理论上不会出现的空列。 */
    private Pricing mapPricing(Row row) {
        Integer credits = row.get("credits", Integer.class);
        Long revision = row.get("revision", Long.class);
        return new Pricing(row.get("model_config_id", String.class), credits == null ? 0 : credits,
                revision == null ? 0L : revision);
    }

    /** 单个模型的每集积分与修订号。 */
    public record Pricing(String modelConfigId, int credits, long revision) { }
}

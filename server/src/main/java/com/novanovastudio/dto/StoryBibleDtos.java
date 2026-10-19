package com.novanovastudio.dto;

import com.alibaba.fastjson2.annotation.JSONField;
import com.novanovastudio.common.CreditAmountWriter;
import java.math.BigDecimal;

import com.alibaba.fastjson2.JSONObject;
import java.util.List;

/**
 * 故事知识库接口、分析任务与Agent结构化输出数据结构。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-09-27 00:00
 */
public final class StoryBibleDtos {
    /** 禁止实例化。 */
    private StoryBibleDtos() { }

    /** 项目标识请求。 */
    public record ProjectRequest(String projectId) { }

    /** 报价请求，章节或场次标识为空表示全书。 */
    public record QuoteRequest(String projectId, String model, List<String> sectionIds) { }

    /** 分析报价。 */
    public record Quote(String model, int billableChars, @jakarta.validation.constraints.Digits(integer = 18, fraction = 6) @JSONField(serializeUsing = CreditAmountWriter.class) BigDecimal credits, int tierMinChars, Integer tierMaxChars,
                        long sourceRevision, long pricingRevision, int estimatedBatches,
                        QuickConfiguration quickConfiguration) { }

    /** 启动分析请求，携带报价快照用于校验。 */
    public record StartRequest(String projectId, String model, List<String> sectionIds, String clientRequestId,
                               @jakarta.validation.constraints.Digits(integer = 18, fraction = 6) @JSONField(serializeUsing = CreditAmountWriter.class) BigDecimal expectedCredits, long expectedSourceRevision, long expectedPricingRevision) { }

    /** 分析任务请求。 */
    public record JobRequest(String projectId, String jobId) { }

    /** 分析任务状态，credits为预扣积分，refundedCredits为已退积分。 */
    public record JobStatus(String jobId, String status, String stage, int processedUnits, int totalUnits,
                            String model, int billableChars, @jakarta.validation.constraints.Digits(integer = 18, fraction = 6) @JSONField(serializeUsing = CreditAmountWriter.class) BigDecimal credits, List<String> sectionIds, String errorMessage,
                            String createdAt, @jakarta.validation.constraints.Digits(integer = 18, fraction = 6) @JSONField(serializeUsing = CreditAmountWriter.class) BigDecimal creditBalance, int supplementCalls,
                            List<AnalysisGap> gaps, @jakarta.validation.constraints.Digits(integer = 18, fraction = 6) @JSONField(serializeUsing = CreditAmountWriter.class) BigDecimal refundedCredits) { }

    /** 分析容量，输入字符上限由管理员按渠道实际能力验证，不能把上下文Token数当作字数。 */
    public record QuickConfiguration(Integer contextWindowTokens, Integer maximumInputCharacters,
                                     Integer maximumOutputTokens, Integer maximumSupplementCalls) { }

    /** 未完成的章节片段，偏移起点含、终点不含。 */
    public record AnalysisGap(String sectionId, String title, int startOffset, int endOffset, String reason) { }

    /** 条目分页查询请求，order为narrative叙事顺序或story故事时间。 */
    public record ListItemsRequest(String projectId, String itemType, String status, String keyword, String order,
                                   Integer page, Integer pageSize) { }

    /** 条目列表项。 */
    public record ItemSummary(String id, String itemType, String name, String summary, JSONObject attributes,
                              String origin, String status, boolean locked, String suggestForItemId,
                              Integer narrativeOffset, String storyTime, String storyTimeStatus, Integer storyOrder,
                              long revision, List<String> aliases, int evidenceCount, int suggestionCount) { }

    /** 条目分页结果。 */
    public record ItemPage(List<ItemSummary> items, long total, int page, int pageSize) { }

    /** 条目别名。 */
    public record Alias(String id, String alias) { }

    /** 条目关联。 */
    public record Link(String relatedItemId, String relatedName, String relatedType, String role) { }

    /** 原文证据，偏移为UTF-16起点含、终点不含。 */
    public record Evidence(String id, String aliasId, int startOffset, int endOffset, String quote) { }

    /** 条目详情。 */
    public record ItemDetail(ItemSummary item, List<Alias> aliases, List<Link> links, List<Link> referencedBy,
                             List<Evidence> evidences, List<ItemDetail> suggestions) { }

    /** 条目操作请求。 */
    public record ItemRequest(String projectId, String itemId, long expectedRevision) { }

    /** 批量确认中的单个条目请求。 */
    public record BatchItemRequest(String itemId, long expectedRevision) { }

    /** 批量确认条目请求。 */
    public record BatchConfirmRequest(String projectId, List<BatchItemRequest> items) { }

    /** 批量确认结果。 */
    public record BatchConfirmResult(List<String> confirmedItemIds, int confirmedCount) { }

    /** 全量确认请求：确认某个条目类型下全部待确认内容，不受分页与筛选影响。 */
    public record BatchConfirmAllRequest(String projectId, String itemType) { }

    /** 条目查询请求。 */
    public record GetItemRequest(String projectId, String itemId) { }

    /** 关联输入。 */
    public record LinkInput(String relatedItemId, String role) { }

    /** 新建或编辑条目请求，itemId为空表示人工新建。 */
    public record SaveItemRequest(String projectId, String itemId, long expectedRevision, String itemType, String name,
                                  String summary, JSONObject attributes, List<String> aliases, List<LinkInput> links,
                                  String storyTime, String storyTimeStatus, Integer storyOrder) { }

    /** 合并人物或地点请求，源条目并入目标条目。 */
    public record MergeRequest(String projectId, String targetItemId, long targetRevision, String sourceItemId,
                               long sourceRevision) { }

    /** 按所选别名与证据拆分人物或地点请求。 */
    public record SplitRequest(String projectId, String itemId, long expectedRevision, String name,
                               List<String> aliasIds, List<String> evidenceIds) { }

    /** 价格档位，maxChars为空表示无上限。 */
    public record PricingTier(Integer minChars, Integer maxChars, @jakarta.validation.constraints.Digits(integer = 18, fraction = 6) @JSONField(serializeUsing = CreditAmountWriter.class) BigDecimal credits) { }

    /** 单个文本模型的价格配置。 */
    public record ModelPricing(String modelConfigId, String model, String displayName, List<PricingTier> tiers,
                               long revision, QuickConfiguration quickConfiguration) { }

    /** 保存价格配置请求。 */
    public record SavePricingRequest(String modelConfigId, long expectedRevision, List<PricingTier> tiers,
                                    QuickConfiguration quickConfiguration) { }

    /** Agent返回的称呼与逐字引用原文。 */
    public record AiMention(String alias, String quote) { }

    /** Agent返回的人物或地点。 */
    public record AiEntity(String name, String summary, List<AiMention> mentions) { }

    /** Agent返回的人物关系。 */
    public record AiRelation(String source, String target, String relationType, String summary, List<String> quotes) { }

    /** Agent返回的事件。 */
    public record AiEvent(String title, String summary, List<String> participants, String location, String storyTime,
                          Boolean storyTimeCertain, List<String> quotes) { }

    /** Agent返回的片段提取结果。 */
    public record SegmentExtraction(List<AiEntity> characters, List<AiEntity> locations, List<AiRelation> relationships,
                                    List<AiEvent> events) { }

    /** 快速分析按输入片段标识返回提取结果，空结果不会被算作已覆盖。 */
    public record SectionExtraction(String sectionKey, SegmentExtraction extraction) { }

    /** 快速分析一批章节的结果，故事线通过本批事件标题引用事件。 */
    public record QuickExtraction(List<SectionExtraction> sections, List<AiStoryline> storylines) { }

    /** Agent返回的故事线。 */
    public record AiStoryline(String name, String summary, List<String> eventKeys) { }

    /** Agent返回的故事线归纳结果。 */
    public record StorylineResult(List<AiStoryline> storylines) { }

    /** 分析过程中的候选证据。 */
    public record CandidateEvidence(int start, int end, String alias, String quote) { }

    /**
     * 分析过程中的候选条目，保存在工作单元结果中用于续跑。
     * attributes中关系保存source、target、relationType，事件保存participants、location、storyTime、storyTimeCertain，
     * 故事线保存eventKeys。
     */
    public record Candidate(String key, String itemType, String name, String summary, List<String> aliases,
                            List<CandidateEvidence> evidences, JSONObject attributes, boolean uncertain) { }
}

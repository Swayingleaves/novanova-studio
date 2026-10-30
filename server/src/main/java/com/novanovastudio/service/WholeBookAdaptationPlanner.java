package com.novanovastudio.service;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.dto.ScriptDtos;
import com.novanovastudio.dto.WholeBookAdaptationDtos.*;
import com.novanovastudio.repository.StoryBibleRepository;
import java.util.*;

/**
 * 全书改编的容量装批、汇总树、固定分集及覆盖校验，报价和执行共用。
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-01 16:00
 */
public final class WholeBookAdaptationPlanner {
    /** 素材与设置装批容量，预留全书策略和调用指令空间。 */
    public static final int INPUT_LIMIT = 60_000;
    /** 单个素材批摘要上限。素材摘要只描述因果、人物变化与阶段转折，压缩比决定汇总树是否需要继续归并。 */
    public static final int MATERIAL_SUMMARY_LIMIT = 800;
    /** 全书策略单元必须预留的指令与输出空间，避免根汇总把上下文挤满。 */
    public static final int STRATEGY_RESERVE = 8_000;
    /** 归并节点单条摘要上限，超出即视为模型未按素材摘要约束输出。 */
    public static final int SUMMARY_LIMIT = 8_000;
    /** 归并宽度由容量上限与单条摘要上限推导，保证每个汇总单元的输入不会溢出上下文。 */
    public static final int SUMMARY_WIDTH = Math.max(1, (INPUT_LIMIT - STRATEGY_RESERVE) / SUMMARY_LIMIT);
    /**
     * 批内短标识前缀。
     * <p>
     * 模型回填的是 36 位随机 UUID 时，长串转抄的失手率远高于短序号：一个批次有 60 个事件和十几个分集，
     * 抄错一位就整批报废。因此模型输入统一改用批内序号标识，服务端在落库前映射回真实标识。
     */
    public static final String EVENT_PREFIX = "e";
    /** 批内分集短标识前缀。 */
    public static final String EPISODE_PREFIX = "ep";
    /** 禁止实例化规划工具。 */
    private WholeBookAdaptationPlanner() { }
    /** 生成单元的稳定身份和输入边界。 */
    public record Unit(String key, String stage, JSONObject input) { }

    /**
     * 按章节偏移装批并按容量决定是否归并，不以运行时返回顺序改变批次身份。
     * <p>
     * 归并触发条件是素材摘要总容量而不是固定根数：根汇总数量直接决定模型能划分的故事阶段上限，
     * 装得下就必须一次归纳全书策略，否则百万字作品会被压缩成极少数阶段而导致集数无法展开。
     *
     * @param facts List&lt;Item&gt; 已确认事实快照
     * @return List&lt;Unit&gt; 素材、按需分层汇总及最终策略单元
     */
    public static List<Unit> materials(List<StoryBibleRepository.Item> facts) {
        List<Unit> units = new ArrayList<>();
        List<String> keys = new ArrayList<>();
        for (List<String> batch : batches(facts, Set.of("event", "storyline"))) {
            String key = "material:" + keys.size();
            units.add(new Unit(key, "material", JSONObject.of("factIds", batch)));
            keys.add(key);
        }
        require(!keys.isEmpty(), "全书改编至少需要已确认的故事事件或故事线");
        int level = 0;
        while (keys.size() * MATERIAL_SUMMARY_LIMIT > INPUT_LIMIT - STRATEGY_RESERVE) {
            List<String> next = new ArrayList<>();
            for (int from = 0; from < keys.size(); from += SUMMARY_WIDTH) {
                String key = "summary:" + level + ":" + next.size();
                units.add(new Unit(key, "summary", JSONObject.of("sourceKeys", List.copyOf(keys.subList(from, Math.min(from + SUMMARY_WIDTH, keys.size()))))));
                next.add(key);
            }
            keys = next;
            level++;
        }
        units.add(new Unit("strategy", "strategy", JSONObject.of("sourceKeys", keys)));
        return units;
    }

    /**
     * 同时按实际JSON容量和条数装批，过大的单条事实明确拒绝。
     * @param facts List<Item> 全部事实
     * @param types Set<String> 本阶段需要的类型
     * @return List<List<String>> 有序批次标识
     */
    public static List<List<String>> batches(List<StoryBibleRepository.Item> facts, Set<String> types) {
        return split(facts, facts.stream().filter(item -> types.contains(item.itemType()))
                .sorted(Comparator.comparing(StoryBibleRepository.Item::narrativeOffset, Comparator.nullsLast(Integer::compareTo))
                        .thenComparing(StoryBibleRepository.Item::id)).map(StoryBibleRepository.Item::id).toList());
    }

    /**
     * 按实际JSON容量和条数切分给定的事实标识，设定生成与事件取舍共用同一装批规则。
     *
     * @param facts List&lt;Item&gt; 全部事实，用于按标识建索引
     * @param ids List&lt;String&gt; 已排序且需要切分的标识
     * @return List&lt;List&lt;String&gt;&gt; 有序批次
     */
    public static List<List<String>> split(List<StoryBibleRepository.Item> facts, List<String> ids) {
        Map<String, StoryBibleRepository.Item> index = new HashMap<>();
        facts.forEach(fact -> index.put(fact.id(), fact));
        List<List<String>> batches = new ArrayList<>();
        List<String> current = new ArrayList<>();
        int characters = 2;
        for (String id : ids) {
            StoryBibleRepository.Item fact = index.get(id);
            if (fact == null) continue;
            int size = JSON.toJSONString(modelFact(fact)).length() + 1;
            require(size <= INPUT_LIMIT, "故事事实超过单批容量，请先拆分该事实：" + fact.name());
            if (!current.isEmpty() && (characters + size > INPUT_LIMIT || current.size() >= 60)) {
                batches.add(List.copyOf(current));
                current.clear();
                characters = 2;
            }
            current.add(fact.id());
            characters += size;
        }
        if (!current.isEmpty()) batches.add(List.copyOf(current));
        return batches;
    }

    /**
     * 统一规划阶段：全局设定按全书策略一次生成，设定按容量分批，事件取舍与逐集规划按故事阶段划分。
     * <p>
     * 概览与大纲只生成一次，不再由多批完整对象轮流覆盖；分集标识由服务端固定，
     * 各阶段只填写自己范围内的分集内容，因此分批不会互相覆盖。
     *
     * @param strategy Strategy 已确认集数的全书策略
     * @param slots List&lt;Slot&gt; 服务端固定的分集身份
     * @param facts List&lt;Item&gt; 全部已确认事实
     * @param arcFactIds Map&lt;Integer, List&lt;String&gt;&gt; 各故事阶段覆盖的事实标识
     * @return List&lt;Unit&gt; 按执行顺序排列的调用
     */
    public static List<Unit> planning(Strategy strategy, List<Slot> slots,
                                      List<StoryBibleRepository.Item> facts,
                                      Map<Integer, List<String>> arcFactIds) {
        List<Unit> units = new ArrayList<>();
        units.add(new Unit("overview", "overview", JSONObject.of("mainPlot", strategy.mainPlot(),
                "ending", strategy.ending(), "arcs", strategy.arcs())));
        units.add(new Unit("outline", "outline", JSONObject.of("arcs", strategy.arcs())));
        for (List<String> batch : batches(facts, Set.of("character"))) {
            units.add(new Unit("characters:" + units.size(), "characters", JSONObject.of("factIds", batch)));
        }
        for (List<String> batch : batches(facts, Set.of("location"))) {
            units.add(new Unit("locations:" + units.size(), "locations", JSONObject.of("factIds", batch)));
        }
        // 人物关系随人物批产出：通用人物草稿校验要求关系引用出现在同一份草稿的人物列表里，
        // 独立的关系单元无法通过校验，跨批关系需要在人物齐备后单独设计。
        for (int arc = 0; arc < strategy.arcs().size(); arc++) {
            List<List<String>> batches = split(facts, arcFactIds.getOrDefault(arc, List.of()));
            for (int index = 0; index < batches.size(); index++) {
                units.add(new Unit("assignment:" + arc + ":" + index, "assignment", JSONObject.of(
                        "arcIndex", arc, "factIds", batches.get(index), "episodeIds", slotIds(slots, arc))));
            }
        }
        for (int arc = 0; arc < strategy.arcs().size(); arc++) {
            units.add(new Unit("episodePlan:" + arc, "episodePlan",
                    JSONObject.of("arcIndex", arc, "episodeIds", slotIds(slots, arc))));
        }
        return units;
    }

    /**
     * 一个故事阶段内按集号排列的分集标识，供取舍与逐集规划限定范围。
     *
     * @param slots List&lt;Slot&gt; 全部分集
     * @param arcIndex int 故事阶段序号
     * @return List&lt;String&gt; 该阶段的分集标识
     */
    public static List<String> slotIds(List<Slot> slots, int arcIndex) {
        return slots.stream().filter(slot -> slot.arcIndex() == arcIndex).map(Slot::id).toList();
    }

    /**
     * 模型输入保留事实、顺序和时间不确定性，不携带无关数据库字段。
     * @param fact Item 事实快照
     * @return JSONObject 紧凑事实对象
     */
    public static JSONObject modelFact(StoryBibleRepository.Item fact) {
        return JSONObject.of("id", fact.id(), "itemType", fact.itemType(), "name", fact.name(), "summary", fact.summary(),
                "attributes", fact.attributes(), "narrativeOffset", fact.narrativeOffset(), "storyTime", fact.storyTime(),
                "storyTimeStatus", fact.storyTimeStatus());
    }

    /**
     * 把已落库的事件分配翻译成逐集规划可直接引用的分集序号视图。
     * <p>
     * 取舍单元落库的是真实标识，而逐集规划的 {@code episodes[].id} 用批内序号，
     * 两套标识混在一起会让模型无从对应，因此这里把分集标识转成同一套序号再交给模型。
     *
     * @param assignments List&lt;JSONObject&gt; 本阶段已完成的分配结果
     * @param arcSlots List&lt;Slot&gt; 本阶段固定分集，顺序即序号顺序
     * @return List&lt;JSONObject&gt; 分集标识为批内序号的分配视图
     */
    public static List<JSONObject> modelAssignments(List<JSONObject> assignments, List<Slot> arcSlots) {
        Map<String, String> ordinals = new HashMap<>();
        for (int index = 0; index < arcSlots.size(); index++) {
            ordinals.put(arcSlots.get(index).id(), EPISODE_PREFIX + (index + 1));
        }
        List<JSONObject> views = new ArrayList<>();
        for (JSONObject assignment : assignments) {
            JSONObject view = new JSONObject();
            for (String field : List.of("factId", "treatment", "reason")) {
                if (assignment.containsKey(field)) view.put(field, assignment.getString(field));
            }
            String episodeId = assignment.getString("episodeId");
            // 阶段级保留没有分集标识，此时不输出该字段，与"省略留空"语义一致。
            if (text(episodeId)) view.put("episodeId", ordinals.getOrDefault(episodeId, episodeId));
            views.add(view);
        }
        return views;
    }

    /**
     * 验证全局策略覆盖所有根汇总，禁止重复或遗漏来源范围。
     * @param strategy Strategy 模型策略
     * @param roots List<String> 服务端指定的全书来源
     */
    public static void validateStrategy(Strategy strategy, List<String> roots) {
        require(strategy != null && strategy.arcs() != null && !strategy.arcs().isEmpty() && strategy.arcs().size() <= roots.size(), "全书故事阶段不完整");
        require(text(strategy.mainPlot()) && text(strategy.ending()) && text(strategy.reasoning()) && text(strategy.compression()), "全书策略必须说明主线、结局、集数理由和压缩取舍");
        List<String> covered = new ArrayList<>();
        int episodes = 0;
        for (Arc arc : strategy.arcs()) {
            require(arc != null && text(arc.title()) && text(arc.summary()) && arc.sourceKeys() != null && !arc.sourceKeys().isEmpty()
                    && arc.recommendedEpisodes() > 0, "故事阶段缺少来源或建议集数");
            covered.addAll(arc.sourceKeys());
            episodes += arc.recommendedEpisodes();
        }
        require(episodes <= 1000, "建议集数不能超过1000集");
        require(covered.equals(roots), "全书策略遗漏、重复或打乱了剧情范围；倒叙意图应在阶段摘要中说明");
        require(JSON.toJSONString(strategy).length() <= 24_000, "全书策略过长，请重新归纳");
    }

    /**
     * 按建议比例及最大余数法分配配额，每个已保留阶段至少一集，精确固定总集数。
     * @param jobId String 任务标识
     * @param strategy Strategy 已审阅策略
     * @param count int 用户确认的集数
     * @return List<Slot> 服务端创建的全局集号与标识
     */
    public static List<Slot> slots(String jobId, Strategy strategy, int count) {
        int arcs = strategy.arcs().size();
        require(count >= arcs && count <= 1000, "完整保留当前故事阶段至少需要" + arcs + "集，最多1000集");
        int weight = strategy.arcs().stream().mapToInt(Arc::recommendedEpisodes).sum();
        int[] quotas = new int[arcs];
        long[] remainders = new long[arcs];
        int assigned = arcs;
        for (int index = 0; index < arcs; index++) {
            long product = (long) (count - arcs) * strategy.arcs().get(index).recommendedEpisodes();
            quotas[index] = 1 + (int) (product / weight);
            remainders[index] = product % weight;
            assigned += quotas[index] - 1;
        }
        List<Integer> order = new ArrayList<>();
        for (int index = 0; index < arcs; index++) order.add(index);
        order.sort(Comparator.<Integer>comparingLong(index -> remainders[index]).reversed().thenComparingInt(index -> index));
        for (int index = 0; index < count - assigned; index++) quotas[order.get(index)]++;
        List<Slot> slots = new ArrayList<>();
        for (int arc = 0; arc < arcs; arc++) for (int index = 0; index < quotas[arc]; index++) {
            int number = slots.size() + 1;
            String id = UUID.nameUUIDFromBytes((jobId + ":episode:" + number).getBytes(java.nio.charset.StandardCharsets.UTF_8)).toString();
            slots.add(new Slot(id, number, number - 1, arc));
        }
        return slots;
    }

    /**
     * 验证一个批次的每条事件恰好有一个主取舍，省略必须说明原因。
     * <p>
     * 入参是模型用批内序号回填的结果，服务端先映射回真实标识再校验，
     * 因此模型只需复制 {@code e1}、{@code ep2} 这样的短标识，不必转抄 36 位 UUID。
     *
     * @param result Assignment 模型分配结果，标识为批内序号
     * @param factIds List<String> 本批事件真实标识，顺序即序号顺序
     * @param arcSlots List<Slot> 本阶段固定分集，顺序即序号顺序
     * @return Assignment 标识已映射为真实值的分配结果
     */
    public static Assignment resolveAssignment(Assignment result, List<String> factIds, List<Slot> arcSlots) {
        require(result != null && result.events() != null, "事件分配结果为空");
        List<Disposition> events = new ArrayList<>();
        for (Disposition event : result.events()) {
            require(event != null, "事件分配含未知或重复事实");
            int index = index(EVENT_PREFIX, event.factId(), factIds.size());
            require(index >= 0, "事件分配含未知或重复事实");
            String episodeId = null;
            if (text(event.episodeId())) {
                int slot = index(EPISODE_PREFIX, event.episodeId(), arcSlots.size());
                require(slot >= 0, "事件取舍关联了范围外的分集");
                episodeId = arcSlots.get(slot).id();
            }
            events.add(new Disposition(factIds.get(index), event.treatment(), episodeId, event.reason()));
        }
        return new Assignment(List.copyOf(events));
    }

    /**
     * 把逐集规划的批内序号还原为固定分集身份，集号与时长以服务端为准。
     * <p>
     * 模型只需要回填 {@code ep2} 这样的短序号，集合号、排序与时长由服务端覆盖，
     * 避免模型在长串标识上失手导致整幕分集作废。
     *
     * @param planned List<EpisodeSummary> 模型返回分集，标识为批内序号
     * @param arcSlots List<Slot> 本阶段固定分集，顺序即序号顺序
     * @param duration int 单集时长
     * @return List<EpisodeSummary> 身份已按固定分集重建的分集
     */
    public static List<ScriptDtos.EpisodeSummary> resolveEpisodes(
            List<ScriptDtos.EpisodeSummary> planned, List<Slot> arcSlots, int duration) {
        require(planned != null && planned.size() == arcSlots.size(), "逐集规划数量与固定分集不一致");
        List<ScriptDtos.EpisodeSummary> episodes = new ArrayList<>();
        for (ScriptDtos.EpisodeSummary episode : planned) {
            require(episode != null, "逐集规划包含范围外的分集");
            int slot = index(EPISODE_PREFIX, episode.id(), arcSlots.size());
            require(slot >= 0, "逐集规划包含了范围外的分集");
            Slot target = arcSlots.get(slot);
            episodes.add(new ScriptDtos.EpisodeSummary(target.id(), target.episodeNumber(), episode.title(),
                    episode.summary(), episode.keyEvents(), episode.mainConflict(), episode.climax(),
                    episode.endingHook(), duration, episode.completionStatus(), target.sortOrder()));
        }
        return List.copyOf(episodes);
    }

    /**
     * 校验一个批次的每条事件恰好有一个主取舍，省略必须说明原因。
     * @param result Assignment 标识已还原为真实值的分配结果
     * @param expected Set<String> 批次事件
     * @param slots Set<String> 允许的分集
     */
    public static void validateAssignment(Assignment result, Set<String> expected, Set<String> slots) {
        require(result != null && result.events() != null, "事件分配结果为空");
        Set<String> seen = new HashSet<>();
        for (Disposition event : result.events()) {
            require(event != null && expected.contains(event.factId()) && seen.add(event.factId()), "事件分配含未知或重复事实");
            require(Set.of("retain", "merge", "omit").contains(event.treatment()) && text(event.reason()), "事件取舍必须包含方式及理由");
            // 只有合并必须指向本阶段的具体分集：保留可以停留在阶段级，省略必须不指向任何分集。
            String episodeId = event.episodeId();
            boolean merge = "merge".equals(event.treatment());
            boolean omit = "omit".equals(event.treatment());
            require(merge ? slots.contains(episodeId)
                            : omit ? !text(episodeId)
                            : !text(episodeId) || slots.contains(episodeId),
                    "事件取舍关联了范围外的分集");
        }
        require(seen.equals(expected), "事件分配遗漏了已确认事件");
    }

    /**
     * 校验逐集规划回填了全部固定分集且未篡改内容。
     *
     * @param planned List<EpisodeSummary> 身份已还原的分集
     * @param slots List<Slot> 固定目标
     */
    public static void validateEpisodes(List<ScriptDtos.EpisodeSummary> planned, List<Slot> slots) {
        require(planned != null && planned.size() == slots.size(), "逐集规划数量与固定分集不一致");
        for (ScriptDtos.EpisodeSummary episode : planned) {
            require(episode != null, "逐集规划包含了范围外的分集");
            require(slots.stream().anyMatch(slot -> slot.id().equals(episode.id())), "逐集规划包含了范围外的分集");
            require(text(episode.summary()) && text(episode.keyEvents()) && text(episode.mainConflict()) && text(episode.climax())
                    && text(episode.endingHook()), "分集缺少剧情、事件、冲突、高潮或结尾悬念");
        }
    }

    /**
     * 把批内序号标识解析为下标，标识不合法时返回 -1。
     * @param prefix String 短标识前缀
     * @param value String 模型回填的标识
     * @param size int 本批可选数量
     * @return int 从 0 起的下标，非法标识为 -1
     */
    private static int index(String prefix, String value, int size) {
        if (value == null || !value.startsWith(prefix) || size <= 0) return -1;
        try {
            // 序号一律从 1 起，避免模型把下标偏移当成合法标识。
            int position = Integer.parseInt(value.substring(prefix.length()));
            return position >= 1 && position <= size ? position - 1 : -1;
        } catch (NumberFormatException error) {
            return -1;
        }
    }

    /**
     * 统一表达可审阅的业务错误，禁止无确认的兼容或兜底。
     * @param condition boolean 条件
     * @param message String 中文错误说明
     */
    public static void require(boolean condition, String message) {
        if (!condition) throw new BusinessException(ErrorCode.PARAM_INVALID, message);
    }
    /**
     * 判断必填内容。
     * @param value String 内容
     * @return boolean 是否非空
     */
    private static boolean text(String value) { return value != null && !value.isBlank(); }
}

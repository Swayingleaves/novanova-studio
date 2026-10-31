package com.novanovastudio.service;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.dto.ScriptDtos;
import com.novanovastudio.dto.WholeBookAdaptationDtos.Arc;
import com.novanovastudio.dto.WholeBookAdaptationDtos.Assignment;
import com.novanovastudio.dto.WholeBookAdaptationDtos.Disposition;
import com.novanovastudio.dto.WholeBookAdaptationDtos.Slot;
import com.novanovastudio.dto.WholeBookAdaptationDtos.Strategy;
import com.novanovastudio.repository.StoryBibleRepository;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Test;

/**
 * 全书改编的素材装批、汇总粒度、固定分集配额与策略覆盖回归测试。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-10-01 23:00
 */
class WholeBookAdaptationPlannerTest {

    /** 验证百万字作品不会因固定归并宽度而被压缩成极少数故事阶段。 */
    @Test
    void shouldKeepFineGrainedRootsForMillionCharacterNovel() {
        List<WholeBookAdaptationPlanner.Unit> units = WholeBookAdaptationPlanner.materials(events(1295));

        long materials = units.stream().filter(unit -> "material".equals(unit.stage())).count();
        // 素材摘要装得下就一次归纳全书策略，否则模型只能在极少数阶段之间分配集数。
        assertTrue(units.stream().noneMatch(unit -> "summary".equals(unit.stage())));
        assertTrue(materials >= 20, "百万字作品应保留充足的素材批，实际 " + materials);

        WholeBookAdaptationPlanner.Unit strategy = units.getLast();
        assertEquals("strategy", strategy.stage());
        assertEquals((int) materials, strategy.input().getJSONArray("sourceKeys").size());
    }

    /** 验证素材摘要超出容量时才会继续归并，且根汇总数量收敛到策略输入容量内。 */
    @Test
    void shouldMergeRootsOnlyWhenMaterialSummariesExceedCapacity() {
        List<WholeBookAdaptationPlanner.Unit> units = WholeBookAdaptationPlanner.materials(events(5000));

        assertTrue(units.stream().anyMatch(unit -> "summary".equals(unit.stage())));
        int roots = units.getLast().input().getJSONArray("sourceKeys").size();
        assertTrue((long) roots * WholeBookAdaptationPlanner.MATERIAL_SUMMARY_LIMIT
                        <= WholeBookAdaptationPlanner.INPUT_LIMIT - WholeBookAdaptationPlanner.STRATEGY_RESERVE,
                "根汇总装不下策略输入，实际根数 " + roots);
    }

    /** 验证确认 60 集时恰好生成 60 个连续集号的固定分集，且每个故事阶段至少一集。 */
    @Test
    void shouldAllocateExactlyRequestedEpisodeCount() {
        List<Slot> slots = WholeBookAdaptationPlanner.slots("job-1", threeArcStrategy(), 60);

        assertEquals(60, slots.size());
        assertEquals(60, slots.stream().map(Slot::id).distinct().count());
        for (int index = 0; index < slots.size(); index++) {
            assertEquals(index + 1, slots.get(index).episodeNumber());
            assertEquals(index, slots.get(index).sortOrder());
        }
        for (int arc = 0; arc < 3; arc++) {
            int current = arc;
            assertTrue(slots.stream().filter(slot -> slot.arcIndex() == current).count() >= 1,
                    "故事阶段 " + arc + " 至少需要一集");
        }
    }

    /** 验证集数不足以覆盖全部故事阶段时明确拒绝，而不是悄悄合并或追加分集。 */
    @Test
    void shouldRejectEpisodeCountBelowStoryStageCount() {
        BusinessException error = assertThrows(BusinessException.class,
                () -> WholeBookAdaptationPlanner.slots("job-1", threeArcStrategy(), 2));
        assertTrue(error.getMessage().contains("至少需要3集"), error.getMessage());
    }

    /** 验证策略遗漏来源范围时拒绝保存，避免静默丢失剧情。 */
    @Test
    void shouldRejectStrategyMissingRootSources() {
        Strategy strategy = strategy(List.of(new Arc("开端", "开场", List.of("m-0"), 8)));
        BusinessException error = assertThrows(BusinessException.class,
                () -> WholeBookAdaptationPlanner.validateStrategy(strategy, List.of("m-0", "m-1")));
        assertTrue(error.getMessage().contains("剧情范围"), error.getMessage());
    }

    /** 验证阶段打乱来源顺序时拒绝保存，倒叙必须写进阶段摘要而不是重排来源。 */
    @Test
    void shouldRejectStrategyReorderingRootSources() {
        Strategy strategy = strategy(List.of(new Arc("后段", "后发生", List.of("m-1"), 8),
                new Arc("前段", "先发生", List.of("m-0"), 8)));
        BusinessException error = assertThrows(BusinessException.class,
                () -> WholeBookAdaptationPlanner.validateStrategy(strategy, List.of("m-0", "m-1")));
        assertTrue(error.getMessage().contains("剧情范围"), error.getMessage());
    }

    /** 验证策略完整覆盖全部来源范围时通过校验。 */
    @Test
    void shouldAcceptStrategyCoveringEveryRootSource() {
        Strategy strategy = strategy(List.of(new Arc("开端", "开场", List.of("m-0"), 8),
                new Arc("高潮", "冲突", List.of("m-1"), 12)));
        assertDoesNotThrow(() -> WholeBookAdaptationPlanner.validateStrategy(strategy, List.of("m-0", "m-1")));
    }

    /** 验证策略缺少主线、结局、集数理由或压缩取舍时拒绝保存。 */
    @Test
    void shouldRejectStrategyWithoutReasoning() {
        Strategy strategy = new Strategy("主线", "结局", "", "取舍",
                List.of(new Arc("开端", "开场", List.of("m-0"), 8)));
        BusinessException error = assertThrows(BusinessException.class,
                () -> WholeBookAdaptationPlanner.validateStrategy(strategy, List.of("m-0")));
        assertTrue(error.getMessage().contains("主线、结局、集数理由和压缩取舍"), error.getMessage());
    }

    /** 验证统一规划按故事阶段划分取舍与逐集规划，概览与大纲各只生成一次。 */
    @Test
    void shouldPlanAssignmentAndEpisodePlanPerStoryStage() {
        Strategy strategy = threeArcStrategy();
        List<Slot> slots = WholeBookAdaptationPlanner.slots("job-1", strategy, 12);
        List<StoryBibleRepository.Item> facts = new ArrayList<>(events(120));
        facts.addAll(items("character", 5));
        facts.addAll(items("location", 3));
        Map<Integer, List<String>> arcFacts = new LinkedHashMap<>();
        for (int arc = 0; arc < 3; arc++) {
            int from = arc * 40;
            arcFacts.put(arc, facts.stream().skip(from).limit(40).map(StoryBibleRepository.Item::id).toList());
        }

        List<WholeBookAdaptationPlanner.Unit> units =
                WholeBookAdaptationPlanner.planning(strategy, slots, facts, arcFacts);

        // 概览与大纲只生成一次，不再由多批完整对象轮流覆盖。
        assertEquals(1, units.stream().filter(unit -> "overview".equals(unit.stage())).count());
        assertEquals(1, units.stream().filter(unit -> "outline".equals(unit.stage())).count());
        // 人物与地点按容量分批，事件取舍与逐集规划按故事阶段各一份。
        assertTrue(units.stream().anyMatch(unit -> "characters".equals(unit.stage())));
        assertTrue(units.stream().anyMatch(unit -> "locations".equals(unit.stage())));
        assertEquals(3, units.stream().filter(unit -> "assignment".equals(unit.stage())).count());
        assertEquals(3, units.stream().filter(unit -> "episodePlan".equals(unit.stage())).count());
        assertEquals(units.size(), units.stream().map(WholeBookAdaptationPlanner.Unit::key).distinct().count());

        // 每个阶段的逐集规划只能覆盖本阶段固定的分集标识，避免跨阶段写串。
        for (int arc = 0; arc < 3; arc++) {
            int current = arc;
            Set<String> expected = slots.stream().filter(slot -> slot.arcIndex() == current)
                    .map(Slot::id).collect(Collectors.toSet());
            WholeBookAdaptationPlanner.Unit unit = units.stream()
                    .filter(item -> ("episodePlan:" + current).equals(item.key())).findFirst().orElseThrow();
            assertEquals(expected, new HashSet<>(unit.input().getJSONArray("episodeIds").toJavaList(String.class)));
            assertFalse(expected.isEmpty());
        }
    }

    /** 验证保留可以停留在阶段级，而合并必须指向本阶段的具体分集。 */
    @Test
    void shouldAcceptStageLevelRetainAndRejectOutOfRangeMerge() {
        Set<String> slots = Set.of("ep-1", "ep-2");
        Assignment retained = new Assignment(List.of(
                new Disposition("fact-1", "retain", "", "主线推进，暂不拆到具体集"),
                new Disposition("fact-2", "merge", "ep-1", "与前一事件合并成同一场戏"),
                new Disposition("fact-3", "omit", "", "支线与主线无关")));
        assertDoesNotThrow(() -> WholeBookAdaptationPlanner.validateAssignment(retained,
                Set.of("fact-1", "fact-2", "fact-3"), slots));

        Assignment outOfRange = new Assignment(List.of(new Disposition("fact-1", "merge", "ep-9", "合并")));
        assertThrows(BusinessException.class, () -> WholeBookAdaptationPlanner.validateAssignment(
                outOfRange, Set.of("fact-1"), slots));

        // 省略事件不得再指向任何分集，否则取舍语义自相矛盾。
        Assignment omittedWithEpisode = new Assignment(List.of(new Disposition("fact-1", "omit", "ep-1", "省略")));
        assertThrows(BusinessException.class, () -> WholeBookAdaptationPlanner.validateAssignment(
                omittedWithEpisode, Set.of("fact-1"), slots));
    }

    /**
     * 验证模型用批内序号回填时，服务端能还原为真实标识并通过原有校验。
     * <p>
     * 这正是线上失败的场景：模型转抄 36 位 UUID 会失手，改成 e1/ep1 这类短标识后不再需要转抄。
     */
    @Test
    void shouldResolveBatchOrdinalsBackToRealIdentifiers() {
        List<String> factIds = List.of("fact-a", "fact-b", "fact-c");
        List<Slot> arcSlots = List.of(new Slot("slot-x", 7, 6, 0), new Slot("slot-y", 8, 7, 0));

        Assignment resolved = WholeBookAdaptationPlanner.resolveAssignment(new Assignment(List.of(
                new Disposition("e1", "retain", "", "开场保留"),
                new Disposition("e2", "merge", "ep2", "并入第二集同一场戏"),
                new Disposition("e3", "omit", "", "支线与主线无关"))), factIds, arcSlots);

        assertEquals(List.of("fact-a", "fact-b", "fact-c"),
                resolved.events().stream().map(Disposition::factId).toList());
        assertEquals("slot-y", resolved.events().get(1).episodeId());
        assertDoesNotThrow(() -> WholeBookAdaptationPlanner.validateAssignment(resolved,
                Set.copyOf(factIds), Set.of("slot-x", "slot-y")));
    }

    /** 验证批内序号越界或不是序号格式时直接拒绝，不静默当成真实标识继续校验。 */
    @Test
    void shouldRejectOutOfRangeAndMalformedBatchOrdinals() {
        List<String> factIds = List.of("fact-a", "fact-b");
        List<Slot> arcSlots = List.of(new Slot("slot-x", 7, 6, 0));

        // 序号 0 不存在，序号从 1 起，避免模型把下标偏移当成合法标识。
        assertThrows(BusinessException.class, () -> WholeBookAdaptationPlanner.resolveAssignment(
                new Assignment(List.of(new Disposition("e0", "retain", "", "越界"))), factIds, arcSlots));
        assertThrows(BusinessException.class, () -> WholeBookAdaptationPlanner.resolveAssignment(
                new Assignment(List.of(new Disposition("e9", "retain", "", "越界"))), factIds, arcSlots));
        // 模型没按提示词回填批内序号时，不能把真实标识当序号猜。
        assertThrows(BusinessException.class, () -> WholeBookAdaptationPlanner.resolveAssignment(
                new Assignment(List.of(new Disposition("fact-a", "retain", "", "用了真实标识"))), factIds, arcSlots));
        // 分集序号越界同样必须拒绝，否则取舍会写到别的幕上。
        assertThrows(BusinessException.class, () -> WholeBookAdaptationPlanner.resolveAssignment(
                new Assignment(List.of(new Disposition("e1", "merge", "ep5", "分集越界"))), factIds, arcSlots));
    }

    /**
     * 验证逐集规划只回填短序号时，集号、排序与时长以服务端固定槽位为准。
     * <p>
     * 模型若把集号填错也会被覆盖，不会再出现整幕分集因为一个数字作废的情况。
     */
    @Test
    void shouldRebuildEpisodeIdentityFromFixedSlots() {
        List<Slot> arcSlots = List.of(new Slot("slot-x", 7, 6, 0), new Slot("slot-y", 8, 7, 0));

        List<ScriptDtos.EpisodeSummary> resolved = WholeBookAdaptationPlanner.resolveEpisodes(List.of(
                episode("ep1", "第一集", 999),
                episode("ep2", "第二集", 111)), arcSlots, 180);

        assertEquals(List.of("slot-x", "slot-y"), resolved.stream()
                .map(ScriptDtos.EpisodeSummary::id).toList());
        assertEquals(List.of(7, 8), resolved.stream()
                .map(ScriptDtos.EpisodeSummary::episodeNumber).toList());
        assertEquals(List.of(6, 7), resolved.stream()
                .map(ScriptDtos.EpisodeSummary::sortOrder).toList());
        // 模型填的时长被服务端固定值覆盖。
        assertEquals(List.of(180, 180), resolved.stream()
                .map(ScriptDtos.EpisodeSummary::targetDurationSeconds).toList());
        assertDoesNotThrow(() -> WholeBookAdaptationPlanner.validateEpisodes(resolved, arcSlots));
    }

    /** 验证逐集规划的序号必须落在本幕范围内，且分集数量与固定槽位一致。 */
    @Test
    void shouldRejectEpisodesOutsideStageRange() {
        List<Slot> arcSlots = List.of(new Slot("slot-x", 7, 6, 0), new Slot("slot-y", 8, 7, 0));

        assertThrows(BusinessException.class, () -> WholeBookAdaptationPlanner.resolveEpisodes(
                List.of(episode("ep1", "第一集", 180)), arcSlots, 180));
        assertThrows(BusinessException.class, () -> WholeBookAdaptationPlanner.resolveEpisodes(
                List.of(episode("ep1", "第一集", 180), episode("ep5", "第五集", 180)), arcSlots, 180));
    }

    /** 构造一条内容完整、时长可被覆盖的分集。 */
    private ScriptDtos.EpisodeSummary episode(String id, String title, int duration) {
        return new ScriptDtos.EpisodeSummary(id, 1, title, "剧情摘要", "关键事件", "主要冲突",
                "高潮", "结尾悬念", duration, "planning", 0);
    }

    /** 构造指定条数与类型的已确认事实，偏移递增以便装批按原文顺序稳定排序。 */
    private List<StoryBibleRepository.Item> items(String type, int count) {
        return IntStream.range(0, count)
                .mapToObj(index -> new StoryBibleRepository.Item(type + "-" + index, "project", "document", type,
                        type + index, "摘要", new JSONObject(), "ai", "confirmed", false, null,
                        "match-" + type + index, index * 100, "", "certain", null, 0))
                .toList();
    }

    /** 构造指定条数的已确认事件。 */
    private List<StoryBibleRepository.Item> events(int count) {
        return items("event", count);
    }

    /** 三个故事阶段的策略，用于验证配额分配与集数下限。 */
    private Strategy threeArcStrategy() {
        return strategy(List.of(new Arc("开端", "开场", List.of("m-0"), 8),
                new Arc("发展", "推进", List.of("m-1"), 20), new Arc("收束", "结局", List.of("m-2"), 6)));
    }

    /** 组装包含完整说明字段的策略。 */
    private Strategy strategy(List<Arc> arcs) {
        return new Strategy("全书主线", "结局走向", "建议集数理由", "压缩取舍说明", arcs);
    }
}

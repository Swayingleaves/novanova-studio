package com.novanovastudio.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.dto.NovelAdaptationDtos;
import com.novanovastudio.dto.ScriptDtos;
import com.novanovastudio.repository.NovelAdaptationRepository;
import com.novanovastudio.repository.StoryBibleRepository;
import java.util.List;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Test;

/**
 * 小说改编恢复规划的目标分集、事实批次和历史边界回归测试。
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-10-01 12:00
 */
class NovelAdaptationPlanTest {
    /** 验证同一集的一个成功批次不会导致该集剩余批次或其他分集被跳过。 */
    @Test
    void shouldSkipOnlyCompletedEpisodeFactBatch() {
        List<StoryBibleRepository.ItemTypeRef> items = IntStream.range(0, 80)
                .mapToObj(index -> new StoryBibleRepository.ItemTypeRef("fact-" + index, "character", 0)).toList();
        List<NovelAdaptationPlan.Unit> initial = NovelAdaptationPlan.units("drafts", items, List.of(episode("first"), episode("second")));
        NovelAdaptationPlan.Unit firstBatch = initial.getFirst();
        List<NovelAdaptationRepository.DraftCheckpoint> checkpoints = List.of(checkpoint(firstBatch, "pending"));
        List<NovelAdaptationPlan.Unit> remaining = NovelAdaptationPlan.units("drafts", items,
                        List.of(episode("first"), episode("second")), checkpoints).stream()
                .filter(unit -> !NovelAdaptationPlan.completedKeys(checkpoints).contains(unit.key())).toList();

        assertEquals(4, initial.size());
        assertEquals(3, remaining.size());
        assertEquals(20, remaining.getFirst().factIds().size());
        assertEquals("first", remaining.getFirst().episodeId());
        assertEquals(2, remaining.stream().filter(unit -> "second".equals(unit.episodeId())).count());
    }

    /** 验证事实查询顺序变化后仍复用原成功批次，避免重新生成已完成范围。 */
    @Test
    void shouldPreserveCheckpointBoundariesWhenInputOrderChanges() {
        List<StoryBibleRepository.ItemTypeRef> items = IntStream.range(0, 80)
                .mapToObj(index -> new StoryBibleRepository.ItemTypeRef("fact-" + index, "character", 0)).toList();
        NovelAdaptationPlan.Unit completed = NovelAdaptationPlan.units("drafts", items, List.of(episode("first"))).getFirst();
        List<NovelAdaptationRepository.DraftCheckpoint> checkpoints = List.of(checkpoint(completed, "pending"));
        List<NovelAdaptationPlan.Unit> plan = NovelAdaptationPlan.units("drafts", items.reversed(), List.of(episode("first")), checkpoints);

        assertEquals(completed.key(), plan.getFirst().key());
        assertEquals(2, plan.size());
        assertTrue(plan.get(1).factIds().stream().noneMatch(completed.factIds()::contains));
    }

    /** 验证事实标识集合顺序不影响批次身份，但目标分集不同必须生成不同批次。 */
    @Test
    void shouldMatchFactSetsWithoutConfusingEpisodeTargets() {
        NovelAdaptationPlan.Unit first = new NovelAdaptationPlan.Unit("episode", "first", List.of("fact-a", "fact-b"));
        NovelAdaptationPlan.Unit reordered = new NovelAdaptationPlan.Unit("episode", "first", List.of("fact-b", "fact-a"));
        assertEquals(first.key(), reordered.key());
        assertFalse(first.key().equals(new NovelAdaptationPlan.Unit("episode", "second", reordered.factIds()).key()));
    }

    /** 验证已放弃草稿不被认定为成功恢复检查点。 */
    @Test
    void shouldExcludeDiscardedDraftFromCompletedKeys() {
        NovelAdaptationPlan.Unit unit = new NovelAdaptationPlan.Unit("episode", "first", List.of("fact-a"));
        assertTrue(NovelAdaptationPlan.completedKeys(List.of(checkpoint(unit, "discarded"))).isEmpty());
    }

    /**
     * 创建最小分集摘要。
     * @param id String 分集标识
     * @return EpisodeSummary 分集摘要
     */
    private ScriptDtos.EpisodeSummary episode(String id) {
        return new ScriptDtos.EpisodeSummary(id, 1, "测试分集", "", "", "", "", "", 60, "planning", 0);
    }

    /**
     * 将生成单元转为持久化草稿检查点。
     * @param unit Unit 成功单元
     * @param status String 草稿状态
     * @return DraftCheckpoint 成功草稿信息
     */
    private NovelAdaptationRepository.DraftCheckpoint checkpoint(NovelAdaptationPlan.Unit unit, String status) {
        return new NovelAdaptationRepository.DraftCheckpoint(unit.stage(), unit.episodeId(), status, 1, new JSONObject(),
                unit.factIds().stream().map(id -> new NovelAdaptationDtos.Fact(id, 1, "character", "人物", "", "", List.of())).toList());
    }
}

package com.novanovastudio.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

import com.novanovastudio.dto.ScriptSourceDtos;
import com.novanovastudio.dto.StoryBibleDtos;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * 快速分析批次规划的章节边界与UTF-16代理对保护测试。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-09-28 00:00
 */
class StoryBibleQuickPlannerTest {
    /**
     * 长章节拆分时不破坏代理对且完整覆盖原文。
     */
    @Test
    void shouldPreserveSurrogatePairsAndCoverSelectedText() {
        String text = "甲".repeat(999) + "😀" + "乙".repeat(1200);
        ScriptSourceDtos.Section section = new ScriptSourceDtos.Section("chapter-1", null, "chapter", "第一章", 0,
                text.length(), 0, false);
        StoryBibleDtos.QuickConfiguration configuration = new StoryBibleDtos.QuickConfiguration(1_000_000,
                1000, 10_000, 3);
        List<StoryBibleQuickPlanner.Batch> batches = StoryBibleQuickPlanner.plan(text, List.of(section),
                List.of(new int[]{0, text.length()}), configuration);
        String reconstructed = batches.stream().flatMap(batch -> batch.parts().stream())
                .map(StoryBibleQuickPlanner.Part::text).reduce("", String::concat);
        assertEquals(text, reconstructed);
        assertFalse(batches.stream().flatMap(batch -> batch.parts().stream())
                .anyMatch(part -> Character.isHighSurrogate(part.text().charAt(part.text().length() - 1))));
    }

    /**
     * 大量短章节按正文字符容量聚合，不受章节数量限制。
     */
    @Test
    void shouldFillBatchesByCharactersAcrossManyChapters() {
        int chapterCharacters = 2_290;
        int chapterCount = 551;
        String text = "甲".repeat(chapterCharacters * chapterCount);
        List<ScriptSourceDtos.Section> sections = new java.util.ArrayList<>();
        for (int index = 0; index < chapterCount; index++) {
            sections.add(new ScriptSourceDtos.Section("chapter-" + index, null, "chapter", "第" + index + "章",
                    index * chapterCharacters, (index + 1) * chapterCharacters, index, false));
        }
        StoryBibleDtos.QuickConfiguration configuration = new StoryBibleDtos.QuickConfiguration(1_000_000,
                500_000, 32_768, 4);
        List<StoryBibleQuickPlanner.Batch> batches = StoryBibleQuickPlanner.plan(text, sections,
                List.of(new int[]{0, text.length()}), configuration);
        assertEquals(3, batches.size());
        assertEquals(chapterCount, batches.stream().mapToInt(batch -> batch.parts().size()).sum());
        assertFalse(batches.stream().anyMatch(batch -> batch.parts().stream().mapToInt(part -> part.text().length()).sum() > 500_000));
    }
}

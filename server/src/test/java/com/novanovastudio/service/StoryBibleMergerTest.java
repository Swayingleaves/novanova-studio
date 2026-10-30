package com.novanovastudio.service;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.dto.StoryBibleDtos;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * 故事知识库候选转换与归并测试。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-09-27 00:00
 */
class StoryBibleMergerTest {

    /**
     * 无法在片段内定位证据的结论被丢弃，可定位的换算为绝对偏移。
     */
    @Test
    void shouldDropUnlocatableConclusions() {
        String segment = "林远拜入青云门。师父说：远儿，好好修炼。";
        StoryBibleDtos.SegmentExtraction extraction = new StoryBibleDtos.SegmentExtraction(
                List.of(new StoryBibleDtos.AiEntity("林远", "弟子", List.of(
                                new StoryBibleDtos.AiMention("林远", "林远拜入青云门"),
                                new StoryBibleDtos.AiMention("远儿", "远儿，好好修炼"))),
                        new StoryBibleDtos.AiEntity("幻影", "", List.of(new StoryBibleDtos.AiMention("幻影", "原文没有这句")))),
                List.of(), List.of(),
                List.of(new StoryBibleDtos.AiEvent("拜师", "林远入门", List.of("远儿"), "青云门", null, null, List.of("林远拜入青云门"))));
        List<StoryBibleDtos.Candidate> candidates = StoryBibleMerger.fromExtraction("s0", segment, 100, 100, extraction);
        assertEquals(2, candidates.size());
        StoryBibleDtos.Candidate character = candidates.getFirst();
        assertEquals(List.of("林远", "远儿"), character.aliases());
        assertEquals(100, character.evidences().getFirst().start());
        assertEquals("林远拜入青云门", character.evidences().getFirst().quote());
        assertEquals(100 + segment.indexOf("远儿"), character.evidences().get(1).start());
    }

    /**
     * 共享别名的人物按确定性规则合并，并保留两处原文证据。
     */
    @Test
    void shouldUnionEntitiesByAlias() {
        StoryBibleDtos.Candidate first = entity("林远", List.of("林远"), 10);
        StoryBibleDtos.Candidate second = entity("远儿", List.of("远儿", "林远"), 50);
        List<StoryBibleDtos.Candidate> result = StoryBibleMerger.unionByAlias(List.of(first, second));
        assertEquals(1, result.size());
        assertEquals(2, result.getFirst().evidences().size());
    }

    /**
     * 构造人物候选。
     *
     * @param name String 名称
     * @param aliases List&lt;String&gt; 别名
     * @param start int 证据起点
     * @return Candidate 候选
     */
    private StoryBibleDtos.Candidate entity(String name, List<String> aliases, int start) {
        return new StoryBibleDtos.Candidate("", "character", name, "", aliases,
                List.of(new StoryBibleDtos.CandidateEvidence(start, start + 2, name, name)), new JSONObject(), false);
    }

}

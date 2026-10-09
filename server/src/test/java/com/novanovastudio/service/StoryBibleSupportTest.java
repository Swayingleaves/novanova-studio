package com.novanovastudio.service;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.dto.StoryBibleDtos;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * 故事知识库计费字数、价格档位与证据定位测试。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-09-27 00:00
 */
class StoryBibleSupportTest {

    /**
     * 空格、换行与全角空格不计费，汉字、字母、数字、标点计费，代理对按一个字符计。
     */
    @Test
    void shouldCountNonWhitespaceCodePoints() {
        String text = "第一章 Hi,\n\t2人。　😀 ";
        assertEquals(10, StoryBibleSupport.countBillableChars(text, List.of(new int[]{0, text.length()})));
        assertEquals(3, StoryBibleSupport.countBillableChars(text, List.of(new int[]{0, 3})));
    }

    /**
     * 重叠或相邻范围合并后不重复计费。
     */
    @Test
    void shouldMergeOverlappingRanges() {
        List<int[]> merged = StoryBibleSupport.mergeRanges(List.of(new int[]{10, 20}, new int[]{0, 5}, new int[]{5, 12}, new int[]{30, 40}));
        assertEquals(2, merged.size());
        assertArrayEquals(new int[]{0, 20}, merged.get(0));
        assertArrayEquals(new int[]{30, 40}, merged.get(1));
    }

    /**
     * 档位上下边界均包含在档位内，超出最后有限档位时无覆盖。
     */
    @Test
    void shouldSelectTierAtBoundaries() {
        List<StoryBibleDtos.PricingTier> tiers = StoryBibleSupport.validateTiers(List.of(
                new StoryBibleDtos.PricingTier(100_001, 500_000, 300),
                new StoryBibleDtos.PricingTier(1, 100_000, 100)));
        assertEquals(100, StoryBibleSupport.selectTier(tiers, 1).credits());
        assertEquals(100, StoryBibleSupport.selectTier(tiers, 100_000).credits());
        assertEquals(300, StoryBibleSupport.selectTier(tiers, 100_001).credits());
        assertEquals(300, StoryBibleSupport.selectTier(tiers, 500_000).credits());
        assertNull(StoryBibleSupport.selectTier(tiers, 500_001));
    }

    /**
     * 无上限档位覆盖任意大字数。
     */
    @Test
    void shouldAllowOpenEndedLastTier() {
        List<StoryBibleDtos.PricingTier> tiers = StoryBibleSupport.validateTiers(List.of(
                new StoryBibleDtos.PricingTier(1, 10, 1), new StoryBibleDtos.PricingTier(11, null, 5)));
        assertEquals(5, StoryBibleSupport.selectTier(tiers, 1_175_300).credits());
    }

    /**
     * 重叠、断档、非首档起点与中间无上限均被拒绝。
     */
    @Test
    void shouldRejectInvalidTiers() {
        assertThrows(BusinessException.class, () -> StoryBibleSupport.validateTiers(List.of(
                new StoryBibleDtos.PricingTier(1, 100, 1), new StoryBibleDtos.PricingTier(100, 200, 2))));
        assertThrows(BusinessException.class, () -> StoryBibleSupport.validateTiers(List.of(
                new StoryBibleDtos.PricingTier(1, 100, 1), new StoryBibleDtos.PricingTier(102, 200, 2))));
        assertThrows(BusinessException.class, () -> StoryBibleSupport.validateTiers(List.of(
                new StoryBibleDtos.PricingTier(2, 100, 1))));
        assertThrows(BusinessException.class, () -> StoryBibleSupport.validateTiers(List.of(
                new StoryBibleDtos.PricingTier(1, null, 1), new StoryBibleDtos.PricingTier(101, 200, 2))));
        assertThrows(BusinessException.class, () -> StoryBibleSupport.validateTiers(List.of(
                new StoryBibleDtos.PricingTier(1, 100, -1))));
    }

    /**
     * 证据在片段内定位后换算为原文绝对偏移，且与原文完全一致。
     */
    @Test
    void shouldLocateEvidenceWithAbsoluteOffsets() {
        String text = "前言😀。\n林远推开门，看见师父。";
        int segmentStart = text.indexOf('\n') + 1;
        String segment = text.substring(segmentStart);
        int[] span = StoryBibleSupport.locate(segment, segmentStart, " 看见师父 ");
        assertArrayEquals(new int[]{text.indexOf("看见"), text.indexOf("看见") + 4}, span);
        assertTrue(StoryBibleSupport.matches(text, span[0], span[1], "看见师父"));
        assertNull(StoryBibleSupport.locate(segment, segmentStart, "不存在的句子"));
    }

    /**
     * 与原文不一致或切开代理对的证据不通过校验。
     */
    @Test
    void shouldRejectMismatchedOrSurrogateSplitEvidence() {
        String text = "A😀B";
        assertFalse(StoryBibleSupport.matches(text, 0, 2, "A\uD83D"));
        assertFalse(StoryBibleSupport.matches(text, 2, 4, "\uDE00B"));
        assertFalse(StoryBibleSupport.matches(text, 0, 1, "B"));
        assertTrue(StoryBibleSupport.matches(text, 1, 3, "😀"));
    }

    /**
     * 名称归一忽略空白、间隔号与大小写。
     */
    @Test
    void shouldNormalizeNames() {
        assertEquals("约翰史密斯", StoryBibleSupport.normalize(" 约翰·史密斯 "));
        assertEquals("tom", StoryBibleSupport.normalize("Tom"));
    }
}

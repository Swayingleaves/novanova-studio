package com.novanovastudio.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * 原文切片边界测试。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-09-27 00:00
 */
class ScriptSourceParserTest {

    /** 被测解析器。 */
    private final ScriptSourceParser parser = new ScriptSourceParser();

    /**
     * 无换行长文本硬切时不能切开代理对，片段首尾相接覆盖全部范围。
     */
    @Test
    void shouldNotSplitSurrogatePairsWhenHardCutting() {
        String text = "a" + "😀".repeat(10);
        List<ScriptSourceParser.ParsedChunk> chunks = parser.chunks(text, 0, text.length(), 4);
        int cursor = 0;
        for (ScriptSourceParser.ParsedChunk chunk : chunks) {
            assertEquals(cursor, chunk.startOffset());
            assertFalse(Character.isLowSurrogate(text.charAt(chunk.startOffset())));
            cursor = chunk.endOffset();
        }
        assertEquals(text.length(), cursor);
    }

    /**
     * 有段落边界时优先在换行后收口。
     */
    @Test
    void shouldPreferParagraphBoundary() {
        String text = "第一段\n第二段内容";
        List<ScriptSourceParser.ParsedChunk> chunks = parser.chunks(text, 0, text.length(), 6);
        assertEquals(4, chunks.getFirst().endOffset());
    }
}

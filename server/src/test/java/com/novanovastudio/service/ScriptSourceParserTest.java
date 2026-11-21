package com.novanovastudio.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

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

    /**
     * 纯中文数字独立行（如“一”“二”“十一”）在无“第X章”标题时应识别为章节。
     */
    @Test
    void shouldRecognizeBareChineseNumeralChapters(@TempDir Path tempDir) throws Exception {
        Path file = tempDir.resolve("bare-chinese.txt");
        Files.writeString(file, "试读说明\n\n一\n\n苏家一门退休后的平静生活。\n\n二\n\n明哲接到父亲报丧电话。\n\n十一\n\n明玉去了北京。", StandardCharsets.UTF_8);

        ScriptSourceParser.ParsedSource parsed = parser.parse(file, "txt", "UTF-8", "novel");

        List<String> titles = parsed.sections().stream().map(ScriptSourceParser.ParsedSection::title).toList();
        assertEquals(List.of("一", "二", "十一"), titles);
        assertEquals(0, parsed.sections().getFirst().startOffset());
        assertEquals("首个标题之前的文字已并入第一段，请核对边界", parsed.warning());
    }

    /**
     * 纯阿拉伯数字独立行（如“1”“2”）在无“第X章”标题时应识别为章节，且仅出现一次时不误切。
     */
    @Test
    void shouldRecognizeBareArabicChaptersAndIgnoreSingleNumeral(@TempDir Path tempDir) throws Exception {
        Path multi = tempDir.resolve("bare-arabic.txt");
        Files.writeString(multi, "1\n\n正文一。\n\n2\n\n正文二。", StandardCharsets.UTF_8);
        ScriptSourceParser.ParsedSource parsed = parser.parse(multi, "txt", "UTF-8", "novel");
        assertEquals(List.of("1", "2"), parsed.sections().stream().map(ScriptSourceParser.ParsedSection::title).toList());
        assertEquals("", parsed.warning());

        Path single = tempDir.resolve("single-numeral.txt");
        Files.writeString(single, "前言\n\n一\n\n" + "这是一段没有章节标题的正文内容。\n".repeat(450), StandardCharsets.UTF_8);
        ScriptSourceParser.ParsedSource singleParsed = parser.parse(single, "txt", "UTF-8", "novel");
        assertTrue(singleParsed.sections().size() >= 2);
        assertEquals("片段 1", singleParsed.sections().getFirst().title());
        assertFalse(singleParsed.sections().getFirst().needsReview());
    }

    /**
     * 小说中的横线分隔符不应再误拆出“场景 1/2/3”子段。
     */
    @Test
    void shouldNotSplitNovelByHorizontalDividers(@TempDir Path tempDir) throws Exception {
        Path file = tempDir.resolve("dividers.txt");
        Files.writeString(file, "一\n\n正文开始。\n\n————————————————————\n试读声明\n————————————————————\n\n二\n\n明哲接到父亲报丧电话。",
                StandardCharsets.UTF_8);

        ScriptSourceParser.ParsedSource parsed = parser.parse(file, "txt", "UTF-8", "novel");

        assertEquals(List.of("一", "二"),
                parsed.sections().stream().map(ScriptSourceParser.ParsedSection::title).toList());
    }

    /**
     * AI章节候选提取应过滤对话、句末标点短句和纯分隔线，并按选中序号重建章节。
     */
    @Test
    void shouldExtractCandidatesAndSplitBySelectedIndexes() {
        String text = """
                ————————————————————
                【序幕】风暴前夜
                “为什么？”
                正文很长很长。
                【壹】初遇
                苏明玉推开门。
                """;
        List<ScriptSourceParser.CandidateLine> candidates = parser.extractChapterCandidates(text);
        assertEquals(List.of("【序幕】风暴前夜", "【壹】初遇"),
                candidates.stream().map(ScriptSourceParser.CandidateLine::text).toList());

        ScriptSourceParser.ParsedSource parsed = parser.splitByCandidateIndexes(text, "novel", candidates, List.of(1, 2));
        assertEquals(List.of("【序幕】风暴前夜", "【壹】初遇"),
                parsed.sections().stream().map(ScriptSourceParser.ParsedSection::title).toList());
        assertEquals(0, parsed.sections().getFirst().startOffset());
    }

    /**
     * 已存在显式“第X章”标题时，正文中的纯数字独立行不应被当作章节切分。
     */
    @Test
    void shouldPreferExplicitChapterPatternOverBareNumerals(@TempDir Path tempDir) throws Exception {
        Path file = tempDir.resolve("explicit.txt");
        Files.writeString(file, "第一章 开始\n\n一\n\n正文。\n\n第二章 继续\n\n二\n\n正文。", StandardCharsets.UTF_8);

        ScriptSourceParser.ParsedSource parsed = parser.parse(file, "txt", "UTF-8", "novel");

        assertEquals(List.of("第一章 开始", "第二章 继续"),
                parsed.sections().stream().map(ScriptSourceParser.ParsedSection::title).toList());
    }
}

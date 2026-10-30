package com.novanovastudio.service;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.apache.poi.hwpf.HWPFDocument;
import org.apache.poi.hwpf.extractor.WordExtractor;
import org.apache.poi.xwpf.extractor.XWPFWordExtractor;
import org.apache.poi.xwpf.usermodel.XWPFDocument;
import org.springframework.stereotype.Component;

/**
 * 小说与剧本原文解析及确定性结构切分。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-09-26 00:00
 */
@Component
public class ScriptSourceParser {
    /** 解压后正文最大UTF-16字符数。 */
    private static final int MAX_TEXT_LENGTH = 12_000_000;
    /** 单个文本片段最大UTF-16字符数。 */
    private static final int MAX_CHUNK_LENGTH = 4000;
    /** 行首空白，不含换行符。 */
    private static final String INDENT = "[ \\t\\u3000]*";
    /** 章节标题格式。 */
    private static final Pattern CHAPTER = Pattern.compile(
            "(?m)^" + INDENT + "(?:第[0-9一二三四五六七八九十百千万零〇两]+[章节卷回]|Chapter[ \\t]+[0-9]+)[^\\n]{0,100}$",
            Pattern.CASE_INSENSITIVE);
    /** 剧本场次标题格式。 */
    private static final Pattern SCRIPT_SCENE = Pattern.compile(
            "(?m)^" + INDENT + "(?:第[0-9一二三四五六七八九十百千万零〇两]+场|场次[：:]?[ \\t]*[0-9]+|(?:INT|EXT)\\.[^\\n]{1,100})[^\\n]{0,100}$",
            Pattern.CASE_INSENSITIVE);
    /** 小说中明确的场景分隔符整行。 */
    private static final Pattern SCENE_DIVIDER = Pattern.compile(
            "(?m)^" + INDENT + "(?:\\*[ \\t]*\\*[ \\t]*\\*|[-—–]{3,})[ \\t\\u3000]*$");

    /** 解析后的结构段。 */
    public record ParsedSection(String sectionType, String title, int startOffset, int endOffset,
                                int parentIndex, boolean needsReview) { }

    /** 解析后的文本片段位置。 */
    public record ParsedChunk(int startOffset, int endOffset) { }

    /** 解析结果。 */
    public record ParsedSource(String text, List<ParsedSection> sections, String warning) { }

    /**
     * 从暂存文件提取正文并切分结构。
     *
     * @param file Path 暂存文件
     * @param extension String 扩展名
     * @param encoding String TXT编码
     * @param sourceType String 小说或剧本
     * @return ParsedSource 规范化正文与结构段
     */
    public ParsedSource parse(Path file, String extension, String encoding, String sourceType) {
        try {
            String extracted;
            switch (extension) {
                case "txt" -> extracted = decodeText(file, encoding);
                case "docx" -> {
                    try (XWPFDocument document = new XWPFDocument(Files.newInputStream(file));
                         XWPFWordExtractor extractor = new XWPFWordExtractor(document)) {
                        extracted = extractor.getText();
                    }
                }
                case "doc" -> {
                    try (HWPFDocument document = new HWPFDocument(Files.newInputStream(file));
                         WordExtractor extractor = new WordExtractor(document)) {
                        extracted = extractor.getText();
                    }
                }
                default -> throw new BusinessException(ErrorCode.PARAM_INVALID, "仅支持TXT、DOCX和DOC文件");
            }
            // 原文只规范换行，不改变其余字符，保证偏移与用户看到的正文一致。
            // PostgreSQL TEXT不能保存NUL字符，文档抽取偶尔带出的NUL直接去除。
            String normalized = extracted.replace("\r\n", "\n").replace('\r', '\n').replace("\u0000", "");
            if (normalized.isBlank()) {
                throw new BusinessException(ErrorCode.PARAM_INVALID, "文件中没有可导入的文字");
            }
            if (normalized.length() > MAX_TEXT_LENGTH) {
                throw new BusinessException(ErrorCode.PARAM_INVALID, "提取后的正文超过1200万字符上限");
            }
            return split(normalized, sourceType);
        } catch (BusinessException exception) {
            throw exception;
        } catch (IOException | RuntimeException exception) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "文件无法解析，请检查文件内容是否完整");
        }
    }

    /**
     * 按段落边界把指定范围切成有序片段。
     *
     * @param text String 规范化正文
     * @param start int 范围起点，包含
     * @param end int 范围终点，不包含
     * @return List&lt;ParsedChunk&gt; 片段位置列表
     */
    public List<ParsedChunk> chunks(String text, int start, int end) {
        return chunks(text, start, end, MAX_CHUNK_LENGTH);
    }

    /**
     * 按段落边界以指定长度把范围切成有序片段。
     *
     * @param text String 规范化正文
     * @param start int 范围起点，包含
     * @param end int 范围终点，不包含
     * @param maxLength int 单片段最大UTF-16字符数
     * @return List&lt;ParsedChunk&gt; 片段位置列表
     */
    public List<ParsedChunk> chunks(String text, int start, int end, int maxLength) {
        List<ParsedChunk> result = new ArrayList<>();
        int cursor = Math.max(0, Math.min(start, text.length()));
        int limit = Math.max(cursor, Math.min(end, text.length()));
        while (cursor < limit) {
            int candidate = Math.min(cursor + maxLength, limit);
            if (candidate < limit) {
                // 优先在段落边界收口，单行超过片段上限时才按上限硬切。
                int newline = text.lastIndexOf('\n', candidate - 1);
                if (newline >= cursor) {
                    candidate = newline + 1;
                } else if (Character.isLowSurrogate(text.charAt(candidate)) && candidate - 1 > cursor) {
                    // 硬切不能落在代理对中间，否则片段会出现孤立代理字符。
                    candidate--;
                }
            }
            result.add(new ParsedChunk(cursor, candidate));
            cursor = candidate;
        }
        return result;
    }

    /**
     * 严格按用户选择的编码解码TXT。
     *
     * @param file Path 文件路径
     * @param encoding String 编码名称
     * @return String 解码正文
     * @throws IOException 文件读取失败
     */
    private String decodeText(Path file, String encoding) throws IOException {
        try {
            return ("GB18030".equals(encoding) ? java.nio.charset.Charset.forName("GB18030") : StandardCharsets.UTF_8)
                    .newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(Files.readAllBytes(file))).toString();
        } catch (CharacterCodingException exception) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "TXT编码不匹配，请选择正确编码后重新导入");
        }
    }

    /**
     * 按明确标题切分章节或场次。
     *
     * @param text String 规范化正文
     * @param sourceType String 原文类型
     * @return ParsedSource 结构化结果
     */
    private ParsedSource split(String text, String sourceType) {
        boolean novel = "novel".equals(sourceType);
        String sectionType = novel ? "chapter" : "scene";
        Pattern pattern = novel ? CHAPTER : SCRIPT_SCENE;
        Matcher matcher = pattern.matcher(text);
        List<Integer> starts = new ArrayList<>();
        List<String> titles = new ArrayList<>();
        while (matcher.find()) {
            starts.add(matcher.start());
            titles.add(matcher.group().trim());
        }
        if (starts.isEmpty()) {
            // 无可识别标题时保存为单个待校对结构段，由用户人工划线。
            String message = novel ? "未识别到章节标题，请人工校对结构" : "未识别到场次标题，请人工校对结构";
            return new ParsedSource(text, List.of(new ParsedSection(sectionType, "待校对原文", 0, text.length(), -1, true)), message);
        }
        List<ParsedSection> sections = new ArrayList<>();
        for (int index = 0; index < starts.size(); index++) {
            // 首个标题之前的文字并入第一段，避免前言、书名页被丢弃。
            int start = index == 0 ? 0 : starts.get(index);
            int end = index + 1 < starts.size() ? starts.get(index + 1) : text.length();
            int chapterIndex = sections.size();
            sections.add(new ParsedSection(sectionType, titles.get(index), start, end, -1, false));
            if (novel) {
                appendScenes(sections, text, start, end, chapterIndex);
            }
        }
        return new ParsedSource(text, sections,
                starts.getFirst() > 0 ? "首个标题之前的文字已并入第一段，请核对边界" : "");
    }

    /**
     * 在章节范围内按明确分隔标记切分场景。
     *
     * @param sections List&lt;ParsedSection&gt; 待追加的结构段列表
     * @param text String 规范化正文
     * @param start int 章节起点
     * @param end int 章节终点
     * @param chapterIndex int 所属章节在结构段列表中的下标
     */
    private void appendScenes(List<ParsedSection> sections, String text, int start, int end, int chapterIndex) {
        Matcher divider = SCENE_DIVIDER.matcher(text);
        // 只在当前章节范围内匹配，避免跨章节匹配造成的重复扫描与越界。
        divider.region(start, end);
        List<Integer> boundaries = new ArrayList<>();
        while (divider.find()) {
            boundaries.add(divider.start());
        }
        if (boundaries.isEmpty()) {
            return;
        }
        int segmentStart = start;
        int sceneNumber = 1;
        for (int boundary : boundaries) {
            if (boundary > segmentStart) {
                sections.add(new ParsedSection("scene", "场景 " + sceneNumber++, segmentStart, boundary, chapterIndex, false));
            }
            segmentStart = boundary;
        }
        if (segmentStart < end) {
            sections.add(new ParsedSection("scene", "场景 " + sceneNumber, segmentStart, end, chapterIndex, false));
        }
    }
}

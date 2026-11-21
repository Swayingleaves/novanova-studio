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
    /** 无章节标题时按段落自动分段的单段目标字符数。 */
    private static final int AUTO_SEGMENT_LENGTH = 6000;
    /** AI章节识别候选短行最大字符数。 */
    private static final int MAX_CANDIDATE_LENGTH = 40;
    /** AI章节识别单次提交的候选短行上限。 */
    private static final int MAX_CANDIDATE_LINES = 600;
    /** 行首空白，不含换行符。 */
    private static final String INDENT = "[ \\t\\u3000]*";
    /** 章节标题格式。 */
    private static final Pattern CHAPTER = Pattern.compile(
            "(?m)^" + INDENT + "(?:第[0-9一二三四五六七八九十百千万零〇两]+[章节卷回]|Chapter[ \\t]+[0-9]+)[^\\n]{0,100}$",
            Pattern.CASE_INSENSITIVE);
    /** 纯中文数字独立行章节标题格式，如“一”“十一”。 */
    private static final Pattern BARE_CHINESE_CHAPTER = Pattern.compile(
            "(?m)^" + INDENT + "[一二三四五六七八九十百千万零〇两]+" + INDENT + "$");
    /** 纯阿拉伯数字独立行章节标题格式，如“1”“01”。 */
    private static final Pattern BARE_ARABIC_CHAPTER = Pattern.compile(
            "(?m)^" + INDENT + "[0-9]{1,4}" + INDENT + "$");
    /** 剧本场次标题格式。 */
    private static final Pattern SCRIPT_SCENE = Pattern.compile(
            "(?m)^" + INDENT + "(?:第[0-9一二三四五六七八九十百千万零〇两]+场|场次[：:]?[ \\t]*[0-9]+|(?:INT|EXT)\\.[^\\n]{1,100})[^\\n]{0,100}$",
            Pattern.CASE_INSENSITIVE);
    /** 纯装饰分隔线，不作为AI章节候选行。 */
    private static final Pattern PURE_DIVIDER = Pattern.compile("^[\\-*—–=_~·•\\s]+$");

    /** 解析后的结构段。 */
    public record ParsedSection(String sectionType, String title, int startOffset, int endOffset,
                                int parentIndex, boolean needsReview) { }

    /** 解析后的文本片段位置。 */
    public record ParsedChunk(int startOffset, int endOffset) { }

    /** 解析结果。 */
    public record ParsedSource(String text, List<ParsedSection> sections, String warning) { }

    /** AI章节识别使用的候选短行（序号从1起）。 */
    public record CandidateLine(int index, int lineNumber, int startOffset, String text) { }

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
        List<Integer> starts = new ArrayList<>();
        List<String> titles = new ArrayList<>();
        collectMatches(novel ? CHAPTER : SCRIPT_SCENE, text, starts, titles);
        if (novel && starts.isEmpty()) {
            // 未命中“第X章/Chapter”时，再按纯数字独立行识别常见无前缀章节（至少2章，避免正文孤立数字误切）。
            collectBareNumeralChapters(BARE_CHINESE_CHAPTER, text, starts, titles);
            if (starts.isEmpty()) {
                collectBareNumeralChapters(BARE_ARABIC_CHAPTER, text, starts, titles);
            }
        }
        if (starts.isEmpty()) {
            // 未识别到章节/场次标题时，按段落边界与目标字数自动分段，保证可直接阅读与分析。
            List<ParsedChunk> segments = chunks(text, 0, text.length(), AUTO_SEGMENT_LENGTH);
            List<ParsedSection> autoSections = new ArrayList<>(segments.size());
            for (int index = 0; index < segments.size(); index++) {
                ParsedChunk segment = segments.get(index);
                autoSections.add(new ParsedSection(sectionType, "片段 " + (index + 1),
                        segment.startOffset(), segment.endOffset(), -1, false));
            }
            String message = novel
                    ? "未检测到明确章节标题，已按段落自动分为 " + autoSections.size() + " 个片段，可直接分析或使用「AI 识别章节」"
                    : "未检测到场次标题，已按段落自动分为 " + autoSections.size() + " 个片段";
            return new ParsedSource(text, autoSections, message);
        }
        return buildSections(text, sectionType, starts, titles);
    }

    /**
     * 提取全书可能作为章节标题的短独立行，供AI低成本识别非标章节格式。
     * <p>
     * 过滤对话行、纯分隔线和以句末标点结尾的正文短句，显著压缩输入规模；序号从1起。
     *
     * @param text String 规范化正文
     * @return List&lt;CandidateLine&gt; 候选短行列表
     */
    public List<CandidateLine> extractChapterCandidates(String text) {
        List<CandidateLine> candidates = new ArrayList<>();
        int offset = 0;
        int lineNumber = 1;
        int length = text.length();
        while (offset < length && candidates.size() < MAX_CANDIDATE_LINES) {
            int newline = text.indexOf('\n', offset);
            int end = newline < 0 ? length : newline;
            String raw = text.substring(offset, end);
            String trimmed = raw.trim();
            if (isChapterCandidate(trimmed)) {
                candidates.add(new CandidateLine(candidates.size() + 1, lineNumber, offset, trimmed));
            }
            offset = newline < 0 ? length : newline + 1;
            lineNumber++;
        }
        return candidates;
    }

    /**
     * 根据AI选中的候选行序号切分章节结构。
     *
     * @param text String 规范化正文
     * @param sourceType String 原文类型
     * @param candidates List&lt;CandidateLine&gt; 候选短行列表
     * @param selectedIndexes List&lt;Integer&gt; 模型选中的1起序号
     * @return ParsedSource 重建后的结构化结果
     */
    public ParsedSource splitByCandidateIndexes(String text, String sourceType,
                                                List<CandidateLine> candidates, List<Integer> selectedIndexes) {
        String sectionType = "novel".equals(sourceType) ? "chapter" : "scene";
        List<Integer> validSorted = selectedIndexes.stream()
                .filter(index -> index != null && index >= 1 && index <= candidates.size())
                .distinct()
                .sorted()
                .toList();
        if (validSorted.isEmpty()) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "AI 未在原文中识别到有效的章节标题");
        }
        List<Integer> starts = new ArrayList<>(validSorted.size());
        List<String> titles = new ArrayList<>(validSorted.size());
        for (int candidateIndex : validSorted) {
            CandidateLine candidate = candidates.get(candidateIndex - 1);
            starts.add(candidate.startOffset());
            titles.add(candidate.text());
        }
        return buildSections(text, sectionType, starts, titles);
    }

    /**
     * 按已确定的标题位置列表生成顶层结构段，首个标题前的前言并入第一段。
     *
     * @param text String 规范化正文
     * @param sectionType String 结构段类型
     * @param starts List&lt;Integer&gt; 各标题起始偏移
     * @param titles List&lt;String&gt; 各标题文本
     * @return ParsedSource 结构化结果
     */
    private ParsedSource buildSections(String text, String sectionType, List<Integer> starts, List<String> titles) {
        List<ParsedSection> sections = new ArrayList<>(starts.size());
        for (int index = 0; index < starts.size(); index++) {
            // 首个标题之前的文字并入第一段，避免前言、书名页被丢弃。
            int start = index == 0 ? 0 : starts.get(index);
            int end = index + 1 < starts.size() ? starts.get(index + 1) : text.length();
            sections.add(new ParsedSection(sectionType, titles.get(index), start, end, -1, false));
        }
        return new ParsedSource(text, sections,
                starts.getFirst() > 0 ? "首个标题之前的文字已并入第一段，请核对边界" : "");
    }

    /**
     * 判断一行去除首尾空白后的文本是否具备章节标题特征。
     *
     * @param trimmed String 去除首尾空白的行文本
     * @return boolean 是否纳入AI候选
     */
    private boolean isChapterCandidate(String trimmed) {
        if (trimmed.isEmpty() || trimmed.length() > MAX_CANDIDATE_LENGTH) {
            return false;
        }
        char first = trimmed.charAt(0);
        if (first == '“' || first == '"' || first == '「' || first == '『') {
            return false;
        }
        char last = trimmed.charAt(trimmed.length() - 1);
        if ("。！？，；”’\"'…—".indexOf(last) >= 0) {
            return false;
        }
        return !PURE_DIVIDER.matcher(trimmed).matches();
    }

    /**
     * 按正则收集标题的起始偏移与去空白后的标题文本。
     *
     * @param pattern Pattern 标题匹配正则
     * @param text String 规范化正文
     * @param starts List&lt;Integer&gt; 输出的起始偏移列表
     * @param titles List&lt;String&gt; 输出的标题文本列表
     */
    private void collectMatches(Pattern pattern, String text, List<Integer> starts, List<String> titles) {
        Matcher matcher = pattern.matcher(text);
        while (matcher.find()) {
            starts.add(matcher.start());
            titles.add(matcher.group().trim());
        }
    }

    /**
     * 按纯数字独立行识别无前缀章节标题，至少命中两处才生效，避免正文中偶发孤立数字误切。
     *
     * @param pattern Pattern 纯数字章节正则
     * @param text String 规范化正文
     * @param starts List&lt;Integer&gt; 输出的起始偏移列表
     * @param titles List&lt;String&gt; 输出的标题文本列表
     */
    private void collectBareNumeralChapters(Pattern pattern, String text, List<Integer> starts, List<String> titles) {
        List<Integer> candidateStarts = new ArrayList<>();
        List<String> candidateTitles = new ArrayList<>();
        collectMatches(pattern, text, candidateStarts, candidateTitles);
        if (candidateStarts.size() >= 2) {
            starts.addAll(candidateStarts);
            titles.addAll(candidateTitles);
        }
    }
}

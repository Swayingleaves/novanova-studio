package com.novanovastudio.service;

import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.dto.ScriptSourceDtos;
import com.novanovastudio.dto.StoryBibleDtos;
import java.util.ArrayList;
import java.util.List;

/**
 * 故事知识库分析按管理员实测字符上限与章节边界规划批次。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-09-28 00:00
 */
public final class StoryBibleQuickPlanner {
    /** 单批硬上限，管理员配置只能更小。 */
    private static final int MAX_BATCH_CHARACTERS = 500_000;
    /** 单个需校验覆盖情况的章节片段上限。 */
    private static final int MAX_COVERAGE_PART_CHARACTERS = 20_000;

    /** 禁止实例化。 */
    private StoryBibleQuickPlanner() { }

    /**
     * 切分选中范围并打包为批次，不拆开UTF-16代理对。
     * @param text String 原文
     * @param sections List&lt;Section&gt; 顶层章节
     * @param ranges List&lt;int[]&gt; 已选绝对范围
     * @param configuration QuickConfiguration 管理员实测容量
     * @return List&lt;Batch&gt; 批次
     */
    public static List<Batch> plan(String text, List<ScriptSourceDtos.Section> sections, List<int[]> ranges,
                                   StoryBibleDtos.QuickConfiguration configuration) {
        int limit = Math.min(MAX_BATCH_CHARACTERS, configuration.maximumInputCharacters());
        int partLimit = Math.min(limit, MAX_COVERAGE_PART_CHARACTERS);
        List<Part> parts = new ArrayList<>();
        for (ScriptSourceDtos.Section section : sections) {
            for (int[] range : ranges) {
                int start = Math.max(section.startOffset(), range[0]);
                int end = Math.min(section.endOffset(), range[1]);
                while (start < end) {
                    int next = Math.min(start + partLimit, end);
                    if (next < end && Character.isHighSurrogate(text.charAt(next - 1))) next--;
                    String fragment = text.substring(start, next);
                    if (!fragment.isBlank()) {
                        parts.add(new Part(section.id(), section.title(), start, next, fragment));
                    }
                    start = next;
                }
            }
        }
        List<Batch> batches = new ArrayList<>();
        List<Part> current = new ArrayList<>();
        int characters = 0;
        for (Part part : parts) {
            if (!current.isEmpty() && characters + part.text().length() > limit) {
                batches.add(new Batch(batches.size(), List.copyOf(current)));
                current.clear();
                characters = 0;
            }
            current.add(part);
            characters += part.text().length();
        }
        if (!current.isEmpty()) batches.add(new Batch(batches.size(), List.copyOf(current)));
        return batches;
    }

    /** 原文片段及绝对偏移。 */
    public record Part(String sectionId, String title, int start, int end, String text) {
        /**
         * 稳定的片段标识。
         * @return String 标识
         */
        public String key() { return start + "-" + end; }

        /**
         * 转为模型请求对象。
         * @return JSONObject 输入
         */
        public JSONObject input() {
            return new JSONObject().fluentPut("sectionKey", key()).fluentPut("chapterTitle", title).fluentPut("text", text);
        }
    }

    /** 同一次模型请求的片段集合。 */
    public record Batch(int sequence, List<Part> parts) {
        /**
         * 模型请求正文。
         * @return JSONObject 输入
         */
        public JSONObject input() {
            return new JSONObject().fluentPut("requestType", "quickExtract")
                    .fluentPut("sections", parts.stream().map(Part::input).toList());
        }
    }
}

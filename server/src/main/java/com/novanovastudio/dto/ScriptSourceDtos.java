package com.novanovastudio.dto;

import java.util.List;

/**
 * 剧本与小说原文导入接口数据结构。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-09-26 00:00
 */
public final class ScriptSourceDtos {
    /** 禁止实例化。 */
    private ScriptSourceDtos() { }

    /** 上传结果。 */
    public record UploadResult(String projectId, String documentId, String taskId) { }

    /** 导入进度。 */
    public record ImportStatus(String projectId, String documentId, String taskId, String status, String stage,
                               int processedSections, int totalSections, String errorMessage, String warning,
                               String fileName, String textEncoding, long revision, Long confirmedRevision) { }

    /** 原文结构段。 */
    public record Section(String id, String parentId, String sectionType, String title, int startOffset,
                          int endOffset, int sortOrder, boolean needsReview) { }

    /** 原文目录。 */
    public record SourceTree(String documentId, String sourceType, String fileName, long revision, Long confirmedRevision,
                             String warning, List<Section> sections) { }

    /** 原文结构段正文。 */
    public record SectionDetail(Section section, String content, long revision) { }

    /** 项目标识请求。 */
    public record ProjectRequest(String projectId) { }

    /** 失败重试请求，可在编码不匹配时重新指定TXT编码。 */
    public record RetryRequest(String projectId, String encoding) { }

    /** 结构段查询请求。 */
    public record SectionRequest(String projectId, String sectionId) { }

    /** 修改标题请求。 */
    public record RenameRequest(String projectId, String sectionId, long expectedRevision, String title) { }

    /** 按段落边界拆分请求。 */
    public record SplitRequest(String projectId, String sectionId, long expectedRevision, int splitOffset, String title) { }

    /** 合并相邻同级结构段请求。 */
    public record MergeRequest(String projectId, String firstSectionId, String secondSectionId, long expectedRevision) { }

    /** 确认当前结构修订请求。 */
    public record ConfirmStructureRequest(String projectId, long expectedRevision) { }

    /** 校对完成后的修订号。 */
    public record MutationResult(long revision) { }
}

package com.novanovastudio.dto;

import jakarta.validation.constraints.*;

/**
 * 云文件元数据、列表和操作请求。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-20 12:00
 */
public final class StorageFileDtos {
    /** 禁止实例化。 */
    private StorageFileDtos() { }

    /**
     * @param fileName 上传时的原始文件名
     * @param category 文件分类
     * @param mimeType 文件媒体类型
     * @param sourceType 经过确认的文件来源
     */
    public record Metadata(String fileName, String category, String mimeType, String sourceType) { }

    /**
     * @param page 从一开始的页码
     * @param pageSize 每页数量，最多一百条
     * @param keyword 文件名搜索词
     * @param category 文件分类，空表示全部
     * @param sort newest、oldest、largest或smallest
     */
    public record ListRequest(@Min(1) Integer page, @Min(1) @Max(100) Integer pageSize,
                              @Size(max = 200) String keyword, String category, String sort) { }

    /**
     * @param objectId 本人当前空间的对象标识
     */
    public record DeleteRequest(@NotBlank @Pattern(regexp = "[1-9][0-9]{0,18}") String objectId) { }
}

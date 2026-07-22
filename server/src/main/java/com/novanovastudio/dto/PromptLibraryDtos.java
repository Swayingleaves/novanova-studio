package com.novanovastudio.dto;

import jakarta.validation.constraints.NotBlank;
import java.util.List;

/**
 * @title        PromptLibraryDtos.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  提示词库数据传输对象
 * @createTime   2026-06-29 22:10:00
 */
public final class PromptLibraryDtos {

    private PromptLibraryDtos() {
    }

    /**
     * 提示词条目。
     *
     * @param id Long 提示词ID
     * @param title String 提示词标题
     * @param coverUrl String 封面图片URL
     * @param prompt String 提示词正文
     * @param tags List<String> 标签列表
     * @param category String 分类
     * @param githubUrl String 来源地址，兼容前端旧字段名
     * @param preview String 详情预览内容
     * @param status Integer 状态：1启用，0停用
     * @param sortOrder Integer 排序值
     * @param createdAt String 创建时间
     * @param updatedAt String 更新时间
     */
    public record PromptItem(Long id,
                             String title,
                             String coverUrl,
                             String prompt,
                             List<String> tags,
                             String category,
                             String githubUrl,
                             String preview,
                             Integer status,
                             Integer sortOrder,
                             String createdAt,
                             String updatedAt) {
    }

    /**
     * 提示词列表查询请求。
     *
     * @param keyword String 关键词
     * @param tags List<String> 标签列表
     * @param category String 分类
     * @param status Integer 状态
     * @param page int 页码
     * @param pageSize int 每页数量
     */
    public record PromptListRequest(String keyword, List<String> tags, String category, Integer status, int page, int pageSize) {
    }

    /**
     * 提示词列表响应。
     *
     * @param items List<PromptItem> 提示词列表
     * @param tags List<String> 标签选项
     * @param categories List<String> 分类选项
     * @param total long 总数
     */
    public record PromptListResponse(List<PromptItem> items, List<String> tags, List<String> categories, long total) {
    }

    /**
     * 创建提示词请求。
     *
     * @param title String 提示词标题
     * @param prompt String 提示词正文
     * @param category String 分类
     * @param tags List<String> 标签列表
     * @param coverUrl String 封面图片URL
     * @param preview String 详情预览内容
     * @param sourceUrl String 来源地址
     * @param status Integer 状态
     * @param sortOrder Integer 排序值
     */
    public record CreatePromptRequest(@NotBlank(message = "标题不能为空") String title,
                                      @NotBlank(message = "提示词内容不能为空") String prompt,
                                      @NotBlank(message = "分类不能为空") String category,
                                      List<String> tags,
                                      String coverUrl,
                                      String preview,
                                      String sourceUrl,
                                      Integer status,
                                      Integer sortOrder) {
    }

    /**
     * 更新提示词请求。
     *
     * @param id Long 提示词ID
     * @param title String 提示词标题
     * @param prompt String 提示词正文
     * @param category String 分类
     * @param tags List<String> 标签列表
     * @param coverUrl String 封面图片URL
     * @param preview String 详情预览内容
     * @param sourceUrl String 来源地址
     * @param status Integer 状态
     * @param sortOrder Integer 排序值
     */
    public record UpdatePromptRequest(Long id,
                                      @NotBlank(message = "标题不能为空") String title,
                                      @NotBlank(message = "提示词内容不能为空") String prompt,
                                      @NotBlank(message = "分类不能为空") String category,
                                      List<String> tags,
                                      String coverUrl,
                                      String preview,
                                      String sourceUrl,
                                      Integer status,
                                      Integer sortOrder) {
    }

    /**
     * 更新提示词状态请求。
     *
     * @param id Long 提示词ID
     * @param status Integer 状态
     */
    public record UpdatePromptStatusRequest(Long id, Integer status) {
    }

    /**
     * 删除提示词请求。
     *
     * @param ids List<Long> 提示词ID列表
     */
    public record DeletePromptsRequest(List<Long> ids) {
    }
}

package com.novanovastudio.dto;

import jakarta.validation.constraints.NotBlank;
import java.util.List;

/**
 * 首页精选展示内容数据传输对象。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-07-18 12:00:00
 */
public final class HomepageShowcaseDtos {

    private HomepageShowcaseDtos() {
    }

    /** 首页精选内容条目 */
    public record ShowcaseItem(Long id, String title, String description, String category, String creatorName, String mediaType, String mediaUrl,
                               String thumbnailUrl, String targetType, String targetPath, String promptContent,
                               Integer sortOrder, Integer status, String createdAt, String updatedAt) {
    }

    /** 首页精选内容列表响应 */
    public record ShowcaseListResponse(List<ShowcaseItem> items, long total) {
    }

    /** 创建首页精选内容请求 */
    public record CreateShowcaseRequest(@NotBlank(message = "标题不能为空") String title,
                                        String description,
                                        @NotBlank(message = "分类不能为空") String category,
                                        @NotBlank(message = "创作者不能为空") String creatorName,
                                        @NotBlank(message = "媒体类型不能为空") String mediaType,
                                        @NotBlank(message = "媒体地址不能为空") String mediaUrl,
                                        String thumbnailUrl,
                                        @NotBlank(message = "目标类型不能为空") String targetType,
                                        String targetPath,
                                        String promptContent,
                                        Integer sortOrder,
                                        Integer status) {
    }

    /** 更新首页精选内容请求 */
    public record UpdateShowcaseRequest(Long id,
                                        @NotBlank(message = "标题不能为空") String title,
                                        String description,
                                        @NotBlank(message = "分类不能为空") String category,
                                        @NotBlank(message = "创作者不能为空") String creatorName,
                                        @NotBlank(message = "媒体类型不能为空") String mediaType,
                                        @NotBlank(message = "媒体地址不能为空") String mediaUrl,
                                        String thumbnailUrl,
                                        @NotBlank(message = "目标类型不能为空") String targetType,
                                        String targetPath,
                                        String promptContent,
                                        Integer sortOrder,
                                        Integer status) {
    }

    /** 更新首页精选内容状态请求 */
    public record UpdateShowcaseStatusRequest(Long id, Integer status) {
    }

    /** 删除首页精选内容请求 */
    public record DeleteShowcasesRequest(List<Long> ids) {
    }
}

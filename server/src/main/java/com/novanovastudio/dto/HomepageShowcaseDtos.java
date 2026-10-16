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
    public record CreateShowcaseRequest(@NotBlank(message = "business.titleIsRequired") String title,
                                        String description,
                                        @NotBlank(message = "business.categoryIsRequired") String category,
                                        @NotBlank(message = "business.creatorIsRequired") String creatorName,
                                        @NotBlank(message = "business.mediaTypeIsRequired") String mediaType,
                                        @NotBlank(message = "business.mediaURLIsRequired") String mediaUrl,
                                        String thumbnailUrl,
                                        @NotBlank(message = "business.targetTypeIsRequired") String targetType,
                                        String targetPath,
                                        String promptContent,
                                        Integer sortOrder,
                                        Integer status) {
    }

    /** 更新首页精选内容请求 */
    public record UpdateShowcaseRequest(Long id,
                                        @NotBlank(message = "business.titleIsRequired") String title,
                                        String description,
                                        @NotBlank(message = "business.categoryIsRequired") String category,
                                        @NotBlank(message = "business.creatorIsRequired") String creatorName,
                                        @NotBlank(message = "business.mediaTypeIsRequired") String mediaType,
                                        @NotBlank(message = "business.mediaURLIsRequired") String mediaUrl,
                                        String thumbnailUrl,
                                        @NotBlank(message = "business.targetTypeIsRequired") String targetType,
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

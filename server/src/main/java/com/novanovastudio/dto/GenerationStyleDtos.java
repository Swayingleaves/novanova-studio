package com.novanovastudio.dto;

import jakarta.validation.constraints.NotBlank;
import java.util.List;

/**
 * 图片和视频生成风格接口数据结构。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-31 00:00
 */
public final class GenerationStyleDtos {

    private GenerationStyleDtos() {
    }

    /**
     * 风格快照，同时用于服务端解析结果和历史轮次持久化。
     *
     * @param id 风格ID
     * @param name 风格名称
     * @param generationType 生成类型
     * @param stylePrompt 风格提示词
     */
    public record GenerationStyleSnapshot(Long id, String name, String generationType, String stylePrompt) {
    }

    /**
     * 用户侧风格选项。
     *
     * @param id 风格ID
     * @param name 风格名称
     * @param generationType 生成类型
     * @param coverUrl 封面地址
     * @param category 风格分类
     * @param thumbnailVersion 缩略图缓存版本
     */
    public record StyleOption(Long id, String name, String generationType, String coverUrl, String category, String thumbnailVersion) {
    }

    /**
     * 管理端风格条目。
     *
     * @param id 风格ID
     * @param generationType 生成类型
     * @param name 风格名称
     * @param stylePrompt 风格提示词
     * @param coverUrl 封面地址
     * @param category 风格分类
     * @param status 状态
     * @param sortOrder 排序值
     * @param createdAt 创建时间
     * @param updatedAt 更新时间
     * @param thumbnailVersion 缩略图缓存版本
     * @param coverRevision 封面并发更新版本
     */
    public record StyleItem(Long id, String generationType, String name, String stylePrompt, String coverUrl, String category,
                            Integer status, Integer sortOrder, String createdAt, String updatedAt, String thumbnailVersion, String coverRevision) {
    }

    /**
     * 管理端风格列表请求。
     *
     * @param keyword 关键词
     * @param generationType 生成类型
     * @param status 状态
     * @param page 页码
     * @param pageSize 每页数量
     */
    public record StyleListRequest(String keyword, String generationType, Integer status, int page, int pageSize) {
    }

    /**
     * 风格列表响应。
     *
     * @param styles 风格条目
     * @param total 总数
     */
    public record StyleListResponse(List<StyleItem> styles, long total) {
    }

    /**
     * 用户侧风格列表响应。
     *
     * @param styles 风格选项
     */
    public record StyleOptionListResponse(List<StyleOption> styles) {
    }

    /**
     * 创建风格请求。
     *
     * @param generationType 生成类型
     * @param name 风格名称
     * @param stylePrompt 风格提示词
     * @param coverUrl 封面地址
     * @param category 风格分类
     * @param status 状态
     * @param sortOrder 排序值
     * @param coverThumbnail 缩略图的 Base64 编码
     */
    public record CreateStyleRequest(@NotBlank(message = "business.styleTypeIsRequired") String generationType,
                                     @NotBlank(message = "business.styleNameIsRequired") String name,
                                     @NotBlank(message = "business.stylePromptIsRequired") String stylePrompt,
                                     @NotBlank(message = "business.styleCoverIsRequired") String coverUrl,
                                     @NotBlank(message = "business.styleCategoryIsRequired") String category,
                                     Integer status, Integer sortOrder, String coverThumbnail) {
    }

    /**
     * 更新风格请求。
     *
     * @param id 风格ID
     * @param generationType 生成类型
     * @param name 风格名称
     * @param stylePrompt 风格提示词
     * @param coverUrl 新封面地址，未更换封面时留空
     * @param category 风格分类
     * @param status 状态
     * @param sortOrder 排序值
     * @param coverThumbnail 更换封面时提供的 Base64 缩略图
     */
    public record UpdateStyleRequest(Long id, @NotBlank(message = "business.styleTypeIsRequired") String generationType,
                                     @NotBlank(message = "business.styleNameIsRequired") String name,
                                     @NotBlank(message = "business.stylePromptIsRequired") String stylePrompt,
                                     String coverUrl,
                                     @NotBlank(message = "business.styleCategoryIsRequired") String category,
                                     Integer status, Integer sortOrder, String coverThumbnail) {
    }

    /**
     * 仅替换风格的封面及缩略图。
     * @param id 风格标识
     * @param coverRevision 压缩前的封面版本
     * @param coverUrl 新封面地址
     * @param coverThumbnail 缩略图的 Base64 编码
     */
    public record ReplaceCoverRequest(Long id, String coverRevision, String coverUrl, String coverThumbnail) {
    }

    /**
     * 更新风格状态请求。
     *
     * @param id 风格ID
     * @param status 状态
     */
    public record UpdateStyleStatusRequest(Long id, Integer status) {
    }

    /**
     * 批量删除风格请求。
     *
     * @param ids 风格ID列表
     */
    public record DeleteStylesRequest(List<Long> ids) {
    }
}

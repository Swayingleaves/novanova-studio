package com.novanovastudio.dto;

import jakarta.validation.constraints.NotBlank;
import java.util.List;

/**
 * 图片和视频生成技能接口数据结构。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-08-27 00:00
 */
public final class SkillDtos {

    private SkillDtos() {
    }

    /**
     * 用户侧技能选项。
     *
     * @param id 技能ID
     * @param name 技能名称
     * @param description 技能简介
     * @param targetType 适用生成类型：image、video或canvasSettingGraph
     * @param aspectRatio 默认生成比例
     * @param coverUrl 封面地址
     * @param workflowType 服务端识别的视频工作流类型
     * @param systemPrompt 技能流程提示词，画布设定图节点用于保存快照
     */
    public record SkillOption(Long id, String name, String description, String targetType, String coverUrl,
                              String workflowType, String systemPrompt, String aspectRatio) {
    }

    /**
     * 管理端技能条目。
     *
     * @param id 技能ID
     * @param name 技能名称
     * @param description 技能简介
     * @param targetType 适用生成类型：image、video或canvasSettingGraph
     * @param systemPrompt 技能流程系统提示词
     * @param aspectRatio 默认生成比例
     * @param coverUrl 封面地址
     * @param status 状态
     * @param sortOrder 排序值
     * @param createdAt 创建时间
     * @param updatedAt 更新时间
     */
    public record SkillItem(Long id, String name, String description, String targetType, String systemPrompt, String coverUrl,
                            String aspectRatio, Integer status, Integer sortOrder, String createdAt, String updatedAt) {
    }

    /**
     * 管理端技能列表请求。
     *
     * @param keyword 关键词
     * @param targetType 适用生成类型：image、video或canvasSettingGraph
     * @param status 状态
     * @param page 页码
     * @param pageSize 每页数量
     */
    public record SkillListRequest(String keyword, String targetType, Integer status, int page, int pageSize) {
    }

    /**
     * 技能列表响应。
     *
     * @param skills 技能条目
     * @param total 总数
     */
    public record SkillListResponse(List<SkillItem> skills, long total) {
    }

    /**
     * 用户侧技能列表响应。
     *
     * @param skills 技能选项
     */
    public record SkillOptionListResponse(List<SkillOption> skills) {
    }

    /**
     * 创建技能请求。
     *
     * @param name 技能名称
     * @param description 技能简介
     * @param targetType 适用生成类型：image、video或canvasSettingGraph
     * @param systemPrompt 技能流程系统提示词
     * @param aspectRatio 默认生成比例
     * @param coverUrl 封面地址
     * @param status 状态
     * @param sortOrder 排序值
     */
    public record CreateSkillRequest(@NotBlank(message = "技能名称不能为空") String name,
                                     String description,
                                     @NotBlank(message = "技能类型不能为空") String targetType,
                                     @NotBlank(message = "技能系统提示词不能为空") String systemPrompt,
                                     String aspectRatio, String coverUrl,
                                     Integer status, Integer sortOrder) {
    }

    /**
     * 更新技能请求。
     *
     * @param id 技能ID
     * @param name 技能名称
     * @param description 技能简介
     * @param targetType 适用生成类型
     * @param systemPrompt 技能流程系统提示词
     * @param aspectRatio 默认生成比例
     * @param coverUrl 封面地址
     * @param status 状态
     * @param sortOrder 排序值
     */
    public record UpdateSkillRequest(Long id,
                                     @NotBlank(message = "技能名称不能为空") String name,
                                     String description,
                                     @NotBlank(message = "技能类型不能为空") String targetType,
                                     @NotBlank(message = "技能系统提示词不能为空") String systemPrompt,
                                     String aspectRatio, String coverUrl,
                                     Integer status, Integer sortOrder) {
    }

    /**
     * 更新技能状态请求。
     *
     * @param id 技能ID
     * @param status 状态
     */
    public record UpdateSkillStatusRequest(Long id, Integer status) {
    }

    /**
     * 批量删除技能请求。
     *
     * @param ids 技能ID列表
     */
    public record DeleteSkillsRequest(List<Long> ids) {
    }
}

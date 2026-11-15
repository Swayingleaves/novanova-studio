package com.novanovastudio.dto;

import com.alibaba.fastjson2.JSONObject;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

/**
 * 智能短剧工作台的请求和响应。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-11-14 00:40
 */
public final class DramaDtos {

    private DramaDtos() {
    }

    /** @param clientRequestId 稳定请求号 @param ideaText 一句话创意 @param storyText 故事正文 @param textModel 文本模型 */
    public record CreateProjectRequest(@NotBlank @Size(max = 64) String clientRequestId, @Size(max = 4000) String ideaText,
                                       @Size(max = 20000) String storyText, @NotBlank @Size(max = 200) String textModel,
                                       @Size(max = 8) String aspectRatio) {
    }

    /** @param projectId 项目ID @param revision 修订号 @param name 名称 @param textModel 文本模型 @param durationSeconds 目标秒数，不改时为空 */
    public record UpdateProjectRequest(@NotBlank String projectId, @Min(1) int revision, @NotBlank @Size(max = 120) String name,
                                       @NotBlank @Size(max = 200) String textModel, @Min(15) @Max(180) Integer durationSeconds,
                                       @Size(max = 8) String aspectRatio) {
    }

    /** @param clientRequestId 稳定请求号 @param projectId 项目ID @param revision 修订号 @param versionId 要确认的版本 */
    public record ConfirmStageRequest(@NotBlank @Size(max = 64) String clientRequestId, @NotBlank String projectId,
                                      @Min(1) int revision, @NotBlank String versionId) {
    }

    /** @param clientRequestId 稳定请求号 @param projectId 项目ID @param revision 修订号 @param message 用户消息 @param viewedStage 正在查看的阶段 @param imageModel 出图使用的模型 @param videoModel 出视频使用的模型 @param imageQuality 图片质量 @param imageResolution 图片分辨率 @param videoResolution 视频分辨率 */
    public record SendMessageRequest(@NotBlank @Size(max = 64) String clientRequestId, @NotBlank String projectId, @Min(1) int revision,
                                     @NotBlank @Size(max = 4000) String message, String viewedStage,
                                     String imageModel, String videoModel, String imageQuality, String imageResolution, String videoResolution) {
    }

    /** @param projectId 项目ID @param revision 修订号 */
    public record DeleteProjectRequest(@NotBlank String projectId, @Min(1) int revision) {
    }

    /** @param projectId 项目ID @param taskId 已成功的视频合成任务 */
    public record SaveCutRequest(@NotBlank String projectId, @NotBlank @Size(max = 64) String taskId) {
    }

    /**
     * 为当前阶段里的一个角色、场景或镜头提交真实的图片或视频任务。
     *
     * @param clientRequestId 稳定请求号
     * @param projectId 项目ID
     * @param versionId 提示词所在的阶段版本
     * @param targetKey 生成目标
     * @param model 图片或视频模型
     * @param parameters 清晰度、比例和时长，服务端会补齐缺省值
     * @param prompt 已由 Agent 写好的提示词，为空时由短剧提示词 Agent 现写
     * @param referenceKeys 参考图顺序，为空时由短剧提示词 Agent 决定
     */
    public record GenerateMediaRequest(@NotBlank @Size(max = 64) String clientRequestId, @NotBlank String projectId,
                                       @NotBlank String versionId, @NotBlank @Size(max = 80) String targetKey,
                                       @NotBlank @Size(max = 200) String model, Map<String, Object> parameters,
                                       @Size(max = 8000) String prompt, List<String> referenceKeys) {
    }

    /** @param projects 当前页 @param total 总数 */
    public record ProjectListResponse(List<ProjectView> projects, long total) {
    }

    /** @param id 项目ID @param name 名称 @param currentStage 当前阶段 @param status 状态 @param revision 修订号 @param textModel 模型 @param textCredits 文本积分 @param durationSeconds 时长 @param updatedAt 更新时间 */
    public record ProjectView(String id, String name, String currentStage, String status, int revision, String textModel,
                              BigDecimal textCredits, int durationSeconds, String aspectRatio, String updatedAt) {
    }

    /** @param project 项目 @param versions 全部版本 @param activeRequest 活动请求 @param media 图片和视频生成记录，新的在前 */
    public record WorkspaceResponse(ProjectDetail project, List<VersionView> versions, ActiveRequest activeRequest, List<MediaView> media) {
    }

    /** @param id 记录ID @param versionId 来源版本 @param targetKey 生成目标 @param mediaType 图片或视频 @param taskId 任务ID @param model 模型 @param status 状态 @param url 可预览地址 @param storageKey 存储键 @param mimeType 媒体类型 @param errorMessage 失败说明 @param createdAt 创建时间 */
    public record MediaView(String id, String versionId, String targetKey, String mediaType, String taskId, String model,
                            String status, String url, String storageKey, String mimeType, String errorMessage, String createdAt) {
    }

    /** @param id 项目ID @param name 名称 @param ideaText 创意 @param storyText 正文 @param textModel 模型 @param sessionId 会话 @param currentStage 当前阶段 @param status 状态 @param revision 修订号 @param durationSeconds 时长 @param textCredits 文本积分 @param updatedAt 更新时间 */
    public record ProjectDetail(String id, String name, String ideaText, String storyText, String textModel, String sessionId,
                                String currentStage, String status, int revision, int durationSeconds, String aspectRatio,
                                BigDecimal textCredits, String updatedAt) {
    }

    /** @param id 版本ID @param stage 阶段 @param versionNumber 版本号 @param confirmationStatus 确认状态 @param freshness 新鲜度 @param content 产物 @param createdAt 创建时间 @param confirmedAt 确认时间 */
    public record VersionView(String id, String stage, int versionNumber, String confirmationStatus, String freshness,
                              JSONObject content, String createdAt, String confirmedAt) {
    }

    /** @param requestId 请求ID @param status 状态 @param message 终态说明 */
    public record ActiveRequest(String requestId, String status, String message) {
    }
}

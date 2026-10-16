package com.novanovastudio.dto;

import com.novanovastudio.common.SystemMessage;

import com.alibaba.fastjson2.JSONObject;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;
import java.util.List;

/**
 * 视频合成任务接口数据结构。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-08-11 00:00
 */
public final class VideoCompositionDtos {

    /**
     * 禁止实例化工具类。
     */
    private VideoCompositionDtos() {
    }

    /**
     * 创建视频合成任务请求。
     *
     * @param sourceStorageKeys List<String> 按合成顺序排列的源视频媒体存储键
     */
    public record CreateVideoCompositionRequest(
            @NotEmpty(message = "business.atLeastTwoVideosAreRequired")
            @Size(min = 2, max = 20, message = "business.atMost20VideosPerComposition")
            List<@NotBlank(message = "business.videoStorageKeyIsRequired") String> sourceStorageKeys) {
    }

    /**
     * 视频合成任务ID请求。
     *
     * @param taskId String 任务ID
     */
    public record VideoCompositionTaskIdRequest(@NotBlank(message = "business.taskIDIsRequired") String taskId) {
    }

    /** 创建分镜板成片导出任务。 */
    public record ExportStoryboardVideoRequest(@NotBlank String projectId, String episodeId) {
    }

    /** 查询项目最近导出任务。 */
    public record LatestStoryboardExportRequest(@NotBlank String projectId) {
    }

    /** 最近任务可能不存在时的查询响应。 */
    public record LatestStoryboardExportResponse(VideoCompositionTaskResponse task) {
    }

    /**
     * 视频合成任务响应。
     *
     * @param id String 任务ID
     * @param status String 任务状态
     * @param progress Integer 任务进度
     * @param sourceStorageKeys List<String> 源视频媒体存储键
     * @param resultData JSONObject 合成结果媒体数据
     * @param errorMessage String 错误信息
     * @param systemMessage SystemMessage 与语言无关的错误说明
     * @param startedAt String 开始时间
     * @param completedAt String 完成时间
     * @param createdAt String 创建时间
     * @param updatedAt String 更新时间
     */
    public record VideoCompositionTaskResponse(String id,
                                               String status,
                                               Integer progress,
                                               List<String> sourceStorageKeys,
                                               JSONObject resultData,
                                               String errorMessage,
                                               SystemMessage systemMessage,
                                               String startedAt,
                                               String completedAt,
                                               String createdAt,
                                               String updatedAt) {
        /**
         * 按当前请求语言生成系统提示。
         * @param locale java.util.Locale 当前请求语言
         * @return VideoCompositionTaskResponse 当前语言任务快照
         */
        public VideoCompositionTaskResponse withLocale(java.util.Locale locale) {
            return new VideoCompositionTaskResponse(id, status, progress, sourceStorageKeys, resultData, systemMessage == null ? errorMessage : systemMessage.render(locale), systemMessage, startedAt, completedAt, createdAt, updatedAt);
        }
    }
}

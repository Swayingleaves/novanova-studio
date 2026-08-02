package com.novanovastudio.dto;

import com.alibaba.fastjson2.JSONObject;
import jakarta.validation.constraints.NotBlank;
import java.util.List;
import java.util.Map;

/**
 * @title        AiTaskDtos.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  AI任务DTO
 * @createTime   2026-06-24 11:02:00
 */
public final class AiTaskDtos {

    /**
     * 禁止实例化
     */
    private AiTaskDtos() {
    }

    /**
     * 任务媒体引用
     *
     * @param id String 引用ID
     * @param name String 引用名称
     * @param mimeType String MIME类型
     * @param storageKey String 后端媒体存储键
     * @param url String 公网URL或远程URL
     */
    public record AiTaskMediaReference(String id, String name, String mimeType, String storageKey, String url) {
    }

    /**
     * 创建AI生成任务请求
     *
     * @param taskType String 任务类型
     * @param prompt String 提示词
     * @param model String 模型名称
     * @param parameters Map<String, Object> 参数
     * @param references List<AiTaskMediaReference> 图片引用
     * @param videoReferences List<AiTaskMediaReference> 视频引用
     * @param generationSource String 生成来源
     */
    public record CreateAiTaskRequest(@NotBlank(message = "任务类型不能为空") String taskType,
                                      @NotBlank(message = "提示词不能为空") String prompt,
                                      String model,
                                      Map<String, Object> parameters,
                                      List<AiTaskMediaReference> references,
                                      List<AiTaskMediaReference> videoReferences,
                                      String generationSource,
                                      List<Long> generationStyleIds,
                                      List<GenerationStyleDtos.GenerationStyleSnapshot> generationStyleSnapshots) {
        public CreateAiTaskRequest(String taskType, String prompt, String model, Map<String, Object> parameters,
                                   List<AiTaskMediaReference> references, List<AiTaskMediaReference> videoReferences,
                                   String generationSource) {
            this(taskType, prompt, model, parameters, references, videoReferences, generationSource, null, null);
        }
    }

    /**
     * AI任务ID请求
     *
     * @param taskId String 任务ID
     */
    public record AiTaskIdRequest(@NotBlank(message = "任务ID不能为空") String taskId) {
    }

    /**
     * AI任务响应
     *
     * @param id String 任务ID
     * @param taskType String 任务类型
     * @param model String 模型名称
     * @param provider String 渠道名称
     * @param status String 任务状态
     * @param progress Integer 进度
     * @param requestData JSONObject 请求摘要
     * @param resultData JSONObject 结果数据
     * @param errorMessage String 错误信息
     * @param startedAt String 开始时间
     * @param completedAt String 完成时间
     * @param createdAt String 创建时间
     * @param updatedAt String 更新时间
     */
    public record AiGenerationTaskResponse(String id,
                                           String taskType,
                                           String model,
                                           String provider,
                                           String status,
                                           Integer progress,
                                           JSONObject requestData,
                                           JSONObject resultData,
                                           String errorMessage,
                                           String startedAt,
                                           String completedAt,
                                           String createdAt,
                                           String updatedAt) {
    }

    /**
     * AI任务列表响应
     *
     * @param tasks List<AiGenerationTaskResponse> 任务列表
     */
    public record AiTaskListResponse(List<AiGenerationTaskResponse> tasks) {
    }

    /**
     * AI任务SSE事件
     *
     * @param type String 事件类型，取值为task、ping、text-delta、credit-balance
     * @param task AiGenerationTaskResponse 任务信息，text-delta事件携带精简快照用于关联任务
     * @param delta String 流式文本增量片段，仅text-delta事件使用，其它事件为null
     * @param creditBalance Integer 可用积分，仅credit-balance事件使用，其它事件为null
     */
    public record AiTaskEvent(String type, AiGenerationTaskResponse task, String delta, Integer creditBalance) {

        /**
         * 构造任务状态事件，delta默认为null
         *
         * @param type String 事件类型
         * @param task AiGenerationTaskResponse 任务信息
         */
        public AiTaskEvent(String type, AiGenerationTaskResponse task) {
            this(type, task, null, null);
        }

        /**
         * 构造携带文本增量的任务事件，积分余额默认为null。
         *
         * @param type String 事件类型
         * @param task AiGenerationTaskResponse 任务信息
         * @param delta String 文本增量
         */
        public AiTaskEvent(String type, AiGenerationTaskResponse task, String delta) {
            this(type, task, delta, null);
        }
    }

    /**
     * AI模型选项
     *
     * @param value String 模型值
     * @param label String 显示名称
     * @param capability String 能力
     * @param provider String 渠道
     * @param apiFormat String 渠道调用格式
     * @param defaultModel Boolean 是否为默认模型
     * @param creditCost Integer 单次生成消耗积分
     */
    public record AiModelOption(String value, String label, String capability, String provider, String apiFormat, Boolean defaultModel, Integer creditCost) {
    }

    /**
     * AI模型列表响应
     *
     * @param models List<AiModelOption> 全部模型
     * @param imageModels List<String> 生图模型
     * @param videoModels List<String> 视频模型
     * @param textModels List<String> 文本模型
     */
    public record AiModelListResponse(List<AiModelOption> models, List<String> imageModels, List<String> videoModels, List<String> textModels) {
    }

    /**
     * AI渠道配置
     *
     * @param id String 渠道ID
     * @param name String 渠道名称
     * @param baseUrl String 基础URL
     * @param apiKey String API Key
     * @param apiFormat String 调用格式
     * @param models List<String> 模型列表
     */
    public record AiChannelConfig(String id, String name, String baseUrl, String apiKey, String apiFormat, List<String> models) {
    }
}

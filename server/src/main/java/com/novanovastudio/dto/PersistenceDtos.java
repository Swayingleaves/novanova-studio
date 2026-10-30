package com.novanovastudio.dto;

import com.alibaba.fastjson2.annotation.JSONField;
import com.novanovastudio.common.CreditAmountWriter;
import java.math.BigDecimal;

import com.alibaba.fastjson2.JSONObject;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import java.util.List;
import java.util.Map;

/**
 * @title        PersistenceDtos.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  业务持久化DTO
 * @createTime   2026-06-24 11:02:00
 */
public final class PersistenceDtos {

    /**
     * 禁止实例化
     */
    private PersistenceDtos() {
    }

    /** 渠道标识请求。 */
    public record ChannelIdRequest(@NotBlank(message = "business.channelIDIsRequired") String channelId) {
    }

    /** 渠道创建或修改请求。 */
    public record ChannelMutationRequest(String id, @NotNull(message = "business.channelNameMustNotBeNull") String name,
                                         String baseUrl, String apiKey,
                                         @NotBlank(message = "business.aPIFormatIsRequired") String apiFormat,
                                         List<String> models, Integer sortOrder) {
    }

    /** 渠道模型拉取请求。 */
    public record ChannelModelRefreshRequest(@NotBlank(message = "business.baseURLIsRequired") String baseUrl,
                                             @NotBlank(message = "business.aPIKeyIsRequired") String apiKey,
                                             @NotBlank(message = "business.aPIFormatIsRequired") String apiFormat) {
    }

    /** 渠道模型拉取响应。 */
    public record ChannelModelRefreshResponse(List<String> models) {
    }

    /**
     * 自定义模型单能力/模式分组配置。
     *
     * @param requestPath String 请求路径，以/开头，与渠道baseUrl拼接，支持{{taskId}}占位符
     * @param requestMethod String 请求方法，GET或POST，默认POST
     * @param requestModelName String 该模式请求体{{model}}占位符使用的模型名称
     * @param requestTemplate String 请求体JSON模板，支持{{prompt}}等占位符，POST且未配置AI构造提示词时必填
     * @param aiRequestPrompt String AI构造请求体提示词，配置后由Agent按提示词与本次参数生成请求体，替代模板拼接
     * @param responseExample String 响应示例JSON，展示用
     * @param resultPath String 提交响应中媒体地址的点分路径，如data.image.url
     * @param queryPath String 异步查询路径，以/开头，支持{{taskId}}或{{task_id}}占位符，视频异步轮询时使用
     * @param queryMethod String 异步查询方法，GET或POST，默认POST
     * @param queryRequestTemplate String 查询请求体JSON模板，支持{{taskId}}，POST查询且未配置AI构造提示词时必填
     * @param aiQueryPrompt String AI构造查询请求体提示词，配置后由Agent生成查询请求体
     * @param queryResponseExample String 查询响应示例JSON，展示用
     * @param queryResultPath String 查询响应中媒体地址的点分路径
     * @param videoGenerationConstraints VideoGenerationConstraints 自定义视频模式的必填生成限制
     * @param asyncQuery Boolean 图片能力是否执行异步查询：true时提交响应按结果路径取出任务ID后轮询查询接口，
     *                   null或false为同步（残留的查询字段原样保留但不生效）；视频沿用查询字段非空即异步的判断，恒为null
     */
    public record CustomModelGroupConfig(String requestPath, String requestMethod, String requestModelName,
                                         String requestTemplate, String aiRequestPrompt, String responseExample,
                                         String resultPath, String queryPath, String queryMethod,
                                         String queryRequestTemplate, String aiQueryPrompt, String queryResponseExample,
                                         String queryResultPath, VideoGenerationConstraints videoGenerationConstraints,
                                         Boolean asyncQuery) {
        /**
         * 构造不包含视频限制的图片调用配置。
         * @param requestPath String 请求路径
         * @param requestMethod String 请求方法
         * @param requestModelName String 请求模型名称
         * @param requestTemplate String 请求模板
         * @param aiRequestPrompt String 请求构造提示词
         * @param responseExample String 响应示例
         * @param resultPath String 结果路径
         * @param queryPath String 查询路径
         * @param queryMethod String 查询方法
         * @param queryRequestTemplate String 查询模板
         * @param aiQueryPrompt String 查询构造提示词
         * @param queryResponseExample String 查询响应示例
         * @param queryResultPath String 查询结果路径
         */
        public CustomModelGroupConfig(String requestPath, String requestMethod, String requestModelName,
                String requestTemplate, String aiRequestPrompt, String responseExample, String resultPath,
                String queryPath, String queryMethod, String queryRequestTemplate, String aiQueryPrompt,
                String queryResponseExample, String queryResultPath) {
            this(requestPath, requestMethod, requestModelName, requestTemplate, aiRequestPrompt, responseExample,
                    resultPath, queryPath, queryMethod, queryRequestTemplate, aiQueryPrompt, queryResponseExample, queryResultPath, null, null);
        }
    }

    /**
     * 用户模型配置。
     *
     * @param convertImageSizeToPixels Boolean 图片size是否按分辨率转换为像素尺寸，默认关闭
     * @param imageSizeMappings Map<String, Map<String, String>> 图片比例与档位的像素映射，null使用系统默认表
     * @param imageBillingConfiguration ImageBillingConfiguration 图片1K、2K、4K分辨率价目表，null沿用模型单价
     * @param enabled Boolean 模型是否开启，关闭后不出现在用户的模型下拉选择中
     */
    public record ModelConfig(String id, String channelId, String modelName, String modelType,
                              List<String> capabilities, Boolean defaultModel, Integer sortOrder, @jakarta.validation.constraints.Digits(integer = 18, fraction = 6) @JSONField(serializeUsing = CreditAmountWriter.class) BigDecimal creditCost,
                              Boolean thinkingEnabled, String reasoningEffort, String creditUnit, Integer requestConcurrency,
                              JSONObject customBodyParameters, VideoBillingConfiguration videoBillingConfiguration, String displayName,
                              String modelIcon, Boolean isCustomModel, Map<String, CustomModelGroupConfig> customModelConfig, Long ownerTeamId,
                              Boolean convertImageSizeToPixels, Map<String, Map<String, String>> imageSizeMappings,
                              ImageBillingConfiguration imageBillingConfiguration, Boolean enabled) {
        /** 保持旧调用方不配置图片分辨率价目表。 */
        public ModelConfig(String id, String channelId, String modelName, String modelType,
                              List<String> capabilities, Boolean defaultModel, Integer sortOrder, @jakarta.validation.constraints.Digits(integer = 18, fraction = 6) BigDecimal creditCost,
                              Boolean thinkingEnabled, String reasoningEffort, String creditUnit, Integer requestConcurrency,
                              JSONObject customBodyParameters, VideoBillingConfiguration videoBillingConfiguration, String displayName,
                              String modelIcon, Boolean isCustomModel, Map<String, CustomModelGroupConfig> customModelConfig, Long ownerTeamId,
                              Boolean convertImageSizeToPixels, Map<String, Map<String, String>> imageSizeMappings) {
            this(id, channelId, modelName, modelType, capabilities, defaultModel, sortOrder, creditCost, thinkingEnabled,
                    reasoningEffort, creditUnit, requestConcurrency, customBodyParameters, videoBillingConfiguration, displayName,
                    modelIcon, isCustomModel, customModelConfig, ownerTeamId, convertImageSizeToPixels, imageSizeMappings, null, Boolean.TRUE);
        }

        /**
         * 创建平台模型展示记录。
         * @param id 模型配置字段
         * @param channelId 模型配置字段
         * @param modelName 模型配置字段
         * @param modelType 模型配置字段
         * @param capabilities 模型配置字段
         * @param defaultModel 模型配置字段
         * @param sortOrder 模型配置字段
         * @param creditCost 模型配置字段
         * @param thinkingEnabled 模型配置字段
         * @param reasoningEffort 模型配置字段
         * @param creditUnit 模型配置字段
         * @param requestConcurrency 模型配置字段
         * @param customBodyParameters 模型配置字段
         * @param videoBillingConfiguration 模型配置字段
         * @param displayName 模型配置字段
         * @param modelIcon 模型配置字段
         * @param isCustomModel 模型配置字段
         * @param customModelConfig 模型配置字段
         */
        public ModelConfig(String id, String channelId, String modelName, String modelType,
                              List<String> capabilities, Boolean defaultModel, Integer sortOrder, @jakarta.validation.constraints.Digits(integer = 18, fraction = 6) BigDecimal creditCost,
                              Boolean thinkingEnabled, String reasoningEffort, String creditUnit, Integer requestConcurrency,
                              JSONObject customBodyParameters, VideoBillingConfiguration videoBillingConfiguration, String displayName,
                              String modelIcon, Boolean isCustomModel, Map<String, CustomModelGroupConfig> customModelConfig) {
            this(id, channelId, modelName, modelType, capabilities, defaultModel, sortOrder, creditCost, thinkingEnabled, reasoningEffort, creditUnit, requestConcurrency, customBodyParameters, videoBillingConfiguration, displayName, modelIcon, isCustomModel, customModelConfig, 0L, false, null, null, Boolean.TRUE);
        }
        /** 保持旧调用方使用空视频分档计费配置。 */
        public ModelConfig(String id, String channelId, String modelName, String modelType,
                           List<String> capabilities, Boolean defaultModel, Integer sortOrder, @jakarta.validation.constraints.Digits(integer = 18, fraction = 6) BigDecimal creditCost,
                           Boolean thinkingEnabled, String reasoningEffort, String creditUnit, Integer requestConcurrency,
                           JSONObject customBodyParameters) {
            this(id, channelId, modelName, modelType, capabilities, defaultModel, sortOrder, creditCost,
                    thinkingEnabled, reasoningEffort, creditUnit, requestConcurrency, customBodyParameters, null, null, null, false, null);
        }

        /** 保持旧调用方使用空自定义请求体参数。 */
        public ModelConfig(String id, String channelId, String modelName, String modelType,
                           List<String> capabilities, Boolean defaultModel, Integer sortOrder, @jakarta.validation.constraints.Digits(integer = 18, fraction = 6) BigDecimal creditCost,
                           Boolean thinkingEnabled, String reasoningEffort, String creditUnit, Integer requestConcurrency) {
            this(id, channelId, modelName, modelType, capabilities, defaultModel, sortOrder, creditCost,
                    thinkingEnabled, reasoningEffort, creditUnit, requestConcurrency, new JSONObject(), null, null, null, false, null);
        }

        /** 保持旧调用方使用默认并发数。 */
        public ModelConfig(String id, String channelId, String modelName, String modelType,
                           List<String> capabilities, Boolean defaultModel, Integer sortOrder, @jakarta.validation.constraints.Digits(integer = 18, fraction = 6) BigDecimal creditCost,
                           Boolean thinkingEnabled, String reasoningEffort, String creditUnit) {
            this(id, channelId, modelName, modelType, capabilities, defaultModel, sortOrder, creditCost,
                    thinkingEnabled, reasoningEffort, creditUnit, 1, new JSONObject(), null, null, null, false, null);
        }

        /** 保持旧调用方按次计费。 */
        public ModelConfig(String id, String channelId, String modelName, String modelType,
                           List<String> capabilities, Boolean defaultModel, Integer sortOrder, @jakarta.validation.constraints.Digits(integer = 18, fraction = 6) BigDecimal creditCost,
                           Boolean thinkingEnabled, String reasoningEffort) {
            this(id, channelId, modelName, modelType, capabilities, defaultModel, sortOrder, creditCost,
                    thinkingEnabled, reasoningEffort, "generation", 1, new JSONObject(), null, null, null, false, null);
        }
    }

    /** 模型配置列表响应。 */
    public record ModelConfigListResponse(List<ModelConfig> modelConfigs) {
    }

    /**
     * 创建用户模型配置请求。
     *
     * @param convertImageSizeToPixels Boolean 图片size是否按分辨率转换为像素尺寸，默认关闭
     * @param imageSizeMappings Map<String, Map<String, String>> 图片比例与档位的像素映射，null使用系统默认表
     */
    public record CreateModelConfigRequest(@NotBlank(message = "business.channelIDIsRequired") String channelId,
                                           @NotBlank(message = "business.modelNameIsRequired") String modelName,
                                           @NotBlank(message = "business.modelTypeIsRequired") String modelType,
                                           List<String> capabilities, Integer sortOrder,
                                           @Min(value = 0, message = "business.modelCreditsMustNotBeNegative") @jakarta.validation.constraints.Digits(integer = 18, fraction = 6) @JSONField(serializeUsing = CreditAmountWriter.class) BigDecimal creditCost,
                                           Boolean thinkingEnabled,
                                           @Pattern(regexp = "high|max", message = "business.thinkingIntensityMustBeHighOrMax") String reasoningEffort,
                                           @Pattern(regexp = "generation|second", message = "business.billingUnitMustBeGenerationOrSecond") String creditUnit,
                                           @Min(value = 1, message = "business.modelConcurrencyMustBeAtLeast1") Integer requestConcurrency,
                                           JSONObject customBodyParameters,
                                           VideoBillingConfiguration videoBillingConfiguration,
                                           String displayName,
                                           String modelIcon,
                                           Boolean isCustomModel,
                                           Map<String, CustomModelGroupConfig> customModelConfig,
                                           Boolean convertImageSizeToPixels, Map<String, Map<String, String>> imageSizeMappings,
                                           ImageBillingConfiguration imageBillingConfiguration, Boolean enabled) {
        /** 保持旧调用方使用空视频分档计费配置。 */
        public CreateModelConfigRequest(String channelId, String modelName, String modelType, List<String> capabilities,
                                        Integer sortOrder, @jakarta.validation.constraints.Digits(integer = 18, fraction = 6) BigDecimal creditCost, Boolean thinkingEnabled, String reasoningEffort,
                                        String creditUnit, Integer requestConcurrency, JSONObject customBodyParameters) {
            this(channelId, modelName, modelType, capabilities, sortOrder, creditCost, thinkingEnabled, reasoningEffort,
                    creditUnit, requestConcurrency, customBodyParameters, null, null, null, false, null, false, null, null, Boolean.TRUE);
        }

        /** 保持旧调用方不配置图片分辨率价目表。 */
        public CreateModelConfigRequest(String channelId, String modelName, String modelType, List<String> capabilities,
                                        Integer sortOrder, @jakarta.validation.constraints.Digits(integer = 18, fraction = 6) BigDecimal creditCost, Boolean thinkingEnabled, String reasoningEffort,
                                        String creditUnit, Integer requestConcurrency, JSONObject customBodyParameters,
                                        VideoBillingConfiguration videoBillingConfiguration, String displayName, String modelIcon,
                                        Boolean isCustomModel, Map<String, CustomModelGroupConfig> customModelConfig,
                                        Boolean convertImageSizeToPixels, Map<String, Map<String, String>> imageSizeMappings) {
            this(channelId, modelName, modelType, capabilities, sortOrder, creditCost, thinkingEnabled, reasoningEffort,
                    creditUnit, requestConcurrency, customBodyParameters, videoBillingConfiguration, displayName, modelIcon,
                    isCustomModel, customModelConfig, convertImageSizeToPixels, imageSizeMappings, null, Boolean.TRUE);
        }

        /** 保持旧调用方使用空自定义请求体参数。 */
        public CreateModelConfigRequest(String channelId, String modelName, String modelType, List<String> capabilities,
                                        Integer sortOrder, @jakarta.validation.constraints.Digits(integer = 18, fraction = 6) BigDecimal creditCost, Boolean thinkingEnabled, String reasoningEffort,
                                        String creditUnit, Integer requestConcurrency) {
            this(channelId, modelName, modelType, capabilities, sortOrder, creditCost, thinkingEnabled, reasoningEffort,
                    creditUnit, requestConcurrency, new JSONObject(), null, null, null, false, null, false, null, null, Boolean.TRUE);
        }

        /** 保持旧调用方使用默认并发数。 */
        public CreateModelConfigRequest(String channelId, String modelName, String modelType, List<String> capabilities,
                                        Integer sortOrder, @jakarta.validation.constraints.Digits(integer = 18, fraction = 6) BigDecimal creditCost, Boolean thinkingEnabled, String reasoningEffort,
                                        String creditUnit) {
            this(channelId, modelName, modelType, capabilities, sortOrder, creditCost, thinkingEnabled, reasoningEffort,
                    creditUnit, 1, new JSONObject(), null, null, null, false, null, false, null, null, Boolean.TRUE);
        }

        /** 保持旧调用方按次计费。 */
        public CreateModelConfigRequest(String channelId, String modelName, String modelType, List<String> capabilities,
                                        Integer sortOrder, @jakarta.validation.constraints.Digits(integer = 18, fraction = 6) BigDecimal creditCost, Boolean thinkingEnabled, String reasoningEffort) {
            this(channelId, modelName, modelType, capabilities, sortOrder, creditCost, thinkingEnabled, reasoningEffort,
                    "generation", 1, new JSONObject(), null, null, null, false, null, false, null, null, Boolean.TRUE);
        }
    }

    /**
     * 修改用户模型配置请求。
     *
     * @param convertImageSizeToPixels Boolean 图片size是否按分辨率转换为像素尺寸，默认关闭
     * @param imageSizeMappings Map<String, Map<String, String>> 图片比例与档位的像素映射，null使用系统默认表
     */
    public record UpdateModelConfigRequest(@NotBlank(message = "business.modelConfigurationIDIsRequired") String id,
                                           @NotBlank(message = "business.modelTypeIsRequired") String modelType,
                                           List<String> capabilities, Integer sortOrder,
                                           @Min(value = 0, message = "business.modelCreditsMustNotBeNegative") @jakarta.validation.constraints.Digits(integer = 18, fraction = 6) @JSONField(serializeUsing = CreditAmountWriter.class) BigDecimal creditCost,
                                           Boolean thinkingEnabled,
                                           @Pattern(regexp = "high|max", message = "business.thinkingIntensityMustBeHighOrMax") String reasoningEffort,
                                           @Pattern(regexp = "generation|second", message = "business.billingUnitMustBeGenerationOrSecond") String creditUnit,
                                           @Min(value = 1, message = "business.modelConcurrencyMustBeAtLeast1") Integer requestConcurrency,
                                           JSONObject customBodyParameters,
                                           VideoBillingConfiguration videoBillingConfiguration,
                                           String displayName,
                                           String modelIcon,
                                           Boolean isCustomModel,
                                           Map<String, CustomModelGroupConfig> customModelConfig,
                                           Boolean convertImageSizeToPixels, Map<String, Map<String, String>> imageSizeMappings,
                                           ImageBillingConfiguration imageBillingConfiguration, Boolean enabled) {
        /** 保持旧调用方不配置图片分辨率价目表。 */
        public UpdateModelConfigRequest(String id, String modelType, List<String> capabilities, Integer sortOrder,
                                        @jakarta.validation.constraints.Digits(integer = 18, fraction = 6) BigDecimal creditCost, Boolean thinkingEnabled, String reasoningEffort, String creditUnit,
                                        Integer requestConcurrency, JSONObject customBodyParameters, VideoBillingConfiguration videoBillingConfiguration,
                                        String displayName, String modelIcon, Boolean isCustomModel, Map<String, CustomModelGroupConfig> customModelConfig,
                                        Boolean convertImageSizeToPixels, Map<String, Map<String, String>> imageSizeMappings) {
            this(id, modelType, capabilities, sortOrder, creditCost, thinkingEnabled, reasoningEffort, creditUnit,
                    requestConcurrency, customBodyParameters, videoBillingConfiguration, displayName, modelIcon, isCustomModel,
                    customModelConfig, convertImageSizeToPixels, imageSizeMappings, null, Boolean.TRUE);
        }

        /** 保持旧调用方使用空视频分档计费配置。 */
        public UpdateModelConfigRequest(String id, String modelType, List<String> capabilities, Integer sortOrder,
                                        @jakarta.validation.constraints.Digits(integer = 18, fraction = 6) BigDecimal creditCost, Boolean thinkingEnabled, String reasoningEffort, String creditUnit,
                                        Integer requestConcurrency, JSONObject customBodyParameters) {
            this(id, modelType, capabilities, sortOrder, creditCost, thinkingEnabled, reasoningEffort, creditUnit,
                    requestConcurrency, customBodyParameters, null, null, null, false, null, false, null, null, Boolean.TRUE);
        }

        /** 保持旧调用方使用空自定义请求体参数。 */
        public UpdateModelConfigRequest(String id, String modelType, List<String> capabilities, Integer sortOrder,
                                        @jakarta.validation.constraints.Digits(integer = 18, fraction = 6) BigDecimal creditCost, Boolean thinkingEnabled, String reasoningEffort, String creditUnit,
                                        Integer requestConcurrency) {
            this(id, modelType, capabilities, sortOrder, creditCost, thinkingEnabled, reasoningEffort, creditUnit,
                    requestConcurrency, new JSONObject(), null, null, null, false, null, false, null, null, Boolean.TRUE);
        }

        /** 保持旧调用方省略并发数时沿用原配置。 */
        public UpdateModelConfigRequest(String id, String modelType, List<String> capabilities, Integer sortOrder,
                                        @jakarta.validation.constraints.Digits(integer = 18, fraction = 6) BigDecimal creditCost, Boolean thinkingEnabled, String reasoningEffort, String creditUnit) {
            this(id, modelType, capabilities, sortOrder, creditCost, thinkingEnabled, reasoningEffort, creditUnit,
                    null, new JSONObject(), null, null, null, false, null, false, null, null, Boolean.TRUE);
        }

        /** 保持旧调用方按次计费。 */
        public UpdateModelConfigRequest(String id, String modelType, List<String> capabilities, Integer sortOrder,
                                        @jakarta.validation.constraints.Digits(integer = 18, fraction = 6) BigDecimal creditCost, Boolean thinkingEnabled, String reasoningEffort) {
            this(id, modelType, capabilities, sortOrder, creditCost, thinkingEnabled, reasoningEffort,
                    "generation", null, new JSONObject(), null, null, null, false, null, false, null, null, Boolean.TRUE);
        }
    }

    /** 设置默认模型请求。 */
    public record SetDefaultModelRequest(@NotBlank(message = "business.modelConfigurationIDIsRequired") String id,
                                         @NotBlank(message = "business.modelTypeIsRequired") String modelType) {
    }

    /**
     * 保存画布项目请求
     *
     * @param project JSONObject 画布项目JSON
     */
    public record SaveProjectRequest(@NotNull(message = "business.canvasProjectIsRequired") JSONObject project) {
    }

    /**
     * 画布项目响应
     *
     * @param project JSONObject 画布项目JSON
     */
    public record ProjectResponse(JSONObject project) {
    }

    /**
     * 画布项目列表响应
     *
     * @param projects List<JSONObject> 画布项目列表
     */
    public record ProjectListResponse(List<JSONObject> projects) {
    }

    /**
     * 单ID请求
     *
     * @param id String 记录ID
     */
    public record IdRequest(@NotBlank(message = "business.iDIsRequired_03ffcc") String id) {
    }

    /**
     * 批量删除ID请求
     *
     * @param ids List<String> ID列表
     */
    public record DeleteIdsRequest(@NotEmpty(message = "business.iDIsRequired_03ffcc") List<String> ids) {
    }

    /**
     * 保存素材请求
     *
     * @param asset JSONObject 素材JSON
     */
    public record SaveAssetRequest(@NotNull(message = "business.assetIsRequired") JSONObject asset) {
    }

    /**
     * 素材列表响应
     *
     * @param assets List<JSONObject> 素材列表
     */
    public record AssetListResponse(List<JSONObject> assets) {
    }

    /**
     * 保存生成记录请求
     *
     * @param logType String 记录类型
     * @param log JSONObject 生成记录JSON
     */
    public record SaveGenerationLogRequest(@NotBlank(message = "business.recordTypeIsRequired") String logType,
                                           @NotNull(message = "business.generationRecordIsRequired") JSONObject log) {
    }

    /**
     * 修改生成记录标题请求
     *
     * @param id String 记录ID
     * @param title String 新标题
     */
    public record RenameGenerationLogTitleRequest(@NotBlank(message = "business.recordIDIsRequired") String id,
                                                  @NotBlank(message = "business.titleIsRequired") String title) {
    }

    /**
     * 生成记录列表响应
     *
     * @param logs List<JSONObject> 生成记录列表
     * @param hasMore boolean 是否还有下一页
     */
    public record GenerationLogListResponse(List<JSONObject> logs, boolean hasMore) {
    }

    /**
     * 登记远程媒体请求
     *
     * @param kind String 媒体类型
     * @param sourceUrl String 远程URL
     * @param storageKey String 媒体存储键
     * @param mimeType String MIME类型
     * @param bytes Long 文件大小
     * @param width Integer 宽度
     * @param height Integer 高度
     * @param durationMs Integer 时长毫秒
     * @param metadata JSONObject 扩展元数据
     */
    public record RegisterRemoteMediaRequest(@NotBlank(message = "business.mediaTypeIsRequired") String kind,
                                             String sourceUrl,
                                             String storageKey,
                                             String mimeType,
                                             Long bytes,
                                             Integer width,
                                             Integer height,
                                             Integer durationMs,
                                             JSONObject metadata) {
    }

    /**
     * 媒体信息请求
     *
     * @param storageKey String 媒体存储键
     */
    public record MediaInfoRequest(@NotBlank(message = "business.mediaStorageKeyIsRequired") String storageKey) {
    }

    /**
     * 远程媒体转存对象存储请求。
     *
     * @param storageKey String 当前用户的媒体存储键
     */
    public record TransferRemoteMediaRequest(@NotBlank(message = "business.mediaStorageKeyIsRequired") String storageKey) {
    }

    /**
     * 删除媒体请求
     *
     * @param storageKeys List<String> 媒体存储键列表
     */
    public record DeleteMediaRequest(@NotEmpty(message = "business.mediaStorageKeyIsRequired") List<String> storageKeys) {
    }

    /**
     * 对象存储文件信息
     *
     * @param provider String 对象存储供应商
     * @param url String 公开访问URL
     * @param key String 对象Key
     * @param bucket String 存储桶
     * @param region String 地域
     * @param bytes Long 文件大小
     * @param mimeType String MIME类型
     * @param uploadedAt String 上传时间
     */
    public record ObjectStorageFile(String provider, String url, String key, String bucket, String region, Long bytes, String mimeType, String uploadedAt) {
    }

    /**
     * 上传媒体响应
     *
     * @param storageKey String 媒体存储键
     * @param url String 可访问URL
     * @param bytes Long 文件大小
     * @param mimeType String MIME类型
     * @param width Integer 宽度
     * @param height Integer 高度
     * @param durationMs Integer 时长毫秒
     * @param objectStorage ObjectStorageFile 对象存储信息
     */
    public record UploadedMediaResponse(String storageKey, String url, Long bytes, String mimeType, Integer width, Integer height, Integer durationMs, ObjectStorageFile objectStorage) {
    }

    /**
     * 下载媒体内容。
     *
     * @param data byte[] 媒体二进制内容
     * @param mimeType String 媒体MIME类型
     * @param fileName String 下载文件名
     */
    public record DownloadedMedia(byte[] data, String mimeType, String fileName) {
    }

    /**
     * 对象存储配置
     *
     * @param provider String 对象存储供应商
     * @param accessKey String 访问密钥
     * @param secretKey String SecretKey
     * @param bucket String 存储桶
     * @param region String 地域
     * @param endpoint String 服务Endpoint
     * @param directory String 目录
     * @param publicBaseUrl String 公开访问基础URL
     * @param id String 对象存储配置ID
     * @param name String 对象存储名称
     * @param lastTestedAt String 最后测试时间
     * @param defaultStorage Boolean 是否默认对象存储
     */
    public record ObjectStorageConfig(String provider,
                                      String accessKey,
                                      String secretKey,
                                      String bucket,
                                      String region,
                                      String endpoint,
                                      String directory,
                                      String publicBaseUrl,
                                      String id,
                                      String name,
                                      String lastTestedAt,
                                      Boolean defaultStorage) {
    }

    /** 对象存储标识请求。 */
    public record ObjectStorageIdRequest(@NotBlank(message = "business.objectStorageIDIsRequired") String storageId) {
    }

    /**
     * 用户配置中的对象存储配置载体
     *
     * @param objectStorage ObjectStorageConfig 对象存储配置
     */
    public record ObjectStoragePayload(ObjectStorageConfig objectStorage) {
    }

    /**
     * 通用Map响应
     *
     * @param data Map<String, Object> 响应数据
     */
    public record GenericMapResponse(Map<String, Object> data) {
    }

    /**
     * 渠道列表响应
     *
     * @param channels List<AiChannelConfig> AI渠道列表
     */
    public record ChannelListResponse(List<AiTaskDtos.AiChannelConfig> channels) {
    }

    /**
     * 对象存储列表响应
     *
     * @param objectStorages List<JSONObject> 对象存储列表
     */
    public record ObjectStorageListResponse(List<JSONObject> objectStorages) {
    }

}

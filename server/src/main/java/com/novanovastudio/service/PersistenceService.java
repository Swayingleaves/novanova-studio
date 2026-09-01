package com.novanovastudio.service;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.TypeReference;
import com.novanovastudio.ai.AiHttpClient;
import com.novanovastudio.ai.VideoGenerationMode;
import com.novanovastudio.ai.VideoResolution;
import com.novanovastudio.agent.AgentActivityService;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.common.SensitiveDataCrypto;
import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.dto.AiTaskDtos;
import com.novanovastudio.dto.PersistenceDtos;
import com.novanovastudio.dto.VideoBillingConfiguration;
import com.novanovastudio.entity.PersistenceRecords;
import com.novanovastudio.repository.AiTaskRepository;
import com.novanovastudio.repository.PersistenceRepository;
import com.novanovastudio.security.CurrentUserProvider;
import com.novanovastudio.storage.ObjectStorageService;
import com.novanovastudio.task.ModelTaskExecutionDispatcher;
import java.io.InputStream;
import java.net.URLConnection;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.List;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.io.buffer.DataBufferUtils;
import org.springframework.http.codec.multipart.FilePart;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

/**
 * @title        PersistenceService.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  响应式业务持久化服务
 * @createTime   2026-06-24 18:35:00
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class PersistenceService {

    /** 按次计费单位。 */
    private static final String CREDIT_UNIT_GENERATION = "generation";

    /** 按秒计费单位。 */
    private static final String CREDIT_UNIT_SECOND = "second";

    /** 生成记录标题最大长度 */
    private static final int GENERATION_LOG_TITLE_MAX_LENGTH = 100;

    /** 头像最大文件大小（字节） */
    private static final long AVATAR_MAX_FILE_SIZE_BYTES = 2L * 1024 * 1024;

    /** 生成记录空闲状态 */
    private static final String GENERATION_STATUS_IDLE = "idle";

    /** 生成记录运行状态 */
    private static final String GENERATION_STATUS_RUNNING = "running";

    /** 生成记录成功状态 */
    private static final String GENERATION_STATUS_SUCCESS = "success";

    /** 生成记录失败状态 */
    private static final String GENERATION_STATUS_FAILED = "failed";

    /** 服务端虚拟渠道ID */
    private static final String SERVER_CHANNEL_ID = "server";

    /** 默认对象存储配置ID */
    private static final String DEFAULT_OBJECT_STORAGE_ID = "default";

    /** 安全随机数 */
    private static final SecureRandom secureRandom = new SecureRandom();

    /** 业务仓储 */
    private final PersistenceRepository repository;

    /** AI任务仓储 */
    private final AiTaskRepository aiTaskRepository;

    /** Agent执行活动服务 */
    private final AgentActivityService agentActivityService;

    /** 外部媒体下载客户端 */
    private final AiHttpClient aiHttpClient;

    /** 当前用户提供器 */
    private final CurrentUserProvider currentUserProvider;

    /** 服务配置 */
    private final NovanovaProperties properties;

    /** 对象存储服务 */
    private final ObjectStorageService objectStorageService;

    /** 模型任务执行调度器 */
    private final ModelTaskExecutionDispatcher modelTaskExecutionDispatcher;

    /**
     * 查询全站AI渠道列表
     *
     * @return Mono<List<AiChannelConfig>> AI渠道列表
     */
    public Mono<List<AiTaskDtos.AiChannelConfig>> listChannels() {
        // 渠道由所有管理员共同维护，不再绑定当前管理员账号。
        return getPlatformAiChannels().doOnSuccess(channels -> log.info("读取全站AI渠道列表成功: channels={}", channels.size()));
    }

    /** 创建全站渠道。 */
    public Mono<AiTaskDtos.AiChannelConfig> createChannel(PersistenceDtos.ChannelMutationRequest request) {
        return encryptSecret(request.apiKey()).flatMap(encrypted -> {
            PersistenceRecords.UserAiChannelRecord record = channelRecord(firstNonEmpty(request.id(), UUID.randomUUID().toString()), request, encrypted);
            return repository.createPlatformAiChannel(record).thenReturn(channelDto(record, request.apiKey()));
        });
    }

    /** 修改全站渠道。 */
    public Mono<AiTaskDtos.AiChannelConfig> updateChannel(PersistenceDtos.ChannelMutationRequest request) {
        if (!StringUtils.hasText(request.id())) return Mono.error(new BusinessException(ErrorCode.PARAM_MISSING, "渠道ID不能为空"));
        return repository.getPlatformAiChannel(request.id())
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "渠道不存在")))
                .flatMap(existing -> (StringUtils.hasText(request.apiKey()) ? encryptSecret(request.apiKey()) : Mono.just(existing.getApiKeyEncrypted()))
                        .flatMap(encrypted -> {
                            PersistenceRecords.UserAiChannelRecord record = channelRecord(request.id(), request, encrypted);
                            return repository.updatePlatformAiChannel(record).then(decryptSecret(encrypted)).map(apiKey -> channelDto(record, apiKey));
                        }));
    }

    /**
     * 使用当前请求中的临时渠道配置拉取模型列表。
     * <p>
     * 该操作仅访问第三方渠道，不创建或修改数据库中的渠道。
     *
     * @param request ChannelModelRefreshRequest 渠道连接配置
     * @return Mono<List<String>> 去重并排序后的模型列表
     */
    public Mono<List<String>> refreshChannelModels(PersistenceDtos.ChannelModelRefreshRequest request) {
        return aiHttpClient.fetchChannelModels(request.baseUrl(), request.apiKey(), request.apiFormat())
                .doOnSuccess(models -> log.info("拉取渠道模型列表成功: apiFormat={}, models={}", request.apiFormat(), models.size()));
    }

    /** 删除全站渠道。 */
    public Mono<Void> deleteChannel(String channelId) {
        return repository.existsPlatformModelConfigByChannel(channelId)
                .flatMap(referenced -> referenced
                        ? Mono.<Void>error(new BusinessException(ErrorCode.BUSINESS_ERROR, "渠道仍被全站模型引用，请先删除关联模型配置"))
                        : repository.deletePlatformAiChannel(channelId).then());
    }

    /** 查询全站模型配置。 */
    public Mono<List<PersistenceDtos.ModelConfig>> listModelConfigs() {
        return getPlatformModelConfigs();
    }

    /** 查询全站模型配置，供任务执行和模型目录复用。 */
    public Mono<List<PersistenceDtos.ModelConfig>> getPlatformModelConfigs() {
        return repository.listPlatformAiModelConfigs().map(this::modelConfigDto).collectList();
    }

    /** 创建全站模型配置。 */
    public Mono<PersistenceDtos.ModelConfig> createModelConfig(PersistenceDtos.CreateModelConfigRequest request) {
        validateModelType(request.modelType());
        return repository.getPlatformAiChannel(request.channelId())
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "所属渠道不存在")))
                .flatMap(channel -> {
                    if (!parseStringList(channel.getModels()).contains(request.modelName())) {
                        return Mono.<PersistenceDtos.ModelConfig>error(new BusinessException(ErrorCode.PARAM_INVALID, "模型不在所属渠道的模型列表中"));
                    }
                    PersistenceRecords.UserAiModelConfigRecord record = new PersistenceRecords.UserAiModelConfigRecord();
                    record.setModelConfigId(UUID.randomUUID().toString());
                    record.setChannelId(request.channelId());
                    record.setModelName(request.modelName());
                    record.setModelType(request.modelType());
                    List<String> capabilities = normalizeModelCapabilities(request.modelType(), request.capabilities());
                    VideoBillingConfiguration videoBillingConfiguration = normalizeVideoBillingConfiguration(
                            request.modelType(), capabilities, request.videoBillingConfiguration());
                    record.setCapabilities(JSON.toJSONString(capabilities));
                    record.setDefaultModel(false);
                    record.setSortOrder(request.sortOrder() == null ? 0 : request.sortOrder());
                    record.setCreditCost("video".equals(request.modelType()) ? 0 : request.creditCost() == null ? 0 : request.creditCost());
                    record.setCreditUnit(videoBillingConfiguration == null
                            ? normalizeCreditUnit(request.modelType(), request.creditUnit())
                            : videoBillingConfiguration.billingUnit());
                    record.setThinkingEnabled(thinkingEnabled(request.thinkingEnabled()));
                    record.setReasoningEffort(reasoningEffort(request.reasoningEffort()));
                    record.setRequestConcurrency(normalizeRequestConcurrency(request.requestConcurrency()));
                    JSONObject customBodyParameters = request.customBodyParameters() == null
                            ? normalizeCustomBodyParameters(record.getCustomBodyParameters())
                            : normalizeCustomBodyParameters(request.customBodyParameters());
                    record.setCustomBodyParameters(JSON.toJSONString(customBodyParameters));
                    record.setVideoBillingConfiguration(videoBillingConfiguration == null ? null : JSON.toJSONString(videoBillingConfiguration));
                    boolean isCustomModel = Boolean.TRUE.equals(request.isCustomModel());
                    record.setIsCustomModel(isCustomModel);
                    record.setCustomModelConfig(JSON.toJSONString(normalizeCustomModelConfig(request.modelType(), isCustomModel, capabilities, request.customModelConfig())));
                    record.setDisplayName(normalizeDisplayName(request.displayName(), request.modelName()));
                    record.setModelIcon(normalizeModelIcon(request.modelIcon()));
                    return repository.createPlatformAiModelConfig(record).thenReturn(modelConfigDto(record));
                });
    }

    /** 修改全站模型配置。 */
    public Mono<PersistenceDtos.ModelConfig> updateModelConfig(PersistenceDtos.UpdateModelConfigRequest request) {
        validateModelType(request.modelType());
        return repository.getPlatformAiModelConfig(request.id())
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "模型配置不存在")))
                .flatMap(record -> {
                    List<String> capabilities = normalizeModelCapabilities(request.modelType(), request.capabilities());
                    VideoBillingConfiguration existingVideoBillingConfiguration = parseVideoBillingConfiguration(record.getVideoBillingConfiguration());
                    // 视频模型省略配置时沿用旧值；切换为非视频模型时清空旧值，但显式传入仍必须拒绝。
                    VideoBillingConfiguration requestedVideoBillingConfiguration = "video".equals(request.modelType())
                            ? request.videoBillingConfiguration() == null ? existingVideoBillingConfiguration : request.videoBillingConfiguration()
                            : request.videoBillingConfiguration();
                    VideoBillingConfiguration videoBillingConfiguration = normalizeVideoBillingConfiguration(
                            request.modelType(), capabilities, requestedVideoBillingConfiguration);
                    record.setModelType(request.modelType());
                    record.setCapabilities(JSON.toJSONString(capabilities));
                    record.setSortOrder(request.sortOrder() == null ? 0 : request.sortOrder());
                    record.setCreditCost("video".equals(request.modelType()) ? 0 : request.creditCost() == null ? 0 : request.creditCost());
                    record.setCreditUnit(videoBillingConfiguration == null
                            ? normalizeCreditUnit(request.modelType(), request.creditUnit())
                            : videoBillingConfiguration.billingUnit());
                    record.setThinkingEnabled(thinkingEnabled(request.thinkingEnabled()));
                    record.setReasoningEffort(reasoningEffort(request.reasoningEffort()));
                    record.setRequestConcurrency(normalizeRequestConcurrency(
                            request.requestConcurrency() == null ? record.getRequestConcurrency() : request.requestConcurrency()));
                    JSONObject customBodyParameters = request.customBodyParameters() == null
                            ? normalizeCustomBodyParameters(record.getCustomBodyParameters())
                            : normalizeCustomBodyParameters(request.customBodyParameters());
                    record.setCustomBodyParameters(JSON.toJSONString(customBodyParameters));
                    record.setVideoBillingConfiguration(videoBillingConfiguration == null ? null : JSON.toJSONString(videoBillingConfiguration));
                    boolean isCustomModel = Boolean.TRUE.equals(request.isCustomModel());
                    record.setIsCustomModel(isCustomModel);
                    record.setCustomModelConfig(JSON.toJSONString(normalizeCustomModelConfig(request.modelType(), isCustomModel, capabilities, request.customModelConfig())));
                    record.setDisplayName(normalizeDisplayName(request.displayName(), record.getModelName()));
                    record.setModelIcon(normalizeModelIcon(request.modelIcon()));
                    PersistenceDtos.ModelConfig modelConfig = modelConfigDto(record);
                    return repository.updatePlatformAiModelConfig(record)
                            .then(isModelQueueType(modelConfig.modelType())
                                    ? modelTaskExecutionDispatcher.refresh(record.getModelConfigId())
                                    : Mono.empty())
                            .thenReturn(modelConfig);
                });
    }

    /** 删除全站模型配置。 */
    public Mono<Void> deleteModelConfig(String id) {
        return aiTaskRepository.existsExecutableTasksByModelConfig(id)
                .flatMap(hasExecutableTasks -> Boolean.TRUE.equals(hasExecutableTasks)
                        ? Mono.<Void>error(new BusinessException(ErrorCode.BUSINESS_ERROR, "模型仍有关联的等待或运行任务，暂不能删除"))
                        : repository.deletePlatformAiModelConfig(id).then());
    }

    /** 设置全站类型默认模型。 */
    @Transactional
    public Mono<Void> setDefaultModel(PersistenceDtos.SetDefaultModelRequest request) {
        validateModelType(request.modelType());
        return repository.getPlatformAiModelConfig(request.id())
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "模型配置不存在")))
                .flatMap(record -> {
                    if (!request.modelType().equals(record.getModelType())) {
                        return Mono.<Void>error(new BusinessException(ErrorCode.PARAM_INVALID, "默认模型类型与模型配置不一致"));
                    }
                    return repository.setDefaultPlatformAiModel(request.modelType(), request.id());
                });
    }

    /** 构建渠道记录。 */
    private PersistenceRecords.UserAiChannelRecord channelRecord(String channelId, PersistenceDtos.ChannelMutationRequest request, String encryptedApiKey) {
        PersistenceRecords.UserAiChannelRecord record = new PersistenceRecords.UserAiChannelRecord();
        record.setChannelId(channelId); record.setName(request.name().trim());
        record.setBaseUrl(firstNonEmpty(request.baseUrl())); record.setApiKeyEncrypted(encryptedApiKey);
        record.setApiFormat(firstNonEmpty(request.apiFormat(), "openai"));
        record.setModels(JSON.toJSONString(request.models() == null ? List.of() : request.models()));
        record.setSortOrder(request.sortOrder() == null ? 0 : request.sortOrder()); record.setStatus(1);
        return record;
    }

    /** 构建渠道响应。 */
    private AiTaskDtos.AiChannelConfig channelDto(PersistenceRecords.UserAiChannelRecord record, String apiKey) {
        return new AiTaskDtos.AiChannelConfig(record.getChannelId(), record.getName(), record.getBaseUrl(), apiKey,
                record.getApiFormat(), parseStringList(record.getModels()));
    }

    /** 构建模型配置响应。 */
    private PersistenceDtos.ModelConfig modelConfigDto(PersistenceRecords.UserAiModelConfigRecord record) {
        return new PersistenceDtos.ModelConfig(record.getModelConfigId(), record.getChannelId(), record.getModelName(), record.getModelType(),
                parseStringList(record.getCapabilities()), Boolean.TRUE.equals(record.getDefaultModel()), record.getSortOrder(), record.getCreditCost(),
                thinkingEnabled(record.getThinkingEnabled()), reasoningEffort(record.getReasoningEffort()),
                normalizeCreditUnit(record.getModelType(), record.getCreditUnit()), normalizeRequestConcurrency(record.getRequestConcurrency()),
                normalizeCustomBodyParameters(record.getCustomBodyParameters()),
                parseVideoBillingConfiguration(record.getVideoBillingConfiguration()),
                record.getDisplayName(),
                record.getModelIcon(),
                Boolean.TRUE.equals(record.getIsCustomModel()),
                parseCustomModelConfig(record.getCustomModelConfig()));
    }

    /**
     * 规范化模型展示名称，空白或与真实模型名相同时返回null，展示时回退真实模型名。
     *
     * @param displayName String 请求展示名称
     * @param modelName String 真实模型名称
     * @return String 规范化展示名称，可为null
     */
    private String normalizeDisplayName(String displayName, String modelName) {
        if (displayName == null || displayName.isBlank()) {
            return null;
        }
        String trimmed = displayName.trim();
        return trimmed.equals(modelName) ? null : trimmed;
    }

    /**
     * 规范化模型展示图标标识，空白返回null，展示时回退自动匹配。
     *
     * @param modelIcon String 请求展示图标标识
     * @return String 规范化展示图标标识，可为null
     */
    private String normalizeModelIcon(String modelIcon) {
        if (modelIcon == null || modelIcon.isBlank()) {
            return null;
        }
        return modelIcon.trim();
    }

    /**
     * 规范化视频模型的模式分辨率分档计费配置。
     *
     * @param modelType String 模型类型
     * @param capabilities List<String> 已配置模型能力
     * @param configuration VideoBillingConfiguration 请求计费配置
     * @return VideoBillingConfiguration 规范化结果，非视频模型或未配置时返回null
     */
    private VideoBillingConfiguration normalizeVideoBillingConfiguration(String modelType, List<String> capabilities,
                                                                          VideoBillingConfiguration configuration) {
        if (!"video".equals(modelType)) {
            if (configuration != null) {
                throw new BusinessException(ErrorCode.PARAM_INVALID, "只有视频模型支持视频分档计费配置");
            }
            return null;
        }
        if (configuration == null) return null;
        if (!StringUtils.hasText(configuration.billingUnit())) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "视频模型必须选择按次或按秒计费方式");
        }
        String billingUnit = configuration.billingUnit().trim();
        if (!Set.of(CREDIT_UNIT_GENERATION, CREDIT_UNIT_SECOND).contains(billingUnit)) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "视频模型计费方式只支持按次或按秒");
        }
        Integer minimumDurationSeconds = configuration.minimumDurationSeconds();
        if (minimumDurationSeconds == null || minimumDurationSeconds < 1) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "视频最短生成时长必须是正整数秒");
        }
        Map<String, Map<String, Integer>> inputPrices = configuration.modePrices() == null ? Map.of() : configuration.modePrices();
        if (inputPrices.keySet().stream().anyMatch(mode -> !VideoGenerationMode.isSupported(mode))) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "视频价格表包含不支持的生成模式");
        }
        Map<String, Map<String, Integer>> normalizedPrices = new LinkedHashMap<>();
        for (String mode : List.of(VideoGenerationMode.TEXT_TO_VIDEO, VideoGenerationMode.IMAGE_TO_VIDEO,
                VideoGenerationMode.REFERENCE_TO_VIDEO, VideoGenerationMode.FIRST_LAST_FRAME_TO_VIDEO)) {
            Map<String, Integer> prices = inputPrices.get(mode);
            Map<String, Integer> normalizedModePrices = new LinkedHashMap<>();
            if (prices != null) {
                if (!prices.isEmpty() && !capabilities.contains(mode)) {
                    throw new BusinessException(ErrorCode.PARAM_INVALID, "视频价格表只能配置已勾选的生成模式能力");
                }
                for (Map.Entry<String, Integer> entry : prices.entrySet()) {
                    if (!VideoResolution.isSupported(entry.getKey())) {
                        throw new BusinessException(ErrorCode.PARAM_INVALID, "视频价格表包含不支持的分辨率");
                    }
                    if (entry.getValue() == null || entry.getValue() < 0) {
                        throw new BusinessException(ErrorCode.PARAM_INVALID, "视频分辨率价格必须是不小于0的整数");
                    }
                    normalizedModePrices.put(entry.getKey(), entry.getValue());
                }
            }
            normalizedPrices.put(mode, Map.copyOf(normalizedModePrices));
        }
        return new VideoBillingConfiguration(billingUnit, minimumDurationSeconds, Map.copyOf(normalizedPrices));
    }

    /**
     * 规范化模型细能力，并限制视频模型只能声明明确的视频生成模式。
     *
     * @param modelType String 模型类型
     * @param capabilities List<String> 原始细能力列表
     * @return List<String> 去重后的细能力列表
     */
    private List<String> normalizeModelCapabilities(String modelType, List<String> capabilities) {
        List<String> normalized = capabilities == null ? List.of() : capabilities.stream()
                .filter(StringUtils::hasText)
                .map(String::trim)
                .distinct()
                .toList();
        if (!"video".equals(modelType)) {
            return normalized;
        }
        if (normalized.stream().anyMatch(capability -> !VideoGenerationMode.isSupported(capability))) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "视频模型能力包含不支持的生成模式");
        }
        return normalized;
    }

    /**
     * 解析数据库保存的视频分档计费配置。
     *
     * @param value String JSON配置文本
     * @return VideoBillingConfiguration 解析后的配置，未配置时返回null
     */
    private VideoBillingConfiguration parseVideoBillingConfiguration(String value) {
        if (!StringUtils.hasText(value) || "null".equals(value.trim())) return null;
        try {
            return JSON.parseObject(value, VideoBillingConfiguration.class);
        } catch (Exception exception) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "视频分档计费配置格式不合法");
        }
    }

    /**
     * 解析数据库保存的自定义模型配置。
     *
     * @param value String JSON配置文本
     * @return Map<String, CustomModelGroupConfig> 按能力或模式分组配置，未配置时返回空表
     */
    private Map<String, PersistenceDtos.CustomModelGroupConfig> parseCustomModelConfig(String value) {
        if (!StringUtils.hasText(value) || "null".equals(value.trim())) return Map.of();
        JSONObject json = parseJson(value);
        if (json == null || json.isEmpty()) return Map.of();
        Map<String, PersistenceDtos.CustomModelGroupConfig> result = new LinkedHashMap<>();
        for (String key : json.keySet()) {
            JSONObject group = json.getJSONObject(key);
            if (group == null) continue;
            result.put(key, new PersistenceDtos.CustomModelGroupConfig(
                    group.getString("requestPath"),
                    group.getString("requestMethod"),
                    group.getString("requestModelName"),
                    group.getString("requestTemplate"),
                    group.getString("aiRequestPrompt"),
                    group.getString("responseExample"),
                    group.getString("resultPath"),
                    group.getString("queryPath"),
                    group.getString("queryMethod"),
                    group.getString("queryRequestTemplate"),
                    group.getString("aiQueryPrompt"),
                    group.getString("queryResponseExample"),
                    group.getString("queryResultPath")));
        }
        return Map.copyOf(result);
    }

    /**
     * 规范化自定义模型配置，并按模型类型校验能力键与必填字段。
     *
     * @param modelType String 模型类型
     * @param isCustomModel boolean 是否启用自定义模型
     * @param capabilities List<String> 已配置模型能力
     * @param config Map<String, CustomModelGroupConfig> 请求中的自定义模型配置
     * @return Map<String, CustomModelGroupConfig> 规范化后的配置
     */
    private Map<String, PersistenceDtos.CustomModelGroupConfig> normalizeCustomModelConfig(String modelType, boolean isCustomModel,
                                                                                            List<String> capabilities,
                                                                                            Map<String, PersistenceDtos.CustomModelGroupConfig> config) {
        Map<String, PersistenceDtos.CustomModelGroupConfig> input = config == null ? Map.of() : config;
        if ("text".equals(modelType)) {
            if (isCustomModel || !input.isEmpty()) {
                throw new BusinessException(ErrorCode.PARAM_INVALID, "文本模型不支持自定义模型");
            }
            return Map.of();
        }
        if (!isCustomModel) {
            if (!input.isEmpty()) {
                throw new BusinessException(ErrorCode.PARAM_INVALID, "未启用自定义模型时不能配置自定义请求模板");
            }
            return Map.of();
        }
        Set<String> allowedKeys = "video".equals(modelType)
                ? Set.of(VideoGenerationMode.TEXT_TO_VIDEO, VideoGenerationMode.IMAGE_TO_VIDEO, VideoGenerationMode.REFERENCE_TO_VIDEO,
                VideoGenerationMode.FIRST_LAST_FRAME_TO_VIDEO)
                : Set.of("text-to-image", "image-to-image");
        Map<String, PersistenceDtos.CustomModelGroupConfig> normalized = new LinkedHashMap<>();
        for (Map.Entry<String, PersistenceDtos.CustomModelGroupConfig> entry : input.entrySet()) {
            String key = entry.getKey() == null ? "" : entry.getKey().trim();
            if (!allowedKeys.contains(key)) {
                throw new BusinessException(ErrorCode.PARAM_INVALID, "自定义模型配置包含不支持的能力或模式: " + entry.getKey());
            }
            if (!capabilities.contains(key)) {
                throw new BusinessException(ErrorCode.PARAM_INVALID, "自定义模型配置只能包含已勾选的能力或模式: " + key);
            }
            PersistenceDtos.CustomModelGroupConfig group = entry.getValue();
            if (group == null) {
                throw new BusinessException(ErrorCode.PARAM_INVALID, "能力或模式[" + key + "]的自定义模型配置不能为空");
            }
            String requestPath = group.requestPath() == null ? "" : group.requestPath().trim();
            if (!StringUtils.hasText(requestPath) || !requestPath.startsWith("/")) {
                throw new BusinessException(ErrorCode.PARAM_INVALID, "能力或模式[" + key + "]的请求路径不能为空，且需以 / 开头");
            }
            String requestMethod = normalizeCustomRequestMethod(group.requestMethod());
            if (!"GET".equals(requestMethod) && !StringUtils.hasText(group.requestTemplate()) && !StringUtils.hasText(group.aiRequestPrompt())) {
                throw new BusinessException(ErrorCode.PARAM_INVALID, "能力或模式[" + key + "]使用POST请求时必须配置请求示例或AI构造提示词");
            }
            if (!StringUtils.hasText(group.resultPath())) {
                throw new BusinessException(ErrorCode.PARAM_INVALID, "能力或模式[" + key + "]的结果路径不能为空");
            }
            boolean queryEnabled = StringUtils.hasText(group.queryPath())
                    || StringUtils.hasText(group.queryRequestTemplate()) || StringUtils.hasText(group.aiQueryPrompt());
            if (queryEnabled) {
                if (!StringUtils.hasText(group.queryPath())) {
                    throw new BusinessException(ErrorCode.PARAM_INVALID, "能力或模式[" + key + "]配置了异步查询时必须配置查询路径");
                }
                if (!StringUtils.hasText(group.queryResultPath())) {
                    throw new BusinessException(ErrorCode.PARAM_INVALID, "能力或模式[" + key + "]配置了异步查询时必须配置查询结果路径");
                }
            }
            String queryMethod = normalizeCustomRequestMethod(group.queryMethod());
            if (queryEnabled && !"GET".equals(queryMethod) && !StringUtils.hasText(group.queryRequestTemplate())
                    && !StringUtils.hasText(group.aiQueryPrompt())) {
                throw new BusinessException(ErrorCode.PARAM_INVALID, "能力或模式[" + key + "]使用POST查询时必须配置查询请求示例或AI构造提示词");
            }
            normalized.put(key, new PersistenceDtos.CustomModelGroupConfig(
                    requestPath, requestMethod, group.requestModelName(), group.requestTemplate(), group.aiRequestPrompt(),
                    group.responseExample(), group.resultPath(),
                    group.queryPath() == null ? null : group.queryPath().trim(), queryMethod,
                    group.queryRequestTemplate(), group.aiQueryPrompt(),
                    group.queryResponseExample(), group.queryResultPath()));
        }
        return Map.copyOf(normalized);
    }

    /** 规范化模型自定义JSON请求体参数。 */
    private JSONObject normalizeCustomBodyParameters(JSONObject parameters) {
        return parameters == null ? new JSONObject() : JSON.parseObject(JSON.toJSONString(parameters));
    }

    /**
     * 规范化自定义模型请求方法，空值默认POST。
     *
     * @param method String 原始请求方法
     * @return String GET或POST
     */
    private String normalizeCustomRequestMethod(String method) {
        String normalized = StringUtils.hasText(method) ? method.trim().toUpperCase() : "POST";
        if (!Set.of("GET", "POST").contains(normalized)) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "自定义模型请求方法只支持GET或POST");
        }
        return normalized;
    }

    /** 规范化模型自定义JSON请求体参数字符串。 */
    private JSONObject normalizeCustomBodyParameters(String value) {
        if (!StringUtils.hasText(value)) return new JSONObject();
        JSONObject parameters = parseJson(value);
        if (parameters == null) throw new BusinessException(ErrorCode.PARAM_INVALID, "模型自定义JSON必须是对象");
        return parameters;
    }

    /**
     * 规范化模型计费单位。
     *
     * @param modelType String 模型类型
     * @param creditUnit String 请求中的计费单位
     * @return String 规范化后的计费单位
     * @throws BusinessException 计费单位不支持或非视频模型尝试按秒计费时抛出
     */
    private String normalizeCreditUnit(String modelType, String creditUnit) {
        String value = StringUtils.hasText(creditUnit) ? creditUnit : CREDIT_UNIT_GENERATION;
        if (!Set.of(CREDIT_UNIT_GENERATION, CREDIT_UNIT_SECOND).contains(value)) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "积分计费单位只支持generation、second");
        }
        if (!"video".equals(modelType) && CREDIT_UNIT_SECOND.equals(value)) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "只有视频模型可以按秒计费");
        }
        return value;
    }

    /**
     * 规范化模型同时并发数。
     *
     * @param requestConcurrency Integer 请求中的模型同时并发数
     * @return int 至少为1的模型同时并发数
     */
    private int normalizeRequestConcurrency(Integer requestConcurrency) {
        int value = requestConcurrency == null ? 1 : requestConcurrency;
        if (value < 1) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "模型同时并发数不能小于1");
        }
        return value;
    }

    /**
     * 判断模型是否使用模型并发队列。
     *
     * @param modelType String 模型类型
     * @return boolean 是否为图片或视频模型
     */
    private boolean isModelQueueType(String modelType) {
        return "image".equals(modelType) || "video".equals(modelType);
    }

    /**
     * 规范化思考模式开关。
     *
     * @param enabled Boolean 请求中的思考模式开关
     * @return boolean 缺省时开启思考模式
     */
    private boolean thinkingEnabled(Boolean enabled) {
        return enabled == null || Boolean.TRUE.equals(enabled);
    }

    /**
     * 规范化思考强度。
     *
     * @param effort String 请求中的思考强度
     * @return String high或max
     */
    private String reasoningEffort(String effort) {
        String value = StringUtils.hasText(effort) ? effort : "high";
        if (!Set.of("high", "max").contains(value)) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "思考强度只支持high、max");
        }
        return value;
    }

    /** 校验模型类型。 */
    private void validateModelType(String modelType) {
        if (!Set.of("image", "video", "text").contains(modelType)) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "模型类型只支持image、video、text");
        }
    }

    /**
     * 查询全站对象存储列表
     *
     * @return Mono<List<JSONObject>> 对象存储列表
     */
    public Mono<List<JSONObject>> listObjectStorages() {
        // 对象存储由所有管理员共同维护，不再绑定当前管理员账号。
        return getPlatformObjectStorages().doOnSuccess(storages -> log.info("读取全站对象存储列表成功: objectStorages={}", storages.size()));
    }

    /**
     * 创建全站对象存储。
     * <p>
     * 全站尚未拥有默认对象存储时，将本次创建的对象存储设为默认项。
     *
     * @param config ObjectStorageConfig 对象存储配置
     * @return Mono<JSONObject> 已创建的对象存储配置
     */
    public Mono<JSONObject> createObjectStorage(PersistenceDtos.ObjectStorageConfig config) {
        objectStorageService.validate(config);
        return repository.getDefaultPlatformObjectStorage().hasElement()
                .flatMap(hasDefaultStorage -> buildObjectStorageRecord(config, null)
                        .flatMap(record -> {
                            // 缺少默认项时，将当前配置设为默认项，上传链路才能直接读取。
                            record.setDefaultStorage(!hasDefaultStorage);
                            return repository.createPlatformObjectStorage(record).then(decryptObjectStorage(record));
                        })
                        .map(value -> JSON.parseObject(JSON.toJSONString(value))));
    }

    /** 修改全站对象存储。 */
    public Mono<JSONObject> updateObjectStorage(PersistenceDtos.ObjectStorageConfig config) {
        if (!StringUtils.hasText(config.id())) return Mono.error(new BusinessException(ErrorCode.PARAM_MISSING, "对象存储ID不能为空"));
        objectStorageService.validate(config);
        return repository.getPlatformObjectStorage(config.id())
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "对象存储不存在")))
                .flatMap(existing -> buildObjectStorageRecord(config, existing))
                .flatMap(record -> repository.updatePlatformObjectStorage(record).then(decryptObjectStorage(record)))
                .map(value -> JSON.parseObject(JSON.toJSONString(value)));
    }

    /** 删除全站对象存储。 */
    public Mono<Void> deleteObjectStorage(String storageId) {
        return repository.getPlatformObjectStorage(storageId)
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "对象存储不存在")))
                .flatMap(record -> Boolean.TRUE.equals(record.getDefaultStorage())
                        ? Mono.<Void>error(new BusinessException(ErrorCode.BUSINESS_ERROR, "默认对象存储不能删除，请先设置其他默认项"))
                        : repository.deletePlatformObjectStorage(storageId).then());
    }

    /** 设置全站默认对象存储。 */
    @Transactional
    public Mono<Void> setDefaultObjectStorage(String storageId) {
        return repository.getPlatformObjectStorage(storageId)
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "对象存储不存在")))
                .then(repository.setDefaultPlatformObjectStorage(storageId));
    }

    /** 构建对象存储记录。 */
    private Mono<PersistenceRecords.UserObjectStorageRecord> buildObjectStorageRecord(PersistenceDtos.ObjectStorageConfig config,
                                                                                        PersistenceRecords.UserObjectStorageRecord existing) {
        String provider = firstNonEmpty(config.provider(), "tencentCos");
        if (!objectStorageService.supports(provider)) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "对象存储服务商不受支持"));
        }
        Mono<String> accessKey = StringUtils.hasText(config.accessKey()) ? encryptSecret(config.accessKey()) : Mono.just(existing == null ? "" : existing.getAccessKeyEncrypted());
        Mono<String> secretKey = StringUtils.hasText(config.secretKey()) ? encryptSecret(config.secretKey()) : Mono.just(existing == null ? "" : existing.getSecretKeyEncrypted());
        return Mono.zip(accessKey, secretKey).map(tuple -> {
            PersistenceRecords.UserObjectStorageRecord record = new PersistenceRecords.UserObjectStorageRecord();
            record.setStorageId(firstNonEmpty(config.id(), UUID.randomUUID().toString()));
            record.setName(firstNonEmpty(config.name(), "未命名对象存储")); record.setProvider(provider);
            record.setAccessKeyEncrypted(tuple.getT1()); record.setSecretKeyEncrypted(tuple.getT2());
            record.setBucket(firstNonEmpty(config.bucket())); record.setRegion(firstNonEmpty(config.region()));
            record.setEndpoint(firstNonEmpty(config.endpoint()));
            record.setDirectory(firstNonEmpty(config.directory())); record.setPublicBaseUrl(firstNonEmpty(config.publicBaseUrl()));
            record.setLastTestedAt(firstNonEmpty(config.lastTestedAt()));
            record.setDefaultStorage(existing != null && Boolean.TRUE.equals(existing.getDefaultStorage())); record.setStatus(1);
            return record;
        });
    }

    /**
     * 查询全站AI渠道配置。
     *
     * @return Mono<List<AiChannelConfig>> 全站AI渠道列表
     */
    public Mono<List<AiTaskDtos.AiChannelConfig>> getPlatformAiChannels() {
        // 服务端执行时解密密钥，普通用户接口不会返回该结果。
        return repository.listPlatformAiChannels()
                .filter(record -> !SERVER_CHANNEL_ID.equals(record.getChannelId()))
                .concatMap(record -> decryptSecret(record.getApiKeyEncrypted())
                        .map(apiKey -> new AiTaskDtos.AiChannelConfig(record.getChannelId(), record.getName(), record.getBaseUrl(), apiKey, record.getApiFormat(), parseStringList(record.getModels()))))
                .collectList();
    }

    /**
     * 查询画布项目列表
     *
     * @return Mono<List<JSONObject>> 画布项目列表
     */
    public Mono<List<JSONObject>> listProjects() {
        // 只读取当前用户自己的画布项目，并将数据库JSON字符串还原为节点。
        return currentUserProvider.currentUserId()
                .flatMapMany(repository::listProjects)
                .map(record -> parseJson(record.getData()))
                .collectList();
    }

    /**
     * 查询画布项目详情
     *
     * @param id String 项目ID
     * @return Mono<JSONObject> 画布项目
     */
    public Mono<JSONObject> getProject(String id) {
        // 查询时同时限定用户ID和项目ID，避免跨用户读取。
        return currentUserProvider.currentUserId()
                .flatMap(userId -> repository.getProject(userId, id))
                .map(record -> parseJson(record.getData()))
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "画布不存在")));
    }

    /**
     * 保存画布项目
     *
     * @param project JSONObject 画布项目JSON
     * @return Mono<Void> 操作结果
     */
    public Mono<Void> saveProject(JSONObject project) {
        // 画布项目元数据统一从 identity 分组读取，再按用户维度执行 UPSERT 保存。
        SnapshotMetadata metadata = parseCanvasProjectMetadata(project);
        return currentUserProvider.currentUserId().flatMap(userId -> {
            PersistenceRecords.SnapshotRecord record = new PersistenceRecords.SnapshotRecord();
            record.setId(metadata.id());
            record.setUserId(userId);
            record.setTitle(metadata.title());
            record.setData(toJson(project));
            return repository.saveProject(record);
        });
    }

    /**
     * 解析画布项目元数据。
     *
     * @param project JSONObject 画布项目JSON
     * @return SnapshotMetadata 画布项目元数据
     */
    private SnapshotMetadata parseCanvasProjectMetadata(JSONObject project) {
        // 画布文档使用分组结构，项目标识和标题必须位于 identity 对象中。
        JSONObject identity = project == null ? null : project.getJSONObject("identity");
        return parseSnapshotMetadata(identity, "画布项目");
    }

    /**
     * 删除画布项目
     *
     * @param ids List<String> 项目ID列表
     * @return Mono<Void> 操作结果
     */
    public Mono<Void> deleteProjects(List<String> ids) {
        // 批量删除时仍限定当前用户，避免删除他人项目。
        return currentUserProvider.currentUserId().flatMap(userId -> repository.deleteProjects(userId, ids));
    }

    /**
     * 查询素材列表
     *
     * @return Mono<List<JSONObject>> 素材列表
     */
    public Mono<List<JSONObject>> listAssets() {
        // 读取当前用户素材快照并转换为前端原始JSON结构。
        return currentUserProvider.currentUserId()
                .flatMapMany(repository::listAssets)
                .map(record -> parseJson(record.getData()))
                .collectList();
    }

    /**
     * 保存素材
     *
     * @param asset JSONObject 素材JSON
     * @return Mono<Void> 操作结果
     */
    public Mono<Void> saveAsset(JSONObject asset) {
        // 素材必须携带类型，便于后续按文本、图片、视频分类处理。
        SnapshotMetadata metadata = parseSnapshotMetadata(asset, "素材");
        String kind = textField(asset, "kind");
        if (!StringUtils.hasText(kind)) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_MISSING, "素材类型不能为空"));
        }
        return currentUserProvider.currentUserId().flatMap(userId -> {
            PersistenceRecords.SnapshotRecord record = new PersistenceRecords.SnapshotRecord();
            record.setId(metadata.id());
            record.setUserId(userId);
            record.setType(kind);
            record.setTitle(metadata.title());
            record.setData(toJson(asset));
            return repository.saveAsset(record);
        });
    }

    /**
     * 删除素材
     *
     * @param ids List<String> 素材ID列表
     * @return Mono<Void> 操作结果
     */
    public Mono<Void> deleteAssets(List<String> ids) {
        // 素材删除限定当前用户范围。
        return currentUserProvider.currentUserId().flatMap(userId -> repository.deleteAssets(userId, ids));
    }

    /**
     * 查询生成记录列表
     *
     * @param logType String 记录类型
     * @return Mono<List<JSONObject>> 生成记录列表
     */
    public Mono<List<JSONObject>> listGenerationLogs(String logType) {
        // 生成记录按用户和可选类型筛选，并附加任务状态及未读判断时间。
        return currentUserProvider.currentUserId()
                .flatMapMany(userId -> repository.listGenerationLogs(userId, logType))
                .map(record -> {
                    JSONObject generationLog = parseJson(record.getData());
                    generationLog.put("generationStatus", record.getGenerationStatus());
                    generationLog.put("generationCompletedAt", formatNullableTime(record.getGenerationCompletedAt()));
                    generationLog.put("generationViewedAt", formatNullableTime(record.getGenerationViewedAt()));
                    return generationLog;
                })
                .collectList();
    }

    /**
     * 保存生成记录
     *
     * @param logType String 记录类型
     * @param log JSONObject 生成记录JSON
     * @return Mono<Void> 操作结果
     */
    public Mono<Void> saveGenerationLog(String logType, JSONObject log) {
        // 生成记录当前只接受图片和视频两类。
        if (!"image".equals(logType) && !"video".equals(logType)) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "生成记录类型必须是image或video"));
        }
        SnapshotMetadata metadata = parseSnapshotMetadata(log, "生成记录");
        return currentUserProvider.currentUserId().flatMap(userId -> repository.findGenerationLogById(userId, metadata.id())
                .defaultIfEmpty(new PersistenceRecords.GenerationLogRecord())
                .flatMap(existingRecord -> {
                    PersistenceRecords.GenerationLogRecord record = buildGenerationLogRecord(
                            userId, metadata.id(), logType, metadata.title(), log, existingRecord);
                    return repository.saveGenerationLog(record);
                }));
    }

    /**
     * 修改生成记录标题
     *
     * @param id String 记录ID
     * @param title String 新标题
     * @return Mono<Void> 操作结果
     */
    public Mono<Void> renameGenerationLogTitle(String id, String title) {
        String recordId = firstNonEmpty(id);
        if (!StringUtils.hasText(recordId)) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_MISSING, "记录ID不能为空"));
        }
        String normalizedTitle = firstNonEmpty(title);
        if (!StringUtils.hasText(normalizedTitle)) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_MISSING, "标题不能为空"));
        }
        if (normalizedTitle.length() > GENERATION_LOG_TITLE_MAX_LENGTH) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "标题不能超过100个字符"));
        }
        return currentUserProvider.currentUserId().flatMap(userId ->
                repository.renameGenerationLogTitle(userId, recordId, normalizedTitle)
                        .flatMap(rowsUpdated -> {
                            if (rowsUpdated == null || rowsUpdated <= 0) {
                                return Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "生成记录不存在"));
                            }
                            log.info("修改生成记录标题成功: userId={}, id={}, title={}", userId, recordId, normalizedTitle);
                            return Mono.<Void>empty();
                        }));
    }

    /**
     * 标记当前用户的生成记录已查看。
     *
     * @param id String 生成记录ID
     * @return Mono<Void> 操作结果
     */
    public Mono<Void> markGenerationLogViewed(String id) {
        String recordId = firstNonEmpty(id);
        if (!StringUtils.hasText(recordId)) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_MISSING, "记录ID不能为空"));
        }
        return currentUserProvider.currentUserId().flatMap(userId -> repository.markGenerationLogViewed(userId, recordId)
                .flatMap(rowsUpdated -> {
                    if (rowsUpdated == null || rowsUpdated <= 0) {
                        return Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "生成记录不存在"));
                    }
                    log.info("标记生成记录已查看: userId={}, id={}", userId, recordId);
                    return Mono.<Void>empty();
                }));
    }

    /**
     * 按稳定轮次ID保存或更新生成轮次。
     * <p>
     * 同一轮次从等待到终态始终覆盖原数组位置；批量终态会移除已合并到结果数组的其他等待轮次，
     * 避免生成记录出现重复或永久等待的轮次。
     *
     * @param userId Long 用户ID
     * @param sessionId String Agent 会话ID（复用为生成记录ID）
     * @param logType String 记录类型（image / video）
     * @param title String 对话标题（首次创建时使用）
     * @param round JSONObject 本轮数据，必须包含稳定ID
     * @return Mono<Void> 操作结果
     */
    public Mono<Void> saveOrUpdateGenerationRound(Long userId, String sessionId, String logType, String title, JSONObject round) {
        String roundId = textField(round, "id");
        if (!StringUtils.hasText(roundId)) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_MISSING, "生成轮次ID不能为空"));
        }
        JSONArray activities = agentActivityService.activitiesForRound(sessionId, round);
        if (!activities.isEmpty()) {
            round.put("activities", activities);
        }
        return repository.findGenerationLogById(userId, sessionId)
                .defaultIfEmpty(new PersistenceRecords.GenerationLogRecord())
                .flatMap(existingRecord -> {
                    JSONObject log = StringUtils.hasText(existingRecord.getData())
                            ? parseJson(existingRecord.getData()) : new JSONObject();
                    // 首次保存时初始化会话元数据，后续更新保留既有标题和创建时间。
                    if (!log.containsKey("id")) {
                        log.put("id", sessionId);
                        log.put("title", title);
                        log.put("createdAt", System.currentTimeMillis());
                    }
                    JSONArray rounds = log.getJSONArray("rounds");
                    if (rounds == null) {
                        rounds = new JSONArray();
                        log.put("rounds", rounds);
                    }
                    // 按稳定ID原位置覆盖，未找到时才追加新的生成轮次。
                    boolean replaced = false;
                    for (int index = 0; index < rounds.size(); index++) {
                        if (roundId.equals(textField(rounds.getJSONObject(index), "id"))) {
                            JSONObject existingRound = rounds.getJSONObject(index);
                            if (existingRound.containsKey("createdAt")) {
                                round.put("createdAt", existingRound.getLongValue("createdAt"));
                            }
                            if (!round.containsKey("activities") && existingRound.containsKey("activities")) {
                                round.put("activities", existingRound.getJSONArray("activities"));
                            }
                            rounds.set(index, round);
                            replaced = true;
                            break;
                        }
                    }
                    if (!replaced) {
                        rounds.add(round);
                    }
                    // 一个终态轮次可以聚合同批多个工具结果，删除已被聚合的其他 pending 轮次。
                    Set<String> mergedRoundIds = new HashSet<>();
                    JSONArray results = round.getJSONArray("results");
                    if (results != null) {
                        for (int index = 0; index < results.size(); index++) {
                            String resultId = textField(results.getJSONObject(index), "id");
                            if (StringUtils.hasText(resultId)) {
                                mergedRoundIds.add(resultId);
                            }
                        }
                    }
                    for (int index = rounds.size() - 1; index >= 0; index--) {
                        String candidateId = textField(rounds.getJSONObject(index), "id");
                        if (!roundId.equals(candidateId) && mergedRoundIds.contains(candidateId)) {
                            rounds.remove(index);
                        }
                    }
                    log.put("updatedAt", System.currentTimeMillis());

                    PersistenceRecords.GenerationLogRecord record = buildGenerationLogRecord(
                            userId, sessionId, logType, log.getString("title"), log, existingRecord);
                    return repository.saveGenerationLog(record);
                });
    }

    /**
     * 幂等创建空对话生成记录，保证"发起一次对话即有一条记录"。
     * <p>
     * 仅当会话尚无生成记录时初始化（id=sessionId，rounds 为空），
     * 后续生成轮次仍由 saveOrUpdateGenerationRound 在原记录上追加。
     *
     * @param userId Long 用户ID
     * @param sessionId String Agent 会话ID（复用为生成记录ID）
     * @param logType String 记录类型（image / video）
     * @param title String 对话标题（首次创建时使用）
     * @return Mono<Void> 操作结果
     */
    public Mono<Void> ensureGenerationLog(Long userId, String sessionId, String logType, String title) {
        return repository.findGenerationLogById(userId, sessionId)
                .hasElement()
                .flatMap(exists -> Boolean.TRUE.equals(exists)
                        ? Mono.empty()
                        : Mono.defer(() -> {
                            JSONObject log = new JSONObject();
                            log.put("id", sessionId);
                            log.put("title", title);
                            log.put("createdAt", System.currentTimeMillis());
                            log.put("updatedAt", System.currentTimeMillis());
                            log.put("rounds", new JSONArray());
                            PersistenceRecords.GenerationLogRecord record = buildGenerationLogRecord(
                                    userId, sessionId, logType, title, log, new PersistenceRecords.GenerationLogRecord());
                            return repository.saveGenerationLog(record);
                        }));
    }

    /**
     * 构建生成记录实体并根据完整轮次快照计算任务状态。
     *
     * @param userId Long 用户ID
     * @param id String 生成记录ID
     * @param logType String 生成记录类型
     * @param title String 记录标题
     * @param log JSONObject 完整生成记录快照
     * @param existingRecord GenerationLogRecord 既有记录
     * @return GenerationLogRecord 待保存记录
     */
    private PersistenceRecords.GenerationLogRecord buildGenerationLogRecord(Long userId, String id, String logType,
                                                                              String title, JSONObject log,
                                                                              PersistenceRecords.GenerationLogRecord existingRecord) {
        PersistenceRecords.GenerationLogRecord record = new PersistenceRecords.GenerationLogRecord();
        record.setId(id);
        record.setUserId(userId);
        record.setType(logType);
        record.setTitle(title);
        record.setData(toJson(log));

        // 状态必须基于合并后的完整轮次计算，避免多结果任务提前进入终态。
        String generationStatus = determineGenerationStatus(log);
        record.setGenerationStatus(generationStatus);
        record.setGenerationCompletedAt(resolveGenerationCompletedAt(generationStatus, existingRecord));
        return record;
    }

    /**
     * 根据完整生成轮次计算记录任务状态。
     *
     * @param log JSONObject 完整生成记录快照
     * @return String idle、running、success或failed
     */
    private String determineGenerationStatus(JSONObject log) {
        JSONArray rounds = log.getJSONArray("rounds");
        if (rounds == null || rounds.isEmpty()) {
            return GENERATION_STATUS_IDLE;
        }
        // 任一结果仍为pending时，整条记录保持running。
        for (int index = 0; index < rounds.size(); index++) {
            if (roundStatuses(rounds.getJSONObject(index)).contains("pending")) {
                return GENERATION_STATUS_RUNNING;
            }
        }
        // 无等待结果后，以最近完成轮次是否包含成功结果决定终态。
        List<String> latestStatuses = roundStatuses(rounds.getJSONObject(rounds.size() - 1));
        return latestStatuses.contains(GENERATION_STATUS_SUCCESS)
                ? GENERATION_STATUS_SUCCESS : GENERATION_STATUS_FAILED;
    }

    /**
     * 提取生成轮次内所有结果状态。
     *
     * @param round JSONObject 生成轮次
     * @return List<String> 状态列表
     */
    private List<String> roundStatuses(JSONObject round) {
        List<String> statuses = new ArrayList<>();
        JSONArray results = round.getJSONArray("results");
        if (results != null) {
            for (int index = 0; index < results.size(); index++) {
                addGenerationStatus(statuses, results.getJSONObject(index));
            }
        }
        addGenerationStatus(statuses, round.getJSONObject("result"));
        if (statuses.isEmpty()) {
            addGenerationStatus(statuses, round);
        }
        return statuses;
    }

    /**
     * 将非空生成状态加入列表。
     *
     * @param statuses List<String> 状态列表
     * @param value JSONObject 状态来源对象
     */
    private void addGenerationStatus(List<String> statuses, JSONObject value) {
        if (value == null) {
            return;
        }
        String status = textField(value, "status");
        if (StringUtils.hasText(status)) {
            statuses.add(status);
        }
    }

    /**
     * 确定生成任务完成时间。
     *
     * @param generationStatus String 新生成状态
     * @param existingRecord GenerationLogRecord 既有记录
     * @return OffsetDateTime 完成时间，非终态返回null
     */
    private OffsetDateTime resolveGenerationCompletedAt(String generationStatus,
                                                         PersistenceRecords.GenerationLogRecord existingRecord) {
        if (!GENERATION_STATUS_SUCCESS.equals(generationStatus) && !GENERATION_STATUS_FAILED.equals(generationStatus)) {
            return null;
        }
        if (generationStatus.equals(existingRecord.getGenerationStatus())
                && existingRecord.getGenerationCompletedAt() != null) {
            return existingRecord.getGenerationCompletedAt();
        }
        return OffsetDateTime.now(ZoneOffset.UTC);
    }

    /**
     * 删除生成记录
     *
     * @param ids List<String> 记录ID列表
     * @return Mono<Void> 操作结果
     */
    public Mono<Void> deleteGenerationLogs(List<String> ids) {
        // 批量删除限定当前用户范围。
        return currentUserProvider.currentUserId().flatMap(userId -> repository.deleteGenerationLogs(userId, ids));
    }

    /**
     * 上传媒体并保存元数据
     *
     * @param file FilePart 媒体文件
     * @param input RegisterRemoteMediaRequest 媒体元数据
     * @return Mono<UploadedMediaResponse> 上传结果
     */
    public Mono<PersistenceDtos.UploadedMediaResponse> uploadMedia(FilePart file, PersistenceDtos.RegisterRemoteMediaRequest input) {
        // 上传前读取全站默认对象存储配置，媒体记录仍归属当前用户。
        return currentUserProvider.currentUserId()
                .flatMap(userId -> readFilePart(file)
                        .flatMap(fileBytes -> {
                            String kind = normalizeMediaKind(input.kind());
                            if ("avatar".equals(kind) && fileBytes.length > AVATAR_MAX_FILE_SIZE_BYTES) {
                                return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "头像图片不能超过 2MB"));
                            }
                            return getPlatformObjectStorageConfig().flatMap(objectStorageConfig -> {
                                String mimeType = firstNonEmpty(input.mimeType(), file.headers().getContentType() == null ? null : file.headers().getContentType().toString(), URLConnection.guessContentTypeFromName(file.filename()), "application/octet-stream");
                                String storageKey = firstNonEmpty(input.storageKey(), kind + ":" + newId());
                                String objectKey = buildObjectKey(objectStorageConfig, kind, file.filename(), mimeType);
                                return putObject(objectStorageConfig, objectKey, fileBytes, mimeType)
                                        .flatMap(publicUrl -> {
                                            PersistenceRecords.MediaFileRecord record = buildMediaRecord(userId, storageKey, kind, null, publicUrl, objectKey, objectStorageConfig, mimeType, (long) fileBytes.length, input.width(), input.height(), input.durationMs(), input.metadata());
                                            return repository.saveMedia(record).thenReturn(mediaResponse(record));
                                        });
                            });
                        }));
    }

    /**
     * 测试当前请求提供的对象存储配置。
     * <p>
     * 测试上传不依赖已保存的默认对象存储，也不会创建媒体记录。
     *
     * @param config ObjectStorageConfig 当前待测试的对象存储配置
     * @return Mono<ObjectStorageFile> 测试文件的对象存储信息
     */
    public Mono<PersistenceDtos.ObjectStorageFile> testObjectStorage(PersistenceDtos.ObjectStorageConfig config) {
        String mimeType = "text/plain;charset=utf-8";
        OffsetDateTime testedAt = OffsetDateTime.now(ZoneOffset.UTC);
        byte[] data = ("Novanova Studio 对象存储测试 " + testedAt).getBytes(StandardCharsets.UTF_8);
        String key = buildObjectKey(config, "file", "object-storage-test.txt", mimeType);
        return putObject(config, key, data, mimeType)
                .map(url -> {
                    log.info("对象存储测试上传成功: provider={}, bucket={}, region={}, key={}", config.provider(), config.bucket(), config.region(), key);
                    return new PersistenceDtos.ObjectStorageFile(config.provider(), url, key, config.bucket(), config.region(), (long) data.length, mimeType, formatTime(testedAt));
                })
                .doOnError(error -> log.error("对象存储测试上传失败: provider={}, bucket={}, region={}", config.provider(), config.bucket(), config.region(), error));
    }

    /**
     * 登记远程媒体
     *
     * @param input RegisterRemoteMediaRequest 媒体元数据
     * @return Mono<UploadedMediaResponse> 媒体信息
     */
    public Mono<PersistenceDtos.UploadedMediaResponse> registerRemoteMedia(PersistenceDtos.RegisterRemoteMediaRequest input) {
        // 远程媒体只登记URL和元数据，不执行文件上传。
        if (!StringUtils.hasText(input.sourceUrl())) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_MISSING, "远程URL不能为空"));
        }
        return currentUserProvider.currentUserId().flatMap(userId -> registerRemoteMediaForUser(userId, input));
    }

    /**
     * 为指定用户登记远程媒体
     *
     * @param userId Long 用户ID
     * @param input RegisterRemoteMediaRequest 媒体元数据
     * @return Mono<UploadedMediaResponse> 媒体信息
     */
    public Mono<PersistenceDtos.UploadedMediaResponse> registerRemoteMediaForUser(Long userId, PersistenceDtos.RegisterRemoteMediaRequest input) {
        // AI异步任务没有请求上下文时，通过显式用户ID登记第三方返回的原始媒体URL，不上传对象存储。
        if (!StringUtils.hasText(input.sourceUrl())) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_MISSING, "远程URL不能为空"));
        }
        String sourceUrl = input.sourceUrl().trim();
        return aiHttpClient.validateRemoteMediaUrl(sourceUrl)
                .then(saveRemoteMediaForUser(userId, input));
    }

    /**
     * 保存远程媒体记录。
     *
     * @param userId Long 媒体归属用户ID
     * @param input RegisterRemoteMediaRequest 媒体元数据
     * @return Mono<UploadedMediaResponse> 已保存的媒体信息
     */
    private Mono<PersistenceDtos.UploadedMediaResponse> saveRemoteMediaForUser(Long userId, PersistenceDtos.RegisterRemoteMediaRequest input) {
        return Mono.defer(() -> {
            String kind = normalizeMediaKind(input.kind());
            String storageKey = firstNonEmpty(input.storageKey(), kind + ":" + newId());
            JSONObject metadata = input.metadata() == null ? new JSONObject() : JSON.parseObject(toJson(input.metadata()));
            PersistenceRecords.MediaFileRecord record = buildMediaRecord(userId, storageKey, kind, input.sourceUrl().trim(), null, null, null, firstNonEmpty(input.mimeType(), "application/octet-stream"), input.bytes() == null ? 0L : input.bytes(), input.width(), input.height(), input.durationMs(), metadata);
            return repository.saveMedia(record).thenReturn(mediaResponse(record));
        });
    }

    /**
     * 保存AI生成媒体
     *
     * @param kind String 媒体类型
     * @param fileName String 文件名
     * @param mimeType String MIME类型
     * @param data byte[] 媒体字节
     * @param width Integer 宽度
     * @param height Integer 高度
     * @param durationMs Integer 时长毫秒
     * @return Mono<UploadedMediaResponse> 媒体响应
     */
    public Mono<PersistenceDtos.UploadedMediaResponse> storeGeneratedMedia(String kind, String fileName, String mimeType, byte[] data, Integer width, Integer height, Integer durationMs) {
        // 默认使用当前登录用户保存生成媒体。
        return currentUserProvider.currentUserId().flatMap(userId -> storeGeneratedMediaForUser(userId, kind, fileName, mimeType, data, width, height, durationMs));
    }

    /**
     * 为指定用户保存AI生成媒体
     *
     * @param userId Long 用户ID
     * @param kind String 媒体类型
     * @param fileName String 文件名
     * @param mimeType String MIME类型
     * @param data byte[] 媒体字节
     * @param width Integer 宽度
     * @param height Integer 高度
     * @param durationMs Integer 时长毫秒
     * @return Mono<UploadedMediaResponse> 媒体响应
     */
    public Mono<PersistenceDtos.UploadedMediaResponse> storeGeneratedMediaForUser(Long userId, String kind, String fileName, String mimeType, byte[] data, Integer width, Integer height, Integer durationMs) {
        // AI异步任务可能脱离请求线程，但始终使用全站默认对象存储。
        return getPlatformObjectStorageConfig().flatMap(objectStorageConfig -> {
            String normalizedKind = normalizeMediaKind(kind);
            String storageKey = normalizedKind + ":" + newId();
            String objectKey = buildObjectKey(objectStorageConfig, normalizedKind, fileName, mimeType);
            return putObject(objectStorageConfig, objectKey, data, firstNonEmpty(mimeType, "application/octet-stream"))
                    .flatMap(publicUrl -> {
                        PersistenceRecords.MediaFileRecord record = buildMediaRecord(userId, storageKey, normalizedKind, null, publicUrl, objectKey, objectStorageConfig, mimeType, (long) data.length, width, height, durationMs, null);
                        return repository.saveMedia(record).thenReturn(mediaResponse(record));
                    });
        });
    }

    /**
     * 为指定用户从本地文件保存生成媒体。
     * <p>
     * 视频合成任务使用此方法流式上传FFmpeg输出文件，避免将完整成片加载到JVM堆内存。
     *
     * @param userId Long 用户ID
     * @param kind String 媒体类型
     * @param fileName String 文件名
     * @param mimeType String MIME类型
     * @param file Path 本地媒体文件
     * @param width Integer 宽度
     * @param height Integer 高度
     * @param durationMs Integer 时长毫秒
     * @return Mono<UploadedMediaResponse> 媒体响应
     */
    public Mono<PersistenceDtos.UploadedMediaResponse> storeGeneratedMediaFileForUser(
            Long userId, String kind, String fileName, String mimeType, Path file, Integer width, Integer height, Integer durationMs) {
        return getPlatformObjectStorageConfig().flatMap(objectStorageConfig -> Mono.fromCallable(() -> Files.size(file))
                .subscribeOn(Schedulers.boundedElastic())
                .flatMap(bytes -> {
                    String normalizedKind = normalizeMediaKind(kind);
                    String storageKey = normalizedKind + ":" + newId();
                    String objectKey = buildObjectKey(objectStorageConfig, normalizedKind, fileName, mimeType);
                    return putObject(objectStorageConfig, objectKey, file, firstNonEmpty(mimeType, "application/octet-stream"))
                            .flatMap(publicUrl -> {
                                PersistenceRecords.MediaFileRecord record = buildMediaRecord(userId, storageKey, normalizedKind, null, publicUrl, objectKey,
                                        objectStorageConfig, mimeType, bytes, width, height, durationMs, null);
                                return repository.saveMedia(record).thenReturn(mediaResponse(record));
                            });
                }));
    }

    /**
     * 查询媒体信息
     *
     * @param storageKey String 媒体存储键
     * @return Mono<UploadedMediaResponse> 媒体信息
     */
    public Mono<PersistenceDtos.UploadedMediaResponse> getMediaInfo(String storageKey) {
        // 默认按当前用户查询媒体。
        return currentUserProvider.currentUserId().flatMap(userId -> getMediaInfoForUser(userId, storageKey));
    }

    /**
     * 查询指定用户媒体信息
     *
     * @param userId Long 用户ID
     * @param storageKey String 媒体存储键
     * @return Mono<UploadedMediaResponse> 媒体信息
     */
    public Mono<PersistenceDtos.UploadedMediaResponse> getMediaInfoForUser(Long userId, String storageKey) {
        // 媒体查询同时限定用户ID和媒体存储键。
        return repository.getMedia(userId, storageKey)
                .map(this::mediaResponse)
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "媒体不存在")));
    }

    /**
     * 将指定用户的视频媒体流式下载到本地文件。
     *
     * @param userId Long 用户ID
     * @param storageKey String 媒体存储键
     * @param target Path 本地目标文件
     * @return Mono<DownloadedMediaFile> 已下载媒体信息
     */
    public Mono<DownloadedMediaFile> downloadVideoMediaToFileForUser(Long userId, String storageKey, Path target) {
        String normalizedStorageKey = firstNonEmpty(storageKey);
        if (!StringUtils.hasText(normalizedStorageKey)) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_MISSING, "视频媒体存储键不能为空"));
        }
        return repository.getMedia(userId, normalizedStorageKey)
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "视频媒体不存在")))
                .flatMap(record -> {
                    if (!"video".equals(normalizeMediaKind(record.getKind()))) {
                        return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "合成输入必须是视频媒体"));
                    }
                    String sourceUrl = firstNonEmpty(record.getObjectStorageUrl(), record.getSourceUrl());
                    if (!StringUtils.hasText(sourceUrl)) {
                        return Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "视频媒体没有可下载的地址"));
                    }
                    String mimeType = firstNonEmpty(record.getMimeType(), "video/mp4");
                    long maximumBytes = Math.max(1L, properties.getAi().getVideoComposition().getMaximumInputBytes());
                    log.info("下载视频合成源媒体: userId={}, storageKey={}", userId, normalizedStorageKey);
                    return aiHttpClient.downloadRemoteMediaToFile(sourceUrl, mimeType, target, maximumBytes)
                            .map(downloaded -> new DownloadedMediaFile(normalizedStorageKey, target, downloaded.mimeType(), downloaded.bytes()));
                });
    }

    /**
     * 校验指定用户拥有可用于合成的视频媒体。
     *
     * @param userId Long 用户ID
     * @param storageKey String 媒体存储键
     * @return Mono<Void> 校验结果
     */
    public Mono<Void> validateVideoMediaForUser(Long userId, String storageKey) {
        String normalizedStorageKey = firstNonEmpty(storageKey);
        if (!StringUtils.hasText(normalizedStorageKey)) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_MISSING, "视频媒体存储键不能为空"));
        }
        return repository.getMedia(userId, normalizedStorageKey)
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "视频媒体不存在")))
                .flatMap(record -> {
                    if (!"video".equals(normalizeMediaKind(record.getKind()))) {
                        return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "合成输入必须是视频媒体"));
                    }
                    if (!StringUtils.hasText(firstNonEmpty(record.getObjectStorageUrl(), record.getSourceUrl()))) {
                        return Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "视频媒体没有可下载的地址"));
                    }
                    return Mono.empty();
                });
    }

    /**
     * 下载当前用户的已登记媒体。
     * <p>
     * 服务端按媒体存储键读取归属记录，再请求媒体源地址，避免浏览器直连第三方媒体地址时受到跨域限制。
     *
     * @param storageKey String 当前用户的媒体存储键
     * @return Mono<DownloadedMedia> 可下载的媒体内容
     */
    public Mono<PersistenceDtos.DownloadedMedia> downloadMedia(String storageKey) {
        String normalizedStorageKey = firstNonEmpty(storageKey);
        if (!StringUtils.hasText(normalizedStorageKey)) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_MISSING, "媒体存储键不能为空"));
        }
        return currentUserProvider.currentUserId().flatMap(userId -> repository.getMedia(userId, normalizedStorageKey)
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "媒体不存在")))
                .flatMap(record -> {
                    String sourceUrl = firstNonEmpty(record.getObjectStorageUrl(), record.getSourceUrl());
                    if (!StringUtils.hasText(sourceUrl)) {
                        return Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "媒体没有可下载的地址"));
                    }
                    String defaultMimeType = firstNonEmpty(record.getMimeType(), "application/octet-stream");
                    log.info("开始下载媒体: userId={}, storageKey={}", userId, normalizedStorageKey);
                    return aiHttpClient.downloadRemoteBinary(sourceUrl, defaultMimeType)
                            .map(binary -> {
                                String mimeType = firstNonEmpty(binary.mimeType(), defaultMimeType);
                                return new PersistenceDtos.DownloadedMedia(
                                        binary.data(),
                                        mimeType,
                                        "generated-" + normalizeMediaKind(record.getKind()) + mediaFileExtension(mimeType));
                            });
                }));
    }

    /**
     * 将当前用户登记的远程媒体下载并转存到默认对象存储。
     *
     * @param storageKey String 当前用户的媒体存储键
     * @return Mono<UploadedMediaResponse> 转存后的媒体信息
     */
    public Mono<PersistenceDtos.UploadedMediaResponse> uploadRemoteMediaToObjectStorage(String storageKey) {
        String normalizedStorageKey = firstNonEmpty(storageKey);
        if (!StringUtils.hasText(normalizedStorageKey)) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_MISSING, "媒体存储键不能为空"));
        }
        log.info("开始转存远程媒体到默认对象存储: storageKey={}", normalizedStorageKey);
        return currentUserProvider.currentUserId().flatMap(userId -> repository.getMedia(userId, normalizedStorageKey)
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "媒体不存在")))
                .flatMap(record -> {
                    if (StringUtils.hasText(record.getObjectStorageUrl())) {
                        return Mono.just(mediaResponse(record));
                    }
                    if (!StringUtils.hasText(record.getSourceUrl())) {
                        return Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "媒体没有可转存的远程地址"));
                    }
                    String originalMimeType = firstNonEmpty(record.getMimeType(), "application/octet-stream");
                    return aiHttpClient.downloadRemoteBinary(record.getSourceUrl(), originalMimeType)
                            .flatMap(binary -> getPlatformObjectStorageConfig().flatMap(objectStorageConfig -> {
                                String mimeType = firstNonEmpty(binary.mimeType(), originalMimeType);
                                String normalizedKind = normalizeMediaKind(record.getKind());
                                String fileName = "generated-" + normalizedKind + mediaFileExtension(mimeType);
                                String objectKey = buildObjectKey(objectStorageConfig, normalizedKind, fileName, mimeType);
                                return putObject(objectStorageConfig, objectKey, binary.data(), mimeType)
                                        .flatMap(publicUrl -> {
                                            record.setObjectStorageProvider(objectStorageConfig.provider());
                                            record.setObjectStorageUrl(publicUrl);
                                            record.setObjectStorageKey(objectKey);
                                            record.setBucket(objectStorageConfig.bucket());
                                            record.setRegion(objectStorageConfig.region());
                                            record.setMimeType(mimeType);
                                            record.setBytes((long) binary.data().length);
                                            return repository.saveMedia(record)
                                                    .doOnSuccess(ignored -> log.info("远程媒体转存完成: userId={}, storageKey={}", userId, normalizedStorageKey))
                                                    .thenReturn(mediaResponse(record));
                                        });
                            }));
                }));
    }

    /**
     * 根据媒体类型生成文件扩展名。
     *
     * @param mimeType String MIME类型
     * @return String 带点号的文件扩展名
     */
    private String mediaFileExtension(String mimeType) {
        String normalizedMimeType = firstNonEmpty(mimeType).split(";", 2)[0].trim().toLowerCase();
        return switch (normalizedMimeType) {
            case "image/jpeg" -> ".jpg";
            case "image/webp" -> ".webp";
            case "image/gif" -> ".gif";
            case "video/webm" -> ".webm";
            case "video/quicktime" -> ".mov";
            case "video/mp4" -> ".mp4";
            default -> ".bin";
        };
    }

    /**
     * 删除媒体
     *
     * @param storageKeys List<String> 媒体存储键列表
     * @return Mono<Void> 操作结果
     */
    public Mono<Void> deleteMedia(List<String> storageKeys) {
        // 删除媒体只移除当前用户的媒体记录。
        return currentUserProvider.currentUserId().flatMap(userId -> repository.deleteMedia(userId, storageKeys));
    }

    /**
     * 删除指定用户的媒体记录。
     * <p>
     * 异步媒体任务没有HTTP请求上下文时，使用任务已保存的用户ID执行归属限定删除。
     *
     * @param userId Long 媒体所属用户ID
     * @param storageKeys List<String> 媒体存储键列表
     * @return Mono<Void> 删除结果
     */
    public Mono<Void> deleteMediaForUser(Long userId, List<String> storageKeys) {
        return repository.deleteMedia(userId, storageKeys);
    }

    /**
     * 获取全站默认对象存储配置。
     *
     * @return Mono<ObjectStorageConfig> 全站对象存储配置
     */
    private Mono<PersistenceDtos.ObjectStorageConfig> getPlatformObjectStorageConfig() {
        // 仅在服务端解密密钥，普通用户永远无法读取对象存储密钥。
        return repository.getDefaultPlatformObjectStorage()
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "请联系管理员配置默认对象存储")))
                .flatMap(record -> decryptObjectStorage(record).map(config -> {
            try {
                objectStorageService.validate(config);
            } catch (BusinessException exception) {
                log.info("全站默认对象存储配置不完整: storageId={}", record.getStorageId());
                throw new BusinessException(ErrorCode.BUSINESS_ERROR, "请联系管理员完整配置默认对象存储");
            }
            return config;
        }));
    }

    /**
     * 读取上传文件内容
     *
     * @param file FilePart 上传文件
     * @return Mono<byte[]> 文件字节
     */
    private Mono<byte[]> readFilePart(FilePart file) {
        // 将WebFlux上传文件聚合为字节数组，便于后续对象存储上传。
        return DataBufferUtils.join(file.content()).map(dataBuffer -> {
            try {
                byte[] bytes = new byte[dataBuffer.readableByteCount()];
                dataBuffer.read(bytes);
                return bytes;
            } finally {
                DataBufferUtils.release(dataBuffer);
            }
        });
    }

    /**
     * 上传对象到对象存储
     *
     * @param config ObjectStorageConfig 对象存储配置
     * @param key String 对象Key
     * @param data byte[] 文件字节
     * @param mimeType String MIME类型
     * @return Mono<String> 公开访问URL
     */
    private Mono<String> putObject(PersistenceDtos.ObjectStorageConfig config, String key, byte[] data, String mimeType) {
        // COS上传使用阻塞HttpClient，放入boundedElastic执行。
        return Mono.fromCallable(() -> objectStorageService.putObject(config, key, new java.io.ByteArrayInputStream(data), data.length, mimeType))
                .subscribeOn(Schedulers.boundedElastic());
    }

    /**
     * 将本地文件流式上传到对象存储。
     *
     * @param config ObjectStorageConfig 对象存储配置
     * @param key String 对象Key
     * @param file Path 本地文件
     * @param mimeType String MIME类型
     * @return Mono<String> 公开访问URL
     */
    private Mono<String> putObject(PersistenceDtos.ObjectStorageConfig config, String key, Path file, String mimeType) {
        return Mono.fromCallable(() -> {
            long bytes = Files.size(file);
            try (InputStream inputStream = Files.newInputStream(file)) {
                return objectStorageService.putObject(config, key, inputStream, bytes, mimeType);
            }
        }).subscribeOn(Schedulers.boundedElastic());
    }

    /**
     * 流式下载到本地的视频媒体信息。
     *
     * @param storageKey String 媒体存储键
     * @param path Path 本地文件路径
     * @param mimeType String MIME类型
     * @param bytes Long 文件字节数
     */
    public record DownloadedMediaFile(String storageKey, Path path, String mimeType, Long bytes) {
    }

    /**
     * 构建媒体记录
     *
     * @param userId Long 用户ID
     * @param storageKey String 存储键
     * @param kind String 类型
     * @param sourceUrl String 远程URL
     * @param objectStorageUrl String 对象存储URL
     * @param objectStorageKey String 对象存储键
     * @param objectStorageConfig ObjectStorageConfig 对象存储配置
     * @param mimeType String MIME类型
     * @param bytes Long 文件大小
     * @param width Integer 宽度
     * @param height Integer 高度
     * @param durationMs Integer 时长
     * @param metadata JSONObject 元数据
     * @return MediaFileRecord 媒体记录
     */
    private PersistenceRecords.MediaFileRecord buildMediaRecord(Long userId, String storageKey, String kind, String sourceUrl, String objectStorageUrl, String objectStorageKey, PersistenceDtos.ObjectStorageConfig objectStorageConfig, String mimeType, Long bytes, Integer width, Integer height, Integer durationMs, JSONObject metadata) {
        // 将接口入参归一化为数据库媒体记录。
        PersistenceRecords.MediaFileRecord record = new PersistenceRecords.MediaFileRecord();
        record.setStorageKey(storageKey);
        record.setUserId(userId);
        record.setKind(kind);
        record.setSourceUrl(sourceUrl);
        record.setObjectStorageProvider(objectStorageConfig == null ? "" : objectStorageConfig.provider());
        record.setObjectStorageUrl(objectStorageUrl);
        record.setObjectStorageKey(objectStorageKey);
        record.setBucket(objectStorageConfig == null ? null : objectStorageConfig.bucket());
        record.setRegion(objectStorageConfig == null ? null : objectStorageConfig.region());
        record.setMimeType(firstNonEmpty(mimeType, "application/octet-stream"));
        record.setBytes(bytes == null ? 0L : bytes);
        record.setWidth(width);
        record.setHeight(height);
        record.setDurationMs(durationMs);
        record.setMetadata(metadata == null || metadata.isEmpty() ? "{}" : toJson(metadata));
        record.setStatus(1);
        record.setUpdatedAt(OffsetDateTime.now(ZoneOffset.UTC));
        return record;
    }

    /**
     * 转换媒体响应
     *
     * @param record MediaFileRecord 媒体记录
     * @return UploadedMediaResponse 媒体响应
     */
    private PersistenceDtos.UploadedMediaResponse mediaResponse(PersistenceRecords.MediaFileRecord record) {
        // 已转存媒体额外返回对象存储详情，远程媒体只返回来源URL。
        PersistenceDtos.ObjectStorageFile objectStorage = null;
        if (StringUtils.hasText(record.getObjectStorageUrl())) {
            objectStorage = new PersistenceDtos.ObjectStorageFile(record.getObjectStorageProvider(), record.getObjectStorageUrl(), record.getObjectStorageKey(), record.getBucket(), record.getRegion(), record.getBytes(), record.getMimeType(), formatTime(record.getUpdatedAt()));
        }
        return new PersistenceDtos.UploadedMediaResponse(record.getStorageKey(), firstNonEmpty(record.getObjectStorageUrl(), record.getSourceUrl()), record.getBytes(), record.getMimeType(), record.getWidth(), record.getHeight(), record.getDurationMs(), objectStorage);
    }

    /**
     * 解析快照元数据
     *
     * @param data JSONObject 快照JSON
     * @param label String 标签
     * @return SnapshotMetadata 快照元数据
     */
    private SnapshotMetadata parseSnapshotMetadata(JSONObject data, String label) {
        // 快照类数据必须是JSON对象，并且必须包含ID。
        if (data == null) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "JSON数据格式不合法");
        }
        String id = textField(data, "id");
        if (!StringUtils.hasText(id)) {
            throw new BusinessException(ErrorCode.PARAM_MISSING, label + "ID不能为空");
        }
        return new SnapshotMetadata(id, firstNonEmpty(textField(data, "title"), "未命名"));
    }

    /**
     * 加密配置JSON
     *
     * @param data String 配置JSON
     * @return Mono<String> 加密结果
     */
    private Mono<String> encryptSecret(String data) {
        // AES-GCM加密属于CPU操作，放入boundedElastic执行。
        return Mono.fromCallable(() -> SensitiveDataCrypto.encrypt(data, properties.getApp().getSecretKey()))
                .subscribeOn(Schedulers.boundedElastic()).onErrorMap(exception -> {
            if (exception instanceof BusinessException) {
                return exception;
            }
            log.error("加密敏感配置失败", exception);
            return new BusinessException(ErrorCode.SYSTEM_ERROR, "加密敏感配置失败: " + exception.getMessage());
        });
    }

    /**
     * 解密配置JSON
     *
     * @param value String 加密配置
     * @return Mono<String> 配置JSON
     */
    private Mono<String> decryptSecret(String value) {
        // 配置必须带版本前缀，便于后续升级加密格式。
        if (!StringUtils.hasText(value)) {
            return Mono.just("");
        }
        return Mono.fromCallable(() -> SensitiveDataCrypto.decrypt(value, properties.getApp().getSecretKey()))
                .subscribeOn(Schedulers.boundedElastic()).onErrorMap(exception -> {
            if (exception instanceof BusinessException) {
                return exception;
            }
            log.error("解密敏感配置失败", exception);
            return new BusinessException(ErrorCode.SYSTEM_ERROR, "解密敏感配置失败: " + exception.getMessage());
        });
    }

    /**
     * 构建普通配置JSON
     *
     * @param data JSONObject 原始用户配置
     * @return JSONObject 脱敏后的普通配置
     */
    private JSONObject buildPlainSettingsData(JSONObject data) {
        // 深拷贝后移除所有敏感字段，普通配置以明文JSONB保存。
        JSONObject settings = parseJson(toJson(data));
        JSONObject config = settings.getJSONObject("config");
        if (config != null) {
            config.remove("apiKey");
            config.remove("channels");
        }
        settings.remove("objectStorage");
        settings.remove("objectStorages");
        settings.remove("activeObjectStorageId");
        return settings;
    }

    /**
     * 构建用户AI渠道记录
     *
     * @param userId Long 用户ID
     * @param data JSONObject 原始用户配置
     * @return Mono<List<UserAiChannelRecord>> 渠道记录列表
     */
    private Mono<List<PersistenceRecords.UserAiChannelRecord>> buildUserAiChannelRecords(Long userId, JSONObject data) {
        // 前端服务端虚拟渠道不落用户渠道表。
        JSONArray channels = userChannelArray(data);
        return Flux.range(0, channels.size())
                .concatMap(index -> {
                    JSONObject item = channels.getJSONObject(index);
                    if (item == null || SERVER_CHANNEL_ID.equals(textField(item, "id"))) {
                        return Mono.empty();
                    }
                    return encryptSecret(textField(item, "apiKey")).map(encrypted -> {
                        PersistenceRecords.UserAiChannelRecord record = new PersistenceRecords.UserAiChannelRecord();
                        record.setUserId(userId);
                        record.setChannelId(firstNonEmpty(textField(item, "id"), "channel-" + (index + 1)));
                        record.setName(firstNonEmpty(textField(item, "name"), "渠道 " + (index + 1)));
                        record.setBaseUrl(textField(item, "baseUrl"));
                        record.setApiKeyEncrypted(encrypted);
                        record.setApiFormat(firstNonEmpty(textField(item, "apiFormat"), "openai"));
                        record.setModels(toJsonArrayString(item.getJSONArray("models")));
                        record.setSortOrder(index);
                        record.setStatus(1);
                        return record;
                    });
                })
                .collectList();
    }

    /**
     * 构建用户对象存储记录
     *
     * @param userId Long 用户ID
     * @param data JSONObject 原始用户配置
     * @return Mono<List<UserObjectStorageRecord>> 对象存储记录列表
     */
    private Mono<List<PersistenceRecords.UserObjectStorageRecord>> buildUserObjectStorageRecords(Long userId, JSONObject data) {
        // 对象存储支持多条配置，第一条或显式选中项作为默认配置。
        JSONArray objectStorages = objectStorageArray(data);
        String activeObjectStorageId = textField(data, "activeObjectStorageId");
        return Flux.range(0, objectStorages.size())
                .concatMap(index -> {
                    JSONObject item = objectStorages.getJSONObject(index);
                    if (item == null) {
                        return Mono.empty();
                    }
                    String storageId = firstNonEmpty(textField(item, "id"), index == 0 ? DEFAULT_OBJECT_STORAGE_ID : "storage-" + (index + 1));
                    return Mono.zip(encryptSecret(textField(item, "accessKey")), encryptSecret(textField(item, "secretKey"))).map(tuple -> {
                        PersistenceRecords.UserObjectStorageRecord record = new PersistenceRecords.UserObjectStorageRecord();
                        record.setUserId(userId);
                        record.setStorageId(storageId);
                        record.setName(firstNonEmpty(textField(item, "name"), "对象存储 " + (index + 1)));
                        record.setProvider(firstNonEmpty(textField(item, "provider"), "tencentCos"));
                        record.setAccessKeyEncrypted(tuple.getT1());
                        record.setSecretKeyEncrypted(tuple.getT2());
                        record.setBucket(textField(item, "bucket"));
                        record.setRegion(textField(item, "region"));
                        record.setEndpoint(textField(item, "endpoint"));
                        record.setDirectory(textField(item, "directory"));
                        record.setPublicBaseUrl(textField(item, "publicBaseUrl"));
                        record.setDefaultStorage(Boolean.TRUE.equals(item.getBoolean("defaultStorage")));
                        record.setLastTestedAt(textField(item, "lastTestedAt"));
                        record.setStatus(1);
                        return record;
                    });
                })
                .collectList()
                .map(records -> normalizeDefaultObjectStorage(records, activeObjectStorageId));
    }

    /**
     * 规范化默认对象存储
     *
     * @param records List<UserObjectStorageRecord> 对象存储记录
     * @param activeObjectStorageId String 当前选中对象存储ID
     * @return List<UserObjectStorageRecord> 规范化后的对象存储记录
     */
    private List<PersistenceRecords.UserObjectStorageRecord> normalizeDefaultObjectStorage(List<PersistenceRecords.UserObjectStorageRecord> records, String activeObjectStorageId) {
        // 当前请求必须且只能有一个默认对象存储；旧请求无默认标记时才按选中项补齐。
        if (records.isEmpty()) {
            return records;
        }
        String defaultStorageId = "";
        for (PersistenceRecords.UserObjectStorageRecord record : records) {
            if (Boolean.TRUE.equals(record.getDefaultStorage())) {
                defaultStorageId = record.getStorageId();
                break;
            }
        }
        if (!StringUtils.hasText(defaultStorageId) && StringUtils.hasText(activeObjectStorageId)) {
            for (PersistenceRecords.UserObjectStorageRecord record : records) {
                if (activeObjectStorageId.equals(record.getStorageId())) {
                    defaultStorageId = record.getStorageId();
                    break;
                }
            }
        }
        if (!StringUtils.hasText(defaultStorageId)) {
            defaultStorageId = records.get(0).getStorageId();
        }
        for (PersistenceRecords.UserObjectStorageRecord record : records) {
            record.setDefaultStorage(defaultStorageId.equals(record.getStorageId()));
        }
        return records;
    }

    /**
     * 解密对象存储记录
     *
     * @param record UserObjectStorageRecord 对象存储记录
     * @return Mono<ObjectStorageConfig> 对象存储配置
     */
    private Mono<PersistenceDtos.ObjectStorageConfig> decryptObjectStorage(PersistenceRecords.UserObjectStorageRecord record) {
        // 访问密钥和SecretKey分别解密后还原为业务配置。
        return Mono.zip(decryptSecret(record.getAccessKeyEncrypted()), decryptSecret(record.getSecretKeyEncrypted()))
                .map(tuple -> new PersistenceDtos.ObjectStorageConfig(record.getProvider(), tuple.getT1(), tuple.getT2(), record.getBucket(), record.getRegion(), record.getEndpoint(), record.getDirectory(), record.getPublicBaseUrl(), record.getStorageId(), record.getName(), record.getLastTestedAt(), record.getDefaultStorage()));
    }

    /**
     * 查询全站对象存储响应列表。
     *
     * @return Mono<List<JSONObject>> 全站对象存储JSON列表
     */
    public Mono<List<JSONObject>> getPlatformObjectStorages() {
        // 管理员配置接口需要完整对象存储信息，密钥只在管理员鉴权后返回。
        return repository.listPlatformObjectStorages()
                .concatMap(this::decryptObjectStorage)
                .map(config -> JSON.parseObject(JSON.toJSONString(config)))
                .collectList();
    }

    /**
     * 读取请求中的AI渠道数组
     *
     * @param data JSONObject 原始用户配置
     * @return JSONArray AI渠道数组
     */
    private JSONArray userChannelArray(JSONObject data) {
        // 渠道位于config.channels嵌套结构中。
        JSONObject config = data == null ? null : data.getJSONObject("config");
        JSONArray channels = config == null ? null : config.getJSONArray("channels");
        return channels == null ? new JSONArray() : channels;
    }

    /**
     * 读取请求中的对象存储数组
     *
     * @param data JSONObject 原始用户配置
     * @return JSONArray 对象存储数组
     */
    private JSONArray objectStorageArray(JSONObject data) {
        // 新结构优先读取objectStorages，旧结构则把objectStorage包装为单元素数组。
        JSONArray objectStorages = data == null ? null : data.getJSONArray("objectStorages");
        if (objectStorages != null && !objectStorages.isEmpty()) {
            return objectStorages;
        }
        JSONObject objectStorage = data == null ? null : data.getJSONObject("objectStorage");
        JSONArray array = new JSONArray();
        if (objectStorage != null && !objectStorage.isEmpty()) {
            array.add(objectStorage);
        }
        return array;
    }

    /**
     * 转换JSON数组字符串
     *
     * @param values JSONArray JSON数组
     * @return String JSON数组字符串
     */
    private String toJsonArrayString(JSONArray values) {
        // 空模型列表按空数组保存。
        return JSON.toJSONString(values == null ? new JSONArray() : values);
    }

    /**
     * 解析字符串列表
     *
     * @param value String JSON数组字符串
     * @return List<String> 字符串列表
     */
    private List<String> parseStringList(String value) {
        try {
            // 渠道模型列表按字符串数组处理。
            return JSON.parseObject(StringUtils.hasText(value) ? value : "[]", new TypeReference<List<String>>() {
            });
        } catch (Exception exception) {
            log.error("解析模型列表失败", exception);
            return new ArrayList<>();
        }
    }

    /**
     * 解析JSON
     *
     * @param value String JSON字符串
     * @return JSONObject JSON节点
     */
    private JSONObject parseJson(String value) {
        try {
            // 空字符串按空对象处理，保证前端读取旧空数据时不报错。
            return JSON.parseObject(StringUtils.hasText(value) ? value : "{}");
        } catch (Exception exception) {
            throw new BusinessException(ErrorCode.SYSTEM_ERROR, "解析JSON失败: " + exception.getMessage());
        }
    }

    /**
     * 转换JSON字符串
     *
     * @param value JSONObject JSON节点
     * @return String JSON字符串
     */
    private String toJson(JSONObject value) {
        try {
            // 空节点按空对象序列化，避免数据库写入null。
            return JSON.toJSONString(value == null ? new JSONObject() : value);
        } catch (Exception exception) {
            throw new BusinessException(ErrorCode.SYSTEM_ERROR, "序列化JSON失败: " + exception.getMessage());
        }
    }

    /**
     * 读取字符串字段
     *
     * @param data JSONObject JSON节点
     * @param field String 字段名
     * @return String 字段值
     */
    private String textField(JSONObject data, String field) {
        // 只读取文本形式字段，缺失或null统一返回空字符串。
        String value = data == null ? null : data.getString(field);
        return value == null ? "" : value.trim();
    }

    /**
     * 构建对象Key
     *
     * @param config ObjectStorageConfig 对象存储配置
     * @param kind String 媒体类型
     * @param fileName String 文件名
     * @param mimeType String MIME类型
     * @return String 对象Key
     */
    private String buildObjectKey(PersistenceDtos.ObjectStorageConfig config, String kind, String fileName, String mimeType) {
        // 对象键按目录、媒体类型、日期和随机ID组织，便于后续清理和排查。
        String directory = firstNonEmpty(config.directory(), "novanova-studio").replace("\\", "/").replaceAll("^/+|/+$", "");
        String date = java.time.LocalDate.now().format(java.time.format.DateTimeFormatter.BASIC_ISO_DATE);
        return directory + "/" + mediaFolder(kind) + "/" + date + "/" + newId() + "." + fileExtension(fileName, mimeType, kind);
    }

    /**
     * 规范化媒体类型
     *
     * @param kind String 媒体类型
     * @return String 规范化媒体类型
     */
    private String normalizeMediaKind(String kind) {
        // 未传媒体类型时统一归为普通文件。
        return StringUtils.hasText(kind) ? kind.trim() : "file";
    }

    /**
     * 获取媒体目录
     *
     * @param kind String 媒体类型
     * @return String 媒体目录
     */
    private String mediaFolder(String kind) {
        // 根据媒体类型选择对象存储目录。
        if (kind.contains("image")) return "images";
        if (kind.contains("video")) return "videos";
        return "files";
    }

    /**
     * 获取文件扩展名
     *
     * @param fileName String 文件名
     * @param mimeType String MIME类型
     * @param kind String 媒体类型
     * @return String 文件扩展名
     */
    private String fileExtension(String fileName, String mimeType, String kind) {
        // 优先使用原始文件名中的扩展名（纯字符串操作，避免 Paths.get 在 Windows 上因非法路径字符抛异常）。
        if (StringUtils.hasText(fileName)) {
            // 取最后一个 / 或 \ 之后的部分作为纯文件名，不依赖 Paths.get。
            String name = fileName;
            int lastSep = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
            if (lastSep >= 0) name = name.substring(lastSep + 1);
            int index = name.lastIndexOf('.');
            if (index >= 0 && index + 1 < name.length()) {
                String ext = name.substring(index + 1).toLowerCase();
                // 扩展名过长（>10）说明不是真实文件扩展名，走后续类型推导。
                if (ext.length() <= 10) return ext;
            }
        }
        // 文件名无扩展名时从MIME类型推导。
        if (mimeType != null && mimeType.contains("/")) {
            String extension = mimeType.substring(mimeType.indexOf('/') + 1).replace("jpeg", "jpg").replace("mpeg", "mp3");
            if (StringUtils.hasText(extension)) return extension;
        }
        // 最后按媒体类型给出默认扩展名。
        if (kind.contains("image")) return "png";
        if (kind.contains("video")) return "mp4";
        return "bin";
    }

    /**
     * 生成随机ID
     *
     * @return String 随机ID
     */
    private String newId() {
        // 生成短随机十六进制ID用于存储键和对象键。
        byte[] bytes = new byte[12];
        secureRandom.nextBytes(bytes);
        return HexFormat.of().formatHex(bytes);
    }

    /**
     * 返回第一个非空字符串
     *
     * @param values String[] 候选值
     * @return String 第一个非空字符串
     */
    private String firstNonEmpty(String... values) {
        // 依次返回第一个非空文本。
        for (String value : values) {
            if (StringUtils.hasText(value)) return value.trim();
        }
        return "";
    }

    /**
     * 格式化时间
     *
     * @param value OffsetDateTime 时间
     * @return String 时间字符串
     */
    private String formatTime(OffsetDateTime value) {
        // 对外响应统一输出ISO偏移时间。
        return value == null ? "" : value.format(DateTimeFormatter.ISO_OFFSET_DATE_TIME);
    }

    /**
     * 格式化可空时间。
     *
     * @param value OffsetDateTime 时间
     * @return String ISO偏移时间，未设置时返回null
     */
    private String formatNullableTime(OffsetDateTime value) {
        return value == null ? null : value.format(DateTimeFormatter.ISO_OFFSET_DATE_TIME);
    }

    /**
     * 快照元数据
     *
     * @param id String ID
     * @param title String 标题
     */
    private record SnapshotMetadata(String id, String title) {
    }
}

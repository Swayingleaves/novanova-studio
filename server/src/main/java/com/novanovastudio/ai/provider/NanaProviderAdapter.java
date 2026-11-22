package com.novanovastudio.ai.provider;

import com.novanovastudio.common.SystemMessage;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.TypeReference;
import com.novanovastudio.ai.AiErrorSupport;
import com.novanovastudio.ai.AiHttpClient;
import com.novanovastudio.ai.AiImageSizeSupport;
import com.novanovastudio.ai.AiJsonUtils;
import com.novanovastudio.ai.AiMediaSupport;
import com.novanovastudio.ai.AiProviderAdapter;
import com.novanovastudio.ai.AiRequestBodySupport;
import com.novanovastudio.ai.AiTaskExecutionContext;
import com.novanovastudio.ai.AiTaskParameterReader;
import com.novanovastudio.ai.AiTaskPollingSupport;
import com.novanovastudio.ai.AiTaskTypes;
import com.novanovastudio.ai.GeneratedBinary;
import com.novanovastudio.ai.VideoGenerationMode;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.dto.AiTaskDtos;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * NANA-API 官方中转站适配器。
 * <p>
 * 文本与图片走 OpenAI 兼容协议；视频按模型系列分别走 Seedance、Wan（百炼）和 MiniMax 协议，
 * 用户只需配置渠道地址与密钥，并在“我的模型”中启用模型即可使用。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-11-20 18:30
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class NanaProviderAdapter implements AiProviderAdapter {

    /** OpenAI 兼容聊天补全路径。 */
    private static final String CHAT_COMPLETIONS_PATH = "/chat/completions";
    /** OpenAI 兼容图片生成路径。 */
    private static final String IMAGE_GENERATION_PATH = "/images/generations";
    /** OpenAI 兼容图片编辑路径。 */
    private static final String IMAGE_EDIT_PATH = "/images/edits";
    /** Seedance 官转视频任务路径。 */
    private static final String SEEDANCE_TASK_PATH = "/api/v3/contents/generations/tasks";
    /** Seedance-cheap 视频任务路径（走 /v1/videos）。 */
    private static final String SEEDANCE_CHEAP_PATH = "/videos";
    /** Wan 视频创建任务路径。 */
    private static final String WAN_CREATE_PATH = "/bailian-aitoken/api/v1/services/aigc/video-generation/video-synthesis";
    /** Wan 视频查询任务路径前缀。 */
    private static final String WAN_QUERY_PATH = "/bailian-aitoken/api/v1/tasks/";
    /** MiniMax 视频创建任务路径。 */
    private static final String MINIMAX_CREATE_PATH = "/videos";
    /** MiniMax 视频查询任务路径前缀。 */
    private static final String MINIMAX_QUERY_PATH = "/autodl/v1/video_generation/";
    /** 视频任务最大轮询次数。 */
    private static final int MAXIMUM_POLLING_ATTEMPTS = 240;
    /** 最大参考图片数量。 */
    private static final int MAXIMUM_REFERENCE_IMAGE_COUNT = 9;
    /** 最大参考视频数量。 */
    private static final int MAXIMUM_REFERENCE_VIDEO_COUNT = 3;
    /** 最大参考音频数量。 */
    private static final int MAXIMUM_REFERENCE_AUDIO_COUNT = 3;
    /** 图片任务最大生成张数。 */
    private static final int MAXIMUM_IMAGE_COUNT = 10;
    /** 任务完成状态。 */
    private static final Set<String> SUCCESS_STATUSES = Set.of("succeeded", "success", "completed", "done");
    /** 继续轮询的任务状态。 */
    private static final Set<String> PROCESSING_STATUSES = Set.of(
            "not_start", "submitted", "queued", "in_queue", "waiting", "in_progress", "processing", "pending", "running");
    /** 失败任务状态。 */
    private static final Set<String> FAILURE_STATUSES = Set.of(
            "failed", "failure", "cancelled", "canceled", "expired");
    /** 支持的输出比例。 */
    private static final List<String> SUPPORTED_ASPECT_RATIOS = List.of("21:9", "16:9", "4:3", "1:1", "3:4", "9:16");

    /** AI HTTP 客户端。 */
    private final AiHttpClient aiHttpClient;
    /** AI 媒体支持。 */
    private final AiMediaSupport mediaSupport;
    /** 服务配置。 */
    private final NovanovaProperties properties;

    /**
     * 获取渠道调用格式。
     *
     * @return String NANA-API 渠道调用格式
     */
    @Override
    public String apiFormat() {
        return "nana";
    }

    /**
     * 判断当前渠道是否支持任务类型。
     *
     * @param taskType String 任务类型
     * @return boolean 是否支持文本、图片或视频任务
     */
    @Override
    public boolean supports(String taskType) {
        return List.of(AiTaskTypes.TEXT, AiTaskTypes.IMAGE, AiTaskTypes.VIDEO).contains(taskType);
    }

    /**
     * 执行 NANA-API 任务。
     *
     * @param context AiTaskExecutionContext 当前任务上下文
     * @return Mono<JSONObject> 任务结果
     */
    @Override
    public Mono<JSONObject> execute(AiTaskExecutionContext context) {
        return switch (context.task().getTaskType()) {
            case AiTaskTypes.TEXT -> executeTextTask(context);
            case AiTaskTypes.IMAGE -> executeImageTask(context);
            case AiTaskTypes.VIDEO -> executeVideoTask(context);
            default -> Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, SystemMessage.of("business.nanaSupportsTextImageAndVideoTasksOnly")));
        };
    }

    /**
     * 执行文本任务，使用 OpenAI 兼容的聊天补全协议。
     *
     * @param context AiTaskExecutionContext 当前任务上下文
     * @return Mono<JSONObject> 文本结果
     */
    private Mono<JSONObject> executeTextTask(AiTaskExecutionContext context) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("model", context.model());
        String systemPrompt = AiTaskParameterReader.stringParameter(context.request().parameters(), "systemPrompt", "");
        List<Map<String, String>> messages = new ArrayList<>();
        if (StringUtils.hasText(systemPrompt)) {
            messages.add(Map.of("role", "system", "content", systemPrompt));
        }
        messages.add(Map.of("role", "user", "content", context.request().prompt()));
        payload.put("messages", messages);
        return aiHttpClient.sendJsonRequest(openAiChannel(context), "POST", CHAT_COMPLETIONS_PATH,
                        AiRequestBodySupport.mergeCustomBodyParameters(payload, context.customBodyParameters()))
                .map(AiJsonUtils::responsePayload)
                .map(response -> AiJsonUtils.jsonObject(Map.of("content", requireChatCompletionsText(response))));
    }

    /**
     * 执行图片生成或图片编辑任务。
     *
     * @param context AiTaskExecutionContext 当前任务上下文
     * @return Mono<JSONObject> 图片结果
     */
    private Mono<JSONObject> executeImageTask(AiTaskExecutionContext context) {
        if (!AiTaskParameterReader.safeReferences(context.request().references()).isEmpty()) {
            return executeImageEditTask(context);
        }
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("model", context.model());
        payload.put("prompt", context.request().prompt());
        payload.put("n", AiTaskParameterReader.intParameter(context.request().parameters(), "count", 1, 1, MAXIMUM_IMAGE_COUNT));
        payload.put("size", resolveImageSize(context));
        AiTaskParameterReader.putNonAuto(payload, context.request().parameters(), "quality");
        return aiHttpClient.sendJsonRequest(openAiChannel(context), "POST", IMAGE_GENERATION_PATH,
                        AiRequestBodySupport.mergeCustomBodyParameters(payload, context.customBodyParameters()))
                .flatMap(response -> storeImageItems(context, AiJsonUtils.responseArrayPayload(response, "data")));
    }

    /**
     * 执行图片编辑任务，参考图以公网地址放在 images 数组中。
     *
     * @param context AiTaskExecutionContext 当前任务上下文
     * @return Mono<JSONObject> 图片结果
     */
    private Mono<JSONObject> executeImageEditTask(AiTaskExecutionContext context) {
        return Flux.fromIterable(AiTaskParameterReader.safeReferences(context.request().references()))
                .concatMap((AiTaskDtos.AiTaskMediaReference reference) -> mediaSupport.resolveReferenceUrl(context.task().getUserId(), reference))
                .collectList()
                .flatMap(imageUrls -> {
                    Map<String, Object> payload = new LinkedHashMap<>();
                    payload.put("model", context.model());
                    payload.put("prompt", context.request().prompt());
                    payload.put("n", AiTaskParameterReader.intParameter(context.request().parameters(), "count", 1, 1, MAXIMUM_IMAGE_COUNT));
                    payload.put("size", resolveImageSize(context));
                    payload.put("images", imageUrls.stream().map(url -> Map.of("image_url", url)).toList());
                    AiTaskParameterReader.putNonAuto(payload, context.request().parameters(), "quality");
                    return aiHttpClient.sendJsonRequest(openAiChannel(context), "POST", IMAGE_EDIT_PATH,
                            AiRequestBodySupport.mergeCustomBodyParameters(payload, context.customBodyParameters()));
                })
                .flatMap(response -> storeImageItems(context, AiJsonUtils.responseArrayPayload(response, "data")));
    }

    /**
     * 执行视频任务，按模型系列选择对应协议。
     *
     * @param context AiTaskExecutionContext 当前任务上下文
     * @return Mono<JSONObject> 视频结果
     */
    private Mono<JSONObject> executeVideoTask(AiTaskExecutionContext context) {
        VideoProtocol protocol = resolveVideoProtocol(context.model());
        if (protocol == null) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.nanaSupportsSeedanceWanMiniMaxVideoModels")));
        }
        return switch (protocol) {
            case SEEDANCE_OFFICIAL -> executeSeedanceVideoTask(context);
            case SEEDANCE_CHEAP -> executeSeedanceCheapVideoTask(context);
            case WAN -> executeWanVideoTask(context);
            case MINIMAX -> executeMiniMaxVideoTask(context);
        };
    }

    /**
     * 按模型名称路由 NANA-API 视频协议。
     * <p>
     * 官转 Seedance 固定以 doubao- 开头；其余 seedance-* 模型走 Seedance-cheap (/v1/videos) 通道。
     *
     * @param modelName String 原始模型名称
     * @return VideoProtocol 命中的协议，未匹配时返回 null
     */
    static VideoProtocol resolveVideoProtocol(String modelName) {
        String model = normalizeText(modelName);
        if (model.startsWith("doubao-") && model.contains("seedance")) {
            return VideoProtocol.SEEDANCE_OFFICIAL;
        }
        if (model.contains("seedance")) {
            return VideoProtocol.SEEDANCE_CHEAP;
        }
        if (isWanVideoModel(model)) {
            return VideoProtocol.WAN;
        }
        if (model.contains("minimax")) {
            return VideoProtocol.MINIMAX;
        }
        return null;
    }

    /**
     * 执行 Seedance-cheap 视频任务（POST /v1/videos、GET /v1/videos/{id}）。
     *
     * @param context AiTaskExecutionContext 当前任务上下文
     * @return Mono<JSONObject> 视频结果
     */
    private Mono<JSONObject> executeSeedanceCheapVideoTask(AiTaskExecutionContext context) {
        List<AiTaskDtos.AiTaskMediaReference> imageReferences = AiTaskParameterReader.safeReferences(context.request().references());
        List<AiTaskDtos.AiTaskMediaReference> videoReferences = AiTaskParameterReader.safeReferences(context.request().videoReferences());
        List<AiTaskDtos.AiTaskMediaReference> audioReferences = AiTaskParameterReader.safeReferences(context.request().audioReferences());
        AiTaskDtos.AiChannelConfig channel = openAiChannel(context);
        return Mono.zip(resolveReferenceUrls(context, imageReferences), resolveReferenceUrls(context, videoReferences), resolveReferenceUrls(context, audioReferences))
                .flatMap(urls -> {
                    Map<String, Object> payload = buildSeedanceCheapPayload(context.model(), context.request().prompt(),
                            context.request().parameters(), urls.getT1(), urls.getT2(), urls.getT3());
                    log.info("创建NANA-API Seedance-cheap视频任务: taskId={}, model={}, imageCount={}, videoCount={}, audioCount={}",
                            context.task().getId(), context.model(), urls.getT1().size(), urls.getT2().size(), urls.getT3().size());
                    return aiHttpClient.sendJsonRequest(channel, "POST", SEEDANCE_CHEAP_PATH,
                                    AiRequestBodySupport.mergeCustomBodyParameters(payload, context.customBodyParameters()))
                            .map(AiJsonUtils::responsePayload)
                            .flatMap(created -> {
                                String providerTaskId = AiTaskParameterReader.firstNonEmpty(created.getString("id"), created.getString("task_id"));
                                if (!StringUtils.hasText(providerTaskId)) {
                                    return Mono.error(new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, SystemMessage.of("business.nanaVideoRequestReturnedNoTaskID")));
                                }
                                return context.updateRunningProgress(10)
                                        .then(pollVideoTask(context, channel, SEEDANCE_CHEAP_PATH + "/" + providerTaskId,
                                                NanaProviderAdapter::readSeedanceCheapState, "NANA-API Seedance-cheap视频生成超时，请稍后重试"))
                                        .flatMap(finished -> storeSeedanceCheapVideoResult(context, channel, providerTaskId, finished));
                            });
                });
    }

    /**
     * 执行 Seedance 视频任务。
     *
     * @param context AiTaskExecutionContext 当前任务上下文
     * @return Mono<JSONObject> 视频结果
     */
    private Mono<JSONObject> executeSeedanceVideoTask(AiTaskExecutionContext context) {
        List<AiTaskDtos.AiTaskMediaReference> imageReferences = AiTaskParameterReader.safeReferences(context.request().references());
        List<AiTaskDtos.AiTaskMediaReference> videoReferences = AiTaskParameterReader.safeReferences(context.request().videoReferences());
        List<AiTaskDtos.AiTaskMediaReference> audioReferences = AiTaskParameterReader.safeReferences(context.request().audioReferences());
        validateReferenceCounts(imageReferences.size(), videoReferences.size(), audioReferences.size());
        AiTaskDtos.AiChannelConfig channel = originChannel(context);
        return Mono.zip(resolveReferenceUrls(context, imageReferences), resolveReferenceUrls(context, videoReferences), resolveReferenceUrls(context, audioReferences))
                .flatMap(urls -> {
                    Map<String, Object> payload = buildSeedancePayload(context.model(), context.request().prompt(), context.request().parameters(),
                            urls.getT1(), urls.getT2(), urls.getT3(), context.request().videoGenerationMode(),
                            imageReferences.stream().map(AiTaskDtos.AiTaskMediaReference::role).toList());
                    log.info("创建NANA-API Seedance视频任务: taskId={}, model={}, imageCount={}, videoCount={}, audioCount={}",
                            context.task().getId(), context.model(), urls.getT1().size(), urls.getT2().size(), urls.getT3().size());
                    return aiHttpClient.sendJsonRequest(channel, "POST", SEEDANCE_TASK_PATH,
                                    AiRequestBodySupport.mergeCustomBodyParameters(payload, context.customBodyParameters()))
                            .map(AiJsonUtils::responsePayload)
                            .flatMap(created -> {
                                String providerTaskId = AiTaskParameterReader.firstNonEmpty(created.getString("id"), created.getString("task_id"));
                                if (!StringUtils.hasText(providerTaskId)) {
                                    return Mono.error(new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, SystemMessage.of("business.nanaVideoRequestReturnedNoTaskID")));
                                }
                                return context.updateRunningProgress(10)
                                        .then(pollVideoTask(context, channel, SEEDANCE_TASK_PATH + "/" + providerTaskId,
                                                NanaProviderAdapter::readSeedanceState, "NANA-API Seedance视频生成超时，请稍后重试"))
                                        .flatMap(finished -> storeVideoResult(context, providerTaskId, finished));
                            });
                });
    }

    /**
     * 执行 Wan 视频任务。
     *
     * @param context AiTaskExecutionContext 当前任务上下文
     * @return Mono<JSONObject> 视频结果
     */
    private Mono<JSONObject> executeWanVideoTask(AiTaskExecutionContext context) {
        List<AiTaskDtos.AiTaskMediaReference> imageReferences = AiTaskParameterReader.safeReferences(context.request().references());
        List<AiTaskDtos.AiTaskMediaReference> videoReferences = AiTaskParameterReader.safeReferences(context.request().videoReferences());
        List<AiTaskDtos.AiTaskMediaReference> audioReferences = AiTaskParameterReader.safeReferences(context.request().audioReferences());
        AiTaskDtos.AiChannelConfig channel = originChannel(context);
        return Mono.zip(resolveReferenceUrls(context, imageReferences), resolveReferenceUrls(context, videoReferences), resolveReferenceUrls(context, audioReferences))
                .flatMap(urls -> {
                    Map<String, Object> payload = buildWanPayload(context.model(), context.request().prompt(), context.request().parameters(),
                            urls.getT1(), urls.getT2(), urls.getT3(), context.request().videoGenerationMode(),
                            imageReferences.stream().map(AiTaskDtos.AiTaskMediaReference::role).toList());
                    log.info("创建NANA-API Wan视频任务: taskId={}, model={}, imageCount={}, videoCount={}, audioCount={}",
                            context.task().getId(), context.model(), urls.getT1().size(), urls.getT2().size(), urls.getT3().size());
                    return aiHttpClient.sendJsonRequest(channel, "POST", WAN_CREATE_PATH,
                                    AiRequestBodySupport.mergeCustomBodyParameters(payload, context.customBodyParameters()))
                            .map(AiJsonUtils::responsePayload)
                            .flatMap(created -> {
                                JSONObject output = created.getJSONObject("output");
                                String providerTaskId = output == null ? "" : AiTaskParameterReader.firstNonEmpty(output.getString("task_id"));
                                if (!StringUtils.hasText(providerTaskId)) {
                                    return Mono.error(new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, SystemMessage.of("business.nanaVideoRequestReturnedNoTaskID")));
                                }
                                return context.updateRunningProgress(10)
                                        .then(pollVideoTask(context, channel, WAN_QUERY_PATH + providerTaskId,
                                                NanaProviderAdapter::readWanState, "NANA-API Wan视频生成超时，请稍后重试"))
                                        .flatMap(finished -> storeVideoResult(context, providerTaskId, finished));
                            });
                });
    }

    /**
     * 执行 MiniMax 视频任务。
     *
     * @param context AiTaskExecutionContext 当前任务上下文
     * @return Mono<JSONObject> 视频结果
     */
    private Mono<JSONObject> executeMiniMaxVideoTask(AiTaskExecutionContext context) {
        List<AiTaskDtos.AiTaskMediaReference> imageReferences = AiTaskParameterReader.safeReferences(context.request().references());
        List<AiTaskDtos.AiTaskMediaReference> videoReferences = AiTaskParameterReader.safeReferences(context.request().videoReferences());
        List<AiTaskDtos.AiTaskMediaReference> audioReferences = AiTaskParameterReader.safeReferences(context.request().audioReferences());
        if (!videoReferences.isEmpty()) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.nanaMiniMaxVideoDoesNotSupportVideoReferences")));
        }
        AiTaskDtos.AiChannelConfig channel = originChannel(context);
        return Mono.zip(resolveReferenceUrls(context, imageReferences), resolveReferenceUrls(context, audioReferences))
                .flatMap(urls -> {
                    Map<String, Object> payload = buildMiniMaxPayload(context.model(), context.request().prompt(), context.request().parameters(),
                            urls.getT1(), urls.getT2());
                    log.info("创建NANA-API MiniMax视频任务: taskId={}, model={}, imageCount={}, audioCount={}",
                            context.task().getId(), context.model(), urls.getT1().size(), urls.getT2().size());
                    return aiHttpClient.sendJsonRequest(openAiChannel(context), "POST", MINIMAX_CREATE_PATH,
                                    AiRequestBodySupport.mergeCustomBodyParameters(payload, context.customBodyParameters()))
                            .map(AiJsonUtils::responsePayload)
                            .flatMap(created -> {
                                String providerTaskId = AiTaskParameterReader.firstNonEmpty(created.getString("id"), created.getString("task_id"));
                                if (!StringUtils.hasText(providerTaskId)) {
                                    return Mono.error(new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, SystemMessage.of("business.nanaVideoRequestReturnedNoTaskID")));
                                }
                                return context.updateRunningProgress(10)
                                        .then(pollVideoTask(context, channel, MINIMAX_QUERY_PATH + providerTaskId,
                                                NanaProviderAdapter::readMiniMaxState, "NANA-API MiniMax视频生成超时，请稍后重试"))
                                        .flatMap(finished -> storeVideoResult(context, providerTaskId, finished));
                            });
                });
    }

    /**
     * 轮询视频任务直到完成。
     *
     * @param context AiTaskExecutionContext 当前任务上下文
     * @param channel AiTaskDtos.AiChannelConfig 查询请求使用的渠道
     * @param path String 任务查询路径
     * @param reader Function<JSONObject, VideoTaskState> 响应状态读取器
     * @param timeoutMessage String 轮询超时提示
     * @return Mono<JSONObject> 完成状态响应
     */
    private Mono<JSONObject> pollVideoTask(AiTaskExecutionContext context, AiTaskDtos.AiChannelConfig channel, String path,
                                           Function<JSONObject, VideoTaskState> reader, String timeoutMessage) {
        Duration pollingInterval = AiTaskPollingSupport.pollingInterval(properties);
        return Flux.range(0, MAXIMUM_POLLING_ATTEMPTS)
                .concatMap(attempt -> Mono.delay(pollingInterval)
                        .then(context.isCancelRequested())
                        .flatMap(cancelled -> {
                            if (Boolean.TRUE.equals(cancelled)) {
                                return Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, SystemMessage.of("business.taskCanceled")));
                            }
                            return aiHttpClient.sendJsonRequest(channel, "GET", path, null)
                                    .map(AiJsonUtils::responsePayload)
                                    .flatMap(response -> processVideoTaskResponse(context, response, reader.apply(response), attempt));
                        }))
                .next()
                .switchIfEmpty(Mono.<JSONObject>error(AiErrorSupport.providerPollingTimeout(timeoutMessage)));
    }

    /**
     * 处理一次视频任务查询响应。
     *
     * @param context AiTaskExecutionContext 当前任务上下文
     * @param response JSONObject 渠道响应载荷
     * @param state VideoTaskState 解析后的任务状态
     * @param attempt int 当前轮询序号
     * @return Mono<JSONObject> 完成时返回响应，处理中返回空信号
     */
    private Mono<JSONObject> processVideoTaskResponse(AiTaskExecutionContext context, JSONObject response, VideoTaskState state, int attempt) {
        int progress = Math.max(10, Math.min(95, state.progress() > 0 ? state.progress() : 10 + attempt));
        return context.updateRunningProgress(progress).then(Mono.defer(() -> {
            if (SUCCESS_STATUSES.contains(state.status())) return Mono.just(response);
            if (PROCESSING_STATUSES.contains(state.status())) return Mono.empty();
            if (FAILURE_STATUSES.contains(state.status())) {
                return Mono.error(AiErrorSupport.providerTaskFailure(response, AiTaskParameterReader.firstNonEmpty(state.failureMessage(), "NANA-API 视频生成失败")));
            }
            return Mono.error(new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR,
                    SystemMessage.of("business.unknownNanaAPITaskStatus", state.status())));
        }));
    }

    /**
     * 保存视频结果到项目媒体存储。
     *
     * @param context AiTaskExecutionContext 当前任务上下文
     * @param providerTaskId String 渠道任务ID
     * @param finished JSONObject 完成状态响应
     * @return Mono<JSONObject> 视频结果
     */
    private Mono<JSONObject> storeVideoResult(AiTaskExecutionContext context, String providerTaskId, JSONObject finished) {
        VideoTaskState state = resolveVideoState(finished);
        if (!mediaSupport.isHttpUrl(state.videoUrl())) {
            return Mono.error(new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, SystemMessage.of("business.nanaTaskSucceededWithoutVideoURL")));
        }
        Integer durationMilliseconds = state.durationSeconds() == null ? null : state.durationSeconds() * 1000;
        log.info("NANA-API视频任务完成: taskId={}, providerTaskId={}, duration={}",
                context.task().getId(), providerTaskId, state.durationSeconds());
        return mediaSupport.storeGeneratedMediaUrl(context.task().getUserId(), AiTaskTypes.VIDEO, state.videoUrl(),
                        "video/mp4", null, null, durationMilliseconds)
                .map(media -> AiJsonUtils.jsonObject(Map.of("item", media, "providerTaskId", providerTaskId)));
    }

    /**
     * 保存 Seedance-cheap 视频结果；优先使用完成响应里的签名直链，缺失时回退 /v1/videos/{id}/content 拉流。
     *
     * @param context AiTaskExecutionContext 当前任务上下文
     * @param channel AiTaskDtos.AiChannelConfig 带 /v1 前缀的渠道配置
     * @param providerTaskId String 渠道任务ID
     * @param finished JSONObject 完成状态响应
     * @return Mono<JSONObject> 视频结果
     */
    private Mono<JSONObject> storeSeedanceCheapVideoResult(AiTaskExecutionContext context, AiTaskDtos.AiChannelConfig channel,
                                                           String providerTaskId, JSONObject finished) {
        VideoTaskState state = readSeedanceCheapState(finished);
        Integer durationMilliseconds = state.durationSeconds() == null ? null : state.durationSeconds() * 1000;
        if (mediaSupport.isHttpUrl(state.videoUrl())) {
            log.info("NANA-API Seedance-cheap视频任务完成: taskId={}, providerTaskId={}, duration={}",
                    context.task().getId(), providerTaskId, state.durationSeconds());
            return mediaSupport.storeGeneratedMediaUrl(context.task().getUserId(), AiTaskTypes.VIDEO, state.videoUrl(),
                            "video/mp4", null, null, durationMilliseconds)
                    .map(media -> AiJsonUtils.jsonObject(Map.of("item", media, "providerTaskId", providerTaskId)));
        }
        log.info("NANA-API Seedance-cheap视频任务完成，回退内容接口下载: taskId={}, providerTaskId={}",
                context.task().getId(), providerTaskId);
        return aiHttpClient.downloadBinary(channel, SEEDANCE_CHEAP_PATH + "/" + providerTaskId + "/content")
                .flatMap(binary -> {
                    String mimeType = AiTaskParameterReader.firstNonEmpty(binary.mimeType(), "video/mp4");
                    GeneratedBinary video = new GeneratedBinary(binary.data(), mimeType);
                    return mediaSupport.storeGeneratedMedia(context.task().getUserId(), AiTaskTypes.VIDEO,
                                    "generated-video.mp4", video, null, null, durationMilliseconds)
                            .map(media -> AiJsonUtils.jsonObject(Map.of("item", media, "providerTaskId", providerTaskId)));
                });
    }

    /**
     * 按响应结构读取视频任务状态，兼容三类视频协议。
     *
     * @param response JSONObject 完成状态响应
     * @return VideoTaskState 视频任务状态
     */
    private static VideoTaskState resolveVideoState(JSONObject response) {
        VideoTaskState seedance = readSeedanceState(response);
        if (StringUtils.hasText(seedance.videoUrl())) return seedance;
        VideoTaskState wan = readWanState(response);
        if (StringUtils.hasText(wan.videoUrl())) return wan;
        return readMiniMaxState(response);
    }

    /**
     * 读取 Seedance-cheap 任务状态。
     * <p>
     * 文档约定 status=unknown 表示上游暂未同步，必须继续轮询不能重提，此处统一映射为 queued。
     *
     * @param response JSONObject Seedance-cheap 响应
     * @return VideoTaskState 任务状态
     */
    static VideoTaskState readSeedanceCheapState(JSONObject response) {
        String rawStatus = normalizeText(response.getString("status"));
        String status = "unknown".equals(rawStatus) ? "queued" : rawStatus;
        JSONObject content = response.getJSONObject("content");
        JSONObject error = response.getJSONObject("error");
        String videoUrl = AiTaskParameterReader.firstNonEmpty(
                response.getString("url"),
                content == null ? "" : content.getString("video_url"));
        String failureMessage = AiTaskParameterReader.firstNonEmpty(
                error == null ? "" : error.getString("message"),
                response.getString("message"),
                response.getString("msg"));
        Integer seconds = response.getInteger("seconds") != null ? response.getInteger("seconds") : response.getInteger("duration");
        return new VideoTaskState(status, readProgress(response, 0), videoUrl, failureMessage, seconds);
    }

    /**
     * 读取 Seedance 任务状态。
     *
     * @param response JSONObject Seedance 响应
     * @return VideoTaskState 任务状态
     */
    static VideoTaskState readSeedanceState(JSONObject response) {
        JSONObject content = response.getJSONObject("content");
        JSONObject error = response.getJSONObject("error");
        return new VideoTaskState(
                normalizeText(response.getString("status")),
                readProgress(response, 0),
                content == null ? "" : AiTaskParameterReader.firstNonEmpty(content.getString("video_url")),
                error == null ? "" : AiTaskParameterReader.firstNonEmpty(error.getString("message")),
                response.getInteger("duration"));
    }

    /**
     * 读取 Wan 任务状态。
     *
     * @param response JSONObject Wan 响应
     * @return VideoTaskState 任务状态
     */
    static VideoTaskState readWanState(JSONObject response) {
        JSONObject output = response.getJSONObject("output");
        if (output == null) return new VideoTaskState("", readProgress(response, 0), "", "", null);
        JSONArray results = output.getJSONArray("results");
        String videoUrl = "";
        if (results != null && !results.isEmpty()) {
            JSONObject result = results.getJSONObject(0);
            videoUrl = result == null ? "" : AiTaskParameterReader.firstNonEmpty(result.getString("url"));
        }
        return new VideoTaskState(normalizeText(output.getString("task_status")), readProgress(response, 0), videoUrl,
                AiTaskParameterReader.firstNonEmpty(output.getString("message")), null);
    }

    /**
     * 读取 MiniMax 任务状态。
     *
     * @param response JSONObject MiniMax 响应
     * @return VideoTaskState 任务状态
     */
    static VideoTaskState readMiniMaxState(JSONObject response) {
        JSONObject payload = AiJsonUtils.responsePayload(response);
        JSONObject data = payload.getJSONObject("data");
        if (data == null) data = payload;
        JSONArray results = data.getJSONArray("results");
        String videoUrl = "";
        if (results != null && !results.isEmpty()) {
            JSONObject result = results.getJSONObject(0);
            videoUrl = result == null ? "" : AiTaskParameterReader.firstNonEmpty(result.getString("url"));
        }
        String message = AiTaskParameterReader.firstNonEmpty(response.getString("msg"), data.getString("message"));
        return new VideoTaskState(normalizeText(data.getString("status")), readProgress(response, 0), videoUrl, message, null);
    }

    /**
     * 构建 Seedance-cheap 视频请求体（POST /v1/videos）。
     * <p>
     * 使用 seconds、aspect_ratio 以及顶层 images/videos/audios 数组；清晰度由模型固定，默认省略。
     *
     * @param model String 模型名称
     * @param prompt String 视频提示词
     * @param parameters Map<String, Object> 页面视频参数
     * @param imageUrls List<String> 参考图片地址
     * @param videoUrls List<String> 参考视频地址
     * @param audioUrls List<String> 参考音频地址
     * @return Map<String, Object> Seedance-cheap 请求体
     */
    static Map<String, Object> buildSeedanceCheapPayload(String model, String prompt, Map<String, Object> parameters,
                                                         List<String> imageUrls, List<String> videoUrls, List<String> audioUrls) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("model", model);
        String resolvedPrompt = referenceAwarePrompt(prompt, imageUrls.size(), videoUrls.size(), audioUrls.size());
        if (StringUtils.hasText(resolvedPrompt)) {
            payload.put("prompt", resolvedPrompt);
        }
        payload.put("seconds", normalizeDuration(parameters, 1, 60, 5));
        String ratio = normalizeAspectRatio(AiTaskParameterReader.parameterText(parameters, "size", "16:9"));
        payload.put("aspect_ratio", "adaptive".equals(ratio) ? "16:9" : ratio);
        if (!imageUrls.isEmpty()) payload.put("images", imageUrls);
        if (!videoUrls.isEmpty()) payload.put("videos", videoUrls);
        if (!audioUrls.isEmpty()) payload.put("audios", audioUrls);
        return payload;
    }

    /**
     * 构建 Seedance 视频请求体。
     *
     * @param model String 模型名称
     * @param prompt String 视频提示词
     * @param parameters Map<String, Object> 页面视频参数
     * @param imageUrls List<String> 参考图片地址
     * @param videoUrls List<String> 参考视频地址
     * @param audioUrls List<String> 参考音频地址
     * @param videoGenerationMode String 视频生成模式
     * @param imageRoles List<String> 图片角色
     * @return Map<String, Object> Seedance 请求体
     */
    static Map<String, Object> buildSeedancePayload(String model, String prompt, Map<String, Object> parameters,
                                                     List<String> imageUrls, List<String> videoUrls, List<String> audioUrls,
                                                     String videoGenerationMode, List<String> imageRoles) {
        String mode = VideoGenerationMode.defaultIfBlank(videoGenerationMode);
        List<Map<String, Object>> content = new ArrayList<>();
        content.add(Map.of("type", "text", "text", referenceAwarePrompt(prompt, imageUrls.size(), videoUrls.size(), audioUrls.size())));
        for (int index = 0; index < imageUrls.size(); index++) {
            content.add(Map.of("type", "image_url", "image_url", Map.of("url", imageUrls.get(index)),
                    "role", imageRole(imageRoles, index, mode)));
        }
        for (String videoUrl : videoUrls) {
            content.add(Map.of("type", "video_url", "video_url", Map.of("url", videoUrl), "role", "reference_video"));
        }
        for (String audioUrl : audioUrls) {
            content.add(Map.of("type", "audio_url", "audio_url", Map.of("url", audioUrl), "role", "reference_audio"));
        }
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("model", model);
        payload.put("content", content);
        payload.put("ratio", normalizeAspectRatio(AiTaskParameterReader.parameterText(parameters, "size", "adaptive")));
        payload.put("resolution", normalizeSeedanceResolution(AiTaskParameterReader.parameterText(parameters, "resolution", "720p")));
        payload.put("duration", normalizeDuration(parameters, 1, 15, 5));
        Boolean watermark = booleanParameter(parameters, "watermark");
        if (watermark != null) payload.put("watermark", watermark);
        return payload;
    }

    /**
     * 构建 Wan 视频请求体。
     *
     * @param model String 模型名称
     * @param prompt String 视频提示词
     * @param parameters Map<String, Object> 页面视频参数
     * @param imageUrls List<String> 参考图片地址
     * @param videoUrls List<String> 参考视频地址
     * @param audioUrls List<String> 参考音频地址
     * @param videoGenerationMode String 视频生成模式
     * @param imageRoles List<String> 图片角色
     * @return Map<String, Object> Wan 请求体
     */
    static Map<String, Object> buildWanPayload(String model, String prompt, Map<String, Object> parameters,
                                                List<String> imageUrls, List<String> videoUrls, List<String> audioUrls,
                                                String videoGenerationMode, List<String> imageRoles) {
        String mode = VideoGenerationMode.defaultIfBlank(videoGenerationMode);
        List<Map<String, Object>> media = new ArrayList<>();
        for (int index = 0; index < imageUrls.size(); index++) {
            media.add(Map.of("type", imageRole(imageRoles, index, mode), "url", imageUrls.get(index)));
        }
        for (String videoUrl : videoUrls) media.add(Map.of("type", "reference_video", "url", videoUrl));
        for (String audioUrl : audioUrls) media.add(Map.of("type", "reference_audio", "url", audioUrl));

        Map<String, Object> input = new LinkedHashMap<>();
        input.put("prompt", referenceAwarePrompt(prompt, imageUrls.size(), videoUrls.size(), audioUrls.size()));
        if (!media.isEmpty()) input.put("media", media);

        Map<String, Object> videoParameters = new LinkedHashMap<>();
        videoParameters.put("resolution", normalizeWanResolution(AiTaskParameterReader.parameterText(parameters, "resolution", "720p")));
        videoParameters.put("ratio", normalizeAspectRatio(AiTaskParameterReader.parameterText(parameters, "size", "adaptive")));
        videoParameters.put("duration", normalizeDuration(parameters, 2, 30, 5, true));
        Boolean watermark = booleanParameter(parameters, "watermark");
        if (watermark != null) videoParameters.put("watermark", watermark);

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("model", model);
        payload.put("input", input);
        payload.put("parameters", videoParameters);
        return payload;
    }

    /**
     * 构建 MiniMax 视频请求体。
     *
     * @param model String 模型名称
     * @param prompt String 视频提示词
     * @param parameters Map<String, Object> 页面视频参数
     * @param imageUrls List<String> 参考图片地址
     * @param audioUrls List<String> 参考音频地址
     * @return Map<String, Object> MiniMax 请求体
     */
    static Map<String, Object> buildMiniMaxPayload(String model, String prompt, Map<String, Object> parameters,
                                                    List<String> imageUrls, List<String> audioUrls) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("model", model);
        payload.put("prompt", prompt);
        payload.put("duration", normalizeDuration(parameters, 1, 15, 5));
        payload.put("resolution", normalizeMiniMaxResolution(AiTaskParameterReader.parameterText(parameters, "resolution", "768p"), model));
        payload.put("ratio", normalizeAspectRatio(AiTaskParameterReader.parameterText(parameters, "size", "16:9")));
        // 参考生视频使用 OpenAI 视频风格的 images 数组传递参考图，参考音频沿用同一命名约定。
        if (!imageUrls.isEmpty()) payload.put("images", imageUrls);
        if (!audioUrls.isEmpty()) payload.put("audios", audioUrls);
        return payload;
    }

    /**
     * 解析图片生成尺寸，NANA-API 只接受像素尺寸。
     *
     * @param context AiTaskExecutionContext 当前任务上下文
     * @return String 像素尺寸
     */
    private static String resolveImageSize(AiTaskExecutionContext context) {
        String size = AiImageSizeSupport.resolveSize(context.request().parameters(), true, context.imageSizeMappings());
        return StringUtils.hasText(size) ? size : "1024x1024";
    }

    /**
     * 保存图片结果列表。
     *
     * @param context AiTaskExecutionContext 当前任务上下文
     * @param data JSONArray 图片响应项
     * @return Mono<JSONObject> 图片结果
     */
    private Mono<JSONObject> storeImageItems(AiTaskExecutionContext context, JSONArray data) {
        if (data == null || data.isEmpty()) return Mono.just(AiJsonUtils.jsonObject(Map.of("items", List.of())));
        return Flux.fromIterable(data)
                .concatMap(item -> mediaSupport.storeGeneratedImageItem(context.task().getUserId(), JSON.parseObject(JSON.toJSONString(item)), null, null, 0)
                        .map(media -> JSON.parseObject(JSON.toJSONString(media), new TypeReference<Map<String, Object>>() {})))
                .collectList()
                .map(items -> AiJsonUtils.jsonObject(Map.of("items", items)));
    }

    /**
     * 解析参考媒体地址列表。
     *
     * @param context AiTaskExecutionContext 当前任务上下文
     * @param references List<AiTaskMediaReference> 参考媒体
     * @return Mono<List<String>> 可供渠道访问的地址列表
     */
    private Mono<List<String>> resolveReferenceUrls(AiTaskExecutionContext context, List<AiTaskDtos.AiTaskMediaReference> references) {
        return Flux.fromIterable(references)
                .concatMap((AiTaskDtos.AiTaskMediaReference reference) -> mediaSupport.resolveReferenceUrl(context.task().getUserId(), reference))
                .collectList();
    }

    /**
     * 读取Chat Completions文本内容，空内容按生成失败处理。
     *
     * @param response JSONObject 接口响应载荷
     * @return String 文本内容
     */
    static String readChatCompletionsText(JSONObject response) {
        JSONArray choices = response == null ? null : response.getJSONArray("choices");
        if (choices == null || choices.isEmpty()) return "";
        JSONObject message = choices.getJSONObject(0).getJSONObject("message");
        return message == null ? "" : AiTaskParameterReader.firstNonEmpty(message.getString("content"));
    }

    /**
     * 读取文本结果，空内容显性报错。
     *
     * @param response JSONObject 接口响应载荷
     * @return String 文本内容
     */
    private static String requireChatCompletionsText(JSONObject response) {
        String text = readChatCompletionsText(response);
        if (!StringUtils.hasText(text)) throw AiErrorSupport.malformedResponse("execution");
        return text;
    }

    /**
     * 构建带 /v1 前缀的 OpenAI 兼容渠道，兼容用户只填站点域名的情况。
     *
     * @param context AiTaskExecutionContext 当前任务上下文
     * @return AiChannelConfig 渠道配置
     */
    private static AiTaskDtos.AiChannelConfig openAiChannel(AiTaskExecutionContext context) {
        return channelWithBaseUrl(context.channel(), AiHttpClient.buildNanaBaseUrl(context.channel().baseUrl()));
    }

    /**
     * 构建站点根路径渠道，用于不使用 /v1 前缀的视频任务路径。
     *
     * @param context AiTaskExecutionContext 当前任务上下文
     * @return AiChannelConfig 渠道配置
     */
    private static AiTaskDtos.AiChannelConfig originChannel(AiTaskExecutionContext context) {
        return channelWithBaseUrl(context.channel(), AiHttpClient.buildNanaOriginUrl(context.channel().baseUrl()));
    }

    /**
     * 复制渠道配置并替换基础地址。
     *
     * @param channel AiChannelConfig 原渠道配置
     * @param baseUrl String 新的基础地址
     * @return AiChannelConfig 渠道配置
     */
    private static AiTaskDtos.AiChannelConfig channelWithBaseUrl(AiTaskDtos.AiChannelConfig channel, String baseUrl) {
        return new AiTaskDtos.AiChannelConfig(channel.id(), channel.name(), baseUrl, channel.apiKey(), channel.apiFormat(), channel.models());
    }

    /**
     * 校验参考素材数量。
     *
     * @param imageCount int 参考图片数量
     * @param videoCount int 参考视频数量
     * @param audioCount int 参考音频数量
     * @return void 无返回值
     */
    private static void validateReferenceCounts(int imageCount, int videoCount, int audioCount) {
        if (imageCount > MAXIMUM_REFERENCE_IMAGE_COUNT) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.atMostSeedanceReferenceImages", MAXIMUM_REFERENCE_IMAGE_COUNT));
        }
        if (videoCount > MAXIMUM_REFERENCE_VIDEO_COUNT) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.atMostSeedanceReferenceVideos", MAXIMUM_REFERENCE_VIDEO_COUNT));
        }
        if (audioCount > MAXIMUM_REFERENCE_AUDIO_COUNT) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.atMostSeedanceReferenceAudios", MAXIMUM_REFERENCE_AUDIO_COUNT));
        }
    }

    /**
     * 判断模型是否属于 Wan 系列。
     *
     * @param model String 小写模型名称
     * @return boolean 是否 Wan 模型
     */
    static boolean isWanVideoModel(String model) {
        return model != null && model.matches("(?:.*[^a-z0-9])?wan(?:x|\\d).*");
    }

    /**
     * 读取图片角色。
     *
     * @param imageRoles List<String> 显式图片角色
     * @param index int 图片序号
     * @param mode String 视频生成模式
     * @return String 图片角色
     */
    private static String imageRole(List<String> imageRoles, int index, String mode) {
        if (imageRoles != null && index < imageRoles.size() && StringUtils.hasText(imageRoles.get(index))) {
            return imageRoles.get(index);
        }
        if (VideoGenerationMode.FIRST_LAST_FRAME_TO_VIDEO.equals(mode)) {
            if (index == 0) return "first_frame";
            if (index == 1) return "last_frame";
        }
        if (VideoGenerationMode.IMAGE_TO_VIDEO.equals(mode) && index == 0) return "first_frame";
        return "reference_image";
    }

    /**
     * 为参考素材补充稳定编号。
     *
     * @param prompt String 原始提示词
     * @param imageCount int 参考图片数量
     * @param videoCount int 参考视频数量
     * @param audioCount int 参考音频数量
     * @return String 带参考素材编号说明的提示词
     */
    private static String referenceAwarePrompt(String prompt, int imageCount, int videoCount, int audioCount) {
        String text = prompt == null ? "" : prompt;
        if (imageCount == 0 && videoCount == 0 && audioCount == 0) return text;
        if (text.trim().startsWith("参考素材编号：")) return text;
        List<String> labels = new ArrayList<>();
        for (int index = 0; index < imageCount; index++) labels.add("图片" + (index + 1));
        for (int index = 0; index < videoCount; index++) labels.add("视频" + (index + 1));
        for (int index = 0; index < audioCount; index++) labels.add("音频" + (index + 1));
        return "参考素材编号：" + String.join("、", labels) + "。请按这些编号理解提示词中的图片、视频和音频引用。\n\n" + text.trim();
    }

    /**
     * 规范化视频比例。
     *
     * @param value String 页面尺寸或比例
     * @return String 支持的比例或 adaptive
     */
    static String normalizeAspectRatio(String value) {
        String normalized = normalizeText(value);
        if (normalized.isEmpty() || "auto".equals(normalized)) return "adaptive";
        if (SUPPORTED_ASPECT_RATIOS.contains(normalized)) return normalized;
        if (!normalized.matches("^\\d+x\\d+$")) return "adaptive";
        String[] dimensions = normalized.split("x");
        try {
            double ratio = Double.parseDouble(dimensions[0]) / Double.parseDouble(dimensions[1]);
            return SUPPORTED_ASPECT_RATIOS.stream()
                    .min(java.util.Comparator.comparingDouble(candidate -> Math.abs(ratio - ratioValue(candidate))))
                    .orElse("16:9");
        } catch (NumberFormatException exception) {
            return "adaptive";
        }
    }

    /**
     * 规范化 Seedance 分辨率。
     *
     * @param value String 页面清晰度
     * @return String Seedance 分辨率
     */
    static String normalizeSeedanceResolution(String value) {
        return switch (normalizeText(value)) {
            case "low", "480p" -> "480p";
            case "", "auto", "medium", "high", "720p", "768p" -> "720p";
            case "1080p", "1088p", "1440p", "2k" -> "1080p";
            case "4k" -> "4k";
            default -> "720p";
        };
    }

    /**
     * 规范化 Wan 分辨率。
     *
     * @param value String 页面清晰度
     * @return String Wan 分辨率
     */
    static String normalizeWanResolution(String value) {
        return switch (normalizeText(value)) {
            case "low", "480p" -> "480P";
            case "", "auto", "medium", "high", "720p", "768p" -> "720P";
            default -> "1080P";
        };
    }

    /**
     * 规范化 MiniMax 分辨率。
     *
     * @param value String 页面清晰度
     * @param model String 模型名称
     * @return String MiniMax 分辨率
     */
    static String normalizeMiniMaxResolution(String value, String model) {
        boolean referenceModel = normalizeText(model).contains("ref");
        String normalized = normalizeText(value);
        if ("low".equals(normalized) || "480p".equals(normalized)) return "480P";
        if ("".equals(normalized) || "auto".equals(normalized) || "medium".equals(normalized)
                || "high".equals(normalized) || "720p".equals(normalized) || "768p".equals(normalized)) {
            return "768P";
        }
        if (referenceModel) return "960P";
        return "1080p".equals(normalized) || "1088p".equals(normalized) ? "1088P" : "1440P";
    }

    /**
     * 读取视频时长并限制在协议范围内。
     *
     * @param parameters Map<String, Object> 页面参数
     * @param minimum int 最小时长
     * @param maximum int 最大时长
     * @param fallback int 缺省时长
     * @return int 视频时长
     */
    private static int normalizeDuration(Map<String, Object> parameters, int minimum, int maximum, int fallback) {
        return normalizeDuration(parameters, minimum, maximum, fallback, false);
    }

    /**
     * 读取视频时长并限制在协议范围内，可保留 -1 智能时长。
     *
     * @param parameters Map<String, Object> 页面参数
     * @param minimum int 最小时长
     * @param maximum int 最大时长
     * @param fallback int 缺省时长
     * @param allowSmart boolean 是否允许 -1
     * @return int 视频时长
     */
    private static int normalizeDuration(Map<String, Object> parameters, int minimum, int maximum, int fallback, boolean allowSmart) {
        String value = AiTaskParameterReader.parameterText(parameters, "seconds", String.valueOf(fallback)).trim();
        try {
            int seconds = Integer.parseInt(value);
            if (allowSmart && seconds == -1) return -1;
            if (seconds <= 0) return fallback;
            return Math.max(minimum, Math.min(maximum, seconds));
        } catch (NumberFormatException exception) {
            return fallback;
        }
    }

    /**
     * 读取布尔参数。
     *
     * @param parameters Map<String, Object> 参数集合
     * @param key String 参数名
     * @return Boolean 参数值，未指定时返回null
     */
    private static Boolean booleanParameter(Map<String, Object> parameters, String key) {
        Object value = parameters == null ? null : parameters.get(key);
        if (value instanceof Boolean booleanValue) return booleanValue;
        if (value instanceof String text && ("true".equalsIgnoreCase(text) || "false".equalsIgnoreCase(text))) return Boolean.parseBoolean(text);
        return null;
    }

    /**
     * 读取任务进度，兼容数字和带百分号的字符串。
     *
     * @param response JSONObject 查询响应
     * @param fallback int 无法读取时的回退进度
     * @return int 任务进度
     */
    static int readProgress(JSONObject response, int fallback) {
        Object value = response == null ? null : response.get("progress");
        if (value instanceof Number number) return number.intValue();
        if (value instanceof String text) {
            String normalized = text.trim();
            if (normalized.endsWith("%")) normalized = normalized.substring(0, normalized.length() - 1).trim();
            try {
                return Integer.parseInt(normalized);
            } catch (NumberFormatException exception) {
                return fallback;
            }
        }
        return fallback;
    }

    /**
     * 计算比例数值。
     *
     * @param value String 宽高比
     * @return double 宽高比例
     */
    private static double ratioValue(String value) {
        String[] ratio = value.split(":");
        return Double.parseDouble(ratio[0]) / Double.parseDouble(ratio[1]);
    }

    /**
     * 规范化文本。
     *
     * @param value String 原始文本
     * @return String 小写且去除首尾空白的文本
     */
    static String normalizeText(String value) {
        return value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
    }

    /**
     * NANA-API 视频协议路由类型。
     */
    enum VideoProtocol {
        /** Seedance 官转通道（/api/v3/contents/generations/tasks）。 */
        SEEDANCE_OFFICIAL,
        /** Seedance-cheap 通道（/v1/videos）。 */
        SEEDANCE_CHEAP,
        /** Wan 百炼通道。 */
        WAN,
        /** MiniMax 通道。 */
        MINIMAX
    }

    /**
     * 视频任务状态。
     *
     * @param status String 小写任务状态
     * @param progress int 任务进度
     * @param videoUrl String 视频地址
     * @param failureMessage String 失败原因
     * @param durationSeconds Integer 视频时长秒数
     */
    record VideoTaskState(String status, int progress, String videoUrl, String failureMessage, Integer durationSeconds) {
    }
}

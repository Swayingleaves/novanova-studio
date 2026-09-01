package com.novanovastudio.ai.provider;

import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.ai.AiErrorSupport;
import com.novanovastudio.ai.AiHttpClient;
import com.novanovastudio.ai.AiJsonUtils;
import com.novanovastudio.ai.AiMediaSupport;
import com.novanovastudio.ai.AiProviderAdapter;
import com.novanovastudio.ai.AiTaskExecutionContext;
import com.novanovastudio.ai.AiTaskParameterReader;
import com.novanovastudio.ai.AiTaskPollingSupport;
import com.novanovastudio.ai.AiTaskTypes;
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
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * MiniMax H3 视频生成渠道适配器。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-08-03 22:00
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class MiniMaxProviderAdapter implements AiProviderAdapter {

    /** MiniMax H3 模型名称。 */
    private static final String MINIMAX_H3_MODEL = "MiniMax-H3";

    /** 创建视频任务接口路径。 */
    private static final String VIDEO_GENERATION_PATH = "/v2/video_generation";

    /** 查询视频任务接口路径。 */
    private static final String VIDEO_QUERY_PATH = "/v2/query/video_generation/";

    /** 最大参考图片数量。 */
    private static final int MAXIMUM_REFERENCE_IMAGE_COUNT = 9;

    /** 最大参考视频数量。 */
    private static final int MAXIMUM_REFERENCE_VIDEO_COUNT = 3;

    /** 视频任务最大轮询次数。 */
    private static final int MAXIMUM_POLLING_ATTEMPTS = 120;

    /** 处理中任务状态。 */
    private static final Set<String> PROCESSING_STATUSES = Set.of("queued", "running");

    /** 失败任务状态。 */
    private static final Set<String> FAILURE_STATUSES = Set.of("failed", "cancelled");

    /** H3 支持的视频比例。 */
    private static final Set<String> SUPPORTED_RATIOS = Set.of(
            "adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16");

    /** 现有通用视频比例预设到 H3 比例的精确映射。 */
    private static final Map<String, String> PRESET_SIZE_RATIOS = Map.of(
            "1280x720", "16:9",
            "960x720", "4:3",
            "720x720", "1:1",
            "720x960", "3:4",
            "720x1280", "9:16",
            "1680x720", "21:9");

    /** AI HTTP 客户端。 */
    private final AiHttpClient aiHttpClient;

    /** AI 媒体支持。 */
    private final AiMediaSupport mediaSupport;

    /** 服务配置。 */
    private final NovanovaProperties properties;

    /**
     * 获取渠道调用格式。
     *
     * @return String MiniMax 渠道调用格式
     */
    @Override
    public String apiFormat() {
        return "minimax";
    }

    /**
     * 判断当前适配器是否支持任务类型。
     *
     * @param taskType String 任务类型
     * @return boolean 是否为视频任务
     */
    @Override
    public boolean supports(String taskType) {
        return AiTaskTypes.VIDEO.equals(taskType);
    }

    /**
     * 执行 MiniMax H3 视频生成任务。
     *
     * @param context AiTaskExecutionContext AI 任务执行上下文
     * @return Mono<JSONObject> 视频生成结果
     * @throws BusinessException 任务类型或模型不受支持时抛出
     */
    @Override
    public Mono<JSONObject> execute(AiTaskExecutionContext context) {
        if (!supports(context.task().getTaskType())) {
            return Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "MiniMax 调用格式仅支持视频任务"));
        }
        validateModel(context.model());
        List<AiTaskDtos.AiTaskMediaReference> imageReferences =
                AiTaskParameterReader.safeReferences(context.request().references());
        List<AiTaskDtos.AiTaskMediaReference> videoReferences =
                AiTaskParameterReader.safeReferences(context.request().videoReferences());
        validateReferenceCounts(imageReferences.size(), videoReferences.size());
        return Mono.zip(resolveReferenceUrls(context, imageReferences), resolveReferenceUrls(context, videoReferences))
                .flatMap(urls -> createMiniMaxVideoTask(context, urls.getT1(), urls.getT2(), imageReferences));
    }

    /**
     * 解析参考媒体 URL 列表。
     *
     * @param context AiTaskExecutionContext AI 任务执行上下文
     * @param references List<AiTaskMediaReference> 参考媒体列表
     * @return Mono<List<String>> 可供 MiniMax 访问的媒体 URL 列表
     */
    private Mono<List<String>> resolveReferenceUrls(
            AiTaskExecutionContext context, List<AiTaskDtos.AiTaskMediaReference> references) {
        return Flux.fromIterable(references)
                .concatMap(reference -> mediaSupport.resolveReferenceUrl(context.task().getUserId(), reference))
                .collectList();
    }

    /**
     * 创建 MiniMax H3 视频任务并等待任务完成。
     *
     * @param context AiTaskExecutionContext AI 任务执行上下文
     * @param imageUrls List<String> 参考图片 URL 列表
     * @param videoUrls List<String> 参考视频 URL 列表
     * @return Mono<JSONObject> 视频生成结果
     */
    private Mono<JSONObject> createMiniMaxVideoTask(
            AiTaskExecutionContext context, List<String> imageUrls, List<String> videoUrls,
            List<AiTaskDtos.AiTaskMediaReference> imageReferences) {
        Map<String, Object> payload = buildRequestPayload(
                context.model(), context.request().prompt(), context.request().parameters(), imageUrls, videoUrls,
                context.request().videoGenerationMode(), imageReferences.stream()
                        .map(AiTaskDtos.AiTaskMediaReference::role).toList());
        log.info("创建MiniMax H3视频任务: taskId={}, model={}, imageCount={}, videoCount={}",
                context.task().getId(), context.model(), imageUrls.size(), videoUrls.size());
        return aiHttpClient.sendJsonRequest(context.channel(), "POST", VIDEO_GENERATION_PATH, com.novanovastudio.ai.AiRequestBodySupport.mergeCustomBodyParameters(payload, context.customBodyParameters()))
                .map(AiJsonUtils::responsePayload)
                .flatMap(created -> {
                    String providerTaskId = AiTaskParameterReader.firstNonEmpty(created.getString("task_id"));
                    if (!StringUtils.hasText(providerTaskId)) {
                        return Mono.error(new BusinessException(
                                ErrorCode.THIRD_PARTY_CALL_ERROR, "MiniMax H3 接口没有返回任务ID"));
                    }
                    return context.updateRunningProgress(20)
                            .then(pollMiniMaxVideoTask(context, providerTaskId))
                            .flatMap(finished -> storeMiniMaxVideo(context, providerTaskId, finished));
                });
    }

    /**
     * 轮询 MiniMax H3 视频任务。
     *
     * @param context AiTaskExecutionContext AI 任务执行上下文
     * @param providerTaskId String MiniMax 任务 ID
     * @return Mono<JSONObject> MiniMax 成功状态任务对象
     */
    private Mono<JSONObject> pollMiniMaxVideoTask(AiTaskExecutionContext context, String providerTaskId) {
        String taskPath = VIDEO_QUERY_PATH + providerTaskId;
        Duration pollingInterval = AiTaskPollingSupport.pollingInterval(properties);
        return Flux.range(0, MAXIMUM_POLLING_ATTEMPTS)
                .concatMap(attempt -> Mono.delay(pollingInterval)
                        .then(context.isCancelRequested())
                        .flatMap(cancelRequested -> Boolean.TRUE.equals(cancelRequested)
                                ? cancelMiniMaxVideoTask(context, providerTaskId)
                                : queryMiniMaxVideoTask(context, providerTaskId, taskPath, attempt)))
                .next()
                .switchIfEmpty(Mono.error(AiErrorSupport.providerPollingTimeout(
                        "MiniMax H3 视频生成超时，请稍后重试")));
    }

    /**
     * 查询一次 MiniMax H3 视频任务状态。
     *
     * @param context AiTaskExecutionContext AI 任务执行上下文
     * @param providerTaskId String MiniMax 任务 ID
     * @param taskPath String MiniMax 任务查询路径
     * @param attempt int 当前轮询序号
     * @return Mono<JSONObject> 成功时返回任务对象，处理中返回空信号
     */
    private Mono<JSONObject> queryMiniMaxVideoTask(
            AiTaskExecutionContext context, String providerTaskId, String taskPath, int attempt) {
        log.debug("MiniMax H3视频轮询第{}次: providerTaskId={}", attempt + 1, providerTaskId);
        return aiHttpClient.sendJsonRequest(context.channel(), "GET", taskPath, null)
                .map(AiJsonUtils::responsePayload)
                .map(MiniMaxProviderAdapter::taskPayload)
                .flatMap(task -> {
                    String status = AiTaskParameterReader.firstNonEmpty(task.getString("status"))
                            .toLowerCase(Locale.ROOT);
                    int progress = Math.min(95, 20 + attempt);
                    return context.updateRunningProgress(progress).then(Mono.defer(() -> {
                        if ("succeeded".equals(status)) {
                            return Mono.just(task);
                        }
                        if (PROCESSING_STATUSES.contains(status)) {
                            return Mono.empty();
                        }
                        if (FAILURE_STATUSES.contains(status)) {
                            return Mono.error(AiErrorSupport.providerTaskFailure(
                                    task, miniMaxFailureMessage(task, status)));
                        }
                        return Mono.error(new BusinessException(
                                ErrorCode.THIRD_PARTY_CALL_ERROR, "MiniMax H3 返回了未知任务状态: " + status));
                    }));
                });
    }

    /**
     * 取消 MiniMax H3 视频任务。
     *
     * @param context AiTaskExecutionContext AI 任务执行上下文
     * @param providerTaskId String MiniMax 任务 ID
     * @return Mono<JSONObject> 取消后以异常终止当前任务
     */
    private Mono<JSONObject> cancelMiniMaxVideoTask(AiTaskExecutionContext context, String providerTaskId) {
        String queryPath = VIDEO_QUERY_PATH + providerTaskId;
        log.info("取消MiniMax H3视频任务: taskId={}, providerTaskId={}", context.task().getId(), providerTaskId);
        return aiHttpClient.sendJsonRequest(context.channel(), "GET", queryPath, null)
                .map(AiJsonUtils::responsePayload)
                .map(MiniMaxProviderAdapter::taskPayload)
                .flatMap(task -> requestMiniMaxCancellation(context, providerTaskId, task))
                .doOnError(exception -> log.error(
                        "取消MiniMax H3视频任务失败: taskId={}, providerTaskId={}",
                        context.task().getId(), providerTaskId, exception))
                .then(Mono.<JSONObject>error(new BusinessException(ErrorCode.BUSINESS_ERROR, "任务已取消")));
    }

    /**
     * 根据 MiniMax H3 任务状态决定是否发送远端取消请求。
     *
     * @param context AiTaskExecutionContext AI 任务执行上下文
     * @param providerTaskId String MiniMax 任务 ID
     * @param task JSONObject MiniMax 任务对象
     * @return Mono<Void> 远端取消处理结果
     */
    private Mono<Void> requestMiniMaxCancellation(
            AiTaskExecutionContext context, String providerTaskId, JSONObject task) {
        String status = AiTaskParameterReader.firstNonEmpty(task.getString("status")).toLowerCase(Locale.ROOT);
        if ("queued".equals(status)) {
            return aiHttpClient.sendJsonRequest(
                            context.channel(), "DELETE", VIDEO_GENERATION_PATH + "/" + providerTaskId, null)
                    .doOnSuccess(ignored -> log.info(
                            "MiniMax H3排队任务已取消: taskId={}, providerTaskId={}",
                            context.task().getId(), providerTaskId))
                    .then();
        }
        if (Set.of("running", "succeeded", "failed", "cancelled").contains(status)) {
            log.info("MiniMax H3任务当前状态不支持远端取消: taskId={}, providerTaskId={}, status={}",
                    context.task().getId(), providerTaskId, status);
            return Mono.empty();
        }
        return Mono.error(new BusinessException(
                ErrorCode.THIRD_PARTY_CALL_ERROR, "MiniMax H3 返回了未知任务状态: " + status));
    }

    /**
     * 下载并保存 MiniMax H3 生成的视频。
     *
     * @param context AiTaskExecutionContext AI 任务执行上下文
     * @param providerTaskId String MiniMax 任务 ID
     * @param task JSONObject MiniMax 成功状态任务对象
     * @return Mono<JSONObject> 已持久化的视频结果
     */
    private Mono<JSONObject> storeMiniMaxVideo(
            AiTaskExecutionContext context, String providerTaskId, JSONObject task) {
        JSONObject content = task.getJSONObject("content");
        String videoUrl = content == null ? "" : AiTaskParameterReader.firstNonEmpty(content.getString("url"));
        if (!StringUtils.hasText(videoUrl)) {
            return Mono.error(new BusinessException(
                    ErrorCode.THIRD_PARTY_CALL_ERROR, "MiniMax H3 任务成功但没有返回视频URL"));
        }
        Integer duration = task.getInteger("duration");
        Integer durationMilliseconds = duration == null ? null : duration * 1000;
        log.info("MiniMax H3视频任务完成: taskId={}, providerTaskId={}, duration={}",
                context.task().getId(), providerTaskId, duration);
        // MiniMax 返回的下载地址具有时效，必须转存到项目媒体存储后再返回前端。
        return aiHttpClient.downloadRemoteBinary(videoUrl, "video/mp4")
                .flatMap(binary -> mediaSupport.storeGeneratedMedia(
                        context.task().getUserId(), AiTaskTypes.VIDEO, "generated-minimax-h3-video.mp4",
                        binary, null, null, durationMilliseconds))
                .map(media -> AiJsonUtils.jsonObject(Map.of(
                        "item", media,
                        "providerTaskId", providerTaskId
                )));
    }

    /**
     * 构建 MiniMax H3 视频任务请求体。
     *
     * @param model String 模型名称
     * @param prompt String 视频提示词
     * @param parameters Map<String, Object> 通用视频参数
     * @param imageUrls List<String> 参考图片 URL 列表
     * @param videoUrls List<String> 参考视频 URL 列表
     * @return Map<String, Object> MiniMax 请求体
     * @throws BusinessException 模型、参数或参考素材数量不合法时抛出
     */
    static Map<String, Object> buildRequestPayload(
            String model, String prompt, Map<String, Object> parameters,
            List<String> imageUrls, List<String> videoUrls) {
        String inferredMode = imageUrls.size() == 1 && videoUrls.isEmpty()
                ? VideoGenerationMode.IMAGE_TO_VIDEO
                : imageUrls.isEmpty() && videoUrls.isEmpty()
                        ? VideoGenerationMode.TEXT_TO_VIDEO
                        : VideoGenerationMode.REFERENCE_TO_VIDEO;
        return buildRequestPayload(model, prompt, parameters, imageUrls, videoUrls, inferredMode);
    }

    /**
     * 构建带显式生成模式的 MiniMax H3 视频任务请求体。
     *
     * @param model String 模型名称
     * @param prompt String 视频提示词
     * @param parameters Map<String, Object> 通用视频参数
     * @param imageUrls List<String> 参考图片 URL 列表
     * @param videoUrls List<String> 参考视频 URL 列表
     * @param videoGenerationMode String 视频生成模式
     * @return Map<String, Object> MiniMax 请求体
     * @throws BusinessException 模型、参数或参考素材数量不合法时抛出
     */
    static Map<String, Object> buildRequestPayload(
            String model, String prompt, Map<String, Object> parameters,
            List<String> imageUrls, List<String> videoUrls, String videoGenerationMode) {
        validateModel(model);
        validatePrompt(prompt);
        validateReferenceCounts(imageUrls.size(), videoUrls.size());
        String mode = VideoGenerationMode.defaultIfBlank(videoGenerationMode);
        if (!VideoGenerationMode.isSupported(mode)) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "视频生成模式不受支持");
        }
        boolean imageToVideo = VideoGenerationMode.IMAGE_TO_VIDEO.equals(mode);
        String ratio = imageToVideo ? "adaptive"
                : normalizeRatio(AiTaskParameterReader.parameterText(parameters, "size", "16:9"));
        if (imageUrls.isEmpty() && videoUrls.isEmpty() && "adaptive".equals(ratio)) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "MiniMax H3 文生视频必须指定非自适应比例");
        }
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("model", MINIMAX_H3_MODEL);
        payload.put("content", buildContent(prompt, imageUrls, videoUrls, imageToVideo, List.of()));
        payload.put("resolution", normalizeResolution(
                AiTaskParameterReader.parameterText(parameters, "resolution", "768p")));
        payload.put("duration", parseDuration(AiTaskParameterReader.parameterText(parameters, "seconds", "5")));
        payload.put("ratio", ratio);
        Boolean watermark = booleanParameter(parameters, "watermark");
        if (watermark != null) {
            payload.put("aigc_watermark", watermark);
        }
        return payload;
    }

    /** 构建带媒体角色的MiniMax请求体。 */
    private static Map<String, Object> buildRequestPayload(
            String model, String prompt, Map<String, Object> parameters,
            List<String> imageUrls, List<String> videoUrls, String videoGenerationMode,
            List<String> imageRoles) {
        validateModel(model);
        validatePrompt(prompt);
        validateReferenceCounts(imageUrls.size(), videoUrls.size());
        String mode = VideoGenerationMode.defaultIfBlank(videoGenerationMode);
        if (!VideoGenerationMode.isSupported(mode)) throw new BusinessException(ErrorCode.PARAM_INVALID, "视频生成模式不受支持");
        boolean imageToVideo = VideoGenerationMode.IMAGE_TO_VIDEO.equals(mode);
        String ratio = imageToVideo ? "adaptive" : normalizeRatio(AiTaskParameterReader.parameterText(parameters, "size", "16:9"));
        if (imageUrls.isEmpty() && videoUrls.isEmpty() && "adaptive".equals(ratio)) throw new BusinessException(ErrorCode.PARAM_INVALID, "MiniMax H3 文生视频必须指定非自适应比例");
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("model", MINIMAX_H3_MODEL);
        payload.put("content", buildContent(prompt, imageUrls, videoUrls, imageToVideo, imageRoles));
        payload.put("resolution", normalizeResolution(AiTaskParameterReader.parameterText(parameters, "resolution", "768p")));
        payload.put("duration", parseDuration(AiTaskParameterReader.parameterText(parameters, "seconds", "5")));
        payload.put("ratio", ratio);
        Boolean watermark = booleanParameter(parameters, "watermark");
        if (watermark != null) payload.put("aigc_watermark", watermark);
        return payload;
    }

    /**
     * 校验 MiniMax H3 文本提示词。
     *
     * @param prompt String 视频提示词
     * @return void 无返回值
     * @throws BusinessException 提示词为空或超过渠道限制时抛出
     */
    private static void validatePrompt(String prompt) {
        if (!StringUtils.hasText(prompt)) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "MiniMax H3 视频提示词不能为空");
        }
        if (prompt.codePointCount(0, prompt.length()) > 7000) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "MiniMax H3 视频提示词不能超过7000个字符");
        }
    }

    /**
     * 构建 MiniMax H3 多模态内容列表。
     *
     * @param prompt String 视频提示词
     * @param imageUrls List<String> 参考图片 URL 列表
     * @param videoUrls List<String> 参考视频 URL 列表
     * @return List<Map<String, Object>> MiniMax 内容列表
     */
    private static List<Map<String, Object>> buildContent(
            String prompt, List<String> imageUrls, List<String> videoUrls, boolean imageToVideo) {
        return buildContent(prompt, imageUrls, videoUrls, imageToVideo, List.of());
    }

    /** 构建保留工作流媒体角色的MiniMax多模态内容列表。 */
    private static List<Map<String, Object>> buildContent(
            String prompt, List<String> imageUrls, List<String> videoUrls, boolean imageToVideo,
            List<String> imageRoles) {
        List<Map<String, Object>> content = new ArrayList<>();
        content.add(Map.of("type", "text", "text", prompt));
        for (int index = 0; index < imageUrls.size(); index++) {
            String imageUrl = imageUrls.get(index);
            content.add(Map.of(
                    "type", "image_url",
                    "image_url", Map.of("url", imageUrl),
                    "role", index < imageRoles.size() && StringUtils.hasText(imageRoles.get(index))
                            ? imageRoles.get(index) : imageToVideo ? "first_frame" : "reference_image"
            ));
        }
        for (String videoUrl : videoUrls) {
            content.add(Map.of(
                    "type", "video_url",
                    "video_url", Map.of("url", videoUrl),
                    "role", "reference_video"
            ));
        }
        return content;
    }

    /**
     * 提取 MiniMax 查询响应中的任务对象。
     *
     * @param response JSONObject MiniMax 查询响应
     * @return JSONObject 任务对象
     * @throws BusinessException 响应未返回任务对象时抛出
     */
    static JSONObject taskPayload(JSONObject response) {
        JSONObject task = response == null ? null : response.getJSONObject("task");
        if (task == null) {
            throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "MiniMax H3 查询响应没有返回任务数据");
        }
        return task;
    }

    /**
     * 校验 MiniMax H3 模型名称。
     *
     * @param model String 模型名称
     * @return void 无返回值
     * @throws BusinessException 模型不是 MiniMax-H3 时抛出
     */
    private static void validateModel(String model) {
        if (!MINIMAX_H3_MODEL.equalsIgnoreCase(model == null ? "" : model.trim())) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "MiniMax 调用格式当前仅支持 " + MINIMAX_H3_MODEL);
        }
    }

    /**
     * 校验参考素材数量。
     *
     * @param imageCount int 参考图片数量
     * @param videoCount int 参考视频数量
     * @return void 无返回值
     * @throws BusinessException 参考素材数量超过渠道上限时抛出
     */
    private static void validateReferenceCounts(int imageCount, int videoCount) {
        if (imageCount > MAXIMUM_REFERENCE_IMAGE_COUNT) {
            throw new BusinessException(ErrorCode.PARAM_INVALID,
                    "MiniMax H3 参考图片最多" + MAXIMUM_REFERENCE_IMAGE_COUNT + "个");
        }
        if (videoCount > MAXIMUM_REFERENCE_VIDEO_COUNT) {
            throw new BusinessException(ErrorCode.PARAM_INVALID,
                    "MiniMax H3 参考视频最多" + MAXIMUM_REFERENCE_VIDEO_COUNT + "个");
        }
    }

    /**
     * 规范化 H3 视频比例。
     *
     * @param value String 比例值或既有像素预设
     * @return String H3 支持的视频比例
     * @throws BusinessException 比例不受支持时抛出
     */
    private static String normalizeRatio(String value) {
        String normalized = normalizeText(value);
        if ("auto".equals(normalized)) {
            return "16:9";
        }
        if (SUPPORTED_RATIOS.contains(normalized)) {
            return normalized;
        }
        String presetRatio = PRESET_SIZE_RATIOS.get(normalized);
        if (presetRatio != null) {
            return presetRatio;
        }
        throw new BusinessException(ErrorCode.PARAM_INVALID, "MiniMax H3 视频比例不支持: " + value);
    }

    /**
     * 规范化 H3 视频分辨率。
     *
     * @param value String 分辨率值
     * @return String H3 支持的视频分辨率
     * @throws BusinessException 分辨率不受支持时抛出
     */
    private static String normalizeResolution(String value) {
        String normalized = normalizeText(value);
        if ("768".equals(normalized) || "768p".equals(normalized)) {
            return "768P";
        }
        if ("2k".equals(normalized)) {
            return "2K";
        }
        throw new BusinessException(ErrorCode.PARAM_INVALID, "MiniMax H3 视频分辨率只支持768P或2K");
    }

    /**
     * 解析 H3 视频时长。
     *
     * @param value String 视频时长文本
     * @return int 视频时长秒数
     * @throws BusinessException 时长不是 4 到 15 之间的整数时抛出
     */
    private static int parseDuration(String value) {
        try {
            int duration = Integer.parseInt(value == null ? "" : value.trim());
            if (duration < 4 || duration > 15) {
                throw new BusinessException(ErrorCode.PARAM_INVALID, "MiniMax H3 视频时长只支持4到15秒");
            }
            return duration;
        } catch (NumberFormatException exception) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "MiniMax H3 视频时长必须是4到15之间的整数");
        }
    }

    /**
     * 读取布尔参数。
     *
     * @param parameters Map<String, Object> 参数映射
     * @param key String 参数名称
     * @return Boolean 布尔参数值，未传入时返回 null
     * @throws BusinessException 参数值不是布尔值时抛出
     */
    private static Boolean booleanParameter(Map<String, Object> parameters, String key) {
        if (parameters == null || !parameters.containsKey(key) || parameters.get(key) == null) {
            return null;
        }
        Object value = parameters.get(key);
        if (value instanceof Boolean booleanValue) {
            return booleanValue;
        }
        String normalized = normalizeText(String.valueOf(value));
        if ("true".equals(normalized)) {
            return true;
        }
        if ("false".equals(normalized)) {
            return false;
        }
        throw new BusinessException(ErrorCode.PARAM_INVALID, "MiniMax H3 水印参数必须为 true 或 false");
    }

    /**
     * 获取 MiniMax H3 失败信息。
     *
     * @param task JSONObject MiniMax 任务对象
     * @param status String 任务状态
     * @return String 失败信息
     */
    private static String miniMaxFailureMessage(JSONObject task, String status) {
        JSONObject error = task.getJSONObject("error");
        return AiTaskParameterReader.firstNonEmpty(
                error == null ? null : error.getString("message"),
                "cancelled".equals(status) ? "MiniMax H3 视频任务已取消" : "MiniMax H3 视频生成失败");
    }

    /**
     * 规范化文本。
     *
     * @param value String 原始文本
     * @return String 小写且去除首尾空白的文本
     */
    private static String normalizeText(String value) {
        return value == null ? "" : value.trim().toLowerCase(Locale.ROOT).replace(" ", "");
    }
}

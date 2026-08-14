package com.novanovastudio.ai.provider;

import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.ai.AiHttpClient;
import com.novanovastudio.ai.AiErrorSupport;
import com.novanovastudio.ai.AiJsonUtils;
import com.novanovastudio.ai.AiMediaSupport;
import com.novanovastudio.ai.AiProviderAdapter;
import com.novanovastudio.ai.AiTaskExecutionContext;
import com.novanovastudio.ai.AiTaskParameterReader;
import com.novanovastudio.ai.AiTaskPollingSupport;
import com.novanovastudio.ai.AiTaskTypes;
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
 * Seedance视频生成渠道适配器。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-28 11:45
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class SeedanceProviderAdapter implements AiProviderAdapter {

    /** Seedance视频任务接口路径 */
    private static final String VIDEO_TASK_PATH = "/contents/generations/tasks";

    /** 最大参考图片数量 */
    private static final int MAXIMUM_REFERENCE_IMAGE_COUNT = 9;

    /** 最大参考视频数量 */
    private static final int MAXIMUM_REFERENCE_VIDEO_COUNT = 3;

    /** 视频任务最大轮询次数 */
    private static final int MAXIMUM_POLLING_ATTEMPTS = 120;

    /** 仍需继续轮询的任务状态 */
    private static final Set<String> PROCESSING_STATUSES = Set.of("queued", "running");

    /** 生成失败的任务终态 */
    private static final Set<String> FAILURE_STATUSES = Set.of("failed", "cancelled", "expired");

    /** Seedance支持的视频比例 */
    private static final Map<String, Double> SUPPORTED_RATIOS = Map.of(
            "16:9", 16D / 9D,
            "4:3", 4D / 3D,
            "1:1", 1D,
            "3:4", 3D / 4D,
            "9:16", 9D / 16D,
            "21:9", 21D / 9D
    );

    /** AI HTTP客户端 */
    private final AiHttpClient aiHttpClient;

    /** AI媒体支持 */
    private final AiMediaSupport mediaSupport;

    /** 服务配置 */
    private final NovanovaProperties properties;

    /**
     * 获取渠道调用格式。
     *
     * @return String Seedance渠道调用格式
     */
    @Override
    public String apiFormat() {
        return "seedance";
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
     * 执行Seedance视频生成任务。
     *
     * @param context AiTaskExecutionContext AI任务执行上下文
     * @return Mono<JSONObject> 视频生成结果
     */
    @Override
    public Mono<JSONObject> execute(AiTaskExecutionContext context) {
        if (!supports(context.task().getTaskType())) {
            return Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "Seedance 调用格式仅支持视频任务"));
        }
        List<AiTaskDtos.AiTaskMediaReference> imageReferences =
                AiTaskParameterReader.safeReferences(context.request().references());
        List<AiTaskDtos.AiTaskMediaReference> videoReferences =
                AiTaskParameterReader.safeReferences(context.request().videoReferences());
        validateReferenceCounts(imageReferences.size(), videoReferences.size());

        Mono<List<String>> imageUrls = resolveReferenceUrls(context, imageReferences);
        Mono<List<String>> videoUrls = resolveReferenceUrls(context, videoReferences);
        return Mono.zip(imageUrls, videoUrls)
                .flatMap(urls -> createSeedanceVideoTask(context, urls.getT1(), urls.getT2()));
    }

    /**
     * 解析参考媒体URL列表。
     *
     * @param context AiTaskExecutionContext AI任务执行上下文
     * @param references List<AiTaskMediaReference> 参考媒体列表
     * @return Mono<List<String>> 可供Seedance访问的媒体URL列表
     */
    private Mono<List<String>> resolveReferenceUrls(
            AiTaskExecutionContext context,
            List<AiTaskDtos.AiTaskMediaReference> references) {
        return Flux.fromIterable(references)
                .concatMap(reference -> mediaSupport.resolveReferenceUrl(context.task().getUserId(), reference))
                .collectList();
    }

    /**
     * 创建Seedance视频任务并等待任务完成。
     *
     * @param context AiTaskExecutionContext AI任务执行上下文
     * @param imageUrls List<String> 参考图片URL列表
     * @param videoUrls List<String> 参考视频URL列表
     * @return Mono<JSONObject> 视频生成结果
     */
    private Mono<JSONObject> createSeedanceVideoTask(
            AiTaskExecutionContext context, List<String> imageUrls, List<String> videoUrls) {
        Map<String, Object> payload = buildRequestPayload(
                context.model(), context.request().prompt(), context.request().parameters(), imageUrls, videoUrls);
        log.info("创建Seedance视频任务: taskId={}, model={}, imageCount={}, videoCount={}",
                context.task().getId(), context.model(), imageUrls.size(), videoUrls.size());
        return aiHttpClient.sendJsonRequest(context.channel(), "POST", VIDEO_TASK_PATH, payload)
                .map(AiJsonUtils::responsePayload)
                .flatMap(created -> {
                    String providerTaskId = AiTaskParameterReader.firstNonEmpty(created.getString("id"));
                    if (!StringUtils.hasText(providerTaskId)) {
                        return Mono.error(new BusinessException(
                                ErrorCode.THIRD_PARTY_CALL_ERROR, "Seedance 接口没有返回任务ID"));
                    }
                    return context.updateRunningProgress(20)
                            .then(pollSeedanceVideoTask(context, providerTaskId))
                            .flatMap(finished -> storeSeedanceVideo(context, providerTaskId, finished));
                });
    }

    /**
     * 轮询Seedance视频任务。
     *
     * @param context AiTaskExecutionContext AI任务执行上下文
     * @param providerTaskId String Seedance任务ID
     * @return Mono<JSONObject> Seedance成功状态响应
     */
    private Mono<JSONObject> pollSeedanceVideoTask(AiTaskExecutionContext context, String providerTaskId) {
        String taskPath = VIDEO_TASK_PATH + "/" + providerTaskId;
        Duration pollingInterval = AiTaskPollingSupport.pollingInterval(properties);
        return Flux.range(0, MAXIMUM_POLLING_ATTEMPTS)
                .concatMap(attempt -> Mono.delay(pollingInterval)
                        .then(context.isCancelRequested())
                        .flatMap(cancelRequested -> Boolean.TRUE.equals(cancelRequested)
                                ? cancelSeedanceVideoTask(context, providerTaskId)
                                : querySeedanceVideoTask(context, providerTaskId, taskPath, attempt)))
                .next()
                .switchIfEmpty(Mono.error(AiErrorSupport.providerPollingTimeout(
                        "Seedance 视频生成超时，请稍后重试")));
    }

    /**
     * 查询一次Seedance视频任务状态。
     *
     * @param context AiTaskExecutionContext AI任务执行上下文
     * @param providerTaskId String Seedance任务ID
     * @param taskPath String Seedance任务查询路径
     * @param attempt int 当前轮询序号
     * @return Mono<JSONObject> 成功时返回状态对象，处理中返回空信号
     */
    private Mono<JSONObject> querySeedanceVideoTask(
            AiTaskExecutionContext context, String providerTaskId, String taskPath, int attempt) {
        log.debug("Seedance视频轮询第{}次: providerTaskId={}", attempt + 1, providerTaskId);
        return aiHttpClient.sendJsonRequest(context.channel(), "GET", taskPath, null)
                .map(AiJsonUtils::responsePayload)
                .flatMap(response -> {
                    String status = AiTaskParameterReader.firstNonEmpty(response.getString("status"))
                            .toLowerCase(Locale.ROOT);
                    int progress = Math.min(95, 20 + attempt);
                    return context.updateRunningProgress(progress).then(Mono.defer(() -> {
                        if ("succeeded".equals(status)) {
                            return Mono.just(response);
                        }
                        if (PROCESSING_STATUSES.contains(status)) {
                            return Mono.empty();
                        }
                        if (FAILURE_STATUSES.contains(status)) {
                            return Mono.error(AiErrorSupport.providerTaskFailure(
                                    response, seedanceFailureMessage(response, status)));
                        }
                        return Mono.error(new BusinessException(
                                ErrorCode.THIRD_PARTY_CALL_ERROR, "Seedance 返回了未知任务状态: " + status));
                    }));
                });
    }

    /**
     * 取消Seedance视频任务。
     *
     * @param context AiTaskExecutionContext AI任务执行上下文
     * @param providerTaskId String Seedance任务ID
     * @return Mono<JSONObject> 取消后以异常终止当前任务
     */
    private Mono<JSONObject> cancelSeedanceVideoTask(AiTaskExecutionContext context, String providerTaskId) {
        String taskPath = VIDEO_TASK_PATH + "/" + providerTaskId;
        log.info("取消Seedance视频任务: taskId={}, providerTaskId={}", context.task().getId(), providerTaskId);
        return aiHttpClient.sendJsonRequest(context.channel(), "GET", taskPath, null)
                .map(AiJsonUtils::responsePayload)
                .flatMap(response -> requestSeedanceCancellation(context, providerTaskId, taskPath, response))
                .doOnError(exception -> log.error(
                        "取消Seedance视频任务失败: taskId={}, providerTaskId={}",
                        context.task().getId(), providerTaskId, exception))
                .then(Mono.<JSONObject>error(new BusinessException(ErrorCode.BUSINESS_ERROR, "任务已取消")));
    }

    /**
     * 根据Seedance任务状态决定是否发送远端取消请求。
     *
     * @param context AiTaskExecutionContext AI任务执行上下文
     * @param providerTaskId String Seedance任务ID
     * @param taskPath String Seedance任务路径
     * @param response JSONObject Seedance任务状态响应
     * @return Mono<Void> 远端取消处理结果
     */
    private Mono<Void> requestSeedanceCancellation(
            AiTaskExecutionContext context, String providerTaskId, String taskPath, JSONObject response) {
        String status = AiTaskParameterReader.firstNonEmpty(response.getString("status")).toLowerCase(Locale.ROOT);
        if ("queued".equals(status)) {
            return aiHttpClient.sendJsonRequest(context.channel(), "DELETE", taskPath, null)
                    .doOnSuccess(ignored -> log.info(
                            "Seedance排队任务已取消: taskId={}, providerTaskId={}",
                            context.task().getId(), providerTaskId))
                    .then();
        }
        if (Set.of("running", "succeeded", "failed", "cancelled", "expired").contains(status)) {
            log.info("Seedance任务当前状态不支持远端取消: taskId={}, providerTaskId={}, status={}",
                    context.task().getId(), providerTaskId, status);
            return Mono.empty();
        }
        return Mono.error(new BusinessException(
                ErrorCode.THIRD_PARTY_CALL_ERROR, "Seedance 返回了未知任务状态: " + status));
    }

    /**
     * 下载并保存Seedance生成的视频。
     *
     * @param context AiTaskExecutionContext AI任务执行上下文
     * @param providerTaskId String Seedance任务ID
     * @param finished JSONObject Seedance成功状态响应
     * @return Mono<JSONObject> 已持久化的视频结果
     */
    private Mono<JSONObject> storeSeedanceVideo(
            AiTaskExecutionContext context, String providerTaskId, JSONObject finished) {
        JSONObject content = finished.getJSONObject("content");
        String videoUrl = content == null ? "" : AiTaskParameterReader.firstNonEmpty(content.getString("video_url"));
        if (!StringUtils.hasText(videoUrl)) {
            return Mono.error(new BusinessException(
                    ErrorCode.THIRD_PARTY_CALL_ERROR, "Seedance 任务成功但没有返回视频URL"));
        }
        Integer duration = finished.getInteger("duration");
        Integer durationMilliseconds = duration == null ? null : duration * 1000;
        log.info("Seedance视频任务完成: taskId={}, providerTaskId={}, duration={}",
                context.task().getId(), providerTaskId, duration);
        // Seedance结果地址仅短期有效，必须下载到项目媒体存储后再返回给前端。
        return aiHttpClient.downloadRemoteBinary(videoUrl, "video/mp4")
                .flatMap(binary -> mediaSupport.storeGeneratedMedia(
                        context.task().getUserId(), AiTaskTypes.VIDEO, "generated-seedance-video.mp4",
                        binary, null, null, durationMilliseconds))
                .map(media -> AiJsonUtils.jsonObject(Map.of(
                        "item", media,
                        "providerTaskId", providerTaskId
                )));
    }

    /**
     * 构建Seedance视频任务请求体。
     *
     * @param model String 模型ID或推理接入点ID
     * @param prompt String 视频提示词
     * @param parameters Map<String, Object> 通用视频参数
     * @param imageUrls List<String> 参考图片URL列表
     * @param videoUrls List<String> 参考视频URL列表
     * @return Map<String, Object> Seedance请求体
     */
    static Map<String, Object> buildRequestPayload(
            String model, String prompt, Map<String, Object> parameters,
            List<String> imageUrls, List<String> videoUrls) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("model", model);
        payload.put("content", buildContent(prompt, imageUrls, videoUrls));
        payload.put("ratio", normalizeRatio(AiTaskParameterReader.parameterText(parameters, "size", "adaptive")));
        payload.put("resolution", normalizeResolution(
                AiTaskParameterReader.parameterText(parameters, "resolution", "720p")));
        payload.put("duration", parseDuration(AiTaskParameterReader.parameterText(parameters, "seconds", "5")));
        Boolean watermark = booleanParameter(parameters, "watermark");
        if (watermark != null) {
            payload.put("watermark", watermark);
        }
        return payload;
    }

    /**
     * 构建Seedance多模态内容列表。
     *
     * @param prompt String 视频提示词
     * @param imageUrls List<String> 参考图片URL列表
     * @param videoUrls List<String> 参考视频URL列表
     * @return List<Map<String, Object>> Seedance内容列表
     */
    private static List<Map<String, Object>> buildContent(
            String prompt, List<String> imageUrls, List<String> videoUrls) {
        List<Map<String, Object>> content = new ArrayList<>();
        content.add(Map.of("type", "text", "text", referenceAwarePrompt(prompt, imageUrls.size(), videoUrls.size())));
        for (String imageUrl : imageUrls) {
            content.add(Map.of(
                    "type", "image_url",
                    "image_url", Map.of("url", imageUrl),
                    "role", "reference_image"
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
     * 为多模态参考素材补充稳定编号。
     *
     * @param prompt String 原始提示词
     * @param imageCount int 参考图片数量
     * @param videoCount int 参考视频数量
     * @return String 带参考素材编号说明的提示词
     */
    private static String referenceAwarePrompt(String prompt, int imageCount, int videoCount) {
        if (imageCount == 0 && videoCount == 0) {
            return prompt;
        }
        List<String> labels = new ArrayList<>();
        for (int index = 0; index < imageCount; index++) {
            labels.add("图片" + (index + 1));
        }
        for (int index = 0; index < videoCount; index++) {
            labels.add("视频" + (index + 1));
        }
        return "参考素材编号：" + String.join("、", labels)
                + "。请按这些编号理解提示词中的图片和视频引用。\n\n" + prompt.trim();
    }

    /**
     * 校验参考素材数量。
     *
     * @param imageCount int 参考图片数量
     * @param videoCount int 参考视频数量
     * @return void 无返回值
     */
    private static void validateReferenceCounts(int imageCount, int videoCount) {
        if (imageCount > MAXIMUM_REFERENCE_IMAGE_COUNT) {
            throw new BusinessException(ErrorCode.PARAM_INVALID,
                    "Seedance 参考图片最多" + MAXIMUM_REFERENCE_IMAGE_COUNT + "个");
        }
        if (videoCount > MAXIMUM_REFERENCE_VIDEO_COUNT) {
            throw new BusinessException(ErrorCode.PARAM_INVALID,
                    "Seedance 参考视频最多" + MAXIMUM_REFERENCE_VIDEO_COUNT + "个");
        }
    }

    /**
     * 将通用尺寸参数转换为Seedance比例。
     *
     * @param value String 比例、像素尺寸或自动值
     * @return String Seedance比例
     */
    private static String normalizeRatio(String value) {
        String normalized = value == null ? "" : value.trim().toLowerCase(Locale.ROOT).replace(" ", "");
        if (normalized.isEmpty() || "auto".equals(normalized) || "adaptive".equals(normalized)) {
            return "adaptive";
        }
        if (SUPPORTED_RATIOS.containsKey(normalized)) {
            return normalized;
        }
        if (!normalized.matches("^\\d+x\\d+$")) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "Seedance 视频比例不支持: " + value);
        }
        String[] dimensions = normalized.split("x");
        double width = Double.parseDouble(dimensions[0]);
        double height = Double.parseDouble(dimensions[1]);
        if (width <= 0 || height <= 0) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "Seedance 视频尺寸必须为正数");
        }
        double ratio = width / height;
        return SUPPORTED_RATIOS.entrySet().stream()
                .min(java.util.Comparator.comparingDouble(entry -> Math.abs(entry.getValue() - ratio)))
                .orElseThrow()
                .getKey();
    }

    /**
     * 将通用清晰度参数转换为Seedance分辨率。
     *
     * @param value String 通用清晰度或Seedance分辨率
     * @return String Seedance分辨率
     */
    private static String normalizeResolution(String value) {
        String normalized = value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
        normalized = switch (normalized) {
            case "low" -> "480p";
            case "auto", "medium", "high", "" -> "720p";
            default -> normalized.matches("^\\d+$") ? normalized + "p" : normalized;
        };
        if (!Set.of("480p", "720p", "1080p", "4k").contains(normalized)) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "Seedance 视频分辨率不支持: " + value);
        }
        return normalized;
    }

    /**
     * 解析Seedance视频时长。
     *
     * @param value String 视频时长文本
     * @return int 视频时长秒数，-1表示由模型决定
     */
    private static int parseDuration(String value) {
        try {
            int duration = Integer.parseInt(value);
            if (duration == -1 || duration > 0) {
                return duration;
            }
        } catch (NumberFormatException ignored) {
            // 统一在方法末尾抛出参数异常。
        }
        throw new BusinessException(ErrorCode.PARAM_INVALID, "Seedance 视频时长必须是正整数或-1");
    }

    /**
     * 读取可选布尔参数。
     *
     * @param parameters Map<String, Object> 参数集合
     * @param key String 参数名称
     * @return Boolean 布尔值，未提供时返回null
     */
    private static Boolean booleanParameter(Map<String, Object> parameters, String key) {
        Object value = parameters == null ? null : parameters.get(key);
        if (value == null) {
            return null;
        }
        if (value instanceof Boolean booleanValue) {
            return booleanValue;
        }
        if ("true".equalsIgnoreCase(String.valueOf(value))) {
            return true;
        }
        if ("false".equalsIgnoreCase(String.valueOf(value))) {
            return false;
        }
        throw new BusinessException(ErrorCode.PARAM_INVALID, "Seedance " + key + "参数必须是布尔值");
    }

    /**
     * 读取Seedance失败原因。
     *
     * @param response JSONObject Seedance状态响应
     * @param status String Seedance任务状态
     * @return String 失败原因
     */
    private static String seedanceFailureMessage(JSONObject response, String status) {
        JSONObject error = response.getJSONObject("error");
        if (error != null && StringUtils.hasText(error.getString("message"))) {
            return error.getString("message");
        }
        return switch (status) {
            case "cancelled" -> "Seedance 视频任务已取消";
            case "expired" -> "Seedance 视频任务已超时";
            default -> "Seedance 视频生成失败";
        };
    }
}

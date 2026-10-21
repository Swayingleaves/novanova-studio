package com.novanovastudio.ai.provider;

import com.novanovastudio.common.SystemMessage;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
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
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.dto.AiTaskDtos;
import java.time.Duration;
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
 * Evolink视频与图片生成渠道适配器。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-08-12 10:30
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class EvolinkProviderAdapter implements AiProviderAdapter {

    /** Evolink视频创建接口。 */
    private static final String VIDEO_GENERATION_PATH = "/videos/generations";
    /** Evolink图片创建接口。 */
    private static final String IMAGE_GENERATION_PATH = "/images/generations";
    /** Evolink任务查询接口前缀。 */
    private static final String TASK_PATH_PREFIX = "/tasks/";
    /** 最大轮询次数。 */
    private static final int MAXIMUM_POLLING_ATTEMPTS = 120;
    /** 处理中状态。 */
    private static final Set<String> PROCESSING_STATUSES = Set.of("pending", "processing");
    /** AI HTTP客户端。 */
    private final AiHttpClient aiHttpClient;
    /** 媒体存储能力。 */
    private final AiMediaSupport mediaSupport;
    /** 服务配置。 */
    private final NovanovaProperties properties;

    /**
     * 获取渠道调用格式。
     *
     * @return String Evolink渠道格式标识
     */
    @Override
    public String apiFormat() {
        return "evolink";
    }

    /**
     * 判断任务类型是否支持。
     *
     * @param taskType String 任务类型
     * @return boolean 是否支持该任务类型
     */
    @Override
    public boolean supports(String taskType) {
        return AiTaskTypes.VIDEO.equals(taskType) || AiTaskTypes.IMAGE.equals(taskType);
    }

    /**
     * 创建并等待Evolink图片或视频任务。
     *
     * @param context AiTaskExecutionContext 当前AI任务上下文
     * @return Mono<JSONObject> 已保存的媒体结果
     */
    @Override
    public Mono<JSONObject> execute(AiTaskExecutionContext context) {
        if (AiTaskTypes.IMAGE.equals(context.task().getTaskType())) return executeImageTask(context);
        if (!AiTaskTypes.VIDEO.equals(context.task().getTaskType())) {
            return Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, SystemMessage.of("business.evolinkSupportsImageAndVideoTasksOnly")));
        }
        List<AiTaskDtos.AiTaskMediaReference> imageReferences = AiTaskParameterReader.safeReferences(context.request().references());
        List<AiTaskDtos.AiTaskMediaReference> videoReferences = AiTaskParameterReader.safeReferences(context.request().videoReferences());
        if (imageReferences.size() > 9 || videoReferences.size() > 3) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.evolinkSupportsUpTo9ImagesAnd3Videos")));
        }
        return Mono.zip(resolveUrls(context, imageReferences), resolveUrls(context, videoReferences), resolveUrls(context, AiTaskParameterReader.safeReferences(context.request().audioReferences())))
                .flatMap(urls -> createTask(context, urls.getT1(), urls.getT2(), urls.getT3()));
    }

    /**
     * 解析参考媒体URL。
     *
     * @param context AiTaskExecutionContext 当前AI任务上下文
     * @param references List<AiTaskMediaReference> 参考媒体列表
     * @return Mono<List<String>> 可供Evolink访问的媒体URL
     */
    private Mono<List<String>> resolveUrls(AiTaskExecutionContext context, List<AiTaskDtos.AiTaskMediaReference> references) {
        return Flux.fromIterable(references)
                .concatMap(reference -> mediaSupport.resolveReferenceUrl(context.task().getUserId(), reference))
                .collectList();
    }

    /**
     * 创建Evolink任务并轮询结果。
     *
     * @param context AiTaskExecutionContext 当前AI任务上下文
     * @param imageUrls List<String> 参考图片地址
     * @param videoUrls List<String> 参考视频地址
     * @param audioUrls List<String> 按提示词编号排列的参考音频地址
     * @return Mono<JSONObject> 已保存的视频媒体结果
     */
    private Mono<JSONObject> createTask(AiTaskExecutionContext context, List<String> imageUrls, List<String> videoUrls, List<String> audioUrls) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("model", context.model());
        payload.put("prompt", audioReferencePrompt(context.request().prompt(), audioUrls.size()));
        if (!audioUrls.isEmpty()) payload.put("audio_urls", audioUrls);
        if (!imageUrls.isEmpty()) payload.put("image_urls", imageUrls);
        if (!videoUrls.isEmpty()) payload.put("video_urls", videoUrls);
        payload.put("duration", parameterInt(context, "seconds", 5));
        payload.put("quality", normalizeQuality(parameterText(context, "resolution", "720p")));
        payload.put("aspect_ratio", normalizeAspectRatio(parameterText(context, "size", "adaptive")));
        payload.put("generate_audio", true);
        payload.put("content_filter", true);
        log.info("创建Evolink视频任务: taskId={}, model={}, audioCount={}", context.task().getId(), context.model(), audioUrls.size());
        return aiHttpClient.sendJsonRequest(context.channel(), "POST", VIDEO_GENERATION_PATH, AiRequestBodySupport.mergeCustomBodyParameters(payload, context.customBodyParameters()))
                .map(AiJsonUtils::responsePayload)
                .flatMap(created -> {
                    String providerTaskId = created.getString("id");
                    if (!StringUtils.hasText(providerTaskId)) {
                        return Mono.error(new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, SystemMessage.of("business.evolinkReturnedNoTaskID")));
                    }
                    return context.updateRunningProgress(10)
                            .then(pollTask(context, providerTaskId))
                            .flatMap(finished -> storeResult(context, providerTaskId, finished));
                });
    }

    /**
     * 轮询Evolink任务。
     *
     * @param context AiTaskExecutionContext 当前AI任务上下文
     * @param providerTaskId String Evolink任务ID
     * @return Mono<JSONObject> 已完成的Evolink任务响应
     */
    private Mono<JSONObject> pollTask(AiTaskExecutionContext context, String providerTaskId) {
        Duration pollingInterval = AiTaskPollingSupport.pollingInterval(properties);
        return Flux.range(0, MAXIMUM_POLLING_ATTEMPTS)
                .concatMap(attempt -> Mono.delay(pollingInterval).then(context.isCancelRequested()).flatMap(cancelled -> {
                    if (Boolean.TRUE.equals(cancelled)) return Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, SystemMessage.of("business.taskCanceled")));
                    return aiHttpClient.sendJsonRequest(context.channel(), "GET", TASK_PATH_PREFIX + providerTaskId, null)
                            .map(AiJsonUtils::responsePayload)
                            .flatMap(response -> {
                                String status = AiTaskParameterReader.firstNonEmpty(response.getString("status")).toLowerCase(Locale.ROOT);
                                return context.updateRunningProgress(Math.min(95, 10 + attempt)).then(Mono.defer(() -> {
                                    if ("completed".equals(status)) return Mono.just(response);
                                    if (PROCESSING_STATUSES.contains(status)) return Mono.empty();
                                    if ("failed".equals(status) || "cancelled".equals(status)) return Mono.error(AiErrorSupport.providerTaskFailure(response, "Evolink任务生成失败"));
                                    return Mono.error(new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, SystemMessage.of("business.unknownEvolinkTaskStatus", status)));
                                }));
                            });
                }))
                .next()
                .switchIfEmpty(Mono.error(AiErrorSupport.providerPollingTimeout("Evolink任务生成超时，请稍后重试")));
    }

    /**
     * 下载并保存Evolink视频结果。
     *
     * @param context AiTaskExecutionContext 当前AI任务上下文
     * @param providerTaskId String Evolink任务ID
     * @param response JSONObject Evolink完成任务响应
     * @return Mono<JSONObject> 已保存的视频媒体结果
     */
    private Mono<JSONObject> storeResult(AiTaskExecutionContext context, String providerTaskId, JSONObject response) {
        JSONArray results = response.getJSONArray("results");
        String resultUrl = results == null || results.isEmpty() ? "" : results.getString(0);
        if (!StringUtils.hasText(resultUrl)) return Mono.error(new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, SystemMessage.of("business.evolinkTaskCompletedWithoutVideoURL")));
        return aiHttpClient.downloadRemoteBinary(resultUrl, "video/mp4")
                .flatMap(binary -> mediaSupport.storeGeneratedMedia(context.task().getUserId(), AiTaskTypes.VIDEO, "generated-evolink-video.mp4", binary, null, null, null))
                .map(media -> AiJsonUtils.jsonObject(Map.of("item", media, "providerTaskId", providerTaskId)));
    }

    /**
     * 创建并等待Evolink图片任务。
     *
     * @param context AiTaskExecutionContext 当前AI任务上下文
     * @return Mono<JSONObject> 已保存的图片媒体结果
     */
    private Mono<JSONObject> executeImageTask(AiTaskExecutionContext context) {
        List<AiTaskDtos.AiTaskMediaReference> imageReferences = AiTaskParameterReader.safeReferences(context.request().references());
        if (imageReferences.size() > 16) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.evolinkSupportsUpTo16Images")));
        }
        return resolveUrls(context, imageReferences).flatMap(imageUrls -> createImageTask(context, imageUrls));
    }

    /**
     * 创建Evolink图片任务并轮询结果。
     *
     * @param context AiTaskExecutionContext 当前AI任务上下文
     * @param imageUrls List<String> 参考图片地址
     * @return Mono<JSONObject> 已保存的图片媒体结果
     */
    private Mono<JSONObject> createImageTask(AiTaskExecutionContext context, List<String> imageUrls) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("model", context.model());
        payload.put("prompt", context.request().prompt());
        if (!imageUrls.isEmpty()) payload.put("image_urls", imageUrls);
        // 部分图片模型不接受n参数，只有需要多张时才显式传递。
        int count = AiTaskParameterReader.intParameter(context.request().parameters(), "count", 1, 1, 10);
        if (count > 1) payload.put("n", count);
        // 手写size优先，其次按模型尺寸表转换；auto不传，交给供应商决定。
        if (context.customBodyParameters() == null || !context.customBodyParameters().containsKey("size")) {
            String imageSize = AiImageSizeSupport.resolveSize(context.request().parameters(), context.convertImageSizeToPixels(), context.imageSizeMappings());
            if (StringUtils.hasText(imageSize)) payload.put("size", imageSize);
        }
        AiTaskParameterReader.putNonAuto(payload, context.request().parameters(), "quality");
        log.info("创建Evolink图片任务: taskId={}, model={}, imageCount={}", context.task().getId(), context.model(), imageUrls.size());
        return aiHttpClient.sendJsonRequest(context.channel(), "POST", IMAGE_GENERATION_PATH, AiRequestBodySupport.mergeCustomBodyParameters(payload, context.customBodyParameters()))
                .map(AiJsonUtils::responsePayload)
                .flatMap(created -> {
                    String providerTaskId = created.getString("id");
                    if (!StringUtils.hasText(providerTaskId)) {
                        return Mono.error(new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, SystemMessage.of("business.evolinkReturnedNoTaskID")));
                    }
                    return context.updateRunningProgress(10)
                            .then(pollTask(context, providerTaskId))
                            .flatMap(finished -> storeImageResult(context, providerTaskId, finished));
                });
    }

    /**
     * 下载并保存Evolink图片结果。
     * <p>
     * Evolink生成的图片链接只有24小时有效期，必须转存到对象存储，否则历史记录很快失效。
     *
     * @param context AiTaskExecutionContext 当前AI任务上下文
     * @param providerTaskId String Evolink任务ID
     * @param response JSONObject Evolink完成任务响应
     * @return Mono<JSONObject> 已保存的图片媒体结果
     */
    private Mono<JSONObject> storeImageResult(AiTaskExecutionContext context, String providerTaskId, JSONObject response) {
        JSONArray results = response.getJSONArray("results");
        if (results == null || results.isEmpty()) {
            return Mono.error(new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, SystemMessage.of("business.evolinkTaskCompletedWithoutImageURL")));
        }
        return Flux.fromIterable(results)
                .concatMap(url -> aiHttpClient.downloadRemoteBinary(String.valueOf(url), "image/png")
                        .flatMap(binary -> mediaSupport.storeGeneratedMedia(context.task().getUserId(), AiTaskTypes.IMAGE, imageFileName(binary.mimeType()), binary, null, null, null)))
                .collectList()
                .map(items -> AiJsonUtils.jsonObject(Map.of("items", items, "providerTaskId", providerTaskId)));
    }

    /**
     * 按图片MIME类型生成保存文件名。
     *
     * @param mimeType String 图片MIME类型
     * @return String 保存文件名
     */
    private static String imageFileName(String mimeType) {
        String normalized = mimeType == null ? "" : mimeType.trim().toLowerCase(Locale.ROOT);
        if ("image/jpeg".equals(normalized) || "image/jpg".equals(normalized)) return "generated-evolink-image.jpg";
        if ("image/webp".equals(normalized)) return "generated-evolink-image.webp";
        return "generated-evolink-image.png";
    }

    /**
     * 读取整型任务参数。
     *
     * @param context AiTaskExecutionContext 当前AI任务上下文
     * @param key String 参数名称
     * @param defaultValue int 默认值
     * @return int 参数值
     */
    private static int parameterInt(AiTaskExecutionContext context, String key, int defaultValue) {
        return AiTaskParameterReader.intParameter(context.request().parameters(), key, defaultValue, 4, 15);
    }

    /**
     * 读取文本任务参数。
     *
     * @param context AiTaskExecutionContext 当前AI任务上下文
     * @param key String 参数名称
     * @param defaultValue String 默认值
     * @return String 参数值
     */
    private static String parameterText(AiTaskExecutionContext context, String key, String defaultValue) {
        return AiTaskParameterReader.parameterText(context.request().parameters(), key, defaultValue);
    }

    /**
     * 规范化Evolink视频清晰度。
     *
     * @param value String 原始清晰度
     * @return String Evolink支持的清晰度
     */
    private static String normalizeQuality(String value) {
        String normalized = value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
        if ("low".equals(normalized)) return "480p";
        if ("auto".equals(normalized) || "medium".equals(normalized) || "high".equals(normalized) || normalized.isEmpty()) return "720p";
        if (Set.of("480p", "720p", "1080p").contains(normalized)) return normalized;
        throw new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.evolinkResolutionMustBe480p720pOr1080p"));
    }

    /**
     * 规范化Evolink视频比例。
     *
     * @param value String 原始视频比例
     * @return String Evolink支持的视频比例
     */
    private static String normalizeAspectRatio(String value) {
        String normalized = value == null ? "" : value.trim().toLowerCase(Locale.ROOT).replace(" ", "");
        if (normalized.isEmpty() || "auto".equals(normalized) || "adaptive".equals(normalized)) return "adaptive";
        if (Set.of("16:9", "9:16", "1:1", "4:3", "3:4", "21:9").contains(normalized)) return normalized;
        if (normalized.matches("^\\d+x\\d+$")) {
            String[] dimensions = normalized.split("x");
            double width = Double.parseDouble(dimensions[0]);
            double height = Double.parseDouble(dimensions[1]);
            if (width <= 0 || height <= 0) throw new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.evolinkVideoDimensionsMustBePositive"));
            double ratio = width / height;
            return Set.of("16:9", "9:16", "1:1", "4:3", "3:4", "21:9").stream()
                    .min(java.util.Comparator.comparingDouble(candidate -> Math.abs(ratio - ratioValue(candidate))))
                    .orElseThrow();
        }
        throw new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.unsupportedEvolinkAspectRatio", value));
    }

    /**
     * 计算比例数值。
     *
     * @param ratio String 宽高比文本
     * @return double 宽高比数值
     */
    private static double ratioValue(String ratio) {
        String[] parts = ratio.split(":");
        return Double.parseDouble(parts[0]) / Double.parseDouble(parts[1]);
    }
    /**
     * 将界面中的音频编号转换成渠道显式引用标签。
     * @param prompt String 用户提示词
     * @param count int 实际音频数量
     * @return String 与音频数组顺序一致的提示词
     */
    static String audioReferencePrompt(String prompt, int count) {
        String result = prompt;
        for (int index = count; index >= 1; index--) result = result.replaceAll("`?音频" + index + "(?![0-9])`?", "@audio" + index);
        List<String> missingLabels = new java.util.ArrayList<>();
        for (int index = 1; index <= count; index++) {
            String label = "@audio" + index;
            if (!result.matches("(?s).*" + java.util.regex.Pattern.quote(label) + "(?![0-9]).*")) missingLabels.add(label);
        }
        if (!missingLabels.isEmpty()) result = result + "\n\n参考音频：" + String.join("、", missingLabels);
        return result;
    }

}

package com.novanovastudio.ai.provider;

import com.alibaba.fastjson2.JSONArray;
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
 * Evolink视频生成渠道适配器。
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
        return AiTaskTypes.VIDEO.equals(taskType);
    }

    /**
     * 创建并等待Evolink视频任务。
     *
     * @param context AiTaskExecutionContext 当前AI任务上下文
     * @return Mono<JSONObject> 已保存的视频媒体结果
     */
    @Override
    public Mono<JSONObject> execute(AiTaskExecutionContext context) {
        if (!supports(context.task().getTaskType())) {
            return Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "Evolink渠道仅支持视频任务"));
        }
        List<AiTaskDtos.AiTaskMediaReference> imageReferences = AiTaskParameterReader.safeReferences(context.request().references());
        List<AiTaskDtos.AiTaskMediaReference> videoReferences = AiTaskParameterReader.safeReferences(context.request().videoReferences());
        if (imageReferences.size() > 9 || videoReferences.size() > 3) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "Evolink最多支持9张参考图和3个参考视频"));
        }
        return resolveUrls(context, imageReferences).zipWith(resolveUrls(context, videoReferences))
                .flatMap(urls -> createTask(context, urls.getT1(), urls.getT2()));
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
     * @return Mono<JSONObject> 已保存的视频媒体结果
     */
    private Mono<JSONObject> createTask(AiTaskExecutionContext context, List<String> imageUrls, List<String> videoUrls) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("model", context.model());
        payload.put("prompt", context.request().prompt());
        if (!imageUrls.isEmpty()) payload.put("image_urls", imageUrls);
        if (!videoUrls.isEmpty()) payload.put("video_urls", videoUrls);
        payload.put("duration", parameterInt(context, "seconds", 5));
        payload.put("quality", normalizeQuality(parameterText(context, "resolution", "720p")));
        payload.put("aspect_ratio", normalizeAspectRatio(parameterText(context, "size", "adaptive")));
        payload.put("generate_audio", true);
        payload.put("content_filter", true);
        log.info("创建Evolink视频任务: taskId={}, model={}", context.task().getId(), context.model());
        return aiHttpClient.sendJsonRequest(context.channel(), "POST", VIDEO_GENERATION_PATH, payload)
                .map(AiJsonUtils::responsePayload)
                .flatMap(created -> {
                    String providerTaskId = created.getString("id");
                    if (!StringUtils.hasText(providerTaskId)) {
                        return Mono.error(new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "Evolink接口没有返回任务ID"));
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
                    if (Boolean.TRUE.equals(cancelled)) return Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "任务已取消"));
                    return aiHttpClient.sendJsonRequest(context.channel(), "GET", TASK_PATH_PREFIX + providerTaskId, null)
                            .map(AiJsonUtils::responsePayload)
                            .flatMap(response -> {
                                String status = AiTaskParameterReader.firstNonEmpty(response.getString("status")).toLowerCase(Locale.ROOT);
                                return context.updateRunningProgress(Math.min(95, 10 + attempt)).then(Mono.defer(() -> {
                                    if ("completed".equals(status)) return Mono.just(response);
                                    if (PROCESSING_STATUSES.contains(status)) return Mono.empty();
                                    if ("failed".equals(status) || "cancelled".equals(status)) return Mono.error(AiErrorSupport.providerTaskFailure(response, "Evolink视频生成失败"));
                                    return Mono.error(new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "Evolink返回未知任务状态: " + status));
                                }));
                            });
                }))
                .next()
                .switchIfEmpty(Mono.error(AiErrorSupport.providerPollingTimeout("Evolink视频生成超时，请稍后重试")));
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
        if (!StringUtils.hasText(resultUrl)) return Mono.error(new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "Evolink任务完成但没有返回视频URL"));
        return aiHttpClient.downloadRemoteBinary(resultUrl, "video/mp4")
                .flatMap(binary -> mediaSupport.storeGeneratedMedia(context.task().getUserId(), AiTaskTypes.VIDEO, "generated-evolink-video.mp4", binary, null, null, null))
                .map(media -> AiJsonUtils.jsonObject(Map.of("item", media, "providerTaskId", providerTaskId)));
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
        throw new BusinessException(ErrorCode.PARAM_INVALID, "Evolink视频清晰度仅支持480p、720p、1080p");
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
            if (width <= 0 || height <= 0) throw new BusinessException(ErrorCode.PARAM_INVALID, "Evolink视频尺寸必须为正数");
            double ratio = width / height;
            return Set.of("16:9", "9:16", "1:1", "4:3", "3:4", "21:9").stream()
                    .min(java.util.Comparator.comparingDouble(candidate -> Math.abs(ratio - ratioValue(candidate))))
                    .orElseThrow();
        }
        throw new BusinessException(ErrorCode.PARAM_INVALID, "Evolink视频比例不支持: " + value);
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
}

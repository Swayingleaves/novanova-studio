package com.novanovastudio.ai.provider;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.TypeReference;
import com.novanovastudio.ai.AiErrorSupport;
import com.novanovastudio.ai.AiHttpClient;
import com.novanovastudio.ai.AiJsonUtils;
import com.novanovastudio.ai.AiMediaSupport;
import com.novanovastudio.ai.AiProviderAdapter;
import com.novanovastudio.ai.AiTaskExecutionContext;
import com.novanovastudio.ai.AiTaskParameterReader;
import com.novanovastudio.ai.AiTaskPollingSupport;
import com.novanovastudio.ai.AiTaskTypes;
import com.novanovastudio.ai.MultipartPart;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.dto.AiTaskDtos;
import java.net.URI;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * New API 图片和视频渠道适配器。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-08-12 11:00
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class NewApiProviderAdapter implements AiProviderAdapter {

    /** 视频创建接口路径。 */
    private static final String VIDEO_GENERATION_PATH = "/video/generations";
    /** 视频任务最大轮询次数。 */
    private static final int MAXIMUM_POLLING_ATTEMPTS = 120;
    /** 最大参考图片数量。 */
    private static final int MAXIMUM_REFERENCE_IMAGE_COUNT = 9;
    /** 最大参考视频数量。 */
    private static final int MAXIMUM_REFERENCE_VIDEO_COUNT = 3;
    /** 继续轮询的任务状态。 */
    private static final Set<String> PROCESSING_STATUSES = Set.of(
            "not_start", "submitted", "queued", "in_progress", "processing", "pending", "running");
    /** 失败任务状态。 */
    private static final Set<String> FAILURE_STATUSES = Set.of(
            "failed", "failure", "cancelled", "canceled", "expired", "unknown");
    /** 支持的输出比例。 */
    private static final List<String> SUPPORTED_ASPECT_RATIOS = List.of("16:9", "9:16", "4:3", "3:4", "1:1", "21:9");

    /** AI HTTP客户端。 */
    private final AiHttpClient aiHttpClient;
    /** AI媒体支持能力。 */
    private final AiMediaSupport mediaSupport;
    /** 服务配置。 */
    private final NovanovaProperties properties;

    /**
     * 获取渠道调用格式。
     *
     * @return String New API渠道格式
     */
    @Override
    public String apiFormat() {
        return "newapi";
    }

    /**
     * 判断当前渠道是否支持任务类型。
     *
     * @param taskType String 任务类型
     * @return boolean 是否支持图片或视频任务
     */
    @Override
    public boolean supports(String taskType) {
        return AiTaskTypes.IMAGE.equals(taskType) || AiTaskTypes.VIDEO.equals(taskType);
    }

    /**
     * 执行New API生成任务。
     *
     * @param context AiTaskExecutionContext 当前任务上下文
     * @return Mono<JSONObject> 任务媒体结果
     */
    @Override
    public Mono<JSONObject> execute(AiTaskExecutionContext context) {
        return switch (context.task().getTaskType()) {
            case AiTaskTypes.IMAGE -> executeImageTask(context);
            case AiTaskTypes.VIDEO -> executeVideoTask(context);
            default -> Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "New API渠道仅支持图片和视频任务"));
        };
    }

    /**
     * 执行图片生成或编辑任务。
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
        payload.put("n", AiTaskParameterReader.intParameter(context.request().parameters(), "count", 1, 1, 10));
        payload.put("response_format", "url");
        payload.put("output_format", "png");
        AiTaskParameterReader.putNonAuto(payload, context.request().parameters(), "quality");
        putImageSize(payload, context.request().parameters());
        return aiHttpClient.sendJsonRequest(context.channel(), "POST", "/images/generations", com.novanovastudio.ai.AiRequestBodySupport.mergeCustomBodyParameters(payload, context.customBodyParameters()))
                .flatMap(response -> storeImageItems(context, AiJsonUtils.responseArrayPayload(response, "data")));
    }

    /**
     * 执行带参考图片的图片编辑任务。
     *
     * @param context AiTaskExecutionContext 当前任务上下文
     * @return Mono<JSONObject> 图片结果
     */
    private Mono<JSONObject> executeImageEditTask(AiTaskExecutionContext context) {
        return Flux.fromIterable(AiTaskParameterReader.safeReferences(context.request().references()))
                .index()
                .concatMap(tuple -> mediaSupport.resolveReferenceBinary(context.task().getUserId(), tuple.getT2(), "image/png")
                        .map(binary -> aiHttpClient.filePart("image", AiTaskParameterReader.firstNonEmpty(tuple.getT2().name(),
                                "reference-" + (tuple.getT1() + 1) + "." + mediaSupport.fileExtension(binary.mimeType(), "png")), binary.mimeType(), binary.data())))
                .collectList()
                .flatMap(fileParts -> {
                    List<MultipartPart> parts = new ArrayList<>();
                    parts.add(aiHttpClient.formPart("model", context.model()));
                    parts.add(aiHttpClient.formPart("prompt", context.request().prompt()));
                    parts.add(aiHttpClient.formPart("n", String.valueOf(AiTaskParameterReader.intParameter(context.request().parameters(), "count", 1, 1, 10))));
                    parts.add(aiHttpClient.formPart("response_format", "url"));
                    parts.add(aiHttpClient.formPart("output_format", "png"));
                    String quality = AiTaskParameterReader.stringParameter(context.request().parameters(), "quality", "");
                    if (StringUtils.hasText(quality) && !"auto".equalsIgnoreCase(quality)) parts.add(aiHttpClient.formPart("quality", quality));
                    String imageSize = normalizeImageSize(context.request().parameters());
                    if (StringUtils.hasText(imageSize)) parts.add(aiHttpClient.formPart("size", imageSize));
                    parts.addAll(fileParts);
                    return aiHttpClient.sendMultipartRequest(context.channel(), "/images/edits", "----NovanovaNewApiImageBoundary" + UUID.randomUUID(), parts);
                })
                .flatMap(response -> storeImageItems(context, AiJsonUtils.responseArrayPayload(response, "data")));
    }

    /**
     * 执行异步视频生成任务。
     *
     * @param context AiTaskExecutionContext 当前任务上下文
     * @return Mono<JSONObject> 视频结果
     */
    private Mono<JSONObject> executeVideoTask(AiTaskExecutionContext context) {
        List<AiTaskDtos.AiTaskMediaReference> imageReferences = AiTaskParameterReader.safeReferences(context.request().references());
        List<AiTaskDtos.AiTaskMediaReference> videoReferences = AiTaskParameterReader.safeReferences(context.request().videoReferences());
        if (imageReferences.size() > MAXIMUM_REFERENCE_IMAGE_COUNT || videoReferences.size() > MAXIMUM_REFERENCE_VIDEO_COUNT) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "New API最多支持9张参考图和3个参考视频"));
        }
        return Mono.zip(resolveReferenceUrls(context, imageReferences), resolveReferenceUrls(context, videoReferences))
                .flatMap(urls -> createVideoTask(context, urls.getT1(), urls.getT2()));
    }

    /**
     * 解析参考媒体URL。
     *
     * @param context AiTaskExecutionContext 当前任务上下文
     * @param references List<AiTaskMediaReference> 参考媒体列表
     * @return Mono<List<String>> 可供渠道访问的URL列表
     */
    private Mono<List<String>> resolveReferenceUrls(AiTaskExecutionContext context, List<AiTaskDtos.AiTaskMediaReference> references) {
        return Flux.fromIterable(references)
                .concatMap(reference -> mediaSupport.resolveReferenceUrl(context.task().getUserId(), reference))
                .collectList();
    }

    /**
     * 提交视频任务并等待完成。
     *
     * @param context AiTaskExecutionContext 当前任务上下文
     * @param imageUrls List<String> 参考图片URL
     * @param videoUrls List<String> 参考视频URL
     * @return Mono<JSONObject> 视频结果
     */
    private Mono<JSONObject> createVideoTask(AiTaskExecutionContext context, List<String> imageUrls, List<String> videoUrls) {
        Map<String, Object> payload = buildVideoRequestPayload(context.model(), context.request().prompt(), context.request().parameters(), imageUrls, videoUrls);
        log.info("创建New API视频任务: taskId={}, model={}, imageCount={}, videoCount={}", context.task().getId(), context.model(), imageUrls.size(), videoUrls.size());
        return aiHttpClient.sendJsonRequest(context.channel(), "POST", VIDEO_GENERATION_PATH, com.novanovastudio.ai.AiRequestBodySupport.mergeCustomBodyParameters(payload, context.customBodyParameters()))
                .map(AiJsonUtils::responsePayload)
                .flatMap(created -> {
                    String providerTaskId = AiTaskParameterReader.firstNonEmpty(created.getString("id"), created.getString("task_id"));
                    if (!StringUtils.hasText(providerTaskId)) {
                        return Mono.error(new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "New API视频接口没有返回任务ID"));
                    }
                    return context.updateRunningProgress(10)
                            .then(pollVideoTask(context, providerTaskId))
                            .flatMap(finished -> storeVideoResult(context, providerTaskId, finished));
                });
    }

    /**
     * 轮询视频任务直到完成。
     *
     * @param context AiTaskExecutionContext 当前任务上下文
     * @param providerTaskId String 渠道任务ID
     * @return Mono<JSONObject> 成功任务响应
     */
    private Mono<JSONObject> pollVideoTask(AiTaskExecutionContext context, String providerTaskId) {
        String taskPath = VIDEO_GENERATION_PATH + "/" + providerTaskId;
        Duration pollingInterval = AiTaskPollingSupport.pollingInterval(properties);
        return Flux.range(0, MAXIMUM_POLLING_ATTEMPTS)
                .concatMap(attempt -> Mono.delay(pollingInterval)
                        .then(context.isCancelRequested())
                        .flatMap(cancelled -> {
                            if (Boolean.TRUE.equals(cancelled)) return Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "任务已取消"));
                            return aiHttpClient.sendJsonRequest(context.channel(), "GET", taskPath, null)
                                    .map(NewApiProviderAdapter::responseTaskPayload)
                                    .flatMap(response -> processVideoTaskStatus(context, response, attempt));
                        }))
                .next()
                .switchIfEmpty(Mono.error(AiErrorSupport.providerPollingTimeout("New API视频生成超时，请稍后重试")));
    }

    /**
     * 读取New API视频查询的任务载荷。
     * <p>
     * New API部分渠道会将任务详情包装为data.data，外层data仅保留平台任务记录。
     *
     * @param response JSONObject 查询响应
     * @return JSONObject 实际视频任务载荷
     */
    static JSONObject responseTaskPayload(JSONObject response) {
        JSONObject payload = AiJsonUtils.responsePayload(response);
        JSONObject task = payload.getJSONObject("data");
        String taskStatus = task == null ? "" : task.getString("status");
        return StringUtils.hasText(taskStatus) ? task : payload;
    }

    /**
     * 处理一次视频任务查询响应。
     *
     * @param context AiTaskExecutionContext 当前任务上下文
     * @param response JSONObject 渠道任务响应
     * @param attempt int 当前轮询次数
     * @return Mono<JSONObject> 完成时返回响应，处理中返回空信号
     */
    private Mono<JSONObject> processVideoTaskStatus(AiTaskExecutionContext context, JSONObject response, int attempt) {
        String status = AiTaskParameterReader.firstNonEmpty(response.getString("status")).toLowerCase(Locale.ROOT);
        int progress = parseProgress(response, Math.min(95, 10 + attempt));
        return context.updateRunningProgress(Math.max(10, Math.min(95, progress))).then(Mono.defer(() -> {
            if (Set.of("completed", "success", "succeeded", "done").contains(status)) return Mono.just(response);
            if (PROCESSING_STATUSES.contains(status)) return Mono.empty();
            if (FAILURE_STATUSES.contains(status)) return Mono.error(AiErrorSupport.providerTaskFailure(response, "New API视频生成失败"));
            return Mono.error(new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "New API返回未知任务状态: " + status));
        }));
    }

    /**
     * 读取New API任务进度，兼容数字和带百分号的字符串。
     *
     * @param response JSONObject 查询响应
     * @param fallback int 无法读取时的回退进度
     * @return int 任务进度
     */
    static int parseProgress(JSONObject response, int fallback) {
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
     * 登记完成视频的远程地址。
     *
     * @param context AiTaskExecutionContext 当前任务上下文
     * @param providerTaskId String 渠道任务ID
     * @param response JSONObject 完成任务响应
     * @return Mono<JSONObject> 视频结果
     */
    private Mono<JSONObject> storeVideoResult(AiTaskExecutionContext context, String providerTaskId, JSONObject response) {
        String resultUrl = resolveVideoResultUrl(readVideoResultUrl(response), context.channel().baseUrl());
        if (!mediaSupport.isHttpUrl(resultUrl)) {
            return Mono.error(new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "New API任务完成但没有返回视频地址"));
        }
        Integer durationMilliseconds = parseDurationMilliseconds(response.getString("seconds"));
        return mediaSupport.registerGeneratedMediaUrl(context.task().getUserId(), AiTaskTypes.VIDEO, resultUrl, "video/mp4", null, null, durationMilliseconds)
                .map(media -> AiJsonUtils.jsonObject(Map.of("item", media, "providerTaskId", providerTaskId)));
    }

    /**
     * 构建New API视频提交请求体。
     *
     * @param model String 模型名称
     * @param prompt String 视频提示词
     * @param parameters Map<String, Object> 页面视频参数
     * @param imageUrls List<String> 参考图片URL
     * @param videoUrls List<String> 参考视频URL
     * @return Map<String, Object> 渠道请求体
     */
    static Map<String, Object> buildVideoRequestPayload(String model, String prompt, Map<String, Object> parameters, List<String> imageUrls, List<String> videoUrls) {
        int duration = AiTaskParameterReader.intParameter(parameters, "seconds", 5, 1, 15);
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("model", model);
        payload.put("prompt", prompt);
        payload.put("duration", duration);
        payload.put("seconds", String.valueOf(duration));
        payload.put("resolution", normalizeVideoResolution(AiTaskParameterReader.parameterText(parameters, "resolution", "720p")));
        String size = AiTaskParameterReader.parameterText(parameters, "size", "");
        if (size.matches("^\\d+x\\d+$")) payload.put("size", size);
        if (!imageUrls.isEmpty()) {
            payload.put("images", imageUrls);
            payload.put("image", imageUrls.getFirst());
            payload.put("input_reference", imageUrls.getFirst());
        }
        Map<String, Object> metadata = new LinkedHashMap<>();
        metadata.put("aspect_ratio", normalizeAspectRatio(size));
        Boolean watermark = booleanParameter(parameters, "watermark");
        if (watermark != null) metadata.put("watermark", watermark);
        if (!imageUrls.isEmpty()) metadata.put("reference_images", imageUrls);
        if (!videoUrls.isEmpty()) metadata.put("reference_videos", videoUrls);
        if (!metadata.isEmpty()) payload.put("metadata", metadata);
        return payload;
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
     * 写入图片像素尺寸。
     *
     * @param payload Map<String, Object> 请求体
     * @param parameters Map<String, Object> 图片参数
     * @return void 无返回值
     */
    private static void putImageSize(Map<String, Object> payload, Map<String, Object> parameters) {
        String imageSize = normalizeImageSize(parameters);
        if (StringUtils.hasText(imageSize)) payload.put("size", imageSize);
    }

    /**
     * 规范化图片比例或尺寸。
     *
     * @param parameters Map<String, Object> 图片参数
     * @return String 像素尺寸
     */
    private static String normalizeImageSize(Map<String, Object> parameters) {
        String size = AiTaskParameterReader.parameterText(parameters, "size", "").trim();
        if (!StringUtils.hasText(size) || "auto".equalsIgnoreCase(size)) return "";
        if (size.matches("^\\d+x\\d+$")) return size;
        int longSide = switch (AiTaskParameterReader.parameterText(parameters, "resolution", "2K").trim().toLowerCase(Locale.ROOT)) {
            case "1k" -> 1024;
            case "2k" -> 2048;
            case "4k" -> 4096;
            default -> throw new BusinessException(ErrorCode.PARAM_INVALID, "图片清晰度只支持1K、2K、4K");
        };
        String[] ratio = size.split(":");
        if (ratio.length != 2) throw new BusinessException(ErrorCode.PARAM_INVALID, "图片比例必须是正数，例如9:16");
        try {
            double width = Double.parseDouble(ratio[0]);
            double height = Double.parseDouble(ratio[1]);
            if (!Double.isFinite(width) || !Double.isFinite(height) || width <= 0 || height <= 0) throw new NumberFormatException();
            boolean landscape = width >= height;
            int shortSide = Math.max(16, (int) (Math.round(longSide / (landscape ? width / height : height / width) / 16) * 16));
            return landscape ? longSide + "x" + shortSide : shortSide + "x" + longSide;
        } catch (NumberFormatException exception) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "图片比例必须是正数，例如9:16");
        }
    }

    /**
     * 规范化视频分辨率。
     *
     * @param value String 原始分辨率
     * @return String New API分辨率
     */
    private static String normalizeVideoResolution(String value) {
        String resolution = value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
        if ("low".equals(resolution)) return "480p";
        if (resolution.isEmpty() || "auto".equals(resolution) || "medium".equals(resolution) || "high".equals(resolution)) return "720p";
        return resolution.endsWith("p") ? resolution : resolution + "p";
    }

    /**
     * 规范化视频输出比例。
     *
     * @param value String 页面尺寸或比例
     * @return String New API支持的比例
     */
    static String normalizeAspectRatio(String value) {
        String normalized = value == null ? "" : value.trim().replace(" ", "");
        if (SUPPORTED_ASPECT_RATIOS.contains(normalized)) return normalized;
        if (!normalized.matches("^\\d+x\\d+$")) return "16:9";
        String[] dimensions = normalized.split("x");
        try {
            double ratio = Double.parseDouble(dimensions[0]) / Double.parseDouble(dimensions[1]);
            return SUPPORTED_ASPECT_RATIOS.stream().min(java.util.Comparator.comparingDouble(candidate -> Math.abs(ratio - ratioValue(candidate)))).orElse("16:9");
        } catch (NumberFormatException exception) {
            return "16:9";
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
     * 读取完成视频地址。
     *
     * @param response JSONObject 完成任务响应
     * @return String 视频URL
     */
    static String readVideoResultUrl(JSONObject response) {
        if (response == null) return "";
        JSONObject metadata = response.getJSONObject("metadata");
        String metadataUrl = metadata == null ? "" : metadata.getString("url");
        if (StringUtils.hasText(metadataUrl)) return metadataUrl;
        String directUrl = AiTaskParameterReader.firstNonEmpty(
                response.getString("result_url"), response.getString("url"), response.getString("video_url"));
        if (StringUtils.hasText(directUrl)) return directUrl;
        JSONObject data = response.getJSONObject("data");
        JSONObject video = data == null ? null : data.getJSONObject("video");
        return video == null ? "" : AiTaskParameterReader.firstNonEmpty(video.getString("url"));
    }

    /**
     * 将New API返回的视频相对路径转换为可访问的完整地址。
     *
     * @param resultUrl String 渠道返回的视频地址
     * @param baseUrl String 渠道基础地址
     * @return String 可访问的视频地址
     */
    static String resolveVideoResultUrl(String resultUrl, String baseUrl) {
        if (!StringUtils.hasText(resultUrl) || !resultUrl.trim().startsWith("/")) return resultUrl;
        try {
            URI base = URI.create(baseUrl == null ? "" : baseUrl.trim());
            if (!StringUtils.hasText(base.getScheme()) || !StringUtils.hasText(base.getRawAuthority())) return resultUrl;
            return base.getScheme() + "://" + base.getRawAuthority() + resultUrl.trim();
        } catch (IllegalArgumentException exception) {
            return resultUrl;
        }
    }

    /**
     * 读取视频秒数并转换为毫秒。
     *
     * @param value String 视频秒数
     * @return Integer 视频时长毫秒，无法解析时返回null
     */
    private static Integer parseDurationMilliseconds(String value) {
        try {
            int seconds = Integer.parseInt(value);
            return seconds > 0 ? seconds * 1000 : null;
        } catch (NumberFormatException exception) {
            return null;
        }
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
}

package com.novanovastudio.ai.provider;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.TypeReference;
import com.novanovastudio.ai.*;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.config.NovanovaProperties;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.Map;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * @author zhenglin.cn.cq@gmail.com
 * @title AgnesProviderAdapter.java
 * @description Agnes AI渠道适配器
 * @createTime 2026-06-24 20:35:00
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class AgnesProviderAdapter implements AiProviderAdapter {

    /**
     * Agnes视频模型
     */
    private static final String AGNES_VIDEO_MODEL = "Agnes-Video-V2.0";

    /**
     * Agnes 视频关键帧允许的最大参考图片数量
     */
    private static final int AGNES_VIDEO_KEYFRAME_MAX_REFERENCE_IMAGE_COUNT = 3;

    /**
     * Agnes 视频参考图片超过关键帧上限时的错误信息
     */
    private static final String AGNES_VIDEO_REFERENCE_IMAGE_LIMIT_MESSAGE = "Agnes 视频最多支持3张参考图片，请调整镜头资产关联或切换视频模型";

    /**
     * AI HTTP客户端
     */
    private final AiHttpClient aiHttpClient;

    /**
     * AI媒体支持
     */
    private final AiMediaSupport mediaSupport;

    /** 服务配置 */
    private final NovanovaProperties properties;

    /**
     * 获取渠道调用格式
     *
     * @return String 渠道调用格式
     */
    @Override
    public String apiFormat() {
        return "agnes";
    }

    /**
     * 判断当前适配器是否支持任务类型
     *
     * @param taskType String 任务类型
     * @return boolean 是否支持
     */
    @Override
    public boolean supports(String taskType) {
        return List.of(AiTaskTypes.TEXT, AiTaskTypes.IMAGE, AiTaskTypes.VIDEO).contains(taskType);
    }

    /**
     * 执行Agnes AI任务
     *
     * @param context AiTaskExecutionContext AI任务执行上下文
     * @return Mono<JSONObject> 任务结果JSON
     */
    @Override
    public Mono<JSONObject> execute(AiTaskExecutionContext context) {
        return switch (context.task().getTaskType()) {
            case AiTaskTypes.TEXT -> executeTextTask(context);
            case AiTaskTypes.IMAGE -> executeImageTask(context);
            case AiTaskTypes.VIDEO -> executeVideoTask(context);
            default ->
                    Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "Agnes 调用格式暂不支持" + context.task().getTaskType() + "任务"));
        };
    }

    /**
     * 执行Agnes文本对话任务
     * <p>
     * 通过OpenAI兼容的Chat Completions接口以流式方式调用Agnes-2.0-Flash模型，
     * 逐片段推送增量文本到前端，并在流结束后返回完整文本内容。支持图片理解输入。
     *
     * @param context AiTaskExecutionContext AI任务执行上下文
     * @return Mono<JSONObject> 文本结果，结构为 {"content": "完整文本"}
     */
    private Mono<JSONObject> executeTextTask(AiTaskExecutionContext context) {
        // 解析参考图片URL，用于图片理解输入。
        return Flux.fromIterable(AiTaskParameterReader.safeReferences(context.request().references()))
                .concatMap(reference -> mediaSupport.resolveReferenceUrl(context.task().getUserId(), reference))
                .collectList()
                .flatMap(referenceImages -> {
                    // 构建OpenAI兼容Chat Completions消息，有参考图时使用多模态内容数组。
                    List<Map<String, Object>> messages = List.of(buildAgnesChatMessage(context.request().prompt(), referenceImages));
                    Map<String, Object> payload = new java.util.LinkedHashMap<>();
                    payload.put("model", context.model());
                    payload.put("messages", messages);
                    payload.put("stream", true);
                    // 建立连接前上报进度10%，表示任务已开始进入流式调用阶段。
                    return context.updateRunningProgress(10)
                            .thenMany(aiHttpClient.sendStreamingJsonRequest(context.channel(), "/chat/completions", payload))
                            .index()
                            .concatMap(tuple -> {
                                long index = tuple.getT1();
                                String data = tuple.getT2();
                                return context.isCancelRequested().flatMap(cancelRequested -> {
                                    if (Boolean.TRUE.equals(cancelRequested)) {
                                        return Mono.<String>error(new BusinessException(ErrorCode.BUSINESS_ERROR, "任务已取消"));
                                    }
                                    return Mono.fromCallable(() -> parseAgnesChatDelta(data));
                                }).flatMap(delta -> {
                                    // 首个delta到达时上报运行进度50%，并在推送前将进度与增量文本串联执行。
                                    Mono<Void> progress = index == 0 ? context.updateRunningProgress(50) : Mono.empty();
                                    return progress.then(context.emitTextDelta(delta)).thenReturn(delta);
                                });
                            })
                            .collectList()
                            .map(deltas -> AiJsonUtils.jsonObject(Map.of("content", String.join("", deltas))));
                });
    }

    /**
     * 构建Agnes对话消息
     *
     * @param prompt          String 文本提示词
     * @param referenceImages List<String> 参考图片URL列表
     * @return Map<String, Object> 消息对象
     */
    private Map<String, Object> buildAgnesChatMessage(String prompt, List<String> referenceImages) {
        // 无参考图时使用纯文本消息，有参考图时构建多模态内容数组。
        if (referenceImages.isEmpty()) {
            return Map.of("role", "user", "content", prompt);
        }
        List<Map<String, Object>> contentParts = new java.util.ArrayList<>();
        contentParts.add(Map.of("type", "text", "text", prompt));
        for (String imageUrl : referenceImages) {
            contentParts.add(Map.of("type", "image_url", "image_url", Map.of("url", imageUrl)));
        }
        return Map.of("role", "user", "content", contentParts);
    }

    /**
     * 解析Agnes对话流式增量文本
     *
     * @param data String SSE数据行JSON文本
     * @return String 增量文本片段，无内容时返回空字符串
     */
    private String parseAgnesChatDelta(String data) {
        // 流结束标记直接返回空字符串。
        if ("[DONE]".equals(data)) {
            return "";
        }
        JSONObject chunk = JSON.parseObject(data);
        JSONArray choices = chunk.getJSONArray("choices");
        if (choices == null || choices.isEmpty()) {
            return "";
        }
        JSONObject delta = choices.getJSONObject(0).getJSONObject("delta");
        if (delta == null) {
            return "";
        }
        String content = delta.getString("content");
        return content == null ? "" : content;
    }

    /**
     * 执行Agnes图片任务
     *
     * @param context AiTaskExecutionContext AI任务执行上下文
     * @return Mono<JSONObject> 图片结果
     */
    private Mono<JSONObject> executeImageTask(AiTaskExecutionContext context) {
        return Flux.fromIterable(AiTaskParameterReader.safeReferences(context.request().references()))
                .concatMap(reference -> mediaSupport.resolveReferenceUrl(context.task().getUserId(), reference))
                .collectList()
                .flatMap(referenceImages -> {
                    int count = AiTaskParameterReader.intParameter(context.request().parameters(), "count", 1, 1, 10);
                    return Flux.range(0, count)
                            .concatMap(index -> createAgnesImageOnce(context, referenceImages))
                            .flatMapIterable(items -> items)
                            .collectList()
                            .map(items -> AiJsonUtils.jsonObject(Map.of("items", items)));
                });
    }

    /**
     * 执行单次Agnes图片请求
     *
     * @param context         AiTaskExecutionContext AI任务执行上下文
     * @param referenceImages List<String> 参考图片URL列表
     * @return Mono<List<Map<String, Object>>> 媒体响应列表
     */
    private Mono<List<Map<String, Object>>> createAgnesImageOnce(AiTaskExecutionContext context, List<String> referenceImages) {
        Map<String, Object> extraBody = new java.util.LinkedHashMap<>();
        if (!referenceImages.isEmpty()) {
            extraBody.put("image", referenceImages);
        }
        extraBody.put("response_format", "url");
        Map<String, Object> payload = new java.util.LinkedHashMap<>();
        payload.put("model", context.model());
        payload.put("prompt", context.request().prompt());
        payload.put("size", resolveAgnesRequestSize(context));
        AiTaskParameterReader.putNonAuto(payload, context.request().parameters(), "quality");
        payload.put("extra_body", extraBody);
        return aiHttpClient.sendJsonRequest(context.channel(), "POST", "/images/generations", payload)
                .flatMap(response -> {
                    JSONArray data = AiJsonUtils.responseArrayPayload(response, "data");
                    if (data == null || data.isEmpty()) {
                        return Mono.error(new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "Agnes 图片接口没有返回图片"));
                    }
                    return Flux.fromIterable(data)
                            .concatMap(itemObject -> {
                                JSONObject item = JSON.parseObject(JSON.toJSONString(itemObject));
                                return mediaSupport.storeGeneratedImageItem(context.task().getUserId(), item, null, null, 0)
                                        .map(media -> JSON.parseObject(JSON.toJSONString(media), new TypeReference<Map<String, Object>>() {
                                        }));
                            })
                            .collectList();
                });
    }

    /**
     * 执行Agnes视频任务
     *
     * @param context AiTaskExecutionContext AI任务执行上下文
     * @return Mono<JSONObject> 视频结果
     */
    private Mono<JSONObject> executeVideoTask(AiTaskExecutionContext context) {
        if (!AGNES_VIDEO_MODEL.equalsIgnoreCase(context.model())) {
            return Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "Agnes 视频调用格式当前仅支持 " + AGNES_VIDEO_MODEL));
        }
        if (!AiTaskParameterReader.safeReferences(context.request().videoReferences()).isEmpty()) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "Agnes 调用格式暂不支持参考视频，请移除参考素材"));
        }
        var imageReferences = AiTaskParameterReader.safeReferences(context.request().references());
        if (imageReferences.size() > AGNES_VIDEO_KEYFRAME_MAX_REFERENCE_IMAGE_COUNT) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, AGNES_VIDEO_REFERENCE_IMAGE_LIMIT_MESSAGE));
        }
        return Flux.fromIterable(imageReferences)
                .concatMap(reference -> mediaSupport.resolveReferenceUrl(context.task().getUserId(), reference))
                .collectList()
                .flatMap(referenceUrls -> {
                    AgnesVideoDimensions dimensions = agnesVideoDimensions(AiTaskParameterReader.parameterText(context.request().parameters(), "size", "16:9"), AiTaskParameterReader.parameterText(context.request().parameters(), "resolution", "720p"));
                    AgnesVideoTiming timing = agnesVideoTiming(AiTaskParameterReader.parameterText(context.request().parameters(), "seconds", "5"), dimensions.resolution());
                    Map<String, Object> payload = new java.util.LinkedHashMap<>();
                    payload.put("model", context.model());
                    payload.put("prompt", context.request().prompt());
                    payload.put("width", dimensions.width());
                    payload.put("height", dimensions.height());
                    payload.put("num_frames", timing.numFrames());
                    payload.put("frame_rate", timing.frameRate());
                    applyAgnesVideoReferenceImages(payload, referenceUrls);
                    log.info("创建Agnes视频任务: taskId={}, width={}, height={}, frames={}, frameRate={}", context.task().getId(), dimensions.width(), dimensions.height(), timing.numFrames(), timing.frameRate());
                    return aiHttpClient.sendJsonRequest(context.channel(), "POST", "/videos", payload);
                })
                .flatMap(created -> {
                    JSONObject payload = agnesObjectPayload(created);
                    String videoId = AiTaskParameterReader.firstNonEmpty(payload.getString("video_id"));
                    String providerTaskId = AiTaskParameterReader.firstNonEmpty(payload.getString("task_id"), payload.getString("id"), videoId);
                    if (!StringUtils.hasText(videoId)) {
                        return Mono.error(new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "Agnes 接口没有返回 video_id"));
                    }
                    return context.updateRunningProgress(20)
                            .then(pollAgnesVideoTask(context, videoId))
                            .flatMap(finished -> {
                                log.info("Agnes 视频任务完成: taskId={}, videoId={}, result={}", context.task().getId(), videoId, finished);
                                // Agnes 不同场景返回格式不同：有的顶层 url，有的放 remixed_from_video_id
                                String resultUrl = AiTaskParameterReader.firstNonEmpty(
                                        finished.getString("url"),
                                        finished.getString("remixed_from_video_id")
                                );
                                if (!StringUtils.hasText(resultUrl)) {
                                    return Mono.error(new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "Agnes 任务成功但没有返回视频 URL"));
                                }
                                // 由服务端将 AI 渠道返回的地址登记为受信任媒体，避免浏览器读取内网结果地址。
                                return mediaSupport.registerGeneratedMediaUrl(context.task().getUserId(), AiTaskTypes.VIDEO, resultUrl,
                                                "video/mp4", null, null, null)
                                        .map(media -> AiJsonUtils.jsonObject(Map.of(
                                                "item", media,
                                                "providerTaskId", providerTaskId
                                        )));
                            });
                });
    }

    /**
     * 根据参考图片数量写入 Agnes 视频请求参数。
     *
     * @param payload Map<String, Object> Agnes 视频请求载荷
     * @param referenceUrls List<String> 保持关联顺序的参考图片公网地址
     * @throws BusinessException 当参考图片超过 Agnes 关键帧上限时抛出
     */
    private static void applyAgnesVideoReferenceImages(Map<String, Object> payload, List<String> referenceUrls) {
        if (referenceUrls.size() > AGNES_VIDEO_KEYFRAME_MAX_REFERENCE_IMAGE_COUNT) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, AGNES_VIDEO_REFERENCE_IMAGE_LIMIT_MESSAGE);
        }
        if (referenceUrls.size() == 1) {
            payload.put("image", referenceUrls.get(0));
            return;
        }
        if (referenceUrls.size() > 1) {
            Map<String, Object> extraBody = new java.util.LinkedHashMap<>();
            extraBody.put("mode", "keyframes");
            extraBody.put("image", referenceUrls);
            payload.put("extra_body", extraBody);
        }
    }

    /**
     * 轮询Agnes视频任务
     *
     * @param context AiTaskExecutionContext AI任务执行上下文
     * @param videoId String Agnes视频ID
     * @return Mono<JSONObject> Agnes任务状态
     */
    private Mono<JSONObject> pollAgnesVideoTask(AiTaskExecutionContext context, String videoId) {
        Duration pollingInterval = AiTaskPollingSupport.pollingInterval(properties);
        return Flux.range(0, 120)
                .concatMap(attempt -> Mono.delay(pollingInterval)
                        .then(context.isCancelRequested())
                        .flatMap(cancelRequested -> {
                            if (Boolean.TRUE.equals(cancelRequested)) {
                                return Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "任务已取消"));
                            }
                            String requestUrl = agnesQueryUrl(context.channel().baseUrl(), videoId, context.model());
                            log.debug("Agnes视频轮询第{}次: videoId={}, url={}", attempt + 1, videoId, requestUrl);
                            return aiHttpClient.sendBearerJsonUrlRequest(context.channel(), "GET", requestUrl, null)
                                    .map(this::agnesObjectPayload)
                                    .flatMap(response -> {
                                        log.debug("Agnes视频轮询第{}次响应: videoId={}, response={}", attempt + 1, videoId, response);
                                        String status = AiTaskParameterReader.firstNonEmpty(response.getString("status")).toLowerCase();
                                        // 优先使用API返回的实时进度，没有时按轮询次数估算。
                                        int apiProgress = response.getIntValue("progress", -1);
                                        int progress = apiProgress >= 0 ? Math.min(99, apiProgress) : Math.min(95, 20 + attempt);
                                        return context.updateRunningProgress(progress).then(Mono.defer(() -> {
                                            if ("completed".equals(status)) {
                                                return Mono.just(response);
                                            }
                                            if ("failed".equals(status)) {
                                                String message = agnesErrorMessage(response);
                                                return Mono.error(AiErrorSupport.providerTaskFailure(response,
                                                        AiTaskParameterReader.firstNonEmpty(message, "Agnes 视频生成失败")));
                                            }
                                            return Mono.empty();
                                        }));
                                    });
                        }))
                .next()
                .switchIfEmpty(Mono.error(AiErrorSupport.providerPollingTimeout(
                        "Agnes 视频生成超时，请稍后重试")));
    }

    /**
     * 解析Agnes图片尺寸
     *
     * @param context AiTaskExecutionContext AI任务执行上下文
     * @return String 图片尺寸
     */
    private String resolveAgnesRequestSize(AiTaskExecutionContext context) {
        String size = AiTaskParameterReader.stringParameter(context.request().parameters(), "size", "");
        if (!StringUtils.hasText(size) || "auto".equalsIgnoreCase(size)) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "Agnes 图片接口要求 size 必填，请选择比例或像素尺寸");
        }
        if (size.matches("^\\d+x\\d+$")) {
            return size;
        }
        if (!size.contains(":")) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "Agnes 图片尺寸格式不支持，请使用9:16或1024x1024");
        }
        return resolveImageSize(AiTaskParameterReader.stringParameter(context.request().parameters(), "resolution", "2K"), size);
    }

    /**
     * 按比例解析图片像素尺寸
     *
     * @param resolution String 图片清晰度
     * @param ratio String 图片比例
     * @return String 像素尺寸
     */
    private static String resolveImageSize(String resolution, String ratio) {
        int longSide = switch (resolution.trim().toLowerCase()) {
            case "1k" -> 1024;
            case "2k" -> 2048;
            case "4k" -> 4096;
            default -> throw new BusinessException(ErrorCode.PARAM_INVALID, "图片清晰度只支持1K、2K、4K");
        };
        String[] parts = ratio.split(":");
        if (parts.length != 2) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "图像比例必须是正数，例如 9:16");
        }
        double widthRatio = parsePositiveDouble(parts[0], "图像比例必须是正数，例如 9:16");
        double heightRatio = parsePositiveDouble(parts[1], "图像比例必须是正数，例如 9:16");
        boolean landscape = widthRatio >= heightRatio;
        double longRatio = landscape ? widthRatio / heightRatio : heightRatio / widthRatio;
        int shortSide = Math.max(16, (int) (Math.round(longSide / longRatio / 16) * 16));
        int width = landscape ? longSide : shortSide;
        int height = landscape ? shortSide : longSide;
        return width + "x" + height;
    }

    /**
     * 构建Agnes查询地址
     *
     * @param baseUrl String 基础地址
     * @param videoId String 视频ID
     * @param model   String 模型名称
     * @return String 查询地址
     */
    private String agnesQueryUrl(String baseUrl, String videoId, String model) {
        String normalizedBaseUrl = baseUrl.trim().replaceAll("/+$", "").replaceAll("(?i)/v1$", "");
        String query = "video_id=" + URLEncoder.encode(videoId, StandardCharsets.UTF_8) + "&model_name=" + URLEncoder.encode(model, StandardCharsets.UTF_8);
        return normalizedBaseUrl + "/agnesapi?" + query;
    }

    /**
     * 读取Agnes错误信息
     *
     * @param response JSONObject Agnes响应
     * @return String 错误信息
     */
    private String agnesErrorMessage(JSONObject response) {
        Object error = response.get("error");
        if (error instanceof String message) {
            return message;
        }
        if (error instanceof JSONObject jsonObject) {
            return AiTaskParameterReader.firstNonEmpty(jsonObject.getString("message"));
        }
        return "";
    }

    /**
     * 读取Agnes对象载荷
     *
     * @param response JSONObject 原始响应
     * @return JSONObject 对象载荷
     */
    private JSONObject agnesObjectPayload(JSONObject response) {
        JSONObject payload = AiJsonUtils.responsePayload(response);
        return payload.isEmpty() ? response : payload;
    }

    /**
     * 计算Agnes视频尺寸
     *
     * @param size       String 比例或尺寸
     * @param resolution String 分辨率
     * @return AgnesVideoDimensions 视频尺寸
     */
    private AgnesVideoDimensions agnesVideoDimensions(String size, String resolution) {
        String normalizedResolution = normalizeAgnesVideoResolution(resolution);
        String ratio = normalizeAgnesVideoRatio(size);
        return switch (normalizedResolution + ":" + ratio) {
            case "1080p:9:16" -> new AgnesVideoDimensions(1088, 1920, normalizedResolution);
            case "1080p:1:1" -> new AgnesVideoDimensions(1472, 1472, normalizedResolution);
            case "1080p:4:3" -> new AgnesVideoDimensions(1664, 1216, normalizedResolution);
            case "1080p:3:4" -> new AgnesVideoDimensions(1216, 1664, normalizedResolution);
            case "720p:9:16" -> new AgnesVideoDimensions(704, 1280, normalizedResolution);
            case "720p:1:1" -> new AgnesVideoDimensions(960, 960, normalizedResolution);
            case "720p:4:3" -> new AgnesVideoDimensions(1088, 832, normalizedResolution);
            case "720p:3:4" -> new AgnesVideoDimensions(832, 1088, normalizedResolution);
            case "480p:9:16" -> new AgnesVideoDimensions(480, 832, normalizedResolution);
            case "480p:1:1" -> new AgnesVideoDimensions(640, 640, normalizedResolution);
            case "480p:4:3" -> new AgnesVideoDimensions(704, 512, normalizedResolution);
            case "480p:3:4" -> new AgnesVideoDimensions(512, 704, normalizedResolution);
            case "1080p:16:9" -> new AgnesVideoDimensions(1920, 1088, normalizedResolution);
            case "480p:16:9" -> new AgnesVideoDimensions(832, 480, normalizedResolution);
            default -> new AgnesVideoDimensions(1280, 704, normalizedResolution);
        };
    }

    /**
     * 规范化Agnes视频分辨率
     *
     * @param resolution String 原始分辨率
     * @return String 规范化分辨率
     */
    private String normalizeAgnesVideoResolution(String resolution) {
        if ("1080p".equals(resolution) || "1080".equals(resolution)) {
            return "1080p";
        }
        if ("480p".equals(resolution) || "480".equals(resolution) || "low".equals(resolution)) {
            return "480p";
        }
        return "720p";
    }

    /**
     * 规范化Agnes视频比例
     *
     * @param size String 原始比例或尺寸
     * @return String 规范化比例
     */
    private String normalizeAgnesVideoRatio(String size) {
        if (List.of("16:9", "9:16", "1:1", "4:3", "3:4").contains(size)) {
            return size;
        }
        java.util.regex.Matcher matcher = java.util.regex.Pattern.compile("^(\\d+)x(\\d+)$").matcher(String.valueOf(size));
        if (!matcher.matches()) {
            return "16:9";
        }
        double ratio = Double.parseDouble(matcher.group(1)) / Double.parseDouble(matcher.group(2));
        List<Map.Entry<String, Double>> ratios = List.of(
                Map.entry("16:9", 16.0 / 9.0),
                Map.entry("9:16", 9.0 / 16.0),
                Map.entry("1:1", 1.0),
                Map.entry("4:3", 4.0 / 3.0),
                Map.entry("3:4", 3.0 / 4.0)
        );
        return ratios.stream().min(java.util.Comparator.comparingDouble(item -> Math.abs(item.getValue() - ratio))).orElse(ratios.get(0)).getKey();
    }

    /**
     * 计算Agnes视频帧数
     *
     * @param value      String 目标秒数
     * @param resolution String 分辨率
     * @return AgnesVideoTiming 视频帧信息
     */
    private AgnesVideoTiming agnesVideoTiming(String value, String resolution) {
        int maxFrames = switch (normalizeAgnesVideoResolution(resolution)) {
            case "1080p" -> 169;
            case "480p" -> 961;
            default -> 409;
        };
        int seconds = Math.max(1, Math.min((int) Math.floor((double) maxFrames), (int) Math.floor(parsePositiveDouble(StringUtils.hasText(value) ? value : "5", "Agnes 视频秒数必须是正数"))));
        List<AgnesVideoTiming> presets = List.of(
                new AgnesVideoTiming(3, 81, 24),
                new AgnesVideoTiming(5, 121, 24),
                new AgnesVideoTiming(10, 241, 24),
                new AgnesVideoTiming(18, 441, 24)
        );
        return presets.stream().filter(item -> item.seconds() == seconds && item.numFrames() <= maxFrames).findFirst().orElseGet(() -> new AgnesVideoTiming(seconds, Math.min(maxFrames, Math.max(9, seconds * 24 + 1)), 24));
    }

    /**
     * 解析正数参数
     *
     * @param value   String 原始值
     * @param message String 错误提示
     * @return double 正数值
     */
    private static double parsePositiveDouble(String value, String message) {
        try {
            double parsed = Double.parseDouble(value);
            if (parsed > 0) {
                return parsed;
            }
        } catch (NumberFormatException exception) {
            log.info("解析Agnes数值参数失败: value={}", value);
        }
        throw new BusinessException(ErrorCode.PARAM_INVALID, message);
    }

    /**
     * Agnes视频尺寸
     *
     * @param width      int 宽度
     * @param height     int 高度
     * @param resolution String 分辨率
     */
    private record AgnesVideoDimensions(int width, int height, String resolution) {
    }

    /**
     * Agnes视频帧信息
     *
     * @param seconds   int 秒数
     * @param numFrames int 帧数
     * @param frameRate int 帧率
     */
    private record AgnesVideoTiming(int seconds, int numFrames, int frameRate) {
    }
}

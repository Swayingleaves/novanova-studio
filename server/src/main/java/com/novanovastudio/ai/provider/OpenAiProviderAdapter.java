package com.novanovastudio.ai.provider;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.TypeReference;
import com.novanovastudio.ai.*;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.config.NovanovaProperties;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * @title        OpenAiProviderAdapter.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  OpenAI兼容AI渠道适配器
 * @createTime   2026-06-24 20:35:00
 */
@Component
@RequiredArgsConstructor
public class OpenAiProviderAdapter implements AiProviderAdapter {

    /** AI HTTP客户端 */
    private final AiHttpClient aiHttpClient;

    /** AI媒体支持 */
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
        return "openai";
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
     * 执行OpenAI兼容AI任务
     *
     * @param context AiTaskExecutionContext AI任务执行上下文
     * @return Mono<JSONObject> 任务结果JSON
     */
    @Override
    public Mono<JSONObject> execute(AiTaskExecutionContext context) {
        // 按任务类型选择协议实现，任务生命周期由AiTaskService统一管理。
        return switch (context.task().getTaskType()) {
            case AiTaskTypes.TEXT -> executeTextTask(context);
            case AiTaskTypes.IMAGE -> executeImageTask(context);
            case AiTaskTypes.VIDEO -> executeVideoTask(context);
            default -> Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "OpenAI兼容渠道不支持该任务类型"));
        };
    }

    /**
     * 执行文本任务
     *
     * @param context AiTaskExecutionContext AI任务执行上下文
     * @return Mono<JSONObject> 文本结果
     */
    private Mono<JSONObject> executeTextTask(AiTaskExecutionContext context) {
        Map<String, Object> payload = new java.util.LinkedHashMap<>();
        payload.put("model", context.model());
        String systemPrompt = AiTaskParameterReader.stringParameter(context.request().parameters(), "systemPrompt", "");
        List<Map<String, String>> messages = new ArrayList<>();
        if (StringUtils.hasText(systemPrompt)) {
            messages.add(Map.of("role", "system", "content", systemPrompt));
        }
        messages.add(Map.of("role", "user", "content", context.request().prompt()));
        payload.put("messages", messages);
        applyThinkingConfiguration(payload, context);
        return aiHttpClient.sendJsonRequest(context.channel(), "POST", "/chat/completions", payload)
                .map(AiJsonUtils::responsePayload)
                .map(response -> AiJsonUtils.jsonObject(Map.of("content", readChatCompletionsText(response))));
    }

    /**
     * 执行图片任务
     *
     * @param context AiTaskExecutionContext AI任务执行上下文
     * @return Mono<JSONObject> 图片结果
     */
    private Mono<JSONObject> executeImageTask(AiTaskExecutionContext context) {
        // 有参考图时走图片编辑接口，无参考图时走纯文生图接口。
        if (!AiTaskParameterReader.safeReferences(context.request().references()).isEmpty()) {
            return executeImageEditTask(context);
        }
        Map<String, Object> payload = new java.util.LinkedHashMap<>();
        payload.put("model", context.model());
        payload.put("prompt", context.request().prompt());
        payload.put("n", AiTaskParameterReader.intParameter(context.request().parameters(), "count", 1, 1, 10));
        payload.put("response_format", "url");
        payload.put("output_format", "png");
        AiTaskParameterReader.putNonAuto(payload, context.request().parameters(), "quality");
        String imageSize = normalizeImageSize(context.request().parameters());
        if (StringUtils.hasText(imageSize)) {
            payload.put("size", imageSize);
        }
        return aiHttpClient.sendJsonRequest(context.channel(), "POST", "/images/generations", payload)
                .flatMap(response -> storeImageItems(context, AiJsonUtils.responseArrayPayload(response, "data")));
    }

    /**
     * 执行视频任务
     *
     * @param context AiTaskExecutionContext AI任务执行上下文
     * @return Mono<JSONObject> 视频结果
     */
    private Mono<JSONObject> executeVideoTask(AiTaskExecutionContext context) {
        // OpenAI兼容视频接口只支持提示词和图片参考。
        if (!AiTaskParameterReader.safeReferences(context.request().videoReferences()).isEmpty()) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "OpenAI兼容视频接口暂不支持参考视频"));
        }
        return Flux.fromIterable(AiTaskParameterReader.safeReferences(context.request().references()).stream().limit(7).toList())
                .concatMap(reference -> mediaSupport.resolveReferenceUrl(context.task().getUserId(), reference))
                .collectList()
                .flatMap(referenceUrls -> {
                    String boundary = "----NovanovaVideoBoundary" + UUID.randomUUID();
                    List<MultipartPart> parts = new ArrayList<>();
                    parts.add(aiHttpClient.formPart("model", context.model()));
                    parts.add(aiHttpClient.formPart("prompt", context.request().prompt()));
                    parts.add(aiHttpClient.formPart("seconds", AiTaskParameterReader.parameterText(context.request().parameters(), "seconds", "6")));
                    String size = AiTaskParameterReader.parameterText(context.request().parameters(), "size", "");
                    if (StringUtils.hasText(size) && !"auto".equals(size)) {
                        parts.add(aiHttpClient.formPart("size", normalizeVideoSize(size)));
                    }
                    String resolution = AiTaskParameterReader.parameterText(context.request().parameters(), "resolution", "720p");
                    if (StringUtils.hasText(resolution)) {
                        parts.add(aiHttpClient.formPart("resolution_name", normalizeVideoResolution(resolution)));
                    }
                    parts.add(aiHttpClient.formPart("preset", "normal"));
                    for (String referenceUrl : referenceUrls) {
                        parts.add(aiHttpClient.formPart("input_reference[]", referenceUrl));
                    }
                    return aiHttpClient.sendMultipartRequest(context.channel(), "/videos", boundary, parts);
                }).flatMap(created -> {
                    JSONObject createdPayload = AiJsonUtils.responsePayload(created);
                    String providerTaskId = AiTaskParameterReader.firstNonEmpty(createdPayload.getString("id"), createdPayload.getString("task_id"));
                    if (!StringUtils.hasText(providerTaskId)) {
                        return Mono.error(new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "视频接口没有返回任务ID"));
                    }
                    return context.updateRunningProgress(20)
                            .then(pollVideoTask(context, providerTaskId))
                            .flatMap(finished -> {
                                String resultUrl = AiTaskParameterReader.firstNonEmpty(finished.getString("url"), finished.getString("output_url"), finished.getString("video_url"), finished.getString("content_url"));
                                if (mediaSupport.isHttpUrl(resultUrl)) {
                                    return mediaSupport.registerGeneratedMediaUrl(context.task().getUserId(), AiTaskTypes.VIDEO, resultUrl, AiTaskParameterReader.firstNonEmpty(finished.getString("mime_type"), finished.getString("mimeType"), "video/mp4"), null, null, null)
                                            .map(media -> AiJsonUtils.jsonObject(Map.of("item", media, "providerTaskId", providerTaskId)));
                                }
                                return aiHttpClient.downloadBinary(context.channel(), "/videos/" + providerTaskId + "/content").flatMap(binary -> {
                                        String mimeType = AiTaskParameterReader.firstNonEmpty(finished.getString("mime_type"), finished.getString("mimeType"), binary.mimeType(), "video/mp4");
                                        GeneratedBinary video = new GeneratedBinary(binary.data(), mimeType);
                                        return mediaSupport.storeGeneratedMedia(context.task().getUserId(), AiTaskTypes.VIDEO, "generated-video.mp4", video, null, null, null)
                                                .map(media -> AiJsonUtils.jsonObject(Map.of("item", media, "providerTaskId", providerTaskId)));
                                    });
                            });
                });
    }

    /**
     * 执行带参考图的图片编辑任务
     *
     * @param context AiTaskExecutionContext AI任务执行上下文
     * @return Mono<JSONObject> 图片结果
     */
    private Mono<JSONObject> executeImageEditTask(AiTaskExecutionContext context) {
        return Flux.fromIterable(AiTaskParameterReader.safeReferences(context.request().references()))
                .index()
                .concatMap(tuple -> mediaSupport.resolveReferenceBinary(context.task().getUserId(), tuple.getT2(), "image/png")
                        .map(binary -> {
                            String fileName = AiTaskParameterReader.firstNonEmpty(tuple.getT2().name(), "reference-" + (tuple.getT1() + 1) + "." + mediaSupport.fileExtension(binary.mimeType(), "png"));
                            return aiHttpClient.filePart("image", fileName, binary.mimeType(), binary.data());
                        }))
                .collectList()
                .flatMap(fileParts -> {
                    String boundary = "----NovanovaImageBoundary" + UUID.randomUUID();
                    List<MultipartPart> parts = new ArrayList<>();
                    parts.add(aiHttpClient.formPart("model", context.model()));
                    parts.add(aiHttpClient.formPart("prompt", context.request().prompt()));
                    parts.add(aiHttpClient.formPart("n", String.valueOf(AiTaskParameterReader.intParameter(context.request().parameters(), "count", 1, 1, 10))));
                    parts.add(aiHttpClient.formPart("response_format", "url"));
                    parts.add(aiHttpClient.formPart("output_format", "png"));
                    String quality = AiTaskParameterReader.stringParameter(context.request().parameters(), "quality", "");
                    if (StringUtils.hasText(quality) && !"auto".equals(quality)) {
                        parts.add(aiHttpClient.formPart("quality", quality));
                    }
                    String imageSize = normalizeImageSize(context.request().parameters());
                    if (StringUtils.hasText(imageSize)) {
                        parts.add(aiHttpClient.formPart("size", imageSize));
                    }
                    parts.addAll(fileParts);
                    return aiHttpClient.sendMultipartRequest(context.channel(), "/images/edits", boundary, parts);
                })
                .flatMap(response -> storeImageItems(context, AiJsonUtils.responseArrayPayload(response, "data")));
    }

    /**
     * 保存图片结果列表
     *
     * @param context AiTaskExecutionContext AI任务执行上下文
     * @param data JSONArray 图片结果数组
     * @return Mono<JSONObject> 图片任务结果
     */
    private Mono<JSONObject> storeImageItems(AiTaskExecutionContext context, JSONArray data) {
        if (data == null || data.isEmpty()) {
            return Mono.just(AiJsonUtils.jsonObject(Map.of("items", List.of())));
        }
        return Flux.fromIterable(data)
                .concatMap(itemObject -> {
                    JSONObject item = JSON.parseObject(JSON.toJSONString(itemObject));
                    return mediaSupport.storeGeneratedImageItem(context.task().getUserId(), item, null, null, 0)
                            .map(media -> JSON.parseObject(JSON.toJSONString(media), new TypeReference<Map<String, Object>>() {
                            }));
                })
                .collectList()
                .map(items -> AiJsonUtils.jsonObject(Map.of("items", items)));
    }

    /**
     * 轮询OpenAI兼容视频任务直到完成
     *
     * @param context AiTaskExecutionContext AI任务执行上下文
     * @param providerTaskId String 第三方任务ID
     * @return Mono<JSONObject> 第三方任务结果
     */
    private Mono<JSONObject> pollVideoTask(AiTaskExecutionContext context, String providerTaskId) {
        Duration pollingInterval = AiTaskPollingSupport.pollingInterval(properties);
        return Flux.range(0, 120)
                .concatMap(attempt -> Mono.delay(pollingInterval)
                        .then(context.isCancelRequested())
                        .flatMap(cancelRequested -> {
                            if (Boolean.TRUE.equals(cancelRequested)) {
                                return Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "任务已取消"));
                            }
                            return aiHttpClient.sendJsonRequest(context.channel(), "GET", "/videos/" + providerTaskId, null)
                                    .map(AiJsonUtils::responsePayload)
                                    .flatMap(response -> {
                                        String status = AiTaskParameterReader.firstNonEmpty(response.getString("status")).toLowerCase();
                                        int progress = Math.min(95, 20 + attempt);
                                        return context.updateRunningProgress(progress).then(Mono.defer(() -> {
                                            if (List.of("completed", "succeeded", "success").contains(status)) {
                                                return Mono.just(response);
                                            }
                                            if (List.of("failed", "cancelled", "canceled", "expired").contains(status)) {
                                                return Mono.error(AiErrorSupport.providerTaskFailure(response, "视频生成失败"));
                                            }
                                            return Mono.empty();
                                        }));
                                    });
                        }))
                .next()
                .switchIfEmpty(Mono.error(AiErrorSupport.providerPollingTimeout("视频生成超时，请稍后重试")));
    }

    /**
     * 写入文本模型思考配置。
     *
     * @param payload Map<String, Object> OpenAI兼容请求体
     * @param context AiTaskExecutionContext 任务执行上下文
     * @return void 无返回值
     */
    private void applyThinkingConfiguration(Map<String, Object> payload, AiTaskExecutionContext context) {
        payload.put("thinking", Map.of("type", context.thinkingEnabled() ? "enabled" : "disabled"));
        if (context.thinkingEnabled()) {
            payload.put("reasoning_effort", context.reasoningEffort());
        }
    }

    /**
     * 读取OpenAI Chat Completions接口文本内容。
     *
     * @param response JSONObject 接口响应载荷
     * @return String 文本内容
     */
    private String readChatCompletionsText(JSONObject response) {
        JSONArray choices = response.getJSONArray("choices");
        if (choices == null || choices.isEmpty()) {
            return "";
        }
        JSONObject message = choices.getJSONObject(0).getJSONObject("message");
        return message == null ? "" : AiTaskParameterReader.firstNonEmpty(message.getString("content"));
    }

    /**
     * 将图片比例和清晰度转换为OpenAI兼容接口要求的像素尺寸。
     *
     * @param parameters Map 图片生成参数
     * @return String 宽x高像素尺寸；未指定或为auto时返回空字符串
     * @throws BusinessException 比例或清晰度格式不合法时抛出
     */
    private String normalizeImageSize(Map<String, Object> parameters) {
        String size = AiTaskParameterReader.parameterText(parameters, "size", "").trim();
        if (!StringUtils.hasText(size) || "auto".equalsIgnoreCase(size)) {
            return "";
        }
        if (size.matches("^\\d+x\\d+$")) {
            return size;
        }

        String resolution = AiTaskParameterReader.parameterText(parameters, "resolution", "2K").trim();
        int longSide = switch (resolution.toLowerCase()) {
            case "1k" -> 1024;
            case "2k" -> 2048;
            case "4k" -> 4096;
            default -> throw new BusinessException(ErrorCode.PARAM_INVALID, "图片清晰度只支持1K、2K、4K");
        };
        String[] ratioParts = size.split(":");
        if (ratioParts.length != 2) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "图片比例必须是正数，例如9:16");
        }
        try {
            double widthRatio = Double.parseDouble(ratioParts[0]);
            double heightRatio = Double.parseDouble(ratioParts[1]);
            if (!Double.isFinite(widthRatio) || !Double.isFinite(heightRatio)
                    || widthRatio <= 0 || heightRatio <= 0) {
                throw new NumberFormatException("比例必须大于0");
            }
            boolean landscape = widthRatio >= heightRatio;
            double longRatio = landscape ? widthRatio / heightRatio : heightRatio / widthRatio;
            int shortSide = Math.max(16, (int) (Math.round(longSide / longRatio / 16) * 16));
            return landscape ? longSide + "x" + shortSide : shortSide + "x" + longSide;
        } catch (NumberFormatException exception) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "图片比例必须是正数，例如9:16");
        }
    }

    /**
     * 规范化视频尺寸
     *
     * @param size String 尺寸或比例
     * @return String 视频尺寸
     */
    private String normalizeVideoSize(String size) {
        if (size.matches("^\\d+x\\d+$")) {
            return size;
        }
        return List.of("9:16", "2:3", "3:4").contains(size) ? "720x1280" : "1280x720";
    }

    /**
     * 规范化视频分辨率
     *
     * @param resolution String 分辨率
     * @return String 视频分辨率
     */
    private String normalizeVideoResolution(String resolution) {
        if ("low".equals(resolution)) {
            return "480p";
        }
        if ("auto".equals(resolution) || "high".equals(resolution) || "medium".equals(resolution)) {
            return "720p";
        }
        return resolution.endsWith("p") ? resolution : resolution + "p";
    }
}

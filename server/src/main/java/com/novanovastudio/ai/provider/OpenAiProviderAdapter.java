package com.novanovastudio.ai.provider;

import com.novanovastudio.common.SystemMessage;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.TypeReference;
import com.novanovastudio.ai.*;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.dto.AiTaskDtos;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
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
@Slf4j
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
            default -> Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, SystemMessage.of("business.openAICompatibleChannelDoesNotSupportThisTaskType")));
        };
    }

    /**
     * 执行文本任务
     *
     * @param context AiTaskExecutionContext AI任务执行上下文
     * @return Mono<JSONObject> 文本结果
     */
    private Mono<JSONObject> executeTextTask(AiTaskExecutionContext context) {
        return resolveReferenceUrls(context.task().getUserId(), AiTaskParameterReader.safeReferences(context.request().references()))
                .flatMap(imageUrls -> {
                    Map<String, Object> payload = new java.util.LinkedHashMap<>();
                    payload.put("model", context.model());
                    String systemPrompt = AiTaskParameterReader.stringParameter(context.request().parameters(), "systemPrompt", "");
                    List<Map<String, Object>> messages = new ArrayList<>();
                    if (StringUtils.hasText(systemPrompt)) {
                        messages.add(Map.of("role", "system", "content", systemPrompt));
                    }
                    if (imageUrls.isEmpty()) {
                        messages.add(Map.of("role", "user", "content", context.request().prompt()));
                    } else {
                        List<Map<String, Object>> contentParts = new ArrayList<>();
                        contentParts.add(Map.of("type", "text", "text", context.request().prompt()));
                        for (String imageUrl : imageUrls) {
                            contentParts.add(Map.of("type", "image_url", "image_url", Map.of("url", imageUrl)));
                        }
                        messages.add(Map.of("role", "user", "content", contentParts));
                    }
                    payload.put("messages", messages);
                    applyThinkingConfiguration(payload, context);
                    return aiHttpClient.sendJsonRequest(context.channel(), "POST", "/chat/completions", AiRequestBodySupport.mergeCustomBodyParameters(payload, context.customBodyParameters()))
                            .map(AiJsonUtils::responsePayload)
                            .map(response -> AiJsonUtils.jsonObject(Map.of("content", requireChatCompletionsText(response))));
                });
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
        //response_format已弃用
//        payload.put("response_format", "url");
        payload.put("output_format", "png");
        AiTaskParameterReader.putNonAuto(payload, context.request().parameters(), "quality");
        // 手写size优先，不为已覆盖的参数查询尺寸映射。
        if (context.customBodyParameters() == null || !context.customBodyParameters().containsKey("size")) {
            String imageSize = AiImageSizeSupport.resolveSize(context.request().parameters(), context.convertImageSizeToPixels(), context.imageSizeMappings());
            if (StringUtils.hasText(imageSize)) payload.put("size", imageSize);
        }
        Map<String, Object> body = AiRequestBodySupport.mergeCustomBodyParameters(payload, context.customBodyParameters());
        logRequest(context, "图片请求", "/images/generations", body);
        return aiHttpClient.sendJsonRequest(context.channel(), "POST", "/images/generations", body)
                .flatMap(response -> storeImageItems(context, AiJsonUtils.responseArrayPayload(response, "data")));
    }

    /**
     * 执行视频任务
     *
     * @param context AiTaskExecutionContext AI任务执行上下文
     * @return Mono<JSONObject> 视频结果
     */
    private Mono<JSONObject> executeVideoTask(AiTaskExecutionContext context) {
        String existingProviderTaskId = context.existingProviderTaskId();
        if (StringUtils.hasText(existingProviderTaskId)) {
            log.info("OpenAI视频任务恢复轮询: taskId={}, providerTaskId={}", context.task().getId(), existingProviderTaskId);
            return finishVideoTask(context, existingProviderTaskId);
        }
        // OpenAI兼容视频接口以 JSON 方式提交，按非空列表附加 images / videos / audios 参考链接。
        Mono<List<String>> imageUrlsMono = resolveReferenceUrls(context.task().getUserId(),
                AiTaskParameterReader.safeReferences(context.request().references()));
        Mono<List<String>> videoUrlsMono = resolveReferenceUrls(context.task().getUserId(),
                AiTaskParameterReader.safeReferences(context.request().videoReferences()));
        Mono<List<String>> audioUrlsMono = resolveReferenceUrls(context.task().getUserId(),
                AiTaskParameterReader.safeReferences(context.request().audioReferences()));
        return Mono.zip(imageUrlsMono, videoUrlsMono, audioUrlsMono)
                .flatMap(tuple -> {
                    List<String> imageUrls = tuple.getT1();
                    List<String> videoUrls = tuple.getT2();
                    List<String> audioUrls = tuple.getT3();
                    Map<String, Object> payload = new LinkedHashMap<>();
                    payload.put("model", context.model());
                    payload.put("prompt", context.request().prompt());
                    payload.put("seconds", AiTaskParameterReader.parameterText(context.request().parameters(), "seconds", "6"));
                    String size = AiTaskParameterReader.parameterText(context.request().parameters(), "size", "");
                    if (StringUtils.hasText(size) && !"auto".equals(size)) {
                        payload.put("size", normalizeVideoSize(size));
                    }
                    String resolution = AiTaskParameterReader.parameterText(context.request().parameters(), "resolution", "720p");
                    if (StringUtils.hasText(resolution)) {
                        payload.put("resolution_name", normalizeVideoResolution(resolution));
                    }
                    payload.put("preset", "normal");
                    if (!imageUrls.isEmpty()) {
                        payload.put("images", imageUrls);
                    }
                    if (!videoUrls.isEmpty()) {
                        payload.put("videos", videoUrls);
                    }
                    if (!audioUrls.isEmpty()) {
                        payload.put("audios", audioUrls);
                    }
                    logRequest(context, "视频请求", "/videos", payload);
                    return aiHttpClient.sendJsonRequest(context.channel(), "POST", "/videos", payload);
                }).flatMap(created -> {
                    JSONObject createdPayload = AiJsonUtils.responsePayload(created);
                    String providerTaskId = AiTaskParameterReader.firstNonEmpty(createdPayload.getString("id"), createdPayload.getString("task_id"));
                    if (!StringUtils.hasText(providerTaskId)) {
                        return Mono.error(new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, SystemMessage.of("business.videoAPIReturnedNoTaskID")));
                    }
                    return context.recordProviderTaskId(providerTaskId)
                            .then(context.updateRunningProgress(20))
                            .then(finishVideoTask(context, providerTaskId));
                });
    }

    /**
     * 解析并过滤非空参考素材公网访问链接。
     *
     * @param userId Long 用户ID
     * @param references List<AiTaskMediaReference> 参考素材列表
     * @return Mono<List<String>> 公网链接列表
     */
    private Mono<List<String>> resolveReferenceUrls(Long userId, List<AiTaskDtos.AiTaskMediaReference> references) {
        if (references == null || references.isEmpty()) {
            return Mono.just(List.of());
        }
        return Flux.fromIterable(references)
                .concatMap(reference -> mediaSupport.resolveReferenceUrl(userId, reference))
                .filter(StringUtils::hasText)
                .collectList();
    }

    private Mono<JSONObject> finishVideoTask(AiTaskExecutionContext context, String providerTaskId) {
        return pollVideoTask(context, providerTaskId)
                .flatMap(finished -> {
                    String resultUrl = AiTaskParameterReader.firstNonEmpty(finished.getString("url"), finished.getString("output_url"), finished.getString("video_url"), finished.getString("content_url"));
                    if (mediaSupport.isHttpUrl(resultUrl)) {
                        return mediaSupport.storeGeneratedMediaUrl(context.task().getUserId(), AiTaskTypes.VIDEO, resultUrl, AiTaskParameterReader.firstNonEmpty(finished.getString("mime_type"), finished.getString("mimeType"), "video/mp4"), null, null, null)
                                .map(media -> AiJsonUtils.jsonObject(Map.of("item", media, "providerTaskId", providerTaskId)));
                    }
                    return aiHttpClient.downloadBinary(context.channel(), "/videos/" + providerTaskId + "/content").flatMap(binary -> {
                        String mimeType = AiTaskParameterReader.firstNonEmpty(finished.getString("mime_type"), finished.getString("mimeType"), binary.mimeType(), "video/mp4");
                        GeneratedBinary video = new GeneratedBinary(binary.data(), mimeType);
                        return mediaSupport.storeGeneratedMedia(context.task().getUserId(), AiTaskTypes.VIDEO, "generated-video.mp4", video, null, null, null)
                                .map(media -> AiJsonUtils.jsonObject(Map.of("item", media, "providerTaskId", providerTaskId)));
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
                    String imageSize = AiImageSizeSupport.resolveSize(context.request().parameters(), context.convertImageSizeToPixels(), context.imageSizeMappings());
                    if (StringUtils.hasText(imageSize)) {
                        parts.add(aiHttpClient.formPart("size", imageSize));
                    }
                    parts.addAll(fileParts);
                    logRequest(context, "图片编辑", "/images/edits", formSummary(parts));
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
        int maxAttempts = AiTaskPollingSupport.maxPollingAttempts(properties, AiTaskTypes.VIDEO);
        return Flux.range(0, maxAttempts)
                .concatMap(attempt -> Mono.delay(pollingInterval)
                        .then(context.isCancelRequested())
                        .flatMap(cancelRequested -> {
                            if (Boolean.TRUE.equals(cancelRequested)) {
                                return Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, SystemMessage.of("business.taskCanceled")));
                            }
                            return aiHttpClient.sendJsonRequest(context.channel(), "GET", "/videos/" + providerTaskId, null)
                                    .map(AiJsonUtils::responsePayload)
                                    .flatMap(response -> {
                                        String status = AiTaskParameterReader.firstNonEmpty(response.getString("status")).toLowerCase();
                                        int progress = AiTaskPollingSupport.readProgress(response, Math.min(95, 20 + attempt));
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
     * 读取Chat Completions文本结果，空内容按生成失败处理。
     * <p>
     * 供应商返回成功状态但内容为空（响应体被截断、choices缺失等）时不能当作成功结果，
     * 否则文本任务会以空内容标记成功，画布文本节点被写入空文本并显示为空白节点。
     *
     * @param response JSONObject 接口响应载荷
     * @return String 文本内容
     */
    private String requireChatCompletionsText(JSONObject response) {
        String text = readChatCompletionsText(response);
        if (!StringUtils.hasText(text)) {
            throw AiErrorSupport.malformedResponse("execution");
        }
        return text;
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

    /** 发起图片或视频请求前打印实际 URL 和请求体，便于对照渠道收到的内容。 */
    private void logRequest(AiTaskExecutionContext context, String purpose, String path, Object body) {
        String url = AiHttpClient.buildAiUrl(context.channel().baseUrl(), path);
        String json = body instanceof String text ? text : JSON.toJSONString(body);
        log.info("AI构造请求体请求: taskId={}, purpose={}, url={}, body={}", context.task().getId(), purpose, url, abbreviate(json));
    }

    /** multipart 请求没有 JSON 请求体，按字段名汇总成一份便于对照的 JSON。 */
    private JSONObject formSummary(List<MultipartPart> parts) {
        JSONObject summary = new JSONObject();
        for (MultipartPart part : parts) {
            if (part == null || part.name() == null) {
                continue;
            }
            Object value = part.fileName() != null
                    ? "[file] " + part.fileName() + " (" + (part.contentType() == null ? "" : part.contentType()) + ")"
                    : (part.data() == null ? "" : new String(part.data(), StandardCharsets.UTF_8));
            Object existing = summary.get(part.name());
            if (existing == null) {
                summary.put(part.name(), value);
            } else if (existing instanceof JSONArray array) {
                array.add(value);
            } else {
                JSONArray array = new JSONArray();
                array.add(existing);
                array.add(value);
                summary.put(part.name(), array);
            }
        }
        return summary;
    }

    private static String abbreviate(String body) {
        if (body == null || body.length() <= 10000) {
            return body == null ? "" : body;
        }
        return body.substring(0, 10000) + "...(已截断)";
    }
}

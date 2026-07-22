package com.novanovastudio.ai.provider;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.TypeReference;
import com.novanovastudio.ai.*;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * @title        GeminiProviderAdapter.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  Gemini AI渠道适配器
 * @createTime   2026-06-24 20:35:00
 */
@Component
@RequiredArgsConstructor
public class GeminiProviderAdapter implements AiProviderAdapter {

    /** AI HTTP客户端 */
    private final AiHttpClient aiHttpClient;

    /** AI媒体支持 */
    private final AiMediaSupport mediaSupport;

    /**
     * 获取渠道调用格式
     *
     * @return String 渠道调用格式
     */
    @Override
    public String apiFormat() {
        return "gemini";
    }

    /**
     * 判断当前适配器是否支持任务类型
     *
     * @param taskType String 任务类型
     * @return boolean 是否支持
     */
    @Override
    public boolean supports(String taskType) {
        return List.of(AiTaskTypes.TEXT, AiTaskTypes.IMAGE).contains(taskType);
    }

    /**
     * 执行Gemini AI任务
     *
     * @param context AiTaskExecutionContext AI任务执行上下文
     * @return Mono<JSONObject> 任务结果JSON
     */
    @Override
    public Mono<JSONObject> execute(AiTaskExecutionContext context) {
        return switch (context.task().getTaskType()) {
            case AiTaskTypes.TEXT -> executeTextTask(context);
            case AiTaskTypes.IMAGE -> executeImageTask(context);
            default -> Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "Gemini 调用格式暂不支持" + context.task().getTaskType() + "任务"));
        };
    }

    /**
     * 执行Gemini文本任务
     *
     * @param context AiTaskExecutionContext AI任务执行上下文
     * @return Mono<JSONObject> 文本结果
     */
    private Mono<JSONObject> executeTextTask(AiTaskExecutionContext context) {
        Map<String, Object> payload = new java.util.LinkedHashMap<>();
        String systemPrompt = AiTaskParameterReader.stringParameter(context.request().parameters(), "systemPrompt", "");
        if (StringUtils.hasText(systemPrompt)) {
            payload.put("systemInstruction", Map.of("parts", List.of(Map.of("text", systemPrompt))));
        }
        payload.putAll(textPayload(context.request().prompt()));
        return aiHttpClient.sendGeminiJsonRequest(context.channel(), generateContentPath(context.model()), payload)
                .map(this::parseGeminiText)
                .map(content -> AiJsonUtils.jsonObject(Map.of("content", content)));
    }

    /**
     * 执行Gemini图片任务
     *
     * @param context AiTaskExecutionContext AI任务执行上下文
     * @return Mono<JSONObject> 图片结果
     */
    private Mono<JSONObject> executeImageTask(AiTaskExecutionContext context) {
        int count = AiTaskParameterReader.intParameter(context.request().parameters(), "count", 1, 1, 10);
        return Flux.range(0, count)
                .concatMap(index -> executeGeminiImageOnce(context))
                .flatMapIterable(items -> items)
                .collectList()
                .map(items -> AiJsonUtils.jsonObject(Map.of("items", items)));
    }

    /**
     * 执行单次Gemini图片请求
     *
     * @param context AiTaskExecutionContext AI任务执行上下文
     * @return Mono<List<Map<String, Object>>> 媒体响应列表
     */
    private Mono<List<Map<String, Object>>> executeGeminiImageOnce(AiTaskExecutionContext context) {
        return buildGeminiImageParts(context)
                .flatMap(parts -> {
                    Map<String, Object> payload = new java.util.LinkedHashMap<>();
                    payload.put("contents", List.of(Map.of("role", "user", "parts", parts)));
                    payload.put("generationConfig", Map.of("responseModalities", List.of("TEXT", "IMAGE")));
                    return aiHttpClient.sendGeminiJsonRequest(context.channel(), generateContentPath(context.model()), payload);
                })
                .flatMap(response -> {
                    List<JSONObject> imageItems = parseGeminiImages(response);
                    if (imageItems.isEmpty()) {
                        return Mono.error(new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "Gemini 接口没有返回图片"));
                    }
                    return Flux.fromIterable(imageItems)
                            .concatMap(item -> mediaSupport.storeGeneratedImageItem(context.task().getUserId(), item, null, null, 0)
                                    .map(media -> JSON.parseObject(JSON.toJSONString(media), new TypeReference<Map<String, Object>>() {
                                    })))
                            .collectList();
                });
    }

    /**
     * 构建Gemini图片请求片段
     *
     * @param context AiTaskExecutionContext AI任务执行上下文
     * @return Mono<List<Map<String, Object>>> 图片请求片段
     */
    private Mono<List<Map<String, Object>>> buildGeminiImageParts(AiTaskExecutionContext context) {
        List<Map<String, Object>> parts = new ArrayList<>();
        Map<String, Object> textPart = new java.util.LinkedHashMap<>();
        textPart.put("text", context.request().prompt());
        parts.add(textPart);
        return Flux.fromIterable(AiTaskParameterReader.safeReferences(context.request().references()))
                .concatMap(reference -> mediaSupport.resolveReferenceUrl(context.task().getUserId(), reference)
                        .flatMap(url -> {
                            if (url.startsWith("data:")) {
                                return Mono.just(toGeminiImagePart(url));
                            }
                            Map<String, Object> fileData = new java.util.LinkedHashMap<>();
                            fileData.put("fileUri", url);
                            fileData.put("mimeType", AiTaskParameterReader.firstNonEmpty(reference.mimeType(), "image/png"));
                            Map<String, Object> filePart = new java.util.LinkedHashMap<>();
                            filePart.put("fileData", fileData);
                            return Mono.just(filePart);
                        }))
                .doOnNext(parts::add)
                .then(Mono.just(parts));
    }

    /**
     * 构建Gemini文本请求体
     *
     * @param prompt String 提示词
     * @return Map<String, Object> 请求体
     */
    private Map<String, Object> textPayload(String prompt) {
        return Map.of("contents", List.of(Map.of("role", "user", "parts", List.of(Map.of("text", prompt)))));
    }

    /**
     * 转换Gemini图片片段
     *
     * @param dataUrl String data URL
     * @return Map<String, Object> Gemini图片片段
     */
    private Map<String, Object> toGeminiImagePart(String dataUrl) {
        int commaIndex = dataUrl.indexOf(',');
        if (commaIndex < 0 || !dataUrl.substring(0, commaIndex).contains(";base64")) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "Gemini参考图片data URL必须是base64格式");
        }
        String mimeType = AiTaskParameterReader.firstNonEmpty(dataUrl.substring(5, commaIndex).split(";")[0], "image/png");
        String base64 = dataUrl.substring(commaIndex + 1);
        return Map.of("inlineData", Map.of("mimeType", mimeType, "data", base64));
    }

    /**
     * 解析Gemini文本
     *
     * @param payload JSONObject Gemini响应
     * @return String 文本内容
     */
    private String parseGeminiText(JSONObject payload) {
        StringBuilder builder = new StringBuilder();
        for (JSONObject part : candidateParts(payload)) {
            builder.append(AiTaskParameterReader.firstNonEmpty(part.getString("text")));
        }
        return builder.toString();
    }

    /**
     * 解析Gemini图片
     *
     * @param payload JSONObject Gemini响应
     * @return List<JSONObject> OpenAI风格图片结果项
     */
    private List<JSONObject> parseGeminiImages(JSONObject payload) {
        List<JSONObject> images = new ArrayList<>();
        for (JSONObject part : candidateParts(payload)) {
            JSONObject inlineData = firstObject(part, "inlineData", "inline_data");
            if (inlineData != null && StringUtils.hasText(inlineData.getString("data"))) {
                JSONObject item = new JSONObject();
                item.put("b64_json", inlineData.getString("data"));
                images.add(item);
                continue;
            }
            JSONObject fileData = firstObject(part, "fileData", "file_data");
            if (fileData != null && StringUtils.hasText(fileData.getString("fileUri"))) {
                JSONObject item = new JSONObject();
                item.put("url", fileData.getString("fileUri"));
                images.add(item);
            }
        }
        return images;
    }

    /**
     * 读取Gemini候选内容片段
     *
     * @param payload JSONObject Gemini响应
     * @return List<JSONObject> 内容片段
     */
    private List<JSONObject> candidateParts(JSONObject payload) {
        JSONArray candidates = payload.getJSONArray("candidates");
        if (candidates == null) {
            return List.of();
        }
        List<JSONObject> parts = new ArrayList<>();
        for (Object candidateObject : candidates) {
            JSONObject candidate = JSON.parseObject(JSON.toJSONString(candidateObject));
            JSONObject content = candidate.getJSONObject("content");
            JSONArray contentParts = content == null ? null : content.getJSONArray("parts");
            if (contentParts == null) {
                continue;
            }
            for (Object partObject : contentParts) {
                parts.add(JSON.parseObject(JSON.toJSONString(partObject)));
            }
        }
        return parts;
    }

    /**
     * 读取第一个存在的JSON对象字段
     *
     * @param payload JSONObject JSON对象
     * @param keys String[] 字段名
     * @return JSONObject 字段对象
     */
    private JSONObject firstObject(JSONObject payload, String... keys) {
        for (String key : keys) {
            JSONObject value = payload.getJSONObject(key);
            if (value != null) {
                return value;
            }
        }
        return null;
    }

    /**
     * 构建Gemini生成内容路径
     *
     * @param model String 模型名称
     * @return String 请求路径
     */
    private String generateContentPath(String model) {
        String normalizedModel = model.trim().replaceFirst("^models/", "");
        return "/models/" + URLEncoder.encode(normalizedModel, StandardCharsets.UTF_8) + ":generateContent";
    }
}

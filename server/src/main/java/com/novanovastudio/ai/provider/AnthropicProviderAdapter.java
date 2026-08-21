package com.novanovastudio.ai.provider;

import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.ai.*;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * @title        AnthropicProviderAdapter.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  Anthropic AI渠道适配器
 * @createTime   2026-06-27 14:00:00
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class AnthropicProviderAdapter implements AiProviderAdapter {

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
        return "anthropic";
    }

    /**
     * 判断当前适配器是否支持任务类型
     *
     * @param taskType String 任务类型
     * @return boolean 是否支持
     */
    @Override
    public boolean supports(String taskType) {
        return List.of(AiTaskTypes.TEXT).contains(taskType);
    }

    /**
     * 执行Anthropic AI任务
     *
     * @param context AiTaskExecutionContext AI任务执行上下文
     * @return Mono<JSONObject> 任务结果JSON
     */
    @Override
    public Mono<JSONObject> execute(AiTaskExecutionContext context) {
        return switch (context.task().getTaskType()) {
            case AiTaskTypes.TEXT -> executeTextTask(context);
            default -> Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "Anthropic 调用格式暂不支持" + context.task().getTaskType() + "任务"));
        };
    }

    /**
     * 执行Anthropic文本对话任务
     * <p>
     * 通过Messages API流式调用Claude模型，逐段推送增量文本到前端。
     * 支持图片理解输入：参考图片以base64编码嵌入消息内容。
     *
     * @param context AiTaskExecutionContext AI任务执行上下文
     * @return Mono<JSONObject> 文本结果，结构为 {"content": "完整文本"}
     */
    private Mono<JSONObject> executeTextTask(AiTaskExecutionContext context) {
        // 解析参考图片为base64，用于Anthropic图片理解输入。
        return Flux.fromIterable(AiTaskParameterReader.safeReferences(context.request().references()))
                .concatMap(reference -> mediaSupport.resolveReferenceBinary(context.task().getUserId(), reference, "image/png")
                        .map(binary -> buildAnthropicImageBlock(binary.data(), binary.mimeType())))
                .collectList()
                .flatMap(imageBlocks -> {
                    // 构建Anthropic Messages API消息内容。
                    List<Map<String, Object>> contentBlocks = buildAnthropicContentBlocks(context.request().prompt(), imageBlocks);
                    Map<String, Object> payload = new java.util.LinkedHashMap<>();
                    payload.put("model", context.model());
                    payload.put("max_tokens", AiTaskParameterReader.intParameter(context.request().parameters(), "maxTokens", 4096, 1, 128000));
                    String systemPrompt = AiTaskParameterReader.stringParameter(context.request().parameters(), "systemPrompt", "");
                    if (StringUtils.hasText(systemPrompt)) {
                        payload.put("system", systemPrompt);
                    }
                    payload.put("messages", List.of(Map.of("role", "user", "content", contentBlocks)));
                    payload.put("stream", true);
                    // 建立连接前上报进度10%。
                    return context.updateRunningProgress(10)
                            .thenMany(aiHttpClient.sendAnthropicStreamingRequest(context.channel(), "/v1/messages", AiRequestBodySupport.mergeCustomBodyParameters(payload, context.customBodyParameters())))
                            .index()
                            .filter(tuple -> "content_block_delta".equals(tuple.getT2().event()))
                            .concatMap(tuple -> {
                                long index = tuple.getT1();
                                JSONObject data = tuple.getT2().data();
                                return context.isCancelRequested().flatMap(cancelRequested -> {
                                    if (Boolean.TRUE.equals(cancelRequested)) {
                                        return Mono.<String>error(new BusinessException(ErrorCode.BUSINESS_ERROR, "任务已取消"));
                                    }
                                    // 从content_block_delta事件中提取文本增量。
                                    JSONObject delta = data.getJSONObject("delta");
                                    String text = delta != null ? delta.getString("text") : "";
                                    return Mono.just(text != null ? text : "");
                                }).flatMap(delta -> {
                                    // 首个delta到达时上报运行进度50%。
                                    Mono<Void> progress = index == 0 ? context.updateRunningProgress(50) : Mono.empty();
                                    return progress.then(context.emitTextDelta(delta)).thenReturn(delta);
                                });
                            })
                            .collectList()
                            .map(deltas -> AiJsonUtils.jsonObject(Map.of("content", String.join("", deltas))));
                });
    }

    /**
     * 构建Anthropic图片内容块
     * <p>
     * Anthropic Messages API要求图片以base64编码嵌入，不支持URL引用。
     *
     * @param data byte[] 图片二进制数据
     * @param mimeType String MIME类型
     * @return Map<String, Object> Anthropic图片内容块
     */
    private Map<String, Object> buildAnthropicImageBlock(byte[] data, String mimeType) {
        String base64 = Base64.getEncoder().encodeToString(data);
        String normalizedMime = StringUtils.hasText(mimeType) ? mimeType : "image/png";
        return Map.of("type", "image", "source", Map.of("type", "base64", "media_type", normalizedMime, "data", base64));
    }

    /**
     * 构建Anthropic消息内容块列表
     * <p>
     * 无图片时返回纯文本内容，有图片时返回图片块+文本块的混合列表。
     *
     * @param prompt String 文本提示词
     * @param imageBlocks List<Map<String, Object>> 图片内容块列表
     * @return List<Map<String, Object>> 消息内容块列表
     */
    private List<Map<String, Object>> buildAnthropicContentBlocks(String prompt, List<Map<String, Object>> imageBlocks) {
        if (imageBlocks.isEmpty()) {
            return List.of(Map.of("type", "text", "text", prompt));
        }
        List<Map<String, Object>> blocks = new java.util.ArrayList<>(imageBlocks);
        blocks.add(Map.of("type", "text", "text", prompt));
        return blocks;
    }
}

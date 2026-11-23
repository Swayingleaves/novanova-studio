package com.novanovastudio.ai;

import com.novanovastudio.common.SystemMessage;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.ai.AiProviderRequestTracking;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.dto.AiTaskDtos;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.core.io.buffer.DataBuffer;
import org.springframework.core.io.buffer.DataBufferUtils;
import org.springframework.core.io.buffer.DefaultDataBufferFactory;
import org.springframework.util.StringUtils;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

/**
 * @title        AiHttpClient.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  AI供应商HTTP调用客户端
 * @createTime   2026-06-24 20:35:00
 */
@Slf4j
@Component
public class AiHttpClient {

    /** HTTP客户端 */
    private final HttpClient httpClient = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(30)).build();

    /** 远程媒体单次下载最大字节数 */
    private static final long MAXIMUM_REMOTE_MEDIA_BYTES = 100L * 1024 * 1024;

    /** 结果媒体下载中断后最多试几次（含首次）：上游已经出片扣费，一次网络抖动不该让任务失败 */
    private static final int RESULT_MEDIA_MAXIMUM_ATTEMPTS = 4;

    /** Content-Range 响应头里本段内容的起始位置 */
    private static final Pattern CONTENT_RANGE_START = Pattern.compile("^bytes\\s+(\\d+)");

    /** 结果媒体重试前的等待，第 N 次失败后等 N 倍；测试里调成 0 */
    Duration resultMediaRetryDelay = Duration.ofSeconds(2);

    /** 模型列表响应日志最大字符数 */
    private static final int MODEL_RESPONSE_LOG_MAXIMUM_CHARACTERS = 4000;

    /** 远程媒体下载客户端 */
    private final HttpClient remoteMediaHttpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(30))
            .followRedirects(HttpClient.Redirect.ALWAYS)
            .build();

    /**
     * Anthropic流式SSE事件
     *
     * @param event String 事件类型
     * @param data JSONObject 事件数据
     */
    public record AnthropicStreamEvent(String event, JSONObject data) {
    }

    /**
     * 发送OpenAI兼容JSON请求
     *
     * @param channel AiChannelConfig 渠道配置
     * @param method String HTTP方法
     * @param path String 请求路径
     * @param payload Object 请求体
     * @return Mono<JSONObject> 响应JSON
     */
    public Mono<JSONObject> sendJsonRequest(AiTaskDtos.AiChannelConfig channel, String method, String path, Object payload) {
        return Mono.defer(() -> {
            String normalizedMethod = normalizeRequestMethod(method);
            return ensureProviderRequestAccepted(normalizedMethod).then(callBlocking(() -> {
            String url = buildAiUrl(channel.baseUrl(), path);
            String jsonBody = "POST".equals(normalizedMethod) ? AiJsonUtils.toJson(payload) : "";
            log.info("AI请求: {} {} body={}", normalizedMethod, url, jsonBody.length() > 10000 ? jsonBody.substring(0, 10000) + "..." : jsonBody);
            HttpRequest.Builder builder = baseBearerRequest(channel, path).header("Content-Type", "application/json");
            applyRequestMethod(builder, normalizedMethod, jsonBody);
            HttpResponse<String> response = httpClient.send(builder.build(), HttpResponse.BodyHandlers.ofString());
            String stage = requestStage(normalizedMethod);
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                // 失败响应没有下游解析日志，这里保留状态码与原始响应体便于定位供应商问题。
                log.info("AI响应 状态码: {} body:{}", response.statusCode(), abbreviateResponseForLog(response.body()));
                throw AiErrorSupport.providerException(response.statusCode(), response.body(), stage);
            }
            JSONObject json = parseResponseBody(response.body(), stage);
            log.info("AI响应: {}", AiJsonUtils.formatResponseForLog(json));
            AiJsonUtils.validateEnvelope(json, stage);
            return json;
            }));
        });
    }

    /**
     * 解析AI响应体，非法JSON必须显性报错。
     * <p>
     * 不复用AiJsonUtils.parseJson的静默降级：供应商返回成功状态码但响应体不完整或不是合法JSON时，
     * 降级为空对象会被下游当成"没有内容的成功响应"，最终静默产出空结果
     * （例如文本任务写入空内容，画布文本节点表现为空白节点）。
     *
     * @param body String 响应体
     * @param stage String 调用阶段
     * @return JSONObject 响应JSON
     */
    private JSONObject parseResponseBody(String body, String stage) {
        if (!StringUtils.hasText(body)) return new JSONObject();
        try {
            JSONObject parsed = JSON.parseObject(body);
            return parsed == null ? new JSONObject() : parsed;
        } catch (Exception exception) {
            log.error("AI响应体解析失败: stage={}, bodyLength={}, body={}, 错误={}", stage, body.length(),
                    abbreviateResponseForLog(body), exception.getMessage());
            throw AiErrorSupport.malformedResponse(stage);
        }
    }

    /**
     * 截断过长的响应体，避免日志被大对象撑爆。
     *
     * @param body String 响应体
     * @return String 用于日志的响应体片段
     */
    private static String abbreviateResponseForLog(String body) {
        if (body == null) return "";
        return body.length() > MODEL_RESPONSE_LOG_MAXIMUM_CHARACTERS
                ? body.substring(0, MODEL_RESPONSE_LOG_MAXIMUM_CHARACTERS) + "..." : body;
    }

    /**
     * 发送流式JSON请求并逐行读取SSE响应
     *
     * @param channel AiChannelConfig 渠道配置
     * @param path String 请求路径
     * @param payload Object 请求体
     * @return Flux<String> SSE响应中每条data行的JSON文本，去除了data:前缀
     */
    public Flux<String> sendStreamingJsonRequest(AiTaskDtos.AiChannelConfig channel, String path, Object payload) {
        // SSE为长连接流式响应，使用sendAsync配合BodyHandlers.ofLines，避免send阻塞调用线程直到流结束。
        if (!StringUtils.hasText(channel.apiKey())) {
            return Flux.error(new BusinessException(ErrorCode.BUSINESS_ERROR, SystemMessage.of("business.serverAIChannelHasNoAPIKey")));
        }
        HttpRequest request = baseBearerRequest(channel, path)
                .header("Content-Type", "application/json")
                .header("Accept", "text/event-stream")
                .POST(HttpRequest.BodyPublishers.ofString(AiJsonUtils.toJson(payload)))
                .build();
        return Mono.fromFuture(httpClient.sendAsync(request, HttpResponse.BodyHandlers.ofLines()))
                .subscribeOn(Schedulers.boundedElastic())
                .flatMapMany(response -> {
                    if (response.statusCode() < 200 || response.statusCode() >= 300) {
                        String errorBody;
                        try (var lines = response.body()) {
                            errorBody = lines.collect(Collectors.joining("\n"));
                        }
                        return Flux.error(AiErrorSupport.providerException(
                                response.statusCode(), errorBody, "submission"));
                    }
                    String contentType = response.headers().firstValue("Content-Type").orElse("");
                    if (!contentType.toLowerCase().contains("text/event-stream")) {
                        try (var lines = response.body()) {
                            lines.close();
                        }
                        return Flux.error(new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, SystemMessage.of("business.channelDoesNotSupportStreaming")));
                    }
                    // SSE响应体按行推送，每条data行去除前缀后作为JSON文本发出，空行和注释行被过滤。
                    return Flux.using(response::body, Flux::fromStream, stream -> stream.close())
                            .map(String::strip)
                            .filter(line -> line.startsWith("data:"))
                            .map(line -> line.substring(5).strip())
                            .filter(StringUtils::hasText);
                });
    }

    /**
     * 发送Anthropic流式JSON请求并解析SSE事件对
     * <p>
     * Anthropic SSE格式与OpenAI不同：每条事件包含event行和data行两行，
     * 需要配对读取后返回结构化的事件对象。
     *
     * @param channel AiChannelConfig 渠道配置
     * @param path String 请求路径
     * @param payload Object 请求体
     * @return Flux<AnthropicStreamEvent> 配对后的SSE事件流
     */
    public Flux<AnthropicStreamEvent> sendAnthropicStreamingRequest(AiTaskDtos.AiChannelConfig channel, String path, Object payload) {
        if (!StringUtils.hasText(channel.apiKey())) {
            return Flux.error(new BusinessException(ErrorCode.BUSINESS_ERROR, SystemMessage.of("business.serverAIChannelHasNoAPIKey")));
        }
        HttpRequest request = HttpRequest.newBuilder(URI.create(buildAnthropicUrl(channel.baseUrl(), path)))
                .timeout(Duration.ofMinutes(10))
                .header("x-api-key", channel.apiKey().trim())
                .header("anthropic-version", "2023-06-01")
                .header("Content-Type", "application/json")
                .header("Accept", "text/event-stream")
                .POST(HttpRequest.BodyPublishers.ofString(AiJsonUtils.toJson(payload)))
                .build();
        log.info("Anthropic请求: POST {} body={}", request.uri(), AiJsonUtils.toJson(payload));
        return Mono.fromFuture(httpClient.sendAsync(request, HttpResponse.BodyHandlers.ofLines()))
                .subscribeOn(Schedulers.boundedElastic())
                .flatMapMany(response -> {
                    if (response.statusCode() < 200 || response.statusCode() >= 300) {
                        String errorBody;
                        try (var lines = response.body()) {
                            errorBody = lines.collect(Collectors.joining("\n"));
                        }
                        return Flux.error(AiErrorSupport.providerException(
                                response.statusCode(), errorBody, "submission"));
                    }
                    String contentType = response.headers().firstValue("Content-Type").orElse("");
                    if (!contentType.toLowerCase().contains("text/event-stream")) {
                        try (var lines = response.body()) {
                            lines.close();
                        }
                        return Flux.error(new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, SystemMessage.of("business.anthropicChannelDoesNotSupportStreaming")));
                    }
                    return Flux.using(response::body, Flux::fromStream, stream -> stream.close())
                            .map(String::strip)
                            .filter(StringUtils::hasText)
                            .scan(new Object[]{null, null}, (prev, line) -> {
                                if (line.startsWith("event:")) {
                                    return new Object[]{line.substring(6).strip(), null};
                                } else if (line.startsWith("data:")) {
                                    return new Object[]{prev[0], line.substring(5).strip()};
                                }
                                return new Object[]{prev[0], prev[1]};
                            })
                            .filter(state -> state[0] != null && state[1] != null)
                            .map(state -> new AnthropicStreamEvent((String) state[0], AiJsonUtils.parseJson((String) state[1])));
                });
    }

    /**
     * 发送Anthropic非流式JSON请求并解析响应
     * <p>
     * 使用x-api-key和anthropic-version鉴权头，与sendAnthropicStreamingRequest保持一致。
     * 用于Agent对话等需要同步响应的场景。
     *
     * @param channel AiChannelConfig 渠道配置
     * @param path String 请求路径（如/v1/messages）
     * @param payload Object 请求体
     * @return Mono<JSONObject> 响应JSON
     */
    public Mono<JSONObject> sendAnthropicJsonRequest(AiTaskDtos.AiChannelConfig channel, String path, Object payload) {
        return callBlocking(() -> {
            if (!StringUtils.hasText(channel.apiKey())) {
                throw new BusinessException(ErrorCode.BUSINESS_ERROR, SystemMessage.of("business.serverAIChannelHasNoAPIKey"));
            }
            String url = buildAnthropicUrl(channel.baseUrl(), path);
            String jsonBody = AiJsonUtils.toJson(payload);
            log.info("Anthropic请求: POST {} body={}", url, jsonBody.length() > 2000 ? jsonBody.substring(0, 2000) + "..." : jsonBody);
            HttpRequest request = HttpRequest.newBuilder(URI.create(url))
                    .timeout(Duration.ofMinutes(10))
                    .header("x-api-key", channel.apiKey().trim())
                    .header("anthropic-version", "2023-06-01")
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(jsonBody))
                    .build();
            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            String body = response.body();
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                throw AiErrorSupport.providerException(response.statusCode(), body, "submission");
            }
            log.info("Anthropic响应: {}", body);
            return AiJsonUtils.parseJson(body);
        });
    }

    /**
     *
     * @param channel AiChannelConfig 渠道配置
     * @param path String 请求路径
     * @param boundary String multipart边界
     * @param parts List<MultipartPart> 请求片段
     * @return Mono<JSONObject> 响应JSON
     */
    public Mono<JSONObject> sendMultipartRequest(AiTaskDtos.AiChannelConfig channel, String path, String boundary, List<MultipartPart> parts) {
        return ensureProviderRequestAccepted("POST").then(callBlocking(() -> {
            HttpRequest request = baseBearerRequest(channel, path)
                    .POST(multipartPublisher(boundary, parts))
                    .header("Content-Type", "multipart/form-data; boundary=" + boundary)
                    .build();
            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                throw AiErrorSupport.providerException(response.statusCode(), response.body(), "submission");
            }
            JSONObject json = AiJsonUtils.parseJson(response.body());
            AiJsonUtils.validateEnvelope(json, "submission");
            return json;
        }));
    }

    /**
     * 下载OpenAI兼容接口二进制结果
     *
     * @param channel AiChannelConfig 渠道配置
     * @param path String 请求路径
     * @return Mono<GeneratedBinary> 二进制结果
     */
    public Mono<GeneratedBinary> downloadBinary(AiTaskDtos.AiChannelConfig channel, String path) {
        return callBlocking(() -> {
            HttpRequest request = baseBearerRequest(channel, path).GET().build();
            HttpResponse<byte[]> response = httpClient.send(request, HttpResponse.BodyHandlers.ofByteArray());
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                throw AiErrorSupport.providerException(response.statusCode(),
                        new String(response.body(), StandardCharsets.UTF_8), "download");
            }
            String mimeType = response.headers().firstValue("Content-Type").orElse("application/octet-stream");
            return new GeneratedBinary(response.body(), mimeType);
        });
    }

    /**
     * 发送OpenAI兼容JSON请求并读取二进制响应
     *
     * @param channel AiChannelConfig 渠道配置
     * @param path String 请求路径
     * @param payload Object 请求体
     * @param defaultMimeType String 默认MIME类型
     * @param errorPrefix String 错误提示前缀
     * @return Mono<GeneratedBinary> 二进制响应
     */
    public Mono<GeneratedBinary> postJsonForBinary(AiTaskDtos.AiChannelConfig channel, String path, Object payload, String defaultMimeType, String errorPrefix) {
        return ensureProviderRequestAccepted("POST").then(callBlocking(() -> {
            HttpRequest request = baseBearerRequest(channel, path)
                    .POST(HttpRequest.BodyPublishers.ofString(AiJsonUtils.toJson(payload)))
                    .header("Content-Type", "application/json")
                    .build();
            HttpResponse<byte[]> response = httpClient.send(request, HttpResponse.BodyHandlers.ofByteArray());
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                throw AiErrorSupport.providerException(response.statusCode(),
                        new String(response.body(), StandardCharsets.UTF_8), "submission");
            }
            String mimeType = response.headers().firstValue("Content-Type").orElse(defaultMimeType);
            return new GeneratedBinary(response.body(), mimeType);
        }));
    }

    /**
     * 发送带Bearer鉴权的完整URL JSON请求
     *
     * @param channel AiChannelConfig 渠道配置
     * @param method String HTTP方法
     * @param url String 完整URL
     * @param payload Object 请求体
     * @return Mono<JSONObject> 响应JSON
     */
    public Mono<JSONObject> sendBearerJsonUrlRequest(AiTaskDtos.AiChannelConfig channel, String method, String url, Object payload) {
        return Mono.defer(() -> {
            String normalizedMethod = normalizeRequestMethod(method);
            return ensureProviderRequestAccepted(normalizedMethod).then(callBlocking(() -> {
            if (!StringUtils.hasText(channel.apiKey())) {
                throw new BusinessException(ErrorCode.BUSINESS_ERROR, SystemMessage.of("business.serverAIChannelHasNoAPIKey"));
            }
            String jsonBody = "POST".equals(normalizedMethod) ? AiJsonUtils.toJson(payload) : "";
            HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create(url))
                    .timeout(Duration.ofMinutes(10))
                    .header("Authorization", "Bearer " + channel.apiKey().trim())
                    .header("Content-Type", "application/json");
            applyRequestMethod(builder, normalizedMethod, jsonBody);
            HttpResponse<String> response = httpClient.send(builder.build(), HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                throw AiErrorSupport.providerException(response.statusCode(), response.body(), requestStage(normalizedMethod));
            }
            JSONObject json = AiJsonUtils.parseJson(response.body());
            AiJsonUtils.validateEnvelope(json, requestStage(normalizedMethod));
            return json;
            }));
        });
    }

    /**
     * 将已校验的HTTP方法应用到JSON请求构建器。
     *
     * @param builder HttpRequest.Builder 请求构建器
     * @param method String 规范化HTTP方法
     * @param jsonBody String POST请求体
     */
    private static void applyRequestMethod(HttpRequest.Builder builder, String method, String jsonBody) {
        switch (method) {
            case "POST" -> builder.POST(HttpRequest.BodyPublishers.ofString(jsonBody));
            case "GET" -> builder.GET();
            case "DELETE" -> builder.DELETE();
            default -> throw new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.unsupportedAIHTTPMethod", method));
        }
    }

    /**
     * 规范化并校验AI接口HTTP方法。
     *
     * @param method String 原始HTTP方法
     * @return String GET、POST或DELETE
     */
    private static String normalizeRequestMethod(String method) {
        String normalizedMethod = StringUtils.hasText(method) ? method.trim().toUpperCase(Locale.ROOT) : "";
        if (!Set.of("GET", "POST", "DELETE").contains(normalizedMethod)) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.unsupportedAIHTTPMethod", normalizedMethod));
        }
        return normalizedMethod;
    }

    /**
     * 发送Gemini JSON请求
     *
     * @param channel AiChannelConfig 渠道配置
     * @param path String Gemini路径
     * @param payload Object 请求体
     * @return Mono<JSONObject> 响应JSON
     */
    public Mono<JSONObject> sendGeminiJsonRequest(AiTaskDtos.AiChannelConfig channel, String path, Object payload) {
        return ensureProviderRequestAccepted("POST").then(callBlocking(() -> {
            if (!StringUtils.hasText(channel.apiKey())) {
                throw new BusinessException(ErrorCode.BUSINESS_ERROR, SystemMessage.of("business.serverAIChannelHasNoAPIKey"));
            }
            HttpRequest request = HttpRequest.newBuilder(URI.create(buildGeminiUrl(channel.baseUrl(), path)))
                    .timeout(Duration.ofMinutes(10))
                    .POST(HttpRequest.BodyPublishers.ofString(AiJsonUtils.toJson(payload)))
                    .header("x-goog-api-key", channel.apiKey().trim())
                    .header("Content-Type", "application/json")
                    .build();
            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                throw AiErrorSupport.providerException(response.statusCode(), response.body(), "submission");
            }
            JSONObject json = AiJsonUtils.parseJson(response.body());
            JSONObject error = json.getJSONObject("error");
            if (error != null && StringUtils.hasText(error.getString("message"))) {
                throw AiErrorSupport.providerException(400, json.toJSONString(), "submission");
            }
            JSONObject promptFeedback = json.getJSONObject("promptFeedback");
            if (promptFeedback != null && StringUtils.hasText(promptFeedback.getString("blockReason"))) {
                throw AiErrorSupport.providerException(400, json.toJSONString(), "submission");
            }
            return json;
        }));
    }

    /**
     * 根据HTTP方法判断供应商调用阶段。
     *
     * @param method String HTTP方法
     * @return String submission或polling
     */
    private static String requestStage(String method) {
        return "POST".equals(method) ? "submission" : "polling";
    }

    /**
     * 图片和视频任务在发出供应商请求前先落库。任务已经取消时不再发送。
     *
     * @param method String 规范化HTTP方法
     * @return Mono<Void> 可以继续发送
     */
    private Mono<Void> ensureProviderRequestAccepted(String method) {
        if (!"POST".equals(method)) {
            return Mono.empty();
        }
        return AiProviderRequestTracking.markIfPresent()
                .flatMap(accepted -> Boolean.TRUE.equals(accepted)
                        ? Mono.empty()
                        : Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, SystemMessage.of("business.taskCanceled"))));
    }

    /**
     * 从第三方渠道拉取可用模型列表。
     *
     * @param baseUrl String 渠道基础地址
     * @param apiKey String 渠道API Key
     * @param apiFormat String 渠道调用格式
     * @return Mono<List<String>> 去重并排序后的模型名称
     */
    /**
     * 渠道模型拉取结果。
     *
     * @param models List<String> 去重并排序后的模型名称列表
     * @param modelGroups Map<String, List<String>> 模型到分组标识列表的映射
     */
    public record ChannelModelsResult(List<String> models, Map<String, List<String>> modelGroups) {
    }

    /**
     * 拉取第三方渠道模型名称列表。
     *
     * @param baseUrl String 渠道基础地址
     * @param apiKey String 渠道密钥
     * @param apiFormat String 调用格式
     * @return Mono<List<String>> 去重并排序后的模型名称
     */
    public Mono<List<String>> fetchChannelModels(String baseUrl, String apiKey, String apiFormat) {
        return fetchChannelModelList(baseUrl, apiKey, apiFormat).map(ChannelModelsResult::models);
    }

    /**
     * 拉取第三方渠道模型列表及分组元数据。
     *
     * @param baseUrl String 渠道基础地址
     * @param apiKey String 渠道密钥
     * @param apiFormat String 调用格式
     * @return Mono<ChannelModelsResult> 模型名称列表与模型分组映射
     */
    public Mono<ChannelModelsResult> fetchChannelModelList(String baseUrl, String apiKey, String apiFormat) {
        return Mono.defer(() -> {
            String normalizedFormat = normalizeModelApiFormat(apiFormat);
            if ("minimax".equals(normalizedFormat)) {
                return Mono.<ChannelModelsResult>error(new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.miniMaxCannotFetchModelsConfigureMiniMaxH3Manually")));
            }
            if ("custom".equals(normalizedFormat)) {
                return Mono.<ChannelModelsResult>error(new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.customChannelsCannotFetchModelsConfigureThemManually")));
            }
            return callBlocking(() -> {
                URI uri = buildModelListUri(baseUrl, normalizedFormat);
                if (!StringUtils.hasText(apiKey)) {
                    throw new BusinessException(ErrorCode.PARAM_MISSING, SystemMessage.of("business.aPIKeyIsRequired"));
                }
                HttpRequest.Builder requestBuilder = HttpRequest.newBuilder(uri)
                        .timeout(Duration.ofSeconds(30))
                        .header("Accept", "application/json")
                        .GET();
                String safeHeaders;
                if ("gemini".equals(normalizedFormat)) {
                    requestBuilder.header("x-goog-api-key", apiKey.trim());
                    safeHeaders = "Accept=application/json, x-goog-api-key=***";
                } else if ("anthropic".equals(normalizedFormat)) {
                    requestBuilder.header("x-api-key", apiKey.trim())
                            .header("anthropic-version", "2023-06-01");
                    safeHeaders = "Accept=application/json, x-api-key=***, anthropic-version=2023-06-01";
                } else {
                    requestBuilder.header("Authorization", "Bearer " + apiKey.trim());
                    safeHeaders = "Accept=application/json, Authorization=Bearer ***";
                }
                try {
                    log.info("渠道模型拉取请求: apiFormat={}, url={}, headers={}", normalizedFormat, uri, safeHeaders);
                    HttpResponse<String> response = httpClient.send(requestBuilder.build(), HttpResponse.BodyHandlers.ofString());
                    String responseBody = response.body() == null ? "" : response.body();
                    String safeResponseBody = sanitizeModelResponse(responseBody, apiKey);
                    log.info("渠道模型拉取响应: apiFormat={}, url={}, status={}, body={}", normalizedFormat, uri,
                            response.statusCode(), abbreviateModelResponse(safeResponseBody));
                    if (response.statusCode() < 200 || response.statusCode() >= 300) {
                        throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, SystemMessage.of("business.failedToFetchModelsHTTP", response.statusCode(), readModelErrorMessage(safeResponseBody)));
                    }
                    ChannelModelsResult result;
                    try {
                        result = parseChannelModels(responseBody, normalizedFormat);
                    } catch (BusinessException exception) {
                        throw new BusinessException(exception.getCode(), sanitizeModelResponse(exception.getMessage(), apiKey));
                    }
                    if (result.models().isEmpty()) {
                        throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, SystemMessage.of("business.channelReturnedNoAvailableModels"));
                    }
                    return result;
                } catch (BusinessException exception) {
                    throw exception;
                } catch (InterruptedException exception) {
                    Thread.currentThread().interrupt();
                    throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, SystemMessage.of("business.modelRequestInterrupted"));
                } catch (Exception exception) {
                    throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, SystemMessage.of("business.failedToFetchModels", exception.getMessage()));
                }
            });
        });
    }

    /**
     * 下载远程媒体二进制内容
     *
     * @param url String 远程媒体地址
     * @param defaultMimeType String 默认MIME类型
     * @return Mono<GeneratedBinary> 二进制内容
     */
    public Mono<GeneratedBinary> downloadRemoteBinary(String url, String defaultMimeType) {
        return downloadRemoteBinary(url, defaultMimeType, Duration.ofMinutes(5), null);
    }

    /**
     * 下载远程媒体二进制内容，读取阶段受总体时限约束。
     * <p>
     * 上游媒体站被限速时单次读取会一直阻塞，请求超时只覆盖响应头，必须自己按截止时间中断读取。
     *
     * @param url String 远程媒体地址
     * @param defaultMimeType String 默认MIME类型
     * @param budget Duration 连接、响应和读取的总时限
     * @return Mono<GeneratedBinary> 二进制内容
     */
    public Mono<GeneratedBinary> downloadRemoteBinary(String url, String defaultMimeType, Duration budget) {
        return downloadRemoteBinary(url, defaultMimeType, budget, budget);
    }

    /**
     * 下载远程媒体二进制内容
     *
     * @param url String 远程媒体地址
     * @param defaultMimeType String 默认MIME类型
     * @param requestTimeout Duration 请求超时
     * @param readBudget Duration 读取时限，为空表示不限
     * @return Mono<GeneratedBinary> 二进制内容
     */
    private Mono<GeneratedBinary> downloadRemoteBinary(String url, String defaultMimeType, Duration requestTimeout, Duration readBudget) {
        return callBlocking(() -> {
            URI uri = validateRemoteMediaUri(url);
            HttpRequest request = HttpRequest.newBuilder(uri).timeout(requestTimeout).GET().build();
            long readDeadlineNanos = readBudget == null ? Long.MAX_VALUE : System.nanoTime() + readBudget.toNanos();
            HttpResponse<InputStream> response = remoteMediaHttpClient.send(request, HttpResponse.BodyHandlers.ofInputStream());
            try (InputStream inputStream = response.body()) {
                if (response.statusCode() < 200 || response.statusCode() >= 300) {
                    throw AiErrorSupport.providerException(response.statusCode(), "", "download");
                }
                long contentLength = response.headers().firstValueAsLong("Content-Length").orElse(-1L);
                if (contentLength > MAXIMUM_REMOTE_MEDIA_BYTES) {
                    throw new BusinessException(ErrorCode.BUSINESS_ERROR, SystemMessage.of("business.remoteMediaExceeds100MB"));
                }
                String mimeType = response.headers().firstValue("Content-Type").orElse(defaultMimeType);
                return new GeneratedBinary(readLimitedMediaData(inputStream, readDeadlineNanos), AiTaskParameterReader.firstNonEmpty(mimeType, defaultMimeType));
            }
        });
    }

    /**
     * 将远程媒体流式下载到本地文件。
     * <p>
     * 此方法仅接受已经通过媒体URL校验的HTTP(S)地址，下载过程不将完整视频加载到JVM堆内存。
     *
     * @param url String 远程媒体地址
     * @param defaultMimeType String 默认MIME类型
     * @param target Path 本地目标文件
     * @param maximumBytes long 允许下载的最大字节数
     * @return Mono<RemoteMediaFile> 已下载媒体信息
     */
    public Mono<RemoteMediaFile> downloadRemoteMediaToFile(String url, String defaultMimeType, Path target, long maximumBytes) {
        return callBlocking(() -> {
            if (maximumBytes < 1) {
                throw new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.maximumRemoteMediaBytesMustBePositive"));
            }
            URI uri = validateRemoteMediaUri(url);
            Files.createDirectories(target.toAbsolutePath().getParent());
            int attempt = 0;
            while (true) {
                attempt++;
                long received = Files.exists(target) ? Files.size(target) : 0L;
                try {
                    ResultMediaDownload download = openResultMedia(uri, received, Duration.ofMinutes(10), maximumBytes, defaultMimeType);
                    long bytes = download.startOffset();
                    try (InputStream inputStream = download.body();
                         OutputStream outputStream = download.startOffset() == 0
                                 ? Files.newOutputStream(target, StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING, StandardOpenOption.WRITE)
                                 : Files.newOutputStream(target, StandardOpenOption.CREATE, StandardOpenOption.APPEND, StandardOpenOption.WRITE)) {
                        byte[] buffer = new byte[8192];
                        int readBytes;
                        while ((readBytes = inputStream.read(buffer)) != -1) {
                            bytes += readBytes;
                            if (bytes > maximumBytes) {
                                throw new BusinessException(ErrorCode.BUSINESS_ERROR, SystemMessage.of("business.sourceVideoExceedsTheSizeLimit"));
                            }
                            outputStream.write(buffer, 0, readBytes);
                        }
                    }
                    return new RemoteMediaFile(bytes, download.mimeType());
                } catch (Exception exception) {
                    if (attempt < RESULT_MEDIA_MAXIMUM_ATTEMPTS && isRetryableResultMediaFailure(exception)) {
                        log.warn("结果媒体下载中断，第 {} 次续传: url={}, received={}, reason={}", attempt, uri, received, exception.toString());
                        Thread.sleep(resultMediaRetryDelay.toMillis() * attempt);
                        continue;
                    }
                    Files.deleteIfExists(target);
                    throw exception;
                }
            }
        });
    }

    /**
     * 发起一次结果媒体下载，已收到部分内容时用 Range 从断点续传。
     *
     * @param uri URI 已校验的媒体地址
     * @param offset long 已经收到并落盘的字节数，0 表示从头下载
     * @param timeout Duration 单次请求超时
     * @param maximumBytes long 允许下载的最大字节数
     * @param defaultMimeType String 响应没有 Content-Type 时使用的默认类型
     * @return ResultMediaDownload 响应流与本次数据的起始位置
     * @throws IOException 连接失败、读取失败或续传响应不合规时抛出
     * @throws InterruptedException 线程被中断时抛出
     */
    private ResultMediaDownload openResultMedia(URI uri, long offset, Duration timeout, long maximumBytes, String defaultMimeType)
            throws IOException, InterruptedException {
        HttpRequest.Builder builder = HttpRequest.newBuilder(uri).timeout(timeout).GET();
        if (offset > 0) {
            builder.header("Range", "bytes=" + offset + "-");
        }
        HttpResponse<InputStream> response = remoteMediaHttpClient.send(builder.build(), HttpResponse.BodyHandlers.ofInputStream());
        int status = response.statusCode();
        if (status != 200 && status != 206) {
            try (InputStream inputStream = response.body()) {
                throw AiErrorSupport.providerException(status, "", "download");
            }
        }
        long startOffset = 0L;
        if (status == 206) {
            // 只有服务端明确从断点开始返回剩余内容才允许追加写，否则文件会错位。
            Optional<String> contentRange = response.headers().firstValue("Content-Range");
            Matcher matcher = contentRange.map(CONTENT_RANGE_START::matcher).orElse(null);
            if (matcher == null || !matcher.find() || Long.parseLong(matcher.group(1)) != offset) {
                response.body().close();
                throw new IOException("续传响应与断点不一致: offset=" + offset + ", contentRange=" + contentRange.orElse(""));
            }
            startOffset = offset;
        }
        long contentLength = response.headers().firstValueAsLong("Content-Length").orElse(-1L);
        if (contentLength > 0 && startOffset + contentLength > maximumBytes) {
            response.body().close();
            throw new BusinessException(ErrorCode.BUSINESS_ERROR, SystemMessage.of("business.sourceVideoExceedsTheSizeLimit"));
        }
        String mimeType = AiTaskParameterReader.firstNonEmpty(response.headers().firstValue("Content-Type").orElse(defaultMimeType), defaultMimeType);
        return new ResultMediaDownload(response.body(), startOffset, mimeType);
    }

    /**
     * 判断结果媒体下载失败是否值得续传：连接或读取中断、限流、服务端 5xx 可以重试，
     * 地址失效、鉴权失败这类再试也没用的直接失败。
     *
     * @param exception Exception 本次下载抛出的异常
     * @return boolean 值得续传时为 true
     */
    private static boolean isRetryableResultMediaFailure(Exception exception) {
        if (exception instanceof AiProviderException providerException) {
            Integer status = providerException.getDetails() == null ? null : providerException.getDetails().httpStatus();
            return status == null || status == 429 || status >= 500;
        }
        return exception instanceof IOException;
    }

    /**
     * 经远程媒体地址校验后，以数据流方式转发媒体。
     * @param url 媒体下载地址
     * @return 媒体数据流
     */
    public Flux<DataBuffer> streamRemoteMedia(String url) {
        return Flux.using(() -> {
            URI uri = validateRemoteMediaUri(url);
            HttpRequest request = HttpRequest.newBuilder(uri).timeout(Duration.ofMinutes(15)).GET().build();
            try {
                HttpResponse<InputStream> response = remoteMediaHttpClient.send(request, HttpResponse.BodyHandlers.ofInputStream());
                if (response.statusCode() < 200 || response.statusCode() >= 300) {
                    response.body().close();
                    throw new BusinessException(ErrorCode.BUSINESS_ERROR, "导出视频下载源不可用");
                }
                return response.body();
            } catch (InterruptedException exception) {
                Thread.currentThread().interrupt();
                throw new BusinessException(ErrorCode.BUSINESS_ERROR, "导出视频下载已中断");
            } catch (java.io.IOException exception) {
                throw new BusinessException(ErrorCode.BUSINESS_ERROR, "导出视频下载失败");
            }
        }, stream -> DataBufferUtils.readInputStream(() -> stream, new DefaultDataBufferFactory(), 65536),
                stream -> {
                    try { stream.close(); } catch (Exception ignored) { /* 连接释放失败由HTTP客户端处理。 */ }
                });
    }

    /**
     * 校验远程媒体地址格式。
     *
     * @param url String 远程媒体地址
     * @return Mono<Void> 校验通过时完成信号
     */
    public Mono<Void> validateRemoteMediaUrl(String url) {
        return callBlocking(() -> validateRemoteMediaUri(url)).then();
    }

    /**
     * 读取远程媒体响应头。
     *
     * @param url String 远程媒体地址
     * @return Mono<RemoteMediaHeaders> 媒体响应头
     */
    public Mono<RemoteMediaHeaders> readRemoteMediaHeaders(String url) {
        return callBlocking(() -> {
            URI uri = validateRemoteMediaUri(url);
            HttpRequest request = HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(15)).method("HEAD", HttpRequest.BodyPublishers.noBody()).build();
            HttpResponse<Void> response = remoteMediaHttpClient.send(request, HttpResponse.BodyHandlers.discarding());
            if (response.statusCode() < 200 || response.statusCode() >= 400) {
                return new RemoteMediaHeaders(null, null);
            }
            Long bytes = response.headers().firstValueAsLong("Content-Length").isPresent() ? response.headers().firstValueAsLong("Content-Length").getAsLong() : null;
            String mimeType = response.headers().firstValue("Content-Type").orElse(null);
            return new RemoteMediaHeaders(bytes, mimeType);
        }).onErrorReturn(new RemoteMediaHeaders(null, null));
    }

    /**
     * 校验并解析远程媒体地址。
     *
     * @param url String 远程媒体地址
     * @return URI 校验通过的HTTP(S)地址
     * @throws BusinessException 地址为空或格式不合法时抛出
     */
    private URI validateRemoteMediaUri(String url) {
        if (!StringUtils.hasText(url)) {
            throw new BusinessException(ErrorCode.PARAM_MISSING, SystemMessage.of("business.remoteMediaURLIsRequired"));
        }
        URI uri;
        try {
            uri = URI.create(url.trim());
        } catch (IllegalArgumentException exception) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.invalidRemoteMediaURL"));
        }
        if ((!"http".equalsIgnoreCase(uri.getScheme()) && !"https".equalsIgnoreCase(uri.getScheme())) || !StringUtils.hasText(uri.getHost())) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.remoteMediaSupportsHTTPAndHTTPSOnly"));
        }
        return uri;
    }

    /**
     * 规范化并校验模型接口调用格式。
     *
     * @param apiFormat String 原始调用格式
     * @return String 规范化后的调用格式
     * @throws BusinessException 调用格式为空或不受支持时抛出
     */
    private String normalizeModelApiFormat(String apiFormat) {
        if (!StringUtils.hasText(apiFormat)) {
            throw new BusinessException(ErrorCode.PARAM_MISSING, SystemMessage.of("business.aPIFormatIsRequired"));
        }
        String normalizedFormat = apiFormat.trim().toLowerCase(Locale.ROOT);
        Set<String> supportedFormats = Set.of("openai", "nana", "newapi", "evolink", "gemini", "anthropic", "agnes", "seedance", "minimax", "custom");
        if (!supportedFormats.contains(normalizedFormat)) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.unsupportedAPIFormat", normalizedFormat));
        }
        return normalizedFormat;
    }

    /**
     * 构建并校验模型列表接口地址。
     *
     * @param baseUrl String 渠道基础地址
     * @param apiFormat String 规范化后的调用格式
     * @return URI 模型列表接口地址
     * @throws BusinessException 地址为空或格式不合法时抛出
     */
    private URI buildModelListUri(String baseUrl, String apiFormat) {
        if (!StringUtils.hasText(baseUrl)) {
            throw new BusinessException(ErrorCode.PARAM_MISSING, SystemMessage.of("business.baseURLIsRequired"));
        }
        String url = switch (apiFormat) {
            case "gemini" -> buildGeminiUrl(baseUrl, "/models");
            case "anthropic" -> buildAnthropicUrl(baseUrl, "/v1/models");
            case "nana" -> buildAiUrl(buildNanaBaseUrl(baseUrl), "/models");
            default -> buildAiUrl(baseUrl, "/models");
        };
        try {
            URI uri = URI.create(url);
            if ((!"http".equalsIgnoreCase(uri.getScheme()) && !"https".equalsIgnoreCase(uri.getScheme()))
                    || !StringUtils.hasText(uri.getHost())) {
                throw new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.baseURLSupportsHTTPAndHTTPSOnly"));
            }
            return uri;
        } catch (BusinessException exception) {
            throw exception;
        } catch (IllegalArgumentException exception) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.invalidBaseURL"));
        }
    }

    /**
     * 解析不同渠道格式的模型列表响应。
     *
     * @param responseBody String 第三方响应内容
     * @param apiFormat String 规范化后的调用格式
     * @return ChannelModelsResult 去重并排序后的模型名称与模型分组映射
     * @throws BusinessException 响应不是合法JSON或模型字段格式错误时抛出
     */
    private ChannelModelsResult parseChannelModels(String responseBody, String apiFormat) {
        try {
            JSONObject response = JSON.parseObject(responseBody);
            if (response == null) {
                throw new IllegalArgumentException("响应为空");
            }
            JSONObject error = response.getJSONObject("error");
            if (error != null && StringUtils.hasText(error.getString("message"))) {
                throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, error.getString("message"));
            }
            JSONArray values = response.getJSONArray("gemini".equals(apiFormat) ? "models" : "data");
            if (values == null) {
                throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, SystemMessage.of("business.invalidChannelModelListFormat"));
            }
            TreeSet<String> models = new TreeSet<>();
            Map<String, Set<String>> groupMap = new LinkedHashMap<>();
            String modelField = "gemini".equals(apiFormat) ? "name" : "id";
            for (Object value : values) {
                if (!(value instanceof JSONObject model)) {
                    continue;
                }
                String status = model.getString("status");
                if (status != null && "shutdown".equalsIgnoreCase(status.trim())) {
                    continue;
                }
                String modelName = model.getString(modelField);
                if (StringUtils.hasText(modelName)) {
                    String normalizedName = "gemini".equals(apiFormat)
                            ? modelName.trim().replaceFirst("^models/", "")
                            : modelName.trim();
                    if (StringUtils.hasText(normalizedName)) {
                        models.add(normalizedName);
                        JSONArray groups = model.getJSONArray("groups");
                        if (groups != null && !groups.isEmpty()) {
                            Set<String> targetGroups = groupMap.computeIfAbsent(normalizedName, key -> new LinkedHashSet<>());
                            for (int index = 0; index < groups.size(); index++) {
                                String group = groups.getString(index);
                                if (StringUtils.hasText(group)) {
                                    targetGroups.add(group.trim());
                                }
                            }
                        }
                    }
                }
            }
            Map<String, List<String>> modelGroups = new LinkedHashMap<>();
            for (Map.Entry<String, Set<String>> entry : groupMap.entrySet()) {
                if (!entry.getValue().isEmpty()) {
                    modelGroups.put(entry.getKey(), new ArrayList<>(entry.getValue()));
                }
            }
            return new ChannelModelsResult(new ArrayList<>(models), modelGroups);
        } catch (BusinessException exception) {
            throw exception;
        } catch (Exception exception) {
            throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, SystemMessage.of("business.channelModelListIsNotValidJSON"));
        }
    }

    /**
     * 从第三方错误响应中读取可展示消息。
     *
     * @param responseBody String 第三方响应内容
     * @return String 错误消息
     */
    private String readModelErrorMessage(String responseBody) {
        try {
            JSONObject response = JSON.parseObject(responseBody);
            JSONObject error = response == null ? null : response.getJSONObject("error");
            if (error != null && StringUtils.hasText(error.getString("message"))) {
                return error.getString("message");
            }
            if (response != null && StringUtils.hasText(response.getString("msg"))) {
                return response.getString("msg");
            }
        } catch (Exception ignored) {
            // 非JSON错误响应直接使用受限长度的原始内容。
        }
        String abbreviated = abbreviateModelResponse(responseBody);
        return StringUtils.hasText(abbreviated) ? abbreviated : "第三方渠道未返回错误信息";
    }

    /**
     * 限制模型列表响应日志长度。
     *
     * @param responseBody String 原始响应内容
     * @return String 可安全记录的响应内容
     */
    private String abbreviateModelResponse(String responseBody) {
        if (responseBody == null || responseBody.length() <= MODEL_RESPONSE_LOG_MAXIMUM_CHARACTERS) {
            return responseBody == null ? "" : responseBody;
        }
        return responseBody.substring(0, MODEL_RESPONSE_LOG_MAXIMUM_CHARACTERS) + "...";
    }

    /**
     * 从第三方响应中移除可能回显的完整API Key。
     *
     * @param responseBody String 原始响应内容
     * @param apiKey String 当前渠道API Key
     * @return String 已脱敏的响应内容
     */
    private String sanitizeModelResponse(String responseBody, String apiKey) {
        if (!StringUtils.hasText(responseBody) || !StringUtils.hasText(apiKey)) {
            return responseBody == null ? "" : responseBody;
        }
        return responseBody.replace(apiKey.trim(), "***");
    }

    /**
     * 限制读取远程媒体数据，避免超大响应耗尽内存。
     *
     * @param inputStream InputStream 远程响应流
     * @return byte[] 已读取的媒体数据
     * @throws Exception 读取失败或超过大小限制时抛出
     */
    private byte[] readLimitedMediaData(InputStream inputStream) throws Exception {
        return readLimitedMediaData(inputStream, Long.MAX_VALUE);
    }

    /**
     * 限制读取远程媒体数据，超过截止时间立即中断。
     *
     * @param inputStream InputStream 远程响应流
     * @param readDeadlineNanos long 读取截止时间（System.nanoTime），Long.MAX_VALUE 表示不限
     * @return byte[] 已读取的媒体数据
     * @throws Exception 读取失败、超过大小限制或超时时抛出
     */
    private byte[] readLimitedMediaData(InputStream inputStream, long readDeadlineNanos) throws Exception {
        try (ByteArrayOutputStream outputStream = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            long totalBytes = 0L;
            int readBytes;
            while ((readBytes = inputStream.read(buffer)) != -1) {
                totalBytes += readBytes;
                if (totalBytes > MAXIMUM_REMOTE_MEDIA_BYTES) {
                    throw new BusinessException(ErrorCode.BUSINESS_ERROR, SystemMessage.of("business.remoteMediaExceeds100MB"));
                }
                outputStream.write(buffer, 0, readBytes);
                if (System.nanoTime() > readDeadlineNanos) {
                    throw new java.net.http.HttpTimeoutException("remote media download timed out after " + totalBytes + " bytes");
                }
            }
            return outputStream.toByteArray();
        }
    }

    /**
     * 远程媒体响应头
     *
     * @param bytes Long 文件大小
     * @param mimeType String MIME类型
     */
    public record RemoteMediaHeaders(Long bytes, String mimeType) {
    }

    /**
     * 已流式下载的远程媒体信息。
     *
     * @param bytes Long 文件字节数
     * @param mimeType String MIME类型
     */
    private record ResultMediaDownload(InputStream body, long startOffset, String mimeType) {
    }

    /**
     * 已下载的结果媒体。
     *
     * @param bytes Long 字节数
     * @param mimeType String 媒体类型
     */
    public record RemoteMediaFile(Long bytes, String mimeType) {
    }

    /**
     * 构建表单字段片段
     *
     * @param name String 字段名
     * @param value String 字段值
     * @return MultipartPart multipart片段
     */
    public MultipartPart formPart(String name, String value) {
        return new MultipartPart(name, null, null, value.getBytes(StandardCharsets.UTF_8));
    }

    /**
     * 构建文件字段片段
     *
     * @param name String 字段名
     * @param fileName String 文件名
     * @param contentType String 内容类型
     * @param data byte[] 文件内容
     * @return MultipartPart multipart片段
     */
    public MultipartPart filePart(String name, String fileName, String contentType, byte[] data) {
        return new MultipartPart(name, fileName, contentType, data);
    }

    /**
     * 构建OpenAI兼容基础请求
     *
     * @param channel AiChannelConfig 渠道配置
     * @param path String 请求路径
     * @return HttpRequest.Builder 请求构建器
     */
    private HttpRequest.Builder baseBearerRequest(AiTaskDtos.AiChannelConfig channel, String path) {
        if (!StringUtils.hasText(channel.apiKey())) {
            throw new BusinessException(ErrorCode.BUSINESS_ERROR, SystemMessage.of("business.serverAIChannelHasNoAPIKey"));
        }
        return HttpRequest.newBuilder(URI.create(buildAiUrl(channel.baseUrl(), path)))
                .timeout(Duration.ofMinutes(10))
                .header("Authorization", "Bearer " + channel.apiKey().trim());
    }

    /**
     * 构建AI接口完整地址
     *
     * @param baseUrl String 基础地址
     * @param path String 接口路径
     * @return String 完整地址
     */
    public static String buildAiUrl(String baseUrl, String path) {
        String normalized = baseUrl == null ? "" : baseUrl.trim().replaceAll("/+$", "");
        return normalized + path;
    }

    /**
     * 构建 NANA-API 的 OpenAI 兼容基础地址，缺少版本前缀时补 /v1。
     *
     * @param baseUrl String 渠道基础地址
     * @return String 带 /v1 的基础地址
     */
    public static String buildNanaBaseUrl(String baseUrl) {
        String normalized = baseUrl == null ? "" : baseUrl.trim().replaceAll("/+$", "");
        return normalized.toLowerCase(Locale.ROOT).endsWith("/v1") ? normalized : normalized + "/v1";
    }

    /**
     * 构建 NANA-API 的站点根地址，用于不带 /v1 前缀的视频协议路径。
     *
     * @param baseUrl String 渠道基础地址
     * @return String 站点根地址
     */
    public static String buildNanaOriginUrl(String baseUrl) {
        String normalized = buildNanaBaseUrl(baseUrl);
        return normalized.substring(0, normalized.length() - 3);
    }

    /**
     * 构建Gemini接口完整地址
     *
     * @param baseUrl String 基础地址
     * @param path String Gemini路径
     * @return String 完整地址
     */
    private String buildGeminiUrl(String baseUrl, String path) {
        String normalized = baseUrl == null ? "" : baseUrl.trim().replaceAll("/+$", "");
        String lower = normalized.toLowerCase();
        if (!lower.endsWith("/v1") && !lower.endsWith("/v1beta")) {
            normalized += "/v1beta";
        }
        return normalized + path;
    }

    /**
     * 构建Anthropic接口完整地址
     * <p>
     * Anthropic路径由调用方提供完整路径（如/v1/messages），
     * 此处只拼接不追加，并去除baseUrl尾部的/v1避免重复。
     *
     * @param baseUrl String 基础地址
     * @param path String 接口路径
     * @return String 完整地址
     */
    private String buildAnthropicUrl(String baseUrl, String path) {
        String normalized = baseUrl == null ? "" : baseUrl.trim().replaceAll("/+$", "");
        if (normalized.toLowerCase().endsWith("/v1")) {
            normalized = normalized.substring(0, normalized.length() - 3);
        }
        return normalized + path;
    }

    /**
     * 构建multipart请求体
     *
     * @param boundary String multipart边界
     * @param parts List<MultipartPart> 请求片段
     * @return HttpRequest.BodyPublisher 请求体发布器
     */
    private HttpRequest.BodyPublisher multipartPublisher(String boundary, List<MultipartPart> parts) {
        List<byte[]> body = new ArrayList<>();
        for (MultipartPart part : parts) {
            StringBuilder header = new StringBuilder();
            header.append("--").append(boundary).append("\r\n");
            header.append("Content-Disposition: form-data; name=\"").append(escapeHeader(part.name())).append("\"");
            if (StringUtils.hasText(part.fileName())) {
                header.append("; filename=\"").append(escapeHeader(part.fileName())).append("\"");
            }
            header.append("\r\n");
            if (StringUtils.hasText(part.contentType())) {
                header.append("Content-Type: ").append(part.contentType()).append("\r\n");
            }
            header.append("\r\n");
            body.add(header.toString().getBytes(StandardCharsets.UTF_8));
            body.add(part.data());
            body.add("\r\n".getBytes(StandardCharsets.UTF_8));
        }
        body.add(("--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8));
        return HttpRequest.BodyPublishers.ofByteArrays(body);
    }

    /**
     * 转义multipart头字段值
     *
     * @param value String 原始值
     * @return String 转义后值
     */
    private String escapeHeader(String value) {
        return value.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    /**
     * 执行阻塞调用
     *
     * @param supplier ThrowingSupplier 阻塞调用
     * @return Mono<T> 调用结果
     * @param <T> 返回类型
     */
    private <T> Mono<T> callBlocking(ThrowingSupplier<T> supplier) {
        // HttpClient是阻塞调用，统一隔离到boundedElastic线程池。
        return Mono.fromCallable(supplier::get).subscribeOn(Schedulers.boundedElastic());
    }

    /**
     * 可抛异常的函数式接口
     *
     * @param <T> 返回类型
     */
    @FunctionalInterface
    private interface ThrowingSupplier<T> {

        /**
         * 获取结果
         *
         * @return T 结果
         * @throws Exception 异常
         */
        T get() throws Exception;
    }
}

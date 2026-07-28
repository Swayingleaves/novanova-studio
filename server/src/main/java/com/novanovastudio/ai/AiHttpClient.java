package com.novanovastudio.ai;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.dto.AiTaskDtos;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.TreeSet;
import java.util.stream.Collectors;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
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
        return callBlocking(() -> {
            String url = buildAiUrl(channel.baseUrl(), path);
            String jsonBody = "POST".equalsIgnoreCase(method) ? AiJsonUtils.toJson(payload) : "";
            log.info("AI请求: {} {} body={}", method, url, jsonBody.length() > 2000 ? jsonBody.substring(0, 2000) + "..." : jsonBody);
            HttpRequest.Builder builder = baseBearerRequest(channel, path).header("Content-Type", "application/json");
            if ("POST".equalsIgnoreCase(method)) {
                builder.POST(HttpRequest.BodyPublishers.ofString(jsonBody));
            } else {
                builder.GET();
            }
            HttpResponse<String> response = httpClient.send(builder.build(), HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "AI接口调用失败: code" + response.statusCode() + ", " + response.body());
            }
            JSONObject json = AiJsonUtils.parseJson(response.body());
            log.info("AI响应: {}", AiJsonUtils.formatResponseForLog(json));
            AiJsonUtils.validateEnvelope(json);
            return json;
        });
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
            return Flux.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "服务端AI渠道未配置API Key"));
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
                        return Flux.error(new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR,
                                "AI流式接口调用失败: code=" + response.statusCode() + ", " + errorBody));
                    }
                    String contentType = response.headers().firstValue("Content-Type").orElse("");
                    if (!contentType.toLowerCase().contains("text/event-stream")) {
                        try (var lines = response.body()) {
                            lines.close();
                        }
                        return Flux.error(new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "渠道不支持stream流式响应"));
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
            return Flux.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "服务端AI渠道未配置API Key"));
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
                        return Flux.error(new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR,
                                "Anthropic流式接口调用失败: code=" + response.statusCode() + ", " + errorBody));
                    }
                    String contentType = response.headers().firstValue("Content-Type").orElse("");
                    if (!contentType.toLowerCase().contains("text/event-stream")) {
                        try (var lines = response.body()) {
                            lines.close();
                        }
                        return Flux.error(new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "Anthropic渠道不支持stream流式响应"));
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
                throw new BusinessException(ErrorCode.BUSINESS_ERROR, "服务端AI渠道未配置API Key");
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
                throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "Anthropic接口调用失败: code=" + response.statusCode() + ", " + body);
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
        return callBlocking(() -> {
            HttpRequest request = baseBearerRequest(channel, path)
                    .POST(multipartPublisher(boundary, parts))
                    .header("Content-Type", "multipart/form-data; boundary=" + boundary)
                    .build();
            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "AI接口调用失败: " + response.body());
            }
            JSONObject json = AiJsonUtils.parseJson(response.body());
            AiJsonUtils.validateEnvelope(json);
            return json;
        });
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
                throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "下载AI结果失败: " + new String(response.body(), StandardCharsets.UTF_8));
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
        return callBlocking(() -> {
            HttpRequest request = baseBearerRequest(channel, path)
                    .POST(HttpRequest.BodyPublishers.ofString(AiJsonUtils.toJson(payload)))
                    .header("Content-Type", "application/json")
                    .build();
            HttpResponse<byte[]> response = httpClient.send(request, HttpResponse.BodyHandlers.ofByteArray());
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, errorPrefix + ": " + new String(response.body(), StandardCharsets.UTF_8));
            }
            String mimeType = response.headers().firstValue("Content-Type").orElse(defaultMimeType);
            return new GeneratedBinary(response.body(), mimeType);
        });
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
        return callBlocking(() -> {
            if (!StringUtils.hasText(channel.apiKey())) {
                throw new BusinessException(ErrorCode.BUSINESS_ERROR, "服务端AI渠道未配置API Key");
            }
            HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create(url))
                    .timeout(Duration.ofMinutes(10))
                    .header("Authorization", "Bearer " + channel.apiKey().trim())
                    .header("Content-Type", "application/json");
            if ("POST".equalsIgnoreCase(method)) {
                builder.POST(HttpRequest.BodyPublishers.ofString(AiJsonUtils.toJson(payload)));
            } else {
                builder.GET();
            }
            HttpResponse<String> response = httpClient.send(builder.build(), HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "AI接口调用失败: " + response.body());
            }
            JSONObject json = AiJsonUtils.parseJson(response.body());
            AiJsonUtils.validateEnvelope(json);
            return json;
        });
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
        return callBlocking(() -> {
            if (!StringUtils.hasText(channel.apiKey())) {
                throw new BusinessException(ErrorCode.BUSINESS_ERROR, "服务端AI渠道未配置API Key");
            }
            HttpRequest request = HttpRequest.newBuilder(URI.create(buildGeminiUrl(channel.baseUrl(), path)))
                    .timeout(Duration.ofMinutes(10))
                    .POST(HttpRequest.BodyPublishers.ofString(AiJsonUtils.toJson(payload)))
                    .header("x-goog-api-key", channel.apiKey().trim())
                    .header("Content-Type", "application/json")
                    .build();
            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "Gemini接口调用失败: " + response.body());
            }
            JSONObject json = AiJsonUtils.parseJson(response.body());
            JSONObject error = json.getJSONObject("error");
            if (error != null && StringUtils.hasText(error.getString("message"))) {
                throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, error.getString("message"));
            }
            JSONObject promptFeedback = json.getJSONObject("promptFeedback");
            if (promptFeedback != null && StringUtils.hasText(promptFeedback.getString("blockReason"))) {
                throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "Gemini 拒绝了本次请求：" + promptFeedback.getString("blockReason"));
            }
            return json;
        });
    }

    /**
     * 从第三方渠道拉取可用模型列表。
     *
     * @param baseUrl String 渠道基础地址
     * @param apiKey String 渠道API Key
     * @param apiFormat String 渠道调用格式
     * @return Mono<List<String>> 去重并排序后的模型名称
     */
    public Mono<List<String>> fetchChannelModels(String baseUrl, String apiKey, String apiFormat) {
        return callBlocking(() -> {
            String normalizedFormat = normalizeModelApiFormat(apiFormat);
            URI uri = buildModelListUri(baseUrl, normalizedFormat);
            if (!StringUtils.hasText(apiKey)) {
                throw new BusinessException(ErrorCode.PARAM_MISSING, "API Key不能为空");
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
                    throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR,
                            "拉取模型失败: HTTP " + response.statusCode() + "，" + readModelErrorMessage(safeResponseBody));
                }
                List<String> models;
                try {
                    models = parseChannelModels(responseBody, normalizedFormat);
                } catch (BusinessException exception) {
                    throw new BusinessException(exception.getCode(), sanitizeModelResponse(exception.getMessage(), apiKey));
                }
                if (models.isEmpty()) {
                    throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "渠道没有返回可用模型");
                }
                return models;
            } catch (BusinessException exception) {
                throw exception;
            } catch (InterruptedException exception) {
                Thread.currentThread().interrupt();
                throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "拉取模型失败: 请求已中断");
            } catch (Exception exception) {
                throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "拉取模型失败: " + exception.getMessage());
            }
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
        return callBlocking(() -> {
            URI uri = validateRemoteMediaUri(url);
            HttpRequest request = HttpRequest.newBuilder(uri).timeout(Duration.ofMinutes(5)).GET().build();
            HttpResponse<InputStream> response = remoteMediaHttpClient.send(request, HttpResponse.BodyHandlers.ofInputStream());
            try (InputStream inputStream = response.body()) {
                if (response.statusCode() < 200 || response.statusCode() >= 300) {
                    throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "下载参考媒体失败: " + response.statusCode());
                }
                long contentLength = response.headers().firstValueAsLong("Content-Length").orElse(-1L);
                if (contentLength > MAXIMUM_REMOTE_MEDIA_BYTES) {
                    throw new BusinessException(ErrorCode.BUSINESS_ERROR, "远程媒体文件超过100MB限制");
                }
                String mimeType = response.headers().firstValue("Content-Type").orElse(defaultMimeType);
                return new GeneratedBinary(readLimitedMediaData(inputStream), AiTaskParameterReader.firstNonEmpty(mimeType, defaultMimeType));
            }
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
            throw new BusinessException(ErrorCode.PARAM_MISSING, "远程媒体地址不能为空");
        }
        URI uri;
        try {
            uri = URI.create(url.trim());
        } catch (IllegalArgumentException exception) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "远程媒体地址格式不合法");
        }
        if ((!"http".equalsIgnoreCase(uri.getScheme()) && !"https".equalsIgnoreCase(uri.getScheme())) || !StringUtils.hasText(uri.getHost())) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "远程媒体仅支持HTTP或HTTPS地址");
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
            throw new BusinessException(ErrorCode.PARAM_MISSING, "接口格式不能为空");
        }
        String normalizedFormat = apiFormat.trim().toLowerCase(Locale.ROOT);
        Set<String> supportedFormats = Set.of("openai", "gemini", "anthropic", "agnes", "seedance");
        if (!supportedFormats.contains(normalizedFormat)) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "不支持的接口格式: " + normalizedFormat);
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
            throw new BusinessException(ErrorCode.PARAM_MISSING, "Base URL不能为空");
        }
        String url = switch (apiFormat) {
            case "gemini" -> buildGeminiUrl(baseUrl, "/models");
            case "anthropic" -> buildAnthropicUrl(baseUrl, "/v1/models");
            default -> buildAiUrl(baseUrl, "/models");
        };
        try {
            URI uri = URI.create(url);
            if ((!"http".equalsIgnoreCase(uri.getScheme()) && !"https".equalsIgnoreCase(uri.getScheme()))
                    || !StringUtils.hasText(uri.getHost())) {
                throw new BusinessException(ErrorCode.PARAM_INVALID, "Base URL仅支持HTTP或HTTPS地址");
            }
            return uri;
        } catch (BusinessException exception) {
            throw exception;
        } catch (IllegalArgumentException exception) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "Base URL格式不合法");
        }
    }

    /**
     * 解析不同渠道格式的模型列表响应。
     *
     * @param responseBody String 第三方响应内容
     * @param apiFormat String 规范化后的调用格式
     * @return List<String> 去重并排序后的模型名称
     * @throws BusinessException 响应不是合法JSON或模型字段格式错误时抛出
     */
    private List<String> parseChannelModels(String responseBody, String apiFormat) {
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
                throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "渠道模型列表响应格式不正确");
            }
            TreeSet<String> models = new TreeSet<>();
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
                    }
                }
            }
            return new ArrayList<>(models);
        } catch (BusinessException exception) {
            throw exception;
        } catch (Exception exception) {
            throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, "渠道模型列表响应不是合法JSON");
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
        try (ByteArrayOutputStream outputStream = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            long totalBytes = 0L;
            int readBytes;
            while ((readBytes = inputStream.read(buffer)) != -1) {
                totalBytes += readBytes;
                if (totalBytes > MAXIMUM_REMOTE_MEDIA_BYTES) {
                    throw new BusinessException(ErrorCode.BUSINESS_ERROR, "远程媒体文件超过100MB限制");
                }
                outputStream.write(buffer, 0, readBytes);
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
            throw new BusinessException(ErrorCode.BUSINESS_ERROR, "服务端AI渠道未配置API Key");
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
    static String buildAiUrl(String baseUrl, String path) {
        String normalized = baseUrl == null ? "" : baseUrl.trim().replaceAll("/+$", "");
        return normalized + path;
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

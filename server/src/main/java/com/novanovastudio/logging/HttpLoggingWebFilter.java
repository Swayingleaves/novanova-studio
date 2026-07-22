package com.novanovastudio.logging;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.core.io.buffer.DataBuffer;
import org.springframework.core.io.buffer.DataBufferUtils;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.server.reactive.ServerHttpRequestDecorator;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.server.ServerWebExchange;
import org.springframework.web.server.WebFilter;
import org.springframework.web.server.WebFilterChain;
import org.springframework.web.util.UriComponents;
import org.springframework.web.util.UriComponentsBuilder;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * @title        HttpLoggingWebFilter.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  响应式HTTP请求响应日志过滤器（被动拦截body，避免提前提交响应）
 * @createTime   2026-06-24 18:50:00
 */
@Slf4j
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class HttpLoggingWebFilter implements WebFilter {

    /** 最大日志正文长度 */
    private static final int MAX_BODY_LENGTH = 20_000;

    /** 日志脱敏占位文本 */
    private static final String MASKED_VALUE = "[已脱敏]";

    /** 查询参数中的敏感字段 */
    private static final Set<String> SENSITIVE_QUERY_FIELDS = Set.of("code", "state", "logincode", "token", "access_token", "refresh_token", "id_token", "error_description", "session_state");

    /** JSON正文中的敏感字段 */
    private static final Set<String> SENSITIVE_BODY_FIELDS = Set.of("password", "code", "logincode", "clientsecret", "client_secret", "token", "access_token", "refresh_token");

    /** SSE 订阅接口路径（长连接流式响应，不能缓冲） */
    private static final String SSE_TASK_SUBSCRIBE_PATH = "/api/v1/ai/task/subscribe";
    private static final String SSE_AGENT_EVENTS_PATH = "/api/v1/ai/agent/events";

    /**
     * 被动记录请求日志，不装饰响应体，避免触发 Netty 响应头提前提交。
     *
     * @param exchange ServerWebExchange 当前请求交换对象
     * @param chain WebFilterChain 过滤器链
     * @return Mono<Void> 过滤执行结果
     */
    @Override
    public Mono<Void> filter(ServerWebExchange exchange, WebFilterChain chain) {
        String path = exchange.getRequest().getPath().value();
        if (!path.startsWith("/api/")) {
            return chain.filter(exchange);
        }
        // SSE 长连接不缓冲响应，直接透传并记录摘要
        if (SSE_TASK_SUBSCRIBE_PATH.equals(path) || SSE_AGENT_EVENTS_PATH.equals(path)) {
            return logStreamingRequest(exchange, chain);
        }
        if (isMultipart(exchange.getRequest().getHeaders().getContentType())) {
            return logMultipartRequest(exchange, chain);
        }
        if (isMethodWithoutBody(exchange.getRequest().getMethod())) {
            return logRequestWithoutBody(exchange, chain);
        }
        return logRequestWithBody(exchange, chain);
    }

    /**
     * 被动拦截 body 并记录日志（不主动订阅，避免 Netty 响应提前提交）
     */
    private Mono<Void> logRequestWithBody(ServerWebExchange exchange, WebFilterChain chain) {
        return DataBufferUtils.join(exchange.getRequest().getBody())
                .defaultIfEmpty(exchange.getResponse().bufferFactory().wrap(new byte[0]))
                .flatMap(requestBuffer -> {
                    byte[] requestBytes = new byte[requestBuffer.readableByteCount()];
                    requestBuffer.read(requestBytes);
                    DataBufferUtils.release(requestBuffer);

                    ServerHttpRequestDecorator requestDecorator = new ServerHttpRequestDecorator(exchange.getRequest()) {
                        @Override
                        public Flux<DataBuffer> getBody() {
                            return Flux.just(exchange.getResponse().bufferFactory().wrap(requestBytes));
                        }
                    };

                    long startTime = System.currentTimeMillis();
                    ServerWebExchange decoratedExchange = exchange.mutate().request(requestDecorator).build();
                    return chain.filter(decoratedExchange).doFinally(signalType -> {
                        Map<String, Object> data = new LinkedHashMap<>();
                        data.put("method", exchange.getRequest().getMethod() == null ? "" : exchange.getRequest().getMethod().name());
                        data.put("url", sanitizedUrl(exchange));
                        data.put("requestBody", bodyText(requestBytes, exchange.getRequest().getHeaders().getContentType(), exchange.getRequest().getHeaders().getFirst("Content-Encoding")));
                        data.put("costMilliseconds", System.currentTimeMillis() - startTime);
                        log.debug("http-req-log: {}", JSON.toJSONString(data));
                    });
                });
    }

    /**
     * 记录SSE流式请求日志
     *
     * @param exchange ServerWebExchange 当前请求交换对象
     * @param chain WebFilterChain 过滤器链
     * @return Mono<Void> 过滤执行结果
     */
    private Mono<Void> logStreamingRequest(ServerWebExchange exchange, WebFilterChain chain) {
        // SSE响应是长连接流，只记录摘要避免干扰事件推送。
        long startTime = System.currentTimeMillis();
        return chain.filter(exchange).doFinally(signalType -> {
            Map<String, Object> data = new LinkedHashMap<>();
            data.put("method", exchange.getRequest().getMethod() == null ? "" : exchange.getRequest().getMethod().name());
            data.put("url", sanitizedUrl(exchange));
            data.put("requestBody", "");
            data.put("costMilliseconds", System.currentTimeMillis() - startTime);
            log.debug("http-req-log: {}", JSON.toJSONString(data));
        });
    }

    /**
     * 记录multipart请求日志
     *
     * @param exchange ServerWebExchange 当前请求交换对象
     * @param chain WebFilterChain 过滤器链
     * @return Mono<Void> 过滤执行结果
     */
    private Mono<Void> logMultipartRequest(ServerWebExchange exchange, WebFilterChain chain) {
        // 文件上传不读取二进制正文，只输出摘要避免日志文件膨胀。
        long startTime = System.currentTimeMillis();
        return chain.filter(exchange).doFinally(signalType -> {
            Map<String, Object> data = new LinkedHashMap<>();
            data.put("method", exchange.getRequest().getMethod() == null ? "" : exchange.getRequest().getMethod().name());
            data.put("url", sanitizedUrl(exchange));
            data.put("requestBody", "[multipart请求体已省略]");
            data.put("costMilliseconds", System.currentTimeMillis() - startTime);
            log.debug("http-req-log: {}", JSON.toJSONString(data));
        });
    }

    /**
     * 转换正文文本
     *
     * @param bytes byte[] 正文字节
     * @param contentType MediaType 内容类型
     * @param encoding String 编码
     * @return String 正文文本
     */
    private String bodyText(byte[] bytes, MediaType contentType, String encoding) {
        // 空正文直接返回空字符串，非文本内容返回摘要。
        if (bytes == null || bytes.length == 0) {
            return "";
        }
        if (!isTextResponse(contentType)) {
            return "[非文本响应体已省略, size=" + bytes.length + "]";
        }
        Charset charset = StringUtils.hasText(encoding) ? Charset.forName(encoding) : StandardCharsets.UTF_8;
        String body = sanitizeBody(new String(bytes, charset), contentType);
        if (body.length() <= MAX_BODY_LENGTH) {
            return body;
        }
        return body.substring(0, MAX_BODY_LENGTH) + "...[日志正文已截断, 原长度=" + body.length() + "]";
    }

    /**
     * 判断是否为multipart请求
     *
     * @param mediaType MediaType 内容类型
     * @return boolean 是否为multipart
     */
    private boolean isMultipart(MediaType mediaType) {
        // multipart通常包含文件或大二进制内容。
        return mediaType != null && MediaType.MULTIPART_FORM_DATA.isCompatibleWith(mediaType);
    }

    /**
     * 判断HTTP方法是否无请求体
     *
     * @param method HttpMethod HTTP方法
     * @return boolean 是否无请求体
     */
    private boolean isMethodWithoutBody(HttpMethod method) {
        // GET/HEAD/OPTIONS/DELETE 等方法不应携带请求体，读取 body 会触发 Netty channel 副作用，
        // 导致响应被提前提交。
        return method == HttpMethod.GET || method == HttpMethod.HEAD || method == HttpMethod.OPTIONS || method == HttpMethod.DELETE;
    }

    /**
     * 记录无请求体的请求日志
     *
     * @param exchange ServerWebExchange 当前请求交换对象
     * @param chain WebFilterChain 过滤器链
     * @return Mono<Void> 过滤执行结果
     */
    private Mono<Void> logRequestWithoutBody(ServerWebExchange exchange, WebFilterChain chain) {
        long startTime = System.currentTimeMillis();
        return chain.filter(exchange).doFinally(signalType -> {
            Map<String, Object> data = new LinkedHashMap<>();
            data.put("method", exchange.getRequest().getMethod() == null ? "" : exchange.getRequest().getMethod().name());
            data.put("url", sanitizedUrl(exchange));
            data.put("requestBody", "");
            data.put("costMilliseconds", System.currentTimeMillis() - startTime);
            log.debug("http-req-log: {}", JSON.toJSONString(data));
        });
    }

    /**
     * 判断是否为文本响应
     *
     * @param mediaType MediaType 内容类型
     * @return boolean 是否为文本响应
     */
    private boolean isTextResponse(MediaType mediaType) {
        // JSON、XML、纯文本和表单响应均可作为文本打印。
        if (mediaType == null) {
            return true;
        }
        String value = mediaType.toString().toLowerCase();
        return value.contains("json") || value.contains("xml") || value.startsWith("text/") || value.contains("form");
    }

    /**
     * 对请求URL中的敏感查询参数进行脱敏。
     *
     * @param exchange ServerWebExchange 当前请求交换对象
     * @return String 脱敏后的请求URL
     */
    String sanitizedUrl(ServerWebExchange exchange) {
        UriComponents components = UriComponentsBuilder.fromUri(exchange.getRequest().getURI()).build();
        if (components.getQueryParams().isEmpty()) {
            return components.toUriString();
        }
        UriComponentsBuilder builder = UriComponentsBuilder.fromUri(exchange.getRequest().getURI()).replaceQuery(null);
        components.getQueryParams().forEach((name, values) -> appendSanitizedQueryParameters(builder, name, values));
        return builder.build().toUriString();
    }

    /**
     * 添加脱敏后的查询参数。
     *
     * @param builder UriComponentsBuilder URI构建器
     * @param name String 查询参数名称
     * @param values List<String> 查询参数值
     */
    private void appendSanitizedQueryParameters(UriComponentsBuilder builder, String name, List<String> values) {
        String normalizedName = name.toLowerCase(java.util.Locale.ROOT);
        if (values.isEmpty()) {
            builder.queryParam(name);
            return;
        }
        for (String value : values) {
            builder.queryParam(name, SENSITIVE_QUERY_FIELDS.contains(normalizedName) ? MASKED_VALUE : value);
        }
    }

    /**
     * 对JSON请求正文中的敏感字段进行脱敏。
     *
     * @param body String 原始请求正文
     * @param contentType MediaType 请求内容类型
     * @return String 脱敏后的请求正文
     */
    String sanitizeBody(String body, MediaType contentType) {
        if (contentType == null || !contentType.toString().toLowerCase().contains("json")) {
            return body;
        }
        try {
            Object jsonValue = JSON.parse(body);
            sanitizeJsonValue(jsonValue);
            return JSON.toJSONString(jsonValue);
        } catch (RuntimeException exception) {
            // 非法JSON由后续参数校验处理，日志中省略正文以避免敏感内容泄漏。
            return "[JSON请求体解析失败，内容已省略]";
        }
    }

    /**
     * 递归脱敏JSON对象和数组。
     *
     * @param value Object JSON节点
     */
    private void sanitizeJsonValue(Object value) {
        if (value instanceof JSONObject jsonObject) {
            for (Map.Entry<String, Object> entry : jsonObject.entrySet()) {
                if (SENSITIVE_BODY_FIELDS.contains(entry.getKey().toLowerCase(java.util.Locale.ROOT))) {
                    entry.setValue(MASKED_VALUE);
                } else {
                    sanitizeJsonValue(entry.getValue());
                }
            }
            return;
        }
        if (value instanceof JSONArray jsonArray) {
            jsonArray.forEach(this::sanitizeJsonValue);
        }
    }
}

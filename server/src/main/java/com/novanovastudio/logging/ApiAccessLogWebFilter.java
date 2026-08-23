package com.novanovastudio.logging;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.entity.ApiAccessLog;
import com.novanovastudio.repository.ApiAccessLogRepository;
import com.novanovastudio.security.ClientAddressResolver;
import com.novanovastudio.security.CurrentUser;
import com.novanovastudio.security.CurrentUserProvider;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.atomic.AtomicReference;
import lombok.extern.slf4j.Slf4j;
import org.reactivestreams.Publisher;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.core.io.buffer.DataBuffer;
import org.springframework.core.io.buffer.DataBufferUtils;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.MediaType;
import org.springframework.http.server.reactive.ServerHttpRequest;
import org.springframework.http.server.reactive.ServerHttpRequestDecorator;
import org.springframework.http.server.reactive.ServerHttpResponse;
import org.springframework.http.server.reactive.ServerHttpResponseDecorator;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.server.ServerWebExchange;
import org.springframework.web.server.WebFilter;
import org.springframework.web.server.WebFilterChain;
import org.springframework.web.util.UriComponents;
import org.springframework.web.util.UriComponentsBuilder;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

/**
 * @title        ApiAccessLogWebFilter.java
 * @description  接口访问日志过滤器：对每个 /api/** 请求在响应完成后异步落库
 * @createTime   2026-08-23
 */
@Slf4j
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 20)
public class ApiAccessLogWebFilter implements WebFilter {

    /** 最大日志正文长度 */
    private static final int MAX_BODY_LENGTH = 20_000;

    /** 日志脱敏占位文本 */
    private static final String MASKED_VALUE = "[已脱敏]";

    /** 查询参数中的敏感字段 */
    private static final Set<String> SENSITIVE_QUERY_FIELDS = Set.of("code", "cardcode", "state", "logincode", "token", "access_token", "refresh_token", "id_token", "error_description", "session_state");

    /** JSON 正文中的敏感字段 */
    private static final Set<String> SENSITIVE_BODY_FIELDS = Set.of("password", "currentpassword", "newpassword", "code", "cardcode", "logincode", "clientsecret", "client_secret", "token", "access_token", "refresh_token");

    /** SSE 订阅接口路径（长连接流式响应，不能缓冲） */
    private static final String SSE_TASK_SUBSCRIBE_PATH = "/api/v1/ai/task/subscribe";
    private static final String SSE_AGENT_EVENTS_PATH = "/api/v1/ai/agent/events";

    /** 接口访问日志仓储 */
    private final ApiAccessLogRepository apiAccessLogRepository;

    /** 当前用户提供器 */
    private final CurrentUserProvider currentUserProvider;

    /** 客户端地址解析器 */
    private final ClientAddressResolver clientAddressResolver;

    /**
     * 构造接口访问日志过滤器。
     *
     * @param apiAccessLogRepository 接口访问日志仓储
     * @param currentUserProvider    当前用户提供器
     * @param clientAddressResolver  客户端地址解析器
     */
    public ApiAccessLogWebFilter(ApiAccessLogRepository apiAccessLogRepository,
                                 CurrentUserProvider currentUserProvider,
                                 ClientAddressResolver clientAddressResolver) {
        this.apiAccessLogRepository = apiAccessLogRepository;
        this.currentUserProvider = currentUserProvider;
        this.clientAddressResolver = clientAddressResolver;
    }

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, WebFilterChain chain) {
        String path = exchange.getRequest().getPath().value();
        if (!path.startsWith("/api/")) {
            return chain.filter(exchange);
        }
        // 顺序晚于 TokenAuthenticationWebFilter(+10) 与 RoleAuthFilter(+15)，Reactor 上下文中已有 CurrentUser。
        Instant start = Instant.now();
        ServerHttpRequest request = exchange.getRequest();
        boolean sse = SSE_TASK_SUBSCRIBE_PATH.equals(path) || SSE_AGENT_EVENTS_PATH.equals(path);
        boolean multipart = isMultipart(request.getHeaders().getContentType());
        boolean withoutBody = isMethodWithoutBody(request.getMethod());

        // 关键：当前用户必须在主链捕获，不能在 doFinally 内新建订阅读取（新订阅 Context 为空会导致 user_id 始终为 null）。
        // 注意：optionalCurrentUser() 在无登录态时为空，不能用 defaultIfEmpty(null)，否则 MonoDefaultIfEmpty 构造会 NPE；
        // 改用 doOnNext 填充 holder，再以 then(Mono.defer(...)) 继续主链，空上游时 holder 保持 null（未登录）。
        AtomicReference<Long> uidHolder = new AtomicReference<>();
        return currentUserProvider.optionalCurrentUser()
                .map(CurrentUser::id)
                .doOnNext(uidHolder::set)
                .then(Mono.defer(() -> {
                    if (sse || multipart) {
                        // SSE / 文件上传仅记录元数据，不装饰响应，避免干扰长连接与提前提交。
                        String requestBody = multipart ? "[multipart请求体已省略]" : "";
                        return chain.filter(exchange)
                                .doFinally(signal -> persistAsync(uidHolder.get(), exchange, start, requestBody, null));
                    }
                    if (withoutBody) {
                        AtomicReference<String> errorHolder = new AtomicReference<>();
                        ServerWebExchange decorated = exchange.mutate().response(decorateResponse(exchange, errorHolder)).build();
                        return chain.filter(decorated)
                                .doFinally(signal -> persistAsync(uidHolder.get(), exchange, start, "", errorHolder.get()));
                    }
                    // 有请求体的方法：读取并重新装饰请求，再装饰响应以捕获失败正文。
                    return DataBufferUtils.join(request.getBody())
                            .defaultIfEmpty(exchange.getResponse().bufferFactory().wrap(new byte[0]))
                            .flatMap(requestBuffer -> {
                                byte[] requestBytes = new byte[requestBuffer.readableByteCount()];
                                requestBuffer.read(requestBytes);
                                DataBufferUtils.release(requestBuffer);
                                AtomicReference<String> errorHolder = new AtomicReference<>();
                                String requestBody = bodyText(requestBytes, request.getHeaders().getContentType(), request.getHeaders().getFirst("Content-Encoding"));
                                ServerHttpRequestDecorator requestDecorator = new ServerHttpRequestDecorator(request) {
                                    @Override
                                    public Flux<DataBuffer> getBody() {
                                        return Flux.just(exchange.getResponse().bufferFactory().wrap(requestBytes));
                                    }
                                };
                                ServerWebExchange decorated = exchange.mutate()
                                        .request(requestDecorator)
                                        .response(decorateResponse(exchange, errorHolder))
                                        .build();
                                return chain.filter(decorated)
                                        .doFinally(signal -> persistAsync(uidHolder.get(), exchange, start, requestBody, errorHolder.get()));
                            });
                }));
    }

    /**
     * 装饰响应：仅当状态码 >= 400 时才缓冲响应体，成功响应直接透传，避免 WebFlux 提前提交。
     *
     * @param exchange   ServerWebExchange 当前请求交换对象
     * @param errorHolder AtomicReference 错误正文暂存
     * @return ServerHttpResponse 装饰后的响应
     */
    private ServerHttpResponse decorateResponse(ServerWebExchange exchange, AtomicReference<String> errorHolder) {
        return new ServerHttpResponseDecorator(exchange.getResponse()) {
            @Override
            public Mono<Void> writeWith(Publisher<? extends DataBuffer> body) {
                HttpStatusCode status = getDelegate().getStatusCode();
                if (status != null && status.value() >= 400) {
                    return DataBufferUtils.join(body)
                            .defaultIfEmpty(exchange.getResponse().bufferFactory().wrap(new byte[0]))
                            .flatMap(joined -> {
                                byte[] bytes = new byte[joined.readableByteCount()];
                                joined.read(bytes);
                                DataBufferUtils.release(joined);
                                MediaType contentType = getDelegate().getHeaders().getContentType();
                                if (!isTextResponse(contentType)) {
                                    errorHolder.set("[非文本错误响应体已省略, size=" + bytes.length + "]");
                                } else {
                                    errorHolder.set(truncate(sanitizeBody(new String(bytes, StandardCharsets.UTF_8), contentType)));
                                }
                                return super.writeWith(Mono.just(exchange.getResponse().bufferFactory().wrap(bytes)));
                            });
                }
                return super.writeWith(body);
            }
        };
    }

    /**
     * 异步持久化接口访问日志（不阻塞响应链）。
     *
     * @param userId      Long 用户 ID
     * @param exchange    ServerWebExchange 当前请求交换对象
     * @param start       Instant 请求开始时间
     * @param requestBody String 请求体
     * @param errorContent String 错误内容
     */
    private void persistAsync(Long userId, ServerWebExchange exchange, Instant start, String requestBody, String errorContent) {
        HttpStatusCode status = exchange.getResponse().getStatusCode();
        int code = status != null ? status.value() : 0;
        ApiAccessLog accessLog = new ApiAccessLog();
        accessLog.setHttpMethod(exchange.getRequest().getMethod() == null ? "" : exchange.getRequest().getMethod().name());
        accessLog.setRequestPath(sanitizedUrl(exchange));
        accessLog.setClientIp(clientAddressResolver.resolve(exchange.getRequest()));
        accessLog.setUserId(userId);
        accessLog.setStatusCode(code);
        accessLog.setSuccess(code > 0 && code < 400);
        accessLog.setHasError(code == 0 || code >= 400);
        accessLog.setErrorContent(errorContent);
        accessLog.setRequestBody(requestBody);
        accessLog.setDurationMs((int) Duration.between(start, Instant.now()).toMillis());
        apiAccessLogRepository.insert(accessLog)
                .subscribeOn(Schedulers.boundedElastic())
                .subscribe(id -> {}, err -> log.error("持久化接口访问日志失败 path={}", accessLog.getRequestPath(), err));
    }

    /**
     * 转换正文文本（脱敏 + 截断）。
     *
     * @param bytes     byte[] 正文字节
     * @param contentType MediaType 内容类型
     * @param encoding  String 编码
     * @return String 正文文本
     */
    private String bodyText(byte[] bytes, MediaType contentType, String encoding) {
        if (bytes == null || bytes.length == 0) {
            return "";
        }
        if (!isTextResponse(contentType)) {
            return "[非文本请求体已省略, size=" + bytes.length + "]";
        }
        // Content-Encoding 表示压缩编码（gzip/br 等），不能作为字符集名；压缩正文无法直接解码，仅记录占位符。
        if (StringUtils.hasText(encoding) && !"identity".equalsIgnoreCase(encoding)) {
            return "[请求体已压缩(encoding=" + encoding + ")，内容已省略]";
        }
        // 字符集取自 Content-Type 的 charset 参数，缺省按 UTF-8；避免对不可信头做 Charset.forName 抛异常。
        Charset charset = contentType != null && contentType.getCharset() != null
                ? contentType.getCharset()
                : StandardCharsets.UTF_8;
        String body = sanitizeBody(new String(bytes, charset), contentType);
        return truncate(body);
    }

    /**
     * 判断是否为 multipart 请求。
     *
     * @param mediaType MediaType 内容类型
     * @return boolean 是否为 multipart
     */
    private boolean isMultipart(MediaType mediaType) {
        return mediaType != null && MediaType.MULTIPART_FORM_DATA.isCompatibleWith(mediaType);
    }

    /**
     * 判断 HTTP 方法是否无请求体。
     *
     * @param method HttpMethod HTTP 方法
     * @return boolean 是否无请求体
     */
    private boolean isMethodWithoutBody(HttpMethod method) {
        return method == HttpMethod.GET || method == HttpMethod.HEAD || method == HttpMethod.OPTIONS || method == HttpMethod.DELETE;
    }

    /**
     * 截断过长文本。
     *
     * @param body String 原始文本
     * @return String 截断后的文本
     */
    private String truncate(String body) {
        if (body == null) {
            return null;
        }
        if (body.length() <= MAX_BODY_LENGTH) {
            return body;
        }
        return body.substring(0, MAX_BODY_LENGTH) + "...[内容已截断, 原长度=" + body.length() + "]";
    }

    /**
     * 判断是否为文本响应。
     *
     * @param mediaType MediaType 内容类型
     * @return boolean 是否为文本响应
     */
    private boolean isTextResponse(MediaType mediaType) {
        if (mediaType == null) {
            return true;
        }
        String value = mediaType.toString().toLowerCase(Locale.ROOT);
        return value.contains("json") || value.contains("xml") || value.startsWith("text/") || value.contains("form");
    }

    /**
     * 对请求 URL 中的敏感查询参数进行脱敏。
     *
     * @param exchange ServerWebExchange 当前请求交换对象
     * @return String 脱敏后的请求 URL
     */
    private String sanitizedUrl(ServerWebExchange exchange) {
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
     * @param builder UriComponentsBuilder URI 构建器
     * @param name    String 查询参数名称
     * @param values  List<String> 查询参数值
     */
    private void appendSanitizedQueryParameters(UriComponentsBuilder builder, String name, List<String> values) {
        String normalizedName = name.toLowerCase(Locale.ROOT);
        if (values.isEmpty()) {
            builder.queryParam(name);
            return;
        }
        for (String value : values) {
            builder.queryParam(name, SENSITIVE_QUERY_FIELDS.contains(normalizedName) ? MASKED_VALUE : value);
        }
    }

    /**
     * 对 JSON 请求正文中的敏感字段进行脱敏。
     *
     * @param body        String 原始请求正文
     * @param contentType MediaType 请求内容类型
     * @return String 脱敏后的请求正文
     */
    private String sanitizeBody(String body, MediaType contentType) {
        if (contentType == null || !contentType.toString().toLowerCase(Locale.ROOT).contains("json")) {
            return body;
        }
        try {
            Object jsonValue = JSON.parse(body);
            sanitizeJsonValue(jsonValue);
            return JSON.toJSONString(jsonValue);
        } catch (RuntimeException exception) {
            return "[JSON请求体解析失败，内容已省略]";
        }
    }

    /**
     * 递归脱敏 JSON 对象和数组。
     *
     * @param value Object JSON 节点
     */
    private void sanitizeJsonValue(Object value) {
        if (value instanceof JSONObject jsonObject) {
            for (var entry : jsonObject.entrySet()) {
                if (SENSITIVE_BODY_FIELDS.contains(entry.getKey().toLowerCase(Locale.ROOT))) {
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

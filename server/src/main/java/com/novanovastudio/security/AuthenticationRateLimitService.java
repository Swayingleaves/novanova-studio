package com.novanovastudio.security;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.config.NovanovaProperties;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.util.HexFormat;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.ReactiveStringRedisTemplate;
import org.springframework.data.redis.core.script.RedisScript;
import org.springframework.http.server.reactive.ServerHttpRequest;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import reactor.core.publisher.Mono;

/**
 * @title        AuthenticationRateLimitService.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  认证接口分布式限流服务
 * @createTime   2026-07-15 10:00:00
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class AuthenticationRateLimitService {

    /** 限流键前缀 */
    private static final String KEY_PREFIX = "novanova:security:rate-limit:";

    /** 登录来源地址窗口时长 */
    private static final Duration LOGIN_ADDRESS_WINDOW = Duration.ofMinutes(15);

    /** 邮箱验证码邮箱窗口时长 */
    private static final Duration EMAIL_CODE_EMAIL_WINDOW = Duration.ofHours(1);

    /** 邮箱验证码来源地址窗口时长 */
    private static final Duration EMAIL_CODE_ADDRESS_WINDOW = Duration.ofHours(1);

    /** 登录来源地址最大请求数 */
    private static final long LOGIN_ADDRESS_MAX_REQUESTS = 20;

    /** 邮箱验证码邮箱最大请求数 */
    private static final long EMAIL_CODE_EMAIL_MAX_REQUESTS = 3;

    /** 邮箱验证码来源地址最大请求数 */
    private static final long EMAIL_CODE_ADDRESS_MAX_REQUESTS = 10;

    /** 原子递增并设置固定窗口过期时间的Redis脚本 */
    private static final RedisScript<Long> FIXED_WINDOW_SCRIPT = RedisScript.of("""
            local count = redis.call('incr', KEYS[1])
            if count == 1 then
                redis.call('expire', KEYS[1], ARGV[1])
            end
            return count
            """, Long.class);

    /** Redis模板 */
    private final ReactiveStringRedisTemplate redisTemplate;

    /** 服务配置 */
    private final NovanovaProperties properties;

    /**
     * 校验邮箱密码登录请求频率。
     *
     * @param request ServerHttpRequest HTTP请求
     * @return Mono<Void> 限流通过时完成信号
     */
    public Mono<Void> checkLogin(ServerHttpRequest request) {
        String sourceAddress = resolveClientAddress(request);
        return checkLimit("login:address", sourceAddress, LOGIN_ADDRESS_MAX_REQUESTS, LOGIN_ADDRESS_WINDOW);
    }

    /**
     * 校验发送邮箱验证码请求频率。
     *
     * @param request ServerHttpRequest HTTP请求
     * @param email String 接收验证码的邮箱
     * @return Mono<Void> 限流通过时完成信号
     */
    public Mono<Void> checkEmailCode(ServerHttpRequest request, String email) {
        String sourceAddress = resolveClientAddress(request);
        return checkLimit("email-code:address", sourceAddress, EMAIL_CODE_ADDRESS_MAX_REQUESTS, EMAIL_CODE_ADDRESS_WINDOW)
                .then(checkLimit("email-code:email", normalizeEmail(email), EMAIL_CODE_EMAIL_MAX_REQUESTS, EMAIL_CODE_EMAIL_WINDOW));
    }

    /**
     * 对固定窗口内的指定维度执行原子限流。
     *
     * @param scope String 业务限流范围
     * @param identifier String 限流标识
     * @param maxRequests long 窗口内最大请求数
     * @param window Duration 窗口时长
     * @return Mono<Void> 限流通过时完成信号
     */
    private Mono<Void> checkLimit(String scope, String identifier, long maxRequests, Duration window) {
        String key = buildRateLimitKey(scope, identifier);
        return redisTemplate.execute(FIXED_WINDOW_SCRIPT, java.util.List.of(key), java.util.List.of(String.valueOf(window.toSeconds())))
                .next()
                .switchIfEmpty(Mono.error(new IllegalStateException("Redis未返回限流计数")))
                .flatMap(requestCount -> {
                    if (requestCount != null && requestCount <= maxRequests) {
                        return Mono.<Void>empty();
                    }
                    log.info("认证接口触发限流: scope={}", scope);
                    return Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "操作过于频繁，请稍后再试"));
                })
                .onErrorMap(exception -> {
                    if (exception instanceof BusinessException) {
                        return exception;
                    }
                    log.error("认证接口限流服务异常: scope={}", scope, exception);
                    return new BusinessException(ErrorCode.BUSINESS_ERROR, "认证服务暂不可用，请稍后再试");
                });
    }

    /**
     * 构建不包含邮箱明文的Redis限流键。
     *
     * @param scope String 业务限流范围
     * @param identifier String 限流标识
     * @return String Redis限流键
     */
    private String buildRateLimitKey(String scope, String identifier) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(identifier.getBytes(StandardCharsets.UTF_8));
            return KEY_PREFIX + scope + ":" + HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("当前Java运行时不支持SHA-256", exception);
        }
    }

    /**
     * 解析可信代理转发后的客户端地址。
     *
     * @param request ServerHttpRequest HTTP请求
     * @return String 客户端来源地址
     */
    private String resolveClientAddress(ServerHttpRequest request) {
        InetSocketAddress remoteAddress = request.getRemoteAddress();
        if (remoteAddress == null || remoteAddress.getAddress() == null) {
            return "unknown";
        }
        String directAddress = remoteAddress.getAddress().getHostAddress();
        if (!TrustedProxyMatcher.isTrustedProxyAddress(properties.getApp().getTrustedProxyAddresses(), directAddress)) {
            return directAddress;
        }
        String forwardedFor = request.getHeaders().getFirst("X-Forwarded-For");
        if (!StringUtils.hasText(forwardedFor)) {
            return directAddress;
        }
        String[] addresses = forwardedFor.split(",");
        for (int index = addresses.length - 1; index >= 0; index--) {
            String address = addresses[index].trim();
            if (!TrustedProxyMatcher.isLiteralIpAddress(address)) {
                return directAddress;
            }
            if (!TrustedProxyMatcher.isTrustedProxyAddress(properties.getApp().getTrustedProxyAddresses(), address)) {
                return address;
            }
        }
        return directAddress;
    }

    /**
     * 标准化邮箱作为Redis限流键的一部分。
     *
     * @param email String 邮箱
     * @return String 标准化后的邮箱
     */
    private String normalizeEmail(String email) {
        return email == null ? "unknown" : email.trim().toLowerCase(java.util.Locale.ROOT);
    }
}

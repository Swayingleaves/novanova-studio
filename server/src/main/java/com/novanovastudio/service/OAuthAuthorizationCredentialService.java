package com.novanovastudio.service;

import com.alibaba.fastjson2.JSON;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.common.SystemMessage;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Duration;
import java.util.Base64;
import lombok.RequiredArgsConstructor;
import org.springframework.data.redis.core.ReactiveStringRedisTemplate;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import reactor.core.publisher.Mono;

/**
 * 对外 OAuth2 授权请求、授权码和访问令牌的临时存储。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-11-09 18:40
 */
@Service
@RequiredArgsConstructor
public class OAuthAuthorizationCredentialService {

    /** 授权请求有效期 */
    public static final Duration REQUEST_EXPIRE_DURATION = Duration.ofMinutes(10);

    /** 授权码有效期 */
    public static final Duration CODE_EXPIRE_DURATION = Duration.ofSeconds(60);

    /** 访问令牌有效期 */
    public static final Duration ACCESS_TOKEN_EXPIRE_DURATION = Duration.ofMinutes(10);

    /** 随机字节数 */
    private static final int RANDOM_BYTES = 32;

    /** 授权请求键前缀 */
    private static final String REQUEST_KEY_PREFIX = "novanova:oauth-server:request:";

    /** 授权码键前缀 */
    private static final String CODE_KEY_PREFIX = "novanova:oauth-server:code:";

    /** 访问令牌键前缀 */
    private static final String ACCESS_TOKEN_KEY_PREFIX = "novanova:oauth-server:access:";

    /** 安全随机数生成器 */
    private static final SecureRandom SECURE_RANDOM = new SecureRandom();

    /** Redis 字符串模板 */
    private final ReactiveStringRedisTemplate redisTemplate;

    /**
     * 保存待确认的授权请求。
     *
     * @param request PendingAuthorization 授权请求
     * @return Mono<String> 交给浏览器的请求标识
     */
    public Mono<String> saveRequest(PendingAuthorization request) {
        String requestId = randomToken();
        return save(REQUEST_KEY_PREFIX, requestId, JSON.toJSONString(request), REQUEST_EXPIRE_DURATION).thenReturn(requestId);
    }

    /**
     * 读取仍未消费的授权请求。
     *
     * @param requestId String 请求标识
     * @return Mono<PendingAuthorization> 授权请求，不存在时为空
     */
    public Mono<PendingAuthorization> peekRequest(String requestId) {
        if (!StringUtils.hasText(requestId)) {
            return Mono.empty();
        }
        return redisTemplate.opsForValue().get(REQUEST_KEY_PREFIX + sha256(requestId.trim()))
                .map(value -> JSON.parseObject(value, PendingAuthorization.class));
    }

    /**
     * 原子消费授权请求。
     *
     * @param requestId String 请求标识
     * @return Mono<PendingAuthorization> 授权请求，不存在或已使用时为空
     */
    public Mono<PendingAuthorization> consumeRequest(String requestId) {
        if (!StringUtils.hasText(requestId)) {
            return Mono.empty();
        }
        return redisTemplate.opsForValue().getAndDelete(REQUEST_KEY_PREFIX + sha256(requestId.trim()))
                .map(value -> JSON.parseObject(value, PendingAuthorization.class));
    }

    /**
     * 保存一次性授权码。
     *
     * @param code IssuedCode 授权码内容
     * @return Mono<String> 授权码
     */
    public Mono<String> saveCode(IssuedCode code) {
        String authorizationCode = randomToken();
        return save(CODE_KEY_PREFIX, authorizationCode, JSON.toJSONString(code), CODE_EXPIRE_DURATION).thenReturn(authorizationCode);
    }

    /**
     * 原子消费授权码。
     *
     * @param code String 授权码
     * @return Mono<IssuedCode> 授权码内容，不存在或已使用时为空
     */
    public Mono<IssuedCode> consumeCode(String code) {
        if (!StringUtils.hasText(code)) {
            return Mono.empty();
        }
        return redisTemplate.opsForValue().getAndDelete(CODE_KEY_PREFIX + sha256(code.trim()))
                .map(value -> JSON.parseObject(value, IssuedCode.class));
    }

    /**
     * 保存只用于读取用户信息的访问令牌。
     *
     * @param token IssuedAccessToken 访问令牌内容
     * @return Mono<String> 访问令牌
     */
    public Mono<String> saveAccessToken(IssuedAccessToken token) {
        String accessToken = randomToken();
        return save(ACCESS_TOKEN_KEY_PREFIX, accessToken, JSON.toJSONString(token), ACCESS_TOKEN_EXPIRE_DURATION).thenReturn(accessToken);
    }

    /**
     * 读取未过期的访问令牌。
     *
     * @param accessToken String 访问令牌
     * @return Mono<IssuedAccessToken> 令牌内容，不存在时为空
     */
    public Mono<IssuedAccessToken> readAccessToken(String accessToken) {
        if (!StringUtils.hasText(accessToken)) {
            return Mono.empty();
        }
        return redisTemplate.opsForValue().get(ACCESS_TOKEN_KEY_PREFIX + sha256(accessToken.trim()))
                .map(value -> JSON.parseObject(value, IssuedAccessToken.class));
    }

    /**
     * 写入哈希键，避免把原始凭证留在 Redis 键名中。
     *
     * @param prefix String 键前缀
     * @param token String 原始凭证
     * @param payload String JSON 内容
     * @param duration Duration 有效期
     * @return Mono<Void> 写入完成信号
     */
    private Mono<Void> save(String prefix, String token, String payload, Duration duration) {
        return redisTemplate.opsForValue()
                .set(prefix + sha256(token), payload, duration)
                .flatMap(saved -> saved
                        ? Mono.empty()
                        : Mono.error(new BusinessException(ErrorCode.SYSTEM_ERROR, SystemMessage.of("business.oauthCredentialSaveFailed"))));
    }

    /**
     * 生成 URL 安全的随机凭证。
     *
     * @return String 随机凭证
     */
    private String randomToken() {
        byte[] bytes = new byte[RANDOM_BYTES];
        SECURE_RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    /**
     * 计算 SHA-256 哈希。
     *
     * @param value String 原始字符串
     * @return String 十六进制哈希
     */
    private String sha256(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
            return java.util.HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("当前 Java 环境不支持 SHA-256", exception);
        }
    }

    /**
     * 待用户确认的授权请求。
     *
     * @param clientId 客户端标识
     * @param redirectUri 回调地址
     * @param state 授权状态
     * @param scope 授权范围
     * @param displayName 应用名称
     */
    public record PendingAuthorization(String clientId, String redirectUri, String state, String scope, String displayName) {
    }

    /**
     * 已签发的授权码。
     *
     * @param clientId 客户端标识
     * @param redirectUri 回调地址
     * @param userId 用户 ID
     * @param scope 授权范围
     */
    public record IssuedCode(String clientId, String redirectUri, long userId, String scope) {
    }

    /**
     * 已签发的访问令牌。
     *
     * @param clientId 客户端标识
     * @param userId 用户 ID
     * @param scope 授权范围
     */
    public record IssuedAccessToken(String clientId, long userId, String scope) {
    }
}

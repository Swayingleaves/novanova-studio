package com.novanovastudio.service;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
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
 * OAuth2一次性登录码服务
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-15 00:00
 */
@Service
@RequiredArgsConstructor
public class OAuth2LoginCodeService {

    /** Redis键前缀 */
    private static final String LOGIN_CODE_KEY_PREFIX = "novanova:oauth2:loginCode:";

    /** 一次性登录码有效期 */
    private static final Duration LOGIN_CODE_EXPIRE_DURATION = Duration.ofSeconds(60);

    /** 一次性登录码随机字节数 */
    private static final int LOGIN_CODE_RANDOM_BYTES = 32;

    /** 安全随机数生成器 */
    private static final SecureRandom SECURE_RANDOM = new SecureRandom();

    /** Redis字符串模板 */
    private final ReactiveStringRedisTemplate redisTemplate;

    /**
     * 为本地用户创建一次性登录码。
     *
     * @param userId Long 本地用户ID
     * @return Mono<String> 只返回给浏览器的一次性登录码
     */
    public Mono<String> create(Long userId) {
        byte[] randomBytes = new byte[LOGIN_CODE_RANDOM_BYTES];
        SECURE_RANDOM.nextBytes(randomBytes);
        String loginCode = Base64.getUrlEncoder().withoutPadding().encodeToString(randomBytes);
        return redisTemplate.opsForValue()
                .set(redisKey(loginCode), String.valueOf(userId), LOGIN_CODE_EXPIRE_DURATION)
                .flatMap(saved -> saved
                        ? Mono.just(loginCode)
                        : Mono.error(new IllegalStateException("OAuth2一次性登录码保存失败")));
    }

    /**
     * 原子消费一次性登录码。
     *
     * @param loginCode String 一次性登录码
     * @return Mono<Long> 本地用户ID
     * @throws BusinessException 登录码为空、失效或已经使用时抛出
     */
    public Mono<Long> consume(String loginCode) {
        if (!StringUtils.hasText(loginCode)) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_MISSING, "一次性登录码不能为空"));
        }
        return redisTemplate.opsForValue()
                .getAndDelete(redisKey(loginCode.trim()))
                .switchIfEmpty(Mono.error(new BusinessException(ErrorCode.AUTH_ERROR, "一次性登录码已失效或已使用")))
                .map(this::parseUserId);
    }

    /**
     * 构造只包含登录码哈希的Redis键。
     *
     * @param loginCode String 一次性登录码
     * @return String Redis键
     */
    private String redisKey(String loginCode) {
        return LOGIN_CODE_KEY_PREFIX + sha256(loginCode);
    }

    /**
     * 计算SHA-256哈希。
     *
     * @param value String 原始字符串
     * @return String 十六进制哈希
     */
    private String sha256(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
            return java.util.HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("当前Java环境不支持SHA-256", exception);
        }
    }

    /**
     * 解析本地用户ID。
     *
     * @param value String Redis中的用户ID字符串
     * @return Long 本地用户ID
     */
    private Long parseUserId(String value) {
        try {
            return Long.valueOf(value);
        } catch (NumberFormatException exception) {
            throw new BusinessException(ErrorCode.AUTH_ERROR, "一次性登录码关联用户无效");
        }
    }
}

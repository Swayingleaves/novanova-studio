package com.novanovastudio.security;

import com.alibaba.fastjson2.JSON;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.config.NovanovaProperties;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Base64;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

/**
 * @title        TokenService.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  自定义HMAC登录令牌服务
 * @createTime   2026-06-24 11:08:00
 */
@Service
@RequiredArgsConstructor
public class TokenService {

    /** HMAC算法名称 */
    private static final String HMAC_ALGORITHM = "HmacSHA256";

    /** HMAC密钥最小字节数 */
    private static final int MINIMUM_SECRET_KEY_BYTES = 32;

    /** 服务配置 */
    private final NovanovaProperties properties;

    /**
     * 签发登录令牌
     *
     * @param userId Long 用户ID
     * @param role String 用户角色
     * @return SignedToken 签名令牌
     */
    public SignedToken sign(Long userId, String role) {
        // 根据配置计算签发时间和过期时间。
        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        OffsetDateTime expiresAt = now.plusHours(Math.max(1, properties.getApp().getTokenExpireHours()));
        TokenClaims claims = new TokenClaims(userId, role, now.toEpochSecond(), expiresAt.toEpochSecond());
        try {
            // 将声明JSON进行URL安全Base64编码，再拼接HMAC签名。
            String payload = JSON.toJSONString(claims);
            String encodedPayload = Base64.getUrlEncoder().withoutPadding().encodeToString(payload.getBytes(StandardCharsets.UTF_8));
            return new SignedToken(encodedPayload + "." + signature(encodedPayload), expiresAt);
        } catch (Exception exception) {
            throw new BusinessException(ErrorCode.SYSTEM_ERROR, "签发令牌失败: " + exception.getMessage());
        }
    }

    /**
     * 解析并验证登录令牌
     *
     * @param token String 登录令牌
     * @return TokenClaims 登录声明
     */
    public TokenClaims parse(String token) {
        // 空Token直接视为未登录。
        if (!StringUtils.hasText(token)) {
            throw new BusinessException(ErrorCode.TOKEN_INVALID, "请先登录");
        }
        String[] parts = token.split("\\.", -1);
        // Token格式为payload.signature两段。
        if (parts.length != 2) {
            throw new BusinessException(ErrorCode.TOKEN_INVALID, "登录令牌格式不合法");
        }
        // 使用同一密钥重新计算签名并比较。
        if (!MessageDigest.isEqual(signature(parts[0]).getBytes(StandardCharsets.US_ASCII), parts[1].getBytes(StandardCharsets.US_ASCII))) {
            throw new BusinessException(ErrorCode.TOKEN_INVALID, "登录令牌签名不合法");
        }
        try {
            // 解码payload并校验用户ID和过期时间。
            byte[] payload = Base64.getUrlDecoder().decode(parts[0]);
            TokenClaims claims = JSON.parseObject(payload, TokenClaims.class);
            if (claims.userId() == null || claims.userId() <= 0 || claims.expiresAt() <= 0) {
                throw new BusinessException(ErrorCode.TOKEN_INVALID, "登录令牌内容不合法");
            }
            if (OffsetDateTime.now(ZoneOffset.UTC).toEpochSecond() > claims.expiresAt()) {
                throw new BusinessException(ErrorCode.TOKEN_EXPIRED, "登录已过期");
            }
            return claims;
        } catch (IllegalArgumentException exception) {
            throw new BusinessException(ErrorCode.TOKEN_INVALID, "登录令牌内容不合法");
        }
    }

    /**
     * 从Authorization请求头读取Bearer Token
     *
     * @param authorization String Authorization请求头
     * @return String Token
     */
    public String bearerToken(String authorization) {
        // 空请求头不返回Token。
        if (!StringUtils.hasText(authorization)) {
            return "";
        }
        String value = authorization.trim();
        int index = value.indexOf(' ');
        // 只接受Bearer scheme，其它鉴权头忽略。
        if (index <= 0 || !"Bearer".equalsIgnoreCase(value.substring(0, index))) {
            return "";
        }
        return value.substring(index + 1).trim();
    }

    /**
     * 计算令牌签名
     *
     * @param encodedPayload String 编码后的载荷
     * @return String 签名
     */
    private String signature(String encodedPayload) {
        // 签名前必须存在应用密钥。
        String secretKey = properties.getApp().getSecretKey();
        if (!StringUtils.hasText(secretKey)) {
            throw new BusinessException(ErrorCode.SYSTEM_ERROR, "APP_SECRET_KEY不能为空");
        }
        byte[] secretKeyBytes = secretKey.getBytes(StandardCharsets.UTF_8);
        if (secretKeyBytes.length < MINIMUM_SECRET_KEY_BYTES) {
            throw new BusinessException(ErrorCode.SYSTEM_ERROR, "APP_SECRET_KEY至少需要32字节随机值");
        }
        try {
            // 对编码后的payload计算HMAC-SHA256并使用URL安全Base64输出。
            Mac mac = Mac.getInstance(HMAC_ALGORITHM);
            mac.init(new SecretKeySpec(secretKeyBytes, HMAC_ALGORITHM));
            return Base64.getUrlEncoder().withoutPadding().encodeToString(mac.doFinal(encodedPayload.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception exception) {
            throw new BusinessException(ErrorCode.SYSTEM_ERROR, "计算令牌签名失败: " + exception.getMessage());
        }
    }

    /**
     * 登录令牌声明
     *
     * @param userId Long 用户ID
     * @param role String 用户角色
     * @param issuedAt long 签发时间
     * @param expiresAt long 过期时间
     */
    public record TokenClaims(Long userId, String role, long issuedAt, long expiresAt) {
    }

    /**
     * 签名令牌结果
     *
     * @param token String 令牌
     * @param expiresAt OffsetDateTime 过期时间
     */
    public record SignedToken(String token, OffsetDateTime expiresAt) {
    }
}

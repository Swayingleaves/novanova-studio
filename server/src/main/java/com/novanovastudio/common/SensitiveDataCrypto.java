package com.novanovastudio.common;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.Base64;
import java.util.HexFormat;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * 敏感数据加解密工具。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-08-02 12:00
 */
public final class SensitiveDataCrypto {

    /** 加密数据版本前缀。 */
    private static final String ENCRYPTED_VALUE_PREFIX = "v1:";

    /** AES-GCM认证标签位数。 */
    private static final int GCM_TAG_BITS = 128;

    /** AES-GCM随机数长度。 */
    private static final int GCM_NONCE_BYTES = 12;

    /** 安全随机数生成器。 */
    private static final SecureRandom SECURE_RANDOM = new SecureRandom();

    private SensitiveDataCrypto() {
    }

    /**
     * 使用应用密钥派生AES密钥并加密文本。
     *
     * @param value String 待加密文本
     * @param applicationSecretKey String 应用密钥
     * @return String 带版本前缀的Base64密文
     */
    public static String encrypt(String value, String applicationSecretKey) {
        try {
            byte[] nonce = new byte[GCM_NONCE_BYTES];
            SECURE_RANDOM.nextBytes(nonce);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(deriveKey(applicationSecretKey), "AES"), new GCMParameterSpec(GCM_TAG_BITS, nonce));
            byte[] ciphertext = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
            ByteBuffer buffer = ByteBuffer.allocate(nonce.length + ciphertext.length);
            buffer.put(nonce).put(ciphertext);
            return ENCRYPTED_VALUE_PREFIX + Base64.getEncoder().encodeToString(buffer.array());
        } catch (Exception exception) {
            throw new BusinessException(ErrorCode.SYSTEM_ERROR, "加密敏感数据失败: " + exception.getMessage());
        }
    }

    /**
     * 使用应用密钥解密文本。
     *
     * @param encryptedValue String 带版本前缀的密文
     * @param applicationSecretKey String 应用密钥
     * @return String 解密后的文本
     */
    public static String decrypt(String encryptedValue, String applicationSecretKey) {
        if (encryptedValue == null || encryptedValue.isBlank()) {
            return "";
        }
        if (!encryptedValue.startsWith(ENCRYPTED_VALUE_PREFIX)) {
            throw new BusinessException(ErrorCode.SYSTEM_ERROR, "敏感数据不是受支持的加密格式");
        }
        try {
            byte[] payload = Base64.getDecoder().decode(encryptedValue.substring(ENCRYPTED_VALUE_PREFIX.length()));
            if (payload.length <= GCM_NONCE_BYTES) {
                throw new IllegalArgumentException("加密数据长度不合法");
            }
            byte[] nonce = Arrays.copyOfRange(payload, 0, GCM_NONCE_BYTES);
            byte[] ciphertext = Arrays.copyOfRange(payload, GCM_NONCE_BYTES, payload.length);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(deriveKey(applicationSecretKey), "AES"), new GCMParameterSpec(GCM_TAG_BITS, nonce));
            return new String(cipher.doFinal(ciphertext), StandardCharsets.UTF_8);
        } catch (BusinessException exception) {
            throw exception;
        } catch (Exception exception) {
            throw new BusinessException(ErrorCode.SYSTEM_ERROR, "解密敏感数据失败: " + exception.getMessage());
        }
    }

    /**
     * 计算规范化敏感文本的SHA-256摘要。
     *
     * @param value String 已规范化的敏感文本
     * @return String 小写十六进制摘要
     */
    public static String sha256Hex(String value) {
        if (value == null) {
            throw new BusinessException(ErrorCode.PARAM_MISSING, "敏感文本不能为空");
        }
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception exception) {
            throw new BusinessException(ErrorCode.SYSTEM_ERROR, "生成敏感文本摘要失败: " + exception.getMessage());
        }
    }

    /**
     * 根据应用密钥派生固定长度AES密钥。
     *
     * @param applicationSecretKey String 应用密钥
     * @return byte[] 32字节AES密钥
     */
    private static byte[] deriveKey(String applicationSecretKey) {
        if (applicationSecretKey == null || applicationSecretKey.isBlank()) {
            throw new BusinessException(ErrorCode.SYSTEM_ERROR, "APP_SECRET_KEY未配置，无法保护敏感数据");
        }
        try {
            return MessageDigest.getInstance("SHA-256").digest(applicationSecretKey.getBytes(StandardCharsets.UTF_8));
        } catch (Exception exception) {
            throw new BusinessException(ErrorCode.SYSTEM_ERROR, "生成敏感数据加密密钥失败: " + exception.getMessage());
        }
    }
}

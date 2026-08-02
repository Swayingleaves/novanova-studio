package com.novanovastudio.common;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;

import org.junit.jupiter.api.Test;

/**
 * 敏感数据加解密测试。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-08-02 13:10
 */
class SensitiveDataCryptoTest {

    /**
     * 加密结果应保持v1格式且可解密回原文。
     */
    @Test
    void shouldEncryptAndDecryptWithVersionedFormat() {
        String first = SensitiveDataCrypto.encrypt("ABC123", "stable-secret");
        String second = SensitiveDataCrypto.encrypt("ABC123", "stable-secret");

        assertEquals("ABC123", SensitiveDataCrypto.decrypt(first, "stable-secret"));
        assertEquals("v1:", first.substring(0, 3));
        assertNotEquals(first, second);
        assertEquals(SensitiveDataCrypto.sha256Hex("ABC123"), SensitiveDataCrypto.sha256Hex("ABC123"));
    }
}

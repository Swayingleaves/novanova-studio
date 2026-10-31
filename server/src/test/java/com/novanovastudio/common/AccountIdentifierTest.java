package com.novanovastudio.common;

import static org.junit.jupiter.api.Assertions.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/**
 * 账号类型、大小写和用户名边界的共享校验测试。
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-18 17:00
 */
class AccountIdentifierTest {
    /** 邮箱统一小写，用户名保留大小写及中文。 */
    @Test
    void shouldNormalizeOnlyEmail() {
        assertEquals(new AccountIdentifier("member@example.com", "member@example.com"), AccountIdentifier.parse(" Member@Example.COM "));
        assertEquals(new AccountIdentifier("Creator_创作者", null), AccountIdentifier.parse(" Creator_创作者 "));
        assertEquals("Creator", AccountIdentifier.parse("Creator").defaultNickname());
        assertEquals("member", AccountIdentifier.parse("member@example.com").defaultNickname());
    }

    /**
     * 不允许空白用户名、嵌入空格或把无效邮箱解释为用户名。
     * @param value 待拒绝的账号输入
     */
    @ParameterizedTest
    @ValueSource(strings = {"", "   ", "member name", "name\tword", "name　word", "name@", "name@example"})
    void shouldRejectInvalidIdentifiers(String value) {
        assertThrows(BusinessException.class, () -> AccountIdentifier.parse(value));
    }

    /** 修改用户名时禁止邮箱式名称，长度按字符校验。 */
    @Test
    void shouldValidateUsernameAndPasswordBoundaries() {
        assertEquals("a".repeat(50), AccountIdentifier.username("a".repeat(50)));
        assertThrows(BusinessException.class, () -> AccountIdentifier.username("a".repeat(51)));
        assertThrows(BusinessException.class, () -> AccountIdentifier.username("member@example.com"));
        assertThrows(BusinessException.class, () -> AccountIdentifier.parse("x".repeat(45) + "@example.com").validateCreation());
        assertThrows(BusinessException.class, () -> AccountIdentifier.validatePassword("1234567"));
        assertDoesNotThrow(() -> AccountIdentifier.validatePassword("八个中文字符密码"));
    }
}

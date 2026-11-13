package com.novanovastudio.service;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.config.NovanovaProperties;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;

/**
 * 邮箱注册白名单的配置语义与域名匹配测试。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-11-02 19:00
 */
class EmailRegistrationPolicyTest {

    /**
     * 默认规则允许常见国内外邮箱，同时拒绝临时域名和相似域名。
     * @param email String 待检查邮箱
     * @param allowed boolean 是否应允许注册
     */
    @ParameterizedTest
    @CsvSource({
            "user@qq.com,true", "user@gmail.com,true", "user@139.com,true", "user@189.cn,true",
            "user@yeah.net,true", "user@sina.cn,true", "user@vip.qq.com,true", "user@vip.163.com,true",
            "user@yahoo.com,true", "user@live.com,true", "user@msn.com,true",
            "user@proton.me,true", "user@protonmail.com,true",
            "a56fv43@vn-v55.com,false", "881txi4@kuailejianfei8.com,false",
            "user@evilqq.com,false", "user@qq.com.evil.com,false", "user@sub.qq.com,false"
    })
    void shouldMatchDefaultDomainsExactly(String email, boolean allowed) {
        EmailRegistrationPolicy policy = new EmailRegistrationPolicy(new NovanovaProperties());
        assertEquals(allowed, policy.isAllowed(email));
        if (allowed) assertDoesNotThrow(() -> policy.validate(email));
        else assertThrows(BusinessException.class, () -> policy.validate(email));
    }

    /**
     * 自定义白名单支持前导 @、空格与大小写，不把缺失项当成不限。
     * @param configured String 白名单配置
     * @param email String 待检查邮箱
     * @param allowed boolean 是否应允许注册
     */
    @ParameterizedTest
    @CsvSource({
            "' @QQ.COM , Gmail.COM ',USER@QQ.COM,true",
            "' @QQ.COM , Gmail.COM ',user@gmail.com,true",
            "'qq.com',user@yahoo.com,false",
            "'qq.com,',user@vn-v55.com,false",
            "', ,',user@qq.com,false",
            "'@*',user@vn-v55.com,false",
            "'*.com',user@gmail.com,false"
    })
    void shouldApplyConfiguredDomains(String configured, String email, boolean allowed) {
        NovanovaProperties properties = new NovanovaProperties();
        properties.replaceEmailSettings(properties.emailSettings().withAllowedSuffixes(configured));
        assertEquals(allowed, new EmailRegistrationPolicy(properties).isAllowed(email));
    }

    /**
     * 只有明确配置空值或独立星号才允许任意邮箱域名。
     * @param configured String 不限制注册的配置
     */
    @ParameterizedTest
    @ValueSource(strings = {"", "  ", "*", "qq.com, *"})
    void shouldAllowAnyDomainWhenExplicitlyUnrestricted(String configured) {
        NovanovaProperties properties = new NovanovaProperties();
        properties.replaceEmailSettings(properties.emailSettings().withAllowedSuffixes(configured));
        assertDoesNotThrow(() -> new EmailRegistrationPolicy(properties).validate("user@custom.example"));
    }
}

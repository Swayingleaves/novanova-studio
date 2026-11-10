package com.novanovastudio.service;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.common.SystemMessage;
import com.novanovastudio.config.NovanovaProperties;
import java.util.Arrays;
import java.util.Locale;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

/**
 * 邮箱注册白名单规则，供邮箱注册与第三方首次注册共用。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-11-02 19:00
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class EmailRegistrationPolicy {

    /** 服务配置 */
    private final NovanovaProperties properties;

    /**
     * 判断邮箱域名是否在注册白名单内，空配置或独立星号表示不限制。
     *
     * @param email String 已通过格式校验的邮箱
     * @return boolean 是否允许注册
     */
    public boolean isAllowed(String email) {
        String configured = properties.emailSettings().allowedSuffixes();
        if (configured.isBlank()) return true;
        String domain = email.substring(email.lastIndexOf('@') + 1).toLowerCase(Locale.ROOT);
        // 完整匹配邮箱域名，禁止相似域名与未明确列出的子域名借用白名单。
        return Arrays.stream(configured.split(","))
                .map(String::trim)
                .map(suffix -> suffix.toLowerCase(Locale.ROOT))
                .anyMatch(suffix -> "*".equals(suffix)
                        || domain.equals(suffix.startsWith("@") ? suffix.substring(1) : suffix));
    }

    /**
     * 在发送注册验证码与提交注册前拒绝白名单外邮箱。
     *
     * @param email String 已通过格式校验的邮箱
     * @throws BusinessException 邮箱域名不在白名单内时抛出
     */
    public void validate(String email) {
        if (!isAllowed(email)) {
            log.info("邮箱注册被白名单拒绝: email={}", email);
            throw new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.emailSuffixNotAllowed"));
        }
    }
}

package com.novanovastudio.common;

import java.util.Locale;

/**
 * 用户名与邮箱共用的账号标识规则，禁止在两种账号之间自动回退。
 *
 * @param value 标准化后的登录标识
 * @param email 邮箱账号对应邮箱，用户名账号为空
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-18 17:00
 */
public record AccountIdentifier(String value, String email) {

    /**
     * 解析登录、创建或邀请所使用的账号。
     * @param input 用户输入
     * @return 已校验的账号标识
     * @throws BusinessException 账号格式无效时抛出
     */
    public static AccountIdentifier parse(String input) {
        String value = input == null ? "" : input.trim();
        if (value.contains("@")) {
            String email = value.toLowerCase(Locale.ROOT);
            if (email.length() > 100 || !email.matches("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$")) {
                throw new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.invalidEmailAddress"));
            }
            return new AccountIdentifier(email, email);
        }
        return new AccountIdentifier(username(value), null);
    }

    /**
     * 校验非邮箱用户名，保留大小写及原有字符。
     * @param input 新用户名
     * @return 去除首尾空格的用户名
     * @throws BusinessException 长度或字符不符合要求时抛出
     */
    public static String username(String input) {
        String value = input == null ? "" : input.trim();
        if (value.isEmpty() || value.codePointCount(0, value.length()) > 50 || value.contains("@")
                || value.codePoints().anyMatch(character -> Character.isWhitespace(character) || Character.isSpaceChar(character))) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.invalidUsername"));
        }
        return value;
    }

    /**
     * 复用所有密码入口的最小长度规则，密码内容不做裁剪。
     * @param password 明文密码
     * @throws BusinessException 不足八个字符时抛出
     */
    public static void validatePassword(String password) {
        if (password == null || password.codePointCount(0, password.length()) < 8) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.passwordNeedsAtLeastCharacters", 8));
        }
    }

    /**
     * 校验新账号初始用户名可写入现有用户名字段，既有邮箱登录不受限制。
     * @throws BusinessException 初始用户名超过五十个字符时抛出
     */
    public void validateCreation() {
        if (value.codePointCount(0, value.length()) > 50) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.usernameMustNotExceed50Characters"));
        }
    }

    /**
     * 生成未填写昵称时使用的显示名称。
     * @return 用户名或邮箱前缀
     */
    public String defaultNickname() { return email == null ? value : email.substring(0, email.indexOf('@')); }
}

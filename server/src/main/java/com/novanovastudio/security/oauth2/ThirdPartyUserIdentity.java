package com.novanovastudio.security.oauth2;

/**
 * 第三方平台标准化用户身份
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-15 00:00
 *
 * @param providerId 第三方认证渠道标识
 * @param providerUserId 第三方平台用户唯一标识
 * @param email 可信邮箱
 * @param nickname 用户昵称
 * @param avatar 用户头像地址
 */
public record ThirdPartyUserIdentity(String providerId, String providerUserId, String email, String nickname, String avatar) {
}

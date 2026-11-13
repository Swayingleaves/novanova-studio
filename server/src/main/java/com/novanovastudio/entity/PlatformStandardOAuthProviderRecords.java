package com.novanovastudio.entity;

import java.time.OffsetDateTime;
import lombok.Data;

/**
 * 平台标准 OAuth2 登录渠道配置持久化记录。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-11-09 14:30
 */
public final class PlatformStandardOAuthProviderRecords {

    private PlatformStandardOAuthProviderRecords() {
    }

    /** 标准 OAuth2 登录渠道配置记录 */
    @Data
    public static class StandardOAuthProviderRecord {
        /** 渠道标识，由管理后台生成 */
        private String provider;
        /** 渠道名称，展示在管理后台与登录页 */
        private String displayName;
        /** 是否启用该登录渠道 */
        private Boolean enabled;
        /** OAuth2 客户端 ID */
        private String clientId;
        /** AES-GCM 加密后的 OAuth2 客户端密钥 */
        private String clientSecretEncrypted;
        /** 完整回调地址 */
        private String redirectUri;
        /** OAuth2 授权端点 */
        private String authorizationUri;
        /** OAuth2 令牌端点 */
        private String tokenUri;
        /** OAuth2 用户信息端点 */
        private String userInfoUri;
        /** 授权范围，空格分隔 */
        private String scopes;
        /** 令牌端点客户端认证方式 */
        private String clientAuthenticationMethod;
        /** 用户信息接口中的用户标识字段名 */
        private String userNameAttribute;
        /** 用户信息接口中的邮箱字段名 */
        private String emailAttribute;
        /** 用户信息接口中的昵称字段名 */
        private String nicknameAttribute;
        /** 用户信息接口中的头像字段名 */
        private String avatarAttribute;
        /** 创建时间 */
        private OffsetDateTime createdAt;
        /** 最后更新时间 */
        private OffsetDateTime updatedAt;
    }
}

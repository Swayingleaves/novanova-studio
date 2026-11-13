package com.novanovastudio.entity;

import java.time.OffsetDateTime;
import lombok.Data;

/**
 * 平台 OAuth2 第三方登录渠道配置持久化记录。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-11-09 12:00
 */
public final class PlatformOAuthProviderRecords {

    private PlatformOAuthProviderRecords() {
    }

    /** 登录渠道配置记录 */
    @Data
    public static class OAuthProviderRecord {
        /** 渠道标识，与登录渠道实现保持一致 */
        private String provider;
        /** 是否启用该登录渠道 */
        private Boolean enabled;
        /** 第三方应用客户端 ID */
        private String clientId;
        /** AES-GCM 加密后的第三方应用客户端密钥 */
        private String clientSecretEncrypted;
        /** 第三方登录回调地址 */
        private String redirectUri;
        /** 配置最后更新时间 */
        private OffsetDateTime updatedAt;
    }
}

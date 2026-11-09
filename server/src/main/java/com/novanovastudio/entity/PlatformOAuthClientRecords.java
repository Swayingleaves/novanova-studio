package com.novanovastudio.entity;

import java.time.OffsetDateTime;
import lombok.Data;

/**
 * 对外 OAuth2 授权客户端持久化记录。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-11-09 18:40
 */
public final class PlatformOAuthClientRecords {

    /**
     * 禁止实例化。
     */
    private PlatformOAuthClientRecords() {
    }

    /** 对外 OAuth2 授权客户端记录 */
    @Data
    public static class OAuthClientRecord {
        /** 客户端标识，由服务端生成 */
        private String clientId;
        /** 应用名称，展示在授权确认页 */
        private String displayName;
        /** 是否允许该客户端发起授权 */
        private Boolean enabled;
        /** AES-GCM 加密后的客户端密钥 */
        private String clientSecretEncrypted;
        /** 允许的回调地址 JSON 数组 */
        private String redirectUris;
        /** 创建时间 */
        private OffsetDateTime createdAt;
        /** 最后更新时间 */
        private OffsetDateTime updatedAt;
    }
}

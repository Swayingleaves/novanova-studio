package com.novanovastudio.repository;

import com.novanovastudio.entity.User;
import com.novanovastudio.entity.UserIdentityBinding;
import com.novanovastudio.security.oauth2.ThirdPartyUserIdentity;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Base64;
import lombok.RequiredArgsConstructor;
import org.springframework.r2dbc.core.DatabaseClient;
import org.springframework.stereotype.Repository;
import reactor.core.publisher.Mono;

/**
 * OAuth2第三方用户身份仓储
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-15 00:00
 */
@Repository
@RequiredArgsConstructor
public class OAuth2IdentityRepository {

    /** 数据库客户端 */
    private final DatabaseClient databaseClient;

    /**
     * 根据第三方渠道和用户标识查询绑定。
     *
     * @param provider String 第三方认证渠道
     * @param providerUserId String 第三方平台用户唯一标识
     * @return Mono<UserIdentityBinding> 身份绑定
     */
    public Mono<UserIdentityBinding> findBinding(String provider, String providerUserId) {
        return databaseClient.sql("""
                        SELECT * FROM user_identity_bindings
                        WHERE provider = :provider AND provider_user_id = :providerUserId
                        """)
                .bind("provider", provider)
                .bind("providerUserId", providerUserId)
                .map((row, metadata) -> RowMappers.userIdentityBinding(row))
                .one();
    }

    /**
     * 更新第三方身份资料快照。
     *
     * @param bindingId Long 绑定记录ID
     * @param identity ThirdPartyUserIdentity 最新第三方身份
     * @return Mono<Void> 更新完成信号
     */
    public Mono<Void> updateBindingProfile(Long bindingId, ThirdPartyUserIdentity identity) {
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("""
                        UPDATE user_identity_bindings
                        SET provider_email = :providerEmail,
                            provider_nickname = :providerNickname,
                            provider_avatar = :providerAvatar,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE id = :id
                        """)
                .bind("providerEmail", identity.email())
                .bind("providerNickname", identity.nickname())
                .bind("id", bindingId);
        return R2dbcBindings.bindNullable(spec, "providerAvatar", nullableText(identity.avatar()), String.class)
                .fetch()
                .rowsUpdated()
                .then();
    }

    /**
     * 按可信邮箱解析本地用户，不存在时创建普通用户。
     *
     * @param identity ThirdPartyUserIdentity 第三方用户身份
     * @return Mono<ResolvedOAuthUser> 本地用户及创建状态
     */
    public Mono<ResolvedOAuthUser> resolveUserByTrustedEmail(ThirdPartyUserIdentity identity) {
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("""
                        INSERT INTO users(username, password, email, nickname, avatar, role, status, registered_at)
                        VALUES (:username, '', :email, :nickname, :avatar, 'user', 1, CURRENT_TIMESTAMP)
                        ON CONFLICT (email) DO UPDATE SET email = users.email
                        RETURNING users.*, 0::INTEGER AS credit_balance, (xmax = 0) AS created
                        """)
                .bind("username", buildLocalUsername(identity))
                .bind("email", identity.email())
                .bind("nickname", identity.nickname());
        return R2dbcBindings.bindNullable(spec, "avatar", nullableText(identity.avatar()), String.class)
                .map((row, metadata) -> new ResolvedOAuthUser(RowMappers.user(row), Boolean.TRUE.equals(row.get("created", Boolean.class))))
                .one();
    }

    /**
     * 第三方认证解析出的本地用户。
     *
     * @param user User 本地用户
     * @param created boolean 是否在本次认证中新建
     */
    public record ResolvedOAuthUser(User user, boolean created) {
    }

    /**
     * 创建或刷新第三方身份绑定，并返回权威本地用户ID。
     *
     * @param userId Long 候选本地用户ID
     * @param identity ThirdPartyUserIdentity 第三方用户身份
     * @return Mono<Long> 权威本地用户ID
     */
    public Mono<Long> upsertBinding(Long userId, ThirdPartyUserIdentity identity) {
        DatabaseClient.GenericExecuteSpec spec = databaseClient.sql("""
                        INSERT INTO user_identity_bindings(
                            user_id, provider, provider_user_id, provider_email, provider_nickname, provider_avatar
                        ) VALUES (
                            :userId, :provider, :providerUserId, :providerEmail, :providerNickname, :providerAvatar
                        )
                        ON CONFLICT (provider, provider_user_id) DO UPDATE SET
                            provider_email = EXCLUDED.provider_email,
                            provider_nickname = EXCLUDED.provider_nickname,
                            provider_avatar = EXCLUDED.provider_avatar,
                            updated_at = CURRENT_TIMESTAMP
                        RETURNING user_id
                        """)
                .bind("userId", userId)
                .bind("provider", identity.providerId())
                .bind("providerUserId", identity.providerUserId())
                .bind("providerEmail", identity.email())
                .bind("providerNickname", identity.nickname());
        return R2dbcBindings.bindNullable(spec, "providerAvatar", nullableText(identity.avatar()), String.class)
                .map((row, metadata) -> row.get("user_id", Long.class))
                .one();
    }

    /**
     * 将空字符串转换为数据库空值。
     *
     * @param value String 原始字符串
     * @return String 数据库存储值
     */
    private String nullableText(String value) {
        return value == null || value.isBlank() ? null : value;
    }

    /**
     * 构建长度固定且不暴露第三方用户标识的本地用户名。
     *
     * @param identity ThirdPartyUserIdentity 第三方用户身份
     * @return String 50字符本地用户名
     */
    private String buildLocalUsername(ThirdPartyUserIdentity identity) {
        String source = identity.providerId() + ":" + identity.providerUserId();
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(source.getBytes(StandardCharsets.UTF_8));
            return "oauth2_" + Base64.getUrlEncoder().withoutPadding().encodeToString(digest);
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("当前Java环境不支持SHA-256", exception);
        }
    }
}

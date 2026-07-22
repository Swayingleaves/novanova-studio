package com.novanovastudio.service;

import com.novanovastudio.entity.User;
import com.novanovastudio.repository.OAuth2IdentityRepository;
import com.novanovastudio.repository.UserRepository;
import com.novanovastudio.security.oauth2.OAuth2LoginException;
import com.novanovastudio.security.oauth2.ThirdPartyOAuth2Provider;
import com.novanovastudio.security.oauth2.ThirdPartyOAuth2ProviderRegistry;
import com.novanovastudio.security.oauth2.ThirdPartyUserIdentity;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.security.oauth2.core.oidc.user.OidcUser;
import org.springframework.stereotype.Service;
import org.springframework.transaction.reactive.TransactionalOperator;
import reactor.core.publisher.Mono;

/**
 * 第三方认证账号解析与绑定服务
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-15 00:00
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class ThirdPartyAuthenticationService {

    /** 第三方认证渠道注册表 */
    private final ThirdPartyOAuth2ProviderRegistry providerRegistry;

    /** 第三方身份仓储 */
    private final OAuth2IdentityRepository identityRepository;

    /** 用户仓储 */
    private final UserRepository userRepository;

    /** 积分服务 */
    private final CreditService creditService;

    /** 响应式事务操作器 */
    private final TransactionalOperator transactionalOperator;

    /**
     * 校验第三方身份并解析本地用户。
     *
     * @param providerId String 第三方认证渠道标识
     * @param oidcUser OidcUser OpenID Connect用户
     * @return Mono<User> 已绑定或新创建的本地用户
     */
    public Mono<User> authenticate(String providerId, OidcUser oidcUser) {
        return Mono.defer(() -> {
            ThirdPartyOAuth2Provider provider = providerRegistry.requireEnabled(providerId);
            ThirdPartyUserIdentity identity = provider.resolveIdentity(oidcUser);
            return identityRepository.findBinding(identity.providerId(), identity.providerUserId())
                    .flatMap(binding -> identityRepository.updateBindingProfile(binding.getId(), identity)
                            .then(userRepository.findById(binding.getUserId())
                                    .switchIfEmpty(Mono.error(new OAuth2LoginException("accountUnavailable", "第三方身份绑定的本地用户不存在")))))
                    .switchIfEmpty(Mono.defer(() -> createOrBindUser(identity)))
                    .flatMap(this::validateUserStatus)
                    .doOnNext(user -> log.info("第三方账号认证成功: provider={}, userId={}", identity.providerId(), user.getId()));
        });
    }

    /**
     * 按可信邮箱创建或绑定本地用户。
     *
     * @param identity ThirdPartyUserIdentity 第三方用户身份
     * @return Mono<User> 本地用户
     */
    private Mono<User> createOrBindUser(ThirdPartyUserIdentity identity) {
        // 用户解析和身份写入必须处于同一事务，避免只创建用户但未建立身份绑定。
        return identityRepository.resolveUserByTrustedEmail(identity)
                .flatMap(resolvedUser -> (resolvedUser.created() ? creditService.initializeAccount(resolvedUser.user().getId()) : Mono.<Void>empty())
                        .thenReturn(resolvedUser.user()))
                .flatMap(candidateUser -> identityRepository.upsertBinding(candidateUser.getId(), identity)
                        .flatMap(authoritativeUserId -> authoritativeUserId.equals(candidateUser.getId())
                                ? Mono.just(candidateUser)
                                : userRepository.findById(authoritativeUserId)
                                        .switchIfEmpty(Mono.error(new OAuth2LoginException("accountUnavailable", "第三方身份绑定的本地用户不存在")))))
                .as(transactionalOperator::transactional)
                .onErrorMap(DuplicateKeyException.class, exception -> new OAuth2LoginException("accountAlreadyBound", "当前本地账号已经绑定其他同渠道身份"));
    }

    /**
     * 校验本地用户状态。
     *
     * @param user User 本地用户
     * @return Mono<User> 状态正常的本地用户
     */
    private Mono<User> validateUserStatus(User user) {
        if (user.getStatus() == null || user.getStatus() != UserService.STATUS_NORMAL) {
            return Mono.error(new OAuth2LoginException("accountDisabled", "本地账号已被禁用"));
        }
        if (user.getId() == null) {
            return Mono.error(new OAuth2LoginException("accountUnavailable", "本地用户信息不完整"));
        }
        return Mono.just(user);
    }
}

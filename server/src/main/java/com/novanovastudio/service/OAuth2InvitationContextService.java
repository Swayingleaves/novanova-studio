package com.novanovastudio.service;

import com.alibaba.fastjson2.JSON;
import com.novanovastudio.security.oauth2.OAuth2LoginException;
import com.novanovastudio.security.oauth2.ThirdPartyOAuth2ProviderRegistry;
import java.security.SecureRandom;
import java.time.Duration;
import java.util.Base64;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.ReactiveStringRedisTemplate;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.server.WebSession;
import reactor.core.publisher.Mono;

/**
 * OAuth2跳转期间的服务端邀请上下文服务。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-09-09 00:00
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class OAuth2InvitationContextService {

    /** WebSession中的上下文标识属性名 */
    private static final String SESSION_ATTRIBUTE = "oauth2InvitationContextId";

    /** Redis键前缀 */
    private static final String REDIS_KEY_PREFIX = "novanova:oauth2:invitationContext:";

    /** 邀请上下文有效期 */
    private static final Duration CONTEXT_EXPIRE_DURATION = Duration.ofMinutes(10);

    /** 上下文标识随机字节数 */
    private static final int CONTEXT_RANDOM_BYTES = 32;

    /** 安全随机数生成器 */
    private static final SecureRandom SECURE_RANDOM = new SecureRandom();

    /** Redis字符串模板 */
    private final ReactiveStringRedisTemplate redisTemplate;

    /** 邀请服务 */
    private final InvitationService invitationService;

    /** 第三方登录渠道注册表 */
    private final ThirdPartyOAuth2ProviderRegistry providerRegistry;

    /**
     * 验证授权准备参数，并把邀请关系保存为十分钟有效的服务端上下文。
     *
     * @param providerId 第三方登录渠道标识
     * @param invitationCode 可选邀请码
     * @param session OAuth2握手使用的受限WebSession
     * @return 授权入口路径
     */
    public Mono<String> prepareAuthorization(String providerId, String invitationCode, WebSession session) {
        providerRegistry.requireEnabled(providerId);
        session.getAttributes().remove(SESSION_ATTRIBUTE);
        String authorizationPath = "/api/v1/auth/oauth/authorize/" + providerId;
        if (!StringUtils.hasText(invitationCode)) {
            return session.save().thenReturn(authorizationPath);
        }
        return invitationService.resolveInviterUserId(invitationCode)
                .flatMap(inviterUserId -> {
                    String contextId = randomContextId();
                    InvitationContext context = new InvitationContext(providerId, inviterUserId);
                    return redisTemplate.opsForValue()
                            .set(REDIS_KEY_PREFIX + contextId, JSON.toJSONString(context), CONTEXT_EXPIRE_DURATION)
                            .flatMap(saved -> {
                                if (!saved) {
                                    return Mono.error(new IllegalStateException("OAuth2邀请上下文保存失败"));
                                }
                                session.getAttributes().put(SESSION_ATTRIBUTE, contextId);
                                return session.save()
                                        .doOnSuccess(ignored -> log.info("OAuth2邀请上下文已准备: provider={}, inviterUserId={}, validMinutes=10", providerId, inviterUserId))
                                        .thenReturn(authorizationPath);
                            });
                });
    }

    /**
     * 原子消费OAuth2邀请上下文。
     *
     * @param providerId 实际完成回调的渠道标识
     * @param session OAuth2握手使用的WebSession
     * @return 可选邀请人用户ID
     * @throws OAuth2LoginException 上下文过期、重复使用或渠道不匹配时抛出
     */
    public Mono<Optional<Long>> consume(String providerId, WebSession session) {
        Object rawContextId = session.getAttributes().remove(SESSION_ATTRIBUTE);
        if (!(rawContextId instanceof String contextId) || !StringUtils.hasText(contextId)) {
            return Mono.just(Optional.empty());
        }
        return redisTemplate.opsForValue().getAndDelete(REDIS_KEY_PREFIX + contextId)
                .switchIfEmpty(Mono.error(new OAuth2LoginException("invitationContextExpired", "邀请授权上下文已过期或已使用")))
                .map(json -> parseContext(json, providerId))
                .doOnNext(context -> log.info("OAuth2邀请上下文已消费: provider={}, inviterUserId={}", providerId, context.inviterUserId()))
                .map(context -> Optional.of(context.inviterUserId()));
    }

    /**
     * 生成不可预测的上下文标识。
     *
     * @return URL安全上下文标识
     */
    private String randomContextId() {
        byte[] bytes = new byte[CONTEXT_RANDOM_BYTES];
        SECURE_RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    /**
     * 解析并校验邀请上下文。
     *
     * @param json Redis保存的上下文JSON
     * @param providerId 实际回调渠道
     * @return 已校验上下文
     */
    private InvitationContext parseContext(String json, String providerId) {
        InvitationContext context;
        try {
            context = JSON.parseObject(json, InvitationContext.class);
        } catch (RuntimeException exception) {
            throw new OAuth2LoginException("invitationContextInvalid", "邀请授权上下文无效");
        }
        if (context == null || context.inviterUserId() == null || !providerId.equals(context.providerId())) {
            throw new OAuth2LoginException("invitationContextInvalid", "邀请授权上下文与回调渠道不匹配");
        }
        return context;
    }

    /**
     * Redis保存的最小邀请上下文。
     *
     * @param providerId 第三方登录渠道标识
     * @param inviterUserId 邀请人用户ID
     */
    private record InvitationContext(String providerId, Long inviterUserId) {
    }
}

package com.novanovastudio.service;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.novanovastudio.security.oauth2.OAuth2LoginException;
import com.novanovastudio.security.oauth2.ThirdPartyOAuth2Provider;
import com.novanovastudio.security.oauth2.ThirdPartyOAuth2ProviderRegistry;
import java.time.Duration;
import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.ReactiveStringRedisTemplate;
import org.springframework.data.redis.core.ReactiveValueOperations;
import org.springframework.web.server.WebSession;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

/**
 * OAuth2邀请上下文服务测试。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-09-09 00:00
 */
class OAuth2InvitationContextServiceTest {

    /** Redis值操作器 */
    private ReactiveValueOperations<String, String> valueOperations;

    /** 邀请服务 */
    private InvitationService invitationService;

    /** 待测试服务 */
    private OAuth2InvitationContextService service;

    /** WebSession */
    private WebSession session;

    /** 会话属性 */
    private Map<String, Object> attributes;

    /**
     * 初始化测试依赖。
     */
    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        ReactiveStringRedisTemplate redisTemplate = mock(ReactiveStringRedisTemplate.class);
        valueOperations = mock(ReactiveValueOperations.class);
        invitationService = mock(InvitationService.class);
        ThirdPartyOAuth2ProviderRegistry providerRegistry = mock(ThirdPartyOAuth2ProviderRegistry.class);
        session = mock(WebSession.class);
        attributes = new HashMap<>();
        when(redisTemplate.opsForValue()).thenReturn(valueOperations);
        when(providerRegistry.requireEnabled("google")).thenReturn(mock(ThirdPartyOAuth2Provider.class));
        when(session.getAttributes()).thenReturn(attributes);
        when(session.save()).thenReturn(Mono.empty());
        service = new OAuth2InvitationContextService(redisTemplate, invitationService, providerRegistry);
    }

    /**
     * 有效邀请码应以十分钟有效期保存服务端上下文。
     */
    @Test
    void shouldPrepareInvitationContextForTenMinutes() {
        when(invitationService.resolveInviterUserId("INVITATIONCODE01")).thenReturn(Mono.just(5L));
        when(valueOperations.set(anyString(), anyString(), eq(Duration.ofMinutes(10)))).thenReturn(Mono.just(true));

        StepVerifier.create(service.prepareAuthorization("google", "INVITATIONCODE01", session))
                .expectNext("/api/v1/auth/oauth/authorize/google")
                .verifyComplete();

        verify(valueOperations).set(anyString(), anyString(), eq(Duration.ofMinutes(10)));
        verify(session).save();
    }

    /**
     * 已存在会话标识但Redis数据过期时应明确拒绝授权完成。
     */
    @Test
    void shouldRejectExpiredInvitationContext() {
        attributes.put("oauth2InvitationContextId", "expired-context");
        when(valueOperations.getAndDelete(anyString())).thenReturn(Mono.empty());

        StepVerifier.create(service.consume("google", session))
                .expectErrorMatches(error -> error instanceof OAuth2LoginException exception
                        && "invitationContextExpired".equals(exception.getErrorCode()))
                .verify();
    }

    /**
     * 没有邀请上下文时应按普通OAuth2登录继续。
     */
    @Test
    void shouldContinueWithoutInvitationContext() {
        StepVerifier.create(service.consume("google", session))
                .expectNextMatches(optional -> optional.isEmpty())
                .verifyComplete();
    }
}

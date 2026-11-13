package com.novanovastudio.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.SensitiveDataCrypto;
import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.dto.StandardOAuthConfigDtos;
import com.novanovastudio.entity.PlatformStandardOAuthProviderRecords;
import com.novanovastudio.repository.StandardOAuthProviderRepository;
import java.time.OffsetDateTime;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

/**
 * 标准 OAuth2 登录渠道配置服务测试
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-11-09 14:30
 */
class StandardOAuthProviderServiceTest {

    /** 测试渠道标识 */
    private static final String PROVIDER_ID = "c1234567890abcdefghij";

    /** 测试回调地址 */
    private static final String REDIRECT_URI = "https://studio.example.com/api/v1/auth/oauth/callback/" + PROVIDER_ID;

    /** 测试应用密钥 */
    private static final String SECRET_KEY = "test-secret-key";

    /**
     * 验证可以创建未启用、配置不完整的渠道。
     */
    @Test
    @DisplayName("可以创建未启用的标准 OAuth2 渠道")
    void shouldCreateDisabledProvider() {
        StandardOAuthProviderRepository repository = mock(StandardOAuthProviderRepository.class);
        when(repository.findByProvider(PROVIDER_ID)).thenReturn(Mono.empty());
        when(repository.insert(any())).thenReturn(Mono.just(1L));
        when(repository.findAll()).thenReturn(Flux.just(record(false, "", "profile email")));

        StepVerifier.create(service(repository).createProvider(request(false, "profile email", "")))
                .assertNext(info -> {
                    assertEquals(PROVIDER_ID, info.provider());
                    assertEquals("标准 OAuth2", info.displayName());
                    assertFalse(info.enabled());
                    assertEquals("/api/v1/auth/oauth/callback/" + PROVIDER_ID, info.callbackPath());
                })
                .verifyComplete();

        verify(repository).insert(any());
    }

    /**
     * 验证启用渠道时会加密客户端密钥并完成必填校验。
     */
    @Test
    @DisplayName("创建启用渠道时会加密密钥")
    void shouldCreateEnabledProviderWithEncryptedSecret() {
        StandardOAuthProviderRepository repository = mock(StandardOAuthProviderRepository.class);
        String encryptedSecret = SensitiveDataCrypto.encrypt("client-secret", SECRET_KEY);
        when(repository.findByProvider(PROVIDER_ID)).thenReturn(Mono.empty());
        when(repository.insert(any())).thenReturn(Mono.just(1L));
        when(repository.findAll()).thenReturn(Flux.just(record(true, encryptedSecret, "profile email")));

        StepVerifier.create(service(repository).createProvider(request(true, "profile email", "https://idp.example.com/authorize")))
                .assertNext(info -> {
                    assertTrue(info.enabled());
                    assertEquals("client-secret", info.clientSecret());
                })
                .verifyComplete();

        ArgumentCaptor<PlatformStandardOAuthProviderRecords.StandardOAuthProviderRecord> captor =
                ArgumentCaptor.forClass(PlatformStandardOAuthProviderRecords.StandardOAuthProviderRecord.class);
        verify(repository).insert(captor.capture());
        assertTrue(captor.getValue().getClientSecretEncrypted().startsWith("v1:"));
        assertFalse("client-secret".equals(captor.getValue().getClientSecretEncrypted()));
    }

    /**
     * 验证启用渠道缺少端点时拒绝保存。
     */
    @Test
    @DisplayName("启用渠道缺少授权端点时拒绝保存")
    void shouldRejectEnabledProviderWithoutEndpoint() {
        StandardOAuthProviderRepository repository = mock(StandardOAuthProviderRepository.class);

        assertBusinessKey(service(repository).createProvider(request(true, "profile email", "")),
                "business.standardOAuthAuthorizationUriIsRequired");

        verify(repository, never()).insert(any());
    }

    /**
     * 验证 openid 作用域被拒绝。
     */
    @Test
    @DisplayName("标准 OAuth2 渠道拒绝 openid 作用域")
    void shouldRejectOpenIdScope() {
        StandardOAuthProviderRepository repository = mock(StandardOAuthProviderRepository.class);

        assertBusinessKey(service(repository).createProvider(request(true, "openid profile email",
                "https://idp.example.com/authorize")), "business.standardOAuthScopesMustNotContainOpenid");

        verify(repository, never()).insert(any());
    }

    /**
     * 验证非法渠道标识被拒绝。
     */
    @Test
    @DisplayName("非法渠道标识被拒绝")
    void shouldRejectInvalidProviderId() {
        StandardOAuthProviderRepository repository = mock(StandardOAuthProviderRepository.class);

        assertBusinessKey(service(repository).createProvider(new StandardOAuthConfigDtos.ProviderRequest(
                        "google", "标准 OAuth2", false, "", "", "", "", "", "", "profile email",
                        "client_secret_basic", "sub", "email", "name", "picture")),
                "business.standardOAuthProviderIdIsInvalid");

        verify(repository, never()).insert(any());
    }

    /**
     * 验证重复的渠道标识被拒绝。
     */
    @Test
    @DisplayName("重复的渠道标识被拒绝")
    void shouldRejectDuplicateProvider() {
        StandardOAuthProviderRepository repository = mock(StandardOAuthProviderRepository.class);
        when(repository.findByProvider(PROVIDER_ID)).thenReturn(Mono.just(record(false, "", "profile email")));
        when(repository.findAll()).thenReturn(Flux.empty());

        assertBusinessKey(service(repository).createProvider(request(false, "profile email", "")),
                "business.standardOAuthProviderAlreadyExists");

        verify(repository, never()).insert(any());
    }

    /**
     * 验证可以更新渠道配置。
     */
    @Test
    @DisplayName("可以更新标准 OAuth2 渠道配置")
    void shouldUpdateProvider() {
        StandardOAuthProviderRepository repository = mock(StandardOAuthProviderRepository.class);
        when(repository.findByProvider(PROVIDER_ID)).thenReturn(Mono.just(record(false, "", "profile email")));
        when(repository.update(any())).thenReturn(Mono.just(1L));
        when(repository.findAll()).thenReturn(Flux.just(record(false, "", "profile email")));

        StepVerifier.create(service(repository).updateProvider(request(false, "profile email", "")))
                .assertNext(info -> assertEquals("标准 OAuth2", info.displayName()))
                .verifyComplete();

        verify(repository).update(any());
    }

    /**
     * 验证删除已有用户绑定的渠道会被拒绝。
     */
    @Test
    @DisplayName("已有用户绑定的渠道不允许删除")
    void shouldRejectDeleteProviderWithBindings() {
        StandardOAuthProviderRepository repository = mock(StandardOAuthProviderRepository.class);
        when(repository.findByProvider(PROVIDER_ID)).thenReturn(Mono.just(record(true, "", "profile email")));
        when(repository.countBindings(PROVIDER_ID)).thenReturn(Mono.just(2L));
        when(repository.findAll()).thenReturn(Flux.empty());

        assertBusinessKey(service(repository).deleteProvider(PROVIDER_ID), "business.standardOAuthProviderHasBindings");

        verify(repository, never()).delete(anyString());
    }

    /**
     * 验证没有绑定记录时可以删除渠道。
     */
    @Test
    @DisplayName("没有绑定记录的标准 OAuth2 渠道可以删除")
    void shouldDeleteProviderWithoutBindings() {
        StandardOAuthProviderRepository repository = mock(StandardOAuthProviderRepository.class);
        when(repository.findByProvider(PROVIDER_ID)).thenReturn(Mono.just(record(false, "", "profile email")));
        when(repository.countBindings(PROVIDER_ID)).thenReturn(Mono.just(0L));
        when(repository.delete(PROVIDER_ID)).thenReturn(Mono.just(1L));
        when(repository.findAll()).thenReturn(Flux.empty());

        StepVerifier.create(service(repository).deleteProvider(PROVIDER_ID)).verifyComplete();

        verify(repository).delete(PROVIDER_ID);
    }

    /**
     * 创建测试服务。
     *
     * @param repository StandardOAuthProviderRepository 渠道配置仓储
     * @return StandardOAuthProviderService 渠道配置服务
     */
    private StandardOAuthProviderService service(StandardOAuthProviderRepository repository) {
        NovanovaProperties properties = new NovanovaProperties();
        properties.getApp().setSecretKey(SECRET_KEY);
        return new StandardOAuthProviderService(repository, properties);
    }

    /**
     * 创建测试渠道配置请求。
     *
     * @param enabled boolean 是否启用
     * @param scopes String 授权范围
     * @param authorizationUri String 授权端点
     * @return ProviderRequest 渠道配置请求
     */
    private StandardOAuthConfigDtos.ProviderRequest request(boolean enabled, String scopes, String authorizationUri) {
        return new StandardOAuthConfigDtos.ProviderRequest(PROVIDER_ID, "标准 OAuth2", enabled, "client-id",
                "client-secret", REDIRECT_URI, authorizationUri, "https://idp.example.com/token",
                "https://idp.example.com/userinfo", scopes, "client_secret_basic", "sub", "email", "name", "picture");
    }

    /**
     * 创建测试渠道持久化记录。
     *
     * @param enabled boolean 是否启用
     * @param encryptedSecret String 加密后的客户端密钥
     * @param scopes String 授权范围
     * @return StandardOAuthProviderRecord 持久化记录
     */
    private PlatformStandardOAuthProviderRecords.StandardOAuthProviderRecord record(boolean enabled, String encryptedSecret, String scopes) {
        PlatformStandardOAuthProviderRecords.StandardOAuthProviderRecord record = new PlatformStandardOAuthProviderRecords.StandardOAuthProviderRecord();
        record.setProvider(PROVIDER_ID);
        record.setDisplayName("标准 OAuth2");
        record.setEnabled(enabled);
        record.setClientId("client-id");
        record.setClientSecretEncrypted(encryptedSecret);
        record.setRedirectUri(REDIRECT_URI);
        record.setAuthorizationUri("https://idp.example.com/authorize");
        record.setTokenUri("https://idp.example.com/token");
        record.setUserInfoUri("https://idp.example.com/userinfo");
        record.setScopes(scopes);
        record.setClientAuthenticationMethod("client_secret_basic");
        record.setUserNameAttribute("sub");
        record.setEmailAttribute("email");
        record.setNicknameAttribute("name");
        record.setAvatarAttribute("picture");
        record.setCreatedAt(OffsetDateTime.now());
        record.setUpdatedAt(OffsetDateTime.now());
        return record;
    }

    /**
     * 断言 Mono 以指定业务消息键失败。
     *
     * @param publisher Mono<?> 待验证的响应
     * @param expectedKey String 期望的消息键
     */
    private void assertBusinessKey(Mono<?> publisher, String expectedKey) {
        StepVerifier.create(publisher)
                .expectErrorSatisfies(error -> {
                    BusinessException exception = assertInstanceOf(BusinessException.class, error);
                    assertEquals(expectedKey, exception.getSystemMessage().key());
                })
                .verify();
    }
}

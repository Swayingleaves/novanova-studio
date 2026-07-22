package com.novanovastudio.security.oauth2;

import com.novanovastudio.service.OAuth2LoginCodeService;
import com.novanovastudio.service.ThirdPartyAuthenticationService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.client.authentication.OAuth2AuthenticationToken;
import org.springframework.security.oauth2.core.oidc.user.OidcUser;
import org.springframework.security.web.server.WebFilterExchange;
import org.springframework.security.web.server.authentication.ServerAuthenticationSuccessHandler;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Mono;

/**
 * OAuth2认证成功处理器
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-15 00:00
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class OAuth2LoginSuccessHandler implements ServerAuthenticationSuccessHandler {

    /** 第三方账号认证服务 */
    private final ThirdPartyAuthenticationService authenticationService;

    /** OAuth2一次性登录码服务 */
    private final OAuth2LoginCodeService loginCodeService;

    /** OAuth2回调重定向器 */
    private final OAuth2CallbackRedirector redirector;

    /**
     * 处理OAuth2认证成功结果。
     *
     * @param webFilterExchange WebFilterExchange 当前过滤器交换对象
     * @param authentication Authentication Spring Security认证结果
     * @return Mono<Void> 处理完成信号
     */
    @Override
    public Mono<Void> onAuthenticationSuccess(WebFilterExchange webFilterExchange, Authentication authentication) {
        if (!(authentication instanceof OAuth2AuthenticationToken oauth2Authentication)
                || !(oauth2Authentication.getPrincipal() instanceof OidcUser oidcUser)) {
            return redirector.redirectFailure(webFilterExchange, "providerIdentityUnavailable");
        }
        return authenticationService.authenticate(oauth2Authentication.getAuthorizedClientRegistrationId(), oidcUser)
                .flatMap(user -> loginCodeService.create(user.getId()))
                .flatMap(loginCode -> redirector.redirectSuccess(webFilterExchange, loginCode))
                .onErrorResume(OAuth2LoginException.class, exception -> {
                    log.error("OAuth2账号处理失败: errorCode={}, message={}", exception.getErrorCode(), exception.getMessage());
                    return redirector.redirectFailure(webFilterExchange, exception.getErrorCode());
                })
                .onErrorResume(exception -> {
                    log.error("OAuth2登录成功回调处理异常", exception);
                    return redirector.redirectFailure(webFilterExchange, "authorizationFailed");
                });
    }
}

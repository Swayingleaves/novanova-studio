package com.novanovastudio.security.oauth2;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.oauth2.core.OAuth2AuthenticationException;
import org.springframework.security.web.server.WebFilterExchange;
import org.springframework.security.web.server.authentication.ServerAuthenticationFailureHandler;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Mono;

/**
 * OAuth2认证失败处理器
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-15 00:00
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class OAuth2LoginFailureHandler implements ServerAuthenticationFailureHandler {

    /** OAuth2回调重定向器 */
    private final OAuth2CallbackRedirector redirector;

    /**
     * 处理OAuth2认证失败结果。
     *
     * @param webFilterExchange WebFilterExchange 当前过滤器交换对象
     * @param exception AuthenticationException Spring Security认证异常
     * @return Mono<Void> 处理完成信号
     */
    @Override
    public Mono<Void> onAuthenticationFailure(WebFilterExchange webFilterExchange, AuthenticationException exception) {
        String errorCode = oauth2ErrorCode(exception);
        log.error("OAuth2认证失败: errorCode={}, message={}", errorCode, exception.getMessage());
        return redirector.redirectFailure(webFilterExchange, errorCode);
    }

    /**
     * 将第三方错误转换为固定前端错误码。
     *
     * @param exception AuthenticationException Spring Security认证异常
     * @return String 固定前端错误码
     */
    private String oauth2ErrorCode(AuthenticationException exception) {
        if (exception instanceof OAuth2AuthenticationException oauth2Exception
                && "access_denied".equals(oauth2Exception.getError().getErrorCode())) {
            return "accessDenied";
        }
        return "authorizationFailed";
    }
}

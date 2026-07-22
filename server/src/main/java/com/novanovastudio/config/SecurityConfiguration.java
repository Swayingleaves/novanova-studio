package com.novanovastudio.config;

import com.novanovastudio.security.oauth2.OAuth2LoginFailureHandler;
import com.novanovastudio.security.oauth2.OAuth2LoginSuccessHandler;
import com.novanovastudio.security.oauth2.NonPersistentReactiveOidcSessionRegistry;
import com.novanovastudio.security.oauth2.NonPersistentServerOAuth2AuthorizedClientRepository;
import java.util.Arrays;
import java.util.List;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.web.server.ServerHttpSecurity;
import org.springframework.security.oauth2.client.registration.ReactiveClientRegistrationRepository;
import org.springframework.security.oauth2.client.web.OAuth2AuthorizationRequestCustomizers;
import org.springframework.security.oauth2.client.web.server.DefaultServerOAuth2AuthorizationRequestResolver;
import org.springframework.security.web.server.SecurityWebFilterChain;
import org.springframework.security.web.server.context.NoOpServerSecurityContextRepository;
import org.springframework.security.web.server.util.matcher.PathPatternParserServerWebExchangeMatcher;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.reactive.CorsConfigurationSource;
import org.springframework.web.cors.reactive.CorsWebFilter;
import org.springframework.web.cors.reactive.UrlBasedCorsConfigurationSource;

/**
 * @title        SecurityConfiguration.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  响应式安全配置
 * @createTime   2026-06-24 18:20:00
 */
@Configuration
public class SecurityConfiguration {

    /**
     * 创建响应式安全过滤器链
     *
     * @param http ServerHttpSecurity 响应式HTTP安全配置
     * @param clientRegistrationRepository ReactiveClientRegistrationRepository OAuth2客户端注册仓储
     * @param successHandler OAuth2LoginSuccessHandler OAuth2认证成功处理器
     * @param failureHandler OAuth2LoginFailureHandler OAuth2认证失败处理器
     * @param authorizedClientRepository NonPersistentServerOAuth2AuthorizedClientRepository 非持久化授权客户端仓储
     * @param oidcSessionRegistry NonPersistentReactiveOidcSessionRegistry 非持久化OpenID Connect会话注册表
     * @return SecurityWebFilterChain 安全过滤器链
     */
    @Bean
    public SecurityWebFilterChain securityWebFilterChain(ServerHttpSecurity http,
                                                          ReactiveClientRegistrationRepository clientRegistrationRepository,
                                                          OAuth2LoginSuccessHandler successHandler,
                                                          OAuth2LoginFailureHandler failureHandler,
                                                          NonPersistentServerOAuth2AuthorizedClientRepository authorizedClientRepository,
                                                          NonPersistentReactiveOidcSessionRegistry oidcSessionRegistry) {
        // 关闭跨站请求伪造防护并禁用表单登录，接口鉴权由自定义Token过滤器负责。
        http.csrf(ServerHttpSecurity.CsrfSpec::disable)
                .cors(cors -> {
                })
                .httpBasic(ServerHttpSecurity.HttpBasicSpec::disable)
                .formLogin(ServerHttpSecurity.FormLoginSpec::disable)
                .logout(ServerHttpSecurity.LogoutSpec::disable)
                .securityContextRepository(NoOpServerSecurityContextRepository.getInstance())
                .authorizeExchange(auth -> auth
                        .pathMatchers(HttpMethod.OPTIONS, "/**").permitAll()
                        .pathMatchers("/api/v1/health", "/api/v1/auth/sendEmailCode", "/api/v1/auth/register", "/api/v1/auth/login", "/api/v1/auth/oauth/**", "/swagger/**", "/swagger-ui/**", "/v3/api-docs/**", "/actuator/health").permitAll()
                        .anyExchange().permitAll());

        configureOAuth2Login(http, clientRegistrationRepository, successHandler, failureHandler, authorizedClientRepository, oidcSessionRegistry);
        return http.build();
    }

    /**
     * 配置OAuth2授权入口、PKCE和回调处理器。
     *
     * @param http ServerHttpSecurity 响应式HTTP安全配置
     * @param clientRegistrationRepository ReactiveClientRegistrationRepository OAuth2客户端注册仓储
     * @param successHandler OAuth2LoginSuccessHandler OAuth2认证成功处理器
     * @param failureHandler OAuth2LoginFailureHandler OAuth2认证失败处理器
     * @param authorizedClientRepository NonPersistentServerOAuth2AuthorizedClientRepository 非持久化授权客户端仓储
     * @param oidcSessionRegistry NonPersistentReactiveOidcSessionRegistry 非持久化OpenID Connect会话注册表
     */
    private void configureOAuth2Login(ServerHttpSecurity http,
                                      ReactiveClientRegistrationRepository clientRegistrationRepository,
                                      OAuth2LoginSuccessHandler successHandler,
                                      OAuth2LoginFailureHandler failureHandler,
                                      NonPersistentServerOAuth2AuthorizedClientRepository authorizedClientRepository,
                                      NonPersistentReactiveOidcSessionRegistry oidcSessionRegistry) {
        PathPatternParserServerWebExchangeMatcher authorizationMatcher =
                new PathPatternParserServerWebExchangeMatcher("/api/v1/auth/oauth/authorize/{registrationId}");
        DefaultServerOAuth2AuthorizationRequestResolver authorizationRequestResolver =
                new DefaultServerOAuth2AuthorizationRequestResolver(clientRegistrationRepository, authorizationMatcher);
        authorizationRequestResolver.setAuthorizationRequestCustomizer(OAuth2AuthorizationRequestCustomizers.withPkce());

        PathPatternParserServerWebExchangeMatcher callbackMatcher =
                new PathPatternParserServerWebExchangeMatcher("/api/v1/auth/oauth/callback/{registrationId}");
        http.oauth2Login(oauth2 -> oauth2
                .clientRegistrationRepository(clientRegistrationRepository)
                .authorizationRequestResolver(authorizationRequestResolver)
                .authenticationMatcher(callbackMatcher)
                .authorizedClientRepository(authorizedClientRepository)
                .oidcSessionRegistry(oidcSessionRegistry)
                .authenticationSuccessHandler(successHandler)
                .authenticationFailureHandler(failureHandler));
    }

    /**
     * 创建 CORS 响应式 Web 过滤器，在 WebFlux 层面拦截 OPTIONS 预检请求。
     * 使用 HIGHEST_PRECEDENCE + 1 使其在日志过滤器之后、安全过滤器链之前执行。
     *
     * @param corsConfigurationSource CorsConfigurationSource 跨域配置源
     * @return CorsWebFilter CORS 过滤器
     */
    @Bean
    @Order(Ordered.HIGHEST_PRECEDENCE + 1)
    public CorsWebFilter corsWebFilter(CorsConfigurationSource corsConfigurationSource) {
        // OPTIONS 预检请求由此过滤器处理，不会到达 controller 层。
        return new CorsWebFilter(corsConfigurationSource);
    }

    /**
     * 创建响应式跨域配置
     *
     * @param properties NovanovaProperties 服务端配置
     * @return CorsConfigurationSource 跨域配置源
     */
    @Bean
    public CorsConfigurationSource corsConfigurationSource(NovanovaProperties properties) {
        // 从应用配置读取允许来源，并配置前端访问服务端所需的HTTP方法与响应头。
        CorsConfiguration configuration = new CorsConfiguration();
        configuration.setAllowCredentials(false);
        configuration.setAllowedOrigins(validAllowedOrigins(properties));
        configuration.setAllowedMethods(Arrays.asList("GET", "POST", "PUT", "DELETE", "OPTIONS"));
        configuration.setAllowedHeaders(Arrays.asList("Authorization", "Content-Type", "Accept", "Origin", "X-Requested-With"));
        configuration.setExposedHeaders(Arrays.asList("Content-Type", "Cache-Control", "Connection", "X-Accel-Buffering"));
        configuration.setMaxAge(3600L); // 预检结果缓存1小时，减少OPTIONS请求
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        // 对所有服务端接口应用统一跨域规则。
        source.registerCorsConfiguration("/**", configuration);
        return source;
    }

    /**
     * 校验并返回允许跨域访问的精确来源。
     *
     * @param properties NovanovaProperties 服务端配置
     * @return List<String> 允许访问的来源列表
     * @throws IllegalStateException 配置为空或包含通配符时抛出
     */
    private List<String> validAllowedOrigins(NovanovaProperties properties) {
        List<String> origins = Arrays.stream(properties.getCors().getAllowedOriginPatterns().split(","))
                .map(String::trim)
                .filter(item -> !item.isEmpty())
                .toList();
        if (origins.isEmpty() || origins.stream().anyMatch("*"::equals)) {
            throw new IllegalStateException("CORS允许来源不能为空且不得使用通配符*");
        }
        return origins;
    }
}

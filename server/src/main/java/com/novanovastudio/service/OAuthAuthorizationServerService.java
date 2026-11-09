package com.novanovastudio.service;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.common.SystemMessage;
import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.dto.OAuthServerDtos;
import com.novanovastudio.entity.PlatformOAuthClientRecords;
import com.novanovastudio.entity.User;
import com.novanovastudio.repository.PlatformOAuthClientRepository;
import com.novanovastudio.repository.UserRepository;
import com.novanovastudio.security.TokenService;
import com.novanovastudio.security.oauthserver.OAuthProtocolException;
import com.novanovastudio.security.oauthserver.OAuthServerProtocol;
import com.novanovastudio.service.OAuthAuthorizationCredentialService.IssuedAccessToken;
import com.novanovastudio.service.OAuthAuthorizationCredentialService.IssuedCode;
import com.novanovastudio.service.OAuthAuthorizationCredentialService.PendingAuthorization;
import java.net.URI;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.util.UriComponentsBuilder;
import reactor.core.publisher.Mono;

/**
 * 对外 OAuth2 授权码、令牌和用户信息。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-11-09 18:40
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class OAuthAuthorizationServerService {

    /** 访问令牌秒数，与 Redis 有效期一致 */
    private static final int ACCESS_TOKEN_EXPIRES_IN = (int) OAuthAuthorizationCredentialService.ACCESS_TOKEN_EXPIRE_DURATION.toSeconds();

    /** 授权客户端仓储 */
    private final PlatformOAuthClientRepository clientRepository;

    /** 授权客户端配置，用于签发授权页图标 */
    private final OAuthClientConfigService clientConfigService;

    /** 用户仓储 */
    private final UserRepository userRepository;

    /** 临时凭证 */
    private final OAuthAuthorizationCredentialService credentials;

    /** 本站登录令牌，只用于从请求头识别 Bearer 方案 */
    private final TokenService tokenService;

    /** 服务配置 */
    private final NovanovaProperties properties;

    /**
     * 校验授权请求并跳到本站确认页。回调地址未登记时不向外站跳转。
     *
     * @param clientId String 客户端标识
     * @param redirectUri String 回调地址
     * @param responseType String 响应类型
     * @param scope String 授权范围
     * @param state String 授权状态
     * @param locale Locale 当前请求语言
     * @return Mono<AuthorizeOutcome> 跳转或错误页
     */
    public Mono<OAuthServerDtos.AuthorizeOutcome> beginAuthorization(String clientId, String redirectUri, String responseType,
                                                                     String scope, String state, Locale locale) {
        if (!StringUtils.hasText(clientId) || !StringUtils.hasText(redirectUri)) {
            return Mono.just(errorPage("business.oauthAuthorizeInvalidRequest"));
        }
        return clientRepository.findByClientId(clientId.trim())
                .map(client -> new ClientMatch(client, readRedirectUris(client), redirectUri))
                .flatMap(match -> {
                    if (!match.redirectAccepted()) {
                        return Mono.just(errorPage("business.oauthAuthorizeRedirectRejected"));
                    }
                    if (!Boolean.TRUE.equals(match.client().getEnabled())) {
                        return Mono.just(errorRedirect(match.redirectUri(), "unauthorized_client", "business.oauthAuthorizeClientDisabled", state, locale));
                    }
                    try {
                        OAuthServerProtocol.requireStateLength(state);
                    } catch (OAuthProtocolException exception) {
                        return Mono.just(errorRedirect(match.redirectUri(), exception.oauthError(), "business.oauthAuthorizeInvalidRequest", null, locale));
                    }
                    if (!"code".equals(responseType)) {
                        return Mono.just(errorRedirect(match.redirectUri(), "unsupported_response_type", "business.oauthAuthorizeUnsupportedResponseType", state, locale));
                    }
                    String grantedScope;
                    try {
                        grantedScope = OAuthServerProtocol.grantedScope(scope);
                    } catch (OAuthProtocolException exception) {
                        return Mono.just(errorRedirect(match.redirectUri(), exception.oauthError(), "business.oauthAuthorizeInvalidScope", state, locale));
                    }
                    PendingAuthorization pending = new PendingAuthorization(match.client().getClientId(), match.redirectUri(),
                            state == null ? "" : state, grantedScope, match.client().getDisplayName());
                    return credentials.saveRequest(pending)
                            .map(requestId -> new OAuthServerDtos.AuthorizeOutcome(consentUrl(requestId), null))
                            .doOnSuccess(ignored -> log.info("创建对外授权请求: clientId={}", match.client().getClientId()));
                })
                .switchIfEmpty(Mono.just(errorPage("business.oauthAuthorizeClientUnavailable")));
    }

    /**
     * 查询确认页要展示的应用名称、图标和说明。
     *
     * @param requestId String 授权请求标识
     * @return Mono<AuthorizationRequestView> 应用信息
     */
    public Mono<OAuthServerDtos.AuthorizationRequestView> authorizationRequest(String requestId) {
        return credentials.peekRequest(requestId)
                .switchIfEmpty(Mono.error(requestExpired()))
                .flatMap(request -> clientRepository.findByClientId(request.clientId())
                        .flatMap(client -> clientConfigService.signedLogoUrl(client)
                                .map(logoUrl -> new OAuthServerDtos.AuthorizationRequestView(
                                        client.getDisplayName(),
                                        request.scope(),
                                        logoUrl,
                                        client.getDisplayContent() == null ? "" : client.getDisplayContent())))
                        .switchIfEmpty(Mono.just(new OAuthServerDtos.AuthorizationRequestView(request.displayName(), request.scope(), "", ""))));
    }

    /**
     * 当前用户同意授权，返回带授权码的回调地址。
     *
     * @param requestId String 授权请求标识
     * @param userId Long 当前用户 ID
     * @return Mono<AuthorizationDecision> 回调地址
     */
    public Mono<OAuthServerDtos.AuthorizationDecision> approve(String requestId, Long userId) {
        return credentials.peekRequest(requestId)
                .switchIfEmpty(Mono.error(requestExpired()))
                .flatMap(request -> activeClient(request.clientId())
                        .flatMap(client -> {
                            if (!OAuthServerProtocol.redirectMatches(readRedirectUris(client), request.redirectUri())) {
                                return Mono.error(businessError(ErrorCode.PARAM_INVALID, "business.oauthAuthorizeRedirectRejected"));
                            }
                            return activeUser(userId).thenReturn(request);
                        }))
                .flatMap(request -> credentials.consumeRequest(requestId)
                        .switchIfEmpty(Mono.error(requestExpired()))
                        .flatMap(consumed -> credentials.saveCode(new IssuedCode(consumed.clientId(), consumed.redirectUri(), userId, consumed.scope()))
                                .map(code -> new OAuthServerDtos.AuthorizationDecision(OAuthServerProtocol.successCallback(consumed.redirectUri(), code, consumed.state())))))
                .doOnSuccess(decision -> log.info("用户同意对外授权: userId={}", userId));
    }

    /**
     * 当前用户拒绝授权，返回带 access_denied 的回调地址。
     *
     * @param requestId String 授权请求标识
     * @param userId Long 当前用户 ID
     * @param locale Locale 当前请求语言
     * @return Mono<AuthorizationDecision> 回调地址
     */
    public Mono<OAuthServerDtos.AuthorizationDecision> deny(String requestId, Long userId, Locale locale) {
        return credentials.peekRequest(requestId)
                .switchIfEmpty(Mono.error(requestExpired()))
                .flatMap(request -> activeClient(request.clientId())
                        .flatMap(client -> {
                            if (!OAuthServerProtocol.redirectMatches(readRedirectUris(client), request.redirectUri())) {
                                return Mono.error(businessError(ErrorCode.PARAM_INVALID, "business.oauthAuthorizeRedirectRejected"));
                            }
                            return Mono.just(request);
                        }))
                .flatMap(request -> credentials.consumeRequest(requestId)
                        .switchIfEmpty(Mono.error(requestExpired()))
                        .map(consumed -> new OAuthServerDtos.AuthorizationDecision(OAuthServerProtocol.errorCallback(
                                consumed.redirectUri(), "access_denied",
                                SystemMessage.of("business.oauthAuthorizeAccessDenied").render(locale), consumed.state()))))
                .doOnSuccess(decision -> log.info("用户拒绝对外授权: userId={}", userId));
    }

    /**
     * 用授权码换取访问令牌。
     *
     * @param authorization String Authorization 请求头
     * @param grantType String 授权类型
     * @param code String 授权码
     * @param redirectUri String 回调地址
     * @param clientId String 请求体中的客户端标识
     * @param clientSecret String 请求体中的客户端密钥
     * @return Mono<Map<String, Object>> OAuth 令牌响应
     */
    public Mono<Map<String, Object>> exchangeToken(String authorization, String grantType, String code, String redirectUri,
                                                   String clientId, String clientSecret) {
        String[] credentialsPair;
        try {
            credentialsPair = OAuthServerProtocol.clientCredentials(authorization, clientId, clientSecret);
        } catch (OAuthProtocolException exception) {
            return Mono.error(exception);
        }
        if (!StringUtils.hasText(grantType)) {
            return Mono.error(new OAuthProtocolException("invalid_request", HttpStatus.BAD_REQUEST, "grant_type is required"));
        }
        if (!"authorization_code".equals(grantType)) {
            return Mono.error(new OAuthProtocolException("unsupported_grant_type", HttpStatus.BAD_REQUEST, "Only authorization_code is supported"));
        }
        if (!StringUtils.hasText(code) || !StringUtils.hasText(redirectUri)) {
            return Mono.error(new OAuthProtocolException("invalid_request", HttpStatus.BAD_REQUEST, "code and redirect_uri are required"));
        }
        return authenticateClient(credentialsPair[0], credentialsPair[1])
                .flatMap(client -> credentials.consumeCode(code)
                        .switchIfEmpty(Mono.error(new OAuthProtocolException("invalid_grant", HttpStatus.BAD_REQUEST, "Authorization code is invalid or expired")))
                        .flatMap(issued -> acceptCode(client, issued, redirectUri)))
                .flatMap(issued -> credentials.saveAccessToken(new IssuedAccessToken(issued.clientId(), issued.userId(), issued.scope()))
                        .map(accessToken -> tokenResponse(accessToken, issued.scope())))
                .doOnSuccess(ignored -> log.info("交换对外访问令牌: clientId={}", credentialsPair[0]));
    }

    /**
     * 用访问令牌读取用户资料。
     *
     * @param authorization String Authorization 请求头
     * @return Mono<Map<String, String>> 用户资料
     */
    public Mono<Map<String, String>> userInfo(String authorization) {
        String accessToken = tokenService.bearerToken(authorization);
        if (!StringUtils.hasText(accessToken)) {
            return Mono.error(invalidToken());
        }
        return credentials.readAccessToken(accessToken)
                .switchIfEmpty(Mono.error(invalidToken()))
                .flatMap(token -> activeClient(token.clientId())
                        .onErrorMap(BusinessException.class, exception -> invalidToken())
                        .then(userRepository.findById(token.userId())
                                .switchIfEmpty(Mono.error(invalidToken()))
                                .flatMap(user -> user.getStatus() != null && user.getStatus() == UserService.STATUS_NORMAL
                                        ? Mono.just(profile(user))
                                        : Mono.error(invalidToken()))))
                .doOnSuccess(profile -> log.info("读取对外用户信息: userId={}", profile.get("sub")));
    }

    /**
     * 确认授权码属于当前客户端，且用户仍可登录。
     *
     * @param client OAuthClientRecord 已认证的客户端
     * @param issued IssuedCode 授权码内容
     * @param redirectUri String 换令牌时提交的回调地址
     * @return Mono<IssuedCode> 可用的授权码
     */
    private Mono<IssuedCode> acceptCode(PlatformOAuthClientRecords.OAuthClientRecord client, IssuedCode issued, String redirectUri) {
        if (!client.getClientId().equals(issued.clientId()) || !redirectUri.equals(issued.redirectUri()) || issued.userId() <= 0) {
            return Mono.error(new OAuthProtocolException("invalid_grant", HttpStatus.BAD_REQUEST, "Authorization code is invalid or expired"));
        }
        return userRepository.findById(issued.userId())
                .switchIfEmpty(Mono.error(new OAuthProtocolException("invalid_grant", HttpStatus.BAD_REQUEST, "Authorization code is invalid or expired")))
                .flatMap(user -> user.getStatus() != null && user.getStatus() == UserService.STATUS_NORMAL
                        ? Mono.just(issued)
                        : Mono.error(new OAuthProtocolException("invalid_grant", HttpStatus.BAD_REQUEST, "Authorization code is invalid or expired")));
    }

    /**
     * 校验客户端标识和密钥，并要求客户端处于启用状态。
     *
     * @param clientId String 客户端标识
     * @param clientSecret String 客户端密钥
     * @return Mono<OAuthClientRecord> 已认证的客户端
     */
    private Mono<PlatformOAuthClientRecords.OAuthClientRecord> authenticateClient(String clientId, String clientSecret) {
        return clientRepository.findByClientId(clientId)
                .switchIfEmpty(Mono.error(OAuthServerProtocol.invalidClient()))
                .flatMap(client -> decryptSecret(client.getClientSecretEncrypted())
                        .flatMap(storedSecret -> {
                            if (!OAuthServerProtocol.constantEquals(storedSecret, clientSecret)) {
                                return Mono.error(OAuthServerProtocol.invalidClient());
                            }
                            if (!Boolean.TRUE.equals(client.getEnabled())) {
                                return Mono.error(new OAuthProtocolException("unauthorized_client", HttpStatus.BAD_REQUEST, "Client is disabled"));
                            }
                            return Mono.just(client);
                        }));
    }

    /**
     * 读取启用中的客户端。
     *
     * @param clientId String 客户端标识
     * @return Mono<OAuthClientRecord> 客户端
     */
    private Mono<PlatformOAuthClientRecords.OAuthClientRecord> activeClient(String clientId) {
        return clientRepository.findByClientId(clientId)
                .switchIfEmpty(Mono.error(businessError(ErrorCode.RESOURCE_NOT_FOUND, "business.oauthAuthorizeClientUnavailable")))
                .flatMap(client -> Boolean.TRUE.equals(client.getEnabled())
                        ? Mono.just(client)
                        : Mono.error(businessError(ErrorCode.PARAM_INVALID, "business.oauthAuthorizeClientDisabled")));
    }

    /**
     * 确认用户仍可登录。
     *
     * @param userId Long 用户 ID
     * @return Mono<User> 用户
     */
    private Mono<User> activeUser(Long userId) {
        return userRepository.findById(userId)
                .switchIfEmpty(Mono.error(businessError(ErrorCode.RESOURCE_NOT_FOUND, "business.userNotFound")))
                .flatMap(user -> user.getStatus() != null && user.getStatus() == UserService.STATUS_NORMAL
                        ? Mono.just(user)
                        : Mono.error(businessError(ErrorCode.AUTH_ERROR, "business.oauthAuthorizeAccountDisabled")));
    }

    /**
     * 组装用户信息。邮箱或头像为空时不输出对应字段。
     *
     * @param user User 用户
     * @return Map<String, String> 用户资料
     */
    private Map<String, String> profile(User user) {
        String preferredUsername = firstText(user.getUsername(), user.getEmail(), "user" + user.getId());
        Map<String, String> profile = new LinkedHashMap<>();
        profile.put("sub", String.valueOf(user.getId()));
        profile.put("preferred_username", preferredUsername);
        profile.put("name", firstText(user.getNickname(), preferredUsername));
        if (StringUtils.hasText(user.getEmail())) {
            profile.put("email", user.getEmail().trim());
        }
        if (StringUtils.hasText(user.getAvatar())) {
            profile.put("picture", user.getAvatar().trim());
        }
        return profile;
    }

    /**
     * 组装令牌响应。
     *
     * @param accessToken String 访问令牌
     * @param scope String 授权范围
     * @return Map<String, Object> 令牌响应
     */
    private Map<String, Object> tokenResponse(String accessToken, String scope) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("access_token", accessToken);
        body.put("token_type", "Bearer");
        body.put("expires_in", ACCESS_TOKEN_EXPIRES_IN);
        body.put("scope", scope);
        return body;
    }

    /**
     * 解析已保存的回调地址。
     *
     * @param client OAuthClientRecord 客户端
     * @return List<String> 回调地址
     */
    private List<String> readRedirectUris(PlatformOAuthClientRecords.OAuthClientRecord client) {
        try {
            List<String> values = com.alibaba.fastjson2.JSON.parseArray(client.getRedirectUris(), String.class);
            return values == null ? List.of() : values;
        } catch (RuntimeException exception) {
            log.error("对外授权客户端回调地址无法解析: clientId={}", client.getClientId());
            return List.of();
        }
    }

    /**
     * 解密客户端密钥。解密失败按认证失败处理，避免把内部错误返回给外部系统。
     *
     * @param encrypted String 密文
     * @return Mono<String> 密钥明文
     */
    private Mono<String> decryptSecret(String encrypted) {
        if (!StringUtils.hasText(encrypted)) {
            return Mono.error(OAuthServerProtocol.invalidClient());
        }
        return Mono.fromCallable(() -> com.novanovastudio.common.SensitiveDataCrypto.decrypt(encrypted, properties.getApp().getSecretKey()))
                .subscribeOn(reactor.core.scheduler.Schedulers.boundedElastic())
                .onErrorMap(exception -> OAuthServerProtocol.invalidClient());
    }

    /**
     * 生成确认页地址。
     *
     * @param requestId String 授权请求标识
     * @return String 确认页地址
     */
    private String consentUrl(String requestId) {
        URI frontendUri = validateFrontendBaseUrl();
        return UriComponentsBuilder.newInstance()
                .scheme(frontendUri.getScheme())
                .host(frontendUri.getHost())
                .port(frontendUri.getPort())
                .path("/oauth/authorize")
                .queryParam("requestId", requestId)
                .build()
                .encode()
                .toUriString();
    }

    /**
     * 校验前端公开地址，确认页必须跳回浏览器可访问的站点。
     *
     * @return URI 前端公开地址
     */
    private URI validateFrontendBaseUrl() {
        String frontendBaseUrl = properties.getApp().getFrontendBaseUrl();
        if (!StringUtils.hasText(frontendBaseUrl)) {
            throw new BusinessException(ErrorCode.SYSTEM_ERROR, SystemMessage.of("business.fRONTENDBASEURLIsMissingCannotSendResetEmail"));
        }
        try {
            URI frontendUri = URI.create(frontendBaseUrl.trim());
            String scheme = frontendUri.getScheme();
            String path = frontendUri.getPath();
            if ((!"http".equalsIgnoreCase(scheme) && !"https".equalsIgnoreCase(scheme))
                    || !StringUtils.hasText(frontendUri.getHost())
                    || StringUtils.hasText(frontendUri.getRawUserInfo())
                    || StringUtils.hasText(frontendUri.getRawQuery())
                    || StringUtils.hasText(frontendUri.getRawFragment())
                    || (StringUtils.hasText(path) && !"/".equals(path))) {
                throw new BusinessException(ErrorCode.SYSTEM_ERROR, SystemMessage.of("business.fRONTENDBASEURLMustBeAPublicHTTPSOrigin"));
            }
            return frontendUri;
        } catch (IllegalArgumentException exception) {
            throw new BusinessException(ErrorCode.SYSTEM_ERROR, SystemMessage.of("business.invalidFRONTENDBASEURL"));
        }
    }

    /**
     * 构造带错误码的外部回调。
     *
     * @param redirectUri String 回调地址
     * @param error String OAuth 错误码
     * @param messageKey String 说明消息键
     * @param state String 授权状态
     * @param locale Locale 当前请求语言
     * @return AuthorizeOutcome 跳转结果
     */
    private OAuthServerDtos.AuthorizeOutcome errorRedirect(String redirectUri, String error, String messageKey, String state, Locale locale) {
        String description = SystemMessage.of(messageKey).render(locale);
        return new OAuthServerDtos.AuthorizeOutcome(OAuthServerProtocol.errorCallback(redirectUri, error, description, state), null);
    }

    /**
     * 构造本站错误页结果。
     *
     * @param messageKey String 消息键
     * @return AuthorizeOutcome 错误页结果
     */
    private OAuthServerDtos.AuthorizeOutcome errorPage(String messageKey) {
        return new OAuthServerDtos.AuthorizeOutcome(null, SystemMessage.of(messageKey));
    }

    /**
     * 创建授权请求失效错误。
     *
     * @return BusinessException 授权请求失效
     */
    private BusinessException requestExpired() {
        return businessError(ErrorCode.AUTH_ERROR, "business.oauthAuthorizationRequestExpired");
    }

    /**
     * 创建业务异常。
     *
     * @param errorCode int 错误码
     * @param messageKey String 消息键
     * @return BusinessException 业务异常
     */
    private BusinessException businessError(int errorCode, String messageKey) {
        return new BusinessException(errorCode, SystemMessage.of(messageKey));
    }

    /**
     * 创建访问令牌无效错误。
     *
     * @return OAuthProtocolException 访问令牌无效
     */
    private OAuthProtocolException invalidToken() {
        return new OAuthProtocolException("invalid_token", HttpStatus.UNAUTHORIZED, "Access token is invalid or expired");
    }

    /**
     * 返回第一个非空文本。
     *
     * @param values String 候选文本
     * @return String 非空文本，全部为空时返回空字符串
     */
    private String firstText(String... values) {
        for (String value : values) {
            if (StringUtils.hasText(value)) {
                return value.trim();
            }
        }
        return "";
    }

    /**
     * 客户端和本次回调地址是否匹配。
     *
     * @param client 客户端
     * @param redirectUris 已登记回调地址
     * @param redirectUri 请求中的回调地址
     */
    private record ClientMatch(PlatformOAuthClientRecords.OAuthClientRecord client, List<String> redirectUris, String redirectUri) {

        /**
         * 回调地址是否已登记。
         *
         * @return boolean 是否匹配
         */
        private boolean redirectAccepted() {
            return OAuthServerProtocol.redirectMatches(redirectUris, redirectUri);
        }
    }
}

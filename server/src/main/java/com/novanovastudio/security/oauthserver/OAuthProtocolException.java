package com.novanovastudio.security.oauthserver;

import org.springframework.http.HttpStatus;

/**
 * 对外 OAuth2 协议错误。响应必须使用 OAuth 的 error 字段，不能包装成业务响应。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-11-09 18:40
 */
public class OAuthProtocolException extends RuntimeException {

    /** OAuth 错误码 */
    private final String oauthError;

    /** HTTP 状态 */
    private final HttpStatus status;

    /**
     * 创建协议错误。
     *
     * @param oauthError String OAuth 错误码
     * @param status HttpStatus HTTP 状态
     * @param description String 给调用方看的简短说明
     */
    public OAuthProtocolException(String oauthError, HttpStatus status, String description) {
        super(description);
        this.oauthError = oauthError;
        this.status = status;
    }

    /**
     * 返回 OAuth 错误码。
     *
     * @return String 错误码
     */
    public String oauthError() {
        return oauthError;
    }

    /**
     * 返回 HTTP 状态。
     *
     * @return HttpStatus HTTP 状态
     */
    public HttpStatus status() {
        return status;
    }
}

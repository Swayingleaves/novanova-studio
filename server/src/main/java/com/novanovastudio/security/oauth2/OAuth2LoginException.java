package com.novanovastudio.security.oauth2;

/**
 * OAuth2登录业务异常
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-15 00:00
 */
public class OAuth2LoginException extends RuntimeException {

    /** 前端可识别的固定错误码 */
    private final String errorCode;

    /**
     * 创建OAuth2登录业务异常。
     *
     * @param errorCode String 前端可识别的固定错误码
     * @param message String 中文错误信息
     */
    public OAuth2LoginException(String errorCode, String message) {
        super(message);
        this.errorCode = errorCode;
    }

    /**
     * 获取固定错误码。
     *
     * @return String 固定错误码
     */
    public String getErrorCode() {
        return errorCode;
    }
}

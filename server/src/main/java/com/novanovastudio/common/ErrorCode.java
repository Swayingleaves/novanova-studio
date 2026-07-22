package com.novanovastudio.common;

/**
 * @title        ErrorCode.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  错误码定义
 * @createTime   2026-06-24 10:42:00
 */
public final class ErrorCode {

    /** 成功错误码 */
    public static final int SUCCESS = 0;

    /** 参数错误码 */
    public static final int PARAM_ERROR = 2000;

    /** 参数无效错误码 */
    public static final int PARAM_INVALID = 2001;

    /** 参数缺失错误码 */
    public static final int PARAM_MISSING = 2002;

    /** 鉴权错误码 */
    public static final int AUTH_ERROR = 3000;

    /** Token无效错误码 */
    public static final int TOKEN_INVALID = 3001;

    /** Token过期错误码 */
    public static final int TOKEN_EXPIRED = 3002;

    /** 权限不足错误码 */
    public static final int PERMISSION_DENIED = 3003;

    /** 业务逻辑错误码 */
    public static final int BUSINESS_ERROR = 4000;

    /** 资源不存在错误码 */
    public static final int RESOURCE_NOT_FOUND = 4001;

    /** 资源已存在错误码 */
    public static final int RESOURCE_ALREADY_EXISTS = 4002;

    /** 第三方调用错误码 */
    public static final int THIRD_PARTY_CALL_ERROR = 4003;

    /** 系统内部错误码 */
    public static final int SYSTEM_ERROR = 5000;

    /** 数据库错误码 */
    public static final int DATABASE_ERROR = 5001;

    /** 网络错误码 */
    public static final int NETWORK_ERROR = 5002;

    /**
     * 禁止实例化
     */
    private ErrorCode() {
    }
}

package com.novanovastudio.common;

/**
 * @title        BusinessException.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  业务异常
 * @createTime   2026-06-24 10:42:00
 */
public class BusinessException extends RuntimeException {

    /** 错误码 */
    private final int code;

    /**
     * 创建业务异常
     *
     * @param code int 错误码
     * @param message String 错误消息
     */
    public BusinessException(int code, String message) {
        super(message);
        this.code = code;
    }

    /**
     * 获取错误码
     *
     * @return int 错误码
     */
    public int getCode() {
        return code;
    }
}

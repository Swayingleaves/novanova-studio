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

    /** 与语言无关的消息，日志仍使用中文。 */
    private final SystemMessage systemMessage;

    /**
     * 创建业务异常
     *
     * @param code int 错误码
     * @param message String 错误消息
     */
    public BusinessException(int code, String message) {
        super(message);
        this.code = code;
        this.systemMessage = SystemMessage.of("system.externalFailure", message);
    }

    /**
     * 创建携带消息键和参数的业务异常。
     *
     * @param code int 业务错误码
     * @param message SystemMessage 语言中立消息
     */
    public BusinessException(int code, SystemMessage message) {
        super(message.render(java.util.Locale.SIMPLIFIED_CHINESE));
        this.code = code;
        this.systemMessage = message;
    }

    /**
     * 获取用于响应和任务持久化的系统消息。
     *
     * @return SystemMessage 消息键与参数
     */
    public SystemMessage getSystemMessage() {
        return systemMessage;
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

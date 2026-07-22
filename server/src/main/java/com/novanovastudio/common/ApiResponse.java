package com.novanovastudio.common;

/**
 * @title        ApiResponse.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  统一接口响应
 * @createTime   2026-06-24 10:42:00
 */
public record ApiResponse<T>(int code, T data, String msg) {

    /**
     * 构造成功响应
     *
     * @param data T 响应数据
     * @return ApiResponse<T> 成功响应
     */
    public static <T> ApiResponse<T> ok(T data) {
        return new ApiResponse<>(ErrorCode.SUCCESS, data, "success");
    }

    /**
     * 构造失败响应
     *
     * @param code int 错误码
     * @param msg String 错误消息
     * @return ApiResponse<Void> 失败响应
     */
    public static ApiResponse<Void> fail(int code, String msg) {
        return new ApiResponse<>(code, null, msg);
    }
}

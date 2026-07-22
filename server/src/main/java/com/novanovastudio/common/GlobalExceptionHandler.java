package com.novanovastudio.common;

import jakarta.validation.ConstraintViolationException;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.support.WebExchangeBindException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * @title        GlobalExceptionHandler.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  全局异常处理
 * @createTime   2026-06-24 10:42:00
 */
@RestControllerAdvice
public class GlobalExceptionHandler {

    /** 日志对象 */
    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    /**
     * 处理业务异常
     *
     * @param exception BusinessException 业务异常
     * @return ResponseEntity<ApiResponse<Void>> 响应
     */
    @ExceptionHandler(BusinessException.class)
    public ResponseEntity<ApiResponse<Void>> handleBusinessException(BusinessException exception) {
        // 根据业务错误码映射HTTP状态码，同时保持统一响应结构。
        HttpStatus status = switch (exception.getCode()) {
            case ErrorCode.TOKEN_INVALID, ErrorCode.TOKEN_EXPIRED, ErrorCode.AUTH_ERROR -> HttpStatus.UNAUTHORIZED;
            case ErrorCode.PERMISSION_DENIED -> HttpStatus.FORBIDDEN;
            case ErrorCode.RESOURCE_NOT_FOUND -> HttpStatus.NOT_FOUND;
            case ErrorCode.PARAM_ERROR, ErrorCode.PARAM_INVALID, ErrorCode.PARAM_MISSING -> HttpStatus.BAD_REQUEST;
            default -> HttpStatus.INTERNAL_SERVER_ERROR;
        };
        log.error("业务异常: code={}, message={}", exception.getCode(), exception.getMessage(), exception);
        return ResponseEntity.status(status).body(ApiResponse.fail(exception.getCode(), exception.getMessage()));
    }

    /**
     * 处理请求体验证异常
     *
     * @param exception MethodArgumentNotValidException 参数异常
     * @return ResponseEntity<ApiResponse<Void>> 响应
     */
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiResponse<Void>> handleMethodArgumentNotValidException(MethodArgumentNotValidException exception) {
        // 聚合字段校验错误，返回给前端展示。
        String message = exception.getBindingResult().getFieldErrors().stream().map(FieldError::getDefaultMessage).collect(Collectors.joining("; "));
        if (message.isBlank()) {
            message = "参数错误";
        }
        log.error("请求体验证异常: {}", message, exception);
        return ResponseEntity.badRequest().body(ApiResponse.fail(ErrorCode.PARAM_ERROR, message));
    }

    /**
     * 处理响应式请求体验证异常
     *
     * @param exception WebExchangeBindException 参数异常
     * @return ResponseEntity<ApiResponse<Void>> 响应
     */
    @ExceptionHandler(WebExchangeBindException.class)
    public ResponseEntity<ApiResponse<Void>> handleWebExchangeBindException(WebExchangeBindException exception) {
        // 聚合WebFlux字段校验错误，返回给前端展示。
        String message = exception.getFieldErrors().stream().map(FieldError::getDefaultMessage).collect(Collectors.joining("; "));
        if (message.isBlank()) {
            message = "参数错误";
        }
        log.error("响应式请求体验证异常: {}", message, exception);
        return ResponseEntity.badRequest().body(ApiResponse.fail(ErrorCode.PARAM_ERROR, message));
    }

    /**
     * 处理约束验证异常
     *
     * @param exception ConstraintViolationException 参数异常
     * @return ResponseEntity<ApiResponse<Void>> 响应
     */
    @ExceptionHandler(ConstraintViolationException.class)
    public ResponseEntity<ApiResponse<Void>> handleConstraintViolationException(ConstraintViolationException exception) {
        // 处理请求参数级别的约束异常。
        log.error("约束验证异常: {}", exception.getMessage(), exception);
        return ResponseEntity.badRequest().body(ApiResponse.fail(ErrorCode.PARAM_ERROR, exception.getMessage()));
    }

    /**
     * 处理未捕获异常
     *
     * @param exception Exception 异常
     * @return ResponseEntity<ApiResponse<Void>> 响应
     */
    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiResponse<Void>> handleException(Exception exception) {
        // Netty ReadOnlyHttpHeaders.set() 在响应已提交后抛 UnsupportedOperationException，
        // 此时请求已正确处理完毕，降级为 debug 不打印堆栈。
        if (exception instanceof UnsupportedOperationException
                && exception.getStackTrace().length > 0
                && "org.springframework.http.ReadOnlyHttpHeaders".equals(exception.getStackTrace()[0].getClassName())) {
            log.debug("Netty响应头已提交，跳过异常: {}", exception.getMessage());
            return null;
        }
        // 未预期异常写日志，并向前端返回系统错误。
        log.error("服务端异常", exception);
        return ResponseEntity.internalServerError().body(ApiResponse.fail(ErrorCode.SYSTEM_ERROR, "系统内部错误: " + exception.getMessage()));
    }
}

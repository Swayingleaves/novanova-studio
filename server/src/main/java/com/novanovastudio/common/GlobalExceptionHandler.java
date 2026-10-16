package com.novanovastudio.common;

import jakarta.validation.ConstraintViolationException;
import org.springframework.core.io.buffer.DataBufferLimitException;
import org.springframework.web.reactive.resource.NoResourceFoundException;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.support.WebExchangeBindException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.server.ServerWebExchange;
import org.springframework.web.server.ServerWebInputException;

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
     * @param exchange ServerWebExchange 当前请求
     * @return ResponseEntity<ApiResponse<Void>> 响应
     */
    @ExceptionHandler(BusinessException.class)
    public ResponseEntity<ApiResponse<Void>> handleBusinessException(BusinessException exception, ServerWebExchange exchange) {
        // 根据业务错误码映射HTTP状态码，同时保持统一响应结构。
        HttpStatus status = switch (exception.getCode()) {
            case ErrorCode.TOKEN_INVALID, ErrorCode.TOKEN_EXPIRED, ErrorCode.AUTH_ERROR -> HttpStatus.UNAUTHORIZED;
            case ErrorCode.PERMISSION_DENIED -> HttpStatus.FORBIDDEN;
            case ErrorCode.RESOURCE_NOT_FOUND -> HttpStatus.NOT_FOUND;
            case ErrorCode.DATA_CONFLICT -> HttpStatus.CONFLICT;
            case ErrorCode.PARAM_ERROR, ErrorCode.PARAM_INVALID, ErrorCode.PARAM_MISSING -> HttpStatus.BAD_REQUEST;
            default -> HttpStatus.INTERNAL_SERVER_ERROR;
        };
        log.error("业务异常: code={}, message={}", exception.getCode(), exception.getMessage(), exception);
        return ResponseEntity.status(status)
                .header("X-System-Message-Key", exception.getSystemMessage().key())
                .body(ApiResponse.fail(exception.getCode(), exception.getSystemMessage().render(WebsiteLanguage.resolve(exchange))));
    }

    /**
     * 处理请求体验证异常
     *
     * @param exception MethodArgumentNotValidException 参数异常
     * @param exchange ServerWebExchange 当前请求
     * @return ResponseEntity<ApiResponse<Void>> 响应
     */
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiResponse<Void>> handleMethodArgumentNotValidException(MethodArgumentNotValidException exception, ServerWebExchange exchange) {
        // 聚合字段校验错误，返回给前端展示。
        String message = exception.getBindingResult().getFieldErrors().stream().map(error -> validationMessage(error.getDefaultMessage(), exchange)).collect(Collectors.joining("; "));
        if (message.isBlank()) {
            message = SystemMessage.of("system.parameterError").render(WebsiteLanguage.resolve(exchange));
        }
        log.error("请求体验证异常: {}", message, exception);
        return ResponseEntity.badRequest().body(ApiResponse.fail(ErrorCode.PARAM_ERROR, message));
    }

    /**
     * 处理响应式请求体验证异常
     *
     * @param exception WebExchangeBindException 参数异常
     * @param exchange ServerWebExchange 当前请求
     * @return ResponseEntity<ApiResponse<Void>> 响应
     */
    @ExceptionHandler(WebExchangeBindException.class)
    public ResponseEntity<ApiResponse<Void>> handleWebExchangeBindException(WebExchangeBindException exception, ServerWebExchange exchange) {
        // 聚合WebFlux字段校验错误，返回给前端展示。
        String message = exception.getFieldErrors().stream().map(error -> validationMessage(error.getDefaultMessage(), exchange)).collect(Collectors.joining("; "));
        if (message.isBlank()) {
            message = SystemMessage.of("system.parameterError").render(WebsiteLanguage.resolve(exchange));
        }
        log.error("响应式请求体验证异常: {}", message, exception);
        return ResponseEntity.badRequest().body(ApiResponse.fail(ErrorCode.PARAM_ERROR, message));
    }

    /**
     * 处理约束验证异常
     *
     * @param exception ConstraintViolationException 参数异常
     * @param exchange ServerWebExchange 当前请求
     * @return ResponseEntity<ApiResponse<Void>> 响应
     */
    @ExceptionHandler(ConstraintViolationException.class)
    public ResponseEntity<ApiResponse<Void>> handleConstraintViolationException(ConstraintViolationException exception, ServerWebExchange exchange) {
        // 处理请求参数级别的约束异常。
        log.error("约束验证异常: {}", exception.getMessage(), exception);
        String message = exception.getConstraintViolations().stream().map(violation -> validationMessage(violation.getMessageTemplate(), exchange)).collect(Collectors.joining("; "));
        return ResponseEntity.badRequest().body(ApiResponse.fail(ErrorCode.PARAM_ERROR, message));
    }

    /**
     * 处理不存在的接口请求（如扫描/爬虫访问不存在的路径）
     *
     * @param exception NoResourceFoundException 静态资源不存在异常
     * @param exchange ServerWebExchange 当前请求
     * @return ResponseEntity<ApiResponse<Void>> 响应
     */
    @ExceptionHandler(NoResourceFoundException.class)
    public ResponseEntity<ApiResponse<Void>> handleNoResourceFoundException(NoResourceFoundException exception, ServerWebExchange exchange) {
        // 不存在的接口不做错误日志，避免被扫描请求刷屏；仅 debug 级别记录
        log.error("不存在的接口请求: {}", exception.getMessage());
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(ApiResponse.fail(ErrorCode.RESOURCE_NOT_FOUND, SystemMessage.of("system.endpointNotFound").render(WebsiteLanguage.resolve(exchange))));
    }

    /**
     * 处理上传文件超过服务端单文件上限
     *
     * @param exception DataBufferLimitException 缓冲区超限异常
     * @return ResponseEntity<ApiResponse<Void>> 响应
     */
    @ExceptionHandler(DataBufferLimitException.class)
    public ResponseEntity<ApiResponse<Void>> handleDataBufferLimitException(DataBufferLimitException exception) {
        // 多部分上传在超过 max-in-memory-size / max-disk-usage-per-part 时抛出，给出可读提示而非系统错误。
        log.error("上传文件超过服务端上限: {}", exception.getMessage());
        return ResponseEntity.badRequest().body(ApiResponse.fail(ErrorCode.PARAM_INVALID, "上传文件超过 50 MB 上限，请压缩后重试"));
    }

    /**
     * 处理未捕获异常
     *
     * @param exception Exception 异常
     * @param exchange ServerWebExchange 当前请求
     * @return ResponseEntity<ApiResponse<Void>> 响应
     */
    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiResponse<Void>> handleException(Exception exception, ServerWebExchange exchange) {
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
        return ResponseEntity.internalServerError().body(ApiResponse.fail(ErrorCode.SYSTEM_ERROR, SystemMessage.of("system.internalError").render(WebsiteLanguage.resolve(exchange))));
    }

    /**
     * 在响应边界翻译明确的参数校验消息键。
     *
     * @param key String 校验消息键
     * @param exchange ServerWebExchange 当前请求
     * @return String 当前语言的校验说明
     */
    private String validationMessage(String key, ServerWebExchange exchange) {
        return key != null && key.startsWith("business.")
                ? SystemMessage.of(key).render(WebsiteLanguage.resolve(exchange))
                : SystemMessage.of("system.parameterError").render(WebsiteLanguage.resolve(exchange));
    }

    /**
     * 处理无法解析的请求参数或请求体。
     * @param exception ServerWebInputException 参数解析异常
     * @param exchange ServerWebExchange 当前请求
     * @return ResponseEntity<ApiResponse<Void>> 参数错误响应
     */
    @ExceptionHandler(ServerWebInputException.class)
    public ResponseEntity<ApiResponse<Void>> handleInputException(ServerWebInputException exception, ServerWebExchange exchange) {
        log.error("请求参数解析失败", exception);
        return ResponseEntity.badRequest().body(ApiResponse.fail(ErrorCode.PARAM_ERROR,
                SystemMessage.of("system.parameterError").render(WebsiteLanguage.resolve(exchange))));
    }
}

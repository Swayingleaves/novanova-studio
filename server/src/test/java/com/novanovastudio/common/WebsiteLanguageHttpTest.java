package com.novanovastudio.common;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.reactive.server.WebTestClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * HTTP响应边界的双语业务错误、权限和参数校验测试。
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-16 00:00
 */
class WebsiteLanguageHttpTest {

    /** 使用实际异常处理器，不连接数据库或外部服务。 */
    private final WebTestClient client = WebTestClient.bindToController(new LanguageController())
            .controllerAdvice(new GlobalExceptionHandler()).build();

    /** 验证登录错误保留错误码并按请求头翻译。 */
    @Test
    void shouldTranslateLoginFailure() {
        client.get().uri("/loginFailure").header("Accept-Language", "en-US").exchange()
                .expectStatus().isUnauthorized().expectHeader().valueEquals("X-System-Message-Key", "business.incorrectEmailOrPassword").expectBody()
                .jsonPath("$.code").isEqualTo(ErrorCode.AUTH_ERROR)
                .jsonPath("$.msg").isEqualTo("Incorrect email or password");
        client.get().uri("/loginFailure").header("Accept-Language", "zh-CN").exchange()
                .expectStatus().isUnauthorized().expectBody().jsonPath("$.msg").isEqualTo("邮箱或密码错误");
    }

    /** 验证字段校验说明和权限不足说明。 */
    @Test
    void shouldTranslateValidationAndPermission() {
        client.post().uri("/validateInput").header("Accept-Language", "en").bodyValue(new Input(""))
                .exchange().expectStatus().isBadRequest().expectBody().jsonPath("$.msg").isEqualTo("Email is required");
        client.get().uri("/permissionFailure").header("Accept-Language", "en").exchange()
                .expectStatus().isForbidden().expectBody().jsonPath("$.msg").isEqualTo("Permission denied");
    }

    /** 测试请求结构。 @param email String 邮箱 */
    record Input(@NotBlank(message = "business.emailIsRequired") String email) {
    }

    /** 测试专用控制器。 */
    @RestController
    static class LanguageController {
        /** @return ApiResponse<Void> 登录错误响应 */
        @GetMapping("/loginFailure")
        ApiResponse<Void> loginFailure() {
            throw new BusinessException(ErrorCode.AUTH_ERROR, SystemMessage.of("business.incorrectEmailOrPassword"));
        }

        /** @return ApiResponse<Void> 权限错误响应 */
        @GetMapping("/permissionFailure")
        ApiResponse<Void> permissionFailure() {
            throw new BusinessException(ErrorCode.PERMISSION_DENIED, SystemMessage.of("business.permissionDenied"));
        }

        /**
         * 验证请求字段，成功时返回统一响应。
         * @param input Input 请求参数
         * @return ApiResponse<Void> 校验结果
         */
        @PostMapping("/validateInput")
        ApiResponse<Void> validateInput(@Valid @RequestBody Input input) {
            return ApiResponse.ok(null);
        }
    }
}

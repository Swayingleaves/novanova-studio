package com.novanovastudio.ai;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import java.net.http.HttpTimeoutException;
import java.util.Map;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

/**
 * AI结构化错误解析、分类和敏感信息过滤测试。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-08-01 00:00
 */
class AiErrorSupportTest {

    /**
     * 内容策略错误必须保留供应商结构字段并允许调整提示词。
     */
    @Test
    void shouldClassifyPromptPolicyViolation() {
        AiErrorDetails error = AiErrorSupport.classifyProviderResponse(400,
                "{\"error\":{\"message\":\"Unable to generate this content.\",\"type\":\"invalid_request_error\",\"param\":\"prompt\",\"code\":\"content_policy_violation\"}}",
                "submission");

        Assertions.assertEquals("prompt_policy_violation", error.category());
        Assertions.assertEquals("content_policy_violation", error.code());
        Assertions.assertEquals("prompt", error.parameter());
        Assertions.assertFalse(error.requestAccepted());
        Assertions.assertTrue(error.safeToRetry());
    }

    /**
     * 供应商明确指出参数时必须分类为参数错误。
     */
    @Test
    void shouldClassifyExplicitInvalidParameter() {
        AiErrorDetails error = AiErrorSupport.classifyProviderResponse(422,
                "{\"error\":{\"message\":\"quality is invalid\",\"param\":\"quality\",\"code\":\"invalid_parameter\"}}",
                "submission");

        Assertions.assertEquals("invalid_parameter", error.category());
        Assertions.assertEquals("quality", error.parameter());
        Assertions.assertTrue(error.safeToRetry());
    }

    /**
     * 提交阶段限流和服务异常允许原样重试，轮询阶段相同错误不得创建新任务。
     */
    @Test
    void shouldOnlyAllowUnchangedRetryBeforeRequestAccepted() {
        AiErrorDetails submission = AiErrorSupport.classifyProviderResponse(503,
                "{\"error\":{\"message\":\"temporarily unavailable\",\"requestAccepted\":false}}", "submission");
        AiErrorDetails unconfirmedSubmission = AiErrorSupport.classifyProviderResponse(503,
                "{\"error\":{\"message\":\"temporarily unavailable\"}}", "submission");
        AiErrorDetails polling = AiErrorSupport.classifyProviderResponse(503,
                "{\"error\":{\"message\":\"temporarily unavailable\"}}", "polling");

        Assertions.assertEquals("provider_unavailable", submission.category());
        Assertions.assertFalse(submission.requestAccepted());
        Assertions.assertTrue(submission.safeToRetry());
        Assertions.assertNull(unconfirmedSubmission.requestAccepted());
        Assertions.assertFalse(unconfirmedSubmission.safeToRetry());
        Assertions.assertTrue(polling.requestAccepted());
        Assertions.assertFalse(polling.safeToRetry());
    }

    /**
     * 无法确认的错误保持unknown，并过滤消息中的密钥和鉴权令牌。
     */
    @Test
    void shouldKeepUnknownAndFilterSensitiveValues() {
        AiErrorDetails error = AiErrorSupport.classifyProviderResponse(418,
                "{\"error\":{\"message\":\"\\\"api_key\\\":\\\"plain-secret-value\\\" authorization: Bearer secret-token api_key=sk-1234567890 password=visible\"}}",
                "submission");

        Assertions.assertEquals("unknown", error.category());
        Assertions.assertFalse(error.safeToRetry());
        Assertions.assertFalse(error.message().contains("secret-token"));
        Assertions.assertFalse(error.message().contains("sk-1234567890"));
        Assertions.assertFalse(error.message().contains("plain-secret-value"));
        Assertions.assertFalse(error.message().contains("visible"));
    }

    /**
     * 非供应商超时必须归类为不可自动恢复的timeout。
     */
    @Test
    void shouldClassifyTimeoutThrowable() {
        AiErrorDetails error = AiErrorSupport.fromThrowable(new HttpTimeoutException("读取超时"),
                "task", "polling");

        Assertions.assertEquals("timeout", error.category());
        Assertions.assertTrue(error.requestAccepted());
        Assertions.assertFalse(error.safeToRetry());
    }

    /**
     * HTTP成功后的供应商任务失败必须标记为已受理的轮询阶段错误。
     */
    @Test
    void shouldClassifyAcceptedProviderTaskFailure() {
        AiProviderException exception = AiErrorSupport.providerTaskFailure(
                com.alibaba.fastjson2.JSONObject.parseObject(
                        "{\"status\":\"failed\",\"error\":{\"code\":\"content_policy_violation\",\"message\":\"Unable to generate this content\"}}"),
                "视频生成失败");

        Assertions.assertEquals("prompt_policy_violation", exception.getDetails().category());
        Assertions.assertEquals("polling", exception.getDetails().stage());
        Assertions.assertNull(exception.getDetails().httpStatus());
        Assertions.assertTrue(exception.getDetails().requestAccepted());
        Assertions.assertFalse(exception.getDetails().safeToRetry());
    }

    /**
     * 供应商任务轮询耗尽必须进入不可重试的timeout类别。
     */
    @Test
    void shouldClassifyProviderPollingTimeout() {
        AiErrorDetails error = AiErrorSupport.providerPollingTimeout("视频生成超时").getDetails();

        Assertions.assertEquals("timeout", error.category());
        Assertions.assertEquals("polling", error.stage());
        Assertions.assertTrue(error.requestAccepted());
        Assertions.assertFalse(error.safeToRetry());
    }

    /**
     * 前端回传的未知结构字段不得伪造成可恢复的供应商错误。
     */
    @Test
    void shouldNormalizeUntrustedErrorData() {
        AiErrorDetails error = AiErrorSupport.fromData(Map.of(
                "source", "custom-source",
                "category", "custom-category",
                "stage", "custom-stage",
                "message", "自定义错误",
                "requestAccepted", false,
                "safeToRetry", true));

        Assertions.assertNotNull(error);
        Assertions.assertEquals("unknown", error.source());
        Assertions.assertEquals("unknown", error.category());
        Assertions.assertEquals("unknown", error.stage());
        Assertions.assertFalse(error.safeToRetry());
    }

    /**
     * 非法布尔和状态码字段不得中断供应商错误解析或伪造可重试条件。
     */
    @Test
    void shouldIgnoreInvalidRetryMetadata() {
        AiErrorDetails providerError = AiErrorSupport.classifyProviderResponse(503,
                "{\"error\":{\"message\":\"temporarily unavailable\",\"requestAccepted\":\"no\"}}",
                "submission");
        AiErrorDetails frontendError = AiErrorSupport.fromData(Map.of(
                "source", "provider",
                "category", "provider_unavailable",
                "stage", "submission",
                "httpStatus", 503.5,
                "message", "temporarily unavailable",
                "requestAccepted", "false",
                "safeToRetry", "true"));

        Assertions.assertNull(providerError.requestAccepted());
        Assertions.assertFalse(providerError.safeToRetry());
        Assertions.assertNotNull(frontendError);
        Assertions.assertNull(frontendError.httpStatus());
        Assertions.assertNull(frontendError.requestAccepted());
        Assertions.assertFalse(frontendError.safeToRetry());
    }

    /**
     * 供应商结构字段必须限制长度并过滤其中的渠道密钥。
     */
    @Test
    void shouldFilterSensitiveStructuralFields() {
        String longCode = "sk-1234567890" + "x".repeat(300);
        AiErrorDetails error = AiErrorSupport.classifyProviderResponse(400,
                "{\"error\":{\"message\":\"请求失败\",\"code\":\"" + longCode + "\"}}",
                "submission");

        Assertions.assertNotNull(error.code());
        Assertions.assertFalse(error.code().contains("sk-1234567890"));
        Assertions.assertTrue(error.code().length() <= 200);
    }

    /**
     * 本地明确的渠道配置和积分不足错误必须进入对应类型，不能退化为unknown。
     */
    @Test
    void shouldClassifyKnownLocalBusinessErrors() {
        AiErrorDetails configuration = AiErrorSupport.fromThrowable(
                new BusinessException(ErrorCode.BUSINESS_ERROR, "所选模型不可用，请联系管理员检查模型配置"),
                "task", "execution");
        AiErrorDetails quota = AiErrorSupport.fromThrowable(
                new BusinessException(ErrorCode.BUSINESS_ERROR, "积分不足，无法创建生成任务"),
                "task", "execution");

        Assertions.assertEquals("configuration", configuration.category());
        Assertions.assertEquals("quota", quota.category());
        Assertions.assertFalse(configuration.safeToRetry());
        Assertions.assertFalse(quota.safeToRetry());
    }
}

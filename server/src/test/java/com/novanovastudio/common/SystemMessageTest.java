package com.novanovastudio.common;

import java.sql.SQLException;
import java.util.Locale;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.BadSqlGrammarException;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 系统消息异常收敛单元测试。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-11-24 21:18:00
 */
class SystemMessageTest {

    @Test
    void sanitizesBadSqlGrammarException() {
        BadSqlGrammarException exception = new BadSqlGrammarException(
                "executeMany",
                "SELECT id, model_groups FROM platform_ai_channels WHERE status = 1",
                new SQLException("column model_groups does not exist"));

        SystemMessage message = SystemMessage.fromThrowable(exception);
        String rendered = message.render(Locale.SIMPLIFIED_CHINESE);

        assertFalse(rendered.contains("SELECT"));
        assertFalse(rendered.contains("platform_ai_channels"));
        assertTrue(rendered.contains("系统服务异常"));
    }

    @Test
    void sanitizesLegacyStoredSqlErrorWhenRendering() {
        String rawSqlError = "executeMany; bad SQL grammar [SELECT id, team_id FROM platform_ai_channels WHERE status = 1]";
        SystemMessage stored = SystemMessage.of("system.executionFailed", rawSqlError);

        String zh = stored.render(Locale.SIMPLIFIED_CHINESE);
        String en = stored.render(Locale.ENGLISH);

        assertFalse(zh.contains("SELECT"));
        assertTrue(zh.contains("系统服务异常"));
        assertFalse(en.contains("SELECT"));
        assertTrue(en.contains("Internal service error"));
    }

    @Test
    void preservesNormalProviderDiagnosticMessage() {
        RuntimeException exception = new RuntimeException("模型超时，请重试");
        SystemMessage message = SystemMessage.fromThrowable(exception);

        assertEquals("执行失败：模型超时，请重试", message.render(Locale.SIMPLIFIED_CHINESE));
    }

    @Test
    void translatesUpstreamTechnicalErrorsIntoFriendlyMessages() {
        RuntimeException download404 = new RuntimeException("Error while downloading file. Upstream status code: 404.");
        assertTrue(SystemMessage.fromThrowable(download404).render(Locale.SIMPLIFIED_CHINESE).contains("参考图片或素材链接已失效"));

        assertEquals("模型请求过于频繁，请稍后重试", SystemMessage.sanitizeUserMessage("Rate limit reached for model"));
        assertEquals("模型响应超时，请稍后重试", SystemMessage.sanitizeUserMessage("Read timed out"));
        assertEquals("提示词或参考素材未通过内容安全审核，请调整后再试", SystemMessage.sanitizeUserMessage("content_policy_violation"));
        assertEquals("模型服务暂时繁忙，请稍后重试", SystemMessage.sanitizeUserMessage("503 Service Unavailable"));
    }
}

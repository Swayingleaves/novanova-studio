package com.novanovastudio.common;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.alibaba.fastjson2.JSON;
import com.novanovastudio.agent.dto.AgentEvent;
import com.novanovastudio.agent.dto.AgentAction;
import com.novanovastudio.agent.dto.AgentChoice;
import java.text.MessageFormat;
import java.util.HashMap;
import java.util.Locale;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.Properties;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * 双语消息完整性、持久化恢复和流式事件测试。
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-10-16 00:00
 */
class SystemMessageTest {

    /**
     * 验证两种资源的键、参数和格式一致。
     * @throws Exception 资源读取失败时抛出
     */
    @Test
    void shouldHaveCompleteBilingualResources() throws Exception {
        Properties chinese = resources("zh_CN");
        Properties english = resources("en");
        assertEquals(chinese.stringPropertyNames(), english.stringPropertyNames());
        for (String key : chinese.stringPropertyNames()) {
            MessageFormat chineseFormat = new MessageFormat(chinese.getProperty(key), Locale.SIMPLIFIED_CHINESE);
            MessageFormat englishFormat = new MessageFormat(english.getProperty(key), Locale.ENGLISH);
            assertEquals(chineseFormat.getFormatsByArgumentIndex().length, englishFormat.getFormatsByArgumentIndex().length, key);
        }
    }

    /**
     * 直接读取指定资源，避免父资源掩盖缺失词条。
     * @param language String 资源语言后缀
     * @return Properties 消息资源
     * @throws Exception 资源无法读取时抛出
     */
    private Properties resources(String language) throws Exception {
        Properties properties = new Properties();
        try (var input = getClass().getResourceAsStream("/messages/system_" + language + ".properties")) {
            java.util.Objects.requireNonNull(input);
            properties.load(new InputStreamReader(input, StandardCharsets.UTF_8));
        }
        return properties;
    }

    /** 验证异常日志保留中文，而响应可以独立选择英文。 */
    @Test
    void shouldSeparateDiagnosticAndDisplayLanguage() {
        BusinessException exception = new BusinessException(ErrorCode.AUTH_ERROR, SystemMessage.of("business.incorrectEmailOrPassword"));
        assertEquals("邮箱或密码错误", exception.getMessage());
        assertEquals("Incorrect email or password", exception.getSystemMessage().render(Locale.ENGLISH));
    }

    /** 验证任务消息刷新恢复后仍能用另一种语言展示，用户参数保持原文。 */
    @Test
    void shouldRestoreNestedMessagesAfterPersistence() {
        SystemMessage original = SystemMessage.of("system.taskRecoveredFailed", SystemMessage.of("business.taskNotFound"));
        var fields = new HashMap<String, Object>();
        SystemMessage.putTaskFields(fields, original);
        SystemMessage restored = SystemMessage.stored((String) fields.get("error_message_key"), (String) fields.get("error_message_arguments"));
        assertEquals("Task recovery failed: Task not found", restored.render(Locale.ENGLISH));
        assertEquals("任务恢复失败：任务不存在", restored.render(Locale.SIMPLIFIED_CHINESE));
        assertEquals("Execution failed: 用户的原始内容", SystemMessage.of("system.executionFailed", "用户的原始内容").render(Locale.ENGLISH));
    }

    /** 验证同一中立事件可以向不同语言订阅输出，生成内容不被翻译。 */
    @Test
    void shouldLocalizeEventsPerSubscriber() {
        AgentEvent event = AgentEvent.error("session", "任务不存在").withSystemMessage(SystemMessage.of("business.taskNotFound"));
        assertEquals("Task not found", event.withLocale(Locale.ENGLISH).errorMessage());
        assertEquals("任务不存在", event.withLocale(Locale.SIMPLIFIED_CHINESE).errorMessage());
        assertEquals("Task canceled", AgentEvent.canceled("session", "已停止生成").withLocale(Locale.ENGLISH).text());
        AgentEvent generated = AgentEvent.taskComplete("session", "message", "用户要求的中文生成结果");
        assertEquals(generated, generated.withLocale(Locale.ENGLISH));
        assertFalse(JSON.toJSONString(event).isBlank());
        assertTrue(JSON.toJSONString(event).contains("systemMessage"));
        AgentEvent confirmation = AgentEvent.taskComplete("session", "message", "首尾帧已生成")
                .withSystemMessage(SystemMessage.of("system.imageStageConfirmation"));
        assertTrue(confirmation.withLocale(Locale.ENGLISH).text().startsWith("The first and last frame images are ready."));
        assertEquals("Prompt ready", AgentEvent.promptPrepared("session", "plan", "task", "KEEP").withLocale(Locale.ENGLISH).text());
    }

    /** 验证固定按钮翻译后业务值不变，模型选项及上传动作保留原文。 */
    @Test
    void shouldSeparateActionLabelsFromBusinessValues() {
        AgentChoice generated = new AgentChoice("用户的中文候选", "用户的中文候选", false, null);
        AgentChoice upload = new AgentChoice("上传参考图", null, false, "upload_image");
        AgentAction original = AgentAction.choice(List.of(new AgentChoice("确认生成", "确认生成", false, null), generated, upload));
        AgentAction english = original.withLocale(Locale.ENGLISH);
        assertEquals("Confirm generation", english.options().getFirst().label());
        assertEquals("确认生成", english.options().getFirst().value());
        assertEquals(generated, english.options().get(1));
        assertEquals(upload, english.options().get(2));
        assertEquals("确认生成", original.options().getFirst().label());
    }

    /** 验证计划汇总恢复后按请求语言显示，第三方诊断保持原文。 */
    @Test
    void shouldRestorePlanSummaryLanguage() {
        SystemMessage summary = SystemMessage.of("system.generationPlanSummary", 1, 2,
                SystemMessage.of("system.messagePair", SystemMessage.of("system.taskCanceled"), "供应商原始诊断"));
        SystemMessage restored = SystemMessage.stored(summary.key(), JSON.toJSONString(summary.arguments()));
        assertEquals("Generation plan completed: 1 succeeded, 2 did not succeed. Task canceled; 供应商原始诊断", restored.render(Locale.ENGLISH));
    }
}

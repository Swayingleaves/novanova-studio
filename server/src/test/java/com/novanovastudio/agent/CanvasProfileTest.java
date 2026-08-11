package com.novanovastudio.agent;

import com.novanovastudio.agent.dto.AgentChatRequest;
import com.novanovastudio.agent.dto.AgentMessage;
import com.novanovastudio.agent.dto.AgentSession;
import com.novanovastudio.agent.dto.AiMessage;
import com.novanovastudio.agent.dto.CreationSettings;
import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.service.PromptTemplateType;
import com.novanovastudio.service.SystemPromptTemplateService;
import java.nio.file.Path;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

/**
 * 画布Agent Profile测试。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-15 00:05
 */
class CanvasProfileTest {

    /**
     * 验证多轮补参优先使用前端自然语言历史。
     */
    @Test
    void shouldUseFrontendHistoryForMultiTurnGenerationParameters() {
        CanvasProfile profile = new CanvasProfile(new AgentToolRegistry(), promptTemplateService());
        AgentSession session = new AgentSession(
                "session-1",
                1L,
                "测试会话",
                "canvas",
                new ArrayList<>(List.of(new AgentMessage("stale", "assistant", "一只熊猫抱着竹子", null))),
                OffsetDateTime.now(),
                OffsetDateTime.now());
        AgentChatRequest request = new AgentChatRequest(
                "session-1",
                "canvas",
                "9:16，可爱卡通风",
                Map.of(),
                List.of(),
                List.of(),
                List.of(
                        new AgentChatRequest.HistoryMessage("user", "生成图片"),
                        new AgentChatRequest.HistoryMessage("assistant", "请描述画面主体"),
                        new AgentChatRequest.HistoryMessage("user", "一只小猫在吃一只巨大的鱼"),
                        new AgentChatRequest.HistoryMessage("assistant", "请补充图片尺寸")),
                new CreationSettings("model-1", null, null, null, null, null, null));

        List<AiMessage> messages = profile.buildMessages(1L, session, request).block();

        Assertions.assertNotNull(messages);
        Assertions.assertTrue(messages.stream().anyMatch(message -> message.content().contains("一只小猫在吃一只巨大的鱼")));
        Assertions.assertTrue(messages.stream().anyMatch(message -> message.content().contains("9:16，可爱卡通风")));
        Assertions.assertFalse(messages.stream().anyMatch(message -> message.content().contains("一只熊猫抱着竹子")));
    }

    /**
     * 验证前端未携带历史时使用服务端会话消息。
     */
    @Test
    void shouldUseServerSessionWhenFrontendHistoryIsEmpty() {
        CanvasProfile profile = new CanvasProfile(new AgentToolRegistry(), promptTemplateService());
        AgentSession session = new AgentSession(
                "session-1",
                1L,
                "测试会话",
                "canvas",
                new ArrayList<>(List.of(new AgentMessage("user-1", "user", "一只小猫在吃一只巨大的鱼", null))),
                OffsetDateTime.now(),
                OffsetDateTime.now());
        AgentChatRequest request = new AgentChatRequest(
                "session-1", "canvas", "9:16", Map.of(), List.of(), List.of(), List.of(),
                new CreationSettings("model-1", null, null, null, null, null, null));

        List<AiMessage> messages = profile.buildMessages(1L, session, request).block();

        Assertions.assertNotNull(messages);
        Assertions.assertTrue(messages.stream().anyMatch(message -> message.content().contains("一只小猫在吃一只巨大的鱼")));
    }

    /**
     * 验证画布Agent首条消息使用外部画布模板。
     */
    @Test
    void shouldUseCanvasTemplateAsFirstSystemMessage() {
        SystemPromptTemplateService templateService = promptTemplateService();
        CanvasProfile profile = new CanvasProfile(new AgentToolRegistry(), templateService);
        AgentSession session = new AgentSession(
                "session-1", 1L, "测试会话", "canvas", List.of(), OffsetDateTime.now(), OffsetDateTime.now());
        AgentChatRequest request = new AgentChatRequest(
                "session-1", "canvas", "生成图片", Map.of(), List.of(), List.of(), List.of(),
                new CreationSettings("model-1", null, null, null, null, null, null));

        List<AiMessage> messages = profile.buildMessages(1L, session, request).block();

        Assertions.assertNotNull(messages);
        Assertions.assertEquals("system", messages.getFirst().role());
        Assertions.assertEquals(templateService.get(PromptTemplateType.AGENT_CANVAS), messages.getFirst().content());
    }

    /**
     * 加载测试使用的外部系统提示词模板。
     *
     * @return SystemPromptTemplateService 已加载的模板服务
     */
    private SystemPromptTemplateService promptTemplateService() {
        NovanovaProperties properties = new NovanovaProperties();
        Path promptDirectory = Path.of("config", "prompts").toAbsolutePath();
        properties.getAi().getSystemPrompt().setOptimizationImageFile(promptDirectory.resolve("optimization-image.md").toUri().toString());
        properties.getAi().getSystemPrompt().setOptimizationVideoFile(promptDirectory.resolve("optimization-video.md").toUri().toString());
        properties.getAi().getSystemPrompt().setAgentMainFile(promptDirectory.resolve("agent-main.md").toUri().toString());
        properties.getAi().getSystemPrompt().setAgentRecoveryFile(promptDirectory.resolve("agent-recovery.md").toUri().toString());
        properties.getAi().getSystemPrompt().setAgentImageFile(promptDirectory.resolve("agent-image.md").toUri().toString());
        properties.getAi().getSystemPrompt().setAgentVideoFile(promptDirectory.resolve("agent-video.md").toUri().toString());
        properties.getAi().getSystemPrompt().setAgentCanvasFile(promptDirectory.resolve("agent-canvas.md").toUri().toString());
        properties.getAi().getSystemPrompt().setAgentStoryboardFile(promptDirectory.resolve("agent-storyboard.md").toUri().toString());
        SystemPromptTemplateService service = new SystemPromptTemplateService(properties, new org.springframework.core.io.DefaultResourceLoader());
        service.loadTemplates();
        return service;
    }
}

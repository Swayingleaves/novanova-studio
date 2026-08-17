package com.novanovastudio.agent;

import com.novanovastudio.agent.dto.AgentChatRequest;
import com.novanovastudio.agent.dto.AgentSession;
import com.novanovastudio.agent.dto.AiMessage;
import com.novanovastudio.agent.dto.CreationSettings;
import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.service.PromptTemplateType;
import com.novanovastudio.service.SystemPromptTemplateService;
import java.nio.file.Path;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.DefaultResourceLoader;

/**
 * 图片与视频生成Agent系统提示词测试。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-17 00:00
 */
class GenerationProfileSystemPromptTest {

    /**
     * 验证图片与视频Agent均以对应外部模板作为首条系统消息。
     */
    @Test
    void shouldBuildFirstSystemMessageFromCorrespondingTemplate() {
        NovanovaProperties properties = new NovanovaProperties();
        SystemPromptTemplateService templateService = promptTemplateService(properties);
        AgentSession session = new AgentSession(
                "session-1", 1L, "测试会话", "generation", List.of(), OffsetDateTime.now(), OffsetDateTime.now());
        AgentChatRequest request = new AgentChatRequest(
                "session-1", "imagePage", "生成内容", Map.of(), List.of(), List.of(), List.of(),
                new CreationSettings("model-1", "1:1", "2K", "high", 1, null, null));

        List<AiMessage> imageMessages = new ImageProfile(null, null, templateService, new AgentExecutionRegistry(), properties).buildMessages(1L, session, request).block();
        List<AiMessage> videoMessages = new VideoProfile(null, null, templateService, new AgentExecutionRegistry(), properties).buildMessages(1L, session, request).block();

        Assertions.assertNotNull(imageMessages);
        Assertions.assertNotNull(videoMessages);
        Assertions.assertEquals("system", imageMessages.getFirst().role());
        Assertions.assertEquals(templateService.get(PromptTemplateType.AGENT_IMAGE), imageMessages.getFirst().content());
        Assertions.assertEquals("system", videoMessages.getFirst().role());
        Assertions.assertEquals(templateService.get(PromptTemplateType.AGENT_VIDEO), videoMessages.getFirst().content());
        Assertions.assertTrue(imageMessages.getFirst().content().contains("选择 KEEP"));
        Assertions.assertTrue(imageMessages.getFirst().content().contains("选择 OPTIMIZE"));
        Assertions.assertTrue(videoMessages.getFirst().content().contains("选择 KEEP"));
        Assertions.assertTrue(videoMessages.getFirst().content().contains("选择 OPTIMIZE"));
    }

    /**
     * 加载测试使用的外部系统提示词模板。
     *
     * @return SystemPromptTemplateService 已加载的模板服务
     */
    private SystemPromptTemplateService promptTemplateService(NovanovaProperties properties) {
        Path promptDirectory = Path.of("config", "prompts").toAbsolutePath();
        properties.getAi().getSystemPrompt().setOptimizationImageFile(promptDirectory.resolve("optimization-image.md").toUri().toString());
        properties.getAi().getSystemPrompt().setOptimizationVideoFile(promptDirectory.resolve("optimization-video.md").toUri().toString());
        properties.getAi().getSystemPrompt().setAgentMainFile(promptDirectory.resolve("agent-main.md").toUri().toString());
        properties.getAi().getSystemPrompt().setAgentRecoveryFile(promptDirectory.resolve("agent-recovery.md").toUri().toString());
        properties.getAi().getSystemPrompt().setAgentImageFile(promptDirectory.resolve("agent-image.md").toUri().toString());
        properties.getAi().getSystemPrompt().setAgentVideoFile(promptDirectory.resolve("agent-video.md").toUri().toString());
        properties.getAi().getSystemPrompt().setAgentCanvasFile(promptDirectory.resolve("agent-canvas.md").toUri().toString());
        properties.getAi().getSystemPrompt().setAgentStoryboardFile(promptDirectory.resolve("agent-storyboard.md").toUri().toString());
        SystemPromptTemplateService service = new SystemPromptTemplateService(properties, new DefaultResourceLoader());
        service.loadTemplates();
        return service;
    }
}

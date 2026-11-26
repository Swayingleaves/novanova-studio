package com.novanovastudio.agent;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.novanovastudio.dto.WholeBookAdaptationDtos;
import com.novanovastudio.service.PromptTemplateType;
import com.novanovastudio.service.SystemPromptTemplateService;
import io.agentscope.core.ReActAgent;
import io.agentscope.core.agent.RuntimeContext;
import io.agentscope.core.message.Msg;
import io.agentscope.core.message.ToolUseBlock;
import io.agentscope.core.middleware.MiddlewareBase;
import io.agentscope.core.model.ChatResponse;
import io.agentscope.core.model.Model;
import io.agentscope.core.model.ToolSchema;
import java.lang.reflect.Field;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;
import reactor.core.publisher.Flux;

/**
 * 固定Agent工厂的Prompt隔离和工具权限测试。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-23 00:00
 */
class AgentScopeAgentFactoryTest {

    /**
     * 不同Agent必须加载各自Prompt且不能从Prompt获得业务工具。
     *
     * @throws ReflectiveOperationException 无法读取AgentScope中间件字段时抛出
     */
    @Test
    void shouldIsolatePromptsAndKeepBusinessToolkitEmpty() throws ReflectiveOperationException {
        SystemPromptTemplateService promptService = mock(SystemPromptTemplateService.class);
        when(promptService.get(PromptTemplateType.AGENT_MAIN)).thenReturn("主Agent模板");
        when(promptService.get(PromptTemplateType.AGENT_USER_ACTIONS)).thenReturn("用户动作标识");
        when(promptService.get(PromptTemplateType.AGENT_RECOVERY)).thenReturn("恢复Agent模板");
        when(promptService.get(PromptTemplateType.AGENT_IMAGE)).thenReturn("图片Agent模板");
        when(promptService.get(PromptTemplateType.AGENT_VIDEO)).thenReturn("视频Agent模板");
        AgentThinkingEventMiddleware thinkingEventMiddleware = mock(AgentThinkingEventMiddleware.class);
        DramaReplyStreamMiddleware dramaReplyStreamMiddleware = mock(DramaReplyStreamMiddleware.class);
        CreationReplyStreamMiddleware creationReplyStreamMiddleware = mock(CreationReplyStreamMiddleware.class);
        AgentScopeAgentFactory factory = new AgentScopeAgentFactory(promptService, thinkingEventMiddleware, dramaReplyStreamMiddleware, creationReplyStreamMiddleware);
        Model model = mock(Model.class);
        when(model.getModelName()).thenReturn("test-model");

        try (ReActAgent mainAgent = factory.mainAgent(model);
             ReActAgent recoveryAgent = factory.recoveryAgent(model);
             ReActAgent imageAgent = factory.imageAgent(model);
             ReActAgent videoAgent = factory.videoAgent(model)) {
            Assertions.assertTrue(mainAgent.getSysPrompt().contains("主Agent模板"));
            Assertions.assertTrue(mainAgent.getSysPrompt().contains("用户动作标识"));
            Assertions.assertTrue(recoveryAgent.getSysPrompt().contains("恢复Agent模板"));
            Assertions.assertTrue(imageAgent.getSysPrompt().contains("图片Agent模板"));
            Assertions.assertTrue(videoAgent.getSysPrompt().contains("视频Agent模板"));
            Assertions.assertTrue(mainAgent.getToolkit().getToolNames().isEmpty());
            Assertions.assertTrue(recoveryAgent.getToolkit().getToolNames().isEmpty());
            Assertions.assertTrue(imageAgent.getToolkit().getToolNames().isEmpty());
            Assertions.assertTrue(videoAgent.getToolkit().getToolNames().isEmpty());
            Assertions.assertTrue(middlewares(mainAgent).contains(thinkingEventMiddleware));
            Assertions.assertTrue(middlewares(recoveryAgent).contains(thinkingEventMiddleware));
            Assertions.assertFalse(middlewares(imageAgent).contains(thinkingEventMiddleware));
            Assertions.assertFalse(middlewares(videoAgent).contains(thinkingEventMiddleware));
        }
    }

    /** 兼容模型通过 AgentScope 内置工具提交素材，剧本 Agent 无业务工具。 */
    @Test
    void shouldAcceptMaterialThroughBuiltInStructuredOutputTool() {
        SystemPromptTemplateService promptService = mock(SystemPromptTemplateService.class);
        when(promptService.get(PromptTemplateType.AGENT_SCRIPT)).thenReturn("剧本Agent模板");
        AgentScopeAgentFactory factory = new AgentScopeAgentFactory(promptService, null, null, null);
        Model model = mock(Model.class);
        when(model.getModelName()).thenReturn("兼容文本模型");
        when(model.getContextWindowSize()).thenReturn(128_000);
        when(model.stream(anyList(), anyList(), any())).thenAnswer(invocation -> {
            List<ToolSchema> tools = invocation.getArgument(1);
            Assertions.assertEquals(List.of("generate_response"), tools.stream().map(ToolSchema::getName).toList());
            return Flux.just(ChatResponse.builder()
                    .content(List.of(ToolUseBlock.builder().id("material-result").name("generate_response")
                            .input(Map.of("response", Map.of("summary", "本批素材摘要")))
                            .content("{\"response\":{\"summary\":\"本批素材摘要\"}}").build()))
                    .finishReason("tool_calls")
                    .build());
        });

        try (ReActAgent agent = factory.scriptAgent(model)) {
            Assertions.assertTrue(agent.getSysPrompt().contains("必须通过该工具提交剧本结构化结果"));
            Assertions.assertTrue(agent.getToolkit().getToolNames().isEmpty());
            Msg message = agent.call("提炼素材", WholeBookAdaptationDtos.Material.class,
                    RuntimeContext.builder().sessionId("material-test").userId("test").build()).block(Duration.ofSeconds(5));
            Assertions.assertNotNull(message);
            Assertions.assertEquals("本批素材摘要", message.getStructuredData(WholeBookAdaptationDtos.Material.class).summary());
        }
    }

    /**
     * 读取AgentScope Agent已注册的中间件。
     *
     * @param agent ReActAgent 待读取Agent
     * @return List&lt;MiddlewareBase&gt; 已注册中间件
     * @throws ReflectiveOperationException 反射字段不存在或不可访问时抛出
     */
    @SuppressWarnings("unchecked")
    private List<MiddlewareBase> middlewares(ReActAgent agent) throws ReflectiveOperationException {
        Field field = ReActAgent.class.getDeclaredField("middlewares");
        field.setAccessible(true);
        return (List<MiddlewareBase>) field.get(agent);
    }
}

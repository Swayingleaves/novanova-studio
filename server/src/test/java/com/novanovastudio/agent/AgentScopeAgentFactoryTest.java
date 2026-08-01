package com.novanovastudio.agent;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.novanovastudio.service.PromptTemplateType;
import com.novanovastudio.service.SystemPromptTemplateService;
import io.agentscope.core.ReActAgent;
import io.agentscope.core.middleware.MiddlewareBase;
import io.agentscope.core.model.Model;
import java.lang.reflect.Field;
import java.util.List;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

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
        when(promptService.get(PromptTemplateType.AGENT_RECOVERY)).thenReturn("恢复Agent模板");
        when(promptService.get(PromptTemplateType.AGENT_IMAGE)).thenReturn("图片Agent模板");
        when(promptService.get(PromptTemplateType.AGENT_VIDEO)).thenReturn("视频Agent模板");
        AgentThinkingEventMiddleware thinkingEventMiddleware = mock(AgentThinkingEventMiddleware.class);
        AgentScopeAgentFactory factory = new AgentScopeAgentFactory(promptService, thinkingEventMiddleware);
        Model model = mock(Model.class);
        when(model.getModelName()).thenReturn("test-model");

        try (ReActAgent mainAgent = factory.mainAgent(model);
             ReActAgent recoveryAgent = factory.recoveryAgent(model);
             ReActAgent imageAgent = factory.imageAgent(model);
             ReActAgent videoAgent = factory.videoAgent(model)) {
            Assertions.assertTrue(mainAgent.getSysPrompt().contains("主Agent模板"));
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

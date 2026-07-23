package com.novanovastudio.agent;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.novanovastudio.service.PromptTemplateType;
import com.novanovastudio.service.SystemPromptTemplateService;
import io.agentscope.core.ReActAgent;
import io.agentscope.core.model.Model;
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
     */
    @Test
    void shouldIsolatePromptsAndKeepBusinessToolkitEmpty() {
        SystemPromptTemplateService promptService = mock(SystemPromptTemplateService.class);
        when(promptService.get(PromptTemplateType.AGENT_MAIN)).thenReturn("主Agent模板");
        when(promptService.get(PromptTemplateType.AGENT_IMAGE)).thenReturn("图片Agent模板");
        when(promptService.get(PromptTemplateType.AGENT_VIDEO)).thenReturn("视频Agent模板");
        AgentScopeAgentFactory factory = new AgentScopeAgentFactory(promptService);
        Model model = mock(Model.class);
        when(model.getModelName()).thenReturn("test-model");

        try (ReActAgent mainAgent = factory.mainAgent(model);
             ReActAgent imageAgent = factory.imageAgent(model);
             ReActAgent videoAgent = factory.videoAgent(model)) {
            Assertions.assertTrue(mainAgent.getSysPrompt().contains("主Agent模板"));
            Assertions.assertTrue(imageAgent.getSysPrompt().contains("图片Agent模板"));
            Assertions.assertTrue(videoAgent.getSysPrompt().contains("视频Agent模板"));
            Assertions.assertTrue(mainAgent.getToolkit().getToolNames().isEmpty());
            Assertions.assertTrue(imageAgent.getToolkit().getToolNames().isEmpty());
            Assertions.assertTrue(videoAgent.getToolkit().getToolNames().isEmpty());
        }
    }
}

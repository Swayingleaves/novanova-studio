package com.novanovastudio.agent;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.novanovastudio.ai.AiProviderAdapterRegistry;
import com.novanovastudio.ai.AiTaskTypes;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.dto.AiTaskDtos;
import com.novanovastudio.dto.PersistenceDtos;
import com.novanovastudio.service.PersistenceService;
import io.agentscope.core.model.AnthropicChatModel;
import io.agentscope.core.model.GeminiChatModel;
import io.agentscope.core.model.GenerateOptions;
import io.agentscope.core.model.Model;
import io.agentscope.core.model.OpenAIChatModel;
import java.lang.reflect.Field;
import java.util.List;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

/**
 * 平台文本渠道到AgentScope模型的适配测试。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-23 00:00
 */
class AgentScopeModelFactoryTest {

    /**
     * OpenAI、Gemini和Anthropic渠道必须映射到各自的AgentScope模型。
     */
    @Test
    void shouldCreateSupportedAgentScopeModels() {
        AiProviderAdapterRegistry adapterRegistry = mock(AiProviderAdapterRegistry.class);
        when(adapterRegistry.normalizeApiFormat("openai")).thenReturn("openai");
        when(adapterRegistry.normalizeApiFormat("gemini")).thenReturn("gemini");
        when(adapterRegistry.normalizeApiFormat("anthropic")).thenReturn("anthropic");
        AgentScopeModelFactory factory = new AgentScopeModelFactory(null, adapterRegistry);

        Model openAi = factory.createModel(channel("openai", "gpt-test"));
        Model gemini = factory.createModel(channel("gemini", "gemini-test"));
        Model anthropic = factory.createModel(channel("anthropic", "claude-test"));

        Assertions.assertInstanceOf(GeminiChatModel.class, gemini);
        Assertions.assertInstanceOf(AnthropicChatModel.class, anthropic);
        Assertions.assertEquals("gpt-test", openAi.getModelName());
        Assertions.assertEquals("gemini-test", gemini.getModelName());
        Assertions.assertEquals("claude-test", anthropic.getModelName());
        Assertions.assertFalse(openAi.supportsNativeStructuredOutput());
    }

    /**
     * 用户明确选择的文本模型应解析渠道、模型和按次积分价格。
     */
    @Test
    void shouldResolveSelectedTextModelAndCreditCost() {
        PersistenceService persistenceService = mock(PersistenceService.class);
        AiProviderAdapterRegistry adapterRegistry = mock(AiProviderAdapterRegistry.class);
        AiTaskDtos.AiChannelConfig channel = channel("openai", "story-model");
        PersistenceDtos.ModelConfig modelConfig = new PersistenceDtos.ModelConfig(
                "model-config-1", "channel", "story-model", AiTaskTypes.TEXT, List.of(), true, 1, 6, false, "high");
        when(persistenceService.getPlatformAiChannels()).thenReturn(Mono.just(List.of(channel)));
        when(persistenceService.getPlatformModelConfigs()).thenReturn(Mono.just(List.of(modelConfig)));
        when(adapterRegistry.supports(org.mockito.ArgumentMatchers.any(AiTaskDtos.AiChannelConfig.class), org.mockito.ArgumentMatchers.eq(AiTaskTypes.TEXT))).thenReturn(true);
        when(adapterRegistry.normalizeApiFormat("openai")).thenReturn("openai");
        AgentScopeModelFactory factory = new AgentScopeModelFactory(persistenceService, adapterRegistry);

        StepVerifier.create(factory.resolveTextModel("channel::story-model"))
                .assertNext(selection -> {
                    Assertions.assertEquals("channel::story-model", selection.modelValue());
                    Assertions.assertEquals("story-model", selection.modelName());
                    Assertions.assertEquals("测试渠道", selection.provider());
                    Assertions.assertEquals(6, selection.creditCost());
                    Assertions.assertEquals("story-model", selection.agentModel().getModelName());
                })
                .verifyComplete();
    }

    /**
     * 分镜模型必须使用渠道和模型组成的明确编码。
     */
    @Test
    void shouldRejectTextModelWithoutChannelIdentifier() {
        AgentScopeModelFactory factory = new AgentScopeModelFactory(mock(PersistenceService.class), mock(AiProviderAdapterRegistry.class));

        StepVerifier.create(factory.resolveTextModel("story-model"))
                .expectErrorSatisfies(error -> {
                    Assertions.assertInstanceOf(BusinessException.class, error);
                    Assertions.assertEquals("所选文本模型格式不合法", error.getMessage());
                })
                .verify();
    }

    /**
     * AgentScope未支持的渠道格式必须关闭执行链路。
     */
    @Test
    void shouldRejectUnsupportedAgentScopeFormat() {
        AiProviderAdapterRegistry adapterRegistry = mock(AiProviderAdapterRegistry.class);
        when(adapterRegistry.normalizeApiFormat("agnes")).thenReturn("agnes");
        AgentScopeModelFactory factory = new AgentScopeModelFactory(null, adapterRegistry);

        Assertions.assertThrows(IllegalStateException.class,
                () -> factory.createModel(channel("agnes", "text-model")));
    }

    /**
     * OpenAI兼容模型应将思考配置写入AgentScope生成参数。
     */
    @Test
    void shouldConfigureOpenAiThinkingParameters() throws Exception {
        AiProviderAdapterRegistry adapterRegistry = mock(AiProviderAdapterRegistry.class);
        when(adapterRegistry.normalizeApiFormat("openai")).thenReturn("openai");
        AgentScopeModelFactory factory = new AgentScopeModelFactory(null, adapterRegistry);

        GenerateOptions enabled = configuredOptions(factory.createModel(channel("openai", "deepseek-reasoner"), true, "max"));
        GenerateOptions disabled = configuredOptions(factory.createModel(channel("openai", "deepseek-reasoner"), false, "max"));

        Assertions.assertEquals("enabled", ((java.util.Map<?, ?>) enabled.getAdditionalBodyParams().get("thinking")).get("type"));
        Assertions.assertEquals("max", enabled.getReasoningEffort());
        Assertions.assertEquals("/chat/completions", enabled.getEndpointPath());
        Assertions.assertEquals("disabled", ((java.util.Map<?, ?>) disabled.getAdditionalBodyParams().get("thinking")).get("type"));
        Assertions.assertNull(disabled.getReasoningEffort());
    }

    /**
     * 从结构化输出包装器中读取OpenAI模型生成参数。
     *
     * @param model Model AgentScope模型
     * @return GenerateOptions 已配置生成参数
     * @throws ReflectiveOperationException 反射读取失败时抛出
     */
    private GenerateOptions configuredOptions(Model model) throws ReflectiveOperationException {
        Field delegateField = model.getClass().getDeclaredField("delegate");
        delegateField.setAccessible(true);
        OpenAIChatModel delegate = (OpenAIChatModel) delegateField.get(model);
        Field optionsField = OpenAIChatModel.class.getDeclaredField("configuredOptions");
        optionsField.setAccessible(true);
        return (GenerateOptions) optionsField.get(delegate);
    }

    /**
     * 构造测试渠道。
     *
     * @param apiFormat String 渠道格式
     * @param modelName String 模型名称
     * @return AiChannelConfig 渠道配置
     */
    private AiTaskDtos.AiChannelConfig channel(String apiFormat, String modelName) {
        return new AiTaskDtos.AiChannelConfig("channel", "测试渠道", "https://example.com", "test-key",
                apiFormat, List.of(modelName));
    }
}

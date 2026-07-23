package com.novanovastudio.agent;

import com.novanovastudio.ai.AiProviderAdapterRegistry;
import com.novanovastudio.ai.AiTaskTypes;
import com.novanovastudio.dto.AiTaskDtos;
import com.novanovastudio.service.PersistenceService;
import io.agentscope.core.model.AnthropicChatModel;
import io.agentscope.core.message.Msg;
import io.agentscope.core.model.ChatResponse;
import io.agentscope.core.model.GeminiChatModel;
import io.agentscope.core.model.GenerateOptions;
import io.agentscope.core.model.Model;
import io.agentscope.core.model.OpenAIChatModel;
import io.agentscope.core.model.ToolSchema;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * 将平台默认文本模型配置适配为 AgentScope Model。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-23 00:00
 */
@Service
@RequiredArgsConstructor
public class AgentScopeModelFactory {

    /** 平台配置服务 */
    private final PersistenceService persistenceService;
    /** 供应商适配器注册表 */
    private final AiProviderAdapterRegistry adapterRegistry;

    /**
     * 读取平台配置的默认文本模型并创建AgentScope模型。
     *
     * @return Mono<Model> AgentScope模型
     */
    public Mono<Model> defaultTextModel() {
        return Mono.zip(persistenceService.getPlatformAiChannels(), persistenceService.getPlatformModelConfigs())
                .flatMap(tuple -> {
                    List<AiTaskDtos.AiChannelConfig> channels = tuple.getT1();
                    java.util.Optional<AiTaskDtos.AiChannelConfig> selectedChannel = tuple.getT2().stream()
                            .filter(config -> AiTaskTypes.TEXT.equals(config.modelType()) && Boolean.TRUE.equals(config.defaultModel()))
                            .map(config -> channels.stream()
                                    .filter(channel -> config.channelId().equals(channel.id())
                                            && channel.models() != null
                                            && channel.models().contains(config.modelName())
                                            && StringUtils.hasText(channel.baseUrl())
                                            && StringUtils.hasText(channel.apiKey())
                                            && adapterRegistry.supports(channel, AiTaskTypes.TEXT))
                                    .findFirst()
                                    .map(channel -> new AiTaskDtos.AiChannelConfig(channel.id(), channel.name(), channel.baseUrl(), channel.apiKey(), channel.apiFormat(), List.of(config.modelName()))))
                            .flatMap(java.util.Optional::stream)
                            .findFirst();
                    return selectedChannel.<Mono<Model>>map(channel -> Mono.just(createModel(channel)))
                            .orElseGet(() -> Mono.error(new IllegalStateException("未配置可用的默认文本模型")));
                });
    }

    /**
     * 按渠道格式创建AgentScope模型。
     *
     * @param channel AiChannelConfig 文本模型渠道
     * @return Model AgentScope模型
     */
    Model createModel(AiTaskDtos.AiChannelConfig channel) {
        String modelName = channel.models().getFirst();
        return switch (adapterRegistry.normalizeApiFormat(channel.apiFormat())) {
            case "openai" -> new StructuredOutputFallbackModel(OpenAIChatModel.builder()
                    .apiKey(channel.apiKey()).baseUrl(channel.baseUrl()).endpointPath("/chat/completions")
                    .modelName(modelName).stream(true).build());
            case "gemini" -> GeminiChatModel.builder()
                    .apiKey(channel.apiKey()).baseUrl(channel.baseUrl()).modelName(modelName).streamEnabled(true).build();
            case "anthropic" -> AnthropicChatModel.builder()
                    .apiKey(channel.apiKey()).baseUrl(channel.baseUrl()).modelName(modelName).stream(true).build();
            default -> throw new IllegalStateException("AgentScope暂不支持该文本渠道格式: " + channel.apiFormat());
        };
    }

    /**
     * OpenAI兼容模型的结构化输出适配器。
     * <p>
     * 部分兼容渠道不支持response_format JSON Schema参数，统一改用AgentScope的generate_response工具回退路径。
     */
    private static final class StructuredOutputFallbackModel implements Model {

        /** 实际执行请求的模型 */
        private final Model delegate;

        /**
         * 创建结构化输出回退模型。
         *
         * @param delegate Model 实际执行请求的模型
         */
        private StructuredOutputFallbackModel(Model delegate) {
            this.delegate = delegate;
        }

        /**
         * 转发模型流式请求。
         *
         * @param messages List<Msg> 对话消息
         * @param tools List<ToolSchema> 可调用工具
         * @param options GenerateOptions 生成参数
         * @return Flux<ChatResponse> 模型流式响应
         */
        @Override
        public Flux<ChatResponse> stream(List<Msg> messages, List<ToolSchema> tools, GenerateOptions options) {
            return delegate.stream(messages, tools, options);
        }

        /**
         * 获取实际模型名称。
         *
         * @return String 模型名称
         */
        @Override
        public String getModelName() {
            return delegate.getModelName();
        }

        /**
         * 声明不使用原生结构化输出，避免上游收到response_format参数。
         *
         * @return boolean 始终为false
         */
        @Override
        public boolean supportsNativeStructuredOutput() {
            return false;
        }

        /**
         * 获取实际模型的上下文窗口大小。
         *
         * @return int 上下文窗口大小
         */
        @Override
        public int getContextWindowSize() {
            return delegate.getContextWindowSize();
        }
    }
}

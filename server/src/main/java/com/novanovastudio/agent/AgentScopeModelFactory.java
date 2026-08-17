package com.novanovastudio.agent;

import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.ai.AiProviderAdapterRegistry;
import com.novanovastudio.ai.AiTaskTypes;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.dto.AiTaskDtos;
import com.novanovastudio.dto.PersistenceDtos;
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
import java.util.Map;
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
                    java.util.Optional<ResolvedTextModel> selectedModel = tuple.getT2().stream()
                            .filter(config -> AiTaskTypes.TEXT.equals(config.modelType()) && Boolean.TRUE.equals(config.defaultModel()))
                            .map(config -> channels.stream()
                                    .filter(channel -> config.channelId().equals(channel.id())
                                            && channel.models() != null
                                            && channel.models().contains(config.modelName())
                                            && StringUtils.hasText(channel.baseUrl())
                                            && StringUtils.hasText(channel.apiKey())
                                            && adapterRegistry.supports(channel, AiTaskTypes.TEXT))
                                    .findFirst()
                                    .map(channel -> new ResolvedTextModel(
                                            new AiTaskDtos.AiChannelConfig(channel.id(), channel.name(), channel.baseUrl(), channel.apiKey(), channel.apiFormat(), List.of(config.modelName())),
                                            config)))
                            .flatMap(java.util.Optional::stream)
                            .findFirst();
                    return selectedModel.<Mono<Model>>map(model -> Mono.just(createModel(model.channel(),
                                    thinkingEnabled(model.config().thinkingEnabled()), reasoningEffort(model.config().reasoningEffort()),
                                    model.config().customBodyParameters())))
                            .orElseGet(() -> Mono.error(new IllegalStateException("未配置可用的默认文本模型")));
                });
    }

    /**
     * 解析用户明确选择的文本模型，供独立业务Agent调用并读取模型单价。
     *
     * @param selectedModel String 前端传入的channelId::model编码
     * @return Mono<TextModelSelection> 已校验的AgentScope模型与计费配置
     */
    public Mono<TextModelSelection> resolveTextModel(String selectedModel) {
        if (!StringUtils.hasText(selectedModel)) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_MISSING, "分镜脚本必须选择文本模型"));
        }
        String normalizedModel = selectedModel.trim();
        int separatorIndex = normalizedModel.indexOf("::");
        if (separatorIndex <= 0 || separatorIndex >= normalizedModel.length() - 2) {
            return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "所选文本模型格式不合法"));
        }
        String channelId = normalizedModel.substring(0, separatorIndex);
        String modelName = normalizedModel.substring(separatorIndex + 2);
        return Mono.zip(persistenceService.getPlatformAiChannels(), persistenceService.getPlatformModelConfigs())
                .flatMap(tuple -> {
                    PersistenceDtos.ModelConfig modelConfig = tuple.getT2().stream()
                            .filter(config -> AiTaskTypes.TEXT.equals(config.modelType())
                                    && channelId.equals(config.channelId())
                                    && modelName.equals(config.modelName()))
                            .findFirst()
                            .orElse(null);
                    if (modelConfig == null) {
                        return Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "所选文本模型不可用，请联系管理员检查模型配置"));
                    }
                    AiTaskDtos.AiChannelConfig channel = tuple.getT1().stream()
                            .filter(item -> channelId.equals(item.id())
                                    && item.models() != null
                                    && item.models().contains(modelName)
                                    && StringUtils.hasText(item.baseUrl())
                                    && StringUtils.hasText(item.apiKey())
                                    && adapterRegistry.supports(item, AiTaskTypes.TEXT))
                            .findFirst()
                            .orElse(null);
                    if (channel == null) {
                        return Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "所选文本模型渠道不可用，请联系管理员检查渠道配置"));
                    }
                    Integer creditCost = modelConfig.creditCost();
                    if (creditCost == null || creditCost < 0) {
                        return Mono.error(new BusinessException(ErrorCode.SYSTEM_ERROR, "所选文本模型积分配置不合法"));
                    }
                    AiTaskDtos.AiChannelConfig scopedChannel = new AiTaskDtos.AiChannelConfig(
                            channel.id(), channel.name(), channel.baseUrl(), channel.apiKey(), channel.apiFormat(), List.of(modelName));
                    return Mono.just(new TextModelSelection(
                            createModel(scopedChannel, thinkingEnabled(modelConfig.thinkingEnabled()), reasoningEffort(modelConfig.reasoningEffort()),
                                    modelConfig.customBodyParameters()),
                            normalizedModel,
                            modelName,
                            channel.name(),
                            creditCost));
                });
    }

    /**
     * 按渠道格式创建AgentScope模型。
     *
     * @param channel AiChannelConfig 文本模型渠道
     * @return Model AgentScope模型
     */
    Model createModel(AiTaskDtos.AiChannelConfig channel) {
        return createModel(channel, true, "high", new JSONObject());
    }

    /**
     * 按渠道和思考配置创建AgentScope模型。
     *
     * @param channel AiChannelConfig 文本模型渠道
     * @param thinkingEnabled boolean 是否开启思考模式
     * @param reasoningEffort String 思考强度
     * @return Model AgentScope模型
     */
    Model createModel(AiTaskDtos.AiChannelConfig channel, boolean thinkingEnabled, String reasoningEffort) {
        return createModel(channel, thinkingEnabled, reasoningEffort, new JSONObject());
    }

    /**
     * 按渠道、思考配置和自定义请求体参数创建AgentScope模型。
     *
     * @param channel AiChannelConfig 文本模型渠道
     * @param thinkingEnabled boolean 是否开启思考模式
     * @param reasoningEffort String 思考强度
     * @param customBodyParameters JSONObject 自定义JSON请求体参数
     * @return Model AgentScope模型
     */
    Model createModel(AiTaskDtos.AiChannelConfig channel, boolean thinkingEnabled, String reasoningEffort, JSONObject customBodyParameters) {
        String modelName = channel.models().getFirst();
        return switch (adapterRegistry.normalizeApiFormat(channel.apiFormat())) {
            case "openai" -> new StructuredOutputFallbackModel(OpenAIChatModel.builder()
                    .apiKey(channel.apiKey()).baseUrl(channel.baseUrl()).endpointPath("/chat/completions")
                    .modelName(modelName).stream(true).generateOptions(openAiGenerateOptions(thinkingEnabled, reasoningEffort, customBodyParameters)).build());
            case "gemini" -> GeminiChatModel.builder()
                    .apiKey(channel.apiKey()).baseUrl(channel.baseUrl()).modelName(modelName).streamEnabled(true)
                    .defaultOptions(GenerateOptions.builder().additionalBodyParams(customBodyParameters == null ? Map.of() : customBodyParameters).build()).build();
            case "anthropic" -> AnthropicChatModel.builder()
                    .apiKey(channel.apiKey()).baseUrl(channel.baseUrl()).modelName(modelName).stream(true)
                    .defaultOptions(GenerateOptions.builder().additionalBodyParams(customBodyParameters == null ? Map.of() : customBodyParameters).build()).build();
            default -> throw new IllegalStateException("AgentScope暂不支持该文本渠道格式: " + channel.apiFormat());
        };
    }

    /**
     * 构建OpenAI兼容文本调用的思考参数。
     *
     * @param thinkingEnabled boolean 是否开启思考模式
     * @param reasoningEffort String 思考强度
     * @return GenerateOptions AgentScope生成参数
     */
    private GenerateOptions openAiGenerateOptions(boolean thinkingEnabled, String reasoningEffort, JSONObject customBodyParameters) {
        GenerateOptions.Builder builder = GenerateOptions.builder()
                .additionalBodyParam("thinking", Map.of("type", thinkingEnabled ? "enabled" : "disabled"));
        if (thinkingEnabled) {
            builder.reasoningEffort(reasoningEffort(reasoningEffort));
        }
        builder.additionalBodyParams(customBodyParameters == null ? Map.of() : customBodyParameters);
        return builder.build();
    }

    /**
     * 获取思考模式开关。
     *
     * @param enabled Boolean 配置的开关
     * @return boolean 缺省时开启
     */
    private boolean thinkingEnabled(Boolean enabled) {
        return enabled == null || Boolean.TRUE.equals(enabled);
    }

    /**
     * 获取合法的思考强度。
     *
     * @param effort String 配置的强度
     * @return String high或max
     */
    private String reasoningEffort(String effort) {
        return "max".equals(effort) ? "max" : "high";
    }

    /**
     * 默认文本模型解析结果。
     *
     * @param channel AiChannelConfig 文本模型渠道
     * @param config ModelConfig 文本模型配置
     */
    private record ResolvedTextModel(AiTaskDtos.AiChannelConfig channel, PersistenceDtos.ModelConfig config) {
    }

    /**
     * 已解析的文本模型与积分配置。
     *
     * @param agentModel Model AgentScope模型实例
     * @param modelValue String 渠道模型编码
     * @param modelName String 模型名称
     * @param provider String 渠道名称
     * @param creditCost int 单次积分价格
     */
    public record TextModelSelection(Model agentModel, String modelValue, String modelName, String provider, int creditCost) {
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

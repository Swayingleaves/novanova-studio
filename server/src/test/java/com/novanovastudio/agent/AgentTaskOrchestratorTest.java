package com.novanovastudio.agent;

import static org.mockito.Mockito.when;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.ai.AiProviderAdapterRegistry;
import com.novanovastudio.ai.AiHttpClient;
import com.novanovastudio.ai.AiTaskTypes;
import com.novanovastudio.agent.dto.AgentChatRequest;
import com.novanovastudio.agent.dto.AgentEvent;
import com.novanovastudio.agent.dto.AgentSession;
import com.novanovastudio.agent.dto.AgentToolResult.ToolResult;
import com.novanovastudio.agent.dto.CreationSettings;
import com.novanovastudio.agent.dto.AiResponse;
import com.novanovastudio.agent.dto.ToolCall;
import com.novanovastudio.agent.dto.ToolCallFunction;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.dto.AiTaskDtos;
import com.novanovastudio.dto.PersistenceDtos;
import com.novanovastudio.service.PersistenceService;
import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;
import reactor.core.publisher.Mono;

/**
 * @title        AgentTaskOrchestratorTest.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  Agent任务编排器测试
 * @createTime   2026-06-28 22:30:00
 */
class AgentTaskOrchestratorTest {

    /** Chat Completions流应逐段输出并聚合文本。 */
    @Test
    void shouldAggregateChatCompletionTextDeltas() throws Exception {
        AtomicReference<String> emitted = new AtomicReference<>("");
        Object accumulator = newStreamAccumulator("ChatStreamAccumulator", delta -> emitted.set(emitted.get() + delta));

        acceptStreamData(accumulator, "{\"choices\":[{\"delta\":{\"content\":\"你好\"}}]}");
        acceptStreamData(accumulator, "{\"choices\":[{\"delta\":{\"content\":\"世界🌍\"}}]}");

        AiResponse response = streamResponse(accumulator);
        Assertions.assertEquals("你好世界🌍", emitted.get());
        Assertions.assertEquals("你好世界🌍", response.text());
    }

    /** Chat Completions流应还原被拆分的工具参数。 */
    @Test
    void shouldAggregateChatCompletionToolArguments() throws Exception {
        Object accumulator = newStreamAccumulator("ChatStreamAccumulator", ignored -> { });

        acceptStreamData(accumulator, "{\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call-1\",\"function\":{\"name\":\"generate_image\",\"arguments\":\"{\\\"prompt\\\":\"}}]}}]}");
        acceptStreamData(accumulator, "{\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"\\\"猫\\\"}\"}}]}}]}");

        AiResponse response = streamResponse(accumulator);
        Assertions.assertEquals(1, response.toolCalls().size());
        Assertions.assertEquals("generate_image", response.toolCalls().getFirst().function().name());
        Assertions.assertEquals("{\"prompt\":\"猫\"}", response.toolCalls().getFirst().function().arguments());
    }

    /** OpenAI Responses流应逐段输出中文文本。 */
    @Test
    void shouldAggregateResponsesTextDeltas() throws Exception {
        AtomicReference<String> emitted = new AtomicReference<>("");
        Object accumulator = newStreamAccumulator("ResponsesStreamAccumulator", delta -> emitted.set(emitted.get() + delta));
        acceptStreamData(accumulator, "{\"type\":\"response.output_text.delta\",\"delta\":\"流式\"}");
        acceptStreamData(accumulator, "{\"type\":\"response.output_text.delta\",\"delta\":\"输出\"}");

        Assertions.assertEquals("流式输出", emitted.get());
        Assertions.assertEquals("流式输出", streamResponse(accumulator).text());
    }

    /** Anthropic流应聚合文本增量。 */
    @Test
    void shouldAggregateAnthropicTextDeltas() throws Exception {
        AtomicReference<String> emitted = new AtomicReference<>("");
        Object accumulator = newStreamAccumulator("AnthropicStreamAccumulator", delta -> emitted.set(emitted.get() + delta));
        acceptAnthropicStreamData(accumulator, new AiHttpClient.AnthropicStreamEvent("content_block_delta",
                JSON.parseObject("{\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"逐Token\"}}")));

        Assertions.assertEquals("逐Token", emitted.get());
        Assertions.assertEquals("逐Token", streamResponse(accumulator).text());
    }

    /** 创建私有流聚合器。 */
    private Object newStreamAccumulator(String simpleName, Consumer<String> consumer) throws Exception {
        Class<?> type = Class.forName(AgentTaskOrchestrator.class.getName() + "$" + simpleName);
        Constructor<?> constructor = type.getDeclaredConstructor(Consumer.class);
        constructor.setAccessible(true);
        return constructor.newInstance(consumer);
    }

    /** 向私有流聚合器提交一条数据。 */
    private void acceptStreamData(Object accumulator, String data) throws Exception {
        Method method = accumulator.getClass().getDeclaredMethod("accept", String.class);
        method.setAccessible(true);
        method.invoke(accumulator, data);
    }

    /** 向Anthropic私有流聚合器提交事件。 */
    private void acceptAnthropicStreamData(Object accumulator, AiHttpClient.AnthropicStreamEvent event) throws Exception {
        Method method = accumulator.getClass().getDeclaredMethod("accept", AiHttpClient.AnthropicStreamEvent.class);
        method.setAccessible(true);
        method.invoke(accumulator, event);
    }

    /** 读取私有流聚合器的最终响应。 */
    private AiResponse streamResponse(Object accumulator) throws Exception {
        Method method = accumulator.getClass().getDeclaredMethod("response");
        method.setAccessible(true);
        return (AiResponse) method.invoke(accumulator);
    }

    /**
     * 测试显式选择的渠道模型不可用时必须报错。
     *
     * @return void 无返回值
     * @throws Exception 反射调用失败时抛出
     */
    @Test
    void shouldRejectUnavailableExplicitModel() throws Exception {
        // 显式选择模型时不能回退到其他渠道，否则前端显示的选择和实际调用不一致。
        AgentTaskOrchestrator orchestrator = newOrchestrator(
                List.of(new AiTaskDtos.AiChannelConfig("channel-1", "文本渠道", "https://example.com", "key", "openai", List.of("gpt-4.1")))
        );

        Mono<AiTaskDtos.AiChannelConfig> result = invokeResolveChannelByModel(orchestrator, "channel-1::missing-model");

        BusinessException exception = Assertions.assertThrows(BusinessException.class, result::block);
        Assertions.assertTrue(exception.getMessage().contains("所选文本模型未在管理员启用的模型中配置"));
    }

    /**
     * 测试显式选择的渠道模型命中时只返回该模型。
     *
     * @return void 无返回值
     * @throws Exception 反射调用失败时抛出
     */
    @Test
    void shouldResolveSelectedModelOnly() throws Exception {
        // 返回的渠道模型列表只包含用户选择的模型，确保 firstModel 使用正确值。
        AgentTaskOrchestrator orchestrator = newOrchestrator(
                List.of(new AiTaskDtos.AiChannelConfig("channel-1", "文本渠道", "https://example.com", "key", "openai", List.of("gpt-4.1", "gpt-4.1-mini")))
        );

        AiTaskDtos.AiChannelConfig channel = invokeResolveChannelByModel(orchestrator, "channel-1::gpt-4.1-mini").block();

        Assertions.assertNotNull(channel);
        Assertions.assertEquals("channel-1", channel.id());
        Assertions.assertEquals(List.of("gpt-4.1-mini"), channel.models());
    }

    /**
     * 测试 Agent 初始化阶段模型不可用时会推送错误事件。
     *
     * @return void 无返回值
     * @throws Exception 反射调用失败时抛出
     */
    @Test
    void shouldEmitErrorWhenSelectedModelUnavailableBeforeStep() throws Exception {
        // 模型解析发生在执行步骤之前，必须通过 SSE 告知前端停止生成状态。
        CapturingEventEmitter eventEmitter = new CapturingEventEmitter();
        AgentTaskOrchestrator orchestrator = new AgentTaskOrchestrator(
                null,
                new StubAdapterRegistry(),
                null,
                null,
                eventEmitter,
                null,
                new StubPersistenceService(List.of(new AiTaskDtos.AiChannelConfig("channel-1", "文本渠道", "https://example.com", "key", "openai", List.of("gpt-4.1")))),
                List.of(),
                new AgentExecutionRegistry()
        );
        AgentSession session = new AgentSession("session-1", 1L, "新对话", "canvas", new ArrayList<>(), OffsetDateTime.now(), OffsetDateTime.now());
        AgentChatRequest request = new AgentChatRequest("session-1", "canvas", "你好", Map.of(), List.of(), List.of(), List.of(),
                new CreationSettings("channel-1::missing-model", null, null, null, null, null, null));

        invokeRunAgentLoop(orchestrator, session, request).block();

        Assertions.assertNotNull(eventEmitter.lastEvent);
        Assertions.assertEquals("error", eventEmitter.lastEvent.type());
        Assertions.assertEquals("session-1", eventEmitter.lastEvent.sessionId());
        Assertions.assertTrue(eventEmitter.lastEvent.errorMessage().contains("所选文本模型未在管理员启用的模型中配置"));
    }

    /**
     * 测试Anthropic工具调用追加后第二轮请求仍保留input字段。
     *
     * @return void 无返回值
     * @throws Exception 反射调用失败时抛出
     */
    @Test
    @SuppressWarnings("unchecked")
    void shouldKeepAnthropicToolInputWhenAppendingToolResults() throws Exception {
        // 第二轮 Anthropic 请求必须把上一轮 assistant tool_use 的 input 原样带回，否则接口会返回缺少 input。
        AgentTaskOrchestrator orchestrator = newOrchestrator(List.of());
        Object userMessage = newAiMessage("user", "当前画布：{}");
        Object toolCallFunction = newPrivateRecord("com.novanovastudio.agent.dto.ToolCallFunction",
                new Class<?>[]{String.class, String.class},
                "canvas_get_state", "{\"nodeId\":\"node-1\"}");
        Object toolCall = newPrivateRecord("com.novanovastudio.agent.dto.ToolCall",
                new Class<?>[]{String.class, toolCallFunction.getClass()},
                "toolu_1", toolCallFunction);
        Object aiResponse = newPrivateRecord("com.novanovastudio.agent.dto.AiResponse",
                new Class<?>[]{String.class, List.class},
                "", List.of(toolCall));

        List<?> nextMessages = invokeAppendToolResults(orchestrator, List.of(userMessage), aiResponse,
                List.of(new ToolResult(true, "画布状态已读取")), "anthropic");
        Map<String, Object> assistantMessage = invokeToAnthropicMessage(orchestrator, nextMessages.get(1));
        List<Map<String, Object>> content = (List<Map<String, Object>>) assistantMessage.get("content");
        Map<String, Object> input = (Map<String, Object>) content.getFirst().get("input");

        Assertions.assertEquals("assistant", assistantMessage.get("role"));
        Assertions.assertEquals("node-1", input.get("nodeId"));
    }

    /**
     * 视频生成终态工具应使用用户输入框的原始提示词。
     *
     * @throws Exception 反射调用失败时抛出
     */
    @Test
    void shouldUseOriginalUserPromptForVideoGenerationTool() throws Exception {
        AgentTaskOrchestrator orchestrator = newOrchestrator(List.of());
        AgentLoopProfile profile = org.mockito.Mockito.mock(AgentLoopProfile.class);
        when(profile.name()).thenReturn("video");
        when(profile.isTerminalTool("generate_video")).thenReturn(true);
        AiResponse response = new AiResponse("", List.of(new ToolCall("call-video",
                new ToolCallFunction("generate_video", "{\"prompt\":\"AI 改写后的 B\",\"size\":\"704x1280\"}"))));
        List<?> messages = List.of(newAiMessage("user", "[用户设置：尺寸=704x1280]\n\n用户原始输入 A"));

        AiResponse normalizedResponse = invokeApplyOriginalPromptToTerminalTools(orchestrator, profile, response, messages);

        Assertions.assertEquals("用户原始输入 A", JSON.parseObject(normalizedResponse.toolCalls().getFirst().function().arguments()).getString("prompt"));
        Assertions.assertEquals("704x1280", JSON.parseObject(normalizedResponse.toolCalls().getFirst().function().arguments()).getString("size"));
    }

    /**
     * 视频 Agent 启动后应立即持久化用户输入对应的 pending 轮次。
     *
     * @throws Exception 反射调用失败时抛出
     */
    @Test
    void shouldPersistInitialVideoRoundBeforeToolExecution() throws Exception {
        StubPersistenceService persistenceService = new StubPersistenceService(List.of());
        AgentTaskOrchestrator orchestrator = newOrchestrator(persistenceService);
        AgentChatRequest request = new AgentChatRequest("session-1", "videoPage",
                "[用户设置：尺寸=704x1280]\n\n用户原始输入 A", Map.of(), List.of(), List.of(
                new AgentChatRequest.Attachment("https://untrusted.example.com/cat-dog.png", "image/png", "猫狗.png", "image:cat-dog"),
                new AgentChatRequest.Attachment("https://untrusted.example.com/source.mp4", "video/mp4", "素材.mp4", "video:source")),
                List.of(), new CreationSettings("model-1", "704x1280", "720p", "medium", null, "5", false));

        invokeSaveInitialVideoRound(orchestrator, "session-1", request).block();

        Assertions.assertNotNull(persistenceService.savedRound);
        Assertions.assertTrue(persistenceService.savedRound.getString("id").length() > 0);
        Assertions.assertEquals("用户原始输入 A", persistenceService.savedRound.getString("prompt"));
        Assertions.assertEquals("pending", persistenceService.savedRound.getJSONObject("result").getString("status"));
        Assertions.assertEquals("image:cat-dog", persistenceService.savedRound.getJSONArray("references")
                .getJSONObject(0).getString("storageKey"));
        Assertions.assertEquals("video:source", persistenceService.savedRound.getJSONArray("videoReferences")
                .getJSONObject(0).getString("storageKey"));
        Assertions.assertFalse(persistenceService.savedRound.toJSONString().contains("untrusted.example.com"));
    }

    /**
     * 视频终态工具应复用请求开始时已持久化的轮次ID。
     *
     * @throws Exception 反射调用失败时抛出
     */
    @Test
    void shouldReuseInitialVideoRoundIdForVideoGenerationTool() throws Exception {
        AgentTaskOrchestrator orchestrator = newOrchestrator(List.of());
        AgentLoopProfile profile = org.mockito.Mockito.mock(AgentLoopProfile.class);
        when(profile.name()).thenReturn("video");
        when(profile.isTerminalTool("generate_video")).thenReturn(true);
        putInitialVideoRoundId(orchestrator, "session-1", "round-1");
        AiResponse response = new AiResponse("", List.of(new ToolCall("provider-call-1",
                new ToolCallFunction("generate_video", "{\"prompt\":\"用户原始输入 A\"}"))));

        AiResponse normalizedResponse = invokeApplyInitialVideoRoundIdToTerminalTools(orchestrator, profile, "session-1", response);

        Assertions.assertEquals("round-1", normalizedResponse.toolCalls().getFirst().id());
    }

    /**
     * 成功终态应在包含媒体后按首个工具调用ID更新已有生成轮次。
     *
     * @throws Exception 反射调用失败时抛出
     */
    @Test
    void shouldSaveSuccessfulGenerationRoundByFirstCallIdAfterMediaAvailable() throws Exception {
        StubPersistenceService persistenceService = new StubPersistenceService(List.of());
        AgentTaskOrchestrator orchestrator = newOrchestrator(persistenceService);
        AiResponse response = new AiResponse("生成完成", List.of(
                new ToolCall("call-1", new ToolCallFunction("generate_image",
                        "{\"prompt\":\"生成图片\",\"model\":\"model-1\",\"size\":\"1:1\"}")),
                new ToolCall("call-2", new ToolCallFunction("generate_image",
                        "{\"prompt\":\"生成第二张图片\",\"model\":\"model-1\",\"size\":\"1:1\"}"))));
        ToolResult firstResult = new ToolResult(true, "生成完成", Map.of(
                "taskId", "task-1",
                "items", List.of(Map.of("url", "https://example.com/image.png", "width", 1024, "height", 1024))));
        ToolResult secondResult = new ToolResult(true, "生成完成", Map.of(
                "taskId", "task-2",
                "items", List.of(Map.of("url", "https://example.com/image-2.png", "width", 1024, "height", 1024))));

        List<AgentChatRequest.Attachment> attachments = List.of(
                new AgentChatRequest.Attachment("https://untrusted.example.com/cat-dog.png", "image/png", "猫狗.png", "image:cat-dog"),
                new AgentChatRequest.Attachment("https://untrusted.example.com/source.mp4", "video/mp4", "素材.mp4", "video:source"));

        invokeSaveGenerationRound(orchestrator, response, List.of(firstResult, secondResult), attachments).block();

        JSONObjectAssert.assertSuccessfulRound(persistenceService.savedRound);
        Assertions.assertEquals("image:cat-dog", persistenceService.savedRound.getJSONArray("references")
                .getJSONObject(0).getString("storageKey"));
        Assertions.assertEquals("video:source", persistenceService.savedRound.getJSONArray("videoReferences")
                .getJSONObject(0).getString("storageKey"));
        Assertions.assertFalse(persistenceService.savedRound.toJSONString().contains("untrusted.example.com"));
    }

    /**
     * 工具声称成功但没有媒体时，不得把终态轮次保存为 success。
     *
     * @throws Exception 反射调用失败时抛出
     */
    @Test
    void shouldNotSaveSuccessWhenGeneratedMediaIsMissing() throws Exception {
        StubPersistenceService persistenceService = new StubPersistenceService(List.of());
        AgentTaskOrchestrator orchestrator = newOrchestrator(persistenceService);
        AiResponse response = new AiResponse("生成完成", List.of(new ToolCall("call-1",
                new ToolCallFunction("generate_image", "{\"prompt\":\"生成图片\"}"))));

        invokeSaveGenerationRound(orchestrator, response,
                List.of(new ToolResult(true, "生成完成", Map.of("taskId", "task-1"))), List.of()).block();

        Assertions.assertNotNull(persistenceService.savedRound);
        Assertions.assertEquals("failed", persistenceService.savedRound.getJSONArray("results").getJSONObject(0).getString("status"));
    }

    /**
     * 创建编排器测试实例。
     *
     * @param channels List<AiChannelConfig> 用户渠道列表
     * @return AgentTaskOrchestrator 编排器实例
     */
    private AgentTaskOrchestrator newOrchestrator(List<AiTaskDtos.AiChannelConfig> channels) {
        return newOrchestrator(new StubPersistenceService(channels));
    }

    /**
     * 使用指定持久化服务创建编排器测试实例。
     *
     * @param persistenceService StubPersistenceService 测试持久化服务
     * @return AgentTaskOrchestrator 编排器实例
     */
    private AgentTaskOrchestrator newOrchestrator(StubPersistenceService persistenceService) {
        // 构造器依赖较多，仅本测试目标用到持久化服务和渠道适配器注册表。
        return new AgentTaskOrchestrator(
                null,
                new StubAdapterRegistry(),
                null,
                null,
                null,
                null,
                persistenceService,
                List.of(),
                new AgentExecutionRegistry()
        );
    }

    /**
     * 调用私有模型解析方法。
     *
     * @param orchestrator AgentTaskOrchestrator 编排器
     * @param modelHint String 模型选择值
     * @return Mono<AiChannelConfig> 渠道解析结果
     * @throws Exception 反射调用失败时抛出
     */
    @SuppressWarnings("unchecked")
    private Mono<AiTaskDtos.AiChannelConfig> invokeResolveChannelByModel(AgentTaskOrchestrator orchestrator, String modelHint) throws Exception {
        Method method = AgentTaskOrchestrator.class.getDeclaredMethod("resolveChannelByModel", String.class);
        method.setAccessible(true);
        return (Mono<AiTaskDtos.AiChannelConfig>) method.invoke(orchestrator, modelHint);
    }

    /**
     * 调用私有Agent循环方法。
     *
     * @param orchestrator AgentTaskOrchestrator 编排器
     * @param session AgentSession 会话
     * @param request AgentChatRequest 请求
     * @return Mono<Void> 执行结果
     * @throws Exception 反射调用失败时抛出
     */
    @SuppressWarnings("unchecked")
    private Mono<Void> invokeRunAgentLoop(AgentTaskOrchestrator orchestrator, AgentSession session, AgentChatRequest request) throws Exception {
        AgentLoopProfile profile = org.mockito.Mockito.mock(AgentLoopProfile.class);
        when(profile.name()).thenReturn("canvas");
        Method method = AgentTaskOrchestrator.class.getDeclaredMethod("runAgentLoop", Long.class, AgentSession.class, AgentLoopProfile.class, AgentChatRequest.class);
        method.setAccessible(true);
        return (Mono<Void>) method.invoke(orchestrator, 1L, session, profile, request);
    }

    /**
     * 调用原始提示词覆盖方法。
     *
     * @param orchestrator AgentTaskOrchestrator 编排器
     * @param profile AgentLoopProfile 当前 Profile
     * @param response AiResponse AI 工具调用响应
     * @param messages List<?> 当前消息列表
     * @return AiResponse 使用用户原始提示词后的工具调用响应
     * @throws Exception 反射调用失败时抛出
     */
    private AiResponse invokeApplyOriginalPromptToTerminalTools(AgentTaskOrchestrator orchestrator,
                                                                 AgentLoopProfile profile, AiResponse response,
                                                                 List<?> messages) throws Exception {
        Method method = AgentTaskOrchestrator.class.getDeclaredMethod("applyOriginalPromptToTerminalTools",
                AgentLoopProfile.class, AiResponse.class, List.class);
        method.setAccessible(true);
        return (AiResponse) method.invoke(orchestrator, profile, response, messages);
    }

    /**
     * 调用初始视频轮次保存方法。
     *
     * @param orchestrator AgentTaskOrchestrator 编排器
     * @param sessionId String Agent会话ID
     * @param roundId String 生成轮次ID
     * @param request AgentChatRequest 用户对话请求
     * @return Mono<Void> 保存结果
     * @throws Exception 反射调用失败时抛出
     */
    @SuppressWarnings("unchecked")
    private Mono<Void> invokeSaveInitialVideoRound(AgentTaskOrchestrator orchestrator, String sessionId,
                                                   AgentChatRequest request) throws Exception {
        Method createMethod = AgentTaskOrchestrator.class.getDeclaredMethod("createInitialVideoRound", AgentChatRequest.class);
        createMethod.setAccessible(true);
        Object initialVideoRound = createMethod.invoke(orchestrator, request);
        Method saveMethod = AgentTaskOrchestrator.class.getDeclaredMethod("saveInitialVideoRound",
                Long.class, String.class, initialVideoRound.getClass());
        saveMethod.setAccessible(true);
        return (Mono<Void>) saveMethod.invoke(orchestrator, 7L, sessionId, initialVideoRound);
    }

    /**
     * 调用初始视频轮次ID绑定方法。
     *
     * @param orchestrator AgentTaskOrchestrator 编排器
     * @param profile AgentLoopProfile 当前 Profile
     * @param sessionId String Agent会话ID
     * @param response AiResponse AI工具调用响应
     * @return AiResponse 绑定初始轮次ID后的工具调用响应
     * @throws Exception 反射调用失败时抛出
     */
    private AiResponse invokeApplyInitialVideoRoundIdToTerminalTools(AgentTaskOrchestrator orchestrator,
                                                                       AgentLoopProfile profile, String sessionId,
                                                                       AiResponse response) throws Exception {
        Method method = AgentTaskOrchestrator.class.getDeclaredMethod("applyInitialVideoRoundIdToTerminalTools",
                AgentLoopProfile.class, String.class, AiResponse.class);
        method.setAccessible(true);
        return (AiResponse) method.invoke(orchestrator, profile, sessionId, response);
    }

    /**
     * 写入测试用初始视频轮次。
     *
     * @param orchestrator AgentTaskOrchestrator 编排器
     * @param sessionId String Agent会话ID
     * @param roundId String 生成轮次ID
     * @throws Exception 反射写入失败时抛出
     */
    @SuppressWarnings("unchecked")
    private void putInitialVideoRoundId(AgentTaskOrchestrator orchestrator, String sessionId, String roundId) throws Exception {
        Constructor<?> constructor = Class.forName("com.novanovastudio.agent.AgentTaskOrchestrator$InitialVideoRound")
                .getDeclaredConstructor(String.class, String.class, JSONObject.class);
        constructor.setAccessible(true);
        Field field = AgentTaskOrchestrator.class.getDeclaredField("initialVideoRounds");
        field.setAccessible(true);
        ((Map<String, Object>) field.get(orchestrator)).put(sessionId, constructor.newInstance(roundId, "", new JSONObject()));
    }

    /**
     * 调用生成轮次终态保存方法。
     *
     * @param orchestrator AgentTaskOrchestrator 编排器
     * @param response AiResponse AI工具调用响应
     * @param results List<ToolResult> 工具执行结果
     * @param attachments List<Attachment> 当前请求上传的媒体附件
     * @return Mono<Void> 保存结果
     * @throws Exception 反射调用失败时抛出
     */
    @SuppressWarnings("unchecked")
    private Mono<Void> invokeSaveGenerationRound(AgentTaskOrchestrator orchestrator, AiResponse response,
                                                  List<ToolResult> results,
                                                  List<AgentChatRequest.Attachment> attachments) throws Exception {
        Method method = AgentTaskOrchestrator.class.getDeclaredMethod("saveGenerationRound",
                String.class, Long.class, AiResponse.class, List.class, List.class);
        method.setAccessible(true);
        return (Mono<Void>) method.invoke(orchestrator, "session-1", 7L, response, results, attachments);
    }

    /**
     * 调用工具结果追加方法。
     *
     * @param orchestrator AgentTaskOrchestrator 编排器
     * @param messages List<?> 当前消息列表
     * @param response Object AI响应
     * @param results List<ToolResult> 工具结果列表
     * @param apiFormat String API格式
     * @return List<?> 追加后的消息列表
     * @throws Exception 反射调用失败时抛出
     */
    @SuppressWarnings("unchecked")
    private List<?> invokeAppendToolResults(AgentTaskOrchestrator orchestrator, List<?> messages, Object response,
                                            List<ToolResult> results, String apiFormat) throws Exception {
        Class<?> aiResponseClass = Class.forName("com.novanovastudio.agent.dto.AiResponse");
        Method method = AgentTaskOrchestrator.class.getDeclaredMethod("appendToolResults", List.class, aiResponseClass, List.class, String.class);
        method.setAccessible(true);
        return (List<?>) method.invoke(orchestrator, messages, response, results, apiFormat);
    }

    /**
     * 调用Anthropic消息转换方法。
     *
     * @param orchestrator AgentTaskOrchestrator 编排器
     * @param message Object 私有AiMessage消息
     * @return Map<String, Object> Anthropic消息
     * @throws Exception 反射调用失败时抛出
     */
    @SuppressWarnings("unchecked")
    private Map<String, Object> invokeToAnthropicMessage(AgentTaskOrchestrator orchestrator, Object message) throws Exception {
        Class<?> aiMessageClass = Class.forName("com.novanovastudio.agent.dto.AiMessage");
        Method method = AgentTaskOrchestrator.class.getDeclaredMethod("toAnthropicMessage", aiMessageClass);
        method.setAccessible(true);
        return (Map<String, Object>) method.invoke(orchestrator, message);
    }

    /**
     * 创建私有AiMessage。
     *
     * @param role String 消息角色
     * @param content String 消息内容
     * @return Object 私有AiMessage实例
     * @throws Exception 反射创建失败时抛出
     */
    private Object newAiMessage(String role, String content) throws Exception {
        return newPrivateRecord("com.novanovastudio.agent.dto.AiMessage",
                new Class<?>[]{String.class, String.class}, role, content);
    }

    /**
     * 创建私有record实例。
     *
     * @param className String 类名
     * @param parameterTypes Class<?>[] 构造参数类型
     * @param arguments Object... 构造参数值
     * @return Object record实例
     * @throws Exception 反射创建失败时抛出
     */
    private Object newPrivateRecord(String className, Class<?>[] parameterTypes, Object... arguments) throws Exception {
        Class<?> recordClass = Class.forName(className);
        Constructor<?> constructor = recordClass.getDeclaredConstructor(parameterTypes);
        constructor.setAccessible(true);
        return constructor.newInstance(arguments);
    }

    /**
     * @title        StubAdapterRegistry
     * @author       zhenglin.cn.cq@gmail.com
     * @description  测试用渠道适配器注册表
     * @createTime   2026-06-28 22:30:00
     */
    private static final class StubAdapterRegistry extends AiProviderAdapterRegistry {

        /**
         * 创建测试用渠道适配器注册表。
         */
        private StubAdapterRegistry() {
            super(List.of());
        }

        /**
         * 判断渠道是否支持指定能力。
         *
         * @param channel AiChannelConfig 渠道配置
         * @param taskType String 任务类型
         * @return boolean 是否支持
         */
        @Override
        public boolean supports(AiTaskDtos.AiChannelConfig channel, String taskType) {
            return AiTaskTypes.TEXT.equals(taskType);
        }
    }

    /**
     * @title        StubPersistenceService
     * @author       zhenglin.cn.cq@gmail.com
     * @description  测试用持久化服务
     * @createTime   2026-06-28 22:30:00
     */
    private static final class StubPersistenceService extends PersistenceService {

        /** 全站渠道列表 */
        private final List<AiTaskDtos.AiChannelConfig> channels;

        /** 最近保存的生成轮次 */
        private com.alibaba.fastjson2.JSONObject savedRound;


        /**
         * 创建测试用持久化服务。
         *
         * @param channels List<AiChannelConfig> 全站渠道列表
         */
        private StubPersistenceService(List<AiTaskDtos.AiChannelConfig> channels) {
            super(null, null, null, null, null);
            this.channels = channels;
        }

        /**
         * 获取全站AI渠道。
         *
         * @return Mono<List<AiChannelConfig>> 全站渠道列表
         */
        @Override
        public Mono<List<AiTaskDtos.AiChannelConfig>> getPlatformAiChannels() {
            return Mono.just(channels);
        }

        /**
         * 获取全站文本模型配置。
         *
         * @return Mono<List<ModelConfig>> 全站模型配置列表
         */
        @Override
        public Mono<List<PersistenceDtos.ModelConfig>> getPlatformModelConfigs() {
            return Mono.just(channels.stream()
                    .flatMap(channel -> channel.models().stream()
                            .map(model -> new PersistenceDtos.ModelConfig(
                                    channel.id() + "::" + model, channel.id(), model, AiTaskTypes.TEXT, List.of(),
                                    model.equals(channel.models().get(0)), 0, 0)))
                    .toList());
        }

        /**
         * 捕获按稳定ID保存或更新的生成轮次。
         *
         * @param userId Long 用户ID
         * @param sessionId String Agent会话ID
         * @param logType String 记录类型
         * @param title String 记录标题
         * @param round JSONObject 生成轮次
         * @return Mono<Void> 保存结果
         */
        @Override
        public Mono<Void> saveOrUpdateGenerationRound(Long userId, String sessionId, String logType, String title,
                                                       com.alibaba.fastjson2.JSONObject round) {
            this.savedRound = com.alibaba.fastjson2.JSON.parseObject(com.alibaba.fastjson2.JSON.toJSONString(round));
            return Mono.empty();
        }

    }

    /**
     * 生成轮次 JSON 断言工具。
     */
    private static final class JSONObjectAssert {

        /**
         * 断言成功终态包含稳定轮次ID、任务ID和媒体。
         *
         * @param round JSONObject 生成轮次
         */
        private static void assertSuccessfulRound(com.alibaba.fastjson2.JSONObject round) {
            Assertions.assertNotNull(round);
            com.alibaba.fastjson2.JSONObject result = round.getJSONArray("results").getJSONObject(0);
            Assertions.assertEquals("call-1", round.getString("id"));
            Assertions.assertEquals("task-1", round.getString("taskId"));
            Assertions.assertEquals("call-1", result.getString("id"));
            Assertions.assertEquals("task-1", result.getString("taskId"));
            Assertions.assertEquals("success", result.getString("status"));
            Assertions.assertEquals(100, result.getIntValue("progress"));
            Assertions.assertEquals("https://example.com/image.png", result.getJSONObject("image").getString("url"));
            Assertions.assertEquals(2, round.getJSONArray("results").size());
            Assertions.assertEquals("call-2", round.getJSONArray("results").getJSONObject(1).getString("id"));
        }
    }

    /**
     * @title        CapturingEventEmitter
     * @author       zhenglin.cn.cq@gmail.com
     * @description  测试用事件捕获器
     * @createTime   2026-06-28 22:30:00
     */
    private static final class CapturingEventEmitter extends AgentEventEmitter {

        /** 最近一次推送事件 */
        private AgentEvent lastEvent;

        /**
         * 捕获推送事件。
         *
         * @param userId Long 用户ID
         * @param event AgentEvent 事件
         */
        @Override
        public void emit(Long userId, AgentEvent event) {
            this.lastEvent = event;
        }
    }
}

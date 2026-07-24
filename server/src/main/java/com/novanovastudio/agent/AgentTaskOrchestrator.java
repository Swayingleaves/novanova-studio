/**
 * @title        AgentTaskOrchestrator.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  AgentScope 任务编排器，实现 Agent Loop
 * @createTime   2026-06-24 11:58:00
 */
package com.novanovastudio.agent;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.agent.dto.AgentChatRequest;
import com.novanovastudio.agent.dto.AgentEvent;
import com.novanovastudio.agent.dto.AgentMessage;
import com.novanovastudio.agent.dto.AgentSession;
import com.novanovastudio.agent.dto.AgentTool;
import com.novanovastudio.agent.dto.AgentToolResult;
import com.novanovastudio.ai.AiHttpClient;
import com.novanovastudio.ai.AiProviderAdapterRegistry;
import com.novanovastudio.ai.AiTaskTypes;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.dto.AiTaskDtos;
import com.novanovastudio.dto.PersistenceDtos;
import com.novanovastudio.security.CurrentUser;
import com.novanovastudio.security.CurrentUserProvider;
import com.novanovastudio.service.AiTaskService;
import com.novanovastudio.service.PersistenceService;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Consumer;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.core.publisher.MonoSink;
import reactor.core.scheduler.Schedulers;
import com.novanovastudio.agent.dto.AgentToolResult.ToolResult;
import com.novanovastudio.agent.dto.AiMessage;
import com.novanovastudio.agent.dto.AiResponse;
import com.novanovastudio.agent.dto.ToolCall;
import com.novanovastudio.agent.dto.ToolCallFunction;

/**
 * AgentScope 任务编排器，实现"调用 AI → 解析工具 → 执行工具 → 继续调用"的 Agent Loop。
 * <p>
 * 读操作工具在后端直接处理，独立生成页面的内容生成工具在后端调用 AiTaskService 执行，
 * 画布写入和画布生成工具通过 SSE 转发到前端执行并等待结果回传。
 */
@Component
@Slf4j
public class AgentTaskOrchestrator {

    /** 最大 Agent Loop 步数 */
    private static final int MAX_STEPS = 4;

    /** 读操作工具集合，后端直接读快照 */
    private static final Set<String> READ_TOOLS = Set.of("canvas_get_state", "canvas_get_selection", "canvas_export_snapshot");

    /** 需要由服务端分配稳定轮次ID的生成类Profile */
    private static final Set<String> GENERATION_PROFILE_NAMES = Set.of("generation", "video");

    private final AiHttpClient aiHttpClient;
    private final AiProviderAdapterRegistry adapterRegistry;
    private final AgentToolRegistry toolRegistry;
    private final AgentSessionService sessionService;
    private final AgentEventEmitter eventEmitter;
    // AiTaskService 依赖本编排器（AiTaskService 注入 AgentTaskOrchestrator），形成构造器循环依赖，用 @Lazy 打破。
    private final AiTaskService aiTaskService;
    private final PersistenceService persistenceService;
    /** Agent 会话执行登记 */
    private final AgentExecutionRegistry executionRegistry;
    /** Profile 列表，按 name() 路由 */
    private final List<AgentLoopProfile> profiles;

    /** sessionId → callId → MonoSink，用于阻塞等待前端工具结果 */
    private final ConcurrentHashMap<String, ConcurrentHashMap<String, MonoSink<ToolResult>>> pendingResults = new ConcurrentHashMap<>();

    /** userId → 当前活跃的 sessionId，防止同一用户并发启动多个 Agent Loop */
    private final ConcurrentHashMap<Long, String> activeLoops = new ConcurrentHashMap<>();

    /** sessionId → 初始视频生成轮次，用于停止时更新同一条待生成记录 */
    private final ConcurrentHashMap<String, InitialVideoRound> initialVideoRounds = new ConcurrentHashMap<>();

    /** sessionId → 当前请求的服务端生成轮次ID，避免上游工具调用ID跨轮重复覆盖历史 */
    private final ConcurrentHashMap<String, String> generationRoundIds = new ConcurrentHashMap<>();

    /**
     * 构造编排器。aiTaskService 与本类存在构造器循环依赖，使用 @Lazy 延迟初始化打破循环。
     */
    public AgentTaskOrchestrator(AiHttpClient aiHttpClient, AiProviderAdapterRegistry adapterRegistry, AgentToolRegistry toolRegistry,
                                 AgentSessionService sessionService, AgentEventEmitter eventEmitter, @Lazy AiTaskService aiTaskService,
                                 PersistenceService persistenceService, List<AgentLoopProfile> profiles,
                                 AgentExecutionRegistry executionRegistry) {
        this.aiHttpClient = aiHttpClient;
        this.adapterRegistry = adapterRegistry;
        this.toolRegistry = toolRegistry;
        this.sessionService = sessionService;
        this.eventEmitter = eventEmitter;
        this.aiTaskService = aiTaskService;
        this.persistenceService = persistenceService;
        this.profiles = profiles != null ? profiles : List.of();
        this.executionRegistry = executionRegistry;
    }


    /**
     * 按 profile 名解析 AgentLoopProfile，默认返回 canvas profile。
     */
    private AgentLoopProfile resolveProfile(String profileName) {
        for (AgentLoopProfile p : profiles) {
            if (p.name().equalsIgnoreCase(profileName)) return p;
        }
        // 回退到 canvas
        for (AgentLoopProfile p : profiles) {
            if ("canvas".equals(p.name())) return p;
        }
        throw new IllegalStateException("没有可用的 AgentLoopProfile");
    }

    /**
     * 启动一次 Agent 对话。根据 request.profile 路由到对应 Profile。
     *
     * @param userId  Long 用户ID
     * @param request AgentChatRequest 对话请求
     * @return Mono<String> sessionId
     */
    public Mono<String> startChat(Long userId, AgentChatRequest request) {
        AgentLoopProfile profile = resolveProfile(request.profile());
        // 1. 创建或加载 Session
        return sessionService.getOrCreateSession(userId, request.sessionId(), request.profile())
            .flatMap(session -> {
                // 2. 并发去重
                String existing = activeLoops.putIfAbsent(userId, session.id());
                if (existing != null) {
                    log.warn("用户已有活跃的 Agent Loop，忽略重复请求: userId={}, activeSession={}", userId, existing);
                    return Mono.just(existing);
                }
                executionRegistry.open(userId, session.id());
                String generationRoundId = GENERATION_PROFILE_NAMES.contains(profile.name())
                        ? UUID.randomUUID().toString() : "";
                InitialVideoRound initialVideoRound = "video".equals(profile.name())
                        ? createInitialVideoRound(request, generationRoundId) : null;
                Mono<Void> persistInitialRound = initialVideoRound != null
                        ? saveInitialVideoRound(userId, session.id(), initialVideoRound)
                        : Mono.empty();
                // 3. 先落库用户输入，再异步执行 Agent Loop，刷新页面时可立即恢复对话。
                Mono<Void> persistUserMessage = sessionService.appendUserMessage(
                        session.id(), UUID.randomUUID().toString(), request.message());
                return persistInitialRound.then(persistUserMessage).then(Mono.fromSupplier(() -> {
                    if (StringUtils.hasText(generationRoundId)) {
                        generationRoundIds.put(session.id(), generationRoundId);
                    }
                    if (initialVideoRound != null) {
                        initialVideoRounds.put(session.id(), initialVideoRound);
                    }
                    var subscription = runAgentLoop(userId, session, profile, request)
                        .contextWrite(context -> context.put(CurrentUserProvider.CURRENT_USER_CONTEXT_KEY,
                            new CurrentUser(userId, null, null, 1)))
                        .subscribeOn(Schedulers.boundedElastic())
                        .doFinally(signal -> {
                            activeLoops.remove(userId, session.id());
                            initialVideoRounds.remove(session.id());
                            generationRoundIds.remove(session.id());
                            executionRegistry.complete(session.id());
                        })
                        .subscribe(
                            v -> log.info("Agent Loop 完成: sessionId={}", session.id()),
                            e -> log.error("Agent Loop 异常: sessionId={}", session.id(), e)
                        );
                    executionRegistry.attachSubscription(session.id(), subscription);
                    return session.id();
                })).doOnError(error -> {
                    activeLoops.remove(userId, session.id());
                    initialVideoRounds.remove(session.id());
                    generationRoundIds.remove(session.id());
                    executionRegistry.complete(session.id());
                });
            });
    }

    /**
     * 构造视频 Agent 在工具创建前的待生成轮次。
     *
     * @param request AgentChatRequest 用户对话请求
     * @param roundId String 服务端生成轮次ID
     * @return InitialVideoRound 初始视频生成轮次
     */
    private InitialVideoRound createInitialVideoRound(AgentChatRequest request, String roundId) {
        String prompt = normalizeUserPrompt(request.message());
        JSONObject result = new JSONObject();
        result.put("id", roundId);
        result.put("status", "pending");
        result.put("progress", 0);

        JSONObject round = new JSONObject();
        round.put("id", roundId);
        round.put("prompt", prompt);
        round.put("assistantText", "");
        round.put("config", new JSONObject());
        round.put("result", result);
        round.put("references", attachmentReferences(request.attachments(), "image/"));
        round.put("videoReferences", attachmentReferences(request.attachments(), "video/"));
        round.put("createdAt", System.currentTimeMillis());

        String title = prompt.length() > 30 ? prompt.substring(0, 30) : prompt;
        return new InitialVideoRound(roundId, title, round);
    }

    /**
     * 保存视频 Agent 在工具创建前的待生成轮次。
     *
     * @param userId Long 当前用户ID
     * @param sessionId String Agent会话ID
     * @param initialVideoRound InitialVideoRound 初始视频生成轮次
     * @return Mono<Void> 保存结果
     */
    private Mono<Void> saveInitialVideoRound(Long userId, String sessionId, InitialVideoRound initialVideoRound) {
        return persistenceService.saveOrUpdateGenerationRound(
                userId, sessionId, "video", initialVideoRound.title(), initialVideoRound.round());
    }

    /**
     * 取消当前用户的活跃 Agent 会话及其已创建的生成任务。
     *
     * @param userId Long 当前用户ID
     * @param sessionId String Agent会话ID
     * @return Mono<Void> 取消完成信号
     */
    public Mono<Void> cancelChat(Long userId, String sessionId) {
        if (!sessionId.equals(activeLoops.get(userId))) {
            return Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "当前会话没有正在执行的生成任务"));
        }
        AgentExecutionRegistry.AgentCancellation cancellation = executionRegistry.requestCancellation(userId, sessionId);
        if (!cancellation.active()) {
            return Mono.error(new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "当前会话没有正在执行的生成任务"));
        }

        Mono<Boolean> cancelTasks = Flux.fromIterable(cancellation.tasks())
                .concatMap(task -> aiTaskService.cancelTask(task.taskId())
                        .flatMap(response -> "canceled".equals(response.status())
                                ? saveCanceledTaskRound(userId, sessionId, task).thenReturn(true)
                                : Mono.just(false)))
                .any(Boolean.TRUE::equals);

        return cancelTasks.flatMap(hasCanceledTask -> {
                    if (!cancellation.tasks().isEmpty() && !hasCanceledTask) {
                        executionRegistry.clearCancellation(sessionId);
                        return Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "生成任务已完成，无法停止"));
                    }
                    return cancellation.tasks().isEmpty() ? saveCanceledInitialVideoRound(userId, sessionId) : Mono.empty();
                })
                .doOnSuccess(ignored -> {
                    activeLoops.remove(userId, sessionId);
                    executionRegistry.disposeWhenReady(sessionId);
                    eventEmitter.emit(userId, AgentEvent.canceled(sessionId, "已停止生成"));
                    log.info("已停止 Agent 对话: userId={}, sessionId={}, taskCount={}", userId, sessionId, cancellation.tasks().size());
                });
    }

    /**
     * 将已登记任务的生成轮次写为取消终态。
     *
     * @param userId Long 当前用户ID
     * @param sessionId String Agent会话ID
     * @param task AgentTaskRegistration 任务登记信息
     * @return Mono<Void> 保存结果
     */
    private Mono<Void> saveCanceledTaskRound(Long userId, String sessionId, AgentExecutionRegistry.AgentTaskRegistration task) {
        JSONObject round = JSON.parseObject(JSON.toJSONString(task.canceledRound()));
        return persistenceService.saveOrUpdateGenerationRound(userId, sessionId, task.logType(), task.title(), round);
    }

    /**
     * 将尚未创建任务的视频预置轮次写为取消终态。
     *
     * @param userId Long 当前用户ID
     * @param sessionId String Agent会话ID
     * @return Mono<Void> 保存结果
     */
    private Mono<Void> saveCanceledInitialVideoRound(Long userId, String sessionId) {
        InitialVideoRound initialVideoRound = initialVideoRounds.get(sessionId);
        if (initialVideoRound == null) {
            return Mono.empty();
        }
        JSONObject round = JSON.parseObject(JSON.toJSONString(initialVideoRound.round()));
        JSONObject result = round.getJSONObject("result");
        if (result == null) {
            result = new JSONObject();
            result.put("id", initialVideoRound.id());
            round.put("result", result);
        }
        result.put("status", "canceled");
        result.put("progress", 100);
        result.put("error", "已停止生成");
        return persistenceService.saveOrUpdateGenerationRound(userId, sessionId, "video", initialVideoRound.title(), round);
    }

    /**
     * 接收前端工具执行结果，唤醒等待的 Agent Loop
     *
     * @param userId Long 用户ID
     * @param result AgentToolResult 工具结果
     */
    public void submitToolResult(Long userId, AgentToolResult result) {
        if (!executionRegistry.isOwnedBy(userId, result.sessionId())) {
            log.warn("拒绝非会话所属用户回传工具结果: userId={}, sessionId={}", userId, result.sessionId());
            return;
        }
        ConcurrentHashMap<String, MonoSink<ToolResult>> sessionResults = pendingResults.get(result.sessionId());
        if (sessionResults == null) {
            log.warn("收到未知 session 的工具结果: sessionId={}", result.sessionId());
            return;
        }
        MonoSink<ToolResult> sink = sessionResults.remove(result.callId());
        if (sink == null) {
            log.warn("收到未知 callId 的工具结果: sessionId={}, callId={}", result.sessionId(), result.callId());
            return;
        }
        if (sessionResults.isEmpty()) {
            pendingResults.remove(result.sessionId(), sessionResults);
        }
        sink.success(new ToolResult(result.result().ok(), result.result().message(), result.result().data()));
    }

    /**
     * 转发Java已注册的画布前端工具并等待执行结果。
     *
     * @param userId Long 用户ID
     * @param sessionId String Agent会话ID
     * @param callId String 工具调用ID
     * @param toolName String 画布工具名
     * @param arguments Map<String, Object> 已校验工具参数
     * @return Mono<ToolResult> 前端工具执行结果
     */
    public Mono<ToolResult> executeFrontendTool(Long userId, String sessionId, String callId,
                                                String toolName, Map<String, Object> arguments) {
        if (!toolRegistry.isFrontend(toolName)) {
            return Mono.just(new ToolResult(false, "不支持的画布前端工具: " + toolName));
        }
        return waitForFrontendResult(userId, sessionId, callId, toolName, arguments);
    }

    /**
     * 保留旧方法签名兼容 AiTaskService 调用，AgentScope 上下文在此集中接入。
     *
     * @param taskId  String 任务ID
     * @param request CreateAiTaskRequest 创建任务请求
     */
    public void prepareTask(String taskId, AiTaskDtos.CreateAiTaskRequest request) {
        // 当前版本保持外部接口稳定
    }

    // ===== Agent Loop =====

    /**
     * 执行 Agent Loop：解析文本渠道，构建初始消息，逐步执行。
     * 如果请求中指定了模型（channelId::model 编码），按指定渠道解析；否则自动选择第一个可用渠道。
     */
    private Mono<Void> runAgentLoop(Long userId, AgentSession session, AgentLoopProfile profile, AgentChatRequest request) {
        log.info("Agent Loop 模型选择: profile={}, requestModel={}, sessionId={}", profile.name(), request.model(), session.id());
        Mono<ResolvedTextModel> textModelMono = StringUtils.hasText(request.model())
            ? resolveChannelByModel(request.model())
            : resolveChannel(AiTaskTypes.TEXT);
        return textModelMono.flatMap(textModel -> profile.buildMessages(userId, session, request)
            .flatMap(messages -> executeStep(session.id(), userId, profile, textModel, messages, request.attachments(), 1)
                .doFinally(signal -> sessionService.persist(session).subscribe()))
        ).onErrorResume(e -> {
            if (executionRegistry.isCancelRequested(session.id())) {
                log.info("Agent Loop 已停止，忽略连接关闭异常: sessionId={}", session.id());
                return Mono.empty();
            }
            log.error("Agent Loop 初始化失败: sessionId={}", session.id(), e);
            eventEmitter.emit(userId, AgentEvent.error(session.id(), e.getMessage()));
            return Mono.empty();
        });
    }

    /**
     * 执行单步 Agent Loop
     *
     * @param sessionId String 会话ID
     * @param userId   Long 用户ID
     * @param textModel ResolvedTextModel 已解析文本模型
     * @param messages List<AiMessage> 当前消息列表
     * @param attachments List<Attachment> 当前请求上传的媒体附件
     * @param step     int 当前步数
     * @return Mono<Void>
     */
    private Mono<Void> executeStep(String sessionId, Long userId, AgentLoopProfile profile, ResolvedTextModel textModel,
                                   List<AiMessage> messages, List<AgentChatRequest.Attachment> attachments, int step) {
        if (step > profile.maxSteps()) {
            log.info("Agent Loop 达到步数上限: sessionId={}", sessionId);
            return Mono.empty();
        }
        log.info("Agent Loop 第{}步: sessionId={}, profile={}", step, sessionId, profile.name());

        String assistantId = UUID.randomUUID().toString();
        Consumer<String> textDeltaConsumer = delta -> {
            if (StringUtils.hasText(delta)) {
                eventEmitter.emit(userId, AgentEvent.textDelta(sessionId, assistantId, delta));
            }
        };
        return callAiApi(textModel, profile, messages, step == 1, textDeltaConsumer)
            .flatMap(response -> {
                if (response.toolCalls().isEmpty()) {
                    eventEmitter.emit(userId, AgentEvent.taskComplete(sessionId, assistantId, response.text()));
                    return sessionService.appendAssistantMessage(sessionId, assistantId, response.text());
                }

                return executeToolCalls(sessionId, userId, profile, textModel, messages, attachments, response, step, assistantId);
            })
            .onErrorResume(e -> {
                if (executionRegistry.isCancelRequested(sessionId)) {
                    log.info("Agent Loop 已停止，忽略连接关闭异常: sessionId={}, step={}", sessionId, step);
                    return Mono.empty();
                }
                log.error("Agent Loop 第{}步失败: sessionId={}", step, sessionId, e);
                eventEmitter.emit(userId, AgentEvent.error(sessionId, e.getMessage()));
                return Mono.empty();
            });
    }

    /**
     * 执行 AI 返回的所有工具调用，收集结果后继续下一轮 Loop。
     * <p>
     * Generation profile 工具执行完直接结束（shouldContinueAfterToolResults=false），
     * 避免多余的 LLM 回调。
     */
    private Mono<Void> executeToolCalls(String sessionId, Long userId, AgentLoopProfile profile,
                                         ResolvedTextModel textModel, List<AiMessage> messages,
                                         List<AgentChatRequest.Attachment> attachments,
                                         AiResponse response, int step, String assistantId) {
        AiTaskDtos.AiChannelConfig channel = textModel.channel();
        AiResponse promptAppliedResponse = applyOriginalPromptToTerminalTools(profile, response, messages);
        AiResponse effectiveResponse = applyGenerationRoundIdsToTerminalTools(profile, sessionId, promptAppliedResponse);
        return Flux.fromIterable(effectiveResponse.toolCalls())
            .concatMap(toolCall -> executeSingleTool(sessionId, userId, profile, toolCall, attachments))
            .collectList()
            .flatMap(results -> {
                // 检查当前批次的所有工具是否都是终态工具
                boolean allTerminal = effectiveResponse.toolCalls().stream()
                        .allMatch(tc -> profile.isTerminalTool(tc.function().name()));
                if (allTerminal) {
                    // 全部是终态工具：保存生成记录，发送 task-complete，结束循环
                    String summary = buildToolResultSummary(results, effectiveResponse.text());
                    // task-complete 事件必须在保存完成后才发送，否则前端 refreshConversations 会读到旧数据
                    return saveGenerationRound(sessionId, userId, effectiveResponse, results, attachments)
                            .doOnSuccess(v -> eventEmitter.emit(userId, AgentEvent.taskComplete(sessionId, assistantId, summary)))
                            .onErrorResume(e -> {
                                log.warn("保存生成记录失败: sessionId={}", sessionId, e);
                                eventEmitter.emit(userId, AgentEvent.taskComplete(sessionId, assistantId, summary));
                                return Mono.empty();
                            })
                            .then(persistToolMessages(sessionId, assistantId, effectiveResponse, results, channel.apiFormat()));
                }
                // 存在非终态工具（如 query_history）：将结果喂回 LLM 继续对话
                List<AiMessage> nextMessages = appendToolResults(messages, effectiveResponse, results, channel.apiFormat());
                return executeStep(sessionId, userId, profile, textModel, nextMessages, attachments, step + 1);
            });
    }

    /**
     * 用本轮用户原始输入覆盖终态生成工具的 prompt。
     * <p>
     * 文本 Agent 只负责选择工具和参数，不能改写用户实际提交给生图/生视频模型的提示词。
     *
     * @param profile AgentLoopProfile 当前 Profile
     * @param response AiResponse 模型响应
     * @param messages List<AiMessage> 当前消息列表
     * @return AiResponse 处理后的响应
     */
    private AiResponse applyOriginalPromptToTerminalTools(AgentLoopProfile profile, AiResponse response, List<AiMessage> messages) {
        if (!("generation".equals(profile.name()) || "video".equals(profile.name()))) {
            return response;
        }
        String originalPrompt = latestUserPrompt(messages);
        if (!StringUtils.hasText(originalPrompt) || response.toolCalls().isEmpty()) {
            return response;
        }
        List<ToolCall> toolCalls = response.toolCalls().stream()
                .map(call -> withOriginalPrompt(profile, call, originalPrompt))
                .toList();
        return new AiResponse(response.text(), toolCalls);
    }

    /**
     * 将生成类终态工具调用绑定到当前请求的服务端轮次ID。
     * <p>
     * 上游模型返回的工具调用ID只用于单次响应关联，不能作为跨轮持久化主键；同批多个工具
     * 使用服务端轮次ID派生子ID，确保图片和视频多轮对话都不会覆盖历史轮次。
     *
     * @param profile AgentLoopProfile 当前 Profile
     * @param sessionId String Agent会话ID
     * @param response AiResponse 模型响应
     * @return AiResponse 使用服务端轮次ID后的响应
     */
    private AiResponse applyGenerationRoundIdsToTerminalTools(AgentLoopProfile profile, String sessionId, AiResponse response) {
        if (!GENERATION_PROFILE_NAMES.contains(profile.name())) {
            return response;
        }
        if (response.toolCalls().isEmpty()) {
            return response;
        }
        String roundId = generationRoundIds.get(sessionId);
        if (!StringUtils.hasText(roundId)) {
            throw new BusinessException(ErrorCode.BUSINESS_ERROR, "生成轮次ID不存在");
        }
        List<ToolCall> toolCalls = new ArrayList<>();
        int terminalToolIndex = 0;
        for (ToolCall call : response.toolCalls()) {
            if (isPromptPassthroughTool(call.function().name()) && profile.isTerminalTool(call.function().name())) {
                String toolRoundId = terminalToolIndex == 0
                        ? roundId : roundId + "-tool-" + (terminalToolIndex + 1);
                toolCalls.add(new ToolCall(toolRoundId, call.function()));
                terminalToolIndex++;
            } else {
                toolCalls.add(call);
            }
        }
        return terminalToolIndex > 0 ? new AiResponse(response.text(), toolCalls) : response;
    }

    /**
     * 覆盖单个终态工具调用的 prompt。
     *
     * @param profile AgentLoopProfile 当前 Profile
     * @param call ToolCall 工具调用
     * @param originalPrompt String 用户原始提示词
     * @return ToolCall 处理后的工具调用
     */
    private ToolCall withOriginalPrompt(AgentLoopProfile profile, ToolCall call, String originalPrompt) {
        if (!isPromptPassthroughTool(call.function().name()) || !profile.isTerminalTool(call.function().name())) {
            return call;
        }
        Map<String, Object> args = parseArguments(call.function().arguments());
        if (!args.containsKey("prompt")) {
            return call;
        }
        args.put("prompt", originalPrompt);
        return new ToolCall(call.id(), new ToolCallFunction(call.function().name(), JSON.toJSONString(args)));
    }

    /**
     * 判断工具是否需要直传用户输入框原始提示词。
     *
     * @param toolName String 工具名称
     * @return boolean 是否直传原始提示词
     */
    private boolean isPromptPassthroughTool(String toolName) {
        return Set.of("generate_image", "edit_image", "generate_video", "edit_video").contains(toolName);
    }

    /**
     * 提取本轮用户原始提示词。
     *
     * @param messages List<AiMessage> 当前消息列表
     * @return String 用户原始提示词
     */
    private String latestUserPrompt(List<AiMessage> messages) {
        for (int index = messages.size() - 1; index >= 0; index--) {
            AiMessage message = messages.get(index);
            if ("user".equals(message.role())) {
                return normalizeUserPrompt(message.content());
            }
        }
        return "";
    }

    /**
     * 去除前端附加的用户设置和参考文件说明，保留用户输入框原文。
     *
     * @param content String 用户消息内容
     * @return String 用户输入框原文
     */
    private String normalizeUserPrompt(String content) {
        String text = content == null ? "" : content.trim();
        text = text.replaceFirst("\\n\\[用户上传了 \\d+ 个参考文件\\]$", "").trim();
        if (text.startsWith("[用户设置：")) {
            int separatorIndex = text.indexOf("\n\n");
            if (separatorIndex >= 0) {
                return text.substring(separatorIndex + 2).trim();
            }
            int closeIndex = text.indexOf(']');
            if (closeIndex >= 0 && closeIndex + 1 < text.length()) {
                return text.substring(closeIndex + 1).trim();
            }
        }
        return text;
    }

    /** 从工具执行结果构建摘要文本（不使用 LLM 的预执行文本，避免与 textDelta 重复） */
    private String buildToolResultSummary(List<ToolResult> results, String llmText) {
        return results.stream()
            .map(ToolResult::message)
            .reduce((a, b) -> a + "；" + b)
            .orElse("完成");
    }

    /**
     * 从工具调用和结果构建终态生成轮次，并按首个工具调用ID更新 generation_log。
     *
     * @param sessionId String Agent会话ID
     * @param userId Long 用户ID
     * @param response AiResponse AI工具调用响应
     * @param results List<ToolResult> 工具执行结果
     * @param attachments List<Attachment> 当前请求上传的媒体附件
     * @return Mono<Void> 保存结果
     */
    private Mono<Void> saveGenerationRound(String sessionId, Long userId, AiResponse response, List<ToolResult> results,
                                           List<AgentChatRequest.Attachment> attachments) {
        // 从第一个工具调用参数中提取 prompt
        String firstToolName = response.toolCalls().isEmpty() ? "" : response.toolCalls().get(0).function().name();
        Map<String, Object> firstArgs = parseArguments(response.toolCalls().isEmpty() ? "{}" : response.toolCalls().get(0).function().arguments());
        String prompt = firstArgs.getOrDefault("prompt", "").toString();

        // 根据工具名确定记录类型
        String logType = firstToolName.contains("video") ? "video" : "image";

        // 构建 results 数组
        JSONArray resultArray = new JSONArray();
        for (int i = 0; i < response.toolCalls().size() && i < results.size(); i++) {
            ToolResult result = results.get(i);
            JSONObject resultJson = new JSONObject();
            resultJson.put("id", response.toolCalls().get(i).id());
            Object taskId = result.data() != null ? result.data().get("taskId") : null;
            if (taskId != null) {
                resultJson.put("taskId", taskId.toString());
            }
            resultJson.put("progress", 100);
            JSONObject mediaJson = result.ok() && result.data() != null ? buildImageFromResultData(result.data()) : null;
            boolean canceled = result.data() != null && Boolean.TRUE.equals(result.data().get("canceled"));
            boolean successfulWithMedia = result.ok() && mediaJson != null;
            resultJson.put("status", canceled ? "canceled" : successfulWithMedia ? "success" : "failed");
            if (result.ok() && result.data() != null) {
                // 从 result data 中提取媒体信息，按任务类型使用对应的 result key
                if (mediaJson != null) {
                    resultJson.put(logType, mediaJson);
                }
            }
            if (!successfulWithMedia) {
                resultJson.put("error", canceled ? "已停止生成" : result.ok() ? "生成结果缺少媒体" : result.message());
            }
            resultArray.add(resultJson);
        }

        // 构建 config
        JSONObject configJson = new JSONObject();
        configJson.put("model", firstArgs.getOrDefault("model", "").toString());
        configJson.put("size", firstArgs.getOrDefault("size", "1:1").toString());
        configJson.put("quality", firstArgs.getOrDefault("quality", "high").toString());
        Object countObj = firstArgs.get("count");
        configJson.put("count", countObj instanceof Number ? ((Number) countObj).intValue() : 1);

        // 构建 round（包含 LLM 回复文本，供历史对话视图展示）
        JSONObject round = new JSONObject();
        round.put("id", response.toolCalls().getFirst().id());
        if (!resultArray.isEmpty() && resultArray.getJSONObject(0).containsKey("taskId")) {
            round.put("taskId", resultArray.getJSONObject(0).getString("taskId"));
        }
        round.put("prompt", prompt);
        round.put("assistantText", response.text() != null ? response.text() : "");
        round.put("config", configJson);
        round.put("results", resultArray);
        round.put("references", attachmentReferences(attachments, "image/"));
        round.put("videoReferences", attachmentReferences(attachments, "video/"));
        round.put("createdAt", System.currentTimeMillis());

        String title = prompt.length() > 30 ? prompt.substring(0, 30) : prompt;
        return persistenceService.saveOrUpdateGenerationRound(userId, sessionId, logType, title, round);
    }

    /**
     * 将上传附件投影为可恢复的生成记录引用。
     * <p>
     * 记录只保存媒体存储键，不保存或信任客户端传入的远程地址；前端恢复记录时会按存储键重新解析访问地址。
     *
     * @param attachments List<Attachment> 当前请求上传的附件
     * @param mimeTypePrefix String 需要保留的MIME类型前缀
     * @return JSONArray 生成记录中的媒体引用数组
     */
    private JSONArray attachmentReferences(List<AgentChatRequest.Attachment> attachments, String mimeTypePrefix) {
        JSONArray references = new JSONArray();
        if (attachments == null || attachments.isEmpty()) {
            return references;
        }
        for (AgentChatRequest.Attachment attachment : attachments) {
            if (!StringUtils.hasText(attachment.storageKey()) || !StringUtils.hasText(attachment.type())
                    || !attachment.type().startsWith(mimeTypePrefix)) {
                continue;
            }
            JSONObject reference = new JSONObject();
            reference.put("id", attachment.storageKey());
            reference.put("name", attachment.name());
            reference.put("mimeType", attachment.type());
            reference.put("storageKey", attachment.storageKey());
            if ("image/".equals(mimeTypePrefix)) {
                reference.put("dataUrl", "");
            } else {
                reference.put("url", "");
            }
            references.add(reference);
        }
        return references;
    }

    /** 从工具结果 data 中提取第一个媒体项的完整信息，兼容 items 数组和 item 单对象两种格式 */
    private JSONObject buildImageFromResultData(Map<String, Object> data) {
        Object firstItemObj = null;
        // 先查 items 数组
        Object itemsObj = data.get("items");
        if (itemsObj instanceof List<?> items && !items.isEmpty()) {
            firstItemObj = items.get(0);
        }
        // 再查 item 单对象（Agnes video 格式）
        if (firstItemObj == null) {
            firstItemObj = data.get("item");
        }
        if (!(firstItemObj instanceof Map<?, ?> firstItem)) return null;

        Object urlObj = firstItem.get("url");
        if (!(urlObj instanceof String url) || url.isBlank()) return null;

        JSONObject image = new JSONObject();
        image.put("id", data.getOrDefault("taskId", UUID.randomUUID().toString()));
        image.put("url", url);
        image.put("dataUrl", "");
        Object storageKey = firstItem.get("storageKey");
        image.put("storageKey", storageKey != null ? storageKey.toString() : "");
        image.put("width", toNumberOrZero(firstItem.get("width")));
        image.put("height", toNumberOrZero(firstItem.get("height")));
        image.put("bytes", toNumberOrZero(firstItem.get("bytes")));
        image.put("durationMs", toNumberOrZero(firstItem.get("durationMs")));
        Object mimeType = firstItem.get("mimeType");
        if (mimeType != null) image.put("mimeType", mimeType.toString());
        return image;
    }

    private int toNumberOrZero(Object value) {
        return value instanceof Number n ? n.intValue() : 0;
    }

    /** 将工具调用和结果以 API 原生 JSON 格式持久化到会话消息，供续对话时还原 tool_use 结构 */
    private Mono<Void> persistToolMessages(String sessionId, String assistantId,
                                            AiResponse response, List<ToolResult> results, String apiFormat) {
        boolean isAnthropic = "anthropic".equalsIgnoreCase(apiFormat);

        // 助手消息：以 API 原生格式存储（与 appendToolResults 一致）
        List<Map<String, Object>> assistantBlocks = new ArrayList<>();
        for (ToolCall call : response.toolCalls()) {
            Map<String, Object> block = new LinkedHashMap<>();
            if (isAnthropic) {
                block.put("type", "tool_use");
                block.put("id", call.id());
                block.put("name", call.function().name());
                block.put("input", parseArguments(call.function().arguments()));
            } else {
                block.put("type", "function_call");
                block.put("id", call.id());
                block.put("name", call.function().name());
                block.put("arguments", call.function().arguments());
            }
            assistantBlocks.add(block);
        }
        Map<String, Object> assistantWrapper = new LinkedHashMap<>();
        assistantWrapper.put("role", "assistant");
        assistantWrapper.put("content", assistantBlocks);
        String assistantText = JSON.toJSONString(assistantWrapper);

        return sessionService.appendAssistantMessage(sessionId, assistantId, assistantText)
            .then(Flux.fromIterable(response.toolCalls())
                .concatMap(toolCall -> {
                    int idx = response.toolCalls().indexOf(toolCall);
                    ToolResult result = idx < results.size() ? results.get(idx)
                        : new ToolResult(false, "无结果");
                    Map<String, Object> toolWrapper = new LinkedHashMap<>();
                    toolWrapper.put("role", "tool");
                    if (isAnthropic) {
                        toolWrapper.put("tool_use_id", toolCall.id());
                    } else {
                        toolWrapper.put("tool_call_id", toolCall.id());
                    }
                    toolWrapper.put("content", buildToolResultContent(result));
                    AgentMessage toolMsg = new AgentMessage(
                        UUID.randomUUID().toString(), "tool",
                        JSON.toJSONString(toolWrapper), null,
                        toolCall.function().name(),
                        toolCall.function().arguments(),
                        buildToolResultContent(result),
                        null, null, null);
                    return sessionService.appendMessage(sessionId, toolMsg);
                }).then());
    }

    // ===== 工具执行 =====

    /**
     * 执行单个工具调用。根据工具类型选择后端执行或 SSE 转发前端。
     *
     * @param sessionId String 会话ID
     * @param userId   Long 用户ID
     * @param call     ToolCall 工具调用
     * @param attachments List<Attachment> 当前请求上传的媒体附件
     * @return Mono<ToolResult> 工具执行结果
     */
    private Mono<ToolResult> executeSingleTool(String sessionId, Long userId, AgentLoopProfile profile, ToolCall call,
                                                List<AgentChatRequest.Attachment> attachments) {
        String toolName = call.function().name();
        Map<String, Object> args = parseArguments(call.function().arguments());
        log.info("执行工具: sessionId={}, profile={}, tool={}", sessionId, profile.name(), toolName);

        // 读操作工具：后端直接处理（仅 canvas profile 使用）
        if (READ_TOOLS.contains(toolName)) {
            return Mono.just(executeReadTool(toolName));
        }

        // 后端工具由服务端直接执行，也要先通知前端创建执行中的工具卡片。
        if (!profile.isFrontendTool(toolName)) {
            String callId = call.id();
            eventEmitter.emit(userId, AgentEvent.toolExecute(sessionId, callId, toolName, args));
            String originalPrompt = String.valueOf(args.getOrDefault("prompt", ""));
            return profile.executeTool(userId, toolName, args, originalPrompt, attachments,
                    eventEmitter, sessionId, callId)
                .flatMap(result -> {
                    eventEmitter.emit(userId, AgentEvent.toolResult(
                            sessionId, callId, result.ok(), result.message(), result.data()));
                    if (!profile.isTerminalTool(toolName)) {
                        return Mono.just(result);
                    }
                    return eventEmitter.persistRoundActivities(userId, sessionId, callId).thenReturn(result);
                });
        }

        // 前端画布操作工具：通过 SSE 发送，等待前端回传结果
        String callId = call.id();
        return waitForFrontendResult(userId, sessionId, callId, toolName, args);
    }

    /**
     * 阻塞等待前端工具执行结果，使用 Mono.create + MonoSink 实现跨请求的异步等待
     *
     * @param userId Long 用户ID
     * @param sessionId String 会话ID
     * @param callId String 工具调用ID
     * @param toolName String 工具名称
     * @param args Map 工具参数
     * @return Mono<ToolResult> 工具执行结果
     */
    private Mono<ToolResult> waitForFrontendResult(Long userId, String sessionId, String callId,
                                                    String toolName, Map<String, Object> args) {
        return Mono.<ToolResult>create(sink -> {
            pendingResults.computeIfAbsent(sessionId, k -> new ConcurrentHashMap<>()).put(callId, sink);
            // 先登记等待项再发送事件，避免前端快速回传时找不到session或callId。
            eventEmitter.emit(userId, AgentEvent.toolExecute(sessionId, callId, toolName, args));
            // 超时或取消时清理 pendingResults 映射
            sink.onDispose(() -> {
                ConcurrentHashMap<String, MonoSink<ToolResult>> sessionResults = pendingResults.get(sessionId);
                if (sessionResults != null) {
                    sessionResults.remove(callId);
                    if (sessionResults.isEmpty()) {
                        pendingResults.remove(sessionId, sessionResults);
                    }
                }
            });
        }).timeout(Duration.ofSeconds(30))
          .onErrorResume(e -> Mono.just(new ToolResult(false, "前端工具执行超时: " + e.getMessage())));
    }

    /**
     * 执行读操作工具，返回快照说明文本
     *
     * @param name String 工具名
     * @return ToolResult 工具结果
     */
    private ToolResult executeReadTool(String name) {
        return switch (name) {
            case "canvas_export_snapshot" -> new ToolResult(true, "画布快照已导出，参考当前画布JSON");
            case "canvas_get_state" -> new ToolResult(true, "画布状态已读取，参考当前画布JSON");
            case "canvas_get_selection" -> new ToolResult(true, "已读取当前选中节点");
            default -> new ToolResult(false, "未知读工具: " + name);
        };
    }

    // ===== 渠道解析 =====

    /**
     * 调用 AI 接口，根据渠道 apiFormat 自动选择端点。
     * OpenAI兼容渠道统一使用 Chat Completions API (/chat/completions)。
     *
     * @param textModel   ResolvedTextModel 已解析文本模型
     * @param profile     AgentLoopProfile 当前Agent配置
     * @param messages    List<AiMessage> 消息列表
     * @param requireTool boolean 是否强制工具调用
     * @param textDeltaConsumer Consumer<String> 文本增量消费者
     * @return Mono<AiResponse> AI 响应
     */
    private Mono<AiResponse> callAiApi(ResolvedTextModel textModel, AgentLoopProfile profile, List<AiMessage> messages,
                                       boolean requireTool, Consumer<String> textDeltaConsumer) {
        AiTaskDtos.AiChannelConfig channel = textModel.channel();
        if ("openai".equalsIgnoreCase(channel.apiFormat())) {
            return callStreamingChatCompletionsApi(channel, profile, messages, requireTool, textDeltaConsumer,
                    new ThinkingConfiguration(textModel.thinkingEnabled(), textModel.reasoningEffort()));
        }
        if ("anthropic".equalsIgnoreCase(channel.apiFormat())) {
            return callStreamingAnthropicMessagesApi(channel, profile, messages, requireTool, textDeltaConsumer);
        }
        return callStreamingChatCompletionsApi(channel, profile, messages, requireTool, textDeltaConsumer, null);
    }

    /**
     * 非流式调用Chat Completions接口。
     *
     * @param channel AiChannelConfig 文本模型渠道
     * @param profile AgentLoopProfile 当前Agent配置
     * @param messages List<AiMessage> 当前消息列表
     * @param requireTool boolean 是否强制工具调用
     * @param thinkingConfiguration ThinkingConfiguration OpenAI兼容渠道思考配置
     * @return Mono<AiResponse> AI响应
     */
    private Mono<AiResponse> callChatCompletionsApi(AiTaskDtos.AiChannelConfig channel, AgentLoopProfile profile, List<AiMessage> messages,
                                                     boolean requireTool, ThinkingConfiguration thinkingConfiguration) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("model", firstModel(channel));
        body.put("messages", messages.stream().map(this::toChatMessage).toList());
        body.put("tools", toApiTools(profile.tools()));
        body.put("tool_choice", requireTool ? "required" : "auto");
        applyThinkingConfiguration(body, thinkingConfiguration);
        return aiHttpClient.sendJsonRequest(channel, "POST", "/chat/completions", body)
            .map(this::parseChatCompletionsResponse);
    }

    private Mono<AiResponse> callAnthropicMessagesApi(AiTaskDtos.AiChannelConfig channel, AgentLoopProfile profile, List<AiMessage> messages, boolean requireTool) {
        String systemPrompt = messages.stream()
            .filter(m -> "system".equals(m.role()))
            .map(AiMessage::content)
            .findFirst().orElse("");
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("model", firstModel(channel));
        body.put("max_tokens", 4096);
        if (StringUtils.hasText(systemPrompt)) {
            body.put("system", systemPrompt);
        }
        body.put("messages", messages.stream()
            .filter(m -> !"system".equals(m.role()))
            .map(this::toAnthropicMessage).toList());
        body.put("tools", toAnthropicTools(profile.tools()));
        body.put("tool_choice", Map.of("type", requireTool ? "any" : "auto"));
        return aiHttpClient.sendAnthropicJsonRequest(channel, "/v1/messages", body)
            .map(this::parseAnthropicResponse);
    }

    /**
     * 流式调用Chat Completions接口并聚合最终响应。
     *
     * @param channel AiChannelConfig 文本模型渠道
     * @param profile AgentLoopProfile 当前Agent配置
     * @param messages List<AiMessage> 当前消息列表
     * @param requireTool boolean 是否强制工具调用
     * @param textDeltaConsumer Consumer<String> 文本增量消费者
     * @param thinkingConfiguration ThinkingConfiguration OpenAI兼容渠道思考配置
     * @return Mono<AiResponse> AI响应
     */
    private Mono<AiResponse> callStreamingChatCompletionsApi(AiTaskDtos.AiChannelConfig channel, AgentLoopProfile profile,
                                                              List<AiMessage> messages, boolean requireTool, Consumer<String> textDeltaConsumer,
                                                              ThinkingConfiguration thinkingConfiguration) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("model", firstModel(channel));
        body.put("messages", messages.stream().map(this::toChatMessage).toList());
        body.put("tools", toApiTools(profile.tools()));
        body.put("tool_choice", requireTool ? "required" : "auto");
        applyThinkingConfiguration(body, thinkingConfiguration);
        body.put("stream", true);
        ChatStreamAccumulator accumulator = new ChatStreamAccumulator(textDeltaConsumer);
        return aiHttpClient.sendStreamingJsonRequest(channel, "/chat/completions", body)
                .takeUntil("[DONE]"::equals)
                .filter(data -> !"[DONE]".equals(data))
                .doOnNext(accumulator::accept)
                .then(Mono.fromSupplier(accumulator::response))
                .onErrorResume(error -> fallbackWhenStreamingUnsupported(error,
                        callChatCompletionsApi(channel, profile, messages, requireTool, thinkingConfiguration), textDeltaConsumer, channel));
    }

    /**
     * 写入OpenAI兼容文本调用的思考参数。
     *
     * @param body Map<String, Object> 请求体
     * @param configuration ThinkingConfiguration 思考配置，非OpenAI调用时为null
     * @return void 无返回值
     */
    private void applyThinkingConfiguration(Map<String, Object> body, ThinkingConfiguration configuration) {
        if (configuration == null) {
            return;
        }
        body.put("thinking", Map.of("type", configuration.enabled() ? "enabled" : "disabled"));
        if (configuration.enabled()) {
            body.put("reasoning_effort", configuration.reasoningEffort());
        }
    }

    /** 流式调用Anthropic Messages API并聚合最终响应。 */
    private Mono<AiResponse> callStreamingAnthropicMessagesApi(AiTaskDtos.AiChannelConfig channel, AgentLoopProfile profile,
                                                                List<AiMessage> messages, boolean requireTool, Consumer<String> textDeltaConsumer) {
        String systemPrompt = messages.stream().filter(message -> "system".equals(message.role()))
                .map(AiMessage::content).findFirst().orElse("");
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("model", firstModel(channel));
        body.put("max_tokens", 4096);
        if (StringUtils.hasText(systemPrompt)) body.put("system", systemPrompt);
        body.put("messages", messages.stream().filter(message -> !"system".equals(message.role())).map(this::toAnthropicMessage).toList());
        body.put("tools", toAnthropicTools(profile.tools()));
        body.put("tool_choice", Map.of("type", requireTool ? "any" : "auto"));
        body.put("stream", true);
        AnthropicStreamAccumulator accumulator = new AnthropicStreamAccumulator(textDeltaConsumer);
        return aiHttpClient.sendAnthropicStreamingRequest(channel, "/v1/messages", body)
                .doOnNext(accumulator::accept)
                .then(Mono.fromSupplier(accumulator::response))
                .onErrorResume(error -> fallbackWhenStreamingUnsupported(error,
                        callAnthropicMessagesApi(channel, profile, messages, requireTool), textDeltaConsumer, channel));
    }

    /** 仅在上游明确拒绝流式参数时使用非流式兼容路径。 */
    private Mono<AiResponse> fallbackWhenStreamingUnsupported(Throwable error, Mono<AiResponse> fallback,
                                                               Consumer<String> textDeltaConsumer, AiTaskDtos.AiChannelConfig channel) {
        String message = error.getMessage() == null ? "" : error.getMessage().toLowerCase();
        boolean unsupported = message.contains("stream") && (message.contains("unsupported") || message.contains("not support")
                || message.contains("不支持") || message.contains("unknown parameter"));
        if (!unsupported) return Mono.error(error);
        log.warn("渠道不支持流式响应，使用非流式兼容路径: channelId={}", channel.id());
        return fallback.doOnNext(response -> {
            if (StringUtils.hasText(response.text())) textDeltaConsumer.accept(response.text());
        });
    }

    /** 工具调用增量聚合器。 */
    private static final class MutableToolCall {
        private String id = "";
        private String name = "";
        private final StringBuilder arguments = new StringBuilder();

        private ToolCall toToolCall() {
            return new ToolCall(id, new ToolCallFunction(name, arguments.isEmpty() ? "{}" : arguments.toString()));
        }
    }

    /** Chat Completions流聚合器。 */
    private static final class ChatStreamAccumulator {
        private final Consumer<String> textDeltaConsumer;
        private final StringBuilder text = new StringBuilder();
        private final Map<Integer, MutableToolCall> toolCalls = new LinkedHashMap<>();

        private ChatStreamAccumulator(Consumer<String> textDeltaConsumer) { this.textDeltaConsumer = textDeltaConsumer; }

        private void accept(String data) {
            JSONObject payload = JSON.parseObject(data);
            JSONObject error = payload.getJSONObject("error");
            if (error != null) {
                throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR, error.getString("message"));
            }
            JSONArray choices = payload.getJSONArray("choices");
            if (choices == null || choices.isEmpty()) return;
            JSONObject delta = choices.getJSONObject(0).getJSONObject("delta");
            if (delta == null) return;
            String content = delta.getString("content");
            if (content != null) { text.append(content); textDeltaConsumer.accept(content); }
            JSONArray calls = delta.getJSONArray("tool_calls");
            if (calls == null) return;
            for (int index = 0; index < calls.size(); index++) {
                JSONObject item = calls.getJSONObject(index);
                int callIndex = item.getIntValue("index", index);
                MutableToolCall call = toolCalls.computeIfAbsent(callIndex, ignored -> new MutableToolCall());
                if (StringUtils.hasText(item.getString("id"))) call.id = item.getString("id");
                JSONObject function = item.getJSONObject("function");
                if (function != null) {
                    if (StringUtils.hasText(function.getString("name"))) call.name += function.getString("name");
                    if (function.getString("arguments") != null) call.arguments.append(function.getString("arguments"));
                }
            }
        }

        private AiResponse response() { return new AiResponse(text.toString(), toolCalls.values().stream().map(MutableToolCall::toToolCall).toList()); }
    }

    /** Anthropic Messages流聚合器。 */
    private static final class AnthropicStreamAccumulator {
        private final Consumer<String> textDeltaConsumer;
        private final StringBuilder text = new StringBuilder();
        private final Map<Integer, MutableToolCall> toolCalls = new LinkedHashMap<>();

        private AnthropicStreamAccumulator(Consumer<String> textDeltaConsumer) { this.textDeltaConsumer = textDeltaConsumer; }

        private void accept(AiHttpClient.AnthropicStreamEvent streamEvent) {
            JSONObject data = streamEvent.data();
            if ("error".equals(streamEvent.event())) {
                JSONObject error = data.getJSONObject("error");
                throw new BusinessException(ErrorCode.THIRD_PARTY_CALL_ERROR,
                        error == null ? "Anthropic流式响应失败" : error.getString("message"));
            }
            if ("content_block_start".equals(streamEvent.event())) {
                JSONObject block = data.getJSONObject("content_block");
                if (block != null && "tool_use".equals(block.getString("type"))) {
                    MutableToolCall call = toolCalls.computeIfAbsent(data.getIntValue("index"), ignored -> new MutableToolCall());
                    call.id = block.getString("id"); call.name = block.getString("name");
                }
            }
            if (!"content_block_delta".equals(streamEvent.event())) return;
            JSONObject delta = data.getJSONObject("delta");
            if (delta == null) return;
            if ("text_delta".equals(delta.getString("type"))) {
                String value = delta.getString("text");
                if (value != null) { text.append(value); textDeltaConsumer.accept(value); }
            } else if ("input_json_delta".equals(delta.getString("type"))) {
                toolCalls.computeIfAbsent(data.getIntValue("index"), ignored -> new MutableToolCall()).arguments.append(delta.getString("partial_json"));
            }
        }

        private AiResponse response() { return new AiResponse(text.toString(), toolCalls.values().stream().map(MutableToolCall::toToolCall).toList()); }
    }

    private List<JSONObject> toApiTools(List<AgentTool> tools) {
        List<JSONObject> result = new ArrayList<>();
        for (AgentTool tool : tools) {
            JSONObject func = new JSONObject();
            func.put("type", "function");
            JSONObject funcDef = new JSONObject();
            funcDef.put("name", tool.name());
            funcDef.put("description", tool.description());
            funcDef.put("parameters", tool.parameters());
            func.put("function", funcDef);
            result.add(func);
        }
        return result;
    }

    private List<JSONObject> toAnthropicTools(List<AgentTool> tools) {
        List<JSONObject> result = new ArrayList<>();
        for (AgentTool tool : tools) {
            JSONObject t = new JSONObject();
            t.put("name", tool.name());
            t.put("description", tool.description());
            t.put("input_schema", tool.parameters());
            result.add(t);
        }
        return result;
    }

    /**
     * 将 AiMessage 转换为 Chat Completions API 消息体。
     * assistant 和 tool 角色的消息在 appendToolResults 中以 JSON 字符串存储，
     * 此方法负责解析并转换为 Chat Completions 所需的格式。
     *
     * @param msg AiMessage 消息
     * @return Map<String, Object> API 消息
     */
    private Map<String, Object> toChatMessage(AiMessage msg) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("role", msg.role());

        if ("assistant".equals(msg.role())) {
            // assistant 消息的 content 可能是 JSON 字符串（含 function_call 列表）
            try {
                JSONObject parsed = JSON.parseObject(msg.content());
                if (parsed != null && parsed.containsKey("content")) {
                    JSONArray contentArr = parsed.getJSONArray("content");
                    List<Map<String, Object>> toolCalls = new ArrayList<>();
                    if (contentArr != null) {
                        for (int i = 0; i < contentArr.size(); i++) {
                            JSONObject item = contentArr.getJSONObject(i);
                            if ("function_call".equals(item.getString("type"))) {
                                Map<String, Object> toolCall = new LinkedHashMap<>();
                                toolCall.put("id", item.getString("id"));
                                toolCall.put("type", "function");
                                Map<String, Object> function = new LinkedHashMap<>();
                                function.put("name", item.getString("name"));
                                function.put("arguments", item.getString("arguments"));
                                toolCall.put("function", function);
                                toolCalls.add(toolCall);
                            }
                        }
                    }
                    m.put("content", null);
                    if (!toolCalls.isEmpty()) {
                        m.put("tool_calls", toolCalls);
                    }
                    return m;
                }
            } catch (Exception ignored) {
                // content 不是 JSON，作为普通文本消息处理
            }
            m.put("content", msg.content());
            return m;
        }

        if ("tool".equals(msg.role())) {
            // tool 消息的 content 是 JSON 字符串，含 tool_call_id 和 content
            try {
                JSONObject parsed = JSON.parseObject(msg.content());
                if (parsed != null && parsed.containsKey("tool_call_id")) {
                    m.put("tool_call_id", parsed.getString("tool_call_id"));
                    m.put("content", parsed.getString("content"));
                    return m;
                }
            } catch (Exception ignored) {
                // content 不是 JSON，作为普通文本消息处理
            }
        }

        m.put("content", msg.content());
        return m;
    }

    /**
     * 将 AiMessage 转换为 Anthropic Messages API 消息体。
     * <p>
     * Anthropic 不支持 system 角色（由调用方单独处理）。
     * assistant 消息中的 tool_use 内容块需要从 JSON 字符串解析还原。
     * tool 消息转为 user 角色的 tool_result 内容块。
     *
     * @param msg AiMessage 消息
     * @return Map<String, Object> Anthropic API 消息
     */
    private Map<String, Object> toAnthropicMessage(AiMessage msg) {
        Map<String, Object> m = new LinkedHashMap<>();

        if ("assistant".equals(msg.role())) {
            // assistant 消息的 content 可能是 JSON 字符串（含 tool_use 列表）
            try {
                JSONObject parsed = JSON.parseObject(msg.content());
                if (parsed != null && parsed.containsKey("content")) {
                    JSONArray contentArr = parsed.getJSONArray("content");
                    if (contentArr != null) {
                        List<Map<String, Object>> blocks = new ArrayList<>();
                        for (int i = 0; i < contentArr.size(); i++) {
                            JSONObject item = contentArr.getJSONObject(i);
                            if ("tool_use".equals(item.getString("type"))) {
                                Map<String, Object> block = new LinkedHashMap<>();
                                block.put("type", "tool_use");
                                block.put("id", item.getString("id"));
                                block.put("name", item.getString("name"));
                                // Anthropic 要求 tool_use 必须保留 input 对象，兼容旧版 arguments 字符串。
                                block.put("input", readAnthropicToolInput(item));
                                blocks.add(block);
                            }
                        }
                        if (!blocks.isEmpty()) {
                            m.put("role", "assistant");
                            m.put("content", blocks);
                            return m;
                        }
                    }
                }
            } catch (Exception ignored) {
                // content 不是 JSON，作为普通文本消息处理
            }
            m.put("role", "assistant");
            m.put("content", msg.content());
            return m;
        }

        if ("tool".equals(msg.role())) {
            // tool 消息转为 Anthropic 的 user 角色 tool_result 内容块
            try {
                JSONObject parsed = JSON.parseObject(msg.content());
                if (parsed != null && parsed.containsKey("tool_use_id")) {
                    m.put("role", "user");
                    m.put("content", List.of(Map.of(
                        "type", "tool_result",
                        "tool_use_id", parsed.getString("tool_use_id"),
                        "content", parsed.getString("content") != null ? parsed.getString("content") : ""
                    )));
                    return m;
                }
            } catch (Exception ignored) {
                // content 不是 JSON，作为普通消息处理
            }
        }

        // user / 普通消息
        m.put("role", msg.role());
        m.put("content", msg.content());
        return m;
    }

    /**
     * 读取 Anthropic 工具调用入参。
     *
     * @param item JSONObject 工具调用内容块
     * @return Map<String, Object> Anthropic 工具入参对象
     */
    @SuppressWarnings("unchecked")
    private Map<String, Object> readAnthropicToolInput(JSONObject item) {
        Object input = item.get("input");
        if (input instanceof Map<?, ?> inputMap) {
            return (Map<String, Object>) inputMap;
        }
        if (input instanceof String inputText && StringUtils.hasText(inputText)) {
            return parseArguments(inputText);
        }
        return parseArguments(item.getString("arguments"));
    }

    /**
     * 解析 Chat Completions API 返回 JSON 为 AiResponse
     *
     * @param payload JSONObject AI 返回 JSON
     * @return AiResponse 解析结果
     */
    private AiResponse parseChatCompletionsResponse(JSONObject payload) {
        JSONArray choices = payload.getJSONArray("choices");
        if (choices == null || choices.isEmpty()) {
            return new AiResponse("", List.of());
        }
        JSONObject message = choices.getJSONObject(0).getJSONObject("message");
        String text = message.getString("content");

        List<ToolCall> toolCalls = new ArrayList<>();
        JSONArray tcs = message.getJSONArray("tool_calls");
        if (tcs != null) {
            for (int i = 0; i < tcs.size(); i++) {
                JSONObject tc = tcs.getJSONObject(i);
                JSONObject fn = tc.getJSONObject("function");
                toolCalls.add(new ToolCall(tc.getString("id"),
                    new ToolCallFunction(fn.getString("name"), fn.getString("arguments"))));
            }
        }
        return new AiResponse(text == null ? "" : text, toolCalls);
    }

    /**
     * 解析 Anthropic Messages API 返回 JSON 为 AiResponse
     * <p>
     * Anthropic 响应的 content 数组包含 text 和 tool_use 两种类型的内容块。
     * tool_use 块的 input 字段是 JSON 对象，需序列化为字符串存储到 ToolCallFunction.arguments。
     *
     * @param payload JSONObject Anthropic API 返回 JSON
     * @return AiResponse 解析结果
     */
    private AiResponse parseAnthropicResponse(JSONObject payload) {
        JSONArray content = payload.getJSONArray("content");
        StringBuilder text = new StringBuilder();
        List<ToolCall> toolCalls = new ArrayList<>();
        if (content != null) {
            for (int i = 0; i < content.size(); i++) {
                JSONObject block = content.getJSONObject(i);
                String type = block.getString("type");
                if ("text".equals(type)) {
                    text.append(block.getString("text"));
                } else if ("tool_use".equals(type)) {
                    // Anthropic 的 tool input 是 JSONObject，序列化为字符串以统一存储
                    JSONObject input = block.getJSONObject("input");
                    String arguments = input != null ? input.toJSONString() : "{}";
                    toolCalls.add(new ToolCall(block.getString("id"),
                        new ToolCallFunction(block.getString("name"), arguments)));
                }
            }
        }
        return new AiResponse(text.toString(), toolCalls);
    }

    // ===== 消息构建 =====
    // buildInitialMessages 已迁移到各 AgentLoopProfile.buildMessages() 中

    /**
     * 将工具调用和结果追加到消息列表，用于下一轮 Loop。
     * 根据 apiFormat 生成对应格式：Anthropic 使用 tool_use/tool_result，OpenAI 使用 function_call/tool_call_id。
     *
     * @param messages  List<AiMessage> 当前消息列表
     * @param response  AiResponse AI 响应
     * @param results   List<ToolResult> 工具执行结果
     * @param apiFormat String API 调用格式（anthropic / openai / 其他）
     * @return List<AiMessage> 追加后的消息列表
     */
    /**
     * 构建工具结果内容字符串，包含 message 和 data（如有）。
     * data 对 query_history 等工具至关重要——LLM 需要通过 data 获取实际数据。
     */
    private String buildToolResultContent(ToolResult result) {
        if (result.data() == null || result.data().isEmpty()) {
            return result.message();
        }
        Map<String, Object> content = new LinkedHashMap<>();
        content.put("message", result.message());
        content.put("data", result.data());
        return JSON.toJSONString(content);
    }

    private List<AiMessage> appendToolResults(List<AiMessage> messages, AiResponse response, List<ToolResult> results, String apiFormat) {
        List<AiMessage> next = new ArrayList<>(messages);

        if ("anthropic".equalsIgnoreCase(apiFormat)) {
            // Anthropic 格式：assistant 消息含 tool_use 内容块
            List<Map<String, Object>> contentBlocks = new ArrayList<>();
            for (ToolCall call : response.toolCalls()) {
                Map<String, Object> block = new LinkedHashMap<>();
                block.put("type", "tool_use");
                block.put("id", call.id());
                block.put("name", call.function().name());
                block.put("input", parseArguments(call.function().arguments()));
                contentBlocks.add(block);
            }
            Map<String, Object> assistantMsg = new LinkedHashMap<>();
            assistantMsg.put("role", "assistant");
            assistantMsg.put("content", contentBlocks);
            next.add(new AiMessage("assistant", JSON.toJSONString(assistantMsg)));

            // Anthropic 格式：tool 消息含 tool_use_id
            for (int i = 0; i < response.toolCalls().size(); i++) {
                ToolCall call = response.toolCalls().get(i);
                ToolResult result = i < results.size() ? results.get(i) : new ToolResult(false, "无结果");
                Map<String, Object> toolMsg = new LinkedHashMap<>();
                toolMsg.put("role", "tool");
                toolMsg.put("tool_use_id", call.id());
                toolMsg.put("content", buildToolResultContent(result));
                next.add(new AiMessage("tool", JSON.toJSONString(toolMsg)));
            }
        } else {
            // OpenAI/Chat Completions 格式
            Map<String, Object> assistantMsg = new LinkedHashMap<>();
            assistantMsg.put("role", "assistant");
            List<Map<String, Object>> content = new ArrayList<>();
            for (ToolCall call : response.toolCalls()) {
                Map<String, Object> toolCall = new LinkedHashMap<>();
                toolCall.put("type", "function_call");
                toolCall.put("id", call.id());
                toolCall.put("name", call.function().name());
                toolCall.put("arguments", call.function().arguments());
                content.add(toolCall);
            }
            assistantMsg.put("content", content);
            next.add(new AiMessage("assistant", JSON.toJSONString(assistantMsg)));

            for (int i = 0; i < response.toolCalls().size(); i++) {
                ToolCall call = response.toolCalls().get(i);
                ToolResult result = i < results.size() ? results.get(i) : new ToolResult(false, "无结果");
                Map<String, Object> toolMsg = new LinkedHashMap<>();
                toolMsg.put("role", "tool");
                toolMsg.put("tool_call_id", call.id());
                toolMsg.put("content", buildToolResultContent(result));
                next.add(new AiMessage("tool", JSON.toJSONString(toolMsg)));
            }
        }
        return next;
    }

    // ===== 渠道解析 =====

    /**
     * 解析支持指定能力且配置完整的全站AI渠道。
     *
     * @param capability String 能力：text/image/video
     * @return Mono<ResolvedTextModel> 文本模型配置
     */
    private Mono<ResolvedTextModel> resolveChannel(String capability) {
        return persistenceService.getPlatformModelConfigs()
                .flatMap(configs -> configs.stream()
                        .filter(config -> capability.equals(config.modelType()) && Boolean.TRUE.equals(config.defaultModel()))
                        .findFirst()
                        .map(config -> resolveChannelByModel(config.channelId() + "::" + config.modelName()))
                        .orElseGet(() -> Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "请联系管理员配置默认文本模型"))));
    }

    /**
     * 根据 channelId::model 编码精确解析渠道和模型。
     * 显式选择不可用时返回业务错误，避免使用未经用户确认的其他渠道。
     *
     * @param modelHint String channelId::model 编码
     * @return Mono<ResolvedTextModel> 文本模型配置
     */
    private Mono<ResolvedTextModel> resolveChannelByModel(String modelHint) {
        // 先校验模型在全站文本模型目录中启用，再读取对应的完整渠道连接信息。
        return Mono.zip(persistenceService.getPlatformModelConfigs(), persistenceService.getPlatformAiChannels())
                .flatMap(tuple -> {
                    List<PersistenceDtos.ModelConfig> textModels = tuple.getT1().stream()
                            .filter(config -> AiTaskTypes.TEXT.equals(config.modelType()))
                            .toList();
                    boolean hasDefaultModel = textModels.stream()
                            .filter(config -> Boolean.TRUE.equals(config.defaultModel()))
                            .anyMatch(config -> tuple.getT2().stream().anyMatch(channel -> config.channelId().equals(channel.id())
                                    && channel.models() != null
                                    && channel.models().contains(config.modelName())
                                    && StringUtils.hasText(channel.baseUrl())
                                    && StringUtils.hasText(channel.apiKey())
                                    && adapterRegistry.supports(channel, AiTaskTypes.TEXT)));
                    if (!hasDefaultModel) {
                        return Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "请联系管理员配置默认文本模型"));
                    }
                    return textModels.stream()
                            .filter(config -> modelHint.equals(config.channelId() + "::" + config.modelName()) || modelHint.equals(config.modelName()))
                            .findFirst()
                            .map(config -> tuple.getT2().stream()
                                    .filter(channel -> config.channelId().equals(channel.id())
                                            && channel.models() != null
                                            && channel.models().contains(config.modelName())
                                            && adapterRegistry.supports(channel, AiTaskTypes.TEXT))
                                    .findFirst()
                                    .map(channel -> Mono.just(new ResolvedTextModel(
                                            new AiTaskDtos.AiChannelConfig(channel.id(), channel.name(), channel.baseUrl(), channel.apiKey(), channel.apiFormat(), List.of(config.modelName())),
                                            thinkingEnabled(config.thinkingEnabled()), reasoningEffort(config.reasoningEffort()))))
                                    .orElseGet(() -> Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "请联系管理员完整配置文本模型渠道"))))
                            .orElseGet(() -> Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "所选文本模型未在管理员启用的模型中配置")));
                });
    }

    /**
     * 构造 channelId::model 编码值，供 AiTaskService 解析渠道和模型
     *
     * @param channel AiChannelConfig 渠道配置
     * @return String 编码值
     */
    private String channelModelValue(AiTaskDtos.AiChannelConfig channel) {
        return channel.id() + "::" + firstModel(channel);
    }

    /**
     * 规范化思考模式开关。
     *
     * @param enabled Boolean 模型配置中的开关
     * @return boolean 缺省时开启思考模式
     */
    private boolean thinkingEnabled(Boolean enabled) {
        return enabled == null || Boolean.TRUE.equals(enabled);
    }

    /**
     * 规范化思考强度。
     *
     * @param effort String 模型配置中的强度
     * @return String high或max
     */
    private String reasoningEffort(String effort) {
        return "max".equals(effort) ? "max" : "high";
    }

    /**
     * 已解析的文本模型及其思考配置。
     *
     * @param channel AiChannelConfig 文本模型渠道
     * @param thinkingEnabled boolean 是否开启思考模式
     * @param reasoningEffort String 思考强度
     */
    private record ResolvedTextModel(AiTaskDtos.AiChannelConfig channel, boolean thinkingEnabled, String reasoningEffort) {
    }

    /**
     * OpenAI兼容文本请求的思考参数。
     *
     * @param enabled boolean 是否开启思考模式
     * @param reasoningEffort String 思考强度
     */
    private record ThinkingConfiguration(boolean enabled, String reasoningEffort) {
    }

    /**
     * 读取渠道首个模型
     *
     * @param channel AiChannelConfig 渠道配置
     * @return String 模型名
     */
    private String firstModel(AiTaskDtos.AiChannelConfig channel) {
        return channel.models() != null && !channel.models().isEmpty() ? channel.models().get(0) : "";
    }

    /**
     * 判断渠道是否配置了模型
     *
     * @param channel AiChannelConfig 渠道配置
     * @return boolean 是否有模型
     */
    private boolean hasModel(AiTaskDtos.AiChannelConfig channel) {
        return channel.models() != null && !channel.models().isEmpty();
    }

    // ===== 参数解析 =====

    /**
     * 解析工具参数 JSON 字符串为 Map
     *
     * @param arguments String JSON 参数
     * @return Map<String, Object> 参数
     */
    @SuppressWarnings("unchecked")
    private Map<String, Object> parseArguments(String arguments) {
        if (arguments == null || arguments.isBlank()) return Map.of();
        try {
            return JSON.parseObject(arguments, Map.class);
        } catch (Exception e) {
            log.warn("解析工具参数失败: {}", arguments, e);
            return Map.of();
        }
    }

    /**
     * 视频 Agent 在工具调用前保存的待生成轮次。
     *
     * @param id String 稳定轮次ID
     * @param title String 生成记录标题
     * @param round JSONObject 初始轮次内容
     */
    private record InitialVideoRound(String id, String title, JSONObject round) {
    }

}

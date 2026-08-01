/**
 * Agent Loop 生成任务抽象基类，封装图片/视频共享的执行引擎。
 * <p>
 * 子类只需提供名称、任务类型、生成来源、系统提示词和工具五个差异点。
 * 生成工具内部创建异步任务后阻塞轮询等待完成，期间通过 emitter 推送 progress 事件。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-07 14:00
 */
package com.novanovastudio.agent;

import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSON;
import com.novanovastudio.agent.dto.AgentChatRequest;
import com.novanovastudio.agent.dto.AgentEvent;
import com.novanovastudio.agent.dto.AgentMessage;
import com.novanovastudio.agent.dto.AgentSession;
import com.novanovastudio.agent.dto.AgentToolResult.ToolResult;
import com.novanovastudio.agent.dto.AiMessage;
import com.novanovastudio.ai.AiJsonUtils;
import com.novanovastudio.ai.AiTaskTypes;
import com.novanovastudio.ai.AiTaskSources;
import com.novanovastudio.ai.AiErrorDetails;
import com.novanovastudio.ai.AiErrorSupport;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.dto.AiTaskDtos;
import com.novanovastudio.dto.GenerationStyleDtos;
import com.novanovastudio.service.AiTaskService;
import com.novanovastudio.service.PersistenceService;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import lombok.extern.slf4j.Slf4j;
import org.springframework.util.StringUtils;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

@Slf4j
public abstract class AbstractTaskProfile implements AgentLoopProfile {

    private static final Duration POLL_INTERVAL = Duration.ofSeconds(1);
    private static final Duration TIMEOUT = Duration.ofSeconds(300);
    /** 仅供生成轮次快照使用的内部参数键，不能进入渠道请求。 */
    private static final String INTERNAL_STYLE_SNAPSHOTS = "generationStyleSnapshots";

    protected final AiTaskService aiTaskService;

    /** 生成记录持久化服务 */
    protected final PersistenceService persistenceService;

    /** Agent 会话执行登记 */
    protected final AgentExecutionRegistry executionRegistry;

    /**
     * 创建异步生成任务 Profile。
     *
     * @param aiTaskService AiTaskService AI任务服务
     * @param persistenceService PersistenceService 生成记录持久化服务
     * @param executionRegistry AgentExecutionRegistry Agent 会话执行登记
     */
    protected AbstractTaskProfile(AiTaskService aiTaskService, PersistenceService persistenceService,
                                  AgentExecutionRegistry executionRegistry) {
        this.aiTaskService = aiTaskService;
        this.persistenceService = persistenceService;
        this.executionRegistry = executionRegistry;
    }

    // ===== 子类必须实现的差异点 =====

    /** 任务类型：AiTaskTypes.IMAGE 或 AiTaskTypes.VIDEO */
    protected abstract String taskType();

    /**
     * 返回该 Profile 对应的生成来源。
     *
     * @return String 图片创作页或视频创作页来源
     */
    protected abstract String generationSource();

    /**
     * 返回生成记录类型。
     *
     * @return String 图片或视频记录类型
     */
    private String logType() {
        return AiTaskTypes.VIDEO.equals(taskType()) ? "video" : "image";
    }

    /** 系统提示词 */
    protected abstract String systemPrompt();

    @Override public boolean isFrontendTool(String toolName) { return false; }
    @Override public boolean shouldContinueAfterToolResults() { return false; }
    @Override public boolean isTerminalTool(String toolName) {
        return !"query_history".equals(toolName);
    }

    // ===== 工具执行 =====

    @Override
    public Mono<ToolResult> executeTool(Long userId, String toolName, Map<String, Object> args,
                                         String originalPrompt, List<AgentChatRequest.Attachment> attachments,
                                         AgentEventEmitter emitter, String sessionId, String callId) {
        return switch (toolName) {
            case "generate_image", "generate_video",
                 "edit_image",    "edit_video"    -> executeGenerate(userId, toolName, args, originalPrompt,
                    attachments, emitter, sessionId, callId);
            case "query_history"                  -> executeQueryHistory(userId, args);
            default -> Mono.just(new ToolResult(false, "不支持的工具: " + toolName));
        };
    }

    /**
     * 创建异步生成任务，阻塞轮询等待完成。
     * <p>
     * edit_image 未带参考图片时自动使用最近一张成功图片。当前请求上传的附件始终作为任务引用，
     * 不依赖模型在工具参数中重复返回附件地址。
     *
     * @param userId    Long 用户ID
     * @param toolName  String 工具名，用于区分 edit_video 降级
     * @param args      Map 工具入参
     * @param originalPrompt String 用户原始输入
     * @param attachments List<Attachment> 当前请求上传的媒体附件
     * @param emitter   AgentEventEmitter 事件发射器
     * @param sessionId String 会话ID
     * @param callId    String 工具调用ID
     * @return Mono<ToolResult> 工具执行结果
     */
    protected Mono<ToolResult> executeGenerate(Long userId, String toolName, Map<String, Object> args,
                                                String originalPrompt,
                                                List<AgentChatRequest.Attachment> attachments,
                                                AgentEventEmitter emitter, String sessionId, String callId) {
        String generationPrompt = String.valueOf(args.getOrDefault("prompt", ""));
        String size = String.valueOf(args.getOrDefault("size", "1:1"));
        String quality = String.valueOf(args.getOrDefault("quality", "high"));
        String model = String.valueOf(args.getOrDefault("model", ""));
        int count = toInt(args.get("count"), 1);

        Map<String, Object> params = new LinkedHashMap<>();
        params.put("size", size);
        params.put("quality", quality);
        params.put("count", count);

        // 图片和视频都要保留 Agent 工具传入的分辨率，供渠道适配器转换为实际像素尺寸。
        if (args.containsKey("resolution")) {
            params.put("resolution", args.get("resolution"));
        }

        // 视频额外参数
        if ("video".equals(name())) {
            if (args.containsKey("seconds")) params.put("seconds", args.get("seconds"));
            if (args.containsKey("watermark")) params.put("watermark", args.get("watermark"));
        }
        List<GenerationStyleDtos.GenerationStyleSnapshot> styleSnapshots = readStyleSnapshots(args.get(INTERNAL_STYLE_SNAPSHOTS));
        if (!styleSnapshots.isEmpty()) {
            params.put(INTERNAL_STYLE_SNAPSHOTS, JSON.toJSON(styleSnapshots));
        }

        if (executionRegistry.isCancelRequested(sessionId)) {
            return saveCanceledRound(userId, sessionId, callId, "", originalPrompt, generationPrompt,
                    model, params, List.of(), List.of(), System.currentTimeMillis())
                    .thenReturn(canceledResult(""));
        }

        List<AiTaskDtos.AiTaskMediaReference> legacyReferences = legacyReferences(args);
        return resolveAttachmentReferences(userId, attachments)
                .flatMap(attachedReferences -> validateAttachmentCapabilities(userId, model, attachedReferences)
                        .flatMap(validatedAttachments -> {
                            Mono<List<AiTaskDtos.AiTaskMediaReference>> initialReferences = legacyReferences.isEmpty()
                                    && validatedAttachments.imageReferences().isEmpty()
                                    && "edit_image".equals(toolName)
                                    ? latestSuccessfulImageReference(userId)
                                    : Mono.just(legacyReferences);
                            return initialReferences.flatMap(references -> preserveLegacyVideoReferenceBehavior(
                                    userId, toolName, model, references, validatedAttachments, emitter, sessionId)
                                    .flatMap(effectiveLegacyReferences -> {
                                        List<AiTaskDtos.AiTaskMediaReference> effectiveReferences = mergeReferences(validatedAttachments.imageReferences(), effectiveLegacyReferences);
                                        List<AiTaskDtos.AiTaskMediaReference> effectiveVideoReferences = validatedAttachments.videoReferences();
                                        String effectiveGenerationSource = String.valueOf(args.getOrDefault("entrySource", generationSource()));
                                        if (!AiTaskSources.isSupported(effectiveGenerationSource)
                                                || (AiTaskTypes.IMAGE.equals(taskType()) && AiTaskSources.VIDEO_PAGE.equals(effectiveGenerationSource))
                                                || (AiTaskTypes.VIDEO.equals(taskType()) && AiTaskSources.IMAGE_PAGE.equals(effectiveGenerationSource))) {
                                            return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "生成任务入口来源与任务类型不匹配"));
                                        }
                                        Map<String, Object> providerParameters = new LinkedHashMap<>(params);
                                        providerParameters.remove(INTERNAL_STYLE_SNAPSHOTS);
                                        AiTaskDtos.CreateAiTaskRequest taskRequest = new AiTaskDtos.CreateAiTaskRequest(
                                                taskType(), generationPrompt, model.isBlank() ? null : model, providerParameters,
                                                effectiveReferences, effectiveVideoReferences, effectiveGenerationSource);
                                        long createdAt = System.currentTimeMillis();
                                        return Mono.defer(() -> {
                                            executionRegistry.beginTaskCreation(sessionId);
                                            return aiTaskService.createTaskForUser(userId, taskRequest, response -> {
                                                    JSONObject canceledRound = buildGenerationRound(callId, response.id(), originalPrompt,
                                                            generationPrompt, model, params, effectiveReferences,
                                                            effectiveVideoReferences, 100, createdAt, "canceled");
                                                    String title = originalPrompt.length() > 30
                                                            ? originalPrompt.substring(0, 30) : originalPrompt;
                                                    boolean cancellationRequested = executionRegistry.registerTask(sessionId,
                                                            new AgentExecutionRegistry.AgentTaskRegistration(response.id(), logType(), title, canceledRound));
                                                    if (cancellationRequested || executionRegistry.isCancelRequested(sessionId)) {
                                                        return aiTaskService.cancelTaskForUser(userId, response.id())
                                                                .then(saveCanceledRound(userId, sessionId, callId, response.id(),
                                                                        originalPrompt, generationPrompt, model, params,
                                                                        effectiveReferences, effectiveVideoReferences, createdAt));
                                                    }
                                                    return savePendingRound(userId, sessionId, callId, response.id(),
                                                            originalPrompt, generationPrompt, model, params,
                                                            effectiveReferences, effectiveVideoReferences,
                                                            response.progress() != null ? response.progress() : 0, createdAt);
                                                })
                                                .doFinally(signal -> executionRegistry.completeTaskCreation(sessionId))
                                                .flatMap(response -> pollUntilComplete(userId, response, emitter, sessionId, callId,
                                                        originalPrompt, generationPrompt, model, params,
                                                        effectiveReferences, effectiveVideoReferences, createdAt)
                                                        .doFinally(signal -> executionRegistry.removeTask(sessionId, response.id())));
                                        });
                                    }));
                        }))
                // 预校验失败必须作为结构化终态返回，确保主Agent能够基于明确类别决定询问或停止。
                .onErrorResume(BusinessException.class, exception -> {
                    AiErrorDetails error = AiErrorSupport.fromThrowable(exception, "task", "execution");
                    return Mono.just(new ToolResult(false, error.message(), AiErrorSupport.errorData(error), error));
                });
    }

    /**
     * 将工具参数中的历史参考地址转换为任务引用。
     *
     * @param args Map 工具参数
     * @return List<AiTaskMediaReference> 历史参考媒体引用
     */
    private List<AiTaskDtos.AiTaskMediaReference> legacyReferences(Map<String, Object> args) {
        Object referenceUrls = args.get("reference_urls");
        if (!(referenceUrls instanceof List<?> values)) {
            return List.of();
        }
        return values.stream()
                .map(String::valueOf)
                .filter(StringUtils::hasText)
                .map(url -> new AiTaskDtos.AiTaskMediaReference(UUID.randomUUID().toString(), "reference", "", "", url))
                .toList();
    }

    /**
     * 将当前请求附件解析为已校验的任务媒体引用。
     *
     * @param userId Long 当前用户ID
     * @param attachments List<Attachment> 当前请求附件
     * @return Mono<ReferenceGroups> 按图片和视频分类的媒体引用
     */
    private Mono<ReferenceGroups> resolveAttachmentReferences(Long userId, List<AgentChatRequest.Attachment> attachments) {
        if (attachments == null || attachments.isEmpty()) {
            return Mono.just(ReferenceGroups.empty());
        }
        return Flux.fromIterable(attachments)
                .concatMap(attachment -> {
                    if (!StringUtils.hasText(attachment.storageKey())) {
                        return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "参考素材缺少媒体存储键，请重新上传后再试"));
                    }
                    return persistenceService.getMediaInfoForUser(userId, attachment.storageKey())
                            .map(media -> {
                                String mimeType = StringUtils.hasText(media.mimeType()) ? media.mimeType() : attachment.type();
                                if (!StringUtils.hasText(mimeType)
                                        || (!mimeType.startsWith("image/") && !mimeType.startsWith("video/"))) {
                                    throw new BusinessException(ErrorCode.PARAM_INVALID, "参考素材必须是图片或视频");
                                }
                                String name = StringUtils.hasText(attachment.name()) ? attachment.name() : "reference";
                                return new AiTaskDtos.AiTaskMediaReference(UUID.randomUUID().toString(), name, mimeType, media.storageKey(), media.url());
                            });
                })
                .collectList()
                .map(references -> new ReferenceGroups(
                        references.stream().filter(reference -> reference.mimeType().startsWith("image/")).toList(),
                        references.stream().filter(reference -> reference.mimeType().startsWith("video/")).toList()));
    }

    /**
     * 校验视频任务的上传附件与模型细能力匹配。
     *
     * @param userId Long 当前用户ID
     * @param model String 选中的视频模型
     * @param attachments ReferenceGroups 已校验附件引用
     * @return Mono<ReferenceGroups> 通过校验的附件引用
     */
    private Mono<ReferenceGroups> validateAttachmentCapabilities(Long userId, String model, ReferenceGroups attachments) {
        if (!AiTaskTypes.VIDEO.equals(taskType()) || attachments.isEmpty()) {
            return Mono.just(attachments);
        }
        return aiTaskService.modelCapabilities(userId, model.isBlank() ? null : model)
                .flatMap(capabilities -> {
                    if (!attachments.imageReferences().isEmpty() && !capabilities.contains("image-to-video")) {
                        return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "当前模型未配置图生视频能力，请切换支持图生视频的模型"));
                    }
                    if (!attachments.videoReferences().isEmpty() && !capabilities.contains("video-to-video")) {
                        return Mono.error(new BusinessException(ErrorCode.PARAM_INVALID, "当前模型未配置视频参考生成能力，请切换支持视频参考的模型"));
                    }
                    return Mono.just(attachments);
                });
    }

    /**
     * 保留历史 reference_urls 的原有视频编辑降级逻辑。
     *
     * @param userId Long 当前用户ID
     * @param toolName String 工具名称
     * @param model String 选中的模型
     * @param references List<AiTaskMediaReference> 历史参考引用
     * @param attachments ReferenceGroups 当前请求附件引用
     * @param emitter AgentEventEmitter 事件发射器
     * @param sessionId String 会话ID
     * @return Mono<List<AiTaskMediaReference>> 生效的历史引用
     */
    private Mono<List<AiTaskDtos.AiTaskMediaReference>> preserveLegacyVideoReferenceBehavior(
            Long userId, String toolName, String model, List<AiTaskDtos.AiTaskMediaReference> references,
            ReferenceGroups attachments, AgentEventEmitter emitter, String sessionId) {
        if (!"edit_video".equals(toolName) || references.isEmpty() || !attachments.isEmpty()) {
            return Mono.just(references);
        }
        return aiTaskService.modelCapabilities(userId, model.isBlank() ? null : model)
                .map(capabilities -> {
                    boolean allImageReferences = references.stream().allMatch(AbstractTaskProfile::isImageReferenceUrl);
                    boolean supported = allImageReferences ? capabilities.contains("image-to-video") : capabilities.contains("video-to-video");
                    if (!supported) {
                        emitter.emit(userId, AgentEvent.notice(sessionId, "当前模型不支持该参考素材的视频编辑，正在根据修改意图重新生成视频"));
                        return List.<AiTaskDtos.AiTaskMediaReference>of();
                    }
                    return references;
                });
    }

    /**
     * 合并附件和历史引用，并按存储键或地址去重。
     *
     * @param attachmentReferences List<AiTaskMediaReference> 当前附件引用
     * @param legacyReferences List<AiTaskMediaReference> 历史引用
     * @return List<AiTaskMediaReference> 合并后的引用
     */
    private List<AiTaskDtos.AiTaskMediaReference> mergeReferences(List<AiTaskDtos.AiTaskMediaReference> attachmentReferences,
                                                                   List<AiTaskDtos.AiTaskMediaReference> legacyReferences) {
        Map<String, AiTaskDtos.AiTaskMediaReference> uniqueReferences = new LinkedHashMap<>();
        for (AiTaskDtos.AiTaskMediaReference reference : attachmentReferences) {
            uniqueReferences.putIfAbsent(referenceIdentity(reference), reference);
        }
        for (AiTaskDtos.AiTaskMediaReference reference : legacyReferences) {
            uniqueReferences.putIfAbsent(referenceIdentity(reference), reference);
        }
        return List.copyOf(uniqueReferences.values());
    }

    /**
     * 获取参考媒体的去重标识。
     *
     * @param reference AiTaskMediaReference 参考媒体
     * @return String 去重标识
     */
    private String referenceIdentity(AiTaskDtos.AiTaskMediaReference reference) {
        return StringUtils.hasText(reference.storageKey()) ? "storage:" + reference.storageKey() : "url:" + reference.url();
    }

    /**
     * 判断参考素材 URL 是否为图片（按扩展名）。
     *
     * @param ref AiTaskMediaReference 参考素材
     * @return boolean 是否图片 URL
     */
    private static boolean isImageReferenceUrl(AiTaskDtos.AiTaskMediaReference ref) {
        String url = ref.url() == null ? "" : ref.url().toLowerCase();
        return url.endsWith(".jpg") || url.endsWith(".jpeg") || url.endsWith(".png") || url.endsWith(".webp") || url.endsWith(".gif");
    }

    /**
     * 查询最近一张成功图片作为图片编辑参考图。
     *
     * @return Mono<List<AiTaskMediaReference>> 最近图片引用列表
     */
    private Mono<List<AiTaskDtos.AiTaskMediaReference>> latestSuccessfulImageReference(Long userId) {
        return aiTaskService.listTasksForUser(userId, List.of("success"))
                .map(tasks -> tasks.stream()
                        .filter(task -> "image".equals(task.taskType()))
                        .flatMap(task -> extractMediaUrls(task.resultData()).stream())
                        .filter(StringUtils::hasText)
                        .findFirst()
                        .map(url -> List.of(new AiTaskDtos.AiTaskMediaReference(
                                UUID.randomUUID().toString(), "最近生成图片", "", "", url)))
                        .orElseGet(List::of));
    }

    /** 查询用户最近生成任务记录 */
    protected Mono<ToolResult> executeQueryHistory(Long userId, Map<String, Object> args) {
        int count = toInt(args.get("count"), 5);
        return aiTaskService.listTasksForUser(userId, List.of())
            .map(tasks -> {
                List<Map<String, Object>> recent = tasks.stream()
                    .limit(count)
                    .map(t -> {
                        Map<String, Object> m = new LinkedHashMap<>();
                        m.put("id", t.id());
                        m.put("taskType", t.taskType());
                        m.put("status", t.status());
                        m.put("model", t.model());
                        return m;
                    }).toList();
                Map<String, Object> data = new LinkedHashMap<>();
                data.put("recent_tasks", recent);
                return new ToolResult(true, "查询成功", data);
            });
    }

    // ===== 轮询等待 =====

    /**
     * 轮询任务直至终态，并在状态或进度变化时更新同一 pending 轮次。
     *
     * @param userId Long 用户ID
     * @param initialTask AiGenerationTaskResponse 创建后的初始任务响应
     * @param emitter AgentEventEmitter 事件发射器
     * @param sessionId String 会话ID
     * @param callId String 工具调用ID
     * @param originalPrompt String 用户原始输入
     * @param generationPrompt String 实际生成提示词
     * @param model String 模型名称
     * @param parameters Map<String, Object> 生成参数
     * @param references List<AiTaskMediaReference> 图片参考素材
     * @param videoReferences List<AiTaskMediaReference> 视频参考素材
     * @param createdAt long 轮次创建时间
     * @return Mono<ToolResult> 工具执行结果
     */
    protected Mono<ToolResult> pollUntilComplete(Long userId, AiTaskDtos.AiGenerationTaskResponse initialTask,
                                                  AgentEventEmitter emitter, String sessionId, String callId,
                                                  String originalPrompt, String generationPrompt, String model,
                                                  Map<String, Object> parameters,
                                                  List<AiTaskDtos.AiTaskMediaReference> references,
                                                  List<AiTaskDtos.AiTaskMediaReference> videoReferences, long createdAt) {
        String taskId = initialTask.id();
        int initialProgress = initialTask.progress() != null ? initialTask.progress() : 0;
        return Mono.deferContextual(ctx -> {
            AtomicReference<TaskProgressSnapshot> previousSnapshot = new AtomicReference<>(
                    new TaskProgressSnapshot(initialTask.status(), initialProgress));
            return Flux.interval(Duration.ZERO, POLL_INTERVAL)
            .take(TIMEOUT.toSeconds())
            .concatMap(i -> aiTaskService.getTaskForUser(userId, taskId))
            .concatMap(task -> {
                // 先更新后端活动快照，再保存轮次，确保数据库中的执行过程与当前进度一致。
                emitter.emit(userId, AgentEvent.progress(sessionId, callId, taskId,
                        task.progress() != null ? task.progress() : 0, task.status()));
                return persistChangedProgress(userId, sessionId, callId, originalPrompt,
                        generationPrompt, model,
                        parameters, references, videoReferences, createdAt, previousSnapshot, task);
            })
            .takeUntil(task -> isTerminal(task.status()))
            .last()
            .flatMap(task -> saveTerminalRound(userId, sessionId, callId, originalPrompt,
                    generationPrompt, model, parameters, references, videoReferences,
                    createdAt, task).thenReturn(task))
            .map(task -> buildResult(taskId, task))
            .defaultIfEmpty(timeoutResult(taskId))
            .contextWrite(ctx);
        });
    }

    /**
     * 保存成功、失败或取消的终态生成轮次。
     *
     * @param userId Long 用户ID
     * @param sessionId String 会话ID
     * @param callId String 计划任务或工具调用ID
     * @param originalPrompt String 用户原始输入
     * @param generationPrompt String 实际生成提示词
     * @param model String 生成模型
     * @param parameters Map<String, Object> 生成参数
     * @param references List<AiTaskMediaReference> 图片参考素材
     * @param videoReferences List<AiTaskMediaReference> 视频参考素材
     * @param createdAt long 轮次创建时间
     * @param task AiGenerationTaskResponse 终态AI任务
     * @return Mono<Void> 保存完成信号
     */
    private Mono<Void> saveTerminalRound(Long userId, String sessionId, String callId,
                                         String originalPrompt, String generationPrompt,
                                         String model, Map<String, Object> parameters,
                                         List<AiTaskDtos.AiTaskMediaReference> references,
                                         List<AiTaskDtos.AiTaskMediaReference> videoReferences,
                                         long createdAt, AiTaskDtos.AiGenerationTaskResponse task) {
        JSONObject round = buildGenerationRound(callId, task.id(), originalPrompt, generationPrompt,
                model, parameters, references, videoReferences, 100, createdAt, task.status());
        round.put("results", terminalResults(callId, task));
        String title = originalPrompt.length() > 30 ? originalPrompt.substring(0, 30) : originalPrompt;
        return persistenceService.saveOrUpdateGenerationRound(userId, sessionId, logType(), title, round);
    }

    /**
     * 将AI任务终态结果转换为页面生成轮次结果数组。
     *
     * @param callId String 计划任务或工具调用ID
     * @param task AiGenerationTaskResponse 终态AI任务
     * @return List<JSONObject> 页面结果数组
     */
    private List<JSONObject> terminalResults(String callId, AiTaskDtos.AiGenerationTaskResponse task) {
        List<JSONObject> mediaItems = new ArrayList<>();
        if (task.resultData() != null) {
            var items = task.resultData().getJSONArray("items");
            if (items != null) {
                for (int index = 0; index < items.size(); index++) {
                    JSONObject item = items.getJSONObject(index);
                    if (item != null && !item.isEmpty()) mediaItems.add(item);
                }
            }
            JSONObject item = task.resultData().getJSONObject("item");
            if (mediaItems.isEmpty() && item != null && !item.isEmpty()) {
                mediaItems.add(item);
            }
        }
        if ("success".equals(task.status()) && !mediaItems.isEmpty()) {
            List<JSONObject> results = new ArrayList<>();
            for (int index = 0; index < mediaItems.size(); index++) {
                JSONObject result = terminalResult(callId + (index == 0 ? "" : "-" + index), task.id(), "success", "");
                result.put(logType(), mediaItems.get(index));
                results.add(result);
            }
            return results;
        }
        String status = "canceled".equals(task.status()) ? "canceled" : "failed";
        String error = "canceled".equals(status) ? "已停止生成"
                : StringUtils.hasText(task.errorMessage()) ? task.errorMessage() : "生成结果缺少媒体";
        return List.of(terminalResult(callId, task.id(), status, error));
    }

    /**
     * 构造单个页面生成终态结果。
     *
     * @param resultId String 页面结果ID
     * @param taskId String AI任务ID
     * @param status String 终态状态
     * @param error String 错误信息
     * @return JSONObject 页面结果
     */
    private JSONObject terminalResult(String resultId, String taskId, String status, String error) {
        JSONObject result = new JSONObject();
        result.put("id", resultId);
        result.put("taskId", taskId);
        result.put("status", status);
        result.put("progress", 100);
        if (StringUtils.hasText(error)) result.put("error", error);
        return result;
    }

    /**
     * 当任务状态或进度变化时保存页面可恢复的 pending 轮次。
     *
     * @param userId Long 用户ID
     * @param sessionId String 会话ID
     * @param callId String 工具调用ID
     * @param originalPrompt String 用户原始输入
     * @param generationPrompt String 实际生成提示词
     * @param model String 模型名称
     * @param parameters Map<String, Object> 生成参数
     * @param references List<AiTaskMediaReference> 图片参考素材
     * @param videoReferences List<AiTaskMediaReference> 视频参考素材
     * @param createdAt long 轮次创建时间
     * @param previousSnapshot AtomicReference<TaskProgressSnapshot> 上次任务状态和进度
     * @param task AiGenerationTaskResponse 当前任务响应
     * @return Mono<AiGenerationTaskResponse> 原任务响应
     */
    private Mono<AiTaskDtos.AiGenerationTaskResponse> persistChangedProgress(
            Long userId, String sessionId, String callId, String originalPrompt,
            String generationPrompt, String model,
            Map<String, Object> parameters, List<AiTaskDtos.AiTaskMediaReference> references,
            List<AiTaskDtos.AiTaskMediaReference> videoReferences,
            long createdAt, AtomicReference<TaskProgressSnapshot> previousSnapshot,
            AiTaskDtos.AiGenerationTaskResponse task) {
        int progress = task.progress() != null ? task.progress() : 0;
        TaskProgressSnapshot currentSnapshot = new TaskProgressSnapshot(task.status(), progress);
        TaskProgressSnapshot previous = previousSnapshot.getAndSet(currentSnapshot);
        if (isTerminal(task.status()) || currentSnapshot.equals(previous)) {
            return Mono.just(task);
        }
        // 页面只识别 pending，服务端 running 状态通过 progress 表达执行进度。
        return savePendingRound(userId, sessionId, callId, task.id(), originalPrompt,
                generationPrompt, model, parameters, references, videoReferences,
                progress, createdAt).thenReturn(task);
    }

    /**
     * 保存或更新页面可恢复的 pending 生成轮次。
     *
     * @param userId Long 用户ID
     * @param sessionId String 会话ID
     * @param callId String 工具调用ID
     * @param taskId String AI任务ID
     * @param originalPrompt String 用户原始输入
     * @param generationPrompt String 实际生成提示词
     * @param model String 模型名称
     * @param parameters Map<String, Object> 生成参数
     * @param references List<AiTaskMediaReference> 图片参考素材
     * @param videoReferences List<AiTaskMediaReference> 视频参考素材
     * @param progress int 任务进度
     * @param createdAt long 轮次创建时间
     * @return Mono<Void> 保存结果
     */
    private Mono<Void> savePendingRound(Long userId, String sessionId, String callId, String taskId,
                                        String originalPrompt, String generationPrompt, String model,
                                        Map<String, Object> parameters,
                                        List<AiTaskDtos.AiTaskMediaReference> references,
                                        List<AiTaskDtos.AiTaskMediaReference> videoReferences, int progress,
                                        long createdAt) {
        JSONObject round = buildGenerationRound(callId, taskId, originalPrompt, generationPrompt,
                model, parameters, references, videoReferences, progress, createdAt, "pending");
        String title = originalPrompt.length() > 30 ? originalPrompt.substring(0, 30) : originalPrompt;
        return persistenceService.saveOrUpdateGenerationRound(userId, sessionId, logType(), title, round);
    }

    /**
     * 保存已停止生成的终态轮次。
     *
     * @param userId Long 当前用户ID
     * @param sessionId String Agent会话ID
     * @param callId String 工具调用ID
     * @param taskId String AI任务ID
     * @param originalPrompt String 用户原始输入
     * @param generationPrompt String 实际生成提示词
     * @param model String 模型名称
     * @param parameters Map<String, Object> 生成参数
     * @param references List<AiTaskMediaReference> 图片参考素材
     * @param videoReferences List<AiTaskMediaReference> 视频参考素材
     * @param createdAt long 轮次创建时间
     * @return Mono<Void> 保存结果
     */
    private Mono<Void> saveCanceledRound(Long userId, String sessionId, String callId, String taskId,
                                         String originalPrompt, String generationPrompt, String model,
                                         Map<String, Object> parameters,
                                         List<AiTaskDtos.AiTaskMediaReference> references,
                                         List<AiTaskDtos.AiTaskMediaReference> videoReferences, long createdAt) {
        JSONObject round = buildGenerationRound(callId, taskId, originalPrompt, generationPrompt,
                model, parameters, references, videoReferences, 100, createdAt, "canceled");
        String title = originalPrompt.length() > 30 ? originalPrompt.substring(0, 30) : originalPrompt;
        return persistenceService.saveOrUpdateGenerationRound(userId, sessionId, logType(), title, round);
    }

    /**
     * 构造可恢复的生成轮次。
     *
     * @param callId String 工具调用ID
     * @param taskId String AI任务ID
     * @param originalPrompt String 用户原始输入
     * @param generationPrompt String 实际生成提示词
     * @param model String 模型名称
     * @param parameters Map<String, Object> 生成参数
     * @param references List<AiTaskMediaReference> 图片参考素材
     * @param videoReferences List<AiTaskMediaReference> 视频参考素材
     * @param progress int 生成进度
     * @param status String 生成状态
     * @return JSONObject 生成轮次
     */
    private JSONObject buildGenerationRound(String callId, String taskId, String originalPrompt,
                                            String generationPrompt, String model,
                                            Map<String, Object> parameters,
                                            List<AiTaskDtos.AiTaskMediaReference> references,
                                            List<AiTaskDtos.AiTaskMediaReference> videoReferences, int progress,
                                            long createdAt, String status) {
        JSONObject result = new JSONObject();
        result.put("id", callId);
        if (StringUtils.hasText(taskId)) {
            result.put("taskId", taskId);
        }
        result.put("status", status);
        result.put("progress", progress);
        if ("canceled".equals(status)) {
            result.put("error", "已停止生成");
        }

        Map<String, Object> persistedParameters = new LinkedHashMap<>(parameters == null ? Map.of() : parameters);
        Object rawStyleSnapshots = persistedParameters.remove(INTERNAL_STYLE_SNAPSHOTS);
        List<GenerationStyleDtos.GenerationStyleSnapshot> styleSnapshots = readStyleSnapshots(rawStyleSnapshots);
        JSONObject config = new JSONObject(persistedParameters);
        config.put("model", model);
        JSONObject round = new JSONObject();
        round.put("id", callId);
        if (StringUtils.hasText(taskId)) {
            round.put("taskId", taskId);
        }
        round.put("prompt", originalPrompt);
        round.put("generationPrompt", generationPrompt);
        round.put("assistantText", "");
        round.put("config", config);
        round.put("results", List.of(result));
        round.put("references", JSON.toJSON(references));
        round.put("videoReferences", JSON.toJSON(videoReferences));
        if (!styleSnapshots.isEmpty()) {
            round.put(INTERNAL_STYLE_SNAPSHOTS, JSON.toJSON(styleSnapshots));
        }
        round.put("createdAt", createdAt);
        return round;
    }

    /**
     * 解析内部风格快照参数。
     *
     * @param raw 原始参数值
     * @return 风格快照列表
     */
    private List<GenerationStyleDtos.GenerationStyleSnapshot> readStyleSnapshots(Object raw) {
        if (raw == null) {
            return List.of();
        }
        try {
            List<GenerationStyleDtos.GenerationStyleSnapshot> snapshots = JSON.parseArray(
                    JSON.toJSONString(raw), GenerationStyleDtos.GenerationStyleSnapshot.class);
            return snapshots == null ? List.of() : List.copyOf(snapshots);
        } catch (RuntimeException exception) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "风格快照格式不合法");
        }
    }

    /**
     * 构造停止生成的工具执行结果。
     *
     * @param taskId String AI任务ID
     * @return ToolResult 已停止生成结果
     */
    private ToolResult canceledResult(String taskId) {
        Map<String, Object> data = new LinkedHashMap<>();
        if (StringUtils.hasText(taskId)) {
            data.put("taskId", taskId);
        }
        data.put("canceled", true);
        return new ToolResult(false, "已停止生成", data);
    }

    /**
     * 将终态AI任务响应转换为工具执行结果。
     *
     * @param taskId String AI任务ID
     * @param task AiGenerationTaskResponse 终态任务响应
     * @return ToolResult 工具执行结果
     */
    protected ToolResult buildResult(String taskId, AiTaskDtos.AiGenerationTaskResponse task) {
        return switch (task.status()) {
            case "success" -> {
                Map<String, Object> data = new LinkedHashMap<>();
                data.put("taskId", taskId);
                data.put("taskType", task.taskType());
                List<String> mediaUrls = extractMediaUrls(task.resultData());
                if (mediaUrls.isEmpty()) {
                    yield new ToolResult(false, "生成结果缺少媒体", data);
                }
                data.put("urls", mediaUrls);
                if (task.resultData() != null) {
                    // 兼容 Agnes 返回 "item" 单对象 和 其他 provider 返回 "items" 数组两种格式
                    var items = task.resultData().getJSONArray("items");
                    if (items == null || items.isEmpty()) {
                        // Agnes video 返回单数 item，包装为数组
                        var singleItem = task.resultData().getJSONObject("item");
                        if (singleItem != null && !singleItem.isEmpty()) {
                            data.put("items", List.of(singleItem));
                        }
                    } else {
                        data.put("items", items.toJavaList(Object.class));
                    }
                }
                log.info("AI生成任务完成: taskId={}, taskType={}, resultData={}",
                    taskId, task.taskType(), AiJsonUtils.formatResponseForLog(task.resultData()));
                yield new ToolResult(true, "生成完成", data);
            }
            case "failed" -> {
                Map<String, Object> data = new LinkedHashMap<>();
                data.put("taskId", taskId);
                if (task.resultData() != null && task.resultData().get("error") != null) {
                    data.put("error", task.resultData().get("error"));
                }
                yield new ToolResult(false,
                        task.errorMessage() != null ? task.errorMessage() : "生成失败", data);
            }
            case "canceled" -> canceledResult(taskId);
            default -> timeoutResult(taskId);
        };
    }

    /**
     * 构造不可自动重试的轮询超时结果。
     *
     * @param taskId String AI任务ID
     * @return ToolResult 结构化超时结果
     */
    private ToolResult timeoutResult(String taskId) {
        return new ToolResult(false, "生成任务等待超时", Map.of(
                "taskId", taskId,
                "error", new AiErrorDetails("task", "timeout", "polling", null,
                        null, null, null, "生成任务等待超时", true, false).toMap()));
    }

    // ===== 消息构建 =====

    @Override
    public Mono<List<AiMessage>> buildMessages(Long userId, AgentSession session,
                                                AgentChatRequest request) {
        List<AiMessage> messages = new ArrayList<>();
        messages.add(new AiMessage("system", systemPrompt()));
        for (AgentMessage m : session.messages()) {
            if ("tool".equals(m.role())) {
                String content = StringUtils.hasText(m.text()) ? m.text()
                    : (m.toolResult() != null ? m.toolResult() : "");
                messages.add(new AiMessage("tool", content));
            } else {
                messages.add(new AiMessage(m.role(), m.text() != null ? m.text() : ""));
            }
        }
        String userMsg = request.message();
        if (request.attachments() != null && !request.attachments().isEmpty()) {
            userMsg += "\n[用户上传了 " + request.attachments().size() + " 个参考文件]";
        }
        messages.add(new AiMessage("user", userMsg));
        return Mono.just(messages);
    }

    // ===== 工具方法 =====

    private List<String> extractMediaUrls(JSONObject resultData) {
        if (resultData == null) return List.of();
        // 兼容 "items" 数组和 "item" 单对象两种格式
        var items = resultData.getJSONArray("items");
        if (items != null && !items.isEmpty()) {
            List<String> urls = new ArrayList<>();
            for (int i = 0; i < items.size(); i++) {
                JSONObject item = items.getJSONObject(i);
                if (item == null) continue;
                String url = item.getString("url");
                if (url != null && !url.isBlank()) urls.add(url);
            }
            return urls;
        }
        // Agnes video 返回单数 item
        var singleItem = resultData.getJSONObject("item");
        if (singleItem != null) {
            String url = singleItem.getString("url");
            if (url != null && !url.isBlank()) return List.of(url);
        }
        return List.of();
    }

    private boolean isTerminal(String status) {
        return "success".equals(status) || "failed".equals(status) || "canceled".equals(status);
    }

    protected int toInt(Object value, int fallback) {
        if (value instanceof Number n) return Math.max(1, Math.min(10, n.intValue()));
        return fallback;
    }

    /**
     * 当前请求附件按媒体类型分组后的任务引用。
     *
     * @param imageReferences List<AiTaskMediaReference> 图片参考引用
     * @param videoReferences List<AiTaskMediaReference> 视频参考引用
     */
    private record ReferenceGroups(List<AiTaskDtos.AiTaskMediaReference> imageReferences,
                                   List<AiTaskDtos.AiTaskMediaReference> videoReferences) {

        /**
         * 创建空参考分组。
         *
         * @return ReferenceGroups 空参考分组
         */
        private static ReferenceGroups empty() {
            return new ReferenceGroups(List.of(), List.of());
        }

        /**
         * 判断是否没有上传附件引用。
         *
         * @return boolean 没有任何引用时返回true
         */
        private boolean isEmpty() {
            return imageReferences.isEmpty() && videoReferences.isEmpty();
        }
    }

    /**
     * 轮询去重所使用的服务端任务状态和进度快照。
     *
     * @param status String 服务端任务状态
     * @param progress int 任务进度
     */
    private record TaskProgressSnapshot(String status, int progress) {
    }
}

package com.novanovastudio.service;

import com.novanovastudio.ai.AiTaskTypes;
import com.novanovastudio.ai.AiTaskPollingSupport;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.config.NovanovaProperties;
import com.novanovastudio.dto.AiTaskDtos;
import com.novanovastudio.dto.GenerationStyleDtos;
import com.novanovastudio.dto.PromptOptimizationDtos;
import java.time.Duration;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.function.Function;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Mono;

/**
 * 根据生成场景选择优化策略并创建 AI 提示词优化任务。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-17 00:00
 */
@Slf4j
@Service
public class PromptOptimizationService {

    /** AI 任务服务 */
    private final AiTaskService aiTaskService;

    /** 系统提示词模板服务 */
    private final SystemPromptTemplateService systemPromptTemplateService;

    /** 生成风格服务 */
    private final GenerationStyleService generationStyleService;

    /** 服务配置 */
    private final NovanovaProperties properties;

    /**
     * 创建提示词优化服务。
     *
     * @param aiTaskService AI任务服务
     * @param systemPromptTemplateService 系统提示词模板服务
     * @param generationStyleService 生成风格服务
     * @param properties NovanovaProperties 服务配置
     */
    @Autowired
    public PromptOptimizationService(AiTaskService aiTaskService, SystemPromptTemplateService systemPromptTemplateService,
                                     GenerationStyleService generationStyleService, NovanovaProperties properties) {
        this.aiTaskService = aiTaskService;
        this.systemPromptTemplateService = systemPromptTemplateService;
        this.generationStyleService = generationStyleService;
        this.properties = properties;
    }

    /**
     * 保留无风格调用方的构造方式，轮询仍通过统一配置工具读取默认配置。
     *
     * @param aiTaskService AI任务服务
     * @param systemPromptTemplateService 系统提示词模板服务
     */
    public PromptOptimizationService(AiTaskService aiTaskService, SystemPromptTemplateService systemPromptTemplateService) {
        this(aiTaskService, systemPromptTemplateService, null, new NovanovaProperties());
    }

    /**
     * 保留带风格服务调用方的构造方式，轮询仍通过统一配置工具读取默认配置。
     *
     * @param aiTaskService AI任务服务
     * @param systemPromptTemplateService 系统提示词模板服务
     * @param generationStyleService 生成风格服务
     */
    public PromptOptimizationService(AiTaskService aiTaskService, SystemPromptTemplateService systemPromptTemplateService,
                                     GenerationStyleService generationStyleService) {
        this(aiTaskService, systemPromptTemplateService, generationStyleService, new NovanovaProperties());
    }

    /**
     * 创建提示词优化任务，模型留空以使用平台配置的默认文本模型。
     *
     * @param request OptimizePromptRequest 提示词优化请求
     * @return Mono<AiGenerationTaskResponse> 已创建的异步文本任务
     * @throws BusinessException 生成类型不支持时抛出
     */
    public Mono<AiTaskDtos.AiGenerationTaskResponse> optimizePrompt(PromptOptimizationDtos.OptimizePromptRequest request) {
        systemPrompt(request.generationType());
        return resolveRequestStyles(request).flatMap(styles -> aiTaskService.createTask(optimizationTaskRequest(request, styles)));
    }

    /**
     * 为指定用户创建提示词优化任务。
     *
     * @param userId Long 用户ID
     * @param request OptimizePromptRequest 提示词优化请求
     * @return Mono<AiGenerationTaskResponse> 已创建的异步文本任务
     */
    public Mono<AiTaskDtos.AiGenerationTaskResponse> optimizePromptForUser(Long userId, PromptOptimizationDtos.OptimizePromptRequest request) {
        systemPrompt(request.generationType());
        return resolveRequestStyles(request).flatMap(styles -> aiTaskService.createTaskForUser(userId, optimizationTaskRequest(request, styles), response -> Mono.empty()));
    }

    /**
     * 构造提示词优化文本任务。
     *
     * @param request OptimizePromptRequest 提示词优化请求
     * @return CreateAiTaskRequest 文本任务请求
     */
    private AiTaskDtos.CreateAiTaskRequest optimizationTaskRequest(PromptOptimizationDtos.OptimizePromptRequest request,
                                                                   List<GenerationStyleDtos.GenerationStyleSnapshot> styles) {
        String generationType = request.generationType().trim().toLowerCase(Locale.ROOT);
        String systemPrompt = systemPrompt(generationType);
        String prompt = composePrompt(request.prompt(), styles);
        log.info("创建AI提示词优化任务: generationType={}", generationType);

        AiTaskDtos.CreateAiTaskRequest taskRequest = new AiTaskDtos.CreateAiTaskRequest(
                AiTaskTypes.TEXT,
                prompt,
                null,
                Map.of("systemPrompt", systemPrompt),
                List.of(),
                List.of(),
                null
        );
        return taskRequest;
    }

    /**
     * 创建优化任务并等待其成功返回最终提示词。
     *
     * @param userId Long 用户ID
     * @param generationType String 图片或视频生成类型
     * @param prompt String 原始提示词
     * @return Mono<String> 优化后的提示词
     */
    public Mono<String> optimizeAndWait(Long userId, String generationType, String prompt) {
        return optimizeAndWait(userId, generationType, prompt, response -> Mono.empty());
    }

    /**
     * 创建优化任务，在入队前执行计划任务登记，并等待成功返回最终提示词。
     *
     * @param userId Long 用户ID
     * @param generationType String 图片或视频生成类型
     * @param prompt String 原始提示词
     * @param beforeEnqueue Function 入队前处理器
     * @return Mono<String> 优化后的提示词
     */
    public Mono<String> optimizeAndWait(Long userId, String generationType, String prompt,
                                        Function<AiTaskDtos.AiGenerationTaskResponse, Mono<Void>> beforeEnqueue) {
        return optimizeAndWait(userId, generationType, prompt, List.of(), beforeEnqueue);
    }

    /**
     * 创建带风格上下文的优化任务并等待成功结果。
     *
     * @param userId Long 用户ID
     * @param generationType String 图片或视频生成类型
     * @param prompt String 原始提示词
     * @param styles List<GenerationStyleSnapshot> 已解析风格快照
     * @param beforeEnqueue Function 入队前处理器
     * @return Mono<String> 优化后的提示词
     */
    public Mono<String> optimizeAndWait(Long userId, String generationType, String prompt,
                                        List<GenerationStyleDtos.GenerationStyleSnapshot> styles,
                                        Function<AiTaskDtos.AiGenerationTaskResponse, Mono<Void>> beforeEnqueue) {
        PromptOptimizationDtos.OptimizePromptRequest request = new PromptOptimizationDtos.OptimizePromptRequest(generationType, prompt);
        systemPrompt(generationType);
        Duration pollingInterval = AiTaskPollingSupport.pollingInterval(properties);
        return aiTaskService.createTaskForUser(userId, optimizationTaskRequest(request, styles), beforeEnqueue)
                .flatMap(created -> reactor.core.publisher.Flux.interval(Duration.ZERO, pollingInterval)
                        .concatMap(ignored -> aiTaskService.getTaskForUser(userId, created.id()))
                        .filter(task -> List.of("success", "failed", "canceled").contains(task.status()))
                        .next()
                        .timeout(Duration.ofMinutes(5)))
                .flatMap(task -> {
                    if (!"success".equals(task.status())) {
                        return Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR,
                                task.errorMessage() == null || task.errorMessage().isBlank() ? "提示词优化失败" : task.errorMessage()));
                    }
                    String optimizedPrompt = task.resultData() == null ? "" : task.resultData().getString("content");
                    if (optimizedPrompt == null || optimizedPrompt.isBlank()) {
                        return Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "提示词优化结果为空"));
                    }
                    return Mono.just(optimizedPrompt.trim());
                });
    }

    /**
     * 解析生成风格，供新版计划执行器复用同一套校验。
     *
     * @param generationType String 图片或视频生成类型
     * @param styleIds List<Long> 风格ID
     * @param snapshots List<GenerationStyleSnapshot> 历史快照
     * @return Mono<List<GenerationStyleSnapshot>> 解析后的快照
     */
    public Mono<List<GenerationStyleDtos.GenerationStyleSnapshot>> resolveStyles(
            String generationType, List<Long> styleIds, List<GenerationStyleDtos.GenerationStyleSnapshot> snapshots) {
        if (generationStyleService == null) {
            if ((styleIds != null && !styleIds.isEmpty()) || (snapshots != null && !snapshots.isEmpty())) {
                return Mono.error(new BusinessException(ErrorCode.BUSINESS_ERROR, "当前提示词优化服务未配置风格解析器"));
            }
            return Mono.just(List.of());
        }
        return generationStyleService.resolveStyles(generationType, styleIds, snapshots);
    }

    /** 解析手动优化请求携带的风格ID。 */
    private Mono<List<GenerationStyleDtos.GenerationStyleSnapshot>> resolveRequestStyles(PromptOptimizationDtos.OptimizePromptRequest request) {
        return resolveStyles(request.generationType(), request.generationStyleIds(), List.of());
    }

    /**
     * 将用户提示词和按选择顺序排列的风格提示词合并为优化器输入。
     *
     * @param prompt 用户提示词
     * @param styles 风格快照
     * @return 优化器输入文本
     */
    private String composePrompt(String prompt, List<GenerationStyleDtos.GenerationStyleSnapshot> styles) {
        String normalizedPrompt = prompt == null ? "" : prompt.trim();
        if (styles == null || styles.isEmpty()) {
            return normalizedPrompt;
        }
        String styleBlocks = java.util.stream.IntStream.range(0, styles.size())
                .mapToObj(index -> "风格" + (index + 1) + "（" + styles.get(index).name() + "）：" + styles.get(index).stylePrompt())
                .collect(java.util.stream.Collectors.joining("\n"));
        return normalizedPrompt + "\n\n【用户选择的风格提示词（按顺序融合）】\n" + styleBlocks;
    }

    /**
     * 按生成类型读取对应的系统提示词。
     *
     * @param generationType String 生成类型
     * @return String 系统提示词
     * @throws BusinessException 生成类型不支持时抛出
     */
    private String systemPrompt(String generationType) {
        String normalizedType = generationType == null ? "" : generationType.trim().toLowerCase(Locale.ROOT);
        return switch (normalizedType) {
            case AiTaskTypes.IMAGE -> systemPromptTemplateService.get(PromptTemplateType.OPTIMIZATION_IMAGE);
            case AiTaskTypes.VIDEO -> systemPromptTemplateService.get(PromptTemplateType.OPTIMIZATION_VIDEO);
            default -> throw new BusinessException(ErrorCode.PARAM_INVALID, "仅支持优化图片或视频生成提示词");
        };
    }
}

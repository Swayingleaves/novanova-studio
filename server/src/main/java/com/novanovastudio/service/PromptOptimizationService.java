package com.novanovastudio.service;

import com.novanovastudio.ai.AiTaskTypes;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.dto.AiTaskDtos;
import com.novanovastudio.dto.PromptOptimizationDtos;
import java.util.List;
import java.util.Map;
import java.time.Duration;
import java.util.function.Function;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
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
@RequiredArgsConstructor
public class PromptOptimizationService {

    /** AI 任务服务 */
    private final AiTaskService aiTaskService;

    /** 系统提示词模板服务 */
    private final SystemPromptTemplateService systemPromptTemplateService;

    /**
     * 创建提示词优化任务，模型留空以使用平台配置的默认文本模型。
     *
     * @param request OptimizePromptRequest 提示词优化请求
     * @return Mono<AiGenerationTaskResponse> 已创建的异步文本任务
     * @throws BusinessException 生成类型不支持时抛出
     */
    public Mono<AiTaskDtos.AiGenerationTaskResponse> optimizePrompt(PromptOptimizationDtos.OptimizePromptRequest request) {
        return aiTaskService.createTask(optimizationTaskRequest(request));
    }

    /**
     * 为指定用户创建提示词优化任务。
     *
     * @param userId Long 用户ID
     * @param request OptimizePromptRequest 提示词优化请求
     * @return Mono<AiGenerationTaskResponse> 已创建的异步文本任务
     */
    public Mono<AiTaskDtos.AiGenerationTaskResponse> optimizePromptForUser(Long userId, PromptOptimizationDtos.OptimizePromptRequest request) {
        return aiTaskService.createTaskForUser(userId, optimizationTaskRequest(request), response -> Mono.empty());
    }

    /**
     * 构造提示词优化文本任务。
     *
     * @param request OptimizePromptRequest 提示词优化请求
     * @return CreateAiTaskRequest 文本任务请求
     */
    private AiTaskDtos.CreateAiTaskRequest optimizationTaskRequest(PromptOptimizationDtos.OptimizePromptRequest request) {
        String generationType = request.generationType().trim();
        String systemPrompt = systemPrompt(generationType);
        String prompt = request.prompt().trim();
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
        PromptOptimizationDtos.OptimizePromptRequest request = new PromptOptimizationDtos.OptimizePromptRequest(generationType, prompt);
        return aiTaskService.createTaskForUser(userId, optimizationTaskRequest(request), beforeEnqueue)
                .flatMap(created -> reactor.core.publisher.Flux.interval(Duration.ZERO, Duration.ofSeconds(1))
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
     * 按生成类型读取对应的系统提示词。
     *
     * @param generationType String 生成类型
     * @return String 系统提示词
     * @throws BusinessException 生成类型不支持时抛出
     */
    private String systemPrompt(String generationType) {
        return switch (generationType) {
            case AiTaskTypes.IMAGE -> systemPromptTemplateService.get(PromptTemplateType.OPTIMIZATION_IMAGE);
            case AiTaskTypes.VIDEO -> systemPromptTemplateService.get(PromptTemplateType.OPTIMIZATION_VIDEO);
            default -> throw new BusinessException(ErrorCode.PARAM_INVALID, "仅支持优化图片或视频生成提示词");
        };
    }
}

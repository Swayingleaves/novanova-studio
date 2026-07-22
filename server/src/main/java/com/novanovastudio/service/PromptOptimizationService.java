package com.novanovastudio.service;

import com.novanovastudio.ai.AiTaskTypes;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.dto.AiTaskDtos;
import com.novanovastudio.dto.PromptOptimizationDtos;
import java.util.List;
import java.util.Map;
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
        return aiTaskService.createTask(taskRequest);
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

package com.novanovastudio.service;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.novanovastudio.ai.AiTaskTypes;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.dto.AiTaskDtos;
import com.novanovastudio.dto.GenerationStyleDtos;
import com.novanovastudio.dto.PromptOptimizationDtos;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

/**
 * 提示词优化服务测试。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-17 00:00
 */
@ExtendWith(MockitoExtension.class)
class PromptOptimizationServiceTest {

    /** AI任务服务 */
    @Mock
    private AiTaskService aiTaskService;

    /** 生成风格服务 */
    @Mock
    private GenerationStyleService generationStyleService;

    /**
     * 图片优化应使用默认文本模型并加载图片策略。
     */
    @Test
    void shouldCreateImagePromptOptimizationTask() {
        when(aiTaskService.createTask(any())).thenReturn(Mono.just(taskResponse()));
        SystemPromptTemplateService templateService = promptTemplateService();
        PromptOptimizationService service = new PromptOptimizationService(aiTaskService, templateService);

        service.optimizePrompt(new PromptOptimizationDtos.OptimizePromptRequest(AiTaskTypes.IMAGE, "一只猫")).block();

        AiTaskDtos.CreateAiTaskRequest request = capturedRequest();
        Assertions.assertEquals(AiTaskTypes.TEXT, request.taskType());
        Assertions.assertNull(request.model());
        Assertions.assertEquals("一只猫", request.prompt());
        Assertions.assertEquals(templateService.get(PromptTemplateType.OPTIMIZATION_IMAGE), request.parameters().get("systemPrompt"));
    }

    /**
     * 视频优化应加载独立的视频策略。
     */
    @Test
    void shouldCreateVideoPromptOptimizationTask() {
        when(aiTaskService.createTask(any())).thenReturn(Mono.just(taskResponse()));
        SystemPromptTemplateService templateService = promptTemplateService();
        PromptOptimizationService service = new PromptOptimizationService(aiTaskService, templateService);

        service.optimizePrompt(new PromptOptimizationDtos.OptimizePromptRequest(AiTaskTypes.VIDEO, "海边奔跑")).block();

        AiTaskDtos.CreateAiTaskRequest request = capturedRequest();
        Assertions.assertEquals(templateService.get(PromptTemplateType.OPTIMIZATION_VIDEO), request.parameters().get("systemPrompt"));
    }

    /** 手动提示词优化应按选择顺序注入风格提示词块。 */
    @Test
    void shouldComposeSelectedStylesForManualOptimization() {
        when(aiTaskService.createTask(any())).thenReturn(Mono.just(taskResponse()));
        when(generationStyleService.resolveStyles(eq(AiTaskTypes.IMAGE), eq(List.of(2L, 1L)), any()))
                .thenReturn(Mono.just(List.of(
                        new GenerationStyleDtos.GenerationStyleSnapshot(2L, "水彩", "image", "watercolor"),
                        new GenerationStyleDtos.GenerationStyleSnapshot(1L, "电影感", "image", "cinematic"))));
        PromptOptimizationService service = new PromptOptimizationService(aiTaskService, promptTemplateService(), generationStyleService);

        service.optimizePrompt(new PromptOptimizationDtos.OptimizePromptRequest(AiTaskTypes.IMAGE, "一只猫", List.of(2L, 1L))).block();

        AiTaskDtos.CreateAiTaskRequest request = capturedRequest();
        Assertions.assertTrue(request.prompt().indexOf("水彩") < request.prompt().indexOf("电影感"));
        Assertions.assertTrue(request.prompt().contains("watercolor"));
        Assertions.assertTrue(request.prompt().contains("cinematic"));
    }

    /**
     * 不支持的生成类型应直接拒绝。
     */
    @Test
    void shouldRejectUnsupportedGenerationType() {
        PromptOptimizationService service = new PromptOptimizationService(aiTaskService, promptTemplateService());

        Assertions.assertThrows(BusinessException.class,
                () -> service.optimizePrompt(new PromptOptimizationDtos.OptimizePromptRequest(AiTaskTypes.TEXT, "测试")));
    }

    /**
     * 优化任务失败时必须终止并返回错误，不能回退原提示词。
     */
    @Test
    void shouldFailWhenPromptOptimizationTaskFails() {
        when(aiTaskService.createTaskForUser(eq(1L), any(), any())).thenReturn(Mono.just(taskResponse()));
        when(aiTaskService.getTaskForUser(1L, "task-1")).thenReturn(Mono.just(new AiTaskDtos.AiGenerationTaskResponse(
                "task-1", AiTaskTypes.TEXT, "chat-model", "默认渠道", "failed", 100,
                null, null, "优化服务失败", "", "", "", "")));
        PromptOptimizationService service = new PromptOptimizationService(aiTaskService, promptTemplateService());

        StepVerifier.create(service.optimizeAndWait(1L, AiTaskTypes.IMAGE, "一只猫"))
                .expectErrorSatisfies(error -> {
                    Assertions.assertInstanceOf(BusinessException.class, error);
                    Assertions.assertEquals("优化服务失败", error.getMessage());
                })
                .verify();
    }

    /**
     * 捕获提交给AI任务服务的请求。
     *
     * @return CreateAiTaskRequest AI任务请求
     */
    private AiTaskDtos.CreateAiTaskRequest capturedRequest() {
        ArgumentCaptor<AiTaskDtos.CreateAiTaskRequest> captor = ArgumentCaptor.forClass(AiTaskDtos.CreateAiTaskRequest.class);
        verify(aiTaskService).createTask(captor.capture());
        return captor.getValue();
    }

    /**
     * 构建AI任务响应。
     *
     * @return AiGenerationTaskResponse 任务响应
     */
    private AiTaskDtos.AiGenerationTaskResponse taskResponse() {
        return new AiTaskDtos.AiGenerationTaskResponse(
                "task-1", AiTaskTypes.TEXT, "chat-model", "默认渠道", "pending", 0,
                null, null, "", "", "", "", "");
    }

    /**
     * 加载测试使用的外部系统提示词模板。
     *
     * @return SystemPromptTemplateService 已加载的模板服务
     */
    private SystemPromptTemplateService promptTemplateService() {
        com.novanovastudio.config.NovanovaProperties properties = new com.novanovastudio.config.NovanovaProperties();
        Path promptDirectory = Path.of("config", "prompts").toAbsolutePath();
        properties.getAi().getSystemPrompt().setOptimizationImageFile(promptDirectory.resolve("optimization-image.md").toUri().toString());
        properties.getAi().getSystemPrompt().setOptimizationVideoFile(promptDirectory.resolve("optimization-video.md").toUri().toString());
        properties.getAi().getSystemPrompt().setAgentMainFile(promptDirectory.resolve("agent-main.md").toUri().toString());
        properties.getAi().getSystemPrompt().setAgentRecoveryFile(promptDirectory.resolve("agent-recovery.md").toUri().toString());
        properties.getAi().getSystemPrompt().setAgentImageFile(promptDirectory.resolve("agent-image.md").toUri().toString());
        properties.getAi().getSystemPrompt().setAgentVideoFile(promptDirectory.resolve("agent-video.md").toUri().toString());
        properties.getAi().getSystemPrompt().setAgentCanvasFile(promptDirectory.resolve("agent-canvas.md").toUri().toString());
        properties.getAi().getSystemPrompt().setAgentStoryboardFile(promptDirectory.resolve("agent-storyboard.md").toUri().toString());
        SystemPromptTemplateService service = new SystemPromptTemplateService(properties, new org.springframework.core.io.DefaultResourceLoader());
        service.loadTemplates();
        return service;
    }
}

package com.novanovastudio.agent.workflow;

import com.novanovastudio.agent.CreationEntrySource;
import com.novanovastudio.agent.dto.CreationPlan;
import com.novanovastudio.agent.dto.CreationSettings;
import com.novanovastudio.agent.dto.CreationTask;
import com.novanovastudio.common.BusinessException;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

/**
 * 视频工作流注册和首尾帧定义测试。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-08-29 00:00
 */
class VideoWorkflowDefinitionTest {

    /**
     * 工作流标识只识别独立标识行，并统一规范类型大小写。
     */
    @Test
    void shouldResolveOnlyStandaloneWorkflowMarker() {
        VideoWorkflowRegistry registry = new VideoWorkflowRegistry(List.of(new FirstLastFrameVideoWorkflow()));

        Assertions.assertEquals("first-last-frame", registry.resolveWorkflowType("说明\nworkflow: first-last-frame\n其他内容").orElseThrow());
        Assertions.assertTrue(registry.resolveWorkflowType("workflow: first-last-frame-extra text").isEmpty());
        Assertions.assertTrue(registry.resolveWorkflowType("workflow: text-to-video").isEmpty());
        Assertions.assertFalse(registry.isRegistered("text-to-video"));
        Assertions.assertThrows(BusinessException.class, () -> registry.require("storyboard"));
    }

    /**
     * 首尾帧定义开启图片二次确认，buildPlan 返回图片阶段（首帧文生图 + 尾帧以首帧为参考）。
     */
    @Test
    void shouldBuildImageStagePlan() {
        FirstLastFrameVideoWorkflow workflow = new FirstLastFrameVideoWorkflow();
        CreationSettings settings = new CreationSettings("text-model", "16:9", "720p", "medium", 1,
                "5", false, null, null, null, "text-to-video", "video-model", "image-model");
        CreationPlan plan = workflow.buildPlan(new VideoWorkflowContext("context", workflow.workflowType(),
                Map.of(), "城市夜景", "请补充", List.of("镜头从街道推进到高楼"), Map.of(),
                Map.of(), settings, "planned", 2));

        Assertions.assertTrue(workflow.supportsImageConfirmation());
        Assertions.assertEquals(2, plan.tasks().size());
        workflow.validateTasks(plan.tasks());
        Assertions.assertEquals("first_frame", plan.tasks().get(0).taskRole());
        Assertions.assertEquals("last_frame", plan.tasks().get(1).taskRole());
        Assertions.assertTrue(plan.tasks().stream().allMatch(task -> "image".equals(task.taskType())));
        Assertions.assertTrue(workflow.usesWorkflowImageModel(plan.tasks().get(0)));
        // 尾帧任务依赖首帧任务，执行时以首帧图片为参考生成
        Assertions.assertTrue(plan.tasks().get(0).dependsOn().isEmpty());
        Assertions.assertEquals(List.of("first-frame"), plan.tasks().get(1).dependsOn());
        Assertions.assertEquals(List.of("first-frame"), workflow.orderedDependencies(plan.tasks().get(1)));
    }

    /**
     * 用户确认使用已生成图片后构建视频阶段计划（单个视频任务，无 plan 内图片依赖）。
     */
    @Test
    void shouldBuildVideoStagePlan() {
        FirstLastFrameVideoWorkflow workflow = new FirstLastFrameVideoWorkflow();
        CreationSettings settings = new CreationSettings("text-model", "16:9", "720p", "medium", 1,
                "5", false, null, null, null, "text-to-video", "video-model", "image-model");
        VideoWorkflowContext context = new VideoWorkflowContext("context", workflow.workflowType(),
                Map.of(), "城市夜景", "请补充", List.of(), Map.of(
                        "firstFramePrompt", "黄昏街道上的橘猫", "lastFramePrompt", "夜晚楼顶的小狗", "videoPrompt", "镜头从街道推向上空"),
                Map.of("first_frame", Map.of("storageKey", "a"), "last_frame", Map.of("storageKey", "b")),
                settings, "image_pending_confirm", 4);

        CreationPlan plan = workflow.buildVideoStagePlan(context);
        Assertions.assertEquals(1, plan.tasks().size());
        workflow.validateTasks(plan.tasks());
        Assertions.assertEquals("video", plan.tasks().get(0).taskRole());
        Assertions.assertEquals("镜头从街道推向上空", plan.tasks().get(0).prompt());
        Assertions.assertTrue(plan.tasks().get(0).dependsOn().isEmpty());
        // 视频阶段无 plan 内图片依赖：参考图由执行器从上下文读取
        Assertions.assertTrue(workflow.orderedDependencies(plan.tasks().get(0)).isEmpty());
        Assertions.assertEquals("reference-to-video", workflow.videoGenerationMode(plan.tasks().get(0), "text-to-video"));
        Assertions.assertTrue(workflow.enrichPrompt(plan.tasks().get(0), "生成视频", "reference-to-video").contains("首帧参考图"));
    }

    /**
     * 用户确认的草案提示词应原样进入图片阶段任务，不再套用模板。
     */
    @Test
    void shouldBuildImageStageFromConfirmedDraftPrompts() {
        FirstLastFrameVideoWorkflow workflow = new FirstLastFrameVideoWorkflow();
        CreationSettings settings = new CreationSettings("text-model", "16:9", "720p", "medium", 1,
                "5", false, null, null, null, "text-to-video", "video-model", "image-model");
        CreationPlan plan = workflow.buildImageStagePlan(new VideoWorkflowContext("context", workflow.workflowType(),
                Map.of(), "城市夜景", "请补充", List.of(), Map.of(
                        "firstFramePrompt", "黄昏街道上的橘猫", "lastFramePrompt", "夜晚楼顶的小狗", "videoPrompt", "镜头从街道推向上空"),
                Map.of(), settings, "pending_confirm", 3));

        workflow.validateTasks(plan.tasks());
        Assertions.assertEquals("黄昏街道上的橘猫", plan.tasks().get(0).prompt());
        Assertions.assertEquals("夜晚楼顶的小狗", plan.tasks().get(1).prompt());
        Assertions.assertFalse(workflow.conversationSystemPrompt().isBlank());
        Assertions.assertTrue(workflow.conversationSystemPrompt().contains("choices"));
    }

    /**
     * 首尾帧定义拒绝缺失角色、越权任务或混阶段任务。
     */
    @Test
    void shouldRejectInvalidFirstLastFrameTasks() {
        FirstLastFrameVideoWorkflow workflow = new FirstLastFrameVideoWorkflow();
        // 三任务混阶段：两阶段工作流不允许一次计划同时包含图片与视频
        List<CreationTask> mixedTasks = List.of(
                new CreationTask("first-frame", "image", "generate", "首帧", null, List.of(), "", Map.of(), "first_frame"),
                new CreationTask("last-frame", "image", "generate", "尾帧", null, List.of(), "", Map.of(), "last_frame"),
                new CreationTask("video", "video", "generate", "视频", null, List.of("first-frame"), "", Map.of(), "video"));
        Assertions.assertThrows(BusinessException.class, () -> workflow.validateTasks(mixedTasks));

        // 图片阶段缺尾帧角色
        List<CreationTask> missingRole = List.of(
                new CreationTask("first-frame", "image", "generate", "首帧", null, List.of(), "", Map.of(), "first_frame"));
        Assertions.assertThrows(BusinessException.class, () -> workflow.validateTasks(missingRole));

        // 视频阶段附带图片任务
        List<CreationTask> videoWithImage = List.of(
                new CreationTask("first-frame", "image", "generate", "首帧", null, List.of(), "", Map.of(), "first_frame"),
                new CreationTask("video", "video", "generate", "视频", null, List.of(), "", Map.of(), "video"));
        Assertions.assertThrows(BusinessException.class, () -> workflow.validateTasks(videoWithImage));

        // 图片阶段尾帧未依赖首帧：尾帧必须以首帧图片为参考生成
        List<CreationTask> noDependency = List.of(
                new CreationTask("first-frame", "image", "generate", "首帧", null, List.of(), "", Map.of(), "first_frame"),
                new CreationTask("last-frame", "image", "generate", "尾帧", null, List.of(), "", Map.of(), "last_frame"));
        Assertions.assertThrows(BusinessException.class, () -> workflow.validateTasks(noDependency));

        // 图片阶段首帧携带依赖：首帧应无依赖
        List<CreationTask> firstWithDependency = List.of(
                new CreationTask("first-frame", "image", "generate", "首帧", null, List.of("last-frame"), "", Map.of(), "first_frame"),
                new CreationTask("last-frame", "image", "generate", "尾帧", null, List.of("first-frame"), "", Map.of(), "last_frame"));
        Assertions.assertThrows(BusinessException.class, () -> workflow.validateTasks(firstWithDependency));
    }
}

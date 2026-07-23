package com.novanovastudio.agent;

import com.novanovastudio.agent.dto.CreationPlan;
import com.novanovastudio.agent.dto.CreationSettings;
import com.novanovastudio.agent.dto.CreationTask;
import com.novanovastudio.common.BusinessException;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

/**
 * 主Agent创作计划确定性校验测试。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-23 00:00
 */
class CreationPlanValidatorTest {

    /** 计划校验器 */
    private final CreationPlanValidator validator = new CreationPlanValidator(new AgentToolRegistry());

    /**
     * 图片页必须拒绝视频子Agent任务。
     */
    @Test
    void shouldRejectVideoTaskOnImagePage() {
        CreationPlan plan = plan(CreationEntrySource.IMAGE_PAGE,
                List.of(task("video-task", "video", List.of())));

        Assertions.assertThrows(BusinessException.class,
                () -> validator.validate(plan, CreationEntrySource.IMAGE_PAGE, videoSettings()));
    }

    /**
     * 视频页必须拒绝图片子Agent任务。
     */
    @Test
    void shouldRejectImageTaskOnVideoPage() {
        CreationPlan plan = plan(CreationEntrySource.VIDEO_PAGE,
                List.of(task("image-task", "image", List.of())));

        Assertions.assertThrows(BusinessException.class,
                () -> validator.validate(plan, CreationEntrySource.VIDEO_PAGE, imageSettings()));
    }

    /**
     * 画布允许同时规划图片和视频子Agent任务。
     */
    @Test
    void shouldAllowImageAndVideoTasksOnCanvas() {
        CreationPlan plan = plan(CreationEntrySource.CANVAS, List.of(
                canvasGenerationTask("image-task", "image", "canvas_generate_image",
                        Map.of("prompt", "一只小猫", "size", "16:9")),
                canvasGenerationTask("video-task", "video", "canvas_generate_video",
                        Map.of("prompt", "一只小狗奔跑"))));
        CreationSettings settings = new CreationSettings("model", "16:9", "720p", "medium", 1, "5", false);

        CreationPlan result = validator.validate(plan, CreationEntrySource.CANVAS, settings);

        Assertions.assertEquals(2, result.tasks().size());
        Assertions.assertSame(settings, result.creationSettings());
    }

    /**
     * 画布普通操作只能使用Java注册的前端工具。
     */
    @Test
    void shouldAllowRegisteredCanvasTool() {
        CreationTask task = new CreationTask("canvas-task", "canvas", "tool", "创建文本节点", List.of(),
                "canvas_create_text_node", Map.of("text", "分镜标题"));

        CreationPlan result = validator.validate(plan(CreationEntrySource.CANVAS, List.of(task)),
                CreationEntrySource.CANVAS, null);

        Assertions.assertEquals("canvas_create_text_node", result.tasks().getFirst().toolName());
    }

    /**
     * Prompt声明的未注册工具不能突破Java权限边界。
     */
    @Test
    void shouldRejectUnregisteredCanvasTool() {
        CreationTask task = new CreationTask("canvas-task", "canvas", "tool", "执行未知工具", List.of(),
                "canvas_delete_all_projects", Map.of());

        Assertions.assertThrows(BusinessException.class,
                () -> validator.validate(plan(CreationEntrySource.CANVAS, List.of(task)),
                        CreationEntrySource.CANVAS, null));
    }

    /**
     * 画布工具缺少Schema必填参数时必须转为补参问题。
     */
    @Test
    void shouldAskForMissingCanvasToolArguments() {
        CreationTask task = new CreationTask("image-task", "image", "generate", "生成一只小猫", List.of(),
                "canvas_generate_image", Map.of("prompt", "生成一只小猫"));

        CreationPlan result = validator.validate(plan(CreationEntrySource.CANVAS, List.of(task)),
                CreationEntrySource.CANVAS, new CreationSettings("image-model", null, null, null, null, null, null));

        Assertions.assertTrue(result.tasks().isEmpty());
        Assertions.assertTrue(result.clarificationQuestion().contains("size"));
    }

    /**
     * 画布自动运行图片生成流程时必须确定性要求图片尺寸。
     */
    @Test
    void shouldAskForImageSizeBeforeAutoRunningCanvasFlow() {
        CreationTask task = new CreationTask("image-task", "image", "generate", "生成一只小猫", List.of(),
                "canvas_create_generation_flow", Map.of("mode", "image", "prompt", "生成一只小猫", "autoRun", true));

        CreationPlan result = validator.validate(plan(CreationEntrySource.CANVAS, List.of(task)),
                CreationEntrySource.CANVAS, new CreationSettings("image-model", null, null, null, null, null, null));

        Assertions.assertTrue(result.tasks().isEmpty());
        Assertions.assertTrue(result.clarificationQuestion().contains("size"));
    }

    /**
     * 循环依赖必须在任何子任务执行前被拒绝。
     */
    @Test
    void shouldRejectCyclicDependencies() {
        CreationPlan plan = plan(CreationEntrySource.IMAGE_PAGE, List.of(
                task("task-a", "image", List.of("task-b")),
                task("task-b", "image", List.of("task-a"))));

        Assertions.assertThrows(BusinessException.class,
                () -> validator.validate(plan, CreationEntrySource.IMAGE_PAGE, imageSettings()));
    }

    /**
     * 缺少页面必填参数时返回询问并清空任务。
     */
    @Test
    void shouldAskForMissingSettingsWithoutCreatingTasks() {
        CreationPlan plan = plan(CreationEntrySource.IMAGE_PAGE,
                List.of(task("image-task", "image", List.of())));

        CreationPlan result = validator.validate(plan, CreationEntrySource.IMAGE_PAGE,
                new CreationSettings("model", "", "", "", null, null, null));

        Assertions.assertTrue(result.tasks().isEmpty());
        Assertions.assertFalse(result.clarificationQuestion().isBlank());
    }

    /**
     * 构造测试计划。
     *
     * @param entrySource String 入口来源
     * @param tasks List<CreationTask> 任务
     * @return CreationPlan 计划
     */
    private CreationPlan plan(String entrySource, List<CreationTask> tasks) {
        return new CreationPlan("model-plan", "生成内容", entrySource, "执行生成", "", null, tasks);
    }

    /**
     * 构造测试任务。
     *
     * @param taskId String 任务ID
     * @param taskType String 任务类型
     * @param dependencies List<String> 依赖
     * @return CreationTask 任务
     */
    private CreationTask task(String taskId, String taskType, List<String> dependencies) {
        return new CreationTask(taskId, taskType, "generate", "一只小猫", dependencies, null, Map.of());
    }

    /**
     * 构造画布图片或视频生成任务。
     *
     * @param taskId String 任务ID
     * @param taskType String image或video
     * @param toolName String 画布生成工具名
     * @param arguments Map<String, Object> 工具参数
     * @return CreationTask 画布生成任务
     */
    private CreationTask canvasGenerationTask(String taskId, String taskType, String toolName,
                                               Map<String, Object> arguments) {
        return new CreationTask(taskId, taskType, "generate", String.valueOf(arguments.get("prompt")),
                List.of(), toolName, arguments);
    }

    /**
     * 构造完整图片设置。
     *
     * @return CreationSettings 图片设置
     */
    private CreationSettings imageSettings() {
        return new CreationSettings("image-model", "1:1", "2K", "high", 1, null, null);
    }

    /**
     * 构造完整视频设置。
     *
     * @return CreationSettings 视频设置
     */
    private CreationSettings videoSettings() {
        return new CreationSettings("video-model", "16:9", "720p", "medium", null, "5", false);
    }
}

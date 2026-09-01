package com.novanovastudio.agent.workflow;

import com.novanovastudio.agent.dto.CreationPlan;
import com.novanovastudio.agent.dto.CreationTask;
import com.novanovastudio.dto.AiTaskDtos;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import org.springframework.util.StringUtils;

/** 视频生成技能工作流定义。 */
public interface VideoWorkflowDefinition {

    /**
     * 获取服务端注册的工作流类型。
     *
     * @return String 工作流类型
     */
    String workflowType();

    /**
     * 获取首轮需要向用户收集的信息。
     *
     * @return String 澄清问题
     */
    String clarificationQuestion();

    /**
     * 获取工作流对话助手的系统提示词，约定多轮理解意图并起草阶段提示词。
     *
     * @return String 对话助手系统提示词
     */
    default String conversationSystemPrompt() {
        return "";
    }

    /**
     * 获取起草提示词的规格列表：key为上下文存储与对话JSON约定的键名，label为向用户展示的名称。
     *
     * @return List<PromptSpec> 起草提示词规格
     */
    List<PromptSpec> draftPromptSpecs();

    /**
     * 判断草案是否包含全部规格的非空提示词。
     *
     * @param prompts Map<String, Object> 起草的阶段提示词
     * @return boolean 草案是否完整
     */
    default boolean isDraftComplete(Map<String, Object> prompts) {
        return draftPromptSpecs().stream().allMatch(spec -> prompts != null
                && prompts.get(spec.key()) instanceof String text && !text.isBlank());
    }

    /**
     * 组装草案轮展示文本，按规格列表统一拼接，不依赖模型排版。
     *
     * @param intro String 起草轮的简短引导语
     * @param prompts Map<String, Object> 起草的阶段提示词
     * @return String 展示给用户的完整Markdown文本
     */
    default String draftDisplayMessage(String intro, Map<String, Object> prompts) {
        StringBuilder builder = new StringBuilder(StringUtils.hasText(intro) ? intro.trim() : "已为你起草提示词，请确认：");
        for (PromptSpec spec : draftPromptSpecs()) {
            Object value = prompts == null ? null : prompts.get(spec.key());
            builder.append("\n\n**").append(spec.label()).append("**：")
                    .append(value instanceof String text && !text.isBlank() ? text.trim() : "（待补充）");
        }
        return builder.toString();
    }

    /** 起草提示词规格。 */
    record PromptSpec(String key, String label) {
    }

    /**
     * 根据已恢复的上下文构造固定任务计划。
     *
     * @param context VideoWorkflowContext 工作流上下文
     * @return CreationPlan 工作流计划
     */
    CreationPlan buildPlan(VideoWorkflowContext context);

    /**
     * 构造工作流图片阶段计划（仅生成首帧/尾帧图片，待用户确认后再生成视频）。
     * 默认实现与完整计划一致；支持两阶段确认的工作流应覆写此方法只返回图片任务。
     *
     * @param context VideoWorkflowContext 工作流上下文
     * @return CreationPlan 图片阶段计划
     */
    default CreationPlan buildImageStagePlan(VideoWorkflowContext context) {
        return buildPlan(context);
    }

    /**
     * 构造工作流视频阶段计划（使用已确认的图片生成视频，图片引用由上下文提供）。
     * 默认实现与完整计划一致；支持两阶段确认的工作流应覆写此方法只返回视频任务。
     *
     * @param context VideoWorkflowContext 工作流上下文
     * @return CreationPlan 视频阶段计划
     */
    default CreationPlan buildVideoStagePlan(VideoWorkflowContext context) {
        return buildPlan(context);
    }

    /**
     * 判断工作流是否支持"图片待确认"两阶段执行（先出图、用户确认后再出视频）。
     * 默认返回 false（一次性执行完整计划）。
     *
     * @return boolean 是否启用两阶段图片确认
     */
    default boolean supportsImageConfirmation() {
        return false;
    }

    /**
     * 校验工作流固定计划的角色、类型与依赖。
     *
     * @param tasks List<CreationTask> 计划任务
     * @return void 无返回值
     */
    void validateTasks(List<CreationTask> tasks);

    /**
     * 返回下游任务读取依赖结果的稳定顺序。
     *
     * @param task CreationTask 下游任务
     * @return List<String> 依赖任务ID顺序
     */
    default List<String> orderedDependencies(CreationTask task) {
        return task.dependsOn() == null ? List.of() : task.dependsOn();
    }

    /**
     * 判断任务是否必须使用工作流图片模型。
     *
     * @param task CreationTask 当前任务
     * @return boolean 是否使用图片模型
     */
    default boolean usesWorkflowImageModel(CreationTask task) {
        return false;
    }

    /**
     * 获取视频任务实际使用的生成模式。
     *
     * @param task CreationTask 当前任务
     * @param configuredMode String 页面配置的视频生成模式
     * @return String 工作流要求的视频生成模式
     */
    default String videoGenerationMode(CreationTask task, String configuredMode) {
        return configuredMode;
    }

    /**
     * 根据模型已声明能力选择工作流任务的实际视频模式。
     *
     * @param task CreationTask 当前任务
     * @param configuredMode String 页面配置模式
     * @param capabilities Set<String> 模型能力
     * @return String 实际视频模式
     */
    default String videoGenerationMode(CreationTask task, String configuredMode, Set<String> capabilities) {
        return videoGenerationMode(task, configuredMode);
    }

    /**
     * 返回工作流任务可使用的视频模式候选项，按业务优先级排序。
     *
     * @param task CreationTask 当前任务
     * @param configuredMode String 页面配置模式
     * @param capabilities Set<String> 模型能力
     * @return List<String> 可用视频模式候选项
     */
    default List<String> videoGenerationModes(CreationTask task, String configuredMode, Set<String> capabilities) {
        return List.of(videoGenerationMode(task, configuredMode, capabilities));
    }

    /**
     * 补充工作流下游任务的供应商无关提示词约束。
     *
     * @param task CreationTask 当前任务
     * @param prompt String 原始提示词
     * @return String 处理后的提示词
     */
    default String enrichPrompt(CreationTask task, String prompt) {
        return prompt;
    }

    /**
     * 按实际视频模式补充工作流提示词约束。
     *
     * @param task CreationTask 当前任务
     * @param prompt String 原始提示词
     * @param videoGenerationMode String 实际视频模式
     * @return String 处理后的提示词
     */
    default String enrichPrompt(CreationTask task, String prompt, String videoGenerationMode) {
        return enrichPrompt(task, prompt);
    }

    /**
     * 获取阶段展示名称。
     *
     * @param task CreationTask 当前任务
     * @return String 阶段展示名称
     */
    default String displayName(CreationTask task) {
        return task == null || task.taskRole() == null ? "生成任务" : task.taskRole();
    }

    /**
     * 构建工作流阶段报价计划。
     *
     * @param request VideoWorkflowQuoteRequest 视频工作流报价请求
     * @return Optional<VideoWorkflowQuotePlan> 工作流报价计划
     */
    default Optional<VideoWorkflowQuotePlan> buildQuotePlan(AiTaskDtos.VideoWorkflowQuoteRequest request) {
        return Optional.empty();
    }

    /** 工作流报价计划。 */
    record VideoWorkflowQuotePlan(List<VideoWorkflowQuoteStage> stages) {
        public VideoWorkflowQuotePlan {
            stages = stages == null ? List.of() : List.copyOf(stages);
        }
    }

    /** 工作流单阶段报价定义。 */
    record VideoWorkflowQuoteStage(String role, String displayName, String taskType, String modelType,
                                   Integer taskCount, Map<String, Object> parameters,
                                   List<String> requiredCapabilities, List<String> videoGenerationModes,
                                   List<String> referenceRoles) {
        public VideoWorkflowQuoteStage {
            taskCount = taskCount == null ? 1 : taskCount;
            parameters = parameters == null ? Map.of() : java.util.Collections.unmodifiableMap(new java.util.LinkedHashMap<>(parameters));
            requiredCapabilities = requiredCapabilities == null ? List.of() : List.copyOf(requiredCapabilities);
            videoGenerationModes = videoGenerationModes == null ? List.of() : List.copyOf(videoGenerationModes);
            referenceRoles = referenceRoles == null ? List.of() : List.copyOf(referenceRoles);
        }
    }
}

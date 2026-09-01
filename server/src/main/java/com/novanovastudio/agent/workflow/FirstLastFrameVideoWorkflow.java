package com.novanovastudio.agent.workflow;

import com.novanovastudio.agent.CreationEntrySource;
import com.novanovastudio.agent.dto.CreationPlan;
import com.novanovastudio.agent.dto.CreationTask;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.dto.AiTaskDtos;
import java.util.List;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

/** 首尾帧生成视频工作流定义。 */
@Component
public class FirstLastFrameVideoWorkflow implements VideoWorkflowDefinition {

    /** 首尾帧工作流类型。 */
    public static final String TYPE = "first-last-frame";
    /** 首帧任务编号。 */
    private static final String FIRST_FRAME_TASK_ID = "first-frame";
    /** 尾帧任务编号。 */
    private static final String LAST_FRAME_TASK_ID = "last-frame";
    /** 视频任务编号。 */
    private static final String VIDEO_TASK_ID = "video";
    /** 起草提示词规格：键名与对话JSON约定，标签用于向用户展示。 */
    private static final List<VideoWorkflowDefinition.PromptSpec> DRAFT_PROMPT_SPECS = List.of(
            new VideoWorkflowDefinition.PromptSpec("firstFramePrompt", "首帧提示词"),
            new VideoWorkflowDefinition.PromptSpec("lastFramePrompt", "尾帧提示词"),
            new VideoWorkflowDefinition.PromptSpec("videoPrompt", "视频提示词"));

    /** {@inheritDoc} */
    @Override
    public String workflowType() {
        return TYPE;
    }

    /** {@inheritDoc} */
    @Override
    public String clarificationQuestion() {
        return "请描述视频的起始画面、结束画面以及中间的镜头运动或变化。";
    }

    /** {@inheritDoc} */
    @Override
    public List<VideoWorkflowDefinition.PromptSpec> draftPromptSpecs() {
        return DRAFT_PROMPT_SPECS;
    }

    /** {@inheritDoc} */
    @Override
    public String conversationSystemPrompt() {
        return """
                你是「首尾帧生成视频」技能的工作流助手，通过与用户多轮对话理解创作意图，并起草三段最终提示词。

                工作目标：
                1. 理解用户想要的视频内容：起始画面、结束画面、两帧之间的镜头运动或变化。信息不足时用简短的追问继续对话，一次只问最关键的内容，不要罗列多个问题。
                2. 信息足够后，为用户起草三段中文提示词：firstFramePrompt（首帧画面）、lastFramePrompt（尾帧画面）、videoPrompt（视频运动，描述两帧之间的主体运动、镜头运动和过渡方式）。提示词要具体、可直接用于生成。
                3. draft 动作的 message 只写一句简短引导语（例如对场景的理解和请用户确认），不要重复提示词内容，服务端会统一展示。
                4. 任何一轮需要用户在多个候选项中选择时，必须通过 choices 数组返回选项，前端会将每个选项渲染为可直接点击的按钮；不要只在 message 中用文字罗列选项。每项必须包含 label（按钮文案）和 value（点击后发送的用户回复），可选 multiple（是否允许多选）与 action（特殊操作标识）。

                严格只输出以下JSON结构之一，不要输出其他内容；无选项时 choices 返回空数组：
                {"action":"reply","message":"继续澄清或解答的回复","choices":[]}
                {"action":"reply","message":"请从候选项中选择","choices":[{"label":"候选项一","value":"候选项一","multiple":false}]}
                {"action":"draft","message":"展示三段提示词并请求确认的回复","prompts":{"firstFramePrompt":"...","lastFramePrompt":"...","videoPrompt":"..."},"choices":[]}
                {"action":"confirm","message":"确认后开始生成的简短回复","choices":[]}

                action 取值规则：
                - 信息不足、用户在提问或需要解释：reply
                - 三段提示词已起草或按用户意见修改完成：draft
                - 用户明确确认提示词或要求开始生成：confirm，message保持简短
                - choices 中存在两个或以上选项时，所有选项都必须放入 choices，禁止仅以文字形式提供多个候选项""";
    }

    /** {@inheritDoc} */
    @Override
    public CreationPlan buildPlan(VideoWorkflowContext context) {
        return buildImageStagePlan(context);
    }

    /** {@inheritDoc} */
    @Override
    public boolean supportsImageConfirmation() {
        return true;
    }

    /**
     * 构造首尾帧图片阶段计划：先文生图生成首帧，再以首帧图片为参考生成尾帧，视频任务等待用户确认图片后再执行。
     *
     * @param context VideoWorkflowContext 工作流上下文
     * @return CreationPlan 图片阶段计划
     */
    @Override
    public CreationPlan buildImageStagePlan(VideoWorkflowContext context) {
        String requirement = context.originalRequest();
        String answer = context.answers() == null || context.answers().isEmpty() ? "" : String.join("；", context.answers());
        String source = StringUtils.hasText(answer) ? requirement + "\n补充说明：" + answer : requirement;
        String firstPrompt = context.draftedPrompt("firstFramePrompt");
        String lastPrompt = context.draftedPrompt("lastFramePrompt");
        List<CreationTask> tasks = List.of(
                new CreationTask(FIRST_FRAME_TASK_ID, "image", "generate",
                        StringUtils.hasText(firstPrompt) ? firstPrompt : "请生成视频首帧画面：\n" + source,
                        null, List.of(), "", Map.of(), "first_frame"),
                new CreationTask(LAST_FRAME_TASK_ID, "image", "generate",
                        StringUtils.hasText(lastPrompt) ? lastPrompt : "请基于首帧参考图生成视频尾帧画面，保持首帧的主体与构图，仅变化要求的状态或位置：\n" + source,
                        null, List.of(FIRST_FRAME_TASK_ID), "", Map.of(), "last_frame"));
        return new CreationPlan("", "首尾帧生成视频", CreationEntrySource.VIDEO_PAGE,
                "正在生成首帧、尾帧图片", "", false, context.creationSettings(), tasks, List.of(), TYPE);
    }

    /**
     * 构造首尾帧视频阶段计划：使用已确认的首帧/尾帧图片生成视频，图片引用由执行器从上下文读取。
     *
     * @param context VideoWorkflowContext 工作流上下文
     * @return CreationPlan 视频阶段计划
     */
    @Override
    public CreationPlan buildVideoStagePlan(VideoWorkflowContext context) {
        String requirement = context.originalRequest();
        String answer = context.answers() == null || context.answers().isEmpty() ? "" : String.join("；", context.answers());
        String source = StringUtils.hasText(answer) ? requirement + "\n补充说明：" + answer : requirement;
        String videoPrompt = context.draftedPrompt("videoPrompt");
        List<CreationTask> tasks = List.of(
                new CreationTask(VIDEO_TASK_ID, "video", "generate",
                        StringUtils.hasText(videoPrompt) ? videoPrompt : "请根据首帧和尾帧生成连贯视频：\n" + source,
                        null, List.of(), "", Map.of(), "video"));
        return new CreationPlan("", "首尾帧生成视频", CreationEntrySource.VIDEO_PAGE,
                "正在根据已确认图片生成视频", "", false, context.creationSettings(), tasks, List.of(), TYPE);
    }

    /** {@inheritDoc} */
    @Override
    public void validateTasks(List<CreationTask> tasks) {
        if (tasks == null || (tasks.size() != 3 && tasks.size() != 2 && tasks.size() != 1)) throw invalid();
        Map<String, CreationTask> byRole = tasks.stream().collect(java.util.stream.Collectors.toMap(
                CreationTask::taskRole, task -> task, (first, second) -> { throw invalid(); }));
        boolean hasFirst = byRole.containsKey("first_frame");
        boolean hasLast = byRole.containsKey("last_frame");
        boolean hasVideo = byRole.containsKey("video");
        // 图片阶段：首帧文生图 + 尾帧以首帧为参考生成；视频阶段：仅视频任务；完整计划：三任务全齐
        if (hasVideo) {
            if (hasFirst || hasLast || tasks.size() != 1) throw invalid();
            CreationTask video = byRole.get("video");
            if (!"video".equals(video.taskType())) throw invalid();
            if (tasks.stream().anyMatch(task -> !"generate".equals(task.action()) || StringUtils.hasText(task.toolName())
                    || (task.toolArguments() != null && !task.toolArguments().isEmpty()))) throw invalid();
            return;
        }
        if (tasks.size() != 2 || !hasFirst || !hasLast) throw invalid();
        CreationTask firstFrame = byRole.get("first_frame");
        CreationTask lastFrame = byRole.get("last_frame");
        if (!"image".equals(firstFrame.taskType()) || !"image".equals(lastFrame.taskType())) throw invalid();
        if (tasks.stream().anyMatch(task -> !"generate".equals(task.action()) || StringUtils.hasText(task.toolName())
                || (task.toolArguments() != null && !task.toolArguments().isEmpty()))) throw invalid();
        // 尾帧必须以首帧为参考生成：首帧无依赖，尾帧依赖首帧
        if ((firstFrame.dependsOn() != null && !firstFrame.dependsOn().isEmpty())
                || lastFrame.dependsOn() == null || !lastFrame.dependsOn().contains(FIRST_FRAME_TASK_ID)) throw invalid();
    }

    /** {@inheritDoc} */
    @Override
    public List<String> orderedDependencies(CreationTask task) {
        // 尾帧任务依赖首帧任务，执行时把首帧生成的图片作为参考附件注入；视频任务无计划内图片依赖，
        // 图片引用由执行器从上下文 generated_images 按角色顺序组装。
        if (task != null && "last_frame".equals(task.taskRole())) {
            return List.of(FIRST_FRAME_TASK_ID);
        }
        return List.of();
    }

    /** {@inheritDoc} */
    @Override
    public boolean usesWorkflowImageModel(CreationTask task) {
        return task != null && Set.of("first_frame", "last_frame").contains(task.taskRole());
    }

    /** {@inheritDoc} */
    @Override
    public String videoGenerationMode(CreationTask task, String configuredMode) {
        return task != null && "video".equals(task.taskRole()) ? "reference-to-video" : configuredMode;
    }

    /** {@inheritDoc} */
    @Override
    public String videoGenerationMode(CreationTask task, String configuredMode, Set<String> capabilities) {
        return videoGenerationModes(task, configuredMode, capabilities).getFirst();
    }

    /** {@inheritDoc} */
    @Override
    public List<String> videoGenerationModes(CreationTask task, String configuredMode, Set<String> capabilities) {
        if (task == null || !"video".equals(task.taskRole())) return List.of(configuredMode);
        Set<String> supported = capabilities == null ? Set.of() : capabilities;
        List<String> modes = new java.util.ArrayList<>();
        if (supported.contains("first-last-frame-to-video")) modes.add("first-last-frame-to-video");
        if (supported.contains("reference-to-video")) modes.add("reference-to-video");
        if (!modes.isEmpty()) return List.copyOf(modes);
        throw new BusinessException(ErrorCode.BUSINESS_ERROR, "当前视频模型未配置首尾帧原生或参考图生成能力");
    }

    /** {@inheritDoc} */
    @Override
    public String enrichPrompt(CreationTask task, String prompt) {
        return prompt;
    }

    /** {@inheritDoc} */
    @Override
    public String enrichPrompt(CreationTask task, String prompt, String videoGenerationMode) {
        if (task != null && "video".equals(task.taskRole()) && "reference-to-video".equals(videoGenerationMode)) {
            return prompt + "\n约束：视频开始必须匹配首帧参考图，视频结束必须匹配尾帧参考图。";
        }
        return prompt;
    }

    /** {@inheritDoc} */
    @Override
    public String displayName(CreationTask task) {
        if (task == null) return "生成任务";
        return switch (task.taskRole()) {
            case "first_frame" -> "生成首帧";
            case "last_frame" -> "生成尾帧";
            case "video" -> "合成视频";
            default -> task.taskRole();
        };
    }

    /**
     * 构建首尾帧工作流的阶段报价定义。
     *
     * @param request VideoWorkflowQuoteRequest 视频工作流报价请求
     * @return Optional<VideoWorkflowQuotePlan> 首尾帧阶段报价计划
     */
    @Override
    public Optional<VideoWorkflowQuotePlan> buildQuotePlan(AiTaskDtos.VideoWorkflowQuoteRequest request) {
        if (request == null || !StringUtils.hasText(request.resolution()) || !StringUtils.hasText(request.seconds())) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "工作流报价缺少视频分辨率或时长设置");
        }
        Map<String, Object> videoParameters = new LinkedHashMap<>();
        videoParameters.put("resolution", request.resolution());
        videoParameters.put("seconds", request.seconds());
        return Optional.of(new VideoWorkflowQuotePlan(List.of(
                new VideoWorkflowQuoteStage("first_frame", "生成首帧", "image", "image", 1,
                        Map.of("count", 1), List.of("text-to-image"), List.of(), List.of()),
                new VideoWorkflowQuoteStage("last_frame", "生成尾帧", "image", "image", 1,
                        Map.of("count", 1), List.of("text-to-image"), List.of(), List.of()),
                new VideoWorkflowQuoteStage("video", "合成视频", "video", "video", 1,
                        videoParameters, List.of(), List.of("first-last-frame-to-video", "reference-to-video"),
                        List.of("first_frame", "last_frame")))));
    }

    /**
     * 创建统一的固定计划校验异常。
     *
     * @return BusinessException 业务异常
     */
    private BusinessException invalid() {
        return new BusinessException(ErrorCode.PARAM_INVALID, "首尾帧视频工作流计划不符合服务端定义");
    }
}

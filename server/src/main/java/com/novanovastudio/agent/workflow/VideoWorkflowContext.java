package com.novanovastudio.agent.workflow;

import com.novanovastudio.agent.dto.CreationSettings;
import java.util.List;
import java.util.Map;

/**
 * 视频技能工作流可恢复上下文。
 *
 * @param id String 上下文ID
 * @param workflowType String 工作流类型
 * @param skillSnapshot Map<String, Object> 技能快照
 * @param originalRequest String 首轮用户原始需求
 * @param clarificationQuestion String 当前澄清问题
 * @param answers List<String> 已收集回答
 * @param draftedPrompts Map<String, Object> 助手起草的待确认阶段提示词
 * @param generatedImages Map<String, Object> 图片阶段已生成的首帧/尾帧图片结果，key 为任务角色
 * @param creationSettings CreationSettings 页面生成设置
 * @param status String 上下文状态
 * @param contextVersion Integer 上下文版本
 */
public record VideoWorkflowContext(String id, String workflowType, Map<String, Object> skillSnapshot,
                                   String originalRequest, String clarificationQuestion, List<String> answers,
                                   Map<String, Object> draftedPrompts, Map<String, Object> generatedImages,
                                   CreationSettings creationSettings,
                                   String status, Integer contextVersion) {

    /**
     * 合并本轮用户回答，供工作流生成固定计划。
     *
     * @param answer String 用户回答
     * @return VideoWorkflowContext 已合并回答的上下文
     */
    public VideoWorkflowContext withAnswer(String answer) {
        List<String> values = answer == null || answer.isBlank() ? answers :
                java.util.stream.Stream.concat((answers == null ? List.<String>of() : answers).stream(),
                        java.util.stream.Stream.of(answer.trim())).toList();
        return new VideoWorkflowContext(id, workflowType, skillSnapshot, originalRequest, clarificationQuestion,
                values, draftedPrompts, generatedImages, creationSettings, status, contextVersion);
    }

    /**
     * 携带已生成的首帧/尾帧图片结果的新上下文。
     *
     * @param images Map<String, Object> 图片阶段结果，key 为任务角色（first_frame/last_frame）
     * @return VideoWorkflowContext 已携带图片结果、状态推进到图片待确认的上下文
     */
    public VideoWorkflowContext withGeneratedImages(Map<String, Object> images) {
        return new VideoWorkflowContext(id, workflowType, skillSnapshot, originalRequest, clarificationQuestion,
                answers, draftedPrompts, images, creationSettings, "image_pending_confirm",
                contextVersion == null ? 1 : contextVersion + 1);
    }

    /**
     * 用户确认使用已生成图片后进入视频阶段的新上下文。
     *
     * @return VideoWorkflowContext 状态推进到已规划阶段的上下文
     */
    public VideoWorkflowContext confirmedImages() {
        return new VideoWorkflowContext(id, workflowType, skillSnapshot, originalRequest, clarificationQuestion,
                answers, draftedPrompts, generatedImages, creationSettings, "planned",
                contextVersion == null ? 1 : contextVersion + 1);
    }

    /**
     * 携带最新页面生成设置的新上下文（图片确认轮用户可能调整视频比例/清晰度/时长后确认）。
     *
     * @param settings CreationSettings 最新页面生成设置
     * @return VideoWorkflowContext 使用最新设置的上下文
     */
    public VideoWorkflowContext withCreationSettings(CreationSettings settings) {
        return new VideoWorkflowContext(id, workflowType, skillSnapshot, originalRequest, clarificationQuestion,
                answers, draftedPrompts, generatedImages, settings, status, contextVersion);
    }

    /**
     * 判断上下文是否携带用户已确认可用的阶段提示词草案。
     *
     * @return boolean 是否存在完整草案
     */
    public boolean hasDraftedPrompts() {
        return draftedPrompts != null && draftedPrompts.values().stream()
                .anyMatch(value -> value instanceof String text && !text.isBlank());
    }

    /**
     * 读取草案中的字符串提示词。
     *
     * @param key String 草案键名
     * @return String 提示词，缺失时为空
     */
    public String draftedPrompt(String key) {
        Object value = draftedPrompts == null ? null : draftedPrompts.get(key);
        return value instanceof String text && !text.isBlank() ? text : "";
    }
}

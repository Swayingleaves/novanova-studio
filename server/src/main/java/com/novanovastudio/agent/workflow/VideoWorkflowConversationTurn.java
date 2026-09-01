package com.novanovastudio.agent.workflow;

import com.novanovastudio.agent.dto.AgentChoice;
import java.util.List;
import java.util.Map;

/**
 * 视频工作流对话助手的单轮结构化结果。
 *
 * @param action String 本轮动作：reply继续对话、draft起草提示词待确认、confirm用户已确认开始生成
 * @param message String 向用户展示的回复文本
 * @param prompts Map<String, Object> 起草的阶段提示词，键名由各工作流定义的规格约定
 * @param choices List<AgentChoice> 本轮多个候选项，前端渲染为可点击按钮
 */
public record VideoWorkflowConversationTurn(String action, String message, Map<String, Object> prompts,
                                            List<AgentChoice> choices) {

    /**
     * 保留三参数构造方式，兼容未返回选项的旧结构化结果。
     *
     * @param action String 本轮动作
     * @param message String 向用户展示的回复文本
     * @param prompts Map<String, Object> 起草提示词
     */
    public VideoWorkflowConversationTurn(String action, String message, Map<String, Object> prompts) {
        this(action, message, prompts, List.of());
    }

    /** 继续对话动作。 */
    public static final String ACTION_REPLY = "reply";
    /** 起草提示词动作。 */
    public static final String ACTION_DRAFT = "draft";
    /** 用户确认动作。 */
    public static final String ACTION_CONFIRM = "confirm";

    /**
     * 判断动作是否为确认开始生成。
     *
     * @return boolean 是否确认
     */
    public boolean isConfirm() {
        return ACTION_CONFIRM.equalsIgnoreCase(action);
    }

    /**
     * 判断动作是否为起草提示词。
     *
     * @return boolean 是否起草
     */
    public boolean isDraft() {
        return ACTION_DRAFT.equalsIgnoreCase(action);
    }
}

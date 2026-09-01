package com.novanovastudio.agent.dto;

import java.util.List;

/**
 * Agent返回给前端的结构化交互动作。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-31 21:17
 * @param type String 动作类型
 * @param label String 按钮显示文案
 * @param href String 动作目标地址
 * @param initialPrompt String 需要带入目标页面的原始提示词
 * @param options List<AgentChoice> type=choice 时的可点击选项
 */
public record AgentAction(
        String type,
        String label,
        String href,
        String initialPrompt,
        List<AgentChoice> options
) {

    /**
     * 创建跳转画布动作。
     *
     * @param initialPrompt String 需要带入画布的原始提示词
     * @return AgentAction 跳转画布动作
     */
    public static AgentAction navigateToCanvas(String initialPrompt) {
        return new AgentAction("navigate", "去画布操作", "/canvas", initialPrompt, null);
    }

    /**
     * 创建选项选择动作，用户点击某个选项后其 value 将作为用户消息发送。
     *
     * @param options List<AgentChoice> 可点击选项
     * @return AgentAction 选项选择动作
     */
    public static AgentAction choice(List<AgentChoice> options) {
        return new AgentAction("choice", "请选择", null, null, options);
    }
}

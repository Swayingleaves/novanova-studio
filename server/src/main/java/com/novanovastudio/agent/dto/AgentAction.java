package com.novanovastudio.agent.dto;

/**
 * Agent返回给前端的结构化交互动作。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-31 21:17
 * @param type String 动作类型
 * @param label String 按钮显示文案
 * @param href String 动作目标地址
 * @param initialPrompt String 需要带入目标页面的原始提示词
 */
public record AgentAction(
        String type,
        String label,
        String href,
        String initialPrompt
) {

    /**
     * 创建跳转画布动作。
     *
     * @param initialPrompt String 需要带入画布的原始提示词
     * @return AgentAction 跳转画布动作
     */
    public static AgentAction navigateToCanvas(String initialPrompt) {
        return new AgentAction("navigate", "去画布操作", "/canvas", initialPrompt);
    }
}

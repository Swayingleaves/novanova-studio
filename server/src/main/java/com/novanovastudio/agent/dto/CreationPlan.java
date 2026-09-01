package com.novanovastudio.agent.dto;

import java.util.List;

/**
 * 主Agent输出的结构化创作计划。
 *
 * @param planId String 计划编号，由服务端覆盖模型输出
 * @param intent String 用户创作意图
 * @param entrySource String 入口来源
 * @param summary String 可向用户展示的计划摘要
 * @param clarificationQuestion String 缺少参数时向用户提出的问题
 * @param canvasGuidance Boolean 是否应引导用户前往画布处理批量任务
 * @param creationSettings CreationSettings 页面生成硬约束
 * @param tasks List<CreationTask> 计划任务列表
 * @param choices List<AgentChoice> 需要用户从选项中挑选时的可点击选项，可为空
 * @param workflowType String 服务端注册的视频工作流类型
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-23 00:00
 */
public record CreationPlan(
        String planId,
        String intent,
        String entrySource,
        String summary,
        String clarificationQuestion,
        Boolean canvasGuidance,
        CreationSettings creationSettings,
        List<CreationTask> tasks,
        List<AgentChoice> choices,
        String workflowType
) {

    /**
     * 保留工作流类型扩展前的完整参数构造方式。
     *
     * @param planId String 计划编号
     * @param intent String 用户创作意图
     * @param entrySource String 入口来源
     * @param summary String 计划摘要
     * @param clarificationQuestion String 澄清问题
     * @param canvasGuidance Boolean 是否引导画布
     * @param creationSettings CreationSettings 页面设置
     * @param tasks List<CreationTask> 任务列表
     * @param choices List<AgentChoice> 选项列表
     */
    public CreationPlan(String planId, String intent, String entrySource, String summary,
                        String clarificationQuestion, Boolean canvasGuidance, CreationSettings creationSettings,
                        List<CreationTask> tasks, List<AgentChoice> choices) {
        this(planId, intent, entrySource, summary, clarificationQuestion, canvasGuidance,
                creationSettings, tasks, choices, null);
    }
}

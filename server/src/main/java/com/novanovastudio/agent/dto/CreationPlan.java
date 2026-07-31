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
        List<CreationTask> tasks
) {
}

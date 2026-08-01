package com.novanovastudio.agent.dto;

import com.novanovastudio.ai.AiErrorDetails;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 服务端提供给主Agent和恢复校验器的失败任务上下文。
 *
 * @param taskId String 原计划任务编号
 * @param taskType String 任务类型
 * @param action String 原计划动作
 * @param toolName String 原工具名称
 * @param actualPrompt String 实际提交的提示词
 * @param toolArguments Map<String, Object> 实际工具参数
 * @param argumentSources Map<String, String> 工具参数来源
 * @param agentGeneratedArguments Set<String> 允许Agent调整的参数名
 * @param failedNodeIds List<String> 失败画布节点编号
 * @param successfulNodeIds List<String> 已成功画布节点编号
 * @param nodeFailures List<RecoveryNodeFailure> 逐节点结构化错误
 * @param error AiErrorDetails 结构化错误详情
 * @param allowedActions List<String> 服务端允许主Agent选择的动作
 * @param recoveryAttempt int 已执行恢复次数
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-08-01 00:00
 */
public record RecoveryTaskContext(
        String taskId,
        String taskType,
        String action,
        String toolName,
        String actualPrompt,
        Map<String, Object> toolArguments,
        Map<String, String> argumentSources,
        Set<String> agentGeneratedArguments,
        List<String> failedNodeIds,
        List<String> successfulNodeIds,
        List<RecoveryNodeFailure> nodeFailures,
        AiErrorDetails error,
        List<String> allowedActions,
        int recoveryAttempt
) {
}

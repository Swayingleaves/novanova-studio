package com.novanovastudio.agent.dto;

import java.util.List;
import java.util.Map;

/**
 * 主Agent针对单个失败任务给出的恢复决策。
 *
 * @param taskId String 原计划任务编号
 * @param nodeIds List<String> 需要恢复的画布失败节点编号
 * @param action String 恢复动作
 * @param adjustedPrompt String 调整后的实际提示词
 * @param adjustedToolArguments Map<String, Object> 仅包含需要调整字段的工具参数补丁
 * @param reason String 决策原因或用户可见说明
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-08-01 00:00
 */
public record RecoveryTaskDecision(
        String taskId,
        List<String> nodeIds,
        String action,
        String adjustedPrompt,
        Map<String, Object> adjustedToolArguments,
        String reason
) {
}

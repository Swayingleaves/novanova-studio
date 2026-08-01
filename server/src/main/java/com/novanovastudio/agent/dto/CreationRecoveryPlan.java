package com.novanovastudio.agent.dto;

import java.util.List;

/**
 * 主Agent对同一依赖层失败任务给出的结构化恢复计划。
 *
 * @param message String 本轮恢复的用户可见说明
 * @param decisions List<RecoveryTaskDecision> 每个失败任务的恢复决策
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-08-01 00:00
 */
public record CreationRecoveryPlan(
        String message,
        List<RecoveryTaskDecision> decisions
) {
}

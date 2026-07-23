package com.novanovastudio.agent.dto;

/**
 * 固定图片或视频子Agent的提示词准备决策。
 *
 * @param taskId String 对应计划任务编号
 * @param promptStrategy String 提示词策略：KEEP或OPTIMIZE
 * @param reason String 可记录但不向用户展示的简短决策原因
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-23 00:00
 */
public record SpecialistAgentResult(
        String taskId,
        String promptStrategy,
        String reason
) {
}

package com.novanovastudio.agent.dto;

import com.novanovastudio.ai.AiErrorDetails;

/**
 * 画布生成节点的结构化失败详情。
 *
 * @param nodeId String 失败节点编号
 * @param error AiErrorDetails 节点错误详情
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-08-01 00:00
 */
public record RecoveryNodeFailure(
        String nodeId,
        AiErrorDetails error
) {
}

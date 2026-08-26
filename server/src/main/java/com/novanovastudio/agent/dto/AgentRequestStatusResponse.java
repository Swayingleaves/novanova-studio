package com.novanovastudio.agent.dto;

/**
 * 主Agent请求状态查询结果。
 *
 * @param status String 请求状态：queued、running、success、failed、canceled或interrupted
 * @param message String 终态说明，运行中为空
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-08-26 00:00
 */
public record AgentRequestStatusResponse(String status, String message) {
}
